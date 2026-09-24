现在我们为前端工程引入 **Chart.js**，并将指标数据转化为可视化图表。

在后端，我们让 `metrics.py` 同步输出每日 Token 与思考链的时间序列统计；在前端安装 `chart.js` 并封装暗色风格的图表组件（每日 Token 消耗趋势面积图、心智时长梯队环形图、模型偏好分布条形图），接入主看板。

## [WIP] feat: 引入 Chart.js 并构建 Token 趋势与心智时长可视化图表

### 用户需求
在前端项目中引入 Chart.js 库，利用图表直观展示认知与交互数据（包括每日 Token 与思考链消耗趋势、心智时长梯队占比、模型偏好分布）。

### 评论
纯表格和数字卡片难以呈现“我随着时间推移是如何使用 AI”的时序脉络。引入轻量且表现力强的 Chart.js，结合 Preact 的响应式生命周期，可以在不增加心智负担的前提下，清晰呈现每日 Token 消耗坡峰与深度任务的时间分布，直接回应了关于“统计每日/每月 Token 消耗量”的核心诉求。

### 目标
1. 扩展 `src/analyzer/metrics.py`，在会话指标计算中增加基于日期（`date`）的时间序列聚合（`daily_trends`）。
2. 在 `frontend/package.json` 中引入 `chart.js` 依赖，并更新前端类型声明 `types/metrics.ts`。
3. 创建三个暗色适配的 Chart.js 组件：
   - `TokenTrendChart.tsx`：每日总 Token 与思考链 (Thinking) Token 消耗趋势面积/折线图。
   - `DurationTiersChart.tsx`：即时快问 / 聚焦推进 / 深度攻坚 / 跨日长线心智时长环形占比图。
   - `ModelDistributionChart.tsx`：模型调用频次条形图。
4. 将图表组件集成进 `frontend/src/app.tsx` 主看板视图中。

### 基本原理
- **时序下发**：后端利用现有 `PromptSession` 的起始时间戳推导所属日期，并按 `date` 分组聚合 Token 能耗与会话数，使前端可直接用于时序绘制。
- **暗色自适应**：Chart.js 实例统一应用适配 `zinc-950` 背景的半透明网格线、字体颜色与 Tooltip 样式，并在 Preact 组件卸载时自动销毁图表实例避免内存泄漏。

### 标签
#intent/build #flow/ready #priority/high #comp/ui #concept/ui #scope/ux #ai/instruct #task/domain/ui #task/object/chart-visualization #task/action/implementation #task/state/continue

---

### Script

#### Acts 1: 后端指标引擎扩展每日时间序列聚合

修改 `src/analyzer/metrics.py`，记录每个 session 的时间戳，并聚合输出 `daily_trends` 时序列表。

~~~~~act
patch_file
src/analyzer/metrics.py
~~~~~
~~~~~python.old
    # 1. 构造结构化 DataFrame
    records = []
    for s in sessions:
        records.append({
            "file_id": s.file_id,
            "turn_count": s.turn_count,
            "duration_seconds": s.duration_seconds,
            "duration_minutes": round(s.duration_seconds / 60, 2),
            "total_tokens": s.total_tokens,
            "thought_tokens": s.thought_tokens,
            "user_chars": s.total_user_chars,
            "has_branching": s.has_branching,
            "branch_count": s.branch_count,
            "has_sys_instruction": bool(s.system_instruction),
            "model": s.model
        })
~~~~~
~~~~~python.new
    # 1. 构造结构化 DataFrame
    records = []
    for s in sessions:
        st = s.start_time or s.modified_time
        date_str = st.strftime("%Y-%m-%d") if st else None
        records.append({
            "file_id": s.file_id,
            "date": date_str,
            "turn_count": s.turn_count,
            "duration_seconds": s.duration_seconds,
            "duration_minutes": round(s.duration_seconds / 60, 2),
            "total_tokens": s.total_tokens,
            "thought_tokens": s.thought_tokens,
            "user_chars": s.total_user_chars,
            "has_branching": s.has_branching,
            "branch_count": s.branch_count,
            "has_sys_instruction": bool(s.system_instruction),
            "model": s.model
        })
~~~~~

~~~~~act
patch_file
src/analyzer/metrics.py
~~~~~
~~~~~python.old
    # 6. 模型偏好分布
    model_dist = df["model"].value_counts().to_dict()

    return {
        "total_sessions": total_sessions,
        "total_turns": int(turn_s.sum()),
        "total_user_chars": int(df["user_chars"].sum()),
        "turn_stats": turn_stats,
        "dur_stats": dur_stats,
        "multi_dur_stats": multi_dur_stats,
        "duration_tiers": duration_tiers,
        "tok_stats": tok_stats,
        "friction_stats": friction_stats,
        "sys_instruction_count": int(df["has_sys_instruction"].sum()),
        "model_distribution": model_dist,
    }
