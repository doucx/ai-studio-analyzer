# AI Studio Analyzer

> **个人认知与交互审计系统 · Google AI Studio 深度对话挖掘与元工作流沉淀**

AI Studio Analyzer 是一个专为 **Google AI Studio** 设计的认知审计与工作流分析系统。它通过 Google Drive API 自动化拉取并深度解析云端持久化的会话 JSON，建立本地高性能 SQLite WAL 离线缓存，提供兼具时序能耗、思维摩擦力与生命周期梯队的现代化交互仪表盘，助你洞察个人思维瓶颈、提炼提问 SOP 并掌握精力分布。

---

## 🌟 核心特性

- 🧠 **全景交互与认知能耗审计**
  - **心智时长梯队（Duration Tiers）**：切片统计「即时快问 (<10m)」、「聚焦推进 (10~60m)」、「深度攻坚 (1~6h)」与「跨日长线 (>6h)」，过滤长尾极值。
  - **稳健统计指标**：全面采用中位数（P50）与分位数（P75、P90），真实还原单轮问答与多轮攻坚的真实耗时与轮次分布。
  - **思维摩擦力（Friction Stats）**：统计会话的分叉（Branching）、编辑追问与重新生成（Regenerate）频次，精确定位阻抗瓶颈。
  - **Thinking 深度感知**：精准区分并统计 Gemini 2.0 的思考链（Thinking Tokens）与常规回复能耗。

- ⏱️ **全局动态时空切片（Time Range Slicing）**
  - 支持 **「7天」**、**「30天」**、**「90天」**、**「今年」** 与 **「全部」** 五档切片。
  - 核心指标卡、每日 Token 趋势图、时长环形图、模型分布条形图、会话表格及导出任务均实现**毫秒级全盘时空对齐**。

- ⚡️ **离线优先与 SQLite WAL 高性能引擎**
  - 后端基于 SQLite 开启 WAL（Write-Ahead Logging）模式，全量数据常驻内存对象池，毫秒级完成 Pandas 统计重投影。
  - 云端交互采用类似 Git 的增量 Fetch 机制（对比 `modifiedTime`），只拉取新修改的会话，兼具速度与低资源消耗。

- 🖥️ **轻量响应式交互看板**
  - 基于 Preact Signals + Tailwind CSS + Chart.js 构建，暗色工模风格（Zinc Dark），秒级加载，平滑切换。
  - 支持后台异步触发增量同步（Fetch 50）并轮询同步进度。

- 📥 **定向数据清洗与导出**
  - **CSV 明细报表**：按当前激活的时间切片导出包含轮次、时长、Token 消耗、分支标记的会话概览。
  - **JSONL 清洗集**：提取首轮提问（First Prompt），附带能耗与模型标签，可直接喂给 LLM 进行意图聚类与 SOP 模板提取。

---

## 🏗️ 系统架构

```text
ai-studio-analyzer/
├── frontend/                     # Preact + Vite + Tailwind + Chart.js 现代前端看板
│   ├── src/
│   │   ├── components/charts/    # 环形图、条形图、时序折线图
│   │   ├── types/                # 前端 TypeScript 接口类型定义
│   │   ├── app.tsx               # 看板主页面 (Signals 状态响应)
│   │   └── main.tsx              # 应用启动挂载入口
│   └── package.json
├── src/
│   ├── analyzer/                 # 核心分析与解析库
│   │   ├── cache.py              # 基于 SQLite WAL 的单文件本地缓存引擎
│   │   ├── drive.py              # 基于 requests 的 Google Drive API (内置代理与 OAuth)
│   │   ├── exporter.py           # CSV 统计报表与 JSONL 语料导出器
│   │   ├── loader.py             # SQLite 本地离线对象流式加载器
│   │   ├── metrics.py            # 基于 Pandas 的稳健指标与时序趋势计算
│   │   ├── models.py             # 强类型数据模型 (PromptSession, ConversationTurn)
│   │   ├── parser.py             # 多格式清洗器 (兼容 chunkedPrompt、Thinking、多模态附件)
│   │   └── sync.py               # 远程增量拉取器 (类似 git fetch)
│   └── server/                   # FastAPI 后端服务
│       ├── api.py                # 路由层 (指标计算、会话列表、异步同步、文件导出)
│       └── app.py                # FastAPI 实例与中间件配置
├── .cache/                       # 本地 SQLite 缓存数据库目录 (cache.db)
├── AI_STUDIO_SCHEMA.md           # AI Studio 云端持久化数据格式逆向规范文档
├── inspect_schema.py             # 数据骨架探针脚本
├── main.py                       # 统一后端服务启动脚本
└── pyproject.toml
```

