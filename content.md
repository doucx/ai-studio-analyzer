好的，所有关于生命周期解耦、FastAPI 路由冲突修复及前端类型安全防御的修改已经完成并通过验证。

我将为你生成一个 `[COMMIT]` 计划，将相关变更加入 Git 暂存区并生成详尽的提交记录。

## [COMMIT] fix: 修复会话详情生命周期依赖与全文检索路由冲突

### 错误分析

本次修复涵盖两处关键缺陷：
1. **组件生命周期与 Linter 检查死锁**：`SessionDetailPanel.tsx` 中把会话切换硬加载与增量同步静默刷新混在同一个 `useEffect` 中，依赖外部异步 state `detail` 导致闭包陈旧与循环触发风险，触发了 Biome 的 `useExhaustiveDependencies` 检查错误。
2. **FastAPI 动态路由贪婪拦截与数据污染**：后端路由顺序中 `@router.get("/sessions/{file_id}")` 优先捕获了 `/api/sessions/search` 请求，并返回了 200 状态码的字典响应。前端 `session.ts` 缺少数组守卫将其传入响应式 Signal，在调用 `.filter` 时抛出 `TypeError: list.filter is not a function`，导致 Preact 响应式计算图崩溃，后续无法点击或跳转任何会话。

### 用户需求

将代码质量优化（无 ignore 修复 Biome 检查）与 FTS 全文搜索路由及状态安全修复作为一个完整的原子工作单元提交到 Git 仓库。

### 评论

这次提交不仅解决了界面的语法检查合规性问题，更排除了在复杂交互下由于路由遮蔽与非数组数据穿透引发的整个应用冻结隐患，极大增强了系统的稳定性与容错能力。

### 目标

1. 将修改后的 4 个核心文件暂存到 Git。
2. 创建符合 Conventional Commits 规范的结构化提交信息，完整记录缺陷成因与解决方案。

### 基本原理

通过 `git_add` 暂存所有涉及修改的前后端代码，并使用 `git_commit` 固化变更历史，遵循操作隔离原则，该计划中不包含任何修改文件系统的写入操作。

### 标签

#intent/fix #flow/ready #priority/high #comp/runtime #comp/ui #concept/executor #concept/ui #scope/core #scope/ux #ai/refine #task/domain/ui #task/object/search-routing-and-state #task/action/bug-fix #task/state/end #task/status/completed

---

### Script

#### Acts 1: 暂存修改文件并创建 Git 提交

我们将涉及会话详情生命周期重构与后端路由防御的所有修改文件添加到 Git 暂存区，并生成结构化提交记录。

~~~~~act
git_add
frontend/src/components/SessionDetailPanel.tsx
frontend/src/routes/SessionsRoute.tsx
frontend/src/state/session.ts
src/server/api.py
~~~~~

~~~~~act
git_commit
~~~~~
~~~~~text
fix: resolve session lifecycle hook deadlock and FTS search route collision

1. Frontend Hook Refactor:
   - Separate initial session mounting from background sync silent refresh in `SessionDetailPanel.tsx`.
   - Remove stale `detail` dependency guesswork, satisfying Biome's `useExhaustiveDependencies` rule cleanly without ignore pragmas.
   - Add explicit key isolation and multi-source fallback lookup in `SessionsRoute.tsx`.

2. Backend Route & Status Standardization:
   - Reorder `/api/sessions/search` above wildcard path `/api/sessions/{file_id}` to prevent greedy parameter shadowing.
   - Return proper HTTP 404/500 `HTTPException` instead of 200 OK error dictionaries.

3. Defensive State Guards:
   - Add `Array.isArray` guards in `session.ts` to prevent `list.filter is not a function` runtime crashes when handling non-array API responses.
~~~~~

### 下一步建议

- **全量健康度复测**：运行 `python inspect_health.py` 确保本地 SQLite 缓存与索引健康状态无异常。
- **启动验证**：运行 `python main.py` 与 `npm run dev` 进行全流程搜索与会话切换演练，确认体验平滑流畅。
