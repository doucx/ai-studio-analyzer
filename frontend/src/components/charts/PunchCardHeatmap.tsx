import { useMemo, useState } from 'preact/hooks';
import type { HourlyStatsSummary, PunchcardCellItem } from '../../types/metrics';
import type { HourlyMode } from './HourlyActivityChart';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

interface Props {
  data: HourlyStatsSummary;
  mode: HourlyMode;
}

export function PunchCardHeatmap({ data, mode }: Props) {
  const [hoveredCell, setHoveredCell] = useState<PunchcardCellItem | null>(null);

  const cells = data.punchcard_matrix || [];

  // 构建 (weekday, hour) -> item 的快速查询映射
  const cellMap = useMemo(() => {
    const map = new Map<string, PunchcardCellItem>();
    for (const c of cells) {
      map.set(`${c.weekday}-${c.hour}`, c);
    }
    return map;
  }, [cells]);

  const maxVal = useMemo(() => {
    if (mode === 'tokens') return data.max_cell_tokens || 1;
    if (mode === 'chunks') return data.max_cell_chunks || 1;
    return data.max_cell_thought || 1;
  }, [data, mode]);

  // 根据当前数值在矩阵中的相对占比计算热力色阶
  const getCellColor = (val: number) => {
    if (val <= 0) return 'bg-zinc-900/60 border-zinc-800/40 text-transparent';
    const ratio = val / maxVal;
    if (ratio < 0.15) return 'bg-indigo-950/80 border-indigo-900/60 text-indigo-300';
    if (ratio < 0.4) return 'bg-indigo-800/80 border-indigo-700/70 text-indigo-100';
    if (ratio < 0.75) return 'bg-indigo-600 border-indigo-500 text-white font-medium';
    return 'bg-indigo-400 border-indigo-300 text-zinc-950 font-bold shadow-[0_0_10px_rgba(129,140,248,0.4)]';
  };

  return (
    <div className="space-y-3 pt-2">
      <div className="overflow-x-auto pb-2">
        <div className="min-w-[680px]">
          {/* 顶栏：小时刻度标注 */}
          <div className="grid grid-cols-[56px_repeat(24,1fr)] gap-1 text-[10px] font-mono text-zinc-500 mb-1.5 px-0.5">
            <span className="text-right pr-2">周/时</span>
            {HOURS.map((h) => (
              <span
                key={h}
                className={`text-center select-none ${h % 3 === 0 ? 'text-zinc-400 font-semibold' : 'text-zinc-600'}`}
              >
                {h % 2 === 0 ? `${h.toString().padStart(2, '0')}` : '·'}
              </span>
            ))}
          </div>

          {/* 7 行矩阵本体 (周一至周日) */}
          <div className="space-y-1">
            {WEEKDAYS.map((dayLabel, wIdx) => (
              <div
                key={dayLabel}
                className="grid grid-cols-[56px_repeat(24,1fr)] gap-1 items-center"
              >
                <span className="text-[11px] font-mono text-zinc-400 text-right pr-2 select-none">
                  {dayLabel}
                </span>

                {HOURS.map((h) => {
                  const cell = cellMap.get(`${wIdx}-${h}`) || {
                    weekday: wIdx,
                    hour: h,
                    tokens: 0,
                    thought_tokens: 0,
                    chunks: 0,
                  };

                  const val =
                    mode === 'tokens'
                      ? cell.tokens
                      : mode === 'chunks'
                        ? cell.chunks
                        : cell.thought_tokens;

                  const colorClass = getCellColor(val);

                  return (
                    <div
                      key={h}
                      role="tooltip"
                      tabIndex={-1}
                      onMouseEnter={() => setHoveredCell(cell)}
                      onMouseLeave={() => setHoveredCell(null)}
                      className={`h-6 rounded-[3px] border transition-colors duration-100 cursor-default flex items-center justify-center text-[9px] font-mono ${colorClass} hover:brightness-125 hover:ring-2 hover:ring-white/90 z-0 hover:z-10`}
                      title={`${dayLabel} ${h.toString().padStart(2, '0')}:00 ~ ${h.toString().padStart(2, '0')}:59`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 底部信息栏：色阶图例与恒定高度占位指标栏 (消除 CLS 抖动) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-zinc-800/80 text-xs font-mono min-h-[36px]">
        <div className="flex items-center gap-1.5 text-zinc-500 text-[11px] shrink-0">
          <span>活跃度:</span>
          <span
            className="w-3 h-3 rounded-[2px] bg-zinc-900 border border-zinc-800 inline-block"
            title="无消耗"
          />
          <span
            className="w-3 h-3 rounded-[2px] bg-indigo-950 border border-indigo-900 inline-block"
            title="轻度"
          />
          <span
            className="w-3 h-3 rounded-[2px] bg-indigo-800 border border-indigo-700 inline-block"
            title="中度"
          />
          <span
            className="w-3 h-3 rounded-[2px] bg-indigo-600 border border-indigo-500 inline-block"
            title="高度"
          />
          <span
            className="w-3 h-3 rounded-[2px] bg-indigo-400 border border-indigo-300 inline-block"
            title="高能峰值"
          />
          <span className="text-[10px] ml-1 text-zinc-400">
            峰值: {maxVal.toLocaleString()} {mode === 'chunks' ? 'chunks' : 'tok'}
          </span>
        </div>

        {/* 刚性定高容器：未悬停与悬停时采用相同的内外边距基线，彻底杜绝父级高度伸缩 */}
        <div className="h-7 flex items-center justify-start sm:justify-end shrink-0">
          {hoveredCell ? (
            <div className="text-zinc-200 text-[11px] bg-zinc-950/90 px-2.5 py-1 rounded border border-zinc-800 flex items-center gap-2 shadow-sm animate-in fade-in duration-100">
              <span className="text-indigo-400 font-semibold">
                {WEEKDAYS[hoveredCell.weekday]} {hoveredCell.hour.toString().padStart(2, '0')}:00
              </span>
              <span>·</span>
              <span>{hoveredCell.tokens.toLocaleString()} tok</span>
              <span>·</span>
              <span className="text-sky-300">{hoveredCell.chunks} chunks</span>
              {hoveredCell.thought_tokens > 0 && (
                <>
                  <span>·</span>
                  <span className="text-emerald-400">
                    思考: {hoveredCell.thought_tokens.toLocaleString()} tok
                  </span>
                </>
              )}
            </div>
          ) : (
            <div className="text-[11px] text-zinc-500 px-2.5 py-1 flex items-center border border-transparent select-none">
              悬停方格查看该时段精确推进与算力明细
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
