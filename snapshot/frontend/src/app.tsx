import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { DurationTiersChart } from './components/charts/DurationTiersChart';
import { ModelDistributionChart } from './components/charts/ModelDistributionChart';
import { TokenTrendChart } from './components/charts/TokenTrendChart';
import type { MetricsSummary, SessionItem } from './types/metrics';

export type TimeRange = '7d' | '30d' | '90d' | 'this_year' | 'all';

const timeRangeSignal = signal<TimeRange>('all');
const metricsSignal = signal<MetricsSummary | null>(null);
const sessionsSignal = signal<SessionItem[]>([]);
const loadingSignal = signal<boolean>(true);
const syncInProgressSignal = signal<boolean>(false);

const TIME_RANGE_OPTIONS: { key: TimeRange; label: string }[] = [
  { key: '7d', label: '7天' },
  { key: '30d', label: '30天' },
  { key: '90d', label: '90天' },
  { key: 'this_year', label: '今年' },
  { key: 'all', label: '全部' },
];

async function loadDashboardData(range: TimeRange = timeRangeSignal.value) {
  // 仅在首次进入无数据时显示全屏加载态，后续更新保持静默无感平滑切换
  if (!metricsSignal.value) {
    loadingSignal.value = true;
  }
  try {
    const [metricsRes, sessionsRes] = await Promise.all([
      fetch(`/api/metrics?range=${range}`).then((r) => r.json()),
      fetch(`/api/sessions?range=${range}&limit=30`).then((r) => r.json()),
    ]);
    metricsSignal.value = metricsRes;
    sessionsSignal.value = sessionsRes;
  } catch (err) {
    console.error('加载审计数据失败:', err);
  } finally {
    loadingSignal.value = false;
  }
}

function handleTimeRangeChange(newRange: TimeRange) {
  timeRangeSignal.value = newRange;
  loadDashboardData(newRange);
}

async function handleTriggerSync() {
  syncInProgressSignal.value = true;
  try {
    await fetch('/api/sync?limit=50', { method: 'POST' });
    const timer = setInterval(async () => {
      try {
        const res = await fetch('/api/sync/status').then((r) => r.json());
        if (!res.is_syncing) {
          clearInterval(timer);
          syncInProgressSignal.value = false;
          await loadDashboardData();
        }
      } catch {
        clearInterval(timer);
        syncInProgressSignal.value = false;
      }
    }, 1000);
  } catch (err) {
    console.error('触发同步失败:', err);
    syncInProgressSignal.value = false;
  }
}

