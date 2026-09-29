"""
系统配置、网络代理检测与轻量增量同步路由
"""

import asyncio
import json
import logging
import sqlite3

import requests
from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import StreamingResponse

from src.analyzer.config import load_config, save_config, test_proxy_connection
from src.analyzer.drive import DriveClient
from src.analyzer.ops import ops_runner
from src.analyzer.sync import fetch_remote_files
from src.server.routers.common import cache

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Settings & Sync"])

sync_status = {"is_syncing": False, "last_result": None, "error": None}
sync_event_queues: set[asyncio.Queue] = set()


def notify_sync_event(event_type: str, payload: dict):
    for q in list(sync_event_queues):
        try:
            q.put_nowait({"event": event_type, "data": payload})
        except (asyncio.QueueFull, ValueError) as err:
            logger.debug("广播 SSE 队列已满或异常: %s", err)


def run_sync_task(limit: int | None, all_files: bool):
    if ops_runner.is_busy():
        logger.info("检测到当前有受控运维任务正在执行，放弃本次后台增量同步。")
        return

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
        client = DriveClient()
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
    except (
        RuntimeError,
        OSError,
        sqlite3.Error,
        requests.RequestException,
        ValueError,
    ) as exc:
        sync_status["error"] = str(exc)
        notify_sync_event("sync_error", {"error": str(exc)})
    finally:
        sync_status["is_syncing"] = False


@router.get("/settings")
def get_settings():
    """获取当前系统运行配置"""
    return load_config()


@router.post("/settings")
def update_settings(payload: dict):
    """更新并持久化系统运行配置"""
    updated = save_config(payload)
    return {"status": "success", "config": updated}


@router.post("/settings/test-proxy")
def test_proxy(payload: dict):
    """测试指定代理与 Google 服务的连通性"""
    proxy_url = payload.get("proxy_url", "")
    return test_proxy_connection(proxy_url)


@router.post("/sync")
def trigger_sync(
    background_tasks: BackgroundTasks, limit: int = 50, all_files: bool = False
):
    """异步触发云端增量同步任务"""
    if ops_runner.is_busy():
        return {
            "status": "busy",
            "message": f"系统正在执行核心运维任务 [{ops_runner.current_task or '系统重整'}]，已自动挂起日常增量同步",
        }

    if sync_status["is_syncing"]:
        return {"status": "busy", "message": "增量同步正在进行中，请勿重复触发"}

    background_tasks.add_task(run_sync_task, limit=limit, all_files=all_files)
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
    sync_event_queues.add(queue)

    async def event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield f"event: {msg['event']}\ndata: {json.dumps(msg['data'], ensure_ascii=False)}\n\n"
                except TimeoutError:
                    yield ": ping\n\n"
        finally:
            sync_event_queues.discard(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
