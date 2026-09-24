好的，前后端工程结构与 Chart.js 可视化看板的基础设施已经全部完成并就绪。现在将这次重构与功能搭建作为一个完整的交付单元提交到 Git 仓库。

我将生成一个 `[COMMIT]` 计划，执行暂存与提交操作。

## [COMMIT] feat: 搭建前后端分离工程并集成 Chart.js 可视化看板

### 用户需求
确认前端脚手架搭建、后端 API 服务接入以及 Chart.js 图表修复已就绪，创建 Git 提交以归档该里程碑。

### 评论
本次工作完成了项目从纯 CLI 分析器向“前后端分离的个人认知与交互审计系统”的结构跃迁。后端通过 FastAPI 暴露纯离线计算与增量同步能力，前端基于 Preact Signals 和 Chart.js 实现了轻量高效的可视化面板，奠定了后续进一步挖掘认知建议的基础。

### 目标
1. 将新增与修改的前后端工程配置文件、源码及图表组件纳入 Git 暂存区。
2. 创建符合 Conventional Commits 规范的详尽提交信息。

### 基本原理
按照 Git 分布式架构理念与规范，所有通过验证的文件系统变更必须通过独立的 `[COMMIT]` 计划原子性地固化到版本控制系统中，不掺杂任何破坏性文件修改操作。

### 标签
#intent/build #flow/ready #priority/high #comp/build #comp/cli #comp/ui #concept/ui #concept/config #scope/core #scope/ux #ai/instruct #task/domain/ui #task/object/frontend-backend-scaffold #task/action/implementation #task/state/end #task/status/completed

---

### Script

#### Acts 1: 提交前后端工程与图表看板代码

将新增的 `frontend/` 目录、`src/server/` 服务层以及更新后的 `pyproject.toml`、`main.py` 和 `metrics.py` 提交至本地仓库。

~~~~~act
git_add
.
~~~~~

~~~~~act
git_commit
~~~~~
~~~~~text
feat(workspace): 初始化前后端分离工程并集成 Chart.js 可视化看板

- 后端封装 FastAPI 独立数据服务层 (src/server/)，提供 /api/metrics, /api/sessions 与 /api/sync 接口
- main.py 扩展 serve 子命令，支持一键启动 uvicorn 本地服务器
- metrics.py 增加基于日期的 daily_trends 时间序列聚合，支持时序统计
- 初始化 frontend/ 现代化前端工具链 (Vite + TS + Preact + Preact Signals + Tailwind + Biome)
- 引入 Chart.js 并构建暗色风格可视化组件：TokenTrendChart (趋势折线图)、DurationTiersChart (时长环形图)、ModelDistributionChart (模型条形图)
- 补全按需控制器注册以保证图表组件稳定自适应渲染
~~~~~

### 下一步建议
- **数据流完善**：如果本地缓存尚未拉取最新数据，可执行 `python main.py fetch -n 50`，或在前端界面点击「增量同步 (Fetch 50)」拉取数据观察真实图表呈现。
- **时间范围切片**：在前端为 `TokenTrendChart` 增加日期筛选控制器（如“最近 7 天”、“最近 30 天”、“全量”），提升大时间跨度下的图表可读性。
- **提问模式洞察**：开始推进针对長会话追问模式（Follow-up Smell）与主题聚类的分析面板建设。