export function App() {
  useEffect(() => {
    loadDashboardData();
  }, []);

  const m = metricsSignal.value;
  const sessions = sessionsSignal.value;
  const currentRange = timeRangeSignal.value;
  const activeRangeLabel = TIME_RANGE_OPTIONS.find((o) => o.key === currentRange)?.label || '全部';

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 md:p-10 max-w-7xl mx-auto font-sans">
      {/* 顶部标题与控制条 */}
      <header className="flex flex-col lg:flex-row lg:items-center justify-between border-b border-zinc-800 pb-6 gap-5">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-2xl">🧠</span>
            <h1 className="text-2xl font-bold tracking-tight text-white">AI Studio Analyzer</h1>
            <span className="text-xs font-mono uppercase bg-indigo-950/80 text-indigo-400 border border-indigo-800/60 px-2 py-0.5 rounded">
              Auditor v0.1
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            个人认知与交互审计系统 · 纯离线高性能分析与元工作流沉淀
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* 全局时间范围胶囊选择器 */}
          <div className="inline-flex items-center rounded-lg bg-zinc-900 border border-zinc-800 p-0.5 shadow-inner">
            {TIME_RANGE_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => handleTimeRangeChange(key)}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${
                  currentRange === key
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="h-5 w-px bg-zinc-800 hidden sm:block" />

          {/* 导出与同步操作组 */}
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={`/api/export/csv?range=${currentRange}`}
              download
              className="px-3 py-1.5 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded transition flex items-center gap-1.5"
              title={`导出 ${activeRangeLabel} 的 CSV 报表`}
            >
              <span>📥</span> 导出 CSV
            </a>
            <a
              href={`/api/export/jsonl?range=${currentRange}`}
              download
              className="px-3 py-1.5 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded transition flex items-center gap-1.5"
              title={`导出 ${activeRangeLabel} 的 JSONL 清洗集`}
            >
              <span>📑</span> 导出 JSONL
            </a>
            <button
              type="button"
              onClick={() => loadDashboardData(currentRange)}
              className="px-3 py-1.5 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded transition"
            >
              刷新指标
            </button>
            <button
              type="button"
              onClick={handleTriggerSync}
              disabled={syncInProgressSignal.value}
              className="px-3.5 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded transition shadow-sm"
            >
              {syncInProgressSignal.value ? '云端同步中...' : '增量同步 (Fetch 50)'}
            </button>
          </div>
        </div>
      </header>

      {/* 加载状态 */}
      {loadingSignal.value && (
        <div className="py-20 text-center text-zinc-500 text-sm animate-pulse">
          正在从本地 SQLite WAL 对象库加载全景认知指标...
        </div>
      )}

      {/* 核心指标概览 */}
      {!loadingSignal.value && m && (
        <main className="mt-8 space-y-8">
          {/* 四大关键能耗卡片 */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-5">
              <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                <span>交互会话场次</span>
                <span className="text-[10px] text-zinc-500 lowercase font-mono">[{activeRangeLabel}]</span>
              </div>
              <div className="mt-2 text-2xl font-bold text-white tracking-tight">
                {m.total_sessions} <span className="text-sm font-normal text-zinc-500">场</span>
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                总字数: {(m.total_user_chars || 0).toLocaleString()} 字符
              </div>
            </div>

            <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-5">
              <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                <span>生命周期中位数 (P50)</span>
                <span className="text-[10px] text-zinc-500 lowercase font-mono">[{activeRangeLabel}]</span>
              </div>
              <div className="mt-2 text-2xl font-bold text-indigo-400 tracking-tight">
                {m.dur_stats?.median ?? 0}{' '}
                <span className="text-sm font-normal text-zinc-500">min</span>
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                多轮攻坚 P50: {m.multi_dur_stats?.median ?? 0} min | Max: {m.dur_stats?.max ?? 0}{' '}
                min
              </div>
            </div>

            <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-5">
              <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                <span>总 Token 能耗</span>
                <span className="text-[10px] text-zinc-500 lowercase font-mono">[{activeRangeLabel}]</span>
              </div>
              <div className="mt-2 text-2xl font-bold text-emerald-400 tracking-tight">
                {(m.tok_stats?.total || 0).toLocaleString()}
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                思考链 (Thinking): {m.tok_stats?.thought_ratio ?? '0%'}
              </div>
            </div>

            <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-5">
              <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                <span>思维摩擦力 (重试/分叉)</span>
                <span className="text-[10px] text-zinc-500 lowercase font-mono">[{activeRangeLabel}]</span>
              </div>
              <div className="mt-2 text-2xl font-bold text-amber-400 tracking-tight">
                {m.friction_stats?.branch_ratio ?? '0%'}
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                {m.friction_stats?.branch_sessions ?? 0} 场出现分叉 (累计{' '}
                {m.friction_stats?.total_retries ?? 0} 次重试)
              </div>
            </div>
          </section>

          {/* 当该时间范围内没有会话时的 Empty State 提示 */}
          {m.total_sessions === 0 && (
            <div className="p-8 text-center bg-zinc-900/30 border border-dashed border-zinc-800 rounded-lg">
              <p className="text-zinc-400 text-sm">
                在【{activeRangeLabel}】周期内暂无交互会话记录。
              </p>
              <button
                type="button"
                onClick={() => handleTimeRangeChange('all')}
                className="mt-3 text-xs text-indigo-400 hover:text-indigo-300 underline"
              >
                切换为查看全部历史
              </button>
            </div>
          )}

          {/* 每日 Token 消耗趋势时序图 */}
          {m.daily_trends && m.daily_trends.length > 0 && (
            <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-200">
                    📈 每日 Token 能耗趋势 (按时间序列)
                  </h2>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    展示【{activeRangeLabel}】周期内的总 Token 与模型思考链 (Thinking) 能耗走势
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
          {m.total_sessions > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 心智时长梯队环形图 */}
              {m.duration_tiers && (
                <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
                  <h2 className="text-sm font-semibold text-zinc-200 mb-1">⏱️ 心智时长梯队切片</h2>
                  <p className="text-xs text-zinc-500 mb-4">
                    单次任务从首轮交互到最后收尾的时间窗口跨度 ({activeRangeLabel})
                  </p>
                  <DurationTiersChart tiers={m.duration_tiers} />
                </section>
              )}

              {/* 模型使用偏好条形图 */}
              {m.model_distribution && Object.keys(m.model_distribution).length > 0 && (
                <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
                  <h2 className="text-sm font-semibold text-zinc-200 mb-1">🤖 模型偏好与实验分布</h2>
                  <p className="text-xs text-zinc-500 mb-4">
                    各 Gemini 模型在所选周期内的调用总场次 ({activeRangeLabel})
                  </p>
                  <ModelDistributionChart distribution={m.model_distribution} />
                </section>
              )}
            </div>
          )}

          {/* 最近会话列表预览 */}
          {sessions.length > 0 && (
            <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-zinc-200">
                  📋 交互会话明细 (周期: {activeRangeLabel}，采样前 {sessions.length} 场)
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-zinc-300">
                  <thead className="bg-zinc-900/80 text-zinc-400 uppercase text-[10px] tracking-wider border-b border-zinc-800">
                    <tr>
                      <th className="py-2.5 px-3">会话标题</th>
                      <th className="py-2.5 px-3">模型</th>
                      <th className="py-2.5 px-3">轮次</th>
                      <th className="py-2.5 px-3">时长</th>
                      <th className="py-2.5 px-3">Token 消耗</th>
                      <th className="py-2.5 px-3">首轮提问预览</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50 font-mono">
                    {sessions.map((s) => (
                      <tr key={s.file_id} className="hover:bg-zinc-800/40 transition">
                        <td className="py-2.5 px-3 font-sans font-medium text-white max-w-[200px] truncate">
                          {s.name}
                          {s.has_branching && (
                            <span className="ml-1.5 px-1 py-0.2 bg-amber-950/80 text-amber-400 border border-amber-800/50 text-[10px] rounded">
                              分叉
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-zinc-400">
                          {s.model.replace('models/', '')}
                        </td>
                        <td className="py-2.5 px-3">{s.turn_count} 轮</td>
                        <td className="py-2.5 px-3">{s.duration_human}</td>
                        <td className="py-2.5 px-3">{s.total_tokens.toLocaleString()}</td>
                        <td className="py-2.5 px-3 font-sans text-zinc-400 max-w-xs truncate">
                          {s.first_prompt || '(无文本提问)'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </main>
      )}
    </div>
  );
}