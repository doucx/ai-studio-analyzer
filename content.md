已完成对 Phase 3（会话多维复合筛选）的方案设计。

我们将筛选与排序条件提升至 `state/session.ts` 集中管理，实现基于 `computed` 的全内存毫秒级过滤管道，并在 `VirtualSessionList.tsx` 顶部注入模型选择器与轮次深度胶囊控制台，满足直接在界面中按**模型偏好**、**单轮快问**、**深度攻坚**与**分叉摩擦力**组合筛选的需求。

## [WIP] feat(frontend): 实现会话列表多维复合筛选器

### 用户需求
针对笔记《查看不同模型轮次深度的会话明细.md》的要求，在前端会话工作台（`SessionsRoute`）的虚拟滚动列表上方构建多维复合筛选器：
1. **模型筛选器**：支持按调用模型（如 `gemini-2.0-flash`, `gemini-1.5-pro`）快速筛选，并实时显示各模型的命中统计；
2. **轮次深度分段按钮**：提供「全部」、「单轮快问 (1轮)」、「深度攻坚 (≥5轮)」、「分叉重试」的一键胶囊切换；
3. **状态联动与重置**：将关键词搜索、模型过滤、深度切片与排序字段响应式联动，并提供一键重置功能。

### 评论
5,000+ 场历史会话中既有大量 1 轮的即时查询，也有长达几十轮的复杂攻坚。将过滤条件从单一的模糊搜索升级为**模型 × 深度 × 摩擦力**的多维正交管道，极大提升了用户回溯特定研发场景和认知摩擦现场的定位效率，符合元工作流审计的核心定位。

### 目标
1. 扩展 `frontend/src/state/session.ts`：
   - 增加 `searchKeywordSignal`、`selectedModelSignal`、`depthFilterSignal` 与 `sortBySignal`；
   - 增加基于 `computed` 的 `availableModelsSignal`（动态提取模型集与频次）和 `filteredSessionsSignal`（纯响应式过滤排序管道）；
   - 提供 `resetFilters()` 快捷操作。
2. 重构 `frontend/src/components/VirtualSessionList.tsx`：
   - 引入紧凑的模型筛选下拉框与轮次深度胶囊切换栏；
   - 支持活跃筛选条件的高亮与清空还原；
   - 保持虚拟滚动的毫秒级流畅体验。

### 基本原理
利用 Preact Signals 的 `computed` 依赖图自动追踪，当用户输入关键词、变更模型或切换深度胶囊时，`filteredSessionsSignal` 会以原子操作完成过滤与排序计算，直接通知虚拟列表视口重新切片，无需引发父级组件的无谓重渲染，保证在 5,000+ 数据量下按键即所得、点击即响应。

### 标签
#intent/build #flow/ready #priority/high
#comp/frontend #concept/ui #concept/navigation #scope/ux
#ai/instruct
#task/domain/ui
#task/object/multi-dimensional-filters
#task/action/implementation
#task/state/continue #task/status/active

---

### Script

#### Acts 1: 在 `state/session.ts` 中实现多维过滤状态与计算管道

扩展会话状态层，定义模型选择、深度分段切片与复合计算管道。

~~~~~act
write_file
frontend/src/state/session.ts
~~~~~
~~~~~typescript
import { computed, signal } from '@preact/signals';
import type { SessionItem } from '../types/metrics';
import { timeRangeSignal } from './metrics';

export type DepthFilter = 'all' | 'single' | 'deep' | 'branch';
export type SortOption = 'modified' | 'tokens' | 'turns';

// 基础源数据状态
export const sessionsSignal = signal<SessionItem[]>([]);
export const selectedSessionSignal = signal<SessionItem | null>(null);
export const sessionsLoadingSignal = signal<boolean>(true);
export const sidebarCollapsedSignal = signal<boolean>(false);

// 复合筛选器状态
export const searchKeywordSignal = signal<string>('');
export const selectedModelSignal = signal<string>('all');
export const depthFilterSignal = signal<DepthFilter>('all');
export const sortBySignal = signal<SortOption>('modified');

