好的，我将为你制定并执行一套完整的重构计划，以统一图表系统架构并全面规范化 UI 图标与视觉语言。

## [WIP] refactor(ui): 抽象图表基础主题与容器并全面统一矢量图标系统

### 用户需求
解决前端工程中图表生命周期与暗色主题重复硬编码、以及 UI 表现层混用 Emoji / Unicode 符号与闲置 `lucide-preact` 依赖的问题，建立统一的图表基底与一致性矢量图标规范。

### 评论
这是一项显著提升前端代码质量与视觉工业质感（Workstation-grade UX）的重构。提取通用的 `BaseChart` 与 `chartTheme` 可以收敛 150+ 行冗余的 Canvas 样板代码，并保证暗色 Tooltip、网格与调色板规范统一；将零散的系统 Emoji 清退为统一尺寸的 `lucide-preact` 矢量图标，能够消除不同平台渲染差异，让暗色审计工作台更具专业感。

### 目标
1. **统一图表基底**：创建 `frontend/src/components/charts/base/chartTheme.ts`（统一注册 Chart.js 核心组件、收口暗色调色板与 Tooltip/Scale 默认配置）和 `BaseChart.tsx`（封装 Canvas 挂载、配置响应式更新与销毁清理）。
2. **轻量化业务图表**：重构 `DurationTiersChart.tsx`、`ModelDistributionChart.tsx` 与 `TokenTrendChart.tsx`，移除重复的 ref 与生命周期样板，转为基于 `BaseChart` 的声明式配置。
3. **全面接入矢量图标系统**：在 `app.tsx`、`OverviewDashboard.tsx`、`SessionDetailPanel.tsx`、`SessionsRoute.tsx` 和 `NotFoundRoute.tsx` 中全面引入 `lucide-preact`，替换所有业务中的 Emoji、折叠字符与操作标记。

### 基本原理
- **分层与关注点分离**：通过 `chartTheme.ts` 集中注册并暴露暗色 design tokens，业务图表只需关注数据结构映射（Domain Data to Series）；`BaseChart` 专门处理 DOM Canvas 与底层命令式 API 的桥接。
- **视觉一致性原则**：使用统一规范的矢量线框图标（统一 `size={12|14|16}` 与 Tailwind 文本色），使按钮、折叠箭头、标签徽章与空状态视觉规范完全对齐。

### 标签
#intent/refine #flow/ready #priority/high #concept/ui #scope/ux #scope/dx #ai/instruct #task/domain/ui #task/object/chart-and-icon-system #task/action/refactor #task/state/begin #task/status/active

---

### Script

#### Acts 1: 创建图表暗色设计规范与通用容器

新建 `chartTheme.ts` 统一注册 ChartJS 并收口主题配置；新建 `BaseChart.tsx` 处理 Canvas 实例生命周期。

~~~~~act
write_file
frontend/src/components/charts/base/chartTheme.ts
~~~~~
~~~~~typescript
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  DoughnutController,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip,
  type TooltipOptions,
} from 'chart.js';

// 统一注册 Chart.js 所需的所有核心组件与控制器
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  BarElement,
  BarController,
  ArcElement,
  DoughnutController,
  Title,
  Tooltip,
  Legend,
  Filler,
);

/**
 * 工作台统一暗色调色板 (Design Tokens)
 */
export const CHART_PALETTE = {
  indigo: '#818cf8', // 主强调色 (indigo-400)
  indigoBg: 'rgba(129, 140, 248, 0.12)',
  emerald: '#34d399', // 思考/健康色 (emerald-400)
  emeraldBg: 'rgba(52, 211, 153, 0.08)',
  sky: '#38bdf8', // 快速梯队 (sky-400)
  amber: '#fbbf24', // 攻坚/警告 (amber-400)
  red: '#f87171', // 极长线 (red-400)
  border: '#27272a', // zinc-800
  grid: 'rgba(63, 63, 70, 0.25)', // zinc-700/25
  textMuted: '#71717a', // zinc-500
  textSecondary: '#a1a1aa', // zinc-400
  textBright: '#f4f4f5', // zinc-100
  tooltipBg: '#18181b', // zinc-900
};

/**
 * 统一定义暗色 Tooltip 视觉参数
 */
export const defaultDarkTooltipOptions: Partial<TooltipOptions> = {
  backgroundColor: CHART_PALETTE.tooltipBg,
  titleColor: CHART_PALETTE.textBright,
  bodyColor: '#e4e4e7',
  borderColor: CHART_PALETTE.border,
  borderWidth: 1,
  padding: 10,
  cornerRadius: 6,
};

/**
 * 统一定义笛卡尔坐标轴暗色网格与字体
 */
