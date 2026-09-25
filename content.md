好的，我们现在开始修改。我将生成一个针对 `src/server/api.py` 的 Quipu 修复计划，彻底移除 API 请求主路径中的 `_ensure_index_bootstrapped` 函数及其调用，恢复看板接口的毫秒级响应。

## [WIP] fix(server): 移除接口层冗余的会话索引补全逻辑消除重复开销

### 错误分析

1. **死循环触发机制**: 在 `src/server/api.py` 中，`_ensure_index_bootstrapped()` 使用 `total_idx < total_raw`（即 `session_index` 记录数 < `file_cache` 记录数）作为补全触发条件。但在 3646 条原始缓存中，存在 10 条空会话或无有效 `turns` 的记录，解析函数 `parse_prompt_json` 会直接返回 `None` 且不写入 `session_index`。这导致 `total_idx` 恒等于 3636，条件 `3636 < 3646` 恒成立。
2. **并发 I/O 阻塞**: 前端刷新或切页时，会通过 `Promise.all` 并发请求 `/api/metrics` 和 `/api/sessions`。两个接口均在首行调用了该补全函数，引发双重并发的全量 3646 条记录扫描、反序列化与 upsert，导致每次刷新耗时数秒并打印两次补全日志。

### 用户需求

彻底移除 API 请求路径中已无需运行的 `_ensure_index_bootstrapped` 逻辑，消除重复遍历与写入开销，让看板接口恢复到毫秒级的纯 SQL 查询。

### 评论

这是一个非常必要且关键的性能修复。在 MVP 阶段，历史数据的二级索引已完全物化并持久化在 SQLite 中；增量同步模块 `sync.py` 也在拉取新文件时具备实时的单条索引写入能力。因此在 API 入口层拦截并全表扫描完全属于冗余负担，移除后将极大提升系统响应敏捷度。

### 目标

1. 从 `src/server/api.py` 中彻底删除 `_ensure_index_bootstrapped` 函数定义。
2. 在 `@router.get("/metrics")` 和 `@router.get("/sessions")` 路由处理函数中，删除对应的 `_ensure_index_bootstrapped()` 调用。

### 基本原理

通过删除冗余的检查与全量遍历逻辑，使得 `/api/metrics` 和 `/api/sessions` 直接走 `session_index` 表的索引查询（`query_indices`），将单次接口耗时从数秒降低至 10~20ms 以内，彻底消除不必要的 SQLite 锁竞争和 CPU 反序列化开销。

### 标签

#intent/fix #flow/ready #priority/high #comp/interfaces #concept/state #scope/core #scope/perf #ai/instruct #task/domain/storage #task/object/session-index #task/action/bug-fix #task/state/begin #task/status/active

---

### Script

#### Acts 1: 从 `src/server/api.py` 移除索引补全函数及接口调用

我们将从 `src/server/api.py` 中移除 `_ensure_index_bootstrapped` 函数，并移除其在 `/metrics` 与 `/sessions` 中的调用点。

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~old
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
~~~~~
~~~~~new
def notify_sync_event(event_type: str, payload: dict):
    """向所有在线前端推送 SSE 事件"""
    for q in list(_sync_event_queues):
        try:
            q.put_nowait({"event": event_type, "data": payload})
        except Exception:
            pass


def _get_range_start_iso(range_key: str) -> Optional[str]:
~~~~~

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~old
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
~~~~~
~~~~~new
@router.get("/metrics")
def get_metrics(range: str = "all"):
    """
    基于 session_index 表毫秒级聚合认知与交互指标（耗时 <10ms）。
    """
    range_start = _get_range_start_iso(range)
    indices = cache.query_indices(range_start_iso=range_start)
    return calculate_session_metrics(indices)


@router.get("/sessions")
def list_sessions(range: str = "all", limit: Optional[int] = None):
    """
    基于 session_index 极速返回会话列表，供前端 5000+ 虚拟滚动使用（耗时 <15ms）。
    """
    range_start = _get_range_start_iso(range)
    indices = cache.query_indices(range_start_iso=range_start, limit=limit)
~~~~~

### 下一步建议

- **刷新验证**: 执行以上 patch 后，直接在浏览器中刷新前端看板，观察后端终端输出中是否不再打印 `⚡ 正在增量补全 SQLite 会话索引`，并验证 `/api/metrics` 与 `/api/sessions` 是否以 <20ms 的速度瞬间返回。
- **提交变更**: 验证无误后，可以生成一个独立的 `[COMMIT]` 计划将此次修复提交到版本库中。
