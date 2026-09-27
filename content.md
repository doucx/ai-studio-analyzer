好的，我将按照方案 A，为时序趋势图表卡片增加视图模式切换胶囊，支持在“上下文 Token 规模”、“Chunk 交互推进数”以及“交互总场次”三者间自由切换，并优化能耗卡片上的上下文规模说明。

## [WIP] feat(frontend): 为趋势卡片增加多维视图切换器 (Token/Chunk/场次)

### 用户需求
1. 在全景大盘的时序趋势卡片中引入视图切换器 (View Mode Switcher)，支持三个维度的切换：
   - **上下文 Token**：保留现有的总 Token 与思考链规模堆叠面积图。
   - **Chunk 推进数**：呈现每日人机往返推进的数据块总量时序图。
   - **交互场次**：呈现每日发生交互的独立会话场次时序图。
2. 明确标注静态上下文规模的口径定义，使各卡片语义更加精确。

### 评论
当前后端已在 `daily_trends` 中完整聚合了 `total_tokens`、`thought_tokens`、`turns`（即 Chunk 数）和 `sessions`（场次），数据基础设施完全就绪。在前端引入三重视图切换胶囊，既能避免新增图表导致页面冗余拉长，又能将“知识沉淀深度（Token）”、“交互推进颗粒度（Chunk）”与“发散范围（场次）”三维认知特征全面释放。

### 目标
1. 扩展 `TokenTrendChart.tsx`：引入 `TrendMode` 类型（`tokens` | `chunks` | `sessions`），根据当前模式自适应切换图表类型（折线/柱状图）、Y 轴刻度单位、Tooltip 格式化与颜色体系。
2. 更新 `OverviewDashboard.tsx`：在时序趋势卡片头部添加模式切换胶囊，并动态响应卡片标题与说明文案；微调关键指标卡片文案强化“上下文资产规模”口径认知。

### 基本原理
1. **多态渲染**：`BaseChart` 监听 `config` 属性变更并在更新时安全重建 Chart.js 实例，支持无缝在平滑折线面积图（Token/Chunk）与带圆角暗色柱状图（Sessions）之间平滑切换。
2. **轻量局部状态**：将 `trendMode` 作为卡片内部的 UI 交互状态（`tokens` 默认为第一项），不增加全局状态负担，交互响应即时。

### 标签
#intent/build #flow/ready #priority/medium #comp/ui #concept/ui #scope/ux #ai/instruct #task/domain/ui #task/object/trend-chart-view-modes #task/action/implementation #task/state/begin #task/status/active

---

### Script

#### Acts 1: 升级趋势图组件支持三重视图模式

我们将重构 `TokenTrendChart.tsx`，使其支持 `tokens`、`chunks` 与 `sessions` 三种渲染模式。

~~~~~act
write_file
frontend/src/components/charts/TokenTrendChart.tsx
~~~~~
~~~~~typescript
import type { ChartConfiguration } from 'chart.js';
import { useMemo } from 'preact/hooks';
import type { DailyTrendItem } from '../../types/metrics';
import { BaseChart } from './base/BaseChart';
import { CHART_PALETTE, defaultDarkScales, defaultDarkTooltipOptions } from './base/chartTheme';

export type TrendMode = 'tokens' | 'chunks' | 'sessions';

interface Props {
  data: DailyTrendItem[];
  mode?: TrendMode;
}

