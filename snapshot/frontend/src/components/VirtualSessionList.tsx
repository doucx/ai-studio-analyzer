import { Loader2 } from 'lucide-preact';
import { useRef, useState } from 'preact/hooks';
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

        {/* 第二行：FTS 全文检索输入 */}
        <div className="relative">
          <input
            type="text"
            placeholder="全文检索会话正文、思考链、代码..."
            value={currentKeyword}
            onInput={(e) => {
              handleSearchInput((e.target as HTMLInputElement).value);
              setScrollTop(0);
              if (containerRef.current) containerRef.current.scrollTop = 0;
            }}
            className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-500 outline-none transition"
          />
          {isSearchingFtsSignal.value ? (
            <Loader2
              size={13}
              className="absolute right-2.5 top-2 text-indigo-400 animate-spin pointer-events-none"
            />
          ) : currentKeyword ? (
            <button
              type="button"
              onClick={() => {
                handleSearchInput('');
              }}
              className="absolute right-2 top-1 text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer"
            >
              ✕
            </button>
          ) : null}
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

                    {s.snippet ? (
                      <p
                        className="text-[11px] text-zinc-300 truncate font-mono w-full bg-black/20 px-1 py-0.5 rounded border border-zinc-800/40"
                        // biome-ignore lint/security/noDangerouslySetInnerHtml: 用于呈现 FTS 高亮标记 (<mark>)
                        dangerouslySetInnerHTML={{ __html: s.snippet }}
                      />
                    ) : (
                      <p className="text-[11px] text-zinc-400 truncate font-sans w-full">
                        {s.first_prompt || '(无首轮文本提示)'}
                      </p>
                    )}

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
