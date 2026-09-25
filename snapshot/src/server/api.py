import asyncio
import json
import os
import tempfile
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Set
from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import FileResponse, StreamingResponse
from src.analyzer.cache import SQLiteCache
from src.analyzer.drive import DriveClient, PROXY_URL
from src.analyzer.exporter import (
    export_first_prompts_to_jsonl,
    export_prompts_summary_csv,
)
from src.analyzer.loader import load_cached_sessions
from src.analyzer.metrics import calculate_session_metrics
from src.analyzer.models import PromptSession
from src.analyzer.parser import parse_prompt_json
from src.analyzer.sync import fetch_remote_files

router = APIRouter(prefix="/api")
cache = SQLiteCache(cache_dir=".cache")

# 全局后台增量同步状态
sync_status = {"is_syncing": False, "last_result": None, "error": None}

# SSE 订阅客户端队列池
_sync_event_queues: Set[asyncio.Queue] = set()


def notify_sync_event(event_type: str, payload: dict):
    """向所有在线前端推送 SSE 事件"""
    for q in list(_sync_event_queues):
        try:
            q.put_nowait({"event": event_type, "data": payload})
        except Exception:
            pass


def _ensure_index_bootstrapped():
    """首次启动或缓存更新时，自动检查并构建二级索引"""
    total_raw = cache.count()
    total_idx = cache.count_indices()
    if total_raw > 0 and total_idx < total_raw:
        print(f"⚡ 正在增量补全 SQLite 会话索引 ({total_idx} -> {total_raw})...")
        for fid, mtime, raw_data in cache.iter_all_data():
            file_meta = {"id": fid, "modifiedTime": mtime, "name": raw_data.get("name", "Untitled")}
            session = parse_prompt_json(file_meta, raw_data)
            if session:
                cache.upsert_session_index(session)
        print("✅ SQLite 二级会话索引补全完成，后续所有冷启动将处于毫秒级！")


def _get_range_start_iso(range_key: str) -> Optional[str]:
    if range_key == "all":
        return None
    now = datetime.now(timezone.utc)
    if range_key == "7d":
        return (now - timedelta(days=7)).isoformat()
    if range_key == "30d":
        return (now - timedelta(days=30)).isoformat()
    if range_key == "90d":
        return (now - timedelta(days=90)).isoformat()
    if range_key == "this_year":
        return datetime(now.year, 1, 1, tzinfo=timezone.utc).isoformat()
    return None


def _ensure_sessions_loaded() -> List[PromptSession]:
    """确保内存中常驻已解析的全量会话列表"""
    global _ALL_SESSIONS
    if _ALL_SESSIONS is None:
        _ALL_SESSIONS = load_cached_sessions(cache, limit=0, show_progress=False)
    return _ALL_SESSIONS


def filter_sessions_by_range(
    sessions: List[PromptSession], range_key: str
) -> List[PromptSession]:
    """
    根据时间范围切片关键词过滤会话：
    - '7d': 最近 7 天
    - '30d': 最近 30 天
    - '90d': 最近 90 天
    - 'this_year': 今年以来
    - 'all': 全量历史
    """
    if range_key == "all" or not sessions:
        return sessions

    now = datetime.now(timezone.utc)
    if range_key == "7d":
        start_time = now - timedelta(days=7)
    elif range_key == "30d":
        start_time = now - timedelta(days=30)
    elif range_key == "90d":
        start_time = now - timedelta(days=90)
    elif range_key == "this_year":
        start_time = datetime(now.year, 1, 1, tzinfo=timezone.utc)
    else:
        return sessions

    filtered = []
    for s in sessions:
        ref_time = s.end_time or s.modified_time or s.start_time
        if ref_time:
            # 兼容带时区与不带时区的时间戳比较
            if ref_time.tzinfo is None:
                ref_time = ref_time.replace(tzinfo=timezone.utc)
            if ref_time >= start_time:
                filtered.append(s)
    return filtered


def _run_sync_task(limit: Optional[int], all_files: bool):
    sync_status["is_syncing"] = True
    sync_status["error"] = None

    def on_progress(current: int, total: int, hits: int, downloaded: int):
        notify_sync_event(
            "sync_progress",
            {
                "current": current,
                "total": total,
                "cache_hits": hits,
                "downloaded": downloaded,
            },
        )

    try:
        client = DriveClient(proxy_url=PROXY_URL)
        total, hits, updated_sessions = fetch_remote_files(
            client=client,
            cache=cache,
            limit=limit,
            all_files=all_files,
            progress_callback=on_progress,
        )
        downloaded = len(updated_sessions)
        sync_status["last_result"] = {
            "total_scanned": total,
            "cache_hits": hits,
            "downloaded": downloaded,
            "cache_total": cache.count(),
        }

        notify_sync_event("sync_done", sync_status["last_result"])
    except Exception as exc:
        sync_status["error"] = str(exc)
        notify_sync_event("sync_error", {"error": str(exc)})
    finally:
        sync_status["is_syncing"] = False


