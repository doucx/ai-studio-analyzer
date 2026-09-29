import asyncio
import json
import logging
import os
import sqlite3
import time
from datetime import UTC, datetime, timedelta

import requests
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

logger = logging.getLogger(__name__)

from src.analyzer.cache import SQLiteCache
from src.analyzer.config import load_config, save_config, test_proxy_connection
from src.analyzer.drive import DriveClient
from src.analyzer.metrics import calculate_session_metrics
from src.analyzer.parser import parse_prompt_json
from src.analyzer.sync import fetch_remote_files

router = APIRouter(prefix="/api")
cache = SQLiteCache(cache_dir=".cache")


def _format_seconds_human(total_sec: float) -> str:
    total_sec = int(total_sec)
    if total_sec < 60:
        return f"{total_sec}s"
    hours, remainder = divmod(total_sec, 3600)
    minutes, _ = divmod(remainder, 60)
    parts = []
    if hours > 0:
        parts.append(f"{hours}h")
    if minutes > 0:
        parts.append(f"{minutes}m")
    if not parts:
        parts.append("0m")
    return " ".join(parts)


# 全局后台增量同步状态
sync_status = {"is_syncing": False, "last_result": None, "error": None}

# SSE 订阅客户端队列池
_sync_event_queues: set[asyncio.Queue] = set()


def notify_sync_event(event_type: str, payload: dict):
    """向所有在线前端推送 SSE 事件"""
    for q in list(_sync_event_queues):
        try:
            q.put_nowait({"event": event_type, "data": payload})
        except (asyncio.QueueFull, ValueError) as err:
            logger.debug("广播 SSE 队列已满或异常: %s", err)


def _resolve_time_bounds(
    range_key: str = "all",
    start_date: str | None = None,
    end_date: str | None = None,
) -> tuple[str | None, str | None, str | None, str | None]:
    """
    解析时间范围边界：
    如果提供了显式的 start_date/end_date (YYYY-MM-DD)，优先作为日历闭区间；
    否则按相对枚举解析 (start_iso, end_iso, start_date, end_date)。
    """
    if start_date or end_date:
        return None, None, start_date, end_date

    if range_key == "all":
        return None, None, None, None

    now = datetime.now(UTC)
    today_local = datetime.now().astimezone().strftime("%Y-%m-%d")

    if range_key == "1d":
        start_dt = now - timedelta(days=1)
        return start_dt.isoformat(), None, None, None
    if range_key == "7d":
        start_d = (datetime.now().astimezone() - timedelta(days=7)).strftime("%Y-%m-%d")
        return None, None, start_d, today_local
    if range_key == "30d":
        start_d = (datetime.now().astimezone() - timedelta(days=30)).strftime(
            "%Y-%m-%d"
        )
        return None, None, start_d, today_local
    if range_key == "90d":
        start_d = (datetime.now().astimezone() - timedelta(days=90)).strftime(
            "%Y-%m-%d"
        )
        return None, None, start_d, today_local
    if range_key == "this_year":
        this_year_start = f"{datetime.now().year}-01-01"
        return None, None, this_year_start, today_local

    return None, None, None, None


def _run_sync_task(limit: int | None, all_files: bool):
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


