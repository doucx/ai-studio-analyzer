"""
AI Studio 统一运维调度与诊断分析引擎 (Ops & Diagnostics Engine)
提供任务互斥锁保护、优雅中断感知、终端字符日志与进度回调广播。
"""

import asyncio
import json
import logging
import os
import sqlite3
import threading
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import requests

from src.analyzer.cache import SQLiteCache
from src.analyzer.drive import DriveClient
from src.analyzer.parser import parse_prompt_json
from src.analyzer.sync import fetch_remote_files

logger = logging.getLogger(__name__)


def format_bytes(size: float) -> str:
    for unit in ["B", "KB", "MB", "GB"]:
        if size < 1024.0:
            return f"{size:.2f} {unit}"
        size /= 1024.0
    return f"{size:.2f} TB"


def format_num(n: float) -> str:
    if isinstance(n, int):
        return f"{n:,}"
    return f"{n:,.1f}"


def get_quantiles(values: list[float]) -> dict[str, float]:
    if not values:
        return {"min": 0, "p10": 0, "p50": 0, "p75": 0, "p90": 0, "p99": 0, "max": 0}
    s = sorted(values)
    n = len(s)

    def q(pct: float) -> float:
        idx = int(n * pct)
        return s[min(idx, n - 1)]

    return {
        "min": s[0],
        "p10": q(0.10),
        "p50": q(0.50),
        "p75": q(0.75),
        "p90": q(0.90),
        "p99": q(0.99),
        "max": s[-1],
    }


