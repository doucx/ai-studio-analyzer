import asyncio
import json
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Set
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from src.analyzer.cache import SQLiteCache
from src.analyzer.drive import DriveClient, PROXY_URL
from src.analyzer.metrics import calculate_session_metrics
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
    range_start = _get_range_start_iso(range)
    indices = cache.query_indices(range_start_iso=range_start)
    return calculate_session_metrics(indices)


@router.get("/sessions")
def list_sessions(range: str = "all", limit: Optional[int] = None):
    """
    基于 session_index 极速返回会话列表，供前端 5000+ 虚拟滚动使用（耗时 <15ms）。
    """
    range_start = _get_range_start_iso(range)
    indices = cache.query_indices(range_start_iso=range_start, limit=limit)
    return [
        {
            "file_id": idx["file_id"],
            "name": idx["name"],
            "model": idx["model"],
            "turn_count": idx["turn_count"],
            "chunk_count": idx["turn_count"],
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


@router.get("/sessions/search")
def search_sessions(q: str, limit: int = 50, offset: int = 0):
    """基于 SQLite FTS5 全文索引的高性能深度检索接口 (声明于 /sessions/{file_id} 前避免被拦截)"""
    return cache.search_fts(query=q, limit=limit, offset=offset)


@router.get("/sessions/{file_id}")
def get_session_detail(file_id: str):
    """
    按需从 file_cache 仅读取并解析单个会话的详细对话轮次（耗时 <1ms）
    """
    raw_data = cache.get(file_id)
    if not raw_data:
        raise HTTPException(status_code=404, detail="未找到指定的会话记录")

    file_meta = {"id": file_id, "name": raw_data.get("name", "Untitled")}
    target = parse_prompt_json(file_meta, raw_data)
    if not target:
        raise HTTPException(status_code=500, detail="解析会话数据失败")

    return {
        "file_id": target.file_id,
        "name": target.name,
        "model": target.model,
        "created_time": target.created_time.isoformat()
        if target.created_time
        else None,
        "modified_time": target.modified_time.isoformat()
        if target.modified_time
        else None,
        "duration_human": target.duration_human,
        "duration_seconds": target.duration_seconds,
        "turn_count": target.turn_count,
        "chunk_count": target.chunk_count,
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
                "extra_metadata": t.extra_metadata,
            }
            for t in target.turns
        ],
    }


@router.post("/reindex")
def reindex_cache():
    """基于本地 SQLite file_cache 极速重建 session_index 及 session_fts"""
    # 1. 一次性获取所有 file_id 并立即释放读锁，保证后续 WAL 可被截断
    file_ids = []
    with cache._get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT file_id FROM file_cache;")
        file_ids = [row["file_id"] for row in cursor.fetchall()]

    # 2. 清空旧索引表与 FTS 虚表，避免循环中触发单条全表扫描与巨量 DELETE 操作
    cache.clear_indices()

    count = 0
    for file_id in file_ids:
        raw_data = cache.get(file_id)
        if not raw_data:
            continue

        file_meta = {
            "id": file_id,
            "modifiedTime": raw_data.get("modifiedTime"),
            "name": raw_data.get("name", "Untitled"),
        }
        session = parse_prompt_json(file_meta, raw_data)
        if session:
            cache.upsert_session_index(session)
            cache.upsert_session_fts(session)
            count += 1

            # 3. 每处理 500 条主动触发一次 Checkpoint，平抑 WAL 体积
            if count % 500 == 0:
                try:
                    cache.checkpoint(truncate=False)
                except Exception:
                    pass

    # 4. 彻底合并 WAL 并进行磁盘空间整理
    try:
        cache.checkpoint(truncate=True)
        cache.vacuum()
    except Exception as exc:
        print(f"⚠️ Reindex Checkpoint/Vacuum 异常: {exc}")

    return {"status": "success", "reindexed_count": count}


@router.get("/sessions/{file_id}/raw")
def get_session_raw(file_id: str):
    """
    导出原始 Google AI Studio 缓存 JSON 格式数据便于调试 (带缩进格式化)
    """
    raw_data = cache.get(file_id)
    if not raw_data:
        return {"error": "未找到指定的会话记录"}
    formatted_json = json.dumps(raw_data, indent=2, ensure_ascii=False)
    return Response(
        content=formatted_json,
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{file_id}.json"'},
    )


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