@router.get("/daily/timeline")
def get_daily_timeline(days: int | None = None):
    """
    按本地日历日期聚合返回所有会话的每日时间线 (一次性拉取，规避 N+1 轮询)。
    若会话包含跨多个自然日的交互 Chunk，自动派发到每一天的记录中，并将总耗时平均分摊。
    """
    indices = cache.query_indices()
    local_tz = datetime.now().astimezone().tzinfo

    timeline: dict[str, dict] = {}

    for idx in indices:
        file_id = idx["file_id"]

        # 从索引的物化列直接读取跨日映射，彻底免除 N+1 原始 JSON 反序列化
        date_time_map: dict[str, str] = {}
        active_dates_str = idx.get("active_dates")

        if active_dates_str:
            try:
                date_time_map = json.loads(active_dates_str)
            except (json.JSONDecodeError, TypeError) as err:
                logger.debug("解析 active_dates 失败: %s", err)

        # 兼容尚未重建索引的旧数据兜底
        if not date_time_map:
            mtime_str = idx["modified_time"] or idx["created_time"]
            if mtime_str:
                try:
                    dt_utc = datetime.fromisoformat(mtime_str)
                    dt_local = dt_utc.astimezone(local_tz)
                    date_time_map[dt_local.strftime("%Y-%m-%d")] = dt_local.strftime(
                        "%H:%M"
                    )
                except (ValueError, TypeError, OverflowError) as err:
                    logger.debug("解析 mtime 兼容日期失败: %s", err)

        if not date_time_map:
            continue

        # 2. 均分耗时与消耗
        total_dur_sec = idx.get("duration_seconds") or 0.0
        days_count = max(1, len(date_time_map))
        split_dur_sec = total_dur_sec / days_count

        dur_label = _format_seconds_human(split_dur_sec)
        if days_count > 1:
            dur_label = f"{dur_label} (跨{days_count}天均分)"

        total_tok = idx.get("total_tokens", 0)
        thought_tok = idx.get("thought_tokens", 0)

        # 3. 分发到各天的 timeline
        for date_key, time_local in date_time_map.items():
            if date_key not in timeline:
                timeline[date_key] = {
                    "date": date_key,
                    "total_duration_seconds": 0.0,
                    "total_tokens": 0,
                    "thought_tokens": 0,
                    "session_count": 0,
                    "sessions": [],
                }

            timeline[date_key]["total_duration_seconds"] += split_dur_sec
            timeline[date_key]["total_tokens"] += total_tok // days_count
            timeline[date_key]["thought_tokens"] += thought_tok // days_count
            timeline[date_key]["session_count"] += 1

            timeline[date_key]["sessions"].append(
                {
                    "file_id": file_id,
                    "name": idx["name"],
                    "model": idx["model"].replace("models/", ""),
                    "duration": dur_label,
                    "duration_seconds": split_dur_sec,
                    "tokens": total_tok,
                    "thought_tokens": thought_tok,
                    "first_prompt": idx.get("first_prompt") or "",
                    "time_local": time_local,
                    "cross_days": days_count,
                }
            )

    sorted_dates = sorted(timeline.keys(), reverse=True)
    if days and days > 0:
        sorted_dates = sorted_dates[:days]

    result = {}
    for d in sorted_dates:
        item = timeline[d]
        item["total_duration_human"] = _format_seconds_human(
            item["total_duration_seconds"]
        )
        item["sessions"].sort(key=lambda s: s.get("time_local", ""), reverse=True)
        result[d] = item

    return {"date_timeline": result}


@router.get("/daily/today")
def get_daily_today():
    """
    获取今天（本地日历）的交互场次、总心智耗时与能耗切片。
    """
    today_str = datetime.now().astimezone().strftime("%Y-%m-%d")
    timeline_resp = get_daily_timeline()
    today_item = timeline_resp["date_timeline"].get(
        today_str,
        {
            "date": today_str,
            "total_duration_seconds": 0.0,
            "total_duration_human": "0m",
            "total_tokens": 0,
            "thought_tokens": 0,
            "session_count": 0,
            "sessions": [],
        },
    )
    return today_item


@router.get("/metrics")
def get_metrics(
    range: str = "all",
    start: str | None = None,
    end: str | None = None,
):
    """
    基于 session_index 表毫秒级聚合认知与交互指标，支持精确闭区间。
    """
    start_iso, end_iso, start_d, end_d = _resolve_time_bounds(range, start, end)
    indices = cache.query_indices(
        range_start_iso=start_iso,
        range_end_iso=end_iso,
        start_date=start_d,
        end_date=end_d,
    )
    return calculate_session_metrics(indices)


