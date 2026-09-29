"""
全景指标看板与每日时间线切片路由
"""

import json
import logging
from datetime import datetime

from fastapi import APIRouter

from src.analyzer.metrics import calculate_session_metrics
from src.server.routers.common import (
    cache,
    format_seconds_human,
    resolve_time_bounds,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Metrics"])


@router.get("/daily/timeline")
def get_daily_timeline(days: int | None = None):
    """
    按本地日历日期聚合返回所有会话的每日时间线。
    若会话包含跨多个自然日的交互 Chunk，自动派发到每一天的记录中，并将总耗时平均分摊。
    """
    indices = cache.query_indices()
    local_tz = datetime.now().astimezone().tzinfo
    timeline: dict[str, dict] = {}

    for idx in indices:
        file_id = idx["file_id"]
        date_time_map: dict[str, str] = {}
        active_dates_str = idx.get("active_dates")

        if active_dates_str:
            try:
                date_time_map = json.loads(active_dates_str)
            except (json.JSONDecodeError, TypeError) as err:
                logger.debug("解析 active_dates 失败: %s", err)

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

        total_dur_sec = idx.get("duration_seconds") or 0.0
        days_count = max(1, len(date_time_map))
        split_dur_sec = total_dur_sec / days_count

        dur_label = format_seconds_human(split_dur_sec)
        if days_count > 1:
            dur_label = f"{dur_label} (跨{days_count}天均分)"

        total_tok = idx.get("total_tokens", 0)
        thought_tok = idx.get("thought_tokens", 0)

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
        item["total_duration_human"] = format_seconds_human(
            item["total_duration_seconds"]
        )
        item["sessions"].sort(key=lambda s: s.get("time_local", ""), reverse=True)
        result[d] = item

    return {"date_timeline": result}


@router.get("/daily/today")
def get_daily_today():
    """获取今天（本地日历）的交互场次、总心智耗时与能耗切片"""
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
    """基于 session_index 表毫秒级聚合认知与交互指标，支持精确闭区间"""
    start_iso, end_iso, start_d, end_d = resolve_time_bounds(range, start, end)
    indices = cache.query_indices(
        range_start_iso=start_iso,
        range_end_iso=end_iso,
        start_date=start_d,
        end_date=end_d,
    )
    return calculate_session_metrics(indices)
