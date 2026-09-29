import { Activity, Cpu, Layers } from 'lucide-preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import type { DailyTrendItem } from '../types/metrics';

export type ScrubberMetric = 'tokens' | 'chunks' | 'sessions';

interface Props {
  dailyTrends: DailyTrendItem[];
  startDate: string;
  endDate: string;
  onRangeChange: (start: string, end: string) => void;
}

export function TimeSliceScrubber({ dailyTrends, startDate, endDate, onRangeChange }: Props) {
  const [metric, setMetric] = useState<ScrubberMetric>('tokens');
  const trackRef = useRef<HTMLDivElement | null>(null);

  // 拖拽状态 (左边界、右边界、中间平移)
  const [dragMode, setDragMode] = useState<'start' | 'end' | 'pan' | null>(null);
  const dragAnchorRef = useRef<{
    startX: number;
    initialStartIndex: number;
    initialEndIndex: number;
  }>({ startX: 0, initialStartIndex: 0, initialEndIndex: 0 });

  // 1. 规范化并保证日期序列升序
  const sortedData = useMemo(() => {
    return [...dailyTrends].sort((a, b) => a.date.localeCompare(b.date));
  }, [dailyTrends]);

  const dates = useMemo(() => sortedData.map((d) => d.date), [sortedData]);

  // 2. 当前选中索引定位 (若无则默认全选)
  const startIndex = useMemo(() => {
    if (!startDate || dates.length === 0) return 0;
    const idx = dates.indexOf(startDate);
    return idx >= 0 ? idx : 0;
  }, [dates, startDate]);

  const endIndex = useMemo(() => {
    if (!endDate || dates.length === 0) return Math.max(0, dates.length - 1);
    const idx = dates.indexOf(endDate);
    return idx >= 0 ? idx : Math.max(0, dates.length - 1);
  }, [dates, endDate]);

  // 3. 计算波形曲线几何路径
  const { pathData, currentTotal } = useMemo(() => {
    if (sortedData.length === 0) {
      return { pathData: '', currentTotal: 0 };
    }

    const values = sortedData.map((d) => {
      if (metric === 'tokens') return d.total_tokens || 0;
      if (metric === 'chunks') return d.turns || 0;
      return d.sessions || 0;
    });

    const max = Math.max(...values, 1);
    const count = sortedData.length;
    const width = 1000; // 内部虚拟矢量坐标宽度
    const height = 120; // 内部虚拟矢量坐标高度
    const paddingBottom = 8;
    const effectiveHeight = height - paddingBottom;

    const points = values.map((val, i) => {
      const x = count > 1 ? (i / (count - 1)) * width : width / 2;
      const y = height - (val / max) * effectiveHeight - paddingBottom;
      return { x, y };
    });

    // 封闭为面积图路径
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      // 简单平滑折线
      d += ` L ${points[i].x} ${points[i].y}`;
    }
    const areaD = `${d} L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`;

    // 计算当前选区内累计指标量
    const subValues = values.slice(startIndex, endIndex + 1);
    const total = subValues.reduce((acc, curr) => acc + curr, 0);

    return { pathData: areaD, currentTotal: total };
  }, [sortedData, metric, startIndex, endIndex]);

  // 4. 百分比位置计算
  const count = dates.length;
  const leftPercent = count > 1 ? (startIndex / (count - 1)) * 100 : 0;
  const rightPercent = count > 1 ? (endIndex / (count - 1)) * 100 : 100;
  const selectionWidthPercent = Math.max(0, rightPercent - leftPercent);

  // 5. 坐标到日期索引吸附算法
  const getIndexFromClientX = (clientX: number): number => {
    if (!trackRef.current || dates.length <= 1) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const relativeX = clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, relativeX / rect.width));
    return Math.round(ratio * (dates.length - 1));
  };

  // 6. 指针交互处理器 (支持边界拉伸与选区平移)
  const handlePointerDown = (e: PointerEvent, mode: 'start' | 'end' | 'pan') => {
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // 容错处理
    }
    setDragMode(mode);
    dragAnchorRef.current = {
      startX: e.clientX,
      initialStartIndex: startIndex,
      initialEndIndex: endIndex,
    };
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!dragMode || dates.length === 0) return;
    e.preventDefault();
    e.stopPropagation();

    if (dragMode === 'start') {
      // 严格硬性阻挡：不能越过当前的截止日期 (endIndex)
      const targetIdx = getIndexFromClientX(e.clientX);
      const clampedStart = Math.min(Math.max(0, targetIdx), endIndex);
      onRangeChange(dates[clampedStart], dates[endIndex]);
    } else if (dragMode === 'end') {
      // 严格硬性阻挡：不能越过当前的起始日期 (startIndex)
      const targetIdx = getIndexFromClientX(e.clientX);
      const clampedEnd = Math.max(Math.min(dates.length - 1, targetIdx), startIndex);
      onRangeChange(dates[startIndex], dates[clampedEnd]);
    } else if (dragMode === 'pan') {
      // 选区整体平移 (保持 span 恒定)
      if (!trackRef.current || dates.length <= 1) return;
      const rect = trackRef.current.getBoundingClientRect();
      const deltaX = e.clientX - dragAnchorRef.current.startX;
      const deltaRatio = deltaX / rect.width;
      const deltaIndices = Math.round(deltaRatio * (dates.length - 1));

      const span = dragAnchorRef.current.initialEndIndex - dragAnchorRef.current.initialStartIndex;

      let newStart = dragAnchorRef.current.initialStartIndex + deltaIndices;
      let newEnd = dragAnchorRef.current.initialEndIndex + deltaIndices;

      if (newStart < 0) {
        newStart = 0;
        newEnd = Math.min(dates.length - 1, span);
      } else if (newEnd >= dates.length) {
        newEnd = dates.length - 1;
        newStart = Math.max(0, dates.length - 1 - span);
      }

      onRangeChange(dates[newStart], dates[newEnd]);
    }
  };

  const handlePointerUp = (e: PointerEvent) => {
    if (dragMode) {
      e.preventDefault();
      e.stopPropagation();
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // 忽略捕获释放异常
      }
      setDragMode(null);
    }
  };

  return (
    <div className="space-y-3 select-none">
      {/* 顶部控制栏：维度选择与当前切片指标聚合 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded-md border border-zinc-800 text-[10px]">
          <button
            type="button"
            onClick={() => setMetric('tokens')}
            className={`px-2 py-0.5 rounded transition flex items-center gap-1 cursor-pointer ${
              metric === 'tokens'
                ? 'bg-indigo-600 text-white font-medium shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Cpu size={11} />
            <span>Token 能耗</span>
          </button>
          <button
            type="button"
            onClick={() => setMetric('chunks')}
            className={`px-2 py-0.5 rounded transition flex items-center gap-1 cursor-pointer ${
              metric === 'chunks'
                ? 'bg-indigo-600 text-white font-medium shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Layers size={11} />
            <span>Chunk 推进</span>
          </button>
          <button
            type="button"
            onClick={() => setMetric('sessions')}
            className={`px-2 py-0.5 rounded transition flex items-center gap-1 cursor-pointer ${
              metric === 'sessions'
                ? 'bg-indigo-600 text-white font-medium shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Activity size={11} />
            <span>交互场次</span>
          </button>
        </div>

        <div className="text-[11px] font-mono text-zinc-400 truncate">
          <span>选中区间累计: </span>
          <strong className="text-indigo-300">
            {metric === 'tokens'
              ? `${currentTotal.toLocaleString()} tok`
              : metric === 'chunks'
                ? `${currentTotal.toLocaleString()} chunks`
                : `${currentTotal} 场`}
          </strong>
        </div>
      </div>

      {/* 核心轨道：纯粹波形 Sparkline + 遮罩展示 (彻底禁用非边界点击与跳跃) */}
      <div
        ref={trackRef}
        className="relative h-24 w-full bg-zinc-950/90 rounded-lg border border-zinc-800 overflow-hidden select-none cursor-default group"
      >
        {/* 背景微缩波形图 (SVG) */}
        {sortedData.length > 0 ? (
          <svg
            aria-hidden="true"
            viewBox="0 0 1000 120"
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full pointer-events-none opacity-80"
          >
            <defs>
              <linearGradient id="scrubberGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#818cf8" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#818cf8" stopOpacity="0.03" />
              </linearGradient>
            </defs>
            <path d={pathData} fill="url(#scrubberGradient)" />
            {/* 顶层走势细线 */}
            <path
              d={pathData.replace(/ L \d+ 120 L 0 120 Z$/, '')}
              fill="none"
              stroke="#818cf8"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-600 font-mono">
            暂无历史时序波形数据
          </div>
        )}

        {/* 左侧遮罩 (未选中部分，零动画瞬时随动，无模糊渲染负担) */}
        <div
          className="absolute top-0 bottom-0 left-0 bg-black/70 pointer-events-none"
          style={{ width: `${leftPercent}%` }}
        />

        {/* 右侧遮罩 (未选中部分，零动画瞬时随动，无模糊渲染负担) */}
        <div
          className="absolute top-0 bottom-0 right-0 bg-black/70 pointer-events-none"
          style={{ width: `${100 - rightPercent}%` }}
        />

        {/* 中间高亮选区窗口 (零几何延迟，支持抓握平移) */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: 仅用于阻断内部点击向外部扩散 */}
        <div
          role="presentation"
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => handlePointerDown(e, 'pan')}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className={`absolute top-0 bottom-0 z-10 border-y-2 border-indigo-500/80 bg-indigo-500/10 cursor-grab active:cursor-grabbing ${
            dragMode === 'pan' ? 'bg-indigo-500/25 border-indigo-400' : 'hover:bg-indigo-500/15'
          }`}
          style={{
            left: `${leftPercent}%`,
            width: `${selectionWidthPercent}%`,
          }}
          title="按住选区可整体左右平移"
        />

        {/* 左边界交互条 (纯边线 + 宽热区 + cursor-ew-resize，阻止所有冒泡) */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: 指针抓握拖拽交互 */}
        <div
          role="slider"
          aria-label="起始日期边界"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, dates.length - 1)}
          aria-valuenow={startIndex}
          tabIndex={0}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => handlePointerDown(e, 'start')}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="absolute top-0 bottom-0 -ml-2.5 w-5 z-20 flex items-center justify-center cursor-ew-resize group/border"
          style={{ left: `${leftPercent}%` }}
          title={`起始日期: ${dates[startIndex] || startDate} (拖拽调整)`}
        >
          {/* 纯净细垂直高亮线 */}
          <div
            className={`w-0.5 h-full transition-colors ${
              dragMode === 'start'
                ? 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]'
                : 'bg-indigo-400/90 group-hover/border:bg-white group-hover/border:w-1'
            }`}
          />

          {/* 仅在悬停或拖拽时浮现轻量日期提示 */}
          <div
            className={`absolute -top-6 left-1/2 -translate-x-1/2 px-1.5 py-0.2 rounded text-[9px] font-mono whitespace-nowrap bg-zinc-900 text-indigo-200 border border-indigo-800/80 shadow-lg pointer-events-none transition-opacity ${
              dragMode === 'start' ? 'opacity-100' : 'opacity-0 group-hover/border:opacity-100'
            }`}
          >
            {dates[startIndex] || startDate}
          </div>
        </div>

        {/* 右边界交互条 (纯边线 + 宽热区 + cursor-ew-resize，阻止所有冒泡) */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: 指针抓握拖拽交互 */}
        <div
          role="slider"
          aria-label="截止日期边界"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, dates.length - 1)}
          aria-valuenow={endIndex}
          tabIndex={0}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => handlePointerDown(e, 'end')}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="absolute top-0 bottom-0 -ml-2.5 w-5 z-20 flex items-center justify-center cursor-ew-resize group/border"
          style={{ left: `${rightPercent}%` }}
          title={`截止日期: ${dates[endIndex] || endDate} (拖拽调整)`}
        >
          {/* 纯净细垂直高亮线 */}
          <div
            className={`w-0.5 h-full transition-colors ${
              dragMode === 'end'
                ? 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]'
                : 'bg-indigo-400/90 group-hover/border:bg-white group-hover/border:w-1'
            }`}
          />

          {/* 仅在悬停或拖拽时浮现轻量日期提示 */}
          <div
            className={`absolute -top-6 left-1/2 -translate-x-1/2 px-1.5 py-0.2 rounded text-[9px] font-mono whitespace-nowrap bg-zinc-900 text-indigo-200 border border-indigo-800/80 shadow-lg pointer-events-none transition-opacity ${
              dragMode === 'end' ? 'opacity-100' : 'opacity-0 group-hover/border:opacity-100'
            }`}
          >
            {dates[endIndex] || endDate}
          </div>
        </div>
      </div>

      {/* 底部时间跨度两极刻度标注 */}
      {dates.length > 0 && (
        <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono px-0.5">
          <span>{dates[0]}</span>
          <span className="text-zinc-400">{dates[Math.floor(dates.length / 2)]}</span>
          <span>{dates[dates.length - 1]}</span>
        </div>
      )}
    </div>
  );
}
