import os
import tempfile
from datetime import datetime, timedelta, timezone
from typing import Optional, List
from fastapi import APIRouter, BackgroundTasks
from fastapi.responses import FileResponse
from src.analyzer.cache import SQLiteCache
from src.analyzer.drive import DriveClient, PROXY_URL
from src.analyzer.exporter import (
    export_first_prompts_to_jsonl,
    export_prompts_summary_csv,
)
from src.analyzer.loader import load_cached_sessions
from src.analyzer.metrics import calculate_session_metrics
from src.analyzer.models import PromptSession
from src.analyzer.sync import fetch_remote_files

router = APIRouter(prefix="/api")
cache = SQLiteCache(cache_dir=".cache")

# 全局后台增量同步状态
sync_status = {"is_syncing": False, "last_result": None, "error": None}

# 内存常驻已反序列化的全量会话对象池
_ALL_SESSIONS: Optional[List[PromptSession]] = None


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
    global _ALL_SESSIONS
    sync_status["is_syncing"] = True
    sync_status["error"] = None
    try:
        client = DriveClient(proxy_url=PROXY_URL)
        total, hits, downloaded = fetch_remote_files(
            client=client, cache=cache, limit=limit, all_files=all_files
        )
        sync_status["last_result"] = {
            "total_scanned": total,
            "cache_hits": hits,
            "downloaded": downloaded,
            "cache_total": cache.count(),
        }
        # 如果有新下载内容，重新加载内存常驻会话池
        if downloaded > 0 or _ALL_SESSIONS is None:
            _ALL_SESSIONS = load_cached_sessions(cache, limit=0, show_progress=False)
    except Exception as exc:
        sync_status["error"] = str(exc)
    finally:
        sync_status["is_syncing"] = False


@router.get("/metrics")
def get_metrics(range: str = "all"):
    """
    基于内存常驻会话，极速按时间窗口投影指标计算。
    支持 range: '7d' | '30d' | '90d' | 'this_year' | 'all'
    """
    all_sessions = _ensure_sessions_loaded()
    filtered = filter_sessions_by_range(all_sessions, range)
    return calculate_session_metrics(filtered)


@router.get("/sessions")
def list_sessions(range: str = "all", limit: int = 50):
    """
    按时间窗口过滤后，返回按最后修改时间倒序的会话列表摘要
    """
    all_sessions = _ensure_sessions_loaded()
    filtered = filter_sessions_by_range(all_sessions, range)
    sorted_sessions = sorted(
        filtered,
        key=lambda s: s.modified_time.isoformat() if s.modified_time else "",
        reverse=True,
    )
    return [
        {
            "file_id": s.file_id,
            "name": s.name,
            "model": s.model,
            "turn_count": s.turn_count,
            "total_tokens": s.total_tokens,
            "thought_tokens": s.thought_tokens,
            "duration_human": s.duration_human,
            "duration_seconds": s.duration_seconds,
            "has_branching": s.has_branching,
            "branch_count": s.branch_count,
            "first_prompt": s.user_prompts[0] if s.user_prompts else "",
            "modified_time": s.modified_time.isoformat() if s.modified_time else None,
            "created_time": s.created_time.isoformat() if s.created_time else None,
        }
        for s in sorted_sessions[:limit]
    ]


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