// 动态提取当前数据集中所有模型列表及其会话计数 (降序)
export const availableModelsSignal = computed(() => {
  const counts = new Map<string, number>();
  for (const s of sessionsSignal.value) {
    const m = s.model.replace('models/', '');
    counts.set(m, (counts.get(m) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
});

// 计算是否处于非默认筛选状态
export const isFilterActiveSignal = computed(() => {
  return (
    searchKeywordSignal.value.trim() !== '' ||
    selectedModelSignal.value !== 'all' ||
    depthFilterSignal.value !== 'all' ||
    sortBySignal.value !== 'modified'
  );
});

// 核心多维复合过滤计算管道 (响应式原子派生)
export const filteredSessionsSignal = computed(() => {
  const list = sessionsSignal.value;
  const term = searchKeywordSignal.value.trim().toLowerCase();
  const model = selectedModelSignal.value;
  const depth = depthFilterSignal.value;
  const sort = sortBySignal.value;

  return list
    .filter((s) => {
      // 1. 模型筛选
      if (model !== 'all') {
        const rawModel = s.model.replace('models/', '');
        if (rawModel !== model) return false;
      }

      // 2. 轮次深度与摩擦力筛选
      if (depth === 'single' && s.turn_count !== 1) return false;
      if (depth === 'deep' && s.turn_count < 5) return false;
      if (depth === 'branch' && !s.has_branching) return false;

      // 3. 关键字模糊搜索 (标题、首轮 Prompt、模型)
      if (term) {
        const matchName = s.name.toLowerCase().includes(term);
        const matchPrompt = (s.first_prompt || '').toLowerCase().includes(term);
        const matchModel = s.model.toLowerCase().includes(term);
        if (!matchName && !matchPrompt && !matchModel) return false;
      }

      return true;
    })
    .sort((a, b) => {
      if (sort === 'tokens') {
        return b.total_tokens - a.total_tokens;
      }
      if (sort === 'turns') {
        return b.turn_count - a.turn_count;
      }
      const timeA = a.modified_time ? new Date(a.modified_time).getTime() : 0;
      const timeB = b.modified_time ? new Date(b.modified_time).getTime() : 0;
      return timeB - timeA;
    });
});

export async function fetchSessions(range = timeRangeSignal.value) {
  if (sessionsSignal.value.length === 0) {
    sessionsLoadingSignal.value = true;
  }
  try {
    const res = await fetch(`/api/sessions?range=${range}`);
    const data = await res.json();
    sessionsSignal.value = data;
  } catch (err) {
    console.error('加载会话列表失败:', err);
  } finally {
    sessionsLoadingSignal.value = false;
  }
}

export function selectSession(session: SessionItem | null) {
  selectedSessionSignal.value = session;
}

export function toggleSidebar() {
  sidebarCollapsedSignal.value = !sidebarCollapsedSignal.value;
}

export function resetFilters() {
  searchKeywordSignal.value = '';
  selectedModelSignal.value = 'all';
  depthFilterSignal.value = 'all';
  sortBySignal.value = 'modified';
}
~~~~~

#### Acts 2: 升级 `VirtualSessionList.tsx` 控制台交互

加入模型下拉选择器、轮次深度胶囊单选组、活跃过滤指示与一键重置按钮。

~~~~~act
write_file
frontend/src/components/VirtualSessionList.tsx
~~~~~
~~~~~typescript
import { useRef, useState } from 'preact/hooks';
import {
  type DepthFilter,
  type SortOption,
  availableModelsSignal,
  depthFilterSignal,
  filteredSessionsSignal,
  isFilterActiveSignal,
  resetFilters,
  searchKeywordSignal,
  selectedModelSignal,
  sessionsSignal,
  sortBySignal,
} from '../state/session';
import type { SessionItem } from '../types/metrics';

interface Props {
  sessions?: SessionItem[];
  selectedId: string | null;
  onSelect: (session: SessionItem) => void;
}

const ITEM_HEIGHT = 86; // 每项固定高度 86px
const BUFFER = 5; // 视口外缓冲项数

const DEPTH_OPTIONS: { key: DepthFilter; label: string; tip: string }[] = [
  { key: 'all', label: '全部', tip: '全量轮次' },
  { key: 'single', label: '快问 (1轮)', tip: '仅 1 轮轻量交互' },
  { key: 'deep', label: '攻坚 (≥5轮)', tip: '5 轮以上深度攻坚' },
  { key: 'branch', label: '分叉', tip: '发生过分支或编辑重试' },
];

export function VirtualSessionList({ selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const totalSessionsCount = sessionsSignal.value.length;
  const filteredSessions = filteredSessionsSignal.value;
  const models = availableModelsSignal.value;
  const isFilterActive = isFilterActiveSignal.value;

  const currentKeyword = searchKeywordSignal.value;
  const currentModel = selectedModelSignal.value;
  const currentDepth = depthFilterSignal.value;
  const currentSort = sortBySignal.value;

  // 虚拟滚动动态计算
  const totalHeight = filteredSessions.length * ITEM_HEIGHT;
  const containerHeight = containerRef.current?.clientHeight || 650;

  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER);
  const visibleCount = Math.ceil(containerHeight / ITEM_HEIGHT);
  const endIndex = Math.min(filteredSessions.length, startIndex + visibleCount + BUFFER * 2);
  const offsetY = startIndex * ITEM_HEIGHT;

  const visibleItems = filteredSessions.slice(startIndex, endIndex);

  return (
    <div className="flex flex-col h-full bg-zinc-900/60 border border-zinc-800 rounded-lg overflow-hidden shadow-sm">
      {/* 搜索与复合过滤控制栏 */}
      <div className="p-3 border-b border-zinc-800 space-y-2.5 bg-zinc-900/90 backdrop-blur">
        {/* 第一行：状态指示与排序选择 */}
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-zinc-200">
              会话历史 ({filteredSessions.length} / {totalSessionsCount})
            </span>
            {isFilterActive && (
              <button
                type="button"
                onClick={resetFilters}
                className="text-[10px] text-indigo-400 hover:text-indigo-300 underline font-mono cursor-pointer ml-1"
                title="清空所有过滤条件"
              >
                [重置]
              </button>
            )}
          </div>

          <select
            value={currentSort}
            onChange={(e) => {
              sortBySignal.value = (e.target as HTMLSelectElement).value as SortOption;
            }}
            className="bg-zinc-950 border border-zinc-700 text-zinc-300 text-[11px] rounded px-1.5 py-0.5 outline-none focus:border-indigo-500"
          >
            <option value="modified">最近修改</option>
            <option value="tokens">Token 能耗</option>
            <option value="turns">轮次深度</option>
          </select>
        </div>

        {/* 第二行：关键字模糊输入 */}
        <div className="relative">
          <input
            type="text"
            placeholder="搜索会话标题、首轮 Prompt、模型..."
            value={currentKeyword}
            onInput={(e) => {
              searchKeywordSignal.value = (e.target as HTMLInputElement).value;
              setScrollTop(0);
              if (containerRef.current) containerRef.current.scrollTop = 0;
            }}
            className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-500 outline-none transition"
          />
          {currentKeyword && (
            <button
              type="button"
              onClick={() => {
                searchKeywordSignal.value = '';
              }}
              className="absolute right-2 top-1 text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>

        {/* 第三行：模型下拉筛选 */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-400 shrink-0">模型:</span>
          <select
            value={currentModel}
            onChange={(e) => {
              selectedModelSignal.value = (e.target as HTMLSelectElement).value;
              setScrollTop(0);
              if (containerRef.current) containerRef.current.scrollTop = 0;
            }}
            className="flex-1 bg-zinc-950 border border-zinc-800 focus:border-indigo-500 text-zinc-300 text-[11px] rounded px-2 py-1 outline-none truncate"
          >
            <option value="all">全部模型 ({totalSessionsCount})</option>
            {models.map(([modelName, count]) => (
              <option key={modelName} value={modelName}>
                {modelName} ({count})
              </option>
            ))}
          </select>
        </div>

        {/* 第四行：轮次深度与摩擦力胶囊切换 */}
        <div className="grid grid-cols-4 gap-1 p-0.5 bg-zinc-950 border border-zinc-800 rounded-md">
          {DEPTH_OPTIONS.map(({ key, label, tip }) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                depthFilterSignal.value = key;
                setScrollTop(0);
                if (containerRef.current) containerRef.current.scrollTop = 0;
              }}
              title={tip}
              className={`text-[10px] py-1 rounded font-medium transition text-center truncate ${
                currentDepth === key
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 虚拟滚动主体视口 */}
      <div
        ref={containerRef}
        onScroll={(e) => setScrollTop((e.target as HTMLElement).scrollTop)}
        className="flex-1 overflow-y-auto relative w-full divide-y divide-zinc-800/40 select-none"
      >
        {filteredSessions.length === 0 ? (
          <div className="p-8 text-center text-xs text-zinc-500 space-y-2">
            <div>未检索到匹配的交互会话</div>
            {isFilterActive && (
              <button
                type="button"
                onClick={resetFilters}
                className="text-indigo-400 hover:text-indigo-300 text-xs underline"
              >
                清空筛选条件
              </button>
            )}
          </div>
        ) : (
          <div style={{ height: `${totalHeight}px`, width: '100%', position: 'relative' }}>
            <div
              style={{
                transform: `translateY(${offsetY}px)`,
                willChange: 'transform',
                position: 'absolute',
                left: 0,
                right: 0,
                top: 0,
              }}
            >
              {visibleItems.map((s) => {
                const isSelected = selectedId === s.file_id;
                return (
                  <button
                    type="button"
                    key={s.file_id}
                    onClick={() => onSelect(s)}
                    style={{ height: `${ITEM_HEIGHT}px` }}
                    className={`w-full text-left p-2.5 cursor-pointer transition flex flex-col justify-between border-b border-zinc-800/30 outline-none focus:bg-zinc-800/60 ${
                      isSelected
                        ? 'bg-indigo-950/60 border-l-2 border-l-indigo-500 text-white'
                        : 'hover:bg-zinc-800/40 text-zinc-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5 w-full">
                      <span
                        className="font-medium text-xs truncate flex-1 text-zinc-100"
                        title={s.name}
                      >
                        {s.name}
                      </span>
                      {s.has_branching && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-amber-950/80 text-amber-400 border border-amber-800/50">
                          分叉
                        </span>
                      )}
                      <span className="text-[10px] text-zinc-500 font-mono whitespace-nowrap">
                        {s.duration_human}
                      </span>
                    </div>

                    <p className="text-[11px] text-zinc-400 truncate font-sans w-full">
                      {s.first_prompt || '(无首轮文本提示)'}
                    </p>

                    <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono w-full">
                      <span className="bg-zinc-800/80 px-1 py-0.2 rounded text-zinc-400 max-w-[130px] truncate">
                        {s.model.replace('models/', '')}
                      </span>
                      <span>
                        {s.total_tokens.toLocaleString()} tok · {s.turn_count} 轮
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
~~~~~

### 下一步建议

Phase 3 已经完成多维复合筛选系统的构建，满足了对不同模型、轮次深度与摩擦力分叉的精准下钻。后续建议：
1. **代码检查与构建验证**: 执行 `cd frontend && npm run check`（包含 Biome 代码校验与 TypeScript 类型检查）确认代码无任何警告与类型错误；
2. **图表到列表联动 (下钻体验提升)**: 可在 `OverviewDashboard` 中的模型柱状图（`ModelDistributionChart`）上增加点击事件：点击某模型柱体时自动设置 `selectedModelSignal` 并跳转至 `/sessions`，实现大盘到明细的无缝穿透；
3. **进入 Phase 4 (新分析视图落地)**: 针对笔记《分析我在x个主题上消耗了y个token.md》和《词云.md》，着手设计 `/topics` 或 `/analysis` 路由及对应的后端分词聚类接口。