export function TokenTrendChart({ data, mode = 'tokens' }: Props) {
  const chartConfig = useMemo<ChartConfiguration<'line' | 'bar'>>(() => {
    const labels = data.map((d) => d.date);

    // 1. 上下文 Token 规模模式 (双折线面积图)
    if (mode === 'tokens') {
      const totalTokens = data.map((d) => d.total_tokens);
      const thoughtTokens = data.map((d) => d.thought_tokens);

      return {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: '总 Token 规模',
              data: totalTokens,
              borderColor: CHART_PALETTE.indigo,
              backgroundColor: CHART_PALETTE.indigoBg,
              fill: true,
              tension: 0.3,
              borderWidth: 2,
              pointRadius: labels.length > 40 ? 0 : 2.5,
              pointHoverRadius: 5,
            },
            {
              label: '思考链 (Thinking) 规模',
              data: thoughtTokens,
              borderColor: CHART_PALETTE.emerald,
              backgroundColor: CHART_PALETTE.emeraldBg,
              fill: true,
              tension: 0.3,
              borderWidth: 1.8,
              pointRadius: labels.length > 40 ? 0 : 2.5,
              pointHoverRadius: 5,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              position: 'top',
              labels: {
                color: CHART_PALETTE.textSecondary,
                font: { size: 11 },
                boxWidth: 12,
                usePointStyle: true,
              },
            },
            tooltip: {
              ...defaultDarkTooltipOptions,
              callbacks: {
                label(context) {
                  const val = Number(context.raw) || 0;
                  return ` ${context.dataset.label}: ${val.toLocaleString()} tokens`;
                },
              },
            },
          },
          scales: {
            x: {
              ...defaultDarkScales.x,
              ticks: { ...defaultDarkScales.x.ticks, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
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
    }

    // 2. Chunk 交互推进量模式 (平滑折线面积图)
    if (mode === 'chunks') {
      const chunks = data.map((d) => d.turns);

      return {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Chunk 推进量',
              data: chunks,
              borderColor: CHART_PALETTE.sky,
              backgroundColor: 'rgba(56, 189, 248, 0.12)',
              fill: true,
              tension: 0.3,
              borderWidth: 2,
              pointRadius: labels.length > 40 ? 0 : 2.5,
              pointHoverRadius: 5,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              ...defaultDarkTooltipOptions,
              callbacks: {
                label(context) {
                  const val = Number(context.raw) || 0;
                  return ` Chunk 推进量: ${val.toLocaleString()} 个数据块`;
                },
              },
            },
          },
          scales: {
            x: {
              ...defaultDarkScales.x,
              ticks: { ...defaultDarkScales.x.ticks, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
            },
            y: {
              ...defaultDarkScales.y,
              ticks: {
                ...defaultDarkScales.y.ticks,
                precision: 0,
              },
            },
          },
        },
      };
    }

    // 3. 每日会话场次活跃度模式 (带圆角暗色柱状图)
    const sessions = data.map((d) => d.sessions);
    return {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: '会话场次',
            data: sessions,
            backgroundColor: 'rgba(129, 140, 248, 0.75)',
            hoverBackgroundColor: CHART_PALETTE.indigo,
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
              label(context) {
                const val = Number(context.raw) || 0;
                return ` 活跃会话: ${val} 场`;
              },
            },
          },
        },
        scales: {
          x: {
            ...defaultDarkScales.x,
            ticks: { ...defaultDarkScales.x.ticks, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
          },
          y: {
            ...defaultDarkScales.y,
            ticks: {
              ...defaultDarkScales.y.ticks,
              precision: 0,
            },
          },
        },
      },
    };
  }, [data, mode]);

  return <BaseChart config={chartConfig} heightClass="h-72" />;
}
~~~~~

#### Acts 2: 在全景大盘中集成视图切换胶囊与精准标签

在 `OverviewDashboard.tsx` 中增加 `trendMode` 状态，嵌入三项胶囊按钮，并将相关卡片文案明确为“上下文规模”。

~~~~~act
patch_file
frontend/src/components/OverviewDashboard.tsx
~~~~~
~~~~~typescript.old
import { Bot, Clock, LineChart, Sparkles } from 'lucide-preact';
import { todayMetricsSignal } from '../state/metrics';
import type { MetricsSummary } from '../types/metrics';
import { DurationTiersChart } from './charts/DurationTiersChart';
import { ModelDistributionChart } from './charts/ModelDistributionChart';
import { TokenTrendChart } from './charts/TokenTrendChart';

interface Props {
  metrics: MetricsSummary;
  activeRangeLabel: string;
}