export const defaultDarkScales = {
  x: {
    grid: { color: CHART_PALETTE.grid },
    ticks: {
      color: CHART_PALETTE.textMuted,
      font: { size: 10 },
    },
  },
  y: {
    grid: { color: CHART_PALETTE.grid },
    ticks: {
      color: CHART_PALETTE.textMuted,
      font: { size: 10 },
    },
  },
};
~~~~~

~~~~~act
write_file
frontend/src/components/charts/base/BaseChart.tsx
~~~~~
~~~~~typescript
import { Chart as ChartJS, type ChartConfiguration } from 'chart.js';
import { useEffect, useRef } from 'preact/hooks';

interface BaseChartProps {
  config: ChartConfiguration;
  className?: string;
  heightClass?: string;
}

export function BaseChart({ config, className = '', heightClass = 'h-64' }: BaseChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<ChartJS | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    chartRef.current = new ChartJS(canvasRef.current, config);

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [config]);

  return (
    <div className={`relative w-full ${heightClass} ${className}`}>
      <canvas ref={canvasRef} />
    </div>
  );
}
~~~~~

#### Acts 2: 重构三个业务图表为声明式组件

使用 `BaseChart` 与 `chartTheme` 改造 `DurationTiersChart`、`ModelDistributionChart` 与 `TokenTrendChart`。

~~~~~act
write_file
frontend/src/components/charts/DurationTiersChart.tsx
~~~~~
~~~~~typescript
import type { ChartConfiguration } from 'chart.js';
import { useMemo } from 'preact/hooks';
import { BaseChart } from './base/BaseChart';
import { CHART_PALETTE, defaultDarkTooltipOptions } from './base/chartTheme';

interface Props {
  tiers: {
    flash: [number, string];
    focus: [number, string];
    deep: [number, string];
    epic: [number, string];
  };
}

export function DurationTiersChart({ tiers }: Props) {
  const chartConfig = useMemo<ChartConfiguration<'doughnut'>>(() => {
    const labels = ['即时快问 (<10m)', '聚焦推进 (10~60m)', '深度攻坚 (1~6h)', '跨日长线 (>6h)'];
    const dataValues = [tiers.flash[0], tiers.focus[0], tiers.deep[0], tiers.epic[0]];

    return {
      type: 'doughnut',
      data: {
        labels,
        datasets: [
          {
            data: dataValues,
            backgroundColor: [
              CHART_PALETTE.sky,
              CHART_PALETTE.indigo,
              CHART_PALETTE.amber,
              CHART_PALETTE.red,
            ],
            borderColor: '#18181b',
            borderWidth: 2,
            hoverOffset: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: CHART_PALETTE.textSecondary,
              font: { size: 10.5 },
              boxWidth: 10,
              padding: 12,
              usePointStyle: true,
            },
          },
          tooltip: {
            ...defaultDarkTooltipOptions,
            callbacks: {
              label(context) {
                const total = dataValues.reduce((a, b) => a + b, 0);
                const val = Number(context.raw) || 0;
                const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0';
                return ` ${context.label}: ${val} 场 (${pct}%)`;
              },
            },
          },
        },
      },
    };
  }, [tiers]);

  return <BaseChart config={chartConfig} heightClass="h-64" />;
}
~~~~~

~~~~~act
write_file
frontend/src/components/charts/ModelDistributionChart.tsx
~~~~~
~~~~~typescript
import type { ChartConfiguration } from 'chart.js';
import { useMemo } from 'preact/hooks';
import { BaseChart } from './base/BaseChart';
import { CHART_PALETTE, defaultDarkScales, defaultDarkTooltipOptions } from './base/chartTheme';

interface Props {
  distribution: Record<string, number>;
}

export function ModelDistributionChart({ distribution }: Props) {
  const chartConfig = useMemo<ChartConfiguration<'bar'>>(() => {
    const entries = Object.entries(distribution).sort((a, b) => b[1] - a[1]);
    const labels = entries.map(([m]) => m.replace('models/', ''));
    const dataValues = entries.map(([, count]) => count);

    return {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: '会话场数',
            data: dataValues,
            backgroundColor: 'rgba(99, 102, 241, 0.7)',
            hoverBackgroundColor: CHART_PALETTE.indigo,
            borderRadius: 4,
            borderSkipped: false,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...defaultDarkTooltipOptions,
            callbacks: {
              label(context) {
                return ` 会话数: ${context.raw} 场`;
              },
            },
          },
        },
        scales: {
          x: {
            ...defaultDarkScales.x,
            ticks: {
              ...defaultDarkScales.x.ticks,
              precision: 0,
            },
          },
          y: {
            grid: { display: false },
            ticks: {
              color: '#d4d4d8',
              font: { size: 11 },
            },
          },
        },
      },
    };
  }, [distribution]);

  return <BaseChart config={chartConfig} heightClass="h-64" />;
}
~~~~~

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

interface Props {
  data: DailyTrendItem[];
}

export function TokenTrendChart({ data }: Props) {
  const chartConfig = useMemo<ChartConfiguration<'line'>>(() => {
    const labels = data.map((d) => d.date);
    const totalTokens = data.map((d) => d.total_tokens);
    const thoughtTokens = data.map((d) => d.thought_tokens);

    return {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '总 Token 消耗',
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
            label: '思考链 (Thinking) 消耗',
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
        interaction: {
          mode: 'index',
          intersect: false,
        },
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
  }, [data]);

  return <BaseChart config={chartConfig} heightClass="h-72" />;
}
~~~~~

#### Acts 3: 全面规范化 UI 表现层图标 (Lucide 图标系统)

在 `app.tsx`, `OverviewDashboard.tsx`, `SessionDetailPanel.tsx`, `SessionsRoute.tsx`, `NotFoundRoute.tsx` 中替换所有原生 Emoji 与 Unicode 占位符。

~~~~~act
write_file
frontend/src/app.tsx
~~~~~
~~~~~typescript
import {
  Brain,
  Download,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
} from 'lucide-preact';
import { LocationProvider, Route, Router, useLocation } from 'preact-iso';
import { useEffect } from 'preact/hooks';
import { NotFoundRoute } from './routes/NotFoundRoute';
import { OverviewRoute } from './routes/OverviewRoute';
import { SessionsRoute } from './routes/SessionsRoute';
import {
  TIME_RANGE_OPTIONS,
  type TimeRange,
  fetchMetrics,
  setTimeRange,
  timeRangeSignal,
} from './state/metrics';
import { fetchSessions, sidebarCollapsedSignal, toggleSidebar } from './state/session';
import {
  setupSyncEventListener,
  syncInProgressSignal,
  syncProgressTextSignal,
  triggerSync,
} from './state/sync';

function loadAllData(range: TimeRange = timeRangeSignal.value) {
  return Promise.all([fetchMetrics(range), fetchSessions(range)]);
}

function handleTimeRangeChange(newRange: TimeRange) {
  setTimeRange(newRange);
  loadAllData(newRange);
}

function HeaderBar() {
  const { path, route } = useLocation();
  const currentRange = timeRangeSignal.value;
  const isSidebarCollapsed = sidebarCollapsedSignal.value;
  const isSessionsView = path.startsWith('/sessions');

  return (
    <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur px-6 py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-4 sticky top-0 z-20">
      <div className="flex items-center gap-3">
        {isSessionsView && (
          <button
            type="button"
            onClick={toggleSidebar}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded transition text-xs flex items-center gap-1"
            title={isSidebarCollapsed ? '展开会话历史侧边栏' : '收起会话历史侧边栏'}
          >
            {isSidebarCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
            <span className="text-[11px]">{isSidebarCollapsed ? '展开' : '收起'}</span>
          </button>
        )}
        <button
          type="button"
          className="p-1.5 rounded-lg bg-indigo-950/60 border border-indigo-800/40 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-900/40 transition cursor-pointer flex items-center justify-center"
          onClick={() => route('/')}
          title="回到全景大盘"
        >
          <Brain size={18} />
        </button>
        <div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-base font-bold tracking-tight text-white cursor-pointer hover:text-indigo-400 transition bg-transparent border-none p-0 text-left"
              onClick={() => route('/')}
            >
              AI Studio Analyzer
            </button>
            <span className="text-[10px] font-mono uppercase bg-indigo-950/80 text-indigo-400 border border-indigo-800/60 px-1.5 py-0.2 rounded">
              v0.2 Workstation
            </span>
          </div>
        </div>

        {/* 页面主视图切换 Tab */}
        <nav className="flex items-center gap-1 ml-4 bg-zinc-900 border border-zinc-800 p-0.5 rounded-lg text-xs">
          <button
            type="button"
            onClick={() => route('/')}
            className={`px-3 py-1 rounded-md font-medium transition flex items-center gap-1.5 ${
              path === '/'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
          >
            <LayoutDashboard size={13} />
            <span>全景大盘</span>
          </button>
          <button
            type="button"
            onClick={() => route('/sessions')}
            className={`px-3 py-1 rounded-md font-medium transition flex items-center gap-1.5 ${
              isSessionsView
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
          >
            <MessagesSquare size={13} />
            <span>会话工作台</span>
          </button>
        </nav>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {/* 全局时间范围胶囊 */}
        <div className="inline-flex items-center rounded-lg bg-zinc-900 border border-zinc-800 p-0.5 shadow-inner">
          {TIME_RANGE_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => handleTimeRangeChange(key)}
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${
                currentRange === key
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="h-4 w-px bg-zinc-800 hidden sm:block" />

        {/* 快捷导出与增量同步操作组 */}
        <div className="flex items-center gap-2 flex-wrap">
          <a
            href={`/api/export/csv?range=${currentRange}`}
            download
            className="px-2.5 py-1 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded transition flex items-center gap-1"
            title="导出概览 CSV"
          >
            <FileSpreadsheet size={13} />
            <span>CSV</span>
          </a>
          <a
            href={`/api/export/jsonl?range=${currentRange}`}
            download
            className="px-2.5 py-1 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded transition flex items-center gap-1"
            title="导出提问聚类 JSONL"
          >
            <FileText size={13} />
            <span>JSONL</span>
          </a>
          <button
            type="button"
            onClick={() => triggerSync(50)}
            disabled={syncInProgressSignal.value}
            className="px-3 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded transition shadow-sm flex items-center gap-1.5"
          >
            <RefreshCw
              size={13}
              className={syncInProgressSignal.value ? 'animate-spin' : ''}
            />
            <span>
              {syncInProgressSignal.value
                ? syncProgressTextSignal.value
                  ? `同步中 ${syncProgressTextSignal.value}`
                  : '同步中...'
                : '增量同步 (50)'}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}

export function App() {
  useEffect(() => {
    loadAllData();
    const cleanupSync = setupSyncEventListener(() => {
      loadAllData();
    });
    return cleanupSync;
  }, []);

  return (
    <LocationProvider>
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans">
        <HeaderBar />
        <Router>
          <Route path="/" component={OverviewRoute} />
          <Route path="/sessions" component={SessionsRoute} />
          <Route path="/sessions/:id" component={SessionsRoute} />
          <Route default component={NotFoundRoute} />
        </Router>
      </div>
    </LocationProvider>
  );
}
~~~~~

~~~~~act
write_file
frontend/src/components/OverviewDashboard.tsx
~~~~~
~~~~~typescript
import { Bot, Clock, LineChart, Sparkles } from 'lucide-preact';
import type { MetricsSummary } from '../types/metrics';
import { DurationTiersChart } from './charts/DurationTiersChart';
import { ModelDistributionChart } from './charts/ModelDistributionChart';
import { TokenTrendChart } from './charts/TokenTrendChart';

interface Props {
  metrics: MetricsSummary;
  activeRangeLabel: string;
}

export function OverviewDashboard({ metrics, activeRangeLabel }: Props) {
  return (
    <div className="space-y-6">
      {/* 四大关键能耗卡片 */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-4">
          <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
            <span>交互总场次</span>
            <span className="text-[10px] text-zinc-500 font-mono">[{activeRangeLabel}]</span>
          </div>
          <div className="mt-1.5 text-2xl font-bold text-white tracking-tight">
            {metrics.total_sessions} <span className="text-xs font-normal text-zinc-500">场</span>
          </div>
          <div className="mt-1 text-[11px] text-zinc-500 truncate">
            输入: {(metrics.total_user_chars || 0).toLocaleString()} 字符
          </div>
        </div>

        <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-4">
          <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
            <span>时长中位数 (P50)</span>
            <span className="text-[10px] text-zinc-500 font-mono">[{activeRangeLabel}]</span>
          </div>
          <div className="mt-1.5 text-2xl font-bold text-indigo-400 tracking-tight">
            {metrics.dur_stats?.median ?? 0}{' '}
            <span className="text-xs font-normal text-zinc-500">min</span>
          </div>
          <div className="mt-1 text-[11px] text-zinc-500 truncate">
            多轮 P50: {metrics.multi_dur_stats?.median ?? 0}m | Max: {metrics.dur_stats?.max ?? 0}m
          </div>
        </div>

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

        <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-4">
          <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
            <span>思维摩擦力</span>
            <span className="text-[10px] text-zinc-500 font-mono">[{activeRangeLabel}]</span>
          </div>
          <div className="mt-1.5 text-2xl font-bold text-amber-400 tracking-tight">
            {metrics.friction_stats?.branch_ratio ?? '0%'}
          </div>
          <div className="mt-1 text-[11px] text-zinc-500 truncate">
            {metrics.friction_stats?.branch_sessions ?? 0} 场分叉 (
            {metrics.friction_stats?.total_retries ?? 0} 次重试)
          </div>
        </div>
      </section>

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

      {/* 时长梯队与模型偏好双图并排 */}
      {metrics.total_sessions > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {metrics.duration_tiers && (
            <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-zinc-200 mb-1 flex items-center gap-1.5">
                <Clock size={15} className="text-sky-400" />
                <span>心智时长梯队切片</span>
              </h2>
              <p className="text-xs text-zinc-500 mb-3">
                单次任务从首轮交互到最后收尾的时间窗口跨度
              </p>
              <DurationTiersChart tiers={metrics.duration_tiers} />
            </section>
          )}

          {metrics.model_distribution && Object.keys(metrics.model_distribution).length > 0 && (
            <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-zinc-200 mb-1 flex items-center gap-1.5">
                <Bot size={15} className="text-indigo-400" />
                <span>模型偏好分布</span>
              </h2>
              <p className="text-xs text-zinc-500 mb-3">各 Gemini 模型在所选周期内的调用场次</p>
              <ModelDistributionChart distribution={metrics.model_distribution} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
~~~~~

~~~~~act
write_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~typescript
import {
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileCode,
  FileText,
  MessagesSquare,
  Paperclip,
  User,
  X,
} from 'lucide-preact';
import { marked } from 'marked';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ConversationTurnItem, SessionDetail, SessionItem } from '../types/metrics';

marked.setOptions({
  breaks: true,
  gfm: true,
});

interface Props {
  session: SessionItem;
  onClose: () => void;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('复制失败:', err);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`px-2 py-1 text-[11px] rounded transition flex items-center gap-1 border ${
        copied
          ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
          : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 border-zinc-700/60'
      }`}
      title="复制本轮纯文本内容"
    >
      {copied ? (
        <>
          <Check size={12} className="text-emerald-400" />
          <span>已复制</span>
        </>
      ) : (
        <>
          <Copy size={12} />
          <span>复制</span>
        </>
      )}
    </button>
  );
}

function DownloadButton({ text, filename }: { text: string; filename: string }) {
  const handleDownload = () => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      className="px-2 py-1 text-[11px] rounded transition flex items-center gap-1 border bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 border-zinc-700/60 cursor-pointer"
      title="下载文件附件"
    >
      <Download size={12} />
      <span>下载</span>
    </button>
  );
}

function TurnMessage({ turn, index }: { turn: ConversationTurnItem; index: number }) {
  const [isThinkingOpen, setIsThinkingOpen] = useState(false);
  const [isAttachmentOpen, setIsAttachmentOpen] = useState(false);

  // 提取可能的 Drive 文件 ID (支持格式: "ID: xxx" 或 "[挂载云盘大文档 ID: xxx]")
  const driveDocId = useMemo(() => {
    if (turn.payload_type !== 'driveDocument') return null;
    const match = turn.text.match(/ID:\s*([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }, [turn.payload_type, turn.text]);

  const htmlContent = useMemo(() => {
    try {
      return marked.parse(turn.text || '');
    } catch {
      return turn.text;
    }
  }, [turn.text]);

  const isUser = turn.role === 'user';
  const isThought = turn.is_thought;

  if (isThought) {
    return (
      <div className="rounded-lg border border-emerald-900/30 bg-emerald-950/15 overflow-hidden">
        <div className="px-3.5 py-2 flex items-center justify-between bg-emerald-950/30 border-b border-emerald-900/20 text-xs text-emerald-400 font-mono">
          <button
            type="button"
            className="flex items-center gap-2 cursor-pointer select-none hover:text-emerald-300 transition bg-transparent border-none p-0 text-emerald-400 font-mono"
            onClick={() => setIsThinkingOpen(!isThinkingOpen)}
          >
            {isThinkingOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <span className="font-semibold flex items-center gap-1">
              <Brain size={13} />
              <span>思考链 (Thinking Process)</span>
            </span>
            <span className="text-[10px] text-emerald-500/80">
              {turn.token_count > 0 ? `${turn.token_count.toLocaleString()} tokens` : ''}
            </span>
          </button>
          <CopyButton text={turn.text} />
        </div>
        {isThinkingOpen ? (
          <div className="p-4 text-xs text-emerald-300/90 font-mono whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto bg-black/20">
            {turn.text}
          </div>
        ) : (
          <button
            type="button"
            className="w-full text-left px-4 py-2 text-xs text-emerald-400/60 font-mono truncate cursor-pointer hover:bg-emerald-900/10 bg-transparent border-none"
            onClick={() => setIsThinkingOpen(true)}
          >
            {turn.text.slice(0, 140)}...
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border transition shadow-sm ${
        isUser
          ? 'bg-zinc-900/90 border-indigo-900/40 pl-1 border-l-4 border-l-indigo-500'
          : 'bg-zinc-900/50 border-zinc-800'
      }`}
    >
      {/* 消息 Chunk 头部元数据栏 */}
      <div className="px-4 py-2.5 flex items-center justify-between border-b border-zinc-800/60 text-xs">
        <div className="flex items-center gap-2">
          <span
            className={`font-semibold uppercase text-[11px] px-2 py-0.5 rounded font-mono flex items-center gap-1 ${
              isUser
                ? 'bg-indigo-950 text-indigo-300 border border-indigo-800/60'
                : 'bg-zinc-800 text-zinc-300 border border-zinc-700/60'
            }`}
          >
            {isUser ? <User size={11} /> : <Bot size={11} />}
            <span>{isUser ? 'User' : 'Model'}</span>
          </span>
          <span className="text-zinc-500 text-[11px] font-mono">#{index + 1}</span>
          {turn.token_count > 0 && (
            <span className="text-[11px] text-zinc-500 font-mono">
              {turn.token_count.toLocaleString()} tokens
            </span>
          )}
          {turn.is_edited && (
            <span className="text-[10px] text-amber-400 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/40">
              已编辑重试
            </span>
          )}
        </div>

        <CopyButton text={turn.text} />
      </div>

      {/* 消息正文：云盘大文档专属卡片 或 内联附件卡片 或 Markdown 正文呈现 */}
      <div className="p-4 sm:p-5">
        {turn.payload_type === 'driveDocument' ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-indigo-950/30 border border-indigo-800/40 rounded-lg">
            <div className="flex items-center gap-2.5 min-w-0">
              <FileText size={20} className="text-indigo-400 shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-indigo-300">挂载云盘大文档</div>
                <div className="text-[11px] text-zinc-400 font-mono truncate">
                  ID: <span className="text-zinc-200 select-all">{driveDocId || turn.text}</span>
                </div>
              </div>
            </div>

            {driveDocId && (
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={`https://drive.google.com/file/d/${driveDocId}/view`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1 text-[11px] font-medium bg-indigo-600/80 hover:bg-indigo-600 text-white rounded transition flex items-center gap-1"
                >
                  <ExternalLink size={12} />
                  <span>在云盘查看</span>
                </a>
              </div>
            )}
          </div>
        ) : turn.payload_type === 'inlineFile' ? (
          <div className="rounded-lg border border-cyan-900/40 bg-cyan-950/20 overflow-hidden">
            <div className="px-3.5 py-2.5 flex items-center justify-between bg-cyan-950/40 border-b border-cyan-900/30 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <Paperclip size={14} className="text-cyan-400 shrink-0" />
                <div className="min-w-0">
                  <span className="font-semibold text-cyan-300 truncate">
                    {turn.extra_metadata?.display_name || '内联上下文文件 (inlineFile)'}
                  </span>
                  <span className="ml-2 font-mono text-[11px] text-cyan-400/80">
                    {turn.extra_metadata?.mime_type || 'text/plain'}
                    {turn.extra_metadata?.byte_size !== undefined &&
                      ` · ${(turn.extra_metadata.byte_size / 1024).toFixed(1)} KB`}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsAttachmentOpen(!isAttachmentOpen)}
                  className="px-2 py-1 text-[11px] font-mono rounded bg-cyan-900/40 hover:bg-cyan-900/60 text-cyan-200 border border-cyan-800/50 transition cursor-pointer flex items-center gap-1"
                >
                  {isAttachmentOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  <span>{isAttachmentOpen ? '收起内容' : '展开预览'}</span>
                </button>
                <CopyButton text={turn.text} />
                <DownloadButton
                  text={turn.text}
                  filename={turn.extra_metadata?.display_name || `attachment_${index + 1}.txt`}
                />
              </div>
            </div>
            {isAttachmentOpen ? (
              <div className="p-4 text-xs font-mono whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto bg-black/40 text-cyan-100/90 select-text border-t border-cyan-900/20">
                {turn.text}
              </div>
            ) : (
              <button
                type="button"
                className="w-full text-left px-4 py-2 text-xs text-cyan-300/60 font-mono truncate cursor-pointer hover:bg-cyan-950/30 bg-transparent border-none"
                onClick={() => setIsAttachmentOpen(true)}
              >
                {turn.text.slice(0, 160)}...
              </button>
            )}
          </div>
        ) : (
          <div
            className="prose-chat max-w-none"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: 用于渲染本地 SQLite 缓存中对话记录的 Markdown 解析输出
            dangerouslySetInnerHTML={{ __html: htmlContent as string }}
          />
        )}
      </div>
    </div>
  );
}

export function SessionDetailPanel({ session, onClose }: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [showMetadata, setShowMetadata] = useState<boolean>(true);

  const aiStudioUrl = `https://aistudio.google.com/prompts/${session.file_id}`;

  useEffect(() => {
    setLoading(true);
    fetch(`/api/sessions/${session.file_id}`)
      .then((res) => res.json())
      .then((data) => {
        setDetail(data);
      })
      .catch((err) => {
        console.error('获取会话详情失败:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [session.file_id]);

  return (
    <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg flex flex-col h-full min-h-[calc(100vh-140px)]">
      {/* 头部导航与操作条 */}
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-3.5 bg-zinc-900/90 backdrop-blur sticky top-0 z-10 rounded-t-lg">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-white tracking-tight truncate max-w-md">
              {session.name}
            </h2>
            {session.has_branching && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-400 border border-amber-800/60 font-mono shrink-0">
                分叉 {session.branch_count} 次
              </span>
            )}
          </div>
          <p className="text-[11px] text-zinc-400 font-mono truncate">
            ID: {session.file_id} · 模型: {session.model.replace('models/', '')}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowMetadata(!showMetadata)}
            className="px-2.5 py-1 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded border border-zinc-700/80 transition"
            title="切换元数据卡片可见性"
          >
            {showMetadata ? '隐藏统计' : '显示统计'}
          </button>
          <a
            href={aiStudioUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded transition shadow-sm flex items-center gap-1.5"
            title="在 Google AI Studio 原生工作台打开"
          >
            <ExternalLink size={13} />
            <span className="hidden sm:inline">在 AI Studio 打开</span>
          </a>
          <a
            href={`/api/sessions/${session.file_id}/raw`}
            download={`session_${session.file_id}.json`}
            className="px-2.5 py-1 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded border border-zinc-700/80 transition flex items-center gap-1.5"
            title="下载原始会话 JSON"
          >
            <FileCode size={13} />
            <span className="hidden sm:inline">下载原始 JSON</span>
          </a>
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded transition border border-zinc-700/80 flex items-center gap-1"
            title="关闭详情"
          >
            <X size={13} />
            <span className="hidden sm:inline">关闭</span>
          </button>
        </div>
      </div>

      {/* 可选紧凑指标卡片（支持折叠） */}
      {showMetadata && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 border-b border-zinc-800/80 bg-zinc-950/40">
          <div className="bg-zinc-900/80 border border-zinc-800/60 rounded p-2.5">
            <div className="text-[10px] text-zinc-400">生命周期时长</div>
            <div className="text-base font-bold text-indigo-400 font-mono mt-0.5">
              {session.duration_human}
            </div>
            <div className="text-[10px] text-zinc-500">{session.duration_seconds} 秒</div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800/60 rounded p-2.5">
            <div className="text-[10px] text-zinc-400">总 Token 消耗</div>
            <div className="text-base font-bold text-emerald-400 font-mono mt-0.5">
              {session.total_tokens.toLocaleString()}
            </div>
            <div className="text-[10px] text-zinc-500">
              思考链: {session.thought_tokens.toLocaleString()}
            </div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800/60 rounded p-2.5">
            <div className="text-[10px] text-zinc-400">有效交互轮次</div>
            <div className="text-base font-bold text-white font-mono mt-0.5">
              {session.turn_count} 轮
            </div>
            <div className="text-[10px] text-zinc-500">
              {session.turn_count >= 5 ? '深度多轮' : '轻量快问'}
            </div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800/60 rounded p-2.5">
            <div className="text-[10px] text-zinc-400">最后修改时间</div>
            <div className="text-xs font-medium text-zinc-300 font-mono mt-1 truncate">
              {session.modified_time
                ? session.modified_time.replace('T', ' ').slice(0, 16)
                : '未知'}
            </div>
            <div className="text-[10px] text-zinc-500 truncate">
              创建: {session.created_time ? session.created_time.slice(0, 10) : '未知'}
            </div>
          </div>
        </div>
      )}

      {/* 全屏只读交互轮次流 */}
      <div className="flex-1 flex flex-col p-4 sm:p-6 overflow-hidden">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
              <MessagesSquare size={15} className="text-indigo-400" />
              <span>交互轮次流</span>
            </h3>
            <span className="text-xs font-mono text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded">
              {detail?.turns?.length ?? session.turn_count} 个 Chunks
            </span>
          </div>
        </div>

        {loading ? (
          <div className="py-24 text-center text-xs text-zinc-500 animate-pulse">
            正在从本地 SQLite 加载完整对话轮次...
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {detail?.turns && detail.turns.length > 0 ? (
              detail.turns.map((turn, idx) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 对话轮次流按时间严格保序，无需进行动态重排
                <TurnMessage key={`turn-${idx}`} turn={turn} index={idx} />
              ))
            ) : (
              <div className="py-16 text-center text-zinc-500 text-xs">
                暂无对话内容或数据未同步
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
~~~~~

~~~~~act
write_file
frontend/src/routes/NotFoundRoute.tsx
~~~~~
~~~~~typescript
import { Search } from 'lucide-preact';
import { useLocation } from 'preact-iso';

export function NotFoundRoute() {
  const { route } = useLocation();

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-16 text-center">
      <div className="p-4 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 mb-4">
        <Search size={32} />
      </div>
      <h2 className="text-lg font-bold text-zinc-200">页面不存在</h2>
      <p className="text-xs text-zinc-500 mt-1 mb-6">您访问的路由或会话路径未找到</p>
      <button
        type="button"
        onClick={() => route('/')}
        className="px-4 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded transition shadow-sm"
      >
        返回全景大盘
      </button>
    </div>
  );
}
~~~~~

~~~~~act
write_file
frontend/src/routes/SessionsRoute.tsx
~~~~~
~~~~~typescript
import { MessagesSquare } from 'lucide-preact';
import { useLocation, useRoute } from 'preact-iso';
import { useMemo } from 'preact/hooks';
import { SessionDetailPanel } from '../components/SessionDetailPanel';
import { VirtualSessionList } from '../components/VirtualSessionList';
import { sessionsLoadingSignal, sessionsSignal, sidebarCollapsedSignal } from '../state/session';
import type { SessionItem } from '../types/metrics';

export function SessionsRoute() {
  const { params } = useRoute();
  const { route } = useLocation();

  const sessions = sessionsSignal.value;
  const isLoading = sessionsLoadingSignal.value;
  const isSidebarCollapsed = sidebarCollapsedSignal.value;
  const selectedId = params.id || null;

  // 根据 URL 的 :id 参数匹配当前会话实体
  const currentSession = useMemo<SessionItem | null>(() => {
    if (!selectedId || sessions.length === 0) return null;
    return sessions.find((s) => s.file_id === selectedId) || null;
  }, [selectedId, sessions]);

  const handleSelectSession = (s: SessionItem) => {
    route(`/sessions/${s.file_id}`);
  };

  const handleCloseDetail = () => {
    route('/sessions');
  };

  return (
    <div
      className={`flex-1 flex flex-col lg:flex-row overflow-hidden p-4 md:p-6 gap-6 w-full mx-auto transition-all duration-300 ${
        isSidebarCollapsed ? 'max-w-full px-6' : 'max-w-7xl'
      }`}
    >
      {/* 左侧：5000+ 虚拟列表会话检索器 */}
      {!isSidebarCollapsed && (
        <aside className="w-full lg:w-[380px] h-[520px] lg:h-[calc(100vh-120px)] flex-shrink-0">
          <VirtualSessionList
            sessions={sessions}
            selectedId={selectedId}
            onSelect={handleSelectSession}
          />
        </aside>
      )}

      {/* 右侧：单会话详情 或 空状态引导 */}
      <main className="flex-1 overflow-y-auto lg:h-[calc(100vh-120px)] pr-1 w-full flex flex-col">
        {isLoading && sessions.length === 0 ? (
          <div className="py-24 text-center text-zinc-500 text-sm animate-pulse">
            正在载入会话工作台索引...
          </div>
        ) : currentSession ? (
          <SessionDetailPanel session={currentSession} onClose={handleCloseDetail} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center border border-zinc-800/80 bg-zinc-900/30 rounded-lg">
            <div className="p-3.5 rounded-full bg-zinc-900 border border-zinc-800 text-indigo-400 mb-3">
              <MessagesSquare size={28} />
            </div>
            <h3 className="text-base font-semibold text-zinc-300">会话工作台已就绪</h3>
            <p className="text-xs text-zinc-500 mt-1 max-w-sm leading-relaxed">
              请在左侧列表中选择任意会话，查看包含完整 Markdown
              呈现、内联附件、思考链与分支追踪的详细对话流。
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
~~~~~

### 下一步建议
1. **静态代码检查与编译测试**：在 `frontend` 目录下运行 `npm run check`（`biome check . && tsc --noEmit`），验证所有新增组件和类型引用的正确性与无损编译。
2. **预览交互体验**：启动前端 Vite 开发服务器（`npm run dev`），检查各图表在暗色背景下的自适应缩放（Resize）、Tooltip 数据格式化提示，以及顶栏和对话面板的 Lucide 图标表现。
3. **提交变更**：验证通过后，可生成独立的 `[COMMIT]` 计划将以上重构成果提交至 Git 仓库。
