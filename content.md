我们将按照方案 A 进行实施：在排序选项中显式引入 `relevance`（相关度），在 FTS 搜索命中时默认启用或提供相关度选项，同时彻底解除 `sort === 'modified'` 上的短路拦截，使选择“最近修改”时能真正按更新时间排序。

## [WIP] fix: 分离搜索相关度与修改时间排序逻辑以修复最近修改失效问题

### 错误分析

在 `frontend/src/state/session.ts` 的 `filteredSessionsSignal` 计算属性中，排序逻辑曾包含以下硬编码特判：
```typescript
if (cleanTerm.length >= 2 && ftsResultsSignal.value !== null && sort === 'modified') {
  return 0;
}
```
原本的意图是在全文搜索（FTS）状态下，默认保持后端 SQLite FTS5 BM25 评分所决定的相关度顺序。然而，因为下拉框的默认值和“最近修改”选项的值恰好都为 `'modified'`，导致无论用户是初次搜索还是在下拉框中主动选回“最近修改”，都会被此条件短路并直接 `return 0`，从而阻断了按 `modified_time` 进行的时间倒序比对。与此同时，`tokens` 和 `chunks` 排序由于没有被拦截，表现完全正常。

### 用户需求

1. 修复在搜索状态下选择“最近修改”时，列表无法按时间倒序排列的问题。
2. 保持全文检索（FTS）时对 BM25 相关度排序的支持，使两者语义明确解耦。

### 评论

原有的实现将“相关度”与“最近修改”两种语义混用在一个 `'modified'` 状态中，是典型的状态重载副作用。通过显式引入 `'relevance'` 排序选项并在有搜索命中时自动展示/切换，既符合用户的搜索心智模型，又能保证各排序维度的独立纯粹。

### 目标

1. 在 `SortOption` 类型中新增 `'relevance'` 选项。
2. 修改 `frontend/src/state/session.ts` 中的 `.sort()` 逻辑，仅在 `sort === 'relevance'` 时保持 FTS 默认相关度，使 `sort === 'modified'` 能正常按 `modified_time` 倒序比对。
3. 在 `handleSearchInput` 检索成功后，如果处于默认排序，自动切换到 `'relevance'`；在搜索词清空时自动退回 `'modified'`。
4. 在 `frontend/src/components/VirtualSessionList.tsx` 下拉菜单中，当存在 FTS 检索结果时动态提供“相关度”选项。

### 基本原理

通过将 BM25 相关度独立为显式的 `'relevance'` 排序状态，消除了对 `'modified'` 选项的强行劫持。这样不仅让状态流转（搜索命中 -> 切换为相关度；清空搜索 -> 回归最近修改）更加清晰自洽，而且当用户手动在下拉菜单中切换到“最近修改”时，排序逻辑能够无阻碍地进入 `modified_time` 的时间戳对比分支。

### 标签

#intent/fix #flow/ready #priority/medium #comp/cli #concept/ui #scope/ux #ai/instruct #task/domain/ui #task/object/session-sorting #task/action/bug-fix #task/state/begin

---

### Script

#### Acts 1: 更新会话状态管理中的排序类型与排序逻辑

修改 `frontend/src/state/session.ts`，定义 `'relevance'` 排序项，移除旧的 `sort === 'modified'` 拦截，并在搜索触发与清空时协调排序状态。

~~~~~act
patch_file
frontend/src/state/session.ts
~~~~~
~~~~~typescript
export type DepthFilter = 'all' | 'single' | 'few' | 'many' | 'branch';
export type SortOption = 'modified' | 'tokens' | 'chunks';
~~~~~
~~~~~typescript
export type DepthFilter = 'all' | 'single' | 'few' | 'many' | 'branch';
export type SortOption = 'relevance' | 'modified' | 'tokens' | 'chunks';
~~~~~

~~~~~act
patch_file
frontend/src/state/session.ts
~~~~~
~~~~~typescript
    .sort((a, b) => {
      // FTS 模式下默认保持 BM25 相关度排序
      if (cleanTerm.length >= 2 && ftsResultsSignal.value !== null && sort === 'modified') {
        return 0;
      }
      if (sort === 'tokens') {
        return b.total_tokens - a.total_tokens;
      }
~~~~~
~~~~~typescript
    .sort((a, b) => {
      // 保持 FTS 默认的 BM25 相关度排序
      if (sort === 'relevance') {
        return 0;
      }
      if (sort === 'tokens') {
        return b.total_tokens - a.total_tokens;
      }
~~~~~

~~~~~act
patch_file
frontend/src/state/session.ts
~~~~~
~~~~~typescript
  if (term.length < 2) {
    ftsResultsSignal.value = null;
    isSearchingFtsSignal.value = false;
    return;
  }

  isSearchingFtsSignal.value = true;
  searchDebounceTimer = setTimeout(async () => {
    const controller = new AbortController();
    activeSearchAbortController = controller;

    try {
      const res = await fetch(`/api/sessions/search?q=${encodeURIComponent(term)}&limit=100`, {
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        if (searchKeywordSignal.value.trim() === term) {
          ftsResultsSignal.value = Array.isArray(data) ? data : [];
        }
      }
    } catch (err: unknown) {
~~~~~
~~~~~typescript
  if (term.length < 2) {
    ftsResultsSignal.value = null;
    isSearchingFtsSignal.value = false;
    if (sortBySignal.value === 'relevance') {
      sortBySignal.value = 'modified';
    }
    return;
  }

  isSearchingFtsSignal.value = true;
  searchDebounceTimer = setTimeout(async () => {
    const controller = new AbortController();
    activeSearchAbortController = controller;

    try {
      const res = await fetch(`/api/sessions/search?q=${encodeURIComponent(term)}&limit=100`, {
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        if (searchKeywordSignal.value.trim() === term) {
          ftsResultsSignal.value = Array.isArray(data) ? data : [];
          if (sortBySignal.value === 'modified') {
            sortBySignal.value = 'relevance';
          }
        }
      }
    } catch (err: unknown) {
~~~~~

#### Acts 2: 在列表排序下拉框中支持“相关度”选项

修改 `frontend/src/components/VirtualSessionList.tsx`，导入 `ftsResultsSignal`，并在存在全文检索结果时渲染“相关度”选项。

~~~~~act
patch_file
frontend/src/components/VirtualSessionList.tsx
~~~~~
~~~~~typescript
import {
  type DepthFilter,
  type SortOption,
  availableModelsSignal,
  depthFilterSignal,
  filteredSessionsSignal,
  handleSearchInput,
  isFilterActiveSignal,
  isSearchingFtsSignal,
  resetFilters,
  searchKeywordSignal,
  selectedModelSignal,
  sessionsSignal,
  sortBySignal,
} from '../state/session';
~~~~~
~~~~~typescript
import {
  type DepthFilter,
  type SortOption,
  availableModelsSignal,
  depthFilterSignal,
  filteredSessionsSignal,
  ftsResultsSignal,
  handleSearchInput,
  isFilterActiveSignal,
  isSearchingFtsSignal,
  resetFilters,
  searchKeywordSignal,
  selectedModelSignal,
  sessionsSignal,
  sortBySignal,
} from '../state/session';
~~~~~

~~~~~act
patch_file
frontend/src/components/VirtualSessionList.tsx
~~~~~
~~~~~typescript
          <select
            value={currentSort}
            onChange={(e) => {
              sortBySignal.value = (e.target as HTMLSelectElement).value as SortOption;
            }}
            className="bg-zinc-950 border border-zinc-700 text-zinc-300 text-[11px] rounded px-1.5 py-0.5 outline-none focus:border-indigo-500"
          >
            <option value="modified">最近修改</option>
            <option value="tokens">Token 能耗</option>
            <option value="chunks">Chunk 数量</option>
          </select>
~~~~~
~~~~~typescript
          <select
            value={currentSort}
            onChange={(e) => {
              sortBySignal.value = (e.target as HTMLSelectElement).value as SortOption;
            }}
            className="bg-zinc-950 border border-zinc-700 text-zinc-300 text-[11px] rounded px-1.5 py-0.5 outline-none focus:border-indigo-500"
          >
            {ftsResultsSignal.value !== null && (
              <option value="relevance">相关度</option>
            )}
            <option value="modified">最近修改</option>
            <option value="tokens">Token 能耗</option>
            <option value="chunks">Chunk 数量</option>
          </select>
~~~~~

### 下一步建议

1. **类型检查与构建验证**：在终端运行 `npm run check` 或 `npx tsc --noEmit`，验证 TypeScript 类型检查是否完全通过。
2. **实际交互验证**：在页面中搜索任意关键词（如某个代码片段或词组），验证搜索完成后默认显示“相关度”，切换为“最近修改”后列表是否正确按时间降序排列，再测试清空关键词后下拉框与列表状态是否平滑恢复。
