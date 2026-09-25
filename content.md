我现在为你实施 WAL 膨胀问题的根治方案。

我们将通过三层防线来解决：
1. **数据库初始化防护**：在连接初始化时增加 `PRAGMA wal_autocheckpoint = 1000;`，确保自动检查点处于活跃状态。
2. **连接生命周期与 Checkpoint 能力**：在 `SQLiteCache` 中提供 `checkpoint(mode="TRUNCATE")` 与 `vacuum()` 维护函数。
3. **批量与同步动作自动收敛**：在增量同步（`sync.py`）结束与全量重建索引（`api.py` 的 `/reindex`）之后，主动调用 `checkpoint(TRUNCATE)`，并在后台启动脚本中先执行一次即时截断回写，将当前 2.1GB WAL 迅速压缩归零。

## [WIP] fix(cache): 根治 SQLite WAL 日志文件无限膨胀与磁盘占用问题

### 错误分析
1. **长事务/批量写入未触发截断**：在执行 `reindex` 或批量同步时，FTS 与 index 写入频繁，SQLite 默认的 `PASSIVE` 检查点遇到活跃连接无法完成全局截断，导致 WAL 只能单向向后追加。
2. **缺乏显式清理机制**：系统未暴露 `wal_checkpoint(TRUNCATE)` 接口，当大量数据导入后未显式通知 SQLite 释放 WAL 文件空间。

### 用户需求
彻底根治 `.cache/cache.db-wal` 达到 2.1GB 并不缩小的问题，使数据及时刷回主库并自动释放 WAL 文件磁盘占用。

### 评论
在开启 WAL 高并发模式的应用中，主动维护 Checkpoint 水位是保证数据库长周期健康运行的标准范式。在批量写入阶段结束后显式执行 `TRUNCATE` 既不会破坏并发读取性能，又能保证磁盘占用可控。

### 目标
1. 在 `cache.py` 中初始化 `PRAGMA wal_autocheckpoint = 1000`。
2. 在 `SQLiteCache` 类中实现 `checkpoint` 与 `vacuum` 方法。
3. 在 `sync.py` 增量同步结束及 `api.py` 的 `/reindex` 接口结束时自动调用 `cache.checkpoint(truncate=True)`。
4. 提供独立的维护检查脚本并在本地执行一次即时截断收敛当前 2.1GB WAL。

### 基本原理
1. `PRAGMA wal_checkpoint(TRUNCATE)` 会等待当前已完成的事务，将 WAL 中的全部脏页同步写回主数据库 `cache.db`，然后将 WAL 文件截断为 0 字节。
2. 在批量同步或重建索引的生命周期终点执行检查点，是开销最低且最彻底的资源回收时机。

### 标签
#intent/fix #flow/ready #priority/high #comp/engine #comp/runtime #concept/state #scope/core #ai/instruct #task/domain/storage #task/object/sqlite-wal-checkpoint #task/action/bug-fix #task/state/begin #task/status/active

---

### Script

#### Acts 1: 升级 `src/analyzer/cache.py` 增加 WAL 自动检查点与截断方法

增加 `wal_autocheckpoint` 配置以及 `checkpoint()`、`vacuum()` 方法。

~~~~~act
patch_file
src/analyzer/cache.py
~~~~~
~~~~~python
    def _init_db(self):
        """初始化表结构并配置 WAL 高性能模式"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("PRAGMA journal_mode=WAL;")
            cursor.execute("PRAGMA synchronous=NORMAL;")
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS file_cache (
~~~~~
~~~~~python
    def _init_db(self):
        """初始化表结构并配置 WAL 高性能模式"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("PRAGMA journal_mode=WAL;")
            cursor.execute("PRAGMA synchronous=NORMAL;")
            cursor.execute("PRAGMA wal_autocheckpoint=1000;")
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS file_cache (
~~~~~

~~~~~act
patch_file
src/analyzer/cache.py
~~~~~
~~~~~python
    def count(self) -> int:
        """获取当前缓存记录总条目数"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) AS total FROM file_cache;")
            row = cursor.fetchone()
            return row["total"] if row else 0
~~~~~
~~~~~python
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
~~~~~

#### Acts 2: 在同步模块 `src/analyzer/sync.py` 增量完成后触发 Checkpoint

当增量文件拉取和索引更新完成后，立即执行一次截断式 Checkpoint。

~~~~~act
patch_file
src/analyzer/sync.py
~~~~~
~~~~~python
            pbar.set_postfix(
                {"命中(跳过)": cache_hit_count, "云端拉取": download_count}
            )
            if progress_callback:
                progress_callback(idx, total_valid, cache_hit_count, download_count)

    return total_valid, cache_hit_count, updated_sessions
~~~~~
~~~~~python
            pbar.set_postfix(
                {"命中(跳过)": cache_hit_count, "云端拉取": download_count}
            )
            if progress_callback:
                progress_callback(idx, total_valid, cache_hit_count, download_count)

    # 增量拉取与索引写入完成后，主动将 WAL 日志完整合并回主数据库并截断释放磁盘
    try:
        cache.checkpoint(truncate=True)
    except Exception as exc:
        print(f"⚠️ WAL Checkpoint 异常: {exc}")

    return total_valid, cache_hit_count, updated_sessions
~~~~~

#### Acts 3: 在 `src/server/api.py` 的 `/reindex` 接口后执行 Checkpoint

在全量重建完二级索引与全文索引后，立即合并并释放 WAL。

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~python
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
    return {"status": "success", "reindexed_count": count}
~~~~~
~~~~~python
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

#### Acts 4: 执行即时清理脚本收敛现存的 2.1GB WAL 文件

通过 shell 执行一次即时归并截断。

~~~~~
python3 -c "
from src.analyzer.cache import SQLiteCache
cache = SQLiteCache(cache_dir='.cache')
print('正在将 WAL 脏页完整刷回主库并执行 TRUNCATE...')
res = cache.checkpoint(truncate=True)
print('Checkpoint 状态 (busy, log_pages, checkpointed):', res)
"
ls -lh .cache/
~~~~~

### 下一步建议

1. **查看磁盘回收结果**：
   运行命令查看 `.cache` 目录大小，确认 `cache.db-wal` 已截断收缩为 0 或极小体积：
   ```bash
   du -h .cache/*
   ```
2. **（可选）执行一次碎片整理**：
   如果希望进一步压缩 `cache.db` 主文件本身的空闲页，可以运行：
   ```bash
   python3 -c "from src.analyzer.cache import SQLiteCache; SQLiteCache().vacuum()"
   ```
