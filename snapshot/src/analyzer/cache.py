import json
import os
import sqlite3
from typing import Dict, Any, Optional, Tuple, List
from contextlib import contextmanager


class SQLiteCache:
    """
    基于 SQLite 的高性能单文件缓存器 (开启 WAL 模式)
    平替原有平铺小 JSON 文件结构，支持高频增量命中检测与快速反序列化。
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
        """检查文件是否已缓存且未被云端修改 (索引级秒查)"""
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
        """获取当前缓存条目总数"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) AS total FROM file_cache;")
            row = cursor.fetchone()
            return row["total"] if row else 0

    def iter_all_data(self):
        """流式迭代所有缓存记录，便于分析与 Schema 探测"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT file_id, modified_time, data FROM file_cache;")
            while True:
                rows = cursor.fetchmany(100)
                if not rows:
                    break
                for row in rows:
                    try:
                        parsed = json.loads(row["data"])
                        yield row["file_id"], row["modified_time"], parsed
                    except Exception:
                        continue

    def migrate_from_directory(self, old_cache_dir: str = ".cache") -> Tuple[int, int]:
        """
        从原旧版平铺 JSON 文件目录迁移到 SQLite。
        返回: (成功导入数, 失败/损坏跳过数)
        """
        index_file = os.path.join(old_cache_dir, "index.json")
        index: Dict[str, str] = {}
        if os.path.exists(index_file):
            try:
                with open(index_file, "r", encoding="utf-8") as f:
                    index = json.load(f)
            except Exception:
                index = {}

        # 扫描所有旧版 json 文件 (排除 index.json)
        json_files = [
            f for f in os.listdir(old_cache_dir)
            if f.endswith(".json") and f != "index.json"
        ]

        success_count = 0
        skip_count = 0
        batch_records: List[Tuple[str, str, str]] = []

        with self._get_connection() as conn:
            cursor = conn.cursor()
            for fname in json_files:
                file_id = fname[:-5]  # 去掉 .json 后缀
                mtime = index.get(file_id, "")
                fpath = os.path.join(old_cache_dir, fname)

                try:
                    with open(fpath, "r", encoding="utf-8") as f:
                        content_str = f.read()
                        # 校验是否合法 JSON 字符串
                        json.loads(content_str)
                        batch_records.append((file_id, mtime, content_str))
                        success_count += 1
                except Exception:
                    skip_count += 1
                    continue

                # 分批批量提交，防止单次内存过载
                if len(batch_records) >= 500:
                    cursor.executemany("""
                        INSERT INTO file_cache (file_id, modified_time, data, updated_at)
                        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                        ON CONFLICT(file_id) DO UPDATE SET
                            modified_time = excluded.modified_time,
                            data = excluded.data,
                            updated_at = CURRENT_TIMESTAMP;
                    """, batch_records)
                    conn.commit()
                    batch_records.clear()

            if batch_records:
                cursor.executemany("""
                    INSERT INTO file_cache (file_id, modified_time, data, updated_at)
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(file_id) DO UPDATE SET
                        modified_time = excluded.modified_time,
                        data = excluded.data,
                        updated_at = CURRENT_TIMESTAMP;
                """, batch_records)
                conn.commit()
                batch_records.clear()

        return success_count, skip_count


# 别名映射，保证上层调用代码零修改兼容
LocalCache = SQLiteCache