---

## 🚀 快速上手

### 1. 准备 Python 与 Node.js 环境

建议使用 [`uv`](https://github.com/astral-sh/uv) 管理 Python 依赖，Node.js 版本建议 `>= 18`。

```bash
# 安装 Python 依赖
uv sync
```

### 2. 配置 Google Drive API 凭据

1. 前往 [Google Cloud Console](https://console.cloud.google.com/)，创建项目并启用 **Google Drive API**。
2. 配置 OAuth 同意屏幕（类型选择「外部」，将你的 Google 账号加入测试用户）。
3. 在凭据页面创建 **OAuth 客户端 ID**（应用类型选 **桌面应用 / Desktop App**）。
4. 下载凭据 JSON，重命名为 **`credentials.json`** 并放置于项目根目录下。
5. *(可选)* 如处于代理网络环境，默认支持 `http://127.0.0.1:7890`（可在 `src/analyzer/drive.py` 中调整 `PROXY_PORT`）。

### 3. 启动应用

#### 步骤 A：启动后端数据服务

```bash
uv run python main.py
```
> 服务将在 `http://127.0.0.1:8000` 启动，并自动载入本地 `.cache/cache.db` 中的缓存。首次同步会唤起浏览器进行 Google 授权，并持久化 `token.json`。Swagger 接口文档位于 `http://127.0.0.1:8000/docs`。

#### 步骤 B：启动前端看板

```bash
cd frontend
npm install   # 或 pnpm install
npm run dev   # 或 pnpm dev
```
> 访问终端输出的开发地址（默认 `http://127.0.0.1:5173`），即可进入分析看板。

---

## 📊 核心指标定义

| 指标维度 | 说明 | 业务意义 |
| :--- | :--- | :--- |
| **交互会话场次** | 选定时间范围内的有效独立对话总数 | 粗粒度认知吞吐度量 |
| **生命周期中位数 (P50)** | 从首轮交互到最后收尾的时间跨度（抗长尾干扰） | 单项攻坚任务的心智停留窗口 |
| **多轮攻坚 P50** | 轮次 $\ge 2$ 的深度攻坚会话耗时中位数 | 复杂工程/理论探究的平均心智负荷 |
| **总 Token 能耗** | 消耗的总 Token 数量（含 Prompt、回复与 Thinking） | 计算算力与模型调度规模 |
| **思考链消耗比例** | Gemini 2.0 Thinking Token 占总 Token 的比例 | 衡量复杂推理任务占比 |
| **思维摩擦力 (分叉率)** | 出现重新生成（Regenerate）或历史编辑的会话比例 | 衡量初始 Prompt 清晰度或模型对齐阻抗 |

---

## 🛠️ 数据导出与 SOP 提炼流程

通过看板右上角的导出工具，可获得当前选定周期的数据：

1. **导出 `first_prompts_{range}_for_clustering.jsonl`**：
   - 提取所有会话的第一问文本与上下文能耗。
   - **实战用法**：直接将该文件喂给高级 LLM 进行聚类 prompt 分析：
     ```text
     "请分析以下 JSONL 中的提问语料，按【工程实现、架构设计、排错追问、概念调研】进行分类，并指出反复追问频率最高的共性缺陷，输出一份提问优化 SOP。"
     ```
2. **导出 `prompts_summary_{range}.csv`**：
   - 包含文件 ID、标题、模型、轮次、时长（人类友好展示/秒数）、Token 计数、分支次数与提问预览。
   - 适合在 Excel / Numbers / Pandas 中进行二次深度挖掘。

---

## 📄 数据格式规范

关于 Google AI Studio 会话底层 JSON 的 `chunkedPrompt`、`runSettings`、`inlineFile`、`driveDocument` 以及分支树的逆向工程说明，请参阅项目内文档：  
👉 [**AI_STUDIO_SCHEMA.md**](./AI_STUDIO_SCHEMA.md)

---

## 🛣️ Roadmap

- [x] 基于 requests 驱动层与多重代理穿透
- [x] SQLite WAL 本地缓存与增量同步（按 modifiedTime 校验）
- [x] 后端内存常驻对象池与 FastAPI 毫秒级重投影接口
- [x] Preact + Signals + Tailwind + Chart.js 仪表盘
- [x] 7d / 30d / 90d / this_year / all 全局时间窗口切片与指标联动
- [x] 动态时间切片的 CSV / JSONL 一键导出
- [ ] 内置轻量 TF-IDF / 关键词聚类与云端词频分布
