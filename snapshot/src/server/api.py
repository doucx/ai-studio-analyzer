import json
import os
import tempfile
from typing import Optional
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
from src.analyzer.sync import fetch_remote_files

router = APIRouter(prefix="/api")
cache = SQLiteCache(cache_dir=".cache")
SNAPSHOT_PATH = os.path.join(cache.cache_dir, "dashboard_snapshot.json")

# 全局后台增量同步状态
sync_status = {"is_syncing": False, "last_result": None, "error": None}

# 内存全局热缓存
_MEM_METRICS = None
_MEM_SESSIONS = None


def _load_snapshot_from_disk():
    """服务冷启动时，优先从磁盘快照极速恢复"""
    global _MEM_METRICS, _MEM_SESSIONS
    if os.path.exists(SNAPSHOT_PATH):
        try:
            with open(SNAPSHOT_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                _MEM_METRICS = data.get("metrics")
                _MEM_SESSIONS = data.get("sessions")
        except Exception:
            pass


_load_snapshot_from_disk()


def _recalculate_and_snapshot():
    """在后台执行全量指标与会话计算，并同步到内存与磁盘快照"""
    global _MEM_METRICS, _MEM_SESSIONS
    sessions = load_cached_sessions(cache, limit=0, show_progress=False)
    if not sessions:
        _MEM_METRICS = {"total_sessions": 0, "message": "暂无已缓存会话，请先执行同步"}
        _MEM_SESSIONS = []
        return

    _MEM_METRICS = calculate_session_metrics(sessions)

    # 按照最后修改时间降序排序
    sorted_sessions = sorted(
        sessions,
        key=lambda s: s.modified_time.isoformat() if s.modified_time else "",
        reverse=True,
    )
    _MEM_SESSIONS = [
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
        for s in sorted_sessions[:100]
    ]

    try:
        with open(SNAPSHOT_PATH, "w", encoding="utf-8") as f:
            json.dump(
                {"metrics": _MEM_METRICS, "sessions": _MEM_SESSIONS},
                f,
                ensure_ascii=False,
            )
    except Exception:
        pass


def _run_sync_task(limit: Optional[int], all_files: bool):
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
        # 同步有数据下载或内存尚未预热时触发重算与快照更新
        if downloaded > 0 or _MEM_METRICS is None:
            _recalculate_and_snapshot()
    except Exception as exc:
        sync_status["error"] = str(exc)
    finally:
        sync_status["is_syncing"] = False


@router.get("/metrics")
def get_metrics():
    """纯内存秒级读取全量指标"""
    global _MEM_METRICS
    if _MEM_METRICS is None:
        _recalculate_and_snapshot()
    return _MEM_METRICS or {"total_sessions": 0, "message": "暂无已缓存会话，请先执行同步"}


@router.get("/sessions")
def list_sessions(limit: int = 50):
    """纯内存秒级读取按修改时间排序的会话列表摘要"""
    global _MEM_SESSIONS
    if _MEM_SESSIONS is None:
        _recalculate_and_snapshot()
    return (_MEM_SESSIONS or [])[:limit]


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
def export_csv():
    """导出全量会话指标明细 CSV"""
    sessions = load_cached_sessions(cache, limit=0, show_progress=False)
    if not sessions:
        return {"error": "暂无可导出会话"}
    tmp_path = os.path.join(tempfile.gettempdir(), "prompts_summary.csv")
    export_prompts_summary_csv(sessions, tmp_path)
    return FileResponse(
        path=tmp_path,
        filename="prompts_summary.csv",
        media_type="text/csv",
    )


@router.get("/export/jsonl")
def export_jsonl():
    """导出首轮提问清洗集 JSONL (用于聚类与反思)"""
    sessions = load_cached_sessions(cache, limit=0, show_progress=False)
    if not sessions:
        return {"error": "暂无可导出会话"}
    tmp_path = os.path.join(tempfile.gettempdir(), "first_prompts_for_clustering.jsonl")
    export_first_prompts_to_jsonl(sessions, tmp_path)
    return FileResponse(
        path=tmp_path,
        filename="first_prompts_for_clustering.jsonl",
        media_type="application/jsonlines",
    )