import {
  AlignLeft,
  Calendar,
  Globe,
  Loader2,
  Sparkles,
} from 'lucide-preact';
import { useRef, useState } from 'preact/hooks';
import {
  type DepthFilter,
  type DurationTierFilter,
  type SortOption,
  availableModelsSignal,
  depthFilterSignal,
  filterDateSignal,
  filteredSessionsSignal,
  ftsResultsSignal,
  handleSearchInput,
  isExpandedViewSignal,
  isFilterActiveSignal,
  isMultiLineSearchSignal,
  isSearchingFtsSignal,
  resetFilters,
  searchKeywordSignal,
  searchScopeSignal,
  selectedModelSignal,
  selectedTierSignal,
  sessionsSignal,
  sortBySignal,
  toggleSearchScope,
} from '../state/session';
import type { SessionItem } from '../types/metrics';

interface Props {
  sessions?: SessionItem[];
  selectedId: string | null;
  onSelect: (session: SessionItem, turnIndex?: number) => void;
}

const ITEM_HEIGHT = 86; // 常规列表项高度 86px
const EXPANDED_ITEM_HEIGHT = 112; // 展开灯箱模式下高度 112px
const FTS_ITEM_HEIGHT = 158; // 搜索模式下 rg 风格上下文项高度
const FTS_EXPANDED_ITEM_HEIGHT = 178; // 展开灯箱模式下 rg 上下文项高度
const BUFFER = 5; // 视口外缓冲项数

const DEPTH_OPTIONS: { key: DepthFilter; label: string; tip: string }[] = [
  { key: 'all', label: '全部', tip: '全量会话' },
  { key: 'single', label: '≤2 Chunks', tip: '轻量快速问答 (1~2 个数据块)' },
  { key: 'few', label: '3~6 Chunks', tip: '标准交互推进 (3~6 个数据块)' },
  { key: 'many', label: '≥7 Chunks', tip: '长线深度交互 (≥7 个数据块)' },
  { key: 'branch', label: '分叉', tip: '发生过分支或编辑重试' },
];

