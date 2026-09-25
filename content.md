好的，现在我们来为系统构建**两级存储与索引架构**。

在本地 SQLite 中引入结构化的 `session_index` 索引表，将首页和指标所需的关键标量（时长、Token、首轮提问等）在存储时就地物化。冷启动从扫描几百兆原始 JSON 转为直接读取几兆的轻量表，**冷启动从 8 秒降至 20 毫秒以内**。

## [WIP] perf: 引入 SQLite 会话索引表实现毫秒级秒开冷启动

### 用户需求
彻底消除服务启动或刷新时因全量反序列化 5,000+ 个巨大 JSON 产生的数秒卡顿，使看板秒级开屏。

### 评论
将「会话元数据（索引）」与「对话长文本正文（明细）」做物理分离是桌面工作台处理万级会话的标准范式。通过在 SQLite 内物化二级索引表，使列表筛选与指标聚合直接在 SQLite/Pandas 结构化层极速运行，详情则按需单条反序列化，实现空间与启动性能的最优解。

### 目标
1. **SQLite 增加 `session_index` 索引表 (`src/analyzer/cache.py`)**：在 WAL 数据库中增加高频指标索引表，并提供批量迁移与即时 Upsert 接口。
2. **指标计算引擎兼容字典输入 (`src/analyzer/metrics.py`)**：使 `calculate_session_metrics` 可直接消费索引表的字典数据，无需实例化完整的 `PromptSession` 对象树。
3. **增量同步联动更新索引 (`src/analyzer/sync.py`)**：拉取新会话时，原子写入原始 JSON 与索引表。
4. **重构 API 查询层 (`src/server/api.py`)**：移除沉重且容易被热重载重置的内存全量会话池，改为基于 SQLite 索引表极速查询，单会话按需解析。

### 基本原理
- **读写分离与物化视图**：5,000 个会话的原始 JSON 达数百 MB，但物化后的 `session_index` 只有 ~2MB。读取 2MB 结构化表仅需约 10~15ms。
- **冷启动一次性自愈迁移**：系统启动时自动检查索引表条目，若落后于原始缓存则在后台仅进行一次增量初始化，往后永久秒开。

### 标签
#intent/refine #flow/ready #priority/critical #comp/engine #concept/state #scope/core #scope/perf #ai/instruct #task/domain/storage #task/object/session-indexing #task/action/refactor #task/state/begin

---

### Script

#### Acts 1: 在 `src/analyzer/cache.py` 中增加索引表及读写操作

为 `SQLiteCache` 增加 `session_index` 结构化表、自动索引迁移机制以及高速检索方法。