export function OverviewDashboard({ metrics, activeRangeLabel }: Props) {
  const today = todayMetricsSignal.value;

  return (
~~~~~
~~~~~typescript.new
import { Bot, Clock, LineChart, Sparkles } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { todayMetricsSignal } from '../state/metrics';
import type { MetricsSummary } from '../types/metrics';
import { DurationTiersChart } from './charts/DurationTiersChart';
import { ModelDistributionChart } from './charts/ModelDistributionChart';
import { TokenTrendChart, type TrendMode } from './charts/TokenTrendChart';

interface Props {
  metrics: MetricsSummary;
  activeRangeLabel: string;
}

export function OverviewDashboard({ metrics, activeRangeLabel }: Props) {
  const [trendMode, setTrendMode] = useState<TrendMode>('tokens');
  const today = todayMetricsSignal.value;

  return (
~~~~~

~~~~~act
patch_file
frontend/src/components/OverviewDashboard.tsx
~~~~~
~~~~~typescript.old
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-4">
          <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
            <span>总 Token 能耗</span>
            <span className="text-[10px] text-zinc-500 font-mono">[{activeRangeLabel}]</span>
          </div>
          <div className="mt-1.5 text-2xl font-bold text-emerald-400 tracking-tight">
            {(metrics.tok_stats?.total || 0).toLocaleString()}
          </div>
          <div className="mt-1 text-[11px] text-zinc-500 truncate">
            思考链 (Thinking): {metrics.tok_stats?.thought_ratio ?? '0%'}
          </div>
        </div>
~~~~~
~~~~~typescript.new
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-4">
          <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
            <span>总 Token 规模</span>
            <span className="text-[10px] text-zinc-500 font-mono">[{activeRangeLabel}]</span>
          </div>
          <div className="mt-1.5 text-2xl font-bold text-emerald-400 tracking-tight">
            {(metrics.tok_stats?.total || 0).toLocaleString()}
          </div>
          <div className="mt-1 text-[11px] text-zinc-500 truncate" title="会话最终上下文规模，含思考链占比">
            上下文规模 · 思考: {metrics.tok_stats?.thought_ratio ?? '0%'}
          </div>
        </div>
~~~~~

~~~~~act
patch_file
frontend/src/components/OverviewDashboard.tsx
~~~~~
~~~~~typescript.old
      {/* 每日 Token 消耗趋势时序图 */}
      {metrics.daily_trends && metrics.daily_trends.length > 0 && (
        <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
                <LineChart size={15} className="text-indigo-400" />
                <span>每日 Token 能耗趋势 (按时间序列)</span>
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                展示【{activeRangeLabel}】周期内的总 Token 与思考链能耗
              </p>
            </div>
            <span className="text-xs font-mono text-zinc-400 bg-zinc-800/60 px-2 py-1 rounded">
              {metrics.daily_trends.length} 活跃天
            </span>
          </div>
          <TokenTrendChart data={metrics.daily_trends} />
        </section>
      )}
~~~~~
~~~~~typescript.new
      {/* 每日时序趋势综合图 */}
      {metrics.daily_trends && metrics.daily_trends.length > 0 && (
        <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
                <LineChart size={15} className="text-indigo-400" />
                <span>
                  {trendMode === 'tokens' && '每日上下文 Token 规模趋势 (按时间序列)'}
                  {trendMode === 'chunks' && '每日 Chunk 交互推进量趋势 (按时间序列)'}
                  {trendMode === 'sessions' && '每日会话场次活跃度趋势 (按时间序列)'}
                </span>
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                {trendMode === 'tokens' && `展示【${activeRangeLabel}】周期内的上下文 Token 规模与思考链沉淀`}
                {trendMode === 'chunks' && `展示【${activeRangeLabel}】周期内与模型往返交互的数据块推进总量`}
                {trendMode === 'sessions' && `展示【${activeRangeLabel}】周期内每日活跃的独立对话场次`}
              </p>
            </div>

            <div className="flex items-center gap-3">
              {/* 趋势图维度切换胶囊 */}
              <div className="flex items-center gap-1 p-0.5 bg-zinc-950 border border-zinc-800 rounded-md">
                <button
                  type="button"
                  onClick={() => setTrendMode('tokens')}
                  className={`text-[11px] px-2.5 py-1 rounded font-medium transition cursor-pointer ${
                    trendMode === 'tokens'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                  }`}
                  title="展示每日总 Token 与思考链上下文规模"
                >
                  上下文 Token
                </button>
                <button
                  type="button"
                  onClick={() => setTrendMode('chunks')}
                  className={`text-[11px] px-2.5 py-1 rounded font-medium transition cursor-pointer ${
                    trendMode === 'chunks'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                  }`}
                  title="展示每日与模型交互推进的数据块总量"
                >
                  Chunk 推进数
                </button>
                <button
                  type="button"
                  onClick={() => setTrendMode('sessions')}
                  className={`text-[11px] px-2.5 py-1 rounded font-medium transition cursor-pointer ${
                    trendMode === 'sessions'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                  }`}
                  title="展示每日发生交互的独立会话场次"
                >
                  交互场次
                </button>
              </div>

              <span className="text-xs font-mono text-zinc-400 bg-zinc-800/60 px-2 py-1 rounded shrink-0">
                {metrics.daily_trends.length} 活跃天
              </span>
            </div>
          </div>
          <TokenTrendChart data={metrics.daily_trends} mode={trendMode} />
        </section>
      )}
~~~~~

### 下一步建议
1. **构建与样式验证**：在终端运行 `npm run check` 检查 TypeScript 类型与 Biome 语法规范。
2. **算力口径演进**：后续可在会话模型与后端计算中引入真实推理 API 累积消耗（Cumulative Usage）模型，与目前的上下文净规模（Footprint）形成双轨对照。
