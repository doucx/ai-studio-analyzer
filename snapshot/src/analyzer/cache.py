import json
import os
import sqlite3
from typing import Dict, Any, Optional, Iterator, Tuple
from contextlib import contextmanager


class SQLiteCache:
    """
    基于 SQLite 的高性能单文件缓存器 (开启 WAL 模式)
    支持高频增量命中检测、按需反序列化与全量流式迭代。
    """

    def __init__(self, cache_dir: str = ".cache", db_name: str = "cache.db"):
        self.cache_dir = cache_dir
        self.db_path = os.path.join(cache_dir, db_name)
        os.makedirs(cache_dir, exist_ok=True)
        self._init_db()

    @contextmanager
    def _get_connection(self):
        conn = sqlite3.connect(self.db_path, timeout=30.0)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    def _init_db(self):
        """初始化表结构并配置 WAL 高性能模式"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("PRAGMA journal_mode=WAL;")
            cursor.execute("PRAGMA synchronous=NORMAL;")
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS file_cache (
                    file_id TEXT PRIMARY KEY,
                    modified_time TEXT NOT NULL,
                    data TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_file_mtime 
                ON file_cache(file_id, modified_time);
            """)
            conn.commit()

    def is_cached(self, file_id: str, modified_time: str) -> bool:
        """检查文件是否已缓存且未被云端修改 (索引级查询)"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT 1 FROM file_cache WHERE file_id = ? AND modified_time = ? LIMIT 1;",
                (file_id, modified_time)
            )
            return cursor.fetchone() is not None

    def get(self, file_id: str) -> Optional[Dict[str, Any]]:
        """从 SQLite 读取缓存内容并反序列化"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT data FROM file_cache WHERE file_id = ? LIMIT 1;", (file_id,))
            row = cursor.fetchone()
            if row:
                try:
                    return json.loads(row["data"])
                except Exception:
                    return None
        return None

    def put(self, file_id: str, modified_time: str, data: Dict[str, Any]):
        """写入或更新单个文件缓存"""
        payload_str = json.dumps(data, ensure_ascii=False)
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO file_cache (file_id, modified_time, data, updated_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(file_id) DO UPDATE SET
                    modified_time = excluded.modified_time,
                    data = excluded.data,
                    updated_at = CURRENT_TIMESTAMP;
            """, (file_id, modified_time, payload_str))
            conn.commit()

    def count(self) -> int:
        """获取当前缓存记录总条目数"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) AS total FROM file_cache;")
            row = cursor.fetchone()
            return row["total"] if row else 0

    def iter_all_data(self) -> Iterator[Tuple[str, str, Dict[str, Any]]]:
        """流式迭代全量缓存记录，避免一次性消耗过多内存"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT file_id, modified_time, data FROM file_cache;")
            while True:
                rows = cursor.fetchmany(200)
                if not rows:
                    break
                for row in rows:
                    try:
                        parsed = json.loads(row["data"])
                        yield row["file_id"], row["modified_time"], parsed
                    except Exception:
                        continue


# 保持别名映射，保证上层调用无缝兼容
LocalCache = SQLiteCache