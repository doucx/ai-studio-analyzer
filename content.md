好的，我们已经完成了代码修改与离线工具的开发，并通过实际运行探针验证了 SQLite 完整性与各项核心指标。现在将这一系列改进打包为一个完整的提交单元。

## [COMMIT] fix(storage): 修复 FTS5 索引全表扫描与 WAL 膨胀，并引入离线重建与健康度诊断探针

### 错误分析
1. **FTS5 字段未索引导致死锁级全表扫描**:
   在之前的设计中，`session_fts` 将 `file_id` 标注为 `UNINDEXED`，使得每次会话更新时执行的 `DELETE FROM session_fts WHERE file_id = ?` 必须遍历整张包含海量长文本的全文虚表，在数千次循环中引发 $O(N^2)$ 的全表扫描，导致 CPU 占满与接口无响应。
2. **长生命周期读事务锁死 WAL 截断机制**:
   原 `/reindex` 接口使用 `cache.iter_all_data()` 进行流式游标读取，未在写入前释放读锁。活跃读事务阻止了 SQLite 将 WAL 脏页截断合并到主数据库，导致每次写入均追加至 `.wal` 文件，造成体积不可控膨胀至数百兆字节。

### 用户需求
修复重构索引时引发的 WAL 异常膨胀与进程卡死问题，提供带进度条的交互式离线重构工具，并实现对数据库物理健康度与业务认知假设的全面离线审计。

### 评论
这次改动从根本上加固了存储层的高并发与大数据量吞吐能力。修复了 FTS5 倒排索引的定位缺陷与事务生命周期问题，并通过新增的专用诊断与重建工具使大型数据库（2.6GB+）的维护变得高度可观测与透明。

### 目标
1. 将 `cache.py` 与 `api.py` 的架构修复加入版本控制。
2. 将独立的带有进度监控与 WAL 水位监测的 `reindex_cli.py` 工具入库。
3. 将具备零锁保护与分位数假定验证的 `inspect_health.py` 探针工具入库。
4. 创建规范的 Conventional Commit 记录。

### 基本原理
按照系统工程原则，将对核心引擎的 Bug 修复与配套的离线运维/诊断探针作为一个高内聚的工作单元提交，确保代码库具备完备的生产级维护与自检能力。

### 标签
#intent/fix #flow/ready #priority/high #comp/engine #concept/state #scope/core #ai/instruct #task/domain/storage #task/object/sqlite-fts-wal #task/action/bug-fix #task/state/end #task/status/completed

---

### Script

#### Acts 1: 提交变更

我们将修改后的缓存逻辑、API 重建实现以及新创建的离线诊断工具添加到 Git 暂存区并生成提交。

~~~~~act
git_add
src/analyzer/cache.py
src/server/api.py
reindex_cli.py
inspect_health.py
~~~~~

~~~~~act
git_commit
~~~~~
~~~~~text
fix(storage): resolve FTS5 table scan hang and WAL bloat, add CLI reindex and health tools

- Remove UNINDEXED attribute on session_fts(file_id) to eliminate O(N^2) full-table scan during upsert/delete operations.
- Refactor /reindex endpoint in api.py: release read-cursor locks early to allow WAL checkpoints, and add batched checkpoints.
- Add reindex_cli.py: standalone CLI reindex tool with tqdm progress bar and live WAL file size monitoring.
- Add inspect_health.py: read-only inspector for SQLite physical integrity, schema consistency, quantile distribution, and outlier detection.
~~~~~

### 下一步建议
- **处理超大会话 payload 瘦身**: 根据探针检测结果（存在 90MB 的单体会话），建议优化 `src/server/api.py` 的 `/api/sessions/{file_id}` 接口，对 `inlineFile` 中的超大 Base64 数据进行惰性截断或元数据替代，降低前端传输延迟。
- **修正持续时长算法**: 针对探针中暴露出的时长中位数为 `0.0` 问题，更新 `src/analyzer/models.py` 中的 `duration` 推导逻辑，引入 `created_time` 与 `modified_time` 跨度作为缺失 Chunk 时间戳时的兜底策略。
