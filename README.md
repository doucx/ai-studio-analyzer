# AI Studio Analyzer (Google AI Studio 交互分析与元工作流沉淀)

> **从历史交互中洞察个人思维瓶颈与认知精力分布，沉淀个人定制化的 Prompting SOP。**

---

## 🌟 核心理念与解决的问题

在使用 Google AI Studio 进行日常攻坚与探索时，我们积累了海量的 Prompts 与多轮对话记录。
本项目旨在通过 **Google Drive API** 自动化拉取云端对话数据，完成以下目标：

1. **提取纯粹的提问语料**：剥离模型回复与系统前置指令，只看“我向 AI 输入了什么”。
2. **量化精力与时间消耗**：
   - **交互轮次（Turns）**：区分“一次性解决的简单任务”与“反复追问攻坚的深度长会话（≥5轮）”。
   - **输入字数与会话生命周期**：度量认知精力与探索时间。
3. **沉淀标准提问 SOP**：
   - 提取所有会话的「第一问」，利用 LLM 进行主题分类与意图聚类（如：代码 Debug、架构设计、API 检索、文案润色）。
   - 分析反复追问的长会话，将追问要素前置到初始提问模板中。
4. **增量缓存支持**：基于 Google Drive 文件的 `modifiedTime` 进行本地增量同步，二次运行毫秒级出结果。

---

## 🏗️ 项目架构

```text
ai-studio-analyzer/
├── src/
│   └── analyzer/
│       ├── __init__.py
│       ├── drive.py        # 基于 requests 的 Google Drive API 客户端（内置代理与超时控制）
│       ├── models.py       # 强类型数据模型 (PromptSession, ConversationTurn)
│       ├── parser.py       # 格式清洗器（兼容 chunkedPrompt 与新版 contents）
│       ├── cache.py        # 本地增量文件缓存机制 (.cache/)
│       ├── metrics.py      # 时间/轮次/字数/深度会话等精力消耗计算
│       └── exporter.py     # 导出格式化报表 (CSV) 与 LLM 聚类集 (JSONL)
├── .cache/                 # 本地缓存目录（存储已下载的云端 JSON 与索引）
├── main.py                 # 统一执行入口
├── verify_drive.py         # 极简连接验证脚本
└── credentials.json        # Google Cloud OAuth 客户端桌面凭据 (需自行配置)
```

---

## 🚀 快速上手

### 1. 准备 OAuth 凭据
1. 访问 [Google Cloud Console](https://console.cloud.google.com/)，启用 **Google Drive API**。
2. 配置 OAuth 同意屏幕为「外部」，添加你的 Google 账号为测试用户。
3. 创建「OAuth 客户端 ID」（应用类型选 **桌面应用 Desktop App**）。
4. 下载凭据 JSON，重命名为 **`credentials.json`** 放置于项目根目录。

### 2. 运行与分析
使用 `uv` 或原生 Python 运行：

```bash
uv run python main.py
```

*首次运行会唤起本地浏览器完成 Google 登录授权，并在本地生成 `token.json` 供后续自动续期复用。*

---

## 📊 输出产物说明

运行完成后，项目会在根目录生成两个关键文件：

1. **`first_prompts_for_clustering.jsonl`**：
   - 每行一条 JSON，包含每个会话的标题、首轮提问文本、对话轮数及模型标识。
   - **推荐用法**：直接把该文件内容或样本喂给 Gemini / Claude，让其为你进行主题聚类与 SOP 归纳。
2. **`prompts_summary.csv`**：
   - 会话概览表格，包含会话名称、模型、轮数、提问字数与内容预览，可直接在 Excel/Numbers 中筛选出高轮次的复杂攻坚任务。

---

## 🛣️ 后续演进规划

- [x] 迁移至稳健的 requests 驱动层，解除 Python 3.13 下 httplib2 代理阻塞
- [x] 完整的分页拉取与本地增量缓存 (`.cache/`)
- [x] 导出供 LLM 聚类的 JSONL 与统计报表
- [ ] 内置本地轻量词云与提问高频词统计
- [ ] 接入 Gemini API 实现一键式自动化意图分类与提问质量评分