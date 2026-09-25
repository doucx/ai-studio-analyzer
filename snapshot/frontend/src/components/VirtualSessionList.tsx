import { useMemo, useRef, useState } from 'preact/hooks';
import type { SessionItem } from '../types/metrics';

interface Props {
  sessions: SessionItem[];
  selectedId: string | null;
  onSelect: (session: SessionItem) => void;
}

const ITEM_HEIGHT = 86; // 每项固定高度 86px
const BUFFER = 5; // 视口外缓冲项数

export function VirtualSessionList({ sessions, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'modified' | 'tokens' | 'turns'>('modified');

  // 客户端毫秒级本地过滤与排序
  const filteredSessions = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    let result = sessions;
    if (term) {
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(term) ||
          s.first_prompt.toLowerCase().includes(term) ||
          s.model.toLowerCase().includes(term)
      );
    }

    return [...result].sort((a, b) => {
      if (sortBy === 'tokens') {
        return b.total_tokens - a.total_tokens;
      }
      if (sortBy === 'turns') {
        return b.turn_count - a.turn_count;
      }
      const timeA = a.modified_time ? new Date(a.modified_time).getTime() : 0;
      const timeB = b.modified_time ? new Date(b.modified_time).getTime() : 0;
      return timeB - timeA;
    });
  }, [sessions, searchTerm, sortBy]);

  // 虚拟列表动态计算
  const totalHeight = filteredSessions.length * ITEM_HEIGHT;
  const containerHeight = containerRef.current?.clientHeight || 650;

  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER);
  const visibleCount = Math.ceil(containerHeight / ITEM_HEIGHT);
  const endIndex = Math.min(filteredSessions.length, startIndex + visibleCount + BUFFER * 2);
  const offsetY = startIndex * ITEM_HEIGHT;

  const visibleItems = filteredSessions.slice(startIndex, endIndex);

  return (
    <div className="flex flex-col h-full bg-zinc-900/60 border border-zinc-800 rounded-lg overflow-hidden">
      {/* 搜索与排序控制栏 */}
      <div className="p-3 border-b border-zinc-800 space-y-2 bg-zinc-900/90">
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <span className="font-semibold text-zinc-200">
            会话历史 ({filteredSessions.length} / {sessions.length})
          </span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy((e.target as HTMLSelectElement).value as any)}
            className="bg-zinc-950 border border-zinc-700 text-zinc-300 text-[11px] rounded px-1.5 py-0.5 outline-none focus:border-indigo-500"
          >
            <option value="modified">最近修改</option>
            <option value="tokens">Token 能耗</option>
            <option value="turns">轮次深度</option>
          </select>
        </div>

        <div className="relative">
          <input
            type="text"
            placeholder="搜索会话标题、首轮 Prompt、模型..."
            value={searchTerm}
            onInput={(e) => {
              setSearchTerm((e.target as HTMLInputElement).value);
              setScrollTop(0);
              if (containerRef.current) containerRef.current.scrollTop = 0;
            }}
            className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-500 outline-none transition"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-2 top-1 text-xs text-zinc-500 hover:text-zinc-300"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 虚拟滚动主体视口 */}
      <div
        ref={containerRef}
        onScroll={(e) => setScrollTop((e.target as HTMLElement).scrollTop)}
        className="flex-1 overflow-y-auto relative w-full divide-y divide-zinc-800/40 select-none"
      >
        {filteredSessions.length === 0 ? (
          <div className="p-8 text-center text-xs text-zinc-500">未检索到匹配的交互会话</div>
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
                  <div
                    key={s.file_id}
                    onClick={() => onSelect(s)}
                    style={{ height: `${ITEM_HEIGHT}px` }}
                    className={`p-2.5 cursor-pointer transition flex flex-col justify-between border-b border-zinc-800/30 ${
                      isSelected
                        ? 'bg-indigo-950/60 border-l-2 border-l-indigo-500 text-white'
                        : 'hover:bg-zinc-800/40 text-zinc-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
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

                    <p className="text-[11px] text-zinc-400 truncate font-sans">
                      {s.first_prompt || '(无首轮文本提示)'}
                    </p>

                    <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono">
                      <span className="bg-zinc-800/80 px-1 py-0.2 rounded text-zinc-400 max-w-[130px] truncate">
                        {s.model.replace('models/', '')}
                      </span>
                      <span>
                        {s.total_tokens.toLocaleString()} tok · {s.turn_count} 轮
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}