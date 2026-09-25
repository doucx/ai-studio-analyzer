好的，所有改动已经就绪。现在我将生成一个 `[COMMIT]` 计划，将这些改进作为一个完整的逻辑单元提交到 Git 仓库中。

## [COMMIT] feat(ui): 升级会话交互流并支持 Markdown 渲染与沉浸式折叠侧栏

### 用户需求
将本次完成的交互轮次流重构、Markdown 富文本渲染、一键复制、侧边栏收起折叠以及暗色滚动条等前端工作台体验改进提交到 Git 版本控制中。

### 评论
本次改造使得个人认知审计工具从“元数据观察台”跃升为“沉浸式只读对话复盘工作台”，极大地提升了会话回顾与长文本代码审阅的体验。

### 目标
1. 将修改的文件（`SessionDetailPanel.tsx`、`app.tsx`、`index.css` 以及可能更新的 `package.json`）添加到暂存区。
2. 创建结构清晰、符合规范的 Conventional Commits 提交记录。

### 基本原理
按照工作流规范，本次提交归档了属于前端工作台 UI/UX 体验重构的核心成果，标记该宏观任务阶段性完成。

### 标签
#intent/build #flow/ready #priority/medium #comp/interfaces #concept/ui #scope/ux #ai/instruct #task/domain/ui #task/object/session-detail-view #task/action/refactor #task/state/end #task/status/completed

---

### Script

#### Acts 1: 添加修改文件并创建 Git 提交

我们将相关修改添加至 Git 暂存区并完成提交。

~~~~~act
git_add
frontend/src/components/SessionDetailPanel.tsx
frontend/src/app.tsx
frontend/src/index.css
frontend/package.json
frontend/package-lock.json
~~~~~

~~~~~act
git_commit
~~~~~
~~~~~text
feat(ui): enhance session conversation flow with markdown and collapsible sidebar

- Replace compact turn preview with full-height interactive conversation stream
- Integrate marked renderer for rich AI responses (code blocks, lists, quotes)
- Add one-click copy button with instant feedback to each message chunk
- Support collapsing session history sidebar for immersive full-width view
- Unify dark-mode scrollbars across the application
- Remove redundant first-prompt preview and duplicate toggle buttons
~~~~~

---

### 下一步建议
- **代码高亮增强**: 当前代码块已支持深色暗底排版，后续若需要支持各语言语法彩色高亮，可考虑轻量引入 `highlight.js` 或 `prismjs`。
- **长文本快速跳转**: 随着多轮超长会话的展示，可考虑在会话流右侧增加轮次微型目录（Mini-map）或快速回到顶部/底部的悬浮浮标。