~~~~~
~~~~~python.new
    # 6. 模型偏好分布
    model_dist = df["model"].value_counts().to_dict()

    # 7. 每日 Token 消耗与活跃趋势聚合 (按日期升序)
    daily_trends = []
    valid_dates_df = df[df["date"].notna()]
    if not valid_dates_df.empty:
        grouped = valid_dates_df.groupby("date").agg(
            total_tokens=("total_tokens", "sum"),
            thought_tokens=("thought_tokens", "sum"),
            sessions=("file_id", "count"),
            turns=("turn_count", "sum")
        ).reset_index().sort_values("date")

        for _, row in grouped.iterrows():
            daily_trends.append({
                "date": str(row["date"]),
                "total_tokens": int(row["total_tokens"]),
                "thought_tokens": int(row["thought_tokens"]),
                "sessions": int(row["sessions"]),
                "turns": int(row["turns"])
            })

    return {
        "total_sessions": total_sessions,
        "total_turns": int(turn_s.sum()),
        "total_user_chars": int(df["user_chars"].sum()),
        "turn_stats": turn_stats,
        "dur_stats": dur_stats,
        "multi_dur_stats": multi_dur_stats,
        "duration_tiers": duration_tiers,
        "tok_stats": tok_stats,
        "friction_stats": friction_stats,
        "sys_instruction_count": int(df["has_sys_instruction"].sum()),
        "model_distribution": model_dist,
        "daily_trends": daily_trends,
    }
~~~~~

#### Acts 2: 前端引入 Chart.js 依赖与类型扩展

在 `frontend/package.json` 中增加 `chart.js`，并更新 `frontend/src/types/metrics.ts`。

~~~~~act
patch_file
frontend/package.json
~~~~~
~~~~~json.old
  "dependencies": {
    "@preact/signals": "^2.0.1",
    "clsx": "^2.1.1",
    "lucide-preact": "^0.460.0",
    "preact": "^10.25.4",
    "tailwind-merge": "^2.5.5"
  },
~~~~~
~~~~~json.new
  "dependencies": {
    "@preact/signals": "^2.0.1",
    "chart.js": "^4.4.7",
    "clsx": "^2.1.1",
    "lucide-preact": "^0.460.0",
    "preact": "^10.25.4",
    "tailwind-merge": "^2.5.5"
  },
~~~~~

~~~~~act
patch_file
frontend/src/types/metrics.ts
~~~~~
~~~~~typescript.old
export interface FrictionStats {
  branch_sessions: number;
  branch_ratio: string;
  total_retries: number;
}

export interface MetricsSummary {
~~~~~
~~~~~typescript.new
export interface FrictionStats {
  branch_sessions: number;
  branch_ratio: string;
  total_retries: number;
}

export interface DailyTrendItem {
  date: string;
  total_tokens: number;
  thought_tokens: number;
  sessions: number;
  turns: number;
}

export interface MetricsSummary {
~~~~~

~~~~~act
patch_file
frontend/src/types/metrics.ts
~~~~~
~~~~~typescript.old
  friction_stats: FrictionStats;
  sys_instruction_count: number;
  model_distribution: Record<string, number>;
  message?: string;
}
~~~~~
~~~~~typescript.new
  friction_stats: FrictionStats;
  sys_instruction_count: number;
  model_distribution: Record<string, number>;
  daily_trends?: DailyTrendItem[];
  message?: string;
}
~~~~~

#### Acts 3: 实现适配暗色主题的 Chart.js 组件

创建趋势折线图、梯队环形图和模型条形图。

~~~~~act
write_file
frontend/src/components/charts/TokenTrendChart.tsx
~~~~~
~~~~~tsx
import { useEffect, useRef } from 'preact/hooks';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import type { DailyTrendItem } from '../../types/metrics';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

interface Props {
  data: DailyTrendItem[];
}

