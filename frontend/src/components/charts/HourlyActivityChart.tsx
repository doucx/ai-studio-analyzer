import type { ChartConfiguration } from 'chart.js';
import { BarChart2, Grid } from 'lucide-preact';
import { useMemo, useState } from 'preact/hooks';
import type { HourlyStatsSummary } from '../../types/metrics';
import { PunchCardHeatmap } from './PunchCardHeatmap';
import { BaseChart } from './base/BaseChart';
import { CHART_PALETTE, defaultDarkScales, defaultDarkTooltipOptions } from './base/chartTheme';

export type HourlyMode = 'tokens' | 'chunks' | 'thought';
export type ViewFormat = 'bar' | 'punchcard';

interface Props {
  data: HourlyStatsSummary;
  activeRangeLabel: string;
}

export function HourlyActivityChart({ data, activeRangeLabel }: Props) {
  const [mode, setMode] = useState<HourlyMode>('tokens');
  const [format, setFormat] = useState<ViewFormat>('bar');

  const chartConfig = useMemo<ChartConfiguration<'bar'>>(() => {
    const slots = data.hourly_slots;
    const labels = slots.map((s) => s.label);

    let dataValues: number[] = [];
    let barColor = 'rgba(99, 102, 241, 0.7)';
    let hoverColor = CHART_PALETTE.indigo;
    let datasetLabel = '上下文 Token';

    if (mode === 'tokens') {
      dataValues = slots.map((s) => s.tokens);
      barColor = 'rgba(129, 140, 248, 0.65)';
      hoverColor = CHART_PALETTE.indigo;
      datasetLabel = '上下文 Token 规模';
    } else if (mode === 'chunks') {
      dataValues = slots.map((s) => s.chunks);
      barColor = 'rgba(56, 189, 248, 0.65)';
      hoverColor = CHART_PALETTE.sky;
      datasetLabel = 'Chunk 往返推进量';
    } else if (mode === 'thought') {
      dataValues = slots.map((s) => s.thought_tokens);
      barColor = 'rgba(52, 211, 153, 0.65)';
      hoverColor = CHART_PALETTE.emerald;
      datasetLabel = '思考链 (Thinking) 算力';
    }

    return {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: datasetLabel,
            data: dataValues,
            backgroundColor: barColor,
            hoverBackgroundColor: hoverColor,
            borderRadius: 4,
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...defaultDarkTooltipOptions,
            callbacks: {
              title(items) {
                const item = items[0];
                return `时段: ${item.label} ~ ${item.label.split(':')[0]}:59`;
              },
              label(context) {
                const val = Number(context.raw) || 0;
                const slot = slots[context.dataIndex];
                if (mode === 'tokens') {
                  return [
                    ` 消耗: ${val.toLocaleString()} tokens`,
                    ` 包含 ${slot.chunks} 个 Chunks (${slot.sessions} 场会话)`,
                  ];
                }
                if (mode === 'chunks') {
                  return [
                    ` 推进量: ${val.toLocaleString()} 个 Chunks`,
                    ` 涉及 ${slot.sessions} 场会话 (${slot.tokens.toLocaleString()} tok)`,
                  ];
                }
                return [
                  ` 思考链: ${val.toLocaleString()} tokens`,
                  ` 占该时段算力: ${slot.tokens > 0 ? ((val / slot.tokens) * 100).toFixed(1) : 0}%`,
                ];
              },
            },
          },
        },
        scales: {
          x: {
            ...defaultDarkScales.x,
            grid: { display: false },
            ticks: {
              ...defaultDarkScales.x.ticks,
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 12,
            },
          },
          y: {
            ...defaultDarkScales.y,
            ticks: {
              ...defaultDarkScales.y.ticks,
              callback(value) {
                const num = Number(value);
                if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
                if (num >= 1_000) return `${(num / 1_000).toFixed(0)}k`;
                return num;
              },
            },
          },
        },
      },
    };
  }, [data, mode]);

  const peakHourStr = `${data.peak_hour.toString().padStart(2, '0')}:00`;

  return (
    <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-zinc-200">
              24小时认知精力与交互分布 (Anki 时段统计模式)
            </h2>
            <span className="text-[10px] font-mono text-indigo-400 bg-indigo-950/80 px-1.5 py-0.5 rounded border border-indigo-800/60">
              精确至 Chunk
            </span>
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">
            统计【{activeRangeLabel}】周期内一天 24 个时段的心智精力活跃度，识别个人的推理黄金时段
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 p-0.5 bg-zinc-950 border border-zinc-800 rounded-md">
            <button
              type="button"
              onClick={() => setMode('tokens')}
              className={`text-[11px] px-2.5 py-1 rounded font-medium transition cursor-pointer ${
                mode === 'tokens'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              }`}
            >
              上下文 Token
            </button>
            <button
              type="button"
              onClick={() => setMode('chunks')}
              className={`text-[11px] px-2.5 py-1 rounded font-medium transition cursor-pointer ${
                mode === 'chunks'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              }`}
            >
              Chunk 推进数
            </button>
            <button
              type="button"
              onClick={() => setMode('thought')}
              className={`text-[11px] px-2.5 py-1 rounded font-medium transition cursor-pointer ${
                mode === 'thought'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              }`}
            >
              思考链 Token
            </button>
          </div>

          {/* 视图形态切换：直方走势 vs 7x24 Punch Card */}
          <div className="flex items-center gap-1 p-0.5 bg-zinc-950 border border-zinc-800 rounded-md">
            <button
              type="button"
              onClick={() => setFormat('bar')}
              className={`p-1 rounded transition cursor-pointer flex items-center gap-1 text-[11px] ${
                format === 'bar'
                  ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
              title="24小时聚合直方柱状图"
            >
              <BarChart2 size={13} />
              <span className="hidden sm:inline">直方图</span>
            </button>
            <button
              type="button"
              onClick={() => setFormat('punchcard')}
              className={`p-1 rounded transition cursor-pointer flex items-center gap-1 text-[11px] ${
                format === 'punchcard'
                  ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
              title="7×24 星期-时段打卡热力盘 (Punch Card)"
            >
              <Grid size={13} />
              <span className="hidden sm:inline">7×24热力</span>
            </button>
          </div>

          <span
            className="text-xs font-mono text-amber-300 bg-amber-950/50 border border-amber-800/40 px-2 py-1 rounded shrink-0 hidden md:inline"
            title="该周期内能耗最高的黄金时段"
          >
            峰值: {peakHourStr}
          </span>
        </div>
      </div>

      {format === 'bar' ? (
        <BaseChart config={chartConfig} heightClass="h-60" />
      ) : (
        <PunchCardHeatmap data={data} mode={mode} />
      )}
    </section>
  );
}
