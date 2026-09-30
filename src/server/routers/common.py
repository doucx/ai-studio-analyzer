"""
子路由共享的基础设施与通用工具函数
"""

import logging
from datetime import datetime, timedelta

from src.analyzer.cache import SQLiteCache

logger = logging.getLogger(__name__)

# 全局共享的数据库持久化缓存单例
cache = SQLiteCache(cache_dir=".cache")


def format_seconds_human(total_sec: float) -> str:
    """秒数转为人类友好格式 (如 2h 15m)"""
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


def resolve_time_bounds(
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

    today_dt = datetime.now().astimezone()
    today_local = today_dt.strftime("%Y-%m-%d")

    if range_key == "1d":
        # 严格定义为自然日的“今天”闭区间
        return None, None, today_local, today_local
    if range_key == "7d":
        # 今天 + 过去 6 天 = 共 7 个自然日
        start_d = (today_dt - timedelta(days=6)).strftime("%Y-%m-%d")
        return None, None, start_d, today_local
    if range_key == "30d":
        # 今天 + 过去 29 天 = 共 30 个自然日
        start_d = (today_dt - timedelta(days=29)).strftime("%Y-%m-%d")
        return None, None, start_d, today_local
    if range_key == "90d":
        # 今天 + 过去 89 天 = 共 90 个自然日
        start_d = (today_dt - timedelta(days=89)).strftime("%Y-%m-%d")
        return None, None, start_d, today_local
    if range_key == "this_year":
        this_year_start = f"{today_dt.year}-01-01"
        return None, None, this_year_start, today_local

    return None, None, None, None