export function TokenTrendChart({ data }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<ChartJS | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const labels = data.map((d) => d.date);
    const totalTokens = data.map((d) => d.total_tokens);
    const thoughtTokens = data.map((d) => d.thought_tokens);

    chartRef.current = new ChartJS(canvasRef.current, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '总 Token 消耗',
            data: totalTokens,
            borderColor: '#818cf8', // indigo-400
            backgroundColor: 'rgba(129, 140, 248, 0.12)',
            fill: true,
            tension: 0.3,
            borderWidth: 2,
            pointRadius: labels.length > 40 ? 0 : 2.5,
            pointHoverRadius: 5,
          },
          {
            label: '思考链 (Thinking) 消耗',
            data: thoughtTokens,
            borderColor: '#34d399', // emerald-400
            backgroundColor: 'rgba(52, 211, 153, 0.08)',
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
              color: '#a1a1aa',
              font: { size: 11 },
              boxWidth: 12,
              usePointStyle: true,
            },
          },
          tooltip: {
            backgroundColor: '#18181b',
            titleColor: '#f4f4f5',
            bodyColor: '#e4e4e7',
            borderColor: '#27272a',
            borderWidth: 1,
            padding: 10,
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
            grid: { color: 'rgba(63, 63, 70, 0.25)' },
            ticks: {
              color: '#71717a',
              font: { size: 10 },
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 12,
            },
          },
          y: {
            grid: { color: 'rgba(63, 63, 70, 0.25)' },
            ticks: {
              color: '#71717a',
              font: { size: 10 },
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
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [data]);

  return (
    <div className="w-full h-72">
      <canvas ref={canvasRef} />
    </div>
  );
}
~~~~~

~~~~~act
write_file
frontend/src/components/charts/DurationTiersChart.tsx
~~~~~
~~~~~tsx
import { useEffect, useRef } from 'preact/hooks';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend);

interface Props {
  tiers: {
    flash: [number, string];
    focus: [number, string];
    deep: [number, string];
    epic: [number, string];
  };
}