@router.get("/sessions")
def list_sessions(
    range: str = "all",
    start: str | None = None,
    end: str | None = None,
    model: str | None = None,
    depth: str | None = None,
    limit: int | None = None,
):
    """
    基于 session_index 极速返回会话列表，支持下推精确日期、模型与深度过滤。
    """
    start_iso, end_iso, start_d, end_d = _resolve_time_bounds(range, start, end)
    indices = cache.query_indices(
        range_start_iso=start_iso,
        range_end_iso=end_iso,
        start_date=start_d,
        end_date=end_d,
        model=model,
        depth=depth,
        limit=limit,
    )
    return [
        {
            "file_id": idx["file_id"],
            "name": idx["name"],
            "model": idx["model"],
            "turn_count": idx["turn_count"],
            "chunk_count": idx["turn_count"],
            "total_tokens": idx["total_tokens"],
            "cumulative_tokens": idx.get("cumulative_tokens") or idx["total_tokens"],
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


def _extract_rg_matches(
    raw_data: dict,
    query: str,
    context_lines: int = 2,
    max_matches: int = 1,
) -> list[dict]:
    """从原始会话中提取包含搜索词的 turn 及其类似 rg -C 上下文"""
    if not raw_data or not query:
        return []

    chunks = raw_data.get("chunkedPrompt", {}).get("chunks", [])
    if not chunks and "contents" in raw_data:
        chunks = []
        for c in raw_data.get("contents", []):
            parts = c.get("parts", [])
            text = "\n".join(p.get("text", "") for p in parts if "text" in p)
            chunks.append({"role": c.get("role", "user"), "text": text})

    terms = [term for term in query.strip().split() if term]
    if not terms:
        return []

    matches = []
    for idx, c in enumerate(chunks):
        role = c.get("role", "user")
        is_thought = bool(c.get("isThought", False))
        text = c.get("text", "") or ""

        text_lower = text.lower()
        matched_term = next((t for t in terms if t.lower() in text_lower), None)
        if not matched_term:
            continue

        lines = text.splitlines()
        hit_indices = [
            i for i, line in enumerate(lines) if any(t.lower() in line.lower() for t in terms)
        ]
        if not hit_indices:
            continue

        hit_idx = hit_indices[0]
        start_line = max(0, hit_idx - context_lines)
        end_line = min(len(lines), hit_idx + context_lines + 1)

        line_items = []
        for l_num in range(start_line, end_line):
            is_hit = l_num in hit_indices
            raw_line = lines[l_num]
            display_line = raw_line
            for t in terms:
                pos = display_line.lower().find(t.lower())
                if pos >= 0:
                    matched_slice = display_line[pos : pos + len(t)]
                    display_line = (
                        display_line[:pos]
                        + f'<mark class="bg-indigo-500/40 text-indigo-200 font-semibold px-0.5 rounded">{matched_slice}</mark>'
                        + display_line[pos + len(t) :]
                    )

            line_items.append({
                "line_no": l_num + 1,
                "is_hit": is_hit,
                "text": display_line,
            })

        sibling_preview = None
        if role == "user" and idx + 1 < len(chunks):
            next_t = chunks[idx + 1].get("text", "") or ""
            if next_t.strip():
                sibling_preview = {
                    "role": chunks[idx + 1].get("role", "model"),
                    "text": next_t.strip().replace("\n", " ")[:90],
                }
        elif role == "model" and idx > 0:
            prev_t = chunks[idx - 1].get("text", "") or ""
            if prev_t.strip():
                sibling_preview = {
                    "role": chunks[idx - 1].get("role", "user"),
                    "text": prev_t.strip().replace("\n", " ")[:90],
                }

        role_display = "thinking" if is_thought else role
        matches.append({
            "turn_index": idx + 1,
            "role": role_display,
            "lines": line_items,
            "sibling": sibling_preview,
        })

        if len(matches) >= max_matches:
            break

    return matches


@router.get("/sessions/search")
def search_sessions(
    q: str,
    range: str = "all",
    start: str | None = None,
    end: str | None = None,
    model: str | None = None,
    depth: str | None = None,
    scope: str = "range",
    limit: int = 50,
    offset: int = 0,
):
    """
    基于 SQLite FTS5 全文索引的高性能深度检索接口，支持范围筛选与全库穿透 (scope=all)。
    """
    if scope == "all":
        start_iso, end_iso, start_d, end_d = None, None, None, None
    else:
        start_iso, end_iso, start_d, end_d = _resolve_time_bounds(range, start, end)

    results = cache.search_fts(
        query=q,
        limit=limit,
        offset=offset,
        range_start_iso=start_iso,
        range_end_iso=end_iso,
        start_date=start_d,
        end_date=end_d,
        model=model,
        depth=depth,
    )

    if q and results:
        for item in results:
            fid = item.get("file_id")
            raw_data = cache.get(fid) if fid else None
            if raw_data:
                item["search_matches"] = _extract_rg_matches(
                    raw_data, q, context_lines=2, max_matches=1
                )
            else:
                item["search_matches"] = []

    return results


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
        "cumulative_tokens": target.cumulative_api_tokens,
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
                except sqlite3.Error as err:
                    logger.debug("Reindex 阶段性 Checkpoint 失败: %s", err)

    # 4. 彻底合并 WAL 并进行磁盘空间整理
    try:
        cache.checkpoint(truncate=True)
        cache.vacuum()
    except sqlite3.Error as exc:
        print(f"⚠️ Reindex Checkpoint/Vacuum 异常: {exc}")

    return {"status": "success", "reindexed_count": count}


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
                except TimeoutError:
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


# -------------------------------------------------------------
# 系统维护与深度诊断中心 (Maintenance & Diagnostics Ops API)
# -------------------------------------------------------------

from src.analyzer.ops import (
    get_health_diagnostics,
    get_schema_diagnostics,
    ops_runner,
    run_reindex_task,
    run_sync_task,
)


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
