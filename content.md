好的，我已准备好对应的修复方案。我们将针对导致 WAL 持续膨胀和 FTS 重建卡死的两个根本原因，分别修改 `src/analyzer/cache.py`（移除 `UNINDEXED` 并增加索引清空重建方法）和 `src/server/api.py`（优化 `/reindex` 接口的读写事务隔离与定期 Checkpoint）。

## [WIP] fix: 修复 SQLite FTS5 索引全表扫描与 WAL 膨胀阻塞问题

### 错误分析
1. **FTS5 `file_id UNINDEXED` 导致 $O(N^2)$ 全表扫描**:
   在 `cache.py` 中，`session_fts` 将 `file_id` 声明为 `UNINDEXED`。而在更新和重建索引时调用 `DELETE FROM session_fts WHERE file_id = ?`，由于缺少索引加速，SQLite 必须对巨型长文本虚表执行全表扫描。在上万条记录的循环中，扫描次数呈平方级膨胀，造成 CPU 跑满、磁盘 I/O 剧增并表现为接口假死。
2. **长生命周期读游标阻塞 WAL 截断与合并**:
   `/reindex` 接口原实现通过 `cache.iter_all_data()` 流式遍历，整个循环过程中长事务读锁始终未释放。根据 SQLite WAL 原理，活跃读事务会阻止 WAL Checkpoint 对日志文件进行截断与回收，导致每次写入的新脏页不断追加至 `.wal` 文件，出现数百兆甚至数吉字节的异常体积膨胀。

### 用户需求
修复 `/reindex` 接口引发的 WAL 日志文件无限增长、服务假死以及全文搜索失效的问题，确保重建过程高效、安全且磁盘占用受控。

### 评论
该修复是系统在大规模对话数据（1.7GB+）下稳定运行的关键基础设施保障。通过解除未索引字段的删除惩罚，并拆分读取事务与写入批次，能够消除死锁与无限日志膨胀风险。

### 目标
1. 在 `src/analyzer/cache.py` 中移除 `session_fts` 的 `file_id UNINDEXED` 约束。
2. 在 `SQLiteCache` 中新增 `clear_indices` 方法，支持重建前以 DDL 级别快速重置虚表与二级索引。
3. 优化 `src/server/api.py` 的 `/reindex` 接口：先获取 ID 列表释放读锁，再分批构建索引，并在循环中按步长执行非阻塞 Checkpoint，最后执行截断与真空清理。

### 基本原理
1. 移除 `UNINDEXED` 后，FTS5 会为 `file_id` 建立倒排索引，使得单条更新/删除开销从 $O(N)$ 降至 $O(1)$ 或 $O(\log N)$。
2. 将全量读取拆分为“先提取轻量 ID 列表并立即关闭读事务，再独立按需提取写入”，消除了长时间阻塞 WAL Checkpoint 的读锁屏障。
3. 批量重建前通过 `clear_indices` 整体 Drop 旧表，避免逐行执行高成本的单条 DELETE 操作。

### 标签
#intent/fix #flow/ready #priority/high #comp/engine #concept/state #concept/executor #scope/core #ai/instruct #task/domain/storage #task/object/sqlite-fts-wal #task/action/bug-fix #task/state/begin #task/status/active

---

### Script

#### Acts 1: 修复 SQLiteCache 的 FTS 表定义并增加重建清空方法

我们将修改 `src/analyzer/cache.py`，移除 `file_id UNINDEXED` 并添加 `clear_indices` 方法。

~~~~~act
patch_file
src/analyzer/cache.py
~~~~~
~~~~~python.old
            # 全文检索虚表：采用 trigram 分词器支持中文、英文及代码子串匹配
            cursor.execute("""
                CREATE VIRTUAL TABLE IF NOT EXISTS session_fts USING fts5(
                    file_id UNINDEXED,
                    title,
                    system_instruction,
                    content,
                    tokenize = 'trigram'
                );
            """)
            conn.commit()
~~~~~
~~~~~python.new
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
~~~~~