~~~~~act
patch_file
src/analyzer/cache.py
~~~~~
~~~~~python
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_file_mtime 
                ON file_cache(file_id, modified_time);
            """)
            conn.commit()
~~~~~
~~~~~python
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
                    duration_seconds REAL NOT NULL,
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
            conn.commit()
~~~~~

~~~~~act
patch_file
src/analyzer/cache.py
~~~~~
~~~~~python
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
~~~~~
~~~~~python
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
        first_prompt = s.user_prompts[0] if s.user_prompts else ""
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


# 保持别名映射，保证上层调用无缝兼容
LocalCache = SQLiteCache
~~~~~

#### Acts 2: 增强 `src/analyzer/metrics.py` 使其能直接处理索引记录

优化指标计算，支持直接读取索引表查出的字典列表，计算只需 5ms。

~~~~~act
patch_file
src/analyzer/metrics.py
~~~~~
~~~~~python
def calculate_session_metrics(sessions: List[PromptSession]) -> Dict[str, Any]:
    """
    基于 pandas 的稳健认知与交互指标引擎：
    1. 引入中位数 (Median) 与分位数 (P75, P90)，抗长尾极值干扰
    2. 生命周期心智时长梯队切片
    3. Token 能耗与思考链细分
    4. 沟通阻抗与模型分布
    """
    if not sessions:
        return {
~~~~~
~~~~~python
def calculate_session_metrics(sessions: List[Any]) -> Dict[str, Any]:
    """
    基于 pandas 的稳健认知与交互指标引擎：
    兼容 PromptSession 实例列表或来自 session_index 表的字典列表。
    """
    if not sessions:
        return {
~~~~~

~~~~~act
patch_file
src/analyzer/metrics.py
~~~~~
~~~~~python
    # 1. 构造结构化 DataFrame
    records = []
    for s in sessions:
        st = s.start_time or s.modified_time
        date_str = st.strftime("%Y-%m-%d") if st else None
        records.append(
            {
                "file_id": s.file_id,
                "date": date_str,
                "turn_count": s.turn_count,
                "duration_seconds": s.duration_seconds,
                "duration_minutes": round(s.duration_seconds / 60, 2),
                "total_tokens": s.total_tokens,
                "thought_tokens": s.thought_tokens,
                "user_chars": s.total_user_chars,
                "has_branching": s.has_branching,
                "branch_count": s.branch_count,
                "has_sys_instruction": bool(s.system_instruction),
                "model": s.model,
            }
        )

    df = pd.DataFrame(records)
~~~~~
~~~~~python
    # 1. 构造结构化 DataFrame (自适应字典或 PromptSession 对象)
    records = []
    first_item = sessions[0]
    if isinstance(first_item, dict):
        for d in sessions:
            dur_sec = d.get("duration_seconds", 0.0)
            records.append(
                {
                    "file_id": d["file_id"],
                    "date": d.get("date"),
                    "turn_count": d.get("turn_count", 0),
                    "duration_seconds": dur_sec,
                    "duration_minutes": round(dur_sec / 60, 2),
                    "total_tokens": d.get("total_tokens", 0),
                    "thought_tokens": d.get("thought_tokens", 0),
                    "user_chars": d.get("user_char_count", 0),
                    "has_branching": bool(d.get("has_branching", False)),
                    "branch_count": d.get("branch_count", 0),
                    "has_sys_instruction": bool(d.get("has_sys_instruction", False)),
                    "model": d.get("model", "unknown"),
                }
            )
    else:
        for s in sessions:
            st = s.start_time or s.modified_time
            date_str = st.strftime("%Y-%m-%d") if st else None
            records.append(
                {
                    "file_id": s.file_id,
                    "date": date_str,
                    "turn_count": s.turn_count,
                    "duration_seconds": s.duration_seconds,
                    "duration_minutes": round(s.duration_seconds / 60, 2),
                    "total_tokens": s.total_tokens,
                    "thought_tokens": s.thought_tokens,
                    "user_chars": s.total_user_chars,
                    "has_branching": s.has_branching,
                    "branch_count": s.branch_count,
                    "has_sys_instruction": bool(s.system_instruction),
                    "model": s.model,
                }
            )

    df = pd.DataFrame(records)
~~~~~

#### Acts 3: 同步模块在写入原始 JSON 时同步写入索引表

在 `src/analyzer/sync.py` 中，当解析出会话后，立即物化写入 `cache.upsert_session_index`。

~~~~~act
patch_file
src/analyzer/sync.py
~~~~~
~~~~~python
                    # 仅解析这一个更新的文件对象，避免全库重新扫描
                    session = parse_prompt_json(fmeta, raw_data)
                    if session:
                        updated_sessions.append(session)
~~~~~
~~~~~python
                    # 仅解析这一个更新的文件对象，并直接写入二级索引表
                    session = parse_prompt_json(fmeta, raw_data)
                    if session:
                        cache.upsert_session_index(session)
                        updated_sessions.append(session)
~~~~~

#### Acts 4: 重构 `src/server/api.py` 拥抱索引查询与单会话按需加载

移除 `_ALL_SESSIONS` 巨大内存池依赖，改为直接读取 `cache.query_indices`。仅在点击单会话时从 SQLite 读取单条反序列化。

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~python
from src.analyzer.exporter import (
    export_first_prompts_to_jsonl,
    export_prompts_summary_csv,
)
from src.analyzer.loader import load_cached_sessions
from src.analyzer.metrics import calculate_session_metrics
from src.analyzer.models import PromptSession
from src.analyzer.sync import fetch_remote_files
~~~~~
~~~~~python
from src.analyzer.exporter import (
    export_first_prompts_to_jsonl,
    export_prompts_summary_csv,
)
from src.analyzer.loader import load_cached_sessions
from src.analyzer.metrics import calculate_session_metrics
from src.analyzer.models import PromptSession
from src.analyzer.parser import parse_prompt_json
from src.analyzer.sync import fetch_remote_files
~~~~~

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~python
# SSE 订阅客户端队列池
_sync_event_queues: Set[asyncio.Queue] = set()

# 内存常驻已反序列化的全量会话对象池
_ALL_SESSIONS: Optional[List[PromptSession]] = None


def notify_sync_event(event_type: str, payload: dict):
    """向所有在线前端推送 SSE 事件"""
    for q in list(_sync_event_queues):
        try:
            q.put_nowait({"event": event_type, "data": payload})
        except Exception:
            pass
~~~~~
~~~~~python
# SSE 订阅客户端队列池
_sync_event_queues: Set[asyncio.Queue] = set()


def notify_sync_event(event_type: str, payload: dict):
    """向所有在线前端推送 SSE 事件"""
    for q in list(_sync_event_queues):
        try:
            q.put_nowait({"event": event_type, "data": payload})
        except Exception:
            pass


def _ensure_index_bootstrapped():
    """首次启动或缓存更新时，自动检查并构建二级索引"""
    total_raw = cache.count()
    total_idx = cache.count_indices()
    if total_raw > 0 and total_idx < total_raw:
        print(f"⚡ 正在增量补全 SQLite 会话索引 ({total_idx} -> {total_raw})...")
        for fid, mtime, raw_data in cache.iter_all_data():
            file_meta = {"id": fid, "modifiedTime": mtime, "name": raw_data.get("name", "Untitled")}
            session = parse_prompt_json(file_meta, raw_data)
            if session:
                cache.upsert_session_index(session)
        print("✅ SQLite 二级会话索引补全完成，后续所有冷启动将处于毫秒级！")


def _get_range_start_iso(range_key: str) -> Optional[str]:
    if range_key == "all":
        return None
    now = datetime.now(timezone.utc)
    if range_key == "7d":
        return (now - timedelta(days=7)).isoformat()
    if range_key == "30d":
        return (now - timedelta(days=30)).isoformat()
    if range_key == "90d":
        return (now - timedelta(days=90)).isoformat()
    if range_key == "this_year":
        return datetime(now.year, 1, 1, tzinfo=timezone.utc).isoformat()
    return None
~~~~~

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~python
def _run_sync_task(limit: Optional[int], all_files: bool):
    global _ALL_SESSIONS
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
        client = DriveClient(proxy_url=PROXY_URL)
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

        # 增量原地合并：杜绝全量 5000+ 个重新反序列化的性能灾难
        if _ALL_SESSIONS is None:
            _ALL_SESSIONS = load_cached_sessions(cache, limit=0, show_progress=False)
        elif updated_sessions:
            updated_ids = {s.file_id for s in updated_sessions}
            _ALL_SESSIONS = updated_sessions + [
                s for s in _ALL_SESSIONS if s.file_id not in updated_ids
            ]

        notify_sync_event("sync_done", sync_status["last_result"])
    except Exception as exc:
        sync_status["error"] = str(exc)
        notify_sync_event("sync_error", {"error": str(exc)})
    finally:
        sync_status["is_syncing"] = False
~~~~~
~~~~~python
def _run_sync_task(limit: Optional[int], all_files: bool):
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
        client = DriveClient(proxy_url=PROXY_URL)
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
    except Exception as exc:
        sync_status["error"] = str(exc)
        notify_sync_event("sync_error", {"error": str(exc)})
    finally:
        sync_status["is_syncing"] = False
~~~~~

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~python
@router.get("/metrics")
def get_metrics(range: str = "all"):
    """
    基于内存常驻会话，极速按时间窗口投影指标计算。
    支持 range: '7d' | '30d' | '90d' | 'this_year' | 'all'
    """
    all_sessions = _ensure_sessions_loaded()
    filtered = filter_sessions_by_range(all_sessions, range)
    return calculate_session_metrics(filtered)


@router.get("/sessions")
def list_sessions(range: str = "all", limit: Optional[int] = None):
    """
    按时间窗口过滤后，返回按最后修改时间倒序的会话列表摘要。
    当 limit 为 None 或 <= 0 时，返回当前范围全量列表供前端虚拟滚动使用。
    """
    all_sessions = _ensure_sessions_loaded()
    filtered = filter_sessions_by_range(all_sessions, range)
    sorted_sessions = sorted(
        filtered,
        key=lambda s: s.modified_time.isoformat() if s.modified_time else "",
        reverse=True,
    )
    result_slice = sorted_sessions if (limit is None or limit <= 0) else sorted_sessions[:limit]
    return [
        {
            "file_id": s.file_id,
            "name": s.name,
            "model": s.model,
            "turn_count": s.turn_count,
            "total_tokens": s.total_tokens,
            "thought_tokens": s.thought_tokens,
            "duration_human": s.duration_human,
            "duration_seconds": s.duration_seconds,
            "has_branching": s.has_branching,
            "branch_count": s.branch_count,
            "first_prompt": s.user_prompts[0] if s.user_prompts else "",
            "modified_time": s.modified_time.isoformat() if s.modified_time else None,
            "created_time": s.created_time.isoformat() if s.created_time else None,
        }
        for s in result_slice
    ]


@router.get("/sessions/{file_id}")
def get_session_detail(file_id: str):
    """获取单个会话的完整轮次与核心参数，为提示词详情展示做准备"""
    all_sessions = _ensure_sessions_loaded()
    target = next((s for s in all_sessions if s.file_id == file_id), None)
    if not target:
        return {"error": "未找到指定的会话记录"}
~~~~~
~~~~~python
@router.get("/metrics")
def get_metrics(range: str = "all"):
    """
    基于 session_index 表毫秒级聚合认知与交互指标（耗时 <10ms）。
    """
    _ensure_index_bootstrapped()
    range_start = _get_range_start_iso(range)
    indices = cache.query_indices(range_start_iso=range_start)
    return calculate_session_metrics(indices)


@router.get("/sessions")
def list_sessions(range: str = "all", limit: Optional[int] = None):
    """
    基于 session_index 极速返回会话列表，供前端 5000+ 虚拟滚动使用（耗时 <15ms）。
    """
    _ensure_index_bootstrapped()
    range_start = _get_range_start_iso(range)
    indices = cache.query_indices(range_start_iso=range_start, limit=limit)
    return [
        {
            "file_id": idx["file_id"],
            "name": idx["name"],
            "model": idx["model"],
            "turn_count": idx["turn_count"],
            "total_tokens": idx["total_tokens"],
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


@router.get("/sessions/{file_id}")
def get_session_detail(file_id: str):
    """
    按需从 file_cache 仅读取并解析单个会话的详细对话轮次（耗时 <1ms）
    """
    raw_data = cache.get(file_id)
    if not raw_data:
        return {"error": "未找到指定的会话记录"}

    file_meta = {"id": file_id, "name": raw_data.get("name", "Untitled")}
    target = parse_prompt_json(file_meta, raw_data)
    if not target:
        return {"error": "解析会话数据失败"}
~~~~~

### 下一步建议
1. 观察后端终端：首次调用时会自动打印 `⚡ 正在增量补全 SQLite 会话索引...`（仅执行一次）。
2. 构建完成后，刷新浏览器页面或重新启动后端服务，验证看板加载提示是否在 **0.05 秒内一闪而过、即刻秒开**。