@router.get("/metrics")
def get_metrics(range: str = "all"):
    """
    基于 session_index 表毫秒级聚合认知与交互指标（耗时 <10ms）。
    """
    _ensure_index_bootstrapped()
    range_start = _get_range_start_iso(range)
    indices = cache.query_indices(range_start_iso=range_start)
    return calculate_session_metrics(indices)


@router.get("/sessions")
def list_sessions(range: str = "all", limit: Optional[int] = None):
    """
    基于 session_index 极速返回会话列表，供前端 5000+ 虚拟滚动使用（耗时 <15ms）。
    """
    _ensure_index_bootstrapped()
    range_start = _get_range_start_iso(range)
    indices = cache.query_indices(range_start_iso=range_start, limit=limit)
    return [
        {
            "file_id": idx["file_id"],
            "name": idx["name"],
            "model": idx["model"],
            "turn_count": idx["turn_count"],
            "total_tokens": idx["total_tokens"],
            "thought_tokens": idx["thought_tokens"],
            "duration_human": idx["duration_human"],
            "duration_seconds": idx["duration_seconds"],
            "has_branching": bool(idx["has_branching"]),
            "branch_count": idx["branch_count"],
            "first_prompt": idx["first_prompt"] or "",
            "modified_time": idx["modified_time"],
            "created_time": idx["created_time"],
        }
        for idx in indices
    ]


@router.get("/sessions/{file_id}")
def get_session_detail(file_id: str):
    """
    按需从 file_cache 仅读取并解析单个会话的详细对话轮次（耗时 <1ms）
    """
    raw_data = cache.get(file_id)
    if not raw_data:
        return {"error": "未找到指定的会话记录"}

    file_meta = {"id": file_id, "name": raw_data.get("name", "Untitled")}
    target = parse_prompt_json(file_meta, raw_data)
    if not target:
        return {"error": "解析会话数据失败"}

    return {
        "file_id": target.file_id,
        "name": target.name,
        "model": target.model,
        "created_time": target.created_time.isoformat() if target.created_time else None,
        "modified_time": target.modified_time.isoformat() if target.modified_time else None,
        "duration_human": target.duration_human,
        "duration_seconds": target.duration_seconds,
        "turn_count": target.turn_count,
        "total_tokens": target.total_tokens,
        "thought_tokens": target.thought_tokens,
        "total_user_chars": target.total_user_chars,
        "has_branching": target.has_branching,
        "branch_count": target.branch_count,
        "system_instruction": target.system_instruction,
        "turns": [
            {
                "role": t.role,
                "text": t.text,
                "token_count": t.token_count,
                "is_thought": t.is_thought,
                "payload_type": t.payload_type,
                "timestamp": t.timestamp.isoformat() if t.timestamp else None,
                "is_edited": t.is_edited,
            }
            for t in target.turns
        ],
    }


@router.post("/sync")
def trigger_sync(
    background_tasks: BackgroundTasks, limit: int = 50, all_files: bool = False
):
    """异步触发云端增量同步任务"""
    if sync_status["is_syncing"]:
        return {"status": "busy", "message": "增量同步正在进行中，请勿重复触发"}

    background_tasks.add_task(_run_sync_task, limit=limit, all_files=all_files)
    mode_text = "全量" if all_files else f"最近 {limit} 条"
    return {"status": "started", "message": f"后台已启动云盘增量拉取 ({mode_text})"}


@router.get("/sync/status")
def get_sync_status():
    """查询后台同步进度状态"""
    return sync_status


@router.get("/sync/events")
async def sync_events(request: Request):
    """SSE 事件流通道：实时下发同步进度与完成广播"""
    queue: asyncio.Queue = asyncio.Queue()
    _sync_event_queues.add(queue)

    async def event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield f"event: {msg['event']}\ndata: {json.dumps(msg['data'], ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    # 心跳保持
                    yield ": ping\n\n"
        finally:
            _sync_event_queues.discard(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/export/csv")
def export_csv(range: str = "all"):
    """导出指定时间范围的会话指标明细 CSV"""
    all_sessions = _ensure_sessions_loaded()
    filtered = filter_sessions_by_range(all_sessions, range)
    if not filtered:
        return {"error": "当前时间范围内无可导出会话"}
    tmp_path = os.path.join(tempfile.gettempdir(), f"prompts_summary_{range}.csv")
    export_prompts_summary_csv(filtered, tmp_path)
    return FileResponse(
        path=tmp_path,
        filename=f"prompts_summary_{range}.csv",
        media_type="text/csv",
    )


@router.get("/export/jsonl")
def export_jsonl(range: str = "all"):
    """导出指定时间范围的首轮提问清洗集 JSONL"""
    all_sessions = _ensure_sessions_loaded()
    filtered = filter_sessions_by_range(all_sessions, range)
    if not filtered:
        return {"error": "当前时间范围内无可导出会话"}
    tmp_path = os.path.join(
        tempfile.gettempdir(), f"first_prompts_{range}_for_clustering.jsonl"
    )
    export_first_prompts_to_jsonl(filtered, tmp_path)
    return FileResponse(
        path=tmp_path,
        filename=f"first_prompts_{range}_for_clustering.jsonl",
        media_type="application/jsonlines",
    )