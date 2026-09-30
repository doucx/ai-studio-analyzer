import html
import json
import logging
import os
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

logger = logging.getLogger(__name__)


class SQLiteCache:
    """
    基于 SQLite 的高性能单文件缓存器 (开启 WAL 模式)
    支持高频增量命中检测、按需反序列化与全量流式迭代。
    """

    def __init__(self, cache_dir: str = ".cache", db_name: str = "cache.db"):
        self.cache_dir = cache_dir
        self.db_path = os.path.join(cache_dir, db_name)
        os.makedirs(cache_dir, exist_ok=True)
        self._maintenance_lock = threading.Lock()
        self._maintenance_owner: int | None = None
        self._init_db()

    def enter_maintenance_mode(self):
        """进入独占维护模式，仅当前线程允许执行写操作"""
        with self._maintenance_lock:
            self._maintenance_owner = threading.get_ident()

    def exit_maintenance_mode(self):
        """退出独占维护模式"""
        with self._maintenance_lock:
            self._maintenance_owner = None

    def _check_maintenance_write(self):
        """写入操作前置安全检查：处于维护模式且非持有者线程时阻断写入"""
        with self._maintenance_lock:
            if (
                self._maintenance_owner is not None
                and self._maintenance_owner != threading.get_ident()
            ):
                raise RuntimeError("数据库当前处于独占维护重整模式，已阻断并发写操作。")

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
                    date TEXT,
                    active_dates TEXT,
                    cumulative_tokens INTEGER DEFAULT 0
                );
            """)
            # 增量字段平滑迁移
            for col in [
                "cumulative_tokens INTEGER DEFAULT 0",
                "user_net_tokens INTEGER DEFAULT 0",
                "context_file_tokens INTEGER DEFAULT 0",
                "model_net_tokens INTEGER DEFAULT 0",
            ]:
                try:
                    cursor.execute(f"ALTER TABLE session_index ADD COLUMN {col};")
                except sqlite3.OperationalError:
                    pass
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
            # Chunk 级细粒度时序索引表：精确记录每个数据块的发生时间、时段与算力
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS chunk_index (
                    chunk_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    file_id TEXT NOT NULL,
                    turn_index INTEGER NOT NULL,
                    role TEXT NOT NULL,
                    is_thought INTEGER NOT NULL,
                    token_count INTEGER NOT NULL,
                    date TEXT NOT NULL,
                    hour INTEGER NOT NULL,
                    weekday INTEGER NOT NULL
                );
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_chunk_date_hour 
                ON chunk_index(date, hour);
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_chunk_hour 
                ON chunk_index(hour);
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_chunk_file_id 
                ON chunk_index(file_id);
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

    def get(self, file_id: str) -> dict[str, Any] | None:
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
                except (json.JSONDecodeError, TypeError):
                    return None
        return None

    def put(self, file_id: str, modified_time: str, data: dict[str, Any]):
        """写入或更新单个文件缓存"""
        self._check_maintenance_write()
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

    def checkpoint(self, truncate: bool = True) -> tuple[int, int, int]:
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
        """清空二级索引、FTS 虚表与 Chunk 细粒度索引并重新初始化结构（重建前调用）"""
        with self._get_connection() as conn:
            conn.execute("DROP TABLE IF EXISTS session_fts;")
            conn.execute("DROP TABLE IF EXISTS session_index;")
            conn.execute("DROP TABLE IF EXISTS chunk_index;")
            conn.commit()
        self._init_db()

    def iter_all_data(self) -> Iterator[tuple[str, str, dict[str, Any]]]:
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
                    except (json.JSONDecodeError, TypeError) as err:
                        logger.debug("读取缓存解析失败: %s", err)
                        continue

    def upsert_session_index(self, s: Any):
        """将单个会话摘要物化写入索引表"""
        self._check_maintenance_write()
        st = s.start_time or s.modified_time
        date_str = st.strftime("%Y-%m-%d") if st else None
        first_prompt = getattr(s, "first_effective_prompt", None) or (
            s.user_prompts[0] if s.user_prompts else ""
        )
        c_time = s.created_time.isoformat() if s.created_time else None
        m_time = s.modified_time.isoformat() if s.modified_time else None

        from datetime import datetime

        local_tz = datetime.now().astimezone().tzinfo
        date_time_map = {}
        for t in getattr(s, "turns", []):
            if getattr(t, "timestamp", None):
                try:
                    t_local = t.timestamp.astimezone(local_tz)
                    d_str = t_local.strftime("%Y-%m-%d")
                    t_str = t_local.strftime("%H:%M")
                    if d_str not in date_time_map or t_str > date_time_map[d_str]:
                        date_time_map[d_str] = t_str
                except (ValueError, TypeError, OverflowError) as err:
                    logger.debug("转换 turn 时间戳失败: %s", err)

        if not date_time_map:
            m_dt = s.modified_time or s.created_time
            if m_dt:
                try:
                    dt_local = m_dt.astimezone(local_tz)
                    date_time_map[dt_local.strftime("%Y-%m-%d")] = dt_local.strftime(
                        "%H:%M"
                    )
                except (ValueError, TypeError, OverflowError) as err:
                    logger.debug("转换会话时间戳失败: %s", err)

        import json

        active_dates_json = json.dumps(date_time_map) if date_time_map else "{}"

        cum_tokens = getattr(s, "cumulative_api_tokens", s.total_tokens)
        u_net = getattr(s, "user_net_tokens", 0)
        c_files = getattr(s, "context_file_tokens", 0)
        m_net = getattr(s, "model_net_tokens", 0)
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO session_index (
                    file_id, name, model, turn_count, total_tokens, thought_tokens,
                    user_char_count, duration_seconds, duration_human, has_branching,
                    branch_count, has_sys_instruction, first_prompt, created_time,
                    modified_time, date, active_dates, cumulative_tokens,
                    user_net_tokens, context_file_tokens, model_net_tokens
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    date = excluded.date,
                    active_dates = excluded.active_dates,
                    cumulative_tokens = excluded.cumulative_tokens,
                    user_net_tokens = excluded.user_net_tokens,
                    context_file_tokens = excluded.context_file_tokens,
                    model_net_tokens = excluded.model_net_tokens;
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
                    active_dates_json,
                    cum_tokens,
                    u_net,
                    c_files,
                    m_net,
                ),
            )
            conn.commit()

    def upsert_session_chunks(self, s: Any):
        """将单个会话包含的全部 Chunk 细粒度物化到 chunk_index 表"""
        self._check_maintenance_write()
        from datetime import datetime

        local_tz = datetime.now().astimezone().tzinfo
        fallback_dt = s.modified_time or s.created_time or datetime.now().astimezone()

        records = []
        for idx, t in enumerate(getattr(s, "turns", []), start=1):
            c_time = getattr(t, "timestamp", None) or fallback_dt
            try:
                dt_local = c_time.astimezone(local_tz)
            except (ValueError, TypeError, OverflowError):
                dt_local = fallback_dt.astimezone(local_tz)

            date_str = dt_local.strftime("%Y-%m-%d")
            hour = dt_local.hour
            weekday = dt_local.weekday()  # 0 = 周一, 6 = 周日
            role = getattr(t, "role", "user")
            is_thought = 1 if getattr(t, "is_thought", False) else 0
            token_count = int(getattr(t, "token_count", 0) or 0)

            records.append(
                (
                    s.file_id,
                    idx,
                    role,
                    is_thought,
                    token_count,
                    date_str,
                    hour,
                    weekday,
                )
            )

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM chunk_index WHERE file_id = ?;", (s.file_id,))
            if records:
                cursor.executemany(
                    """
                    INSERT INTO chunk_index (
                        file_id, turn_index, role, is_thought, token_count, date, hour, weekday
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
                    """,
                    records,
                )
            conn.commit()

    def query_hourly_distribution(
        self,
        start_date: str | None = None,
        end_date: str | None = None,
        range_start_iso: str | None = None,
        range_end_iso: str | None = None,
    ) -> dict[str, Any]:
        """按 24 小时槽位精确聚合所选时间范围内的 Chunk 推进量与 Token 算力分布"""
        conditions = []
        params = []

        if start_date and end_date:
            conditions.append("date >= ? AND date <= ?")
            params.extend([start_date, end_date])
        elif start_date:
            conditions.append("date >= ?")
            params.append(start_date)
        elif end_date:
            conditions.append("date <= ?")
            params.append(end_date)
        elif range_start_iso and range_end_iso:
            s_date = range_start_iso.split("T")[0]
            e_date = range_end_iso.split("T")[0]
            conditions.append("date >= ? AND date <= ?")
            params.extend([s_date, e_date])
        elif range_start_iso:
            s_date = range_start_iso.split("T")[0]
            conditions.append("date >= ?")
            params.append(s_date)

        where_clause = " WHERE " + " AND ".join(conditions) if conditions else ""

        sql = f"""
            SELECT 
                hour,
                SUM(token_count) AS total_tokens,
                SUM(CASE WHEN is_thought = 1 THEN token_count ELSE 0 END) AS thought_tokens,
                COUNT(*) AS total_chunks,
                COUNT(DISTINCT file_id) AS total_sessions
            FROM chunk_index
            {where_clause}
            GROUP BY hour
            ORDER BY hour ASC;
        """

        # 初始化标准 24 槽位
        slots = [
            {
                "hour": h,
                "label": f"{h:02d}:00",
                "tokens": 0,
                "thought_tokens": 0,
                "chunks": 0,
                "sessions": 0,
            }
            for h in range(24)
        ]

        # 初始化 7 × 24 = 168 槽位热力矩阵 (weekday 0=周一 到 6=周日)
        punchcard_matrix = []
        for w in range(7):
            for h in range(24):
                punchcard_matrix.append(
                    {
                        "weekday": w,
                        "hour": h,
                        "tokens": 0,
                        "thought_tokens": 0,
                        "chunks": 0,
                    }
                )

        matrix_lookup = {
            (item["weekday"], item["hour"]): item for item in punchcard_matrix
        }

        matrix_sql = f"""
            SELECT 
                weekday,
                hour,
                SUM(token_count) AS total_tokens,
                SUM(CASE WHEN is_thought = 1 THEN token_count ELSE 0 END) AS thought_tokens,
                COUNT(*) AS total_chunks
            FROM chunk_index
            {where_clause}
            GROUP BY weekday, hour;
        """

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(sql, params)
            rows = cursor.fetchall()
            for r in rows:
                h = int(r["hour"])
                if 0 <= h <= 23:
                    slots[h]["tokens"] = int(r["total_tokens"] or 0)
                    slots[h]["thought_tokens"] = int(r["thought_tokens"] or 0)
                    slots[h]["chunks"] = int(r["total_chunks"] or 0)
                    slots[h]["sessions"] = int(r["total_sessions"] or 0)

            cursor.execute(matrix_sql, params)
            matrix_rows = cursor.fetchall()
            for mr in matrix_rows:
                w = int(mr["weekday"])
                h = int(mr["hour"])
                if (w, h) in matrix_lookup:
                    cell = matrix_lookup[(w, h)]
                    cell["tokens"] = int(mr["total_tokens"] or 0)
                    cell["thought_tokens"] = int(mr["thought_tokens"] or 0)
                    cell["chunks"] = int(mr["total_chunks"] or 0)

        peak_slot = max(slots, key=lambda s: s["tokens"])
        total_chunks = sum(s["chunks"] for s in slots)

        max_cell_tokens = max((c["tokens"] for c in punchcard_matrix), default=0)
        max_cell_chunks = max((c["chunks"] for c in punchcard_matrix), default=0)
        max_cell_thought = max(
            (c["thought_tokens"] for c in punchcard_matrix), default=0
        )

        return {
            "hourly_slots": slots,
            "peak_hour": peak_slot["hour"],
            "peak_tokens": peak_slot["tokens"],
            "total_chunks": total_chunks,
            "punchcard_matrix": punchcard_matrix,
            "max_cell_tokens": max_cell_tokens,
            "max_cell_chunks": max_cell_chunks,
            "max_cell_thought": max_cell_thought,
        }

    def count_indices(self) -> int:
        """获取当前索引表记录条数"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) AS total FROM session_index;")
            row = cursor.fetchone()
            return row["total"] if row else 0

    def query_indices(
        self,
        range_start_iso: str | None = None,
        range_end_iso: str | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        model: str | None = None,
        depth: str | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        """基于时间闭区间与多维属性毫秒级检索会话索引列表"""
        conditions = []
        params = []

        if start_date and end_date:
            conditions.append("date >= ? AND date <= ?")
            params.extend([start_date, end_date])
        elif start_date:
            conditions.append("date >= ?")
            params.append(start_date)
        elif end_date:
            conditions.append("date <= ?")
            params.append(end_date)
        elif range_start_iso and range_end_iso:
            conditions.append("(modified_time >= ? AND modified_time <= ?)")
            params.extend([range_start_iso, range_end_iso])
        elif range_start_iso:
            conditions.append("(modified_time >= ? OR created_time >= ?)")
            params.extend([range_start_iso, range_start_iso])

        if model and model != "all":
            clean_m = model.replace("models/", "")
            conditions.append("(model = ? OR model = ?)")
            params.extend([clean_m, f"models/{clean_m}"])

        if depth and depth != "all":
            if depth == "single":
                conditions.append("turn_count <= 2")
            elif depth == "few":
                conditions.append("turn_count >= 3 AND turn_count <= 6")
            elif depth == "many":
                conditions.append("turn_count >= 7")
            elif depth == "branch":
                conditions.append("has_branching = 1")

        sql = "SELECT * FROM session_index"
        if conditions:
            sql += " WHERE " + " AND ".join(conditions)
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
        max_chunk_chars: int = 4000,
        max_thought_chars: int = 2000,
    ):
        """
        将单个会话的全部对话正文物化写入 FTS5 虚拟表。
        配置安全护栏：
        1. 排除二进制与巨型附件全文，严格截取短元数据预览；
        2. 按 Chunk 施加局部长度保护，防止单轮巨型日志/代码击穿分词器；
        3. 保证会话的全部轮次均能被 FTS 覆盖，杜绝中间轮次丢失。
        """
        self._check_maintenance_write()
        turn_texts = []
        for idx, t in enumerate(getattr(s, "turns", []), start=1):
            p_type = getattr(t, "payload_type", "text")
            text = (getattr(t, "text", "") or "").strip()

            if getattr(t, "is_thought", False):
                snippet = (
                    text[:max_thought_chars] if len(text) > max_thought_chars else text
                )
                if snippet:
                    turn_texts.append(f"[Thinking #{idx}]: {snippet}")
            elif p_type == "text" and text:
                role_label = "User" if t.role == "user" else "Model"
                snippet = (
                    text[:max_chunk_chars] if len(text) > max_chunk_chars else text
                )
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
            elif p_type == "inlineImage":
                mime = (
                    t.extra_metadata.get("mime_type", "image/png")
                    if getattr(t, "extra_metadata", None)
                    else "image/png"
                )
                turn_texts.append(f"[图片附件: {mime}]")
            elif p_type == "driveDocument":
                turn_texts.append(f"[挂载云盘: {text[:200]}]")

        full_content = "\n".join(turn_texts)

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

    @staticmethod
    def _clean_code_token(tok: str) -> str:
        """剥离代码单词两端的标点符号，提取纯净标识符与子串"""
        # 剥离常见的包裹符号与结尾分隔符: ; , : ' " ` ( ) [ ] { }
        stripped = tok.strip(" \t\r\n;,:'\"`()[]{}")
        return stripped.replace('"', '""')

    @classmethod
    def _build_fts_query_candidates(cls, query: str) -> list[str]:
        """
        将单行或多行查询安全编译为渐进式的 FTS5 表达式候选列表：
        支持代码标识符解耦清洗、精确短语、关键行 AND 共现与 OR 模糊召回。
        """
        if not query or not query.strip():
            return []

        raw_lines = [
            line.strip() for line in query.strip().splitlines() if line.strip()
        ]
        if not raw_lines:
            return []

        # 分支 1：多行代码块 / 长篇 Prompt / 异常调用栈
        if len(raw_lines) > 1:
            valid_subphrases = []
            for line in raw_lines:
                cleaned = line.strip()
                # 过滤纯框线符号噪点行 (如连续横线、全制表符)
                if len(set(cleaned)) <= 2 and len(cleaned) > 5:
                    continue
                if len(cleaned) >= 2:
                    escaped = cleaned.replace('"', '""')
                    valid_subphrases.append(f'"{escaped}"')

            if not valid_subphrases:
                first_escaped = raw_lines[0].replace('"', '""')
                valid_subphrases = [f'"{first_escaped}"']

            and_expr = " AND ".join(valid_subphrases[:6])
            or_expr = " OR ".join(valid_subphrases[:8])

            candidates = [and_expr]
            if or_expr != and_expr:
                candidates.append(or_expr)
            return candidates

        # 分支 2：单行查询 (重点：对代码和 import/表达式进行标点解耦)
        single = raw_lines[0]
        escaped_single = single.replace('"', '""')

        # 提取剥离了标点的纯净标识符 tokens
        raw_words = single.split()
        clean_tokens = []
        for w in raw_words:
            c = cls._clean_code_token(w)
            if len(c) >= 2:
                clean_tokens.append(c)

        candidates = []
        # 1. 优先尝试整行精确短语
        candidates.append(f'"{escaped_single}"')

        # 2. 如果存在多个词项，构造解耦后的纯标识符 AND 表达式 (攻克 import 语句与带标点代码)
        if len(clean_tokens) > 1:
            and_expr = " AND ".join(f'"{t}"' for t in clean_tokens[:8])
            if and_expr not in candidates:
                candidates.append(and_expr)

            # 3. 构造 OR 模糊降级表达式
            or_expr = " OR ".join(f'"{t}"' for t in clean_tokens[:10])
            if or_expr not in candidates:
                candidates.append(or_expr)
        elif len(clean_tokens) == 1 and clean_tokens[0] != escaped_single:
            candidates.append(f'"{clean_tokens[0]}"')

        return candidates

    def search_fts(
        self,
        query: str,
        limit: int = 50,
        offset: int = 0,
        range_start_iso: str | None = None,
        range_end_iso: str | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        model: str | None = None,
        depth: str | None = None,
    ) -> list[dict[str, Any]]:
        """基于 FTS5 Trigram、标题加权与时间新鲜度混合打分的全文检索"""
        candidates = self._build_fts_query_candidates(query)
        if not candidates:
            return []

        base_conditions = []
        base_params: list[Any] = []

        if start_date and end_date:
            base_conditions.append("s.date >= ? AND s.date <= ?")
            base_params.extend([start_date, end_date])
        elif start_date:
            base_conditions.append("s.date >= ?")
            base_params.append(start_date)
        elif end_date:
            base_conditions.append("s.date <= ?")
            base_params.append(end_date)
        elif range_start_iso and range_end_iso:
            base_conditions.append("(s.modified_time >= ? AND s.modified_time <= ?)")
            base_params.extend([range_start_iso, range_end_iso])
        elif range_start_iso:
            base_conditions.append("(s.modified_time >= ? OR s.created_time >= ?)")
            base_params.extend([range_start_iso, range_start_iso])

        if model and model != "all":
            clean_m = model.replace("models/", "")
            base_conditions.append("(s.model = ? OR s.model = ?)")
            base_params.extend([clean_m, f"models/{clean_m}"])

        if depth and depth != "all":
            if depth == "single":
                base_conditions.append("s.turn_count <= 2")
            elif depth == "few":
                base_conditions.append("s.turn_count >= 3 AND s.turn_count <= 6")
            elif depth == "many":
                base_conditions.append("s.turn_count >= 7")
            elif depth == "branch":
                base_conditions.append("s.has_branching = 1")

        # 适当扩大底层拉取规模以保证内存时间加权混合排序空间 (最小 60 条)
        fetch_limit = max(60, limit + offset + 20)

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("PRAGMA busy_timeout = 3000;")

            # 依序尝试候选表达式（精确 -> 标识符 AND 共现 -> OR 模糊打分）
            for fts_match_expr in candidates:
                where_conditions = ["session_fts MATCH ?"] + base_conditions
                where_sql = " AND ".join(where_conditions)
                current_params = [fts_match_expr] + base_params + [fetch_limit]

                # 列权重配置: file_id(0.0), title(6.0 强置顶), sys_inst(1.2), content(1.0)
                # 使用临时哨兵字符 \u0001 和 \u0002 标记命中项，避免文本中的原始 HTML 标签注入
                sql = f"""
                    SELECT 
                        f.file_id,
                        bm25(session_fts, 0.0, 6.0, 1.2, 1.0) AS raw_rank,
                        snippet(session_fts, 3, '\u0001', '\u0002', '...', 28) AS raw_snippet,
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
                    ORDER BY raw_rank
                    LIMIT ?;
                """

                try:
                    cursor.execute(sql, tuple(current_params))
                    rows = cursor.fetchall()
                    if rows:
                        import math
                        from datetime import UTC, datetime

                        now_dt = datetime.now(UTC)
                        scored_items = []

                        for r in rows:
                            item = dict(r)
                            item["has_branching"] = bool(item.get("has_branching", 0))

                            # 对 Snippet 文本转义后再恢复合法 <mark> 标签
                            raw_snip = item.pop("raw_snippet", "") or ""
                            escaped_snip = html.escape(raw_snip)
                            item["snippet"] = escaped_snip.replace(
                                "\u0001",
                                '<mark class="bg-indigo-500/30 text-indigo-300 font-semibold px-0.5 rounded">',
                            ).replace("\u0002", "</mark>")

                            # 计算时间新鲜度衰减因子 (Recency Decay)
                            # bm25 负数越小越优，此处综合为 composite_score（越小越优）
                            m_str = item.get("modified_time") or item.get(
                                "created_time"
                            )
                            days_ago = 180.0  # 默认兜底半年
                            if m_str:
                                try:
                                    dt = datetime.fromisoformat(m_str)
                                    if dt.tzinfo is None:
                                        dt = dt.replace(tzinfo=UTC)
                                    days_ago = max(
                                        0.0, (now_dt - dt).total_seconds() / 86400.0
                                    )
                                except (ValueError, TypeError):
                                    pass

                            # raw_rank 为负数 (如 -15.0 到 -0.5)
                            # 时间惩罚因子：随天数对数平滑增加（越久远轻微增加 rank）
                            time_penalty = math.log1p(days_ago) * 0.35
                            composite_score = item["raw_rank"] + time_penalty
                            scored_items.append((composite_score, item))

                        # 按综合得分升序排序（越小越排前面）
                        scored_items.sort(key=lambda x: x[0])
                        final_results = [item for _, item in scored_items]
                        return final_results[offset : offset + limit]

                except sqlite3.OperationalError as err:
                    logger.warning(
                        "FTS 检索语法执行异常: %s, 表达式: %s", err, fts_match_expr
                    )
                    continue

        return []


# 保持别名映射，保证上层调用无缝兼容
LocalCache = SQLiteCache