export function VirtualSessionList({ selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const isExpanded = isExpandedViewSignal.value;
  const isMultiLine = isMultiLineSearchSignal.value;
  const searchScope = searchScopeSignal.value;
  const explicitDate = filterDateSignal.value;

  const totalSessionsCount = sessionsSignal.value.length;
  const filteredSessions = filteredSessionsSignal.value;
  const models = availableModelsSignal.value;
  const isFilterActive = isFilterActiveSignal.value;

  const currentKeyword = searchKeywordSignal.value;
  const currentModel = selectedModelSignal.value;
  const currentTier = selectedTierSignal.value;
  const currentDepth = depthFilterSignal.value;
  const currentSort = sortBySignal.value;

  const isFtsActive = currentKeyword.trim().length >= 2 && ftsResultsSignal.value !== null;
  const baseHeight = isFtsActive ? FTS_ITEM_HEIGHT : ITEM_HEIGHT;
  const expandedHeight = isFtsActive ? FTS_EXPANDED_ITEM_HEIGHT : EXPANDED_ITEM_HEIGHT;
  const rowHeight = isExpanded ? expandedHeight : baseHeight;
  const totalHeight = filteredSessions.length * rowHeight;
  const containerHeight = containerRef.current?.clientHeight || 650;

  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - BUFFER);
  const visibleCount = Math.ceil(containerHeight / rowHeight);
  const endIndex = Math.min(filteredSessions.length, startIndex + visibleCount + BUFFER * 2);
  const offsetY = startIndex * rowHeight;

  const visibleItems = filteredSessions.slice(startIndex, endIndex);

  return (
    <div
      className={`flex flex-col h-full bg-zinc-900/60 border border-zinc-800 rounded-lg overflow-hidden shadow-sm transition-all duration-300 ${
        isExpanded ? 'w-full' : ''
      }`}
    >
      {/* 搜索与复合过滤控制栏 */}
      <div className="p-3 border-b border-zinc-800 space-y-2.5 bg-zinc-900/90 backdrop-blur">
        {/* 第一行：状态指示、范围穿透与全屏灯箱切换 */}
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <div className="flex items-center gap-1.5 flex-wrap">
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

          <div className="flex items-center gap-1.5">
            {/* 范围/全库穿透切换 */}
            <button
              type="button"
              onClick={toggleSearchScope}
              className={`p-1 rounded text-xs transition border cursor-pointer flex items-center gap-1 ${
                searchScope === 'all'
                  ? 'bg-amber-950/80 text-amber-300 border-amber-800'
                  : 'bg-zinc-800/80 text-zinc-400 hover:text-zinc-200 border-zinc-700/60'
              }`}
              title={
                searchScope === 'all'
                  ? '当前处于【全库穿透】模式：忽略全局时间范围限制，模型、时长梯队及日期筛选均覆盖全库所有历史会话'
                  : '当前处于【区间初筛】模式：按顶栏时间切片范围展示，点击可穿透检索全库历史'
              }
            >
              <Globe size={12} className={searchScope === 'all' ? 'text-amber-400' : ''} />
              <span className="text-[10px] font-mono hidden sm:inline">
                {searchScope === 'all' ? '全库穿透' : '区间初筛'}
              </span>
            </button>

            {/* 排序选择 */}
            <select
              value={currentSort}
              onChange={(e) => {
                sortBySignal.value = (e.target as HTMLSelectElement).value as SortOption;
              }}
              className="bg-zinc-950 border border-zinc-700 text-zinc-300 text-[11px] rounded px-1.5 py-0.5 outline-none focus:border-indigo-500"
            >
              {ftsResultsSignal.value !== null && <option value="relevance">相关度</option>}
              <option value="modified">最近修改</option>
              <option value="tokens">Token 能耗</option>
              <option value="chunks">Chunk 数量</option>
            </select>
          </div>
        </div>

        {/* 第二行：FTS 全文检索输入（支持单行/多行自然语言及代码块搜索切换） */}
        <div className="relative">
          {isMultiLine ? (
            <textarea
              rows={3}
              placeholder="多行深度检索：支持粘贴长篇 Prompt、异常调用栈或代码片段..."
              value={currentKeyword}
              onInput={(e) => {
                handleSearchInput((e.target as HTMLTextAreaElement).value);
                setScrollTop(0);
                if (containerRef.current) containerRef.current.scrollTop = 0;
              }}
              className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded p-2 text-xs font-mono text-zinc-200 placeholder-zinc-500 outline-none transition resize-none leading-relaxed"
            />
          ) : (
            <input
              type="text"
              placeholder="全文毫秒级检索：输入代码关键词、报错信息或对话主题..."
              value={currentKeyword}
              onInput={(e) => {
                handleSearchInput((e.target as HTMLInputElement).value);
                setScrollTop(0);
                if (containerRef.current) containerRef.current.scrollTop = 0;
              }}
              className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none transition pr-16"
            />
          )}

          <div className="absolute right-2 top-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                isMultiLineSearchSignal.value = !isMultiLine;
              }}
              className={`p-0.5 rounded text-[10px] transition cursor-pointer ${
                isMultiLine
                  ? 'text-indigo-400 bg-indigo-950 border border-indigo-800/60'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
              title={isMultiLine ? '切换为单行输入' : '切换为多行复杂检索框'}
            >
              <AlignLeft size={13} />
            </button>

            {isSearchingFtsSignal.value ? (
              <Loader2 size={13} className="text-indigo-400 animate-spin pointer-events-none" />
            ) : currentKeyword ? (
              <button
                type="button"
                onClick={() => {
                  handleSearchInput('');
                }}
                className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer"
              >
                ✕
              </button>
            ) : null}
          </div>
        </div>

        {/* 第三行：分面属性并排筛选 (模型 / 时长梯队 / 精确日期) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {/* 模型维度选择 */}
          <select
            value={currentModel}
            onChange={(e) => {
              selectedModelSignal.value = (e.target as HTMLSelectElement).value;
              setScrollTop(0);
              if (containerRef.current) containerRef.current.scrollTop = 0;
              if (currentKeyword.trim().length >= 2) {
                handleSearchInput(currentKeyword);
              }
            }}
            className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 text-zinc-300 text-[11px] rounded px-2 py-1 outline-none truncate"
            title="按模型筛选"
          >
            <option value="all">全部模型 ({totalSessionsCount})</option>
            {models.map(([modelName, count]) => (
              <option key={modelName} value={modelName}>
                {modelName} ({count})
              </option>
            ))}
          </select>

          {/* 时长心智梯队选择 */}
          <select
            value={currentTier}
            onChange={(e) => {
              selectedTierSignal.value = (e.target as HTMLSelectElement).value as DurationTierFilter;
              setScrollTop(0);
              if (containerRef.current) containerRef.current.scrollTop = 0;
            }}
            className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 text-zinc-300 text-[11px] rounded px-2 py-1 outline-none truncate"
            title="按心智时长梯队筛选"
          >
            <option value="all">全部时长梯队</option>
            <option value="flash">即时快问 (&lt;10m)</option>
            <option value="focus">聚焦推进 (10~60m)</option>
            <option value="deep">深度攻坚 (1~6h)</option>
            <option value="epic">跨日长线 (&gt;6h)</option>
          </select>

          {/* 精确日期选择器 (原生输入框，支持自选与下钻回显，让出右侧原生图标) */}
          <div className="relative flex items-center min-w-0">
            <input
              type="date"
              value={explicitDate || ''}
              onChange={(e) => {
                const val = (e.target as HTMLInputElement).value;
                filterDateSignal.value = val ? val : null;
                setScrollTop(0);
                if (containerRef.current) containerRef.current.scrollTop = 0;
              }}
              className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 text-zinc-300 text-[11px] rounded px-2 py-1 outline-none font-mono cursor-pointer"
              title="按精确交互日期过滤 (支持大盘下钻回显或手动自选)"
            />
          </div>
        </div>

        {/* 第四行：Chunk 数量梯队与摩擦力胶囊切换 */}
        <div className="grid grid-cols-5 gap-1 p-0.5 bg-zinc-950 border border-zinc-800 rounded-md">
          {DEPTH_OPTIONS.map(({ key, label, tip }) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                depthFilterSignal.value = key;
                setScrollTop(0);
                if (containerRef.current) containerRef.current.scrollTop = 0;
                if (currentKeyword.trim().length >= 2) {
                  handleSearchInput(currentKeyword);
                }
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
                className="text-indigo-400 hover:text-indigo-300 text-xs underline cursor-pointer"
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
                const matchTurnIndex = s.search_matches?.[0]?.turn_index;
                return (
                  <button
                    type="button"
                    key={s.file_id}
                    onClick={() => onSelect(s, matchTurnIndex)}
                    style={{ height: `${rowHeight}px` }}
                    className={`w-full text-left p-3 cursor-pointer transition flex flex-col justify-between border-b border-zinc-800/30 outline-none focus:bg-zinc-800/60 ${
                      isSelected
                        ? 'bg-indigo-950/60 border-l-2 border-l-indigo-500 text-white'
                        : 'hover:bg-zinc-800/40 text-zinc-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 w-full">
                      <span
                        className="font-medium text-xs truncate flex-1 text-zinc-100"
                        title={s.name}
                      >
                        {s.name}
                      </span>
                      {s.has_branching && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-amber-950/80 text-amber-400 border border-amber-800/50 shrink-0">
                          分叉
                        </span>
                      )}
                      <span className="text-[10px] text-zinc-500 font-mono whitespace-nowrap">
                        {s.duration_human}
                      </span>
                    </div>

                    {s.search_matches && s.search_matches.length > 0 ? (
                      <div className="w-full my-1 rounded bg-black/50 border border-zinc-800 font-mono text-[11px] overflow-hidden">
                        {/* 命中 Chunk 元数据与伴随回复 */}
                        <div className="px-2 py-0.5 bg-zinc-950/80 border-b border-zinc-800/80 flex items-center justify-between text-[10px]">
                          <span className="flex items-center gap-1 font-semibold">
                            <span
                              className={
                                s.search_matches[0].role === 'user'
                                  ? 'text-indigo-400'
                                  : s.search_matches[0].role === 'thinking'
                                    ? 'text-emerald-400'
                                    : 'text-sky-400'
                              }
                            >
                              #{s.search_matches[0].turn_index} {s.search_matches[0].role.toUpperCase()}
                            </span>
                            <span className="text-zinc-500 font-normal">匹配片段</span>
                          </span>
                          {s.search_matches[0].sibling && (
                            <span
                              className="text-zinc-500 truncate max-w-[190px] select-none text-[9.5px]"
                              title={s.search_matches[0].sibling.text}
                            >
                              ↳ {s.search_matches[0].sibling.role === 'model' ? '回复' : '提问'}: {s.search_matches[0].sibling.text}
                            </span>
                          )}
                        </div>

                        {/* 类 rg -C 行号与上下文流 */}
                        <div className="py-0.5 divide-y divide-zinc-900/50">
                          {s.search_matches[0].lines.map((l) => (
                            <div
                              key={l.line_no}
                              className={`flex items-start px-2 py-0.2 leading-tight ${
                                l.is_hit ? 'bg-indigo-950/30 text-zinc-100' : 'text-zinc-500'
                              }`}
                            >
                              <span className="w-6 shrink-0 text-right pr-2 select-none text-[9.5px] font-mono text-zinc-600">
                                {l.line_no}{l.is_hit ? ':' : '-'}
                              </span>
                              <div
                                className="flex-1 truncate"
                                // biome-ignore lint/security/noDangerouslySetInnerHtml: 呈现行级 FTS 高亮标记 (<mark>)
                                dangerouslySetInnerHTML={{ __html: l.text }}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : s.snippet ? (
                      <p
                        className={`text-[11px] text-zinc-200 font-mono w-full bg-black/30 px-2 py-1 rounded border border-zinc-800/60 leading-relaxed overflow-hidden ${
                          isExpanded ? 'line-clamp-2' : 'truncate'
                        }`}
                        // biome-ignore lint/security/noDangerouslySetInnerHtml: 用于呈现 FTS 高亮标记 (<mark>)
                        dangerouslySetInnerHTML={{ __html: s.snippet }}
                      />
                    ) : (
                      <p
                        className={`text-[11px] text-zinc-400 font-sans w-full ${
                          isExpanded ? 'line-clamp-2' : 'truncate'
                        }`}
                      >
                        {s.first_prompt || '(无首轮文本提示)'}
                      </p>
                    )}

                    <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono w-full">
                      <span className="bg-zinc-800/80 px-1 py-0.2 rounded text-zinc-400 max-w-[150px] truncate">
                        {s.model.replace('models/', '')}
                      </span>
                      <span>
                        {s.total_tokens.toLocaleString()} tok · {s.chunk_count ?? s.turn_count}{' '}
                        chunks
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
