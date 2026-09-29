"""
系统维护、WAL Checkpoint、VACUUM 与全盘深度健康诊断路由
"""

import asyncio
import json
import os
import sqlite3
import time

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import StreamingResponse

from src.analyzer.drive import DriveClient
from src.analyzer.ops import (
    get_health_diagnostics,
    get_schema_diagnostics,
    ops_runner,
    run_reindex_task,
    run_sync_task,
)
from src.analyzer.parser import parse_prompt_json
from src.server.routers.common import cache

router = APIRouter(tags=["Operations & Diagnostics"])


@router.post("/reindex")
def reindex_cache_quick():
    """基于本地 SQLite file_cache 快速重建 session_index 及 session_fts"""
    with cache._get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT file_id FROM file_cache;")
        file_ids = [row["file_id"] for row in cursor.fetchall()]

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
            if count % 500 == 0:
                try:
                    cache.checkpoint(truncate=False)
                except sqlite3.Error:
                    pass

    try:
        cache.checkpoint(truncate=True)
        cache.vacuum()
    except sqlite3.Error:
        pass

    return {"status": "success", "reindexed_count": count}


@router.get("/ops/status")
def get_ops_status():
    """获取当前运维引擎状态"""
    return {
        "is_busy": ops_runner.is_busy(),
        "current_task": ops_runner.current_task,
        "current_job_id": ops_runner.current_job_id,
        "cancel_requested": ops_runner.cancel_requested,
    }


@router.post("/ops/reindex")
def trigger_ops_reindex(
    background_tasks: BackgroundTasks,
    batch_size: int = 300,
    vacuum: bool = True,
):
    """触发二级索引与 FTS 重建任务 (互斥受控)"""
    job_id = f"reindex-{int(time.time())}"
    if not ops_runner.acquire_job("reindex", job_id):
        raise HTTPException(
            status_code=409, detail="当前有正在运行的运维任务，请稍后或先中止它"
        )

    background_tasks.add_task(
        run_reindex_task,
        cache=cache,
        job_id=job_id,
        batch_size=batch_size,
        vacuum=vacuum,
    )
    return {"status": "accepted", "job_id": job_id, "task": "reindex"}


@router.post("/ops/sync")
def trigger_ops_sync(
    background_tasks: BackgroundTasks,
    limit: int = 50,
    all_files: bool = False,
):
    """触发 Google Drive 云端同步 (支持全量与增量，带 SSE 日志流)"""
    job_id = f"sync-{int(time.time())}"
    if not ops_runner.acquire_job("sync", job_id):
        raise HTTPException(
            status_code=409, detail="当前有正在运行的运维任务，请稍后或先中止它"
        )

    client = DriveClient()
    background_tasks.add_task(
        run_sync_task,
        client=client,
        cache=cache,
        job_id=job_id,
        limit=limit,
        all_files=all_files,
    )
    return {"status": "accepted", "job_id": job_id, "task": "sync"}


@router.post("/ops/wal-checkpoint")
def trigger_wal_checkpoint(truncate: bool = True):
    """手动执行 WAL 日志截断与主库合并"""
    if ops_runner.is_busy():
        raise HTTPException(
            status_code=409, detail="当前有正在运行的运维任务，无法执行写锁操作"
        )
    try:
        busy, log_pages, ckpt_pages = cache.checkpoint(truncate=truncate)
        return {
            "ok": True,
            "busy": bool(busy),
            "log_pages": log_pages,
            "checkpointed_pages": ckpt_pages,
            "message": "WAL Checkpoint 执行完毕",
        }
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail=f"Checkpoint 失败: {exc}")


@router.post("/ops/vacuum")
def trigger_database_vacuum():
    """手动执行 SQLite VACUUM 磁盘空间重构与压缩"""
    if ops_runner.is_busy():
        raise HTTPException(
            status_code=409, detail="当前有正在运行的运维任务，无法执行排他写锁操作"
        )

    db_path = cache.db_path
    before_size = os.path.getsize(db_path) if os.path.exists(db_path) else 0
    t0 = time.time()
    try:
        cache.vacuum()
        after_size = os.path.getsize(db_path) if os.path.exists(db_path) else 0
        freed = max(0, before_size - after_size)
        return {
            "ok": True,
            "before_size": before_size,
            "after_size": after_size,
            "freed_bytes": freed,
            "freed_human": f"{freed / (1024 * 1024):.2f} MB",
            "duration_seconds": round(time.time() - t0, 2),
        }
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail=f"VACUUM 失败: {exc}")


@router.post("/ops/diagnostics/health")
def run_health_check():
    """手动触发系统物理与逻辑健康度诊断"""
    try:
        return get_health_diagnostics(cache_dir=cache.cache_dir)
    except (sqlite3.Error, FileNotFoundError, OSError, ValueError) as exc:
        raise HTTPException(status_code=500, detail=f"健康度诊断失败: {exc}") from exc


@router.post("/ops/diagnostics/schema")
def run_schema_check(sample_limit: int | None = None):
    """手动触发数据 Schema 骨架与载荷采样诊断"""
    try:
        return get_schema_diagnostics(
            cache_dir=cache.cache_dir, sample_limit=sample_limit
        )
    except (sqlite3.Error, FileNotFoundError, OSError, ValueError) as exc:
        raise HTTPException(
            status_code=500, detail=f"Schema 采样诊断失败: {exc}"
        ) from exc


@router.post("/ops/{job_id}/abort")
def abort_ops_job(job_id: str):
    """优雅中断正在执行的长任务"""
    if ops_runner.request_abort(job_id):
        return {"status": "abort_requested", "job_id": job_id}
    raise HTTPException(
        status_code=404, detail="未找到正在执行的匹配 Job ID，可能已结束"
    )


@router.get("/ops/stream/{job_id}")
async def ops_stream(job_id: str, request: Request):
    """运维专属 SSE 广播长通道"""
    queue: asyncio.Queue = asyncio.Queue()
    ops_runner.subscribe(job_id, queue)

    async def event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=12.0)
                    yield f"event: {msg['event']}\ndata: {json.dumps(msg['data'], ensure_ascii=False)}\n\n"
                    if msg["event"] in ("done", "error", "aborted"):
                        break
                except TimeoutError:
                    yield ": ping\n\n"
        finally:
            ops_runner.unsubscribe(job_id, queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