~~~~~act
patch_file
src/analyzer/cache.py
~~~~~
~~~~~python.old
    def vacuum(self):
        """整理并压缩数据库碎片"""
        with self._get_connection() as conn:
            conn.execute("VACUUM;")

    def iter_all_data(self) -> Iterator[Tuple[str, str, Dict[str, Any]]]:
~~~~~
~~~~~python.new
    def vacuum(self):
        """整理并压缩数据库碎片"""
        with self._get_connection() as conn:
            conn.execute("VACUUM;")

    def clear_indices(self):
        """清空二级索引与 FTS 虚表并重新初始化结构（重建前调用）"""
        with self._get_connection() as conn:
            conn.execute("DROP TABLE IF EXISTS session_fts;")
            conn.execute("DELETE FROM session_index;")
            conn.commit()
        self._init_db()

    def iter_all_data(self) -> Iterator[Tuple[str, str, Dict[str, Any]]]:
~~~~~

#### Acts 2: 重构 `/reindex` 接口以消除长读锁并分批 Checkpoint

我们将修改 `src/server/api.py` 中的 `reindex_cache` 接口实现。

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~python.old
@router.post("/reindex")
def reindex_cache():
    """基于本地 SQLite file_cache 增量重新生成并同步 session_index 及 session_fts（耗时 <2s）"""
    count = 0
    for file_id, mtime, raw_data in cache.iter_all_data():
        file_meta = {
            "id": file_id,
            "modifiedTime": mtime,
            "name": raw_data.get("name", "Untitled"),
        }
        session = parse_prompt_json(file_meta, raw_data)
        if session:
            cache.upsert_session_index(session)
            cache.upsert_session_fts(session)
            count += 1

    # 批量建立索引结束后，立即截断 WAL 日志文件
    try:
        cache.checkpoint(truncate=True)
    except Exception as exc:
        print(f"⚠️ Reindex Checkpoint 异常: {exc}")

    return {"status": "success", "reindexed_count": count}
~~~~~
~~~~~python.new
@router.post("/reindex")
def reindex_cache():
    """基于本地 SQLite file_cache 极速重建 session_index 及 session_fts"""
    # 1. 一次性获取所有 file_id 并立即释放读锁，保证后续 WAL 可被截断
    file_ids = []
    with cache._get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT file_id FROM file_cache;")
        file_ids = [row["file_id"] for row in cursor.fetchall()]

    # 2. 清空旧索引表与 FTS 虚表，避免循环中触发单条全表扫描与巨量 DELETE 操作
    cache.clear_indices()

    count = 0
    for file_id in file_ids:
        raw_data = cache.get(file_id)
        if not raw_data:
            continue

        file_meta = {
            "id": file_id,
            "modifiedTime": raw_data.get("modifiedTime"),
            "name": raw_data.get("name", "Untitled"),
        }
        session = parse_prompt_json(file_meta, raw_data)
        if session:
            cache.upsert_session_index(session)
            cache.upsert_session_fts(session)
            count += 1

            # 3. 每处理 500 条主动触发一次 Checkpoint，平抑 WAL 体积
            if count % 500 == 0:
                try:
                    cache.checkpoint(truncate=False)
                except Exception:
                    pass

    # 4. 彻底合并 WAL 并进行磁盘空间整理
    try:
        cache.checkpoint(truncate=True)
        cache.vacuum()
    except Exception as exc:
        print(f"⚠️ Reindex Checkpoint/Vacuum 异常: {exc}")

    return {"status": "success", "reindexed_count": count}
~~~~~

### 下一步建议

1. **执行重构接口调用**：
   在应用修改后，重启 FastAPI 服务并再次发起重建请求：
   ```bash
   curl -X POST http://127.0.0.1:8000/api/reindex
   ```
2. **观察文件与资源状态**：
   在终端运行 `ls -lh .cache/` 检查 `cache.db-wal` 的体积，确认其是否保持在几十 KB 到几 MB 之间，并能够在重建结束后被归零/截断。
3. **功能验证**：
   通过前端搜索框输入 2 个字符以上的关键词（例如中文字词或代码片段），验证 `snippet` 高亮片段回显及响应延迟。
