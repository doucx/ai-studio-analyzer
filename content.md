好的，我们已经完成了平铺 JSON 缓存向 SQLite (WAL 模式) 的升级、过渡接口与临时脚本的清理，以及网络拉取（`fetch`）与离线分析（`analyze`）的完全解耦。

现在将这些变更作为一个完整的逻辑单元提交到 Git 仓库。

## [COMMIT] feat(storage,cli): 将缓存升级为 SQLite 并解耦为 Git 风格子命令体系

### 用户需求
将本次缓存层重构为 SQLite、数据迁移、过渡清理，以及将 CLI 架构解耦为 Git 风格子命令（`fetch` / `analyze` / `pull`）的工作成果进行正式 Git 提交。

### 评论
本次改造是一次重要的基础设施重构：消除了 3k+ 平铺小 JSON 文件对文件系统的 I/O 压力，同时打破了以前“网络同步”与“数据计算”强绑定的局限。本地 SQLite 成为分布式事实中心，使得毫秒级、全离线的全量会话指标审计成为可能。

### 目标
1. 将修改后的核心模块及新增文件添加到 Git 暂存区。
2. 提交包含详细背景、架构演进与设计原理的 Commit Message。

### 基本原理
按照 Quipu 协议规范，将所有文件系统的逻辑变更在外部确认稳定后，单独在一个独立的 `[COMMIT]` 计划中完成 Git 固化，确保操作的隔离性与版本历史的清晰整洁。

### 标签
#intent/build #flow/ready #priority/high #comp/runtime #comp/cli #concept/state #concept/executor #scope/core #scope/ux #scope/dx #ai/instruct #task/domain/storage #task/object/sqlite-cache-and-git-cli #task/action/integration #task/state/end #task/status/completed

---

### Script

#### Acts 1: 提交缓存重构与 Git 风格子命令架构

我们将变更的文件加入暂存区并创建结构化提交。

~~~~~act
git_add
src/analyzer/cache.py
src/analyzer/parser.py
src/analyzer/sync.py
src/analyzer/loader.py
inspect_schema.py
main.py
~~~~~

~~~~~act
git_commit
~~~~~
~~~~~text
feat(storage,cli): upgrade cache to SQLite and decouple into Git-style subcommands

1. Storage Layer Refactoring:
   - Replaced flat JSON cache in .cache/ with single-file SQLite database (cache.db).
   - Enabled WAL mode (PRAGMA journal_mode=WAL) and synchronous=NORMAL for concurrent, sub-millisecond lookups.
   - Built stream iterator (iter_all_data) and count APIs for large-scale analysis.

2. Architecture Decoupling (Git-Style Subcommands):
   - Fully decoupled remote fetch from local offline analysis.
   - Added `fetch` subcommand: light-weight incremental delta fetch from Google Drive directly into SQLite.
   - Added `analyze` subcommand: purely offline, instant full-dataset metrics aggregation from local SQLite.
   - Added `pull` subcommand: convenient combination (fetch recent updates + full local analysis).

3. Enhancements:
   - Extracted `sync.py` and `loader.py` for clear single-responsibility design.
   - Upgraded parser and schema inspector to work seamlessly from cached payloads without remote dependencies.
~~~~~

### 下一步建议

- **引入全文搜索 (FTS5)**：在 `cache.db` 中建立 SQLite FTS5 虚表，实现类似 `python main.py search <keyword>` 的全量对话文本秒级搜索功能。
- **扩展认知维度指标**：利用提取到的 Schema 字段（如 `isThought`、`thinkingBudget`、`branchParent`），在 `metrics.py` 中增加“思考链消耗比”和“多轮重试分叉率”等认知摩擦力指标。
- **构建轻量 Web-UI**：准备基于已有的 SQLite 存储，使用 FastAPI + Vite + Preact 搭建本地可视化看板。
