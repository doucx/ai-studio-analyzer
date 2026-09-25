import json
import os
import sqlite3
from typing import Dict, Any, Optional, Iterator, Tuple, List
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
            cursor.execute("PRAGMA wal_autocheckpoint=1000;")
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
            # 二级轻量索引表：存储会话的核心聚合指标与检索字段，供看板秒开
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS session_index (
                    file_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    model TEXT NOT NULL,
                    turn_count INTEGER NOT NULL,
                    total_tokens INTEGER NOT NULL,
                    thought_tokens INTEGER NOT NULL,
                    user_char_count INTEGER NOT NULL,
                    duration_seconds REAL,
                    duration_human TEXT NOT NULL,
                    has_branching INTEGER NOT NULL,
                    branch_count INTEGER NOT NULL,
                    has_sys_instruction INTEGER NOT NULL,
                    first_prompt TEXT,
                    created_time TEXT,
                    modified_time TEXT,
                    date TEXT
                );
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_sidx_mtime 
                ON session_index(modified_time DESC);
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_sidx_date 
                ON session_index(date);
            """)
            # 全文检索虚表：采用 trigram 分词器支持中文、英文及代码子串匹配
            cursor.execute("""
                CREATE VIRTUAL TABLE IF NOT EXISTS session_fts USING fts5(
                    file_id,
                    title,
                    system_instruction,
                    content,
                    tokenize = 'trigram'
                );
            """)
            conn.commit()

    def is_cached(self, file_id: str, modified_time: str) -> bool:
        """检查文件是否已缓存且未被云端修改 (索引级查询)"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT 1 FROM file_cache WHERE file_id = ? AND modified_time = ? LIMIT 1;",
                (file_id, modified_time),
            )
            return cursor.fetchone() is not None

    def get(self, file_id: str) -> Optional[Dict[str, Any]]:
        """从 SQLite 读取缓存内容并反序列化"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT data FROM file_cache WHERE file_id = ? LIMIT 1;", (file_id,)
            )
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
            cursor.execute(
                """
                INSERT INTO file_cache (file_id, modified_time, data, updated_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(file_id) DO UPDATE SET
                    modified_time = excluded.modified_time,
                    data = excluded.data,
                    updated_at = CURRENT_TIMESTAMP;
            """,
                (file_id, modified_time, payload_str),
            )
            conn.commit()

    def count(self) -> int:
        """获取当前缓存记录总条目数"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) AS total FROM file_cache;")
            row = cursor.fetchone()
            return row["total"] if row else 0

    def checkpoint(self, truncate: bool = True) -> Tuple[int, int, int]:
        """
        显式将 WAL 脏页完整刷回主数据库文件并释放磁盘空间。
        :param truncate: 是否截断 WAL 文件归零
        :return: (busy_flag, log_pages, checkpointed_pages)
        """
        mode = "TRUNCATE" if truncate else "PASSIVE"
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(f"PRAGMA wal_checkpoint({mode});")
            row = cursor.fetchone()
            return tuple(row) if row else (0, 0, 0)

    def vacuum(self):
        """整理并压缩数据库碎片"""
        with self._get_connection() as conn:
            conn.execute("VACUUM;")

    def clear_indices(self):
        """清空二级索引与 FTS 虚表并重新初始化结构（重建前调用）"""
        with self._get_connection() as conn:
            conn.execute("DROP TABLE IF EXISTS session_fts;")
            conn.execute("DROP TABLE IF EXISTS session_index;")
            conn.commit()
        self._init_db()

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

    def upsert_session_index(self, s: Any):
        """将单个会话摘要物化写入索引表"""
        st = s.start_time or s.modified_time
        date_str = st.strftime("%Y-%m-%d") if st else None
        first_prompt = getattr(s, "first_effective_prompt", None) or (
            s.user_prompts[0] if s.user_prompts else ""
        )
        c_time = s.created_time.isoformat() if s.created_time else None
        m_time = s.modified_time.isoformat() if s.modified_time else None

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO session_index (
                    file_id, name, model, turn_count, total_tokens, thought_tokens,
                    user_char_count, duration_seconds, duration_human, has_branching,
                    branch_count, has_sys_instruction, first_prompt, created_time,
                    modified_time, date
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(file_id) DO UPDATE SET
                    name = excluded.name,
                    model = excluded.model,
                    turn_count = excluded.turn_count,
                    total_tokens = excluded.total_tokens,
                    thought_tokens = excluded.thought_tokens,
                    user_char_count = excluded.user_char_count,
                    duration_seconds = excluded.duration_seconds,
                    duration_human = excluded.duration_human,
                    has_branching = excluded.has_branching,
                    branch_count = excluded.branch_count,
                    has_sys_instruction = excluded.has_sys_instruction,
                    first_prompt = excluded.first_prompt,
                    created_time = excluded.created_time,
                    modified_time = excluded.modified_time,
                    date = excluded.date;
            """,
                (
                    s.file_id,
                    s.name,
                    s.model,
                    s.turn_count,
                    s.total_tokens,
                    s.thought_tokens,
                    s.total_user_chars,
                    s.duration_seconds,
                    s.duration_human,
                    1 if s.has_branching else 0,
                    s.branch_count,
                    1 if s.system_instruction else 0,
                    first_prompt,
                    c_time,
                    m_time,
                    date_str,
                ),
            )
            conn.commit()

    def count_indices(self) -> int:
        """获取当前索引表记录条数"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) AS total FROM session_index;")
            row = cursor.fetchone()
            return row["total"] if row else 0

    def query_indices(
        self,
        range_start_iso: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """基于时间条件毫秒级检索会话索引列表"""
        sql = "SELECT * FROM session_index"
        params = []
        if range_start_iso:
            sql += " WHERE (modified_time >= ? OR created_time >= ?)"
            params.extend([range_start_iso, range_start_iso])
        sql += " ORDER BY modified_time DESC"
        if limit and limit > 0:
            sql += " LIMIT ?"
            params.append(limit)

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(sql, params)
            rows = cursor.fetchall()
            return [dict(r) for r in rows]

    def upsert_session_fts(
        self,
        s: Any,
        max_total_chars: int = 40_000,
        head_chars: int = 25_000,
        tail_chars: int = 15_000,
    ):
        """
        将单个会话的全部对话正文物化写入 FTS5 虚拟表。
        配置安全护栏：
        1. 排除二进制与巨型附件全文，严格截取短元数据预览；
        2. 单轮消息截断限制，防止单轮巨型日志/代码击穿分词器；
        3. 单会话总字符硬上限截断 (默认 40,000 字符，取首尾保留关键上下文)，阻断 Trigram 倒排膨胀。
        """
        turn_texts = []
        for idx, t in enumerate(getattr(s, "turns", []), start=1):
            p_type = getattr(t, "payload_type", "text")
            text = (getattr(t, "text", "") or "").strip()

            if getattr(t, "is_thought", False):
                snippet = text[:3000] if len(text) > 3000 else text
                if snippet:
                    turn_texts.append(f"[Thinking #{idx}]: {snippet}")
            elif p_type == "text" and text:
                role_label = "User" if t.role == "user" else "Model"
                snippet = text[:6000] if len(text) > 6000 else text
                turn_texts.append(f"[{role_label} #{idx}]: {snippet}")
            elif p_type == "inlineFile":
                dname = (
                    t.extra_metadata.get("display_name", "")
                    if getattr(t, "extra_metadata", None)
                    else ""
                )
                mime = (
                    t.extra_metadata.get("mime_type", "")
                    if getattr(t, "extra_metadata", None)
                    else ""
                )
                label = dname or mime or "inlineFile"
                preview = text[:200].replace("\n", " ").strip() if text else ""
                turn_texts.append(f"[附件: {label}] {preview}")
            elif p_type == "driveDocument":
                turn_texts.append(f"[挂载云盘: {text[:200]}]")

        full_content = "\n".join(turn_texts)
        if len(full_content) > max_total_chars:
            full_content = (
                full_content[:head_chars]
                + f"\n...[已截断 {len(full_content) - max_total_chars} 字符以保护 FTS 索引]...\n"
                + full_content[-tail_chars:]
            )

        sys_inst = (getattr(s, "system_instruction", "") or "").strip()
        if len(sys_inst) > 10_000:
            sys_inst = sys_inst[:10_000]

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM session_fts WHERE file_id = ?;", (s.file_id,))
            cursor.execute(
                """
                INSERT INTO session_fts (file_id, title, system_instruction, content)
                VALUES (?, ?, ?, ?);
                """,
                (s.file_id, s.name, sys_inst, full_content),
            )
            conn.commit()

    def search_fts(
        self,
        query: str,
        limit: int = 50,
        offset: int = 0,
        range_start_iso: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """基于 FTS5 Trigram 与 BM25 进行全文检索，并提取上下文命中片段 (Snippet)"""
        clean_query = query.strip().replace('"', '""')
        if not clean_query:
            return []

        fts_match_expr = f'"{clean_query}"'
        where_conditions = ["session_fts MATCH ?"]
        params: List[Any] = [fts_match_expr]

        if range_start_iso:
            where_conditions.append("(s.modified_time >= ? OR s.created_time >= ?)")
            params.extend([range_start_iso, range_start_iso])

        where_sql = " AND ".join(where_conditions)

        # snippet 第二个参数限定为 3 (即 session_fts 的 content 列，避免遍历整表其他列产生极大 I/O)
        sql = f"""
            SELECT 
                f.file_id,
                bm25(session_fts) AS rank,
                snippet(session_fts, 3, '<mark class="bg-indigo-500/30 text-indigo-300 font-semibold px-0.5 rounded">', '</mark>', '...', 22) AS snippet,
                s.name,
                s.model,
                s.turn_count,
                s.total_tokens,
                s.thought_tokens,
                s.duration_human,
                s.duration_seconds,
                s.has_branching,
                s.branch_count,
                s.first_prompt,
                s.modified_time,
                s.created_time
            FROM session_fts f
            JOIN session_index s ON f.file_id = s.file_id
            WHERE {where_sql}
            ORDER BY rank
            LIMIT ? OFFSET ?;
        """
        params.extend([limit, offset])

        with self._get_connection() as conn:
            cursor = conn.cursor()
            try:
                cursor.execute("PRAGMA busy_timeout = 3000;")
                cursor.execute(sql, tuple(params))
                rows = cursor.fetchall()
                results = []
                for r in rows:
                    item = dict(r)
                    item["has_branching"] = bool(item.get("has_branching", 0))
                    results.append(item)
                return results
            except sqlite3.OperationalError:
                return []


# 保持别名映射，保证上层调用无缝兼容
LocalCache = SQLiteCache