export function DurationTiersChart({ tiers }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<ChartJS | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const labels = ['即时快问 (<10m)', '聚焦推进 (10~60m)', '深度攻坚 (1~6h)', '跨日长线 (>6h)'];
    const dataValues = [
      tiers.flash[0],
      tiers.focus[0],
      tiers.deep[0],
      tiers.epic[0],
    ];

    chartRef.current = new ChartJS(canvasRef.current, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [
          {
            data: dataValues,
            backgroundColor: [
              '#38bdf8', // sky-400
              '#818cf8', // indigo-400
              '#fbbf24', // amber-400
              '#f87171', // red-400
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
              color: '#a1a1aa',
              font: { size: 10.5 },
              boxWidth: 10,
              padding: 12,
              usePointStyle: true,
            },
          },
          tooltip: {
            backgroundColor: '#18181b',
            titleColor: '#f4f4f5',
            bodyColor: '#e4e4e7',
            borderColor: '#27272a',
            borderWidth: 1,
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
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [tiers]);

  return (
    <div className="w-full h-64">
      <canvas ref={canvasRef} />
    </div>
  );
}
~~~~~

~~~~~act
write_file
frontend/src/components/charts/ModelDistributionChart.tsx
~~~~~
~~~~~tsx
import { useEffect, useRef } from 'preact/hooks';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

interface Props {
  distribution: Record<string, number>;
}

export function ModelDistributionChart({ distribution }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<ChartJS | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    // 按会话数从多到少排序，并格式化模型名
    const entries = Object.entries(distribution).sort((a, b) => b[1] - a[1]);
    const labels = entries.map(([m]) => m.replace('models/', ''));
    const dataValues = entries.map(([, count]) => count);

    chartRef.current = new ChartJS(canvasRef.current, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: '会话场数',
            data: dataValues,
            backgroundColor: 'rgba(99, 102, 241, 0.7)', // indigo-500
            hoverBackgroundColor: '#818cf8',
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
            backgroundColor: '#18181b',
            titleColor: '#f4f4f5',
            bodyColor: '#e4e4e7',
            borderColor: '#27272a',
            borderWidth: 1,
            callbacks: {
              label(context) {
                return ` 会话数: ${context.raw} 场`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(63, 63, 70, 0.25)' },
            ticks: {
              color: '#71717a',
              font: { size: 10 },
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
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [distribution]);

  return (
    <div className="w-full h-64">
      <canvas ref={canvasRef} />
    </div>
  );
}
~~~~~

#### Acts 4: 整合图表到主看板视图

更新 `frontend/src/app.tsx`，在关键指标卡片下方引入每日 Token 趋势折线图，并将时长梯队与模型偏好图表并排呈现。

~~~~~act
patch_file
frontend/src/app.tsx
~~~~~
~~~~~tsx.old
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { MetricsSummary, SessionItem } from './types/metrics';

const metricsSignal = signal<MetricsSummary | null>(null);
~~~~~
~~~~~tsx.new
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { MetricsSummary, SessionItem } from './types/metrics';
import { TokenTrendChart } from './components/charts/TokenTrendChart';
import { DurationTiersChart } from './components/charts/DurationTiersChart';
import { ModelDistributionChart } from './components/charts/ModelDistributionChart';

const metricsSignal = signal<MetricsSummary | null>(null);
~~~~~

~~~~~act
patch_file
frontend/src/app.tsx
~~~~~
~~~~~tsx.old
          {/* 四大关键能耗卡片 */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
~~~~~
~~~~~tsx.new
          {/* 四大关键能耗卡片 */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
~~~~~

~~~~~act
patch_file
frontend/src/app.tsx
~~~~~
~~~~~tsx.old
          {/* 心智时长梯队分布 */}
          {m.duration_tiers && (
            <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-zinc-200 mb-4">⏱️ 心智时长梯队切片</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-3 bg-zinc-900 border border-zinc-800/80 rounded">
                  <div className="text-xs text-zinc-400">⚡ 即时快问 (&lt;10m)</div>
                  <div className="text-lg font-bold text-zinc-100 mt-1">
                    {m.duration_tiers.flash[0]} 场{' '}
                    <span className="text-xs font-normal text-zinc-500">
                      ({m.duration_tiers.flash[1]})
                    </span>
                  </div>
                </div>
                <div className="p-3 bg-zinc-900 border border-zinc-800/80 rounded">
                  <div className="text-xs text-zinc-400">🎯 聚焦推进 (10~60m)</div>
                  <div className="text-lg font-bold text-zinc-100 mt-1">
                    {m.duration_tiers.focus[0]} 场{' '}
                    <span className="text-xs font-normal text-zinc-500">
                      ({m.duration_tiers.focus[1]})
                    </span>
                  </div>
                </div>
                <div className="p-3 bg-zinc-900 border border-zinc-800/80 rounded">
                  <div className="text-xs text-zinc-400">🔨 深度攻坚 (1~6h)</div>
                  <div className="text-lg font-bold text-zinc-100 mt-1">
                    {m.duration_tiers.deep[0]} 场{' '}
                    <span className="text-xs font-normal text-zinc-500">
                      ({m.duration_tiers.deep[1]})
                    </span>
                  </div>
                </div>
                <div className="p-3 bg-zinc-900 border border-zinc-800/80 rounded">
                  <div className="text-xs text-zinc-400">🏔️ 跨日长线 (&gt;6h)</div>
                  <div className="text-lg font-bold text-zinc-100 mt-1">
                    {m.duration_tiers.epic[0]} 场{' '}
                    <span className="text-xs font-normal text-zinc-500">
                      ({m.duration_tiers.epic[1]})
                    </span>
                  </div>
                </div>
              </div>
            </section>
          )}
~~~~~
~~~~~tsx.new
          {/* 每日 Token 消耗趋势时序图 */}
          {m.daily_trends && m.daily_trends.length > 0 && (
            <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-200">
                    📈 每日 Token 能耗趋势 (按时间序列)
                  </h2>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    展示全部交互周期的总 Token 与模型思考链 (Thinking) 能耗走势
                  </p>
                </div>
                <span className="text-xs font-mono text-zinc-400 bg-zinc-800/60 px-2 py-1 rounded">
                  {m.daily_trends.length} 个活跃天
                </span>
              </div>
              <TokenTrendChart data={m.daily_trends} />
            </section>
          )}

          {/* 时长梯队与模型分布双图并排 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 心智时长梯队环形图 */}
            {m.duration_tiers && (
              <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
                <h2 className="text-sm font-semibold text-zinc-200 mb-1">
                  ⏱️ 心智时长梯队切片
                </h2>
                <p className="text-xs text-zinc-500 mb-4">
                  单次任务从首轮交互到最后收尾的时间窗口跨度
                </p>
                <DurationTiersChart tiers={m.duration_tiers} />
              </section>
            )}

            {/* 模型使用偏好条形图 */}
            {m.model_distribution && (
              <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
                <h2 className="text-sm font-semibold text-zinc-200 mb-1">
                  🤖 模型偏好与实验分布
                </h2>
                <p className="text-xs text-zinc-500 mb-4">
                  各 Gemini 模型在所有历史会话中的调用总场次
                </p>
                <ModelDistributionChart distribution={m.model_distribution} />
              </section>
            )}
          </div>
~~~~~

### 下一步建议
1. **安装新依赖**：
   在 `frontend/` 目录下执行 `npm install` 安装新增的 `chart.js`：
   ```bash
   cd frontend && npm install
   ```
2. **启动与效果核对**：
   - 终端 1 启动后端：`uv run python main.py serve`
   - 终端 2 启动前端：`cd frontend && npm run dev`
   - 打开浏览器访问 `http://localhost:5173`，即可查看到每日 Token 趋势折线图、心智时长梯队环形图及模型偏好条形图。
3. **下一步功能扩展**：
   - 为时序图加入时间范围切片过滤器（如：最近 7 天、30 天、今年）。
   - 增加关于“高频追问模式 / 提问反模式（Prompt Smell）”的诊断建议卡片。
