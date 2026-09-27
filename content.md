## [WIP] perf(api): 彻底消除 Timeline 接口的 N+1 JSON 解析瓶颈

### 错误分析
通过探针脚本的定量测试，问题根源已经被明确证实：在 `/daily/timeline` 接口的循环中调用 `cache.get(file_id)`，会迫使 SQLite 去磁盘读取数十 MB 的大体积原始数据并交由 CPU 进行海量的 JSON 反序列化（N+1 查询缺陷）。在拥有数百场会话的大盘下，这导致该接口的处理时长暴增至数秒甚至十几秒，彻底冲垮了 FastAPI 以及上游 Neuron `link-ai` 脚本默认设定的超时阈值（5 秒）。

### 用户需求
解决 `/daily/timeline` 的性能超时问题，使跨日时间戳提取不依赖于运行时的慢查询，恢复接口毫秒级的高速响应。

### 评论
关系型数据库的魅力就在于**“读写分离与物化视图”**。我们将原本在查询时（Read-Time）去扫描 JSON 内部嵌套节点以计算跨日逻辑的重活，前置转移到了同步与构建索引时（Write-Time）。这是一次经典的通过“空间换时间”的架构重构。

### 目标
1. 演进 `session_index` 的数据库 Schema，新增 `active_dates` (TEXT) 列，专门用于存储序列化后的 `date_time_map`（如 `{"2026-09-27": "14:20"}`）。
2. 在 `cache.py` 的 `upsert_session_index` 函数中，提前从 `PromptSession.turns` 里提取所有跨日 Chunk 时间戳并写入该列。
3. 将 `api.py` 中的 N+1 读取改为直接读取该索引列，一举剥离对大体积 JSON 原始记录的依赖。
4. 重建系统索引以应用新的 Schema。

### 基本原理
利用空间换时间。在后台触发云盘同步或执行本地重索引（`reindex_cli.py`）时，预先计算好该会话活跃的所有自然日历切片及当天的最晚交互时间，以短 JSON 的形式物化入 `session_index` 这一轻量查询表中。这样在前端和 Neuron 请求 Timeline 大盘时，只需要执行一条极快的 `SELECT * FROM session_index` 即可获取全部结构化支撑数据。

### 标签
#intent/refine #flow/ready #priority/critical #comp/runtime #concept/executor #scope/core #ai/instruct #task/domain/analyzer #task/object/api-performance #task/action/database-schema-update #task/state/continue #task/status/active

---

### Script

#### Acts 1: 修改 SQLite Schema 与 Write-Time 索引构建逻辑

在 `src/analyzer/cache.py` 中为表新增 `active_dates` 列，并在 `upsert_session_index` 写入时完成预计算。

~~~~~act
patch_file
src/analyzer/cache.py
~~~~~
~~~~~python.old
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
~~~~~
~~~~~python.new
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
                    active_dates TEXT
                );
            """)
~~~~~

~~~~~act
patch_file
src/analyzer/cache.py
~~~~~
~~~~~python.old
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
~~~~~
~~~~~python.new
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
                except Exception:
                    pass

        if not date_time_map:
            m_dt = s.modified_time or s.created_time
            if m_dt:
                try:
                    dt_local = m_dt.astimezone(local_tz)
                    date_time_map[dt_local.strftime("%Y-%m-%d")] = dt_local.strftime("%H:%M")
                except Exception:
                    pass

        import json
        active_dates_json = json.dumps(date_time_map) if date_time_map else "{}"

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO session_index (
                    file_id, name, model, turn_count, total_tokens, thought_tokens,
                    user_char_count, duration_seconds, duration_human, has_branching,
                    branch_count, has_sys_instruction, first_prompt, created_time,
                    modified_time, date, active_dates
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    active_dates = excluded.active_dates;
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
                ),
            )
            conn.commit()
~~~~~

#### Acts 2: 修改 API 从轻量索引取用 `active_dates`

清理 `src/server/api.py` 中的重量级 `cache.get()` 循环，改用纯粹的属性读取。

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~python.old
    for idx in indices:
        file_id = idx["file_id"]

        # 1. 尝试从原始缓存中提取该会话所有 chunk 发生的时间戳与落入的本地日期
        date_time_map: dict[str, str] = {}
        raw_data = cache.get(file_id)
        if raw_data and "chunkedPrompt" in raw_data:
            chunks = raw_data.get("chunkedPrompt", {}).get("chunks", [])
            for c in chunks:
                if "createTime" in c:
                    try:
                        c_dt = datetime.fromisoformat(
                            c["createTime"].replace("Z", "+00:00")
                        ).astimezone(local_tz)
                        d_str = c_dt.strftime("%Y-%m-%d")
                        t_str = c_dt.strftime("%H:%M")
                        # 保留当天交互的最晚时间
                        if d_str not in date_time_map or t_str > date_time_map[d_str]:
                            date_time_map[d_str] = t_str
                    except Exception:
                        pass

        # 兜底：若 chunk 中无时间戳，回退使用 modified_time / created_time
        if not date_time_map:
            mtime_str = idx["modified_time"] or idx["created_time"]
            if mtime_str:
                try:
                    dt_utc = datetime.fromisoformat(mtime_str.replace("Z", "+00:00"))
                    dt_local = dt_utc.astimezone(local_tz)
                    date_time_map[dt_local.strftime("%Y-%m-%d")] = dt_local.strftime("%H:%M")
                except Exception:
                    pass

        if not date_time_map:
            continue
~~~~~
~~~~~python.new
    for idx in indices:
        file_id = idx["file_id"]

        # 从索引的物化列直接读取跨日映射，彻底免除 N+1 原始 JSON 反序列化
        date_time_map: dict[str, str] = {}
        active_dates_str = idx.get("active_dates")
        
        if active_dates_str:
            try:
                date_time_map = json.loads(active_dates_str)
            except Exception:
                pass

        # 兼容尚未重建索引的旧数据兜底
        if not date_time_map:
            mtime_str = idx["modified_time"] or idx["created_time"]
            if mtime_str:
                try:
                    dt_utc = datetime.fromisoformat(mtime_str.replace("Z", "+00:00"))
                    dt_local = dt_utc.astimezone(local_tz)
                    date_time_map[dt_local.strftime("%Y-%m-%d")] = dt_local.strftime("%H:%M")
                except Exception:
                    pass

        if not date_time_map:
            continue
~~~~~

### 下一步建议
通过 Schema 升级和重建后，`/daily/timeline` 会恢复极速状态。此时您可以切回 Obsidian 工作区执行 `ne link-ai`。测试通过后，即可提交这批出色的重构。