def truncate_large_content(obj: Any, max_str_len: int = 80) -> Any:
    """递归截断并压缩过长的字段值"""
    if isinstance(obj, str):
        if len(obj) > max_str_len:
            head = obj[: max_str_len // 2]
            tail = obj[-max_str_len // 4 :]
            return f"{head}...[已折叠 {len(obj)} 字符]...{tail}"
        return obj
    elif isinstance(obj, dict):
        return {k: truncate_large_content(v, max_str_len) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [truncate_large_content(item, max_str_len) for item in obj]
    return obj


def get_shape_summary(obj: Any, depth: int = 0, max_depth: int = 2) -> Any:
    """递归提取 JSON 的数据结构拓扑骨架"""
    if depth >= max_depth:
        return type(obj).__name__

    if isinstance(obj, dict):
        return {k: get_shape_summary(v, depth + 1, max_depth) for k, v in obj.items()}
    elif isinstance(obj, list):
        if not obj:
            return "[] (empty)"
        return [get_shape_summary(obj[0], depth + 1, max_depth)]
    else:
        return type(obj).__name__


@dataclass
class OpsJobStatus:
    job_id: str
    task_name: str
    status: str = "running"  # running | done | error | aborted
    start_time: float = field(default_factory=time.time)
    end_time: float | None = None
    progress: dict[str, Any] = field(default_factory=dict)
    summary: dict[str, Any] | None = None
    error: str | None = None


class OpsRunner:
    """管理互斥的重型运维任务执行、取消信号与状态下发"""

    def __init__(self):
        self.lock = threading.Lock()
        self.current_job_id: str | None = None
        self.current_task: str | None = None
        self.cancel_requested = False
        self.job_history: dict[str, OpsJobStatus] = {}
        self.event_queues: dict[str, set[asyncio.Queue]] = defaultdict(set)

    def is_busy(self) -> bool:
        return self.lock.locked()

    def acquire_job(self, task_name: str, job_id: str) -> bool:
        if not self.lock.acquire(blocking=False):
            return False
        self.current_task = task_name
        self.current_job_id = job_id
        self.cancel_requested = False
        self.job_history[job_id] = OpsJobStatus(job_id=job_id, task_name=task_name)
        return True

    def release_job(self):
        self.current_task = None
        self.current_job_id = None
        self.cancel_requested = False
        if self.lock.locked():
            self.lock.release()

    def request_abort(self, job_id: str) -> bool:
        if self.current_job_id == job_id:
            self.cancel_requested = True
            return True
        return False

    def subscribe(self, job_id: str, queue: asyncio.Queue):
        self.event_queues[job_id].add(queue)

    def unsubscribe(self, job_id: str, queue: asyncio.Queue):
        self.event_queues[job_id].discard(queue)
        if not self.event_queues[job_id]:
            self.event_queues.pop(job_id, None)

    def broadcast(self, job_id: str, event_type: str, payload: dict[str, Any]):
        queues = list(self.event_queues.get(job_id, []))
        for q in queues:
            try:
                q.put_nowait({"event": event_type, "data": payload})
            except (asyncio.QueueFull, ValueError):
                pass


ops_runner = OpsRunner()


def emit_log(job_id: str, message: str, level: str = "info"):
    now_str = datetime.now().astimezone().strftime("%H:%M:%S")
    payload = {
        "time": now_str,
        "level": level,
        "message": message,
    }
    ops_runner.broadcast(job_id, "log", payload)


def run_reindex_task(
    cache: SQLiteCache,
    job_id: str,
    batch_size: int = 300,
    vacuum: bool = True,
):
    """带细粒度进度反馈、批次 Checkpoint 与中断支持的索引重建任务"""
    db_path = cache.db_path
    wal_path = f"{db_path}-wal"
    t_start = time.time()

    emit_log(job_id, f"🚀 开始执行索引与全文检索引擎重建 (批次规模: {batch_size})")

    try:
        cache.enter_maintenance_mode()
        # 1. 获取所有待处理的 file_id
        emit_log(job_id, "正在扫描 file_cache 表元数据...")
        with cache._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT file_id, modified_time FROM file_cache;")
            file_records = cursor.fetchall()

        total_files = len(file_records)
        if total_files == 0:
            emit_log(job_id, "file_cache 中未发现任何会话，任务结束。", level="warn")
            ops_runner.broadcast(
                job_id,
                "done",
                {"success": True, "reindexed": 0, "duration": 0},
            )
            return

        emit_log(job_id, f"扫描完成，共有 {total_files} 场会话待重整。")
        emit_log(job_id, "正在清理重置旧版二级索引与 FTS5 全文虚表...")
        cache.clear_indices()
        emit_log(job_id, "旧索引重置完成，开始逐条物化写入...")

        success_count = 0
        failed_count = 0

        for idx, row in enumerate(file_records, start=1):
            if ops_runner.cancel_requested:
                emit_log(
                    job_id,
                    "🛑 接收到任务中断请求，正在执行安全截断并保存已完成进度...",
                    level="warn",
                )
                try:
                    cache.checkpoint(truncate=True)
                except sqlite3.Error as e:
                    emit_log(job_id, f"中断 Checkpoint 异常: {e}", level="warn")

                ops_runner.broadcast(
                    job_id,
                    "aborted",
                    {
                        "reindexed": success_count,
                        "total": total_files,
                        "message": "用户手动中断了索引重建任务",
                    },
                )
                return

            file_id = row["file_id"]
            mtime = row["modified_time"]
            raw_data = cache.get(file_id)

            if raw_data:
                file_meta = {
                    "id": file_id,
                    "modifiedTime": mtime or raw_data.get("modifiedTime"),
                    "name": raw_data.get("name", "Untitled"),
                }
                try:
                    session = parse_prompt_json(file_meta, raw_data)
                    if session:
                        cache.upsert_session_index(session)
                        cache.upsert_session_fts(session)
                        success_count += 1
                    else:
                        failed_count += 1
                except (
                    sqlite3.Error,
                    json.JSONDecodeError,
                    ValueError,
                    KeyError,
                    TypeError,
                ) as ex:
                    logger.debug("解析会话失败: %s", ex)
                    failed_count += 1
            else:
                failed_count += 1

            # 周期性平抑 WAL 并上报进度
            if idx % batch_size == 0 or idx == total_files:
                try:
                    cache.checkpoint(truncate=False)
                except sqlite3.Error as err:
                    logger.debug("批次 Checkpoint 失败: %s", err)

                wal_bytes = os.path.getsize(wal_path) if os.path.exists(wal_path) else 0
                now = time.time()
                elapsed = max(0.001, now - t_start)
                speed = idx / elapsed
                pct = round((idx / total_files) * 100, 1)

                progress_data = {
                    "current": idx,
                    "total": total_files,
                    "percent": pct,
                    "speed": f"{speed:.1f} it/s",
                    "wal_bytes": wal_bytes,
                    "wal_human": format_bytes(wal_bytes),
                    "success": success_count,
                    "failed": failed_count,
                }
                ops_runner.broadcast(job_id, "progress", progress_data)

                if idx % (batch_size * 2) == 0 or idx == total_files:
                    emit_log(
                        job_id,
                        f"已处理 {idx}/{total_files} ({pct}%) | 速率: {speed:.1f} 条/秒 | WAL 体积: {format_bytes(wal_bytes)}",
                    )

        # 最终截断刷盘
        emit_log(job_id, "正在执行最终 WAL Checkpoint (TRUNCATE) 刷盘...")
        busy, _log_pages, ckpt_pages = cache.checkpoint(truncate=True)
        emit_log(job_id, f"Checkpoint 完成 (busy={busy}, pages={ckpt_pages})")

        vacuum_saved = 0
        if vacuum:
            emit_log(job_id, "正在执行 VACUUM 磁盘空间重构与碎片清理...")
            before_size = os.path.getsize(db_path)
            t_vac = time.time()
            cache.vacuum()
            after_size = os.path.getsize(db_path)
            vacuum_saved = max(0, before_size - after_size)
            emit_log(
                job_id,
                f"VACUUM 整理完毕 (耗时: {time.time() - t_vac:.2f}s, 释放磁盘: {format_bytes(vacuum_saved)})",
            )

        total_elapsed = round(time.time() - t_start, 2)
        summary = {
            "success": True,
            "reindexed": success_count,
            "failed": failed_count,
            "total": total_files,
            "duration_seconds": total_elapsed,
            "vacuum_saved_bytes": vacuum_saved,
            "vacuum_saved_human": format_bytes(vacuum_saved),
        }
        emit_log(
            job_id,
            f"🎉 索引重建圆满完成！有效写入 {success_count} 场会话，总耗时 {total_elapsed} 秒。",
        )
        ops_runner.broadcast(job_id, "done", summary)

    except (
        sqlite3.Error,
        RuntimeError,
        OSError,
        ValueError,
        json.JSONDecodeError,
    ) as exc:
        emit_log(job_id, f"❌ 重建异常失败: {exc}", level="error")
        ops_runner.broadcast(job_id, "error", {"error": str(exc)})
    finally:
        cache.exit_maintenance_mode()
        ops_runner.release_job()


def run_sync_task(
    client: DriveClient,
    cache: SQLiteCache,
    job_id: str,
    limit: int | None = 50,
    all_files: bool = False,
):
    """支持控制台实时日志下发的云端同步任务"""
    t0 = time.time()
    mode_text = "全量全库扫描" if all_files else f"最近 {limit} 篇增量拉取"
    emit_log(job_id, f"📥 启动 Google AI Studio 云端同步 ({mode_text})...")

    try:

        def on_progress(cur, total, hits, downloaded):
            if ops_runner.cancel_requested:
                raise InterruptedError("用户中止任务")
            pct = round((cur / total) * 100, 1) if total > 0 else 0
            ops_runner.broadcast(
                job_id,
                "progress",
                {
                    "current": cur,
                    "total": total,
                    "percent": pct,
                    "hits": hits,
                    "downloaded": downloaded,
                },
            )
            if cur % 25 == 0 or cur == total:
                emit_log(
                    job_id,
                    f"扫描进度 {cur}/{total} ({pct}%) - 已下载: {downloaded}, 跳过已缓存: {hits}",
                )

        total, hits, updated_sessions = fetch_remote_files(
            client=client,
            cache=cache,
            limit=limit,
            all_files=all_files,
            progress_callback=on_progress,
        )

        elapsed = round(time.time() - t0, 2)
        downloaded = len(updated_sessions)
        summary = {
            "success": True,
            "total_scanned": total,
            "cache_hits": hits,
            "downloaded": downloaded,
            "cache_total": cache.count(),
            "duration_seconds": elapsed,
        }
        emit_log(
            job_id,
            f"🎉 同步完成！扫描 {total} 篇，新拉取 {downloaded} 篇，命中缓存 {hits} 篇 (耗时 {elapsed}s)。",
        )
        ops_runner.broadcast(job_id, "done", summary)

    except InterruptedError:
        emit_log(job_id, "🛑 用户手动中止了云端同步任务。", level="warn")
        ops_runner.broadcast(job_id, "aborted", {"message": "用户中止同步"})
    except (
        sqlite3.Error,
        RuntimeError,
        OSError,
        requests.RequestException,
        ValueError,
    ) as exc:
        emit_log(job_id, f"❌ 同步遇到异常中断: {exc}", level="error")
        ops_runner.broadcast(job_id, "error", {"error": str(exc)})
    finally:
        ops_runner.release_job()


def get_health_diagnostics(cache_dir: str = ".cache") -> dict[str, Any]:
    """生成系统物理与逻辑健康度诊断报告"""
    db_path = os.path.join(cache_dir, "cache.db")
    wal_path = f"{db_path}-wal"

    if not os.path.exists(db_path):
        raise FileNotFoundError(f"找不到数据库文件: {db_path}")

    db_size = os.path.getsize(db_path)
    wal_size = os.path.getsize(wal_path) if os.path.exists(wal_path) else 0

    conn = sqlite3.connect(f"file:{os.path.abspath(db_path)}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("PRAGMA page_size;")
    page_size = cursor.fetchone()[0]
    cursor.execute("PRAGMA page_count;")
    page_count = cursor.fetchone()[0]
    cursor.execute("PRAGMA freelist_count;")
    freelist_count = cursor.fetchone()[0]

    free_bytes = freelist_count * page_size
    frag_ratio = round((free_bytes / db_size * 100), 1) if db_size > 0 else 0.0

    t0 = time.time()
    cursor.execute("PRAGMA quick_check;")
    check_res = cursor.fetchone()[0]
    check_time = round(time.time() - t0, 3)

    def get_count(tbl: str) -> int:
        try:
            cursor.execute(f"SELECT COUNT(*) FROM {tbl};")
            return cursor.fetchone()[0]
        except sqlite3.Error:
            return 0

    raw_count = get_count("file_cache")
    idx_count = get_count("session_index")
    fts_count = get_count("session_fts")

    cursor.execute("""
        SELECT turn_count, total_tokens, thought_tokens, 
               CASE WHEN duration_seconds IS NOT NULL THEN duration_seconds / 60.0 ELSE NULL END AS duration_min,
               user_char_count, has_branching, branch_count
        FROM session_index;
    """)
    rows = cursor.fetchall()

    turn_counts = [r["turn_count"] for r in rows]
    total_tokens = [r["total_tokens"] for r in rows]
    thought_tokens = [r["thought_tokens"] for r in rows]
    durations = [
        r["duration_min"]
        for r in rows
        if r["duration_min"] is not None and r["duration_min"] > 0
    ]
    user_chars = [r["user_char_count"] for r in rows]

    q_turns = get_quantiles(turn_counts)
    q_tokens = get_quantiles(total_tokens)
    q_thought = get_quantiles(thought_tokens)
    q_dur = get_quantiles(durations)
    q_chars = get_quantiles(user_chars)

    total_sessions = len(rows)
    tok_under_8k = sum(1 for t in total_tokens if t < 8_192)
    tok_8k_32k = sum(1 for t in total_tokens if 8_192 <= t < 32_768)
    tok_32k_128k = sum(1 for t in total_tokens if 32_768 <= t < 131_072)
    tok_over_128k = sum(1 for t in total_tokens if t >= 131_072)

    single_turn = sum(1 for t in turn_counts if t == 1)
    light_turn = sum(1 for t in turn_counts if 2 <= t <= 4)
    deep_turn = sum(1 for t in turn_counts if 5 <= t <= 15)
    epic_turn = sum(1 for t in turn_counts if t > 15)

    thinking_sessions = sum(1 for t in thought_tokens if t > 0)
    sum_total_tokens = sum(total_tokens)
    sum_thought_tokens = sum(thought_tokens)
    thought_ratio = (
        round((sum_thought_tokens / sum_total_tokens * 100), 2)
        if sum_total_tokens > 0
        else 0.0
    )

    branch_sessions = sum(1 for r in rows if r["has_branching"])
    total_retries = sum(r["branch_count"] for r in rows)

    # 提取 Top 离群怪兽样本
    cursor.execute("""
        SELECT file_id, LENGTH(data) AS byte_len 
        FROM file_cache 
        ORDER BY byte_len DESC 
        LIMIT 3;
    """)
    top_large_rows = cursor.fetchall()
    top_large_files = []
    for r in top_large_rows:
        cursor.execute(
            "SELECT name, turn_count, total_tokens FROM session_index WHERE file_id = ?;",
            (r["file_id"],),
        )
        srow = cursor.fetchone()
        top_large_files.append(
            {
                "file_id": r["file_id"],
                "name": srow["name"] if srow else "未知会话",
                "byte_len": r["byte_len"],
                "byte_len_human": format_bytes(r["byte_len"]),
                "turn_count": srow["turn_count"] if srow else 0,
                "total_tokens": srow["total_tokens"] if srow else 0,
            }
        )

    cursor.execute("""
        SELECT file_id, name, total_tokens, thought_tokens, turn_count 
        FROM session_index 
        ORDER BY total_tokens DESC 
        LIMIT 3;
    """)
    top_tokens = [dict(r) for r in cursor.fetchall()]

    cursor.execute("""
        SELECT file_id, name, turn_count, duration_human, total_tokens 
        FROM session_index 
        ORDER BY turn_count DESC 
        LIMIT 3;
    """)
    top_turns = [dict(r) for r in cursor.fetchall()]

    conn.close()

    return {
        "physical": {
            "db_size": db_size,
            "db_size_human": format_bytes(db_size),
            "wal_size": wal_size,
            "wal_size_human": format_bytes(wal_size),
            "freelist_bytes": free_bytes,
            "freelist_human": format_bytes(free_bytes),
            "frag_ratio": frag_ratio,
            "integrity_check": check_res,
            "check_time_seconds": check_time,
            "page_count": page_count,
            "page_size": page_size,
        },
        "schema_counts": {
            "file_cache": raw_count,
            "session_index": idx_count,
            "session_fts": fts_count,
            "is_aligned": raw_count == idx_count,
        },
        "quantiles": {
            "turns": q_turns,
            "tokens": q_tokens,
            "thought": q_thought,
            "duration": q_dur,
            "chars": q_chars,
        },
        "cognitive_buckets": {
            "context_buckets": {
                "under_8k": tok_under_8k,
                "8k_32k": tok_8k_32k,
                "32k_128k": tok_32k_128k,
                "over_128k": tok_over_128k,
            },
            "turn_buckets": {
                "single": single_turn,
                "light": light_turn,
                "deep": deep_turn,
                "epic": epic_turn,
            },
            "thinking": {
                "sessions": thinking_sessions,
                "ratio": thought_ratio,
                "sum_thought_tokens": sum_thought_tokens,
            },
            "friction": {
                "branch_sessions": branch_sessions,
                "total_retries": total_retries,
            },
            "total_sessions": total_sessions,
        },
        "outliers": {
            "largest_files": top_large_files,
            "top_tokens": top_tokens,
            "top_turns": top_turns,
        },
    }


def get_schema_diagnostics(
    cache_dir: str = ".cache", sample_limit: int | None = None
) -> dict[str, Any]:
    """生成数据 Schema 骨架与 Chunk 载荷形态分析报告"""
    cache = SQLiteCache(cache_dir=cache_dir)
    total_records = cache.count()

    if total_records == 0:
        return {
            "total_records": 0,
            "top_level_keys": [],
            "payload_types": [],
            "shapes": [],
        }

    top_level_keys_counter = Counter()
    schema_signatures = defaultdict(list)
    chunk_types_counter = Counter()

    count = 0
    for file_id, _, data in cache.iter_all_data():
        if not isinstance(data, dict):
            continue

        keys_tuple = tuple(sorted(data.keys()))
        top_level_keys_counter.update(keys_tuple)

        chunks = data.get("chunkedPrompt", {}).get("chunks", [])
        for chunk in chunks:
            payload_types = [
                k for k in chunk if k not in ("role", "tokenCount", "createTime")
            ]
            chunk_types_counter[", ".join(sorted(payload_types))] += 1

        sig_str = json.dumps(
            get_shape_summary(data, max_depth=2), ensure_ascii=False, sort_keys=True
        )
        if len(schema_signatures[sig_str]) < 2:
            schema_signatures[sig_str].append((file_id, data))

        count += 1
        if sample_limit and count >= sample_limit:
            break

    sampled_count = count
    top_keys = [
        {
            "key": k,
            "count": c,
            "ratio": round((c / sampled_count) * 100, 1),
        }
        for k, c in top_level_keys_counter.most_common()
    ]

    payload_types = [
        {"type": p if p else "纯文本/元数据", "count": c}
        for p, c in chunk_types_counter.most_common()
    ]

    shapes = []
    for idx, (sig, samples) in enumerate(schema_signatures.items(), start=1):
        sample_ids = [s[0] for s in samples]
        shapes.append(
            {
                "id": idx,
                "sample_file_ids": sample_ids,
                "shape": json.loads(sig),
            }
        )

    return {
        "total_records": total_records,
        "sampled_records": sampled_count,
        "top_level_keys": top_keys,
        "payload_types": payload_types,
        "shapes": shapes,
    }
