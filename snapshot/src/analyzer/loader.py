"""
AI Studio 本地对象加载模块 (纯离线从 SQLite 加载数据)
"""

from typing import List, Optional
from tqdm import tqdm
from .cache import SQLiteCache
from .models import PromptSession
from .parser import parse_prompt_json


def load_cached_sessions(
    cache: SQLiteCache, limit: Optional[int] = None, show_progress: bool = True
) -> List[PromptSession]:
    """
    从本地 SQLite 数据库离线加载已解析的会话列表。

    :param cache: SQLiteCache 实例
    :param limit: 加载上限（None 或 <= 0 表示全量加载）
    :param show_progress: 是否显示加载进度条
    :return: List[PromptSession]
    """
    total_in_db = cache.count()
    if total_in_db == 0:
        return []

    target_count = (
        total_in_db if (limit is None or limit <= 0) else min(limit, total_in_db)
    )
    sessions: List[PromptSession] = []

    iterator = cache.iter_all_data()
    if show_progress:
        iterator = tqdm(
            iterator, total=target_count, desc="离线读取解析", unit="session"
        )

    for file_id, mtime, raw_data in iterator:
        file_meta = {
            "id": file_id,
            "modifiedTime": mtime,
            "name": raw_data.get("name", "Untitled"),
        }
        session = parse_prompt_json(file_meta, raw_data)
        if session:
            sessions.append(session)
            if limit and len(sessions) >= limit:
                break

    return sessions
