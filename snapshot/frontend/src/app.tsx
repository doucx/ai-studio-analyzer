import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { SessionDetailPanel } from './components/SessionDetailPanel';
import { VirtualSessionList } from './components/VirtualSessionList';
import { DurationTiersChart } from './components/charts/DurationTiersChart';
import { ModelDistributionChart } from './components/charts/ModelDistributionChart';
import { TokenTrendChart } from './components/charts/TokenTrendChart';
import type { MetricsSummary, SessionItem } from './types/metrics';

export type TimeRange = '7d' | '30d' | '90d' | 'this_year' | 'all';

const timeRangeSignal = signal<TimeRange>('all');
const metricsSignal = signal<MetricsSummary | null>(null);
const sessionsSignal = signal<SessionItem[]>([]);
const selectedSessionSignal = signal<SessionItem | null>(null);
const loadingSignal = signal<boolean>(true);
const syncInProgressSignal = signal<boolean>(false);
const sidebarCollapsedSignal = signal<boolean>(false);

const TIME_RANGE_OPTIONS: { key: TimeRange; label: string }[] = [
  { key: '7d', label: '7天' },
  { key: '30d', label: '30天' },
  { key: '90d', label: '90天' },
  { key: 'this_year', label: '今年' },
  { key: 'all', label: '全部' },
];

async function loadDashboardData(range: TimeRange = timeRangeSignal.value) {
  if (!metricsSignal.value) {
    loadingSignal.value = true;
  }
  try {
    // limit 缺省或传 0 拉取全量会话供虚拟滚动器自如调度
    const [metricsRes, sessionsRes] = await Promise.all([
      fetch(`/api/metrics?range=${range}`).then((r) => r.json()),
      fetch(`/api/sessions?range=${range}`).then((r) => r.json()),
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
  const selectedSession = selectedSessionSignal.value;
  const isSidebarCollapsed = sidebarCollapsedSignal.value;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans">
      {/* 顶部全局控制栏 */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => (sidebarCollapsedSignal.value = !sidebarCollapsedSignal.value)}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded transition text-xs"
            title={isSidebarCollapsed ? '展开会话历史侧边栏' : '收起会话历史侧边栏'}
          >
            {isSidebarCollapsed ? '📂 展开' : '◀ 收起'}
          </button>
          <span
            className="text-2xl cursor-pointer"
            onClick={() => (selectedSessionSignal.value = null)}
          >
            🧠
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h1
                className="text-lg font-bold tracking-tight text-white cursor-pointer hover:text-indigo-400 transition"
                onClick={() => (selectedSessionSignal.value = null)}
              >
                AI Studio Analyzer
              </h1>
              <span className="text-[10px] font-mono uppercase bg-indigo-950/80 text-indigo-400 border border-indigo-800/60 px-1.5 py-0.2 rounded">
                v0.2 Workstation
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">
              5,000+ 会话虚拟工作台 · 个人认知审计与元工作流沉淀
            </p>
          </div>
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

          {/* 快捷操作组 */}
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={`/api/export/csv?range=${currentRange}`}
              download
              className="px-2.5 py-1 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded transition"
            >
              📥 CSV
            </a>
            <a
              href={`/api/export/jsonl?range=${currentRange}`}
              download
              className="px-2.5 py-1 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded transition"
            >
              📑 JSONL
            </a>
            <button
              type="button"
              onClick={handleTriggerSync}
              disabled={syncInProgressSignal.value}
              className="px-3 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded transition shadow-sm"
            >
              {syncInProgressSignal.value ? '同步中...' : '增量同步 (50)'}
            </button>
          </div>
        </div>
      </header>

      {/* 工作台主视口：Master-Detail 布局（支持全宽展开） */}
      <div
        className={`flex-1 flex flex-col lg:flex-row overflow-hidden p-4 md:p-6 gap-6 w-full mx-auto transition-all duration-300 ${
          isSidebarCollapsed ? 'max-w-full px-6' : 'max-w-7xl'
        }`}
      >
        {/* 左侧栏：5000+ 虚拟列表会话查看器 (支持按需折叠) */}
        {!isSidebarCollapsed && (
          <aside className="w-full lg:w-[380px] h-[520px] lg:h-[calc(100vh-120px)] flex-shrink-0">
            <VirtualSessionList
              sessions={sessions}
              selectedId={selectedSession?.file_id ?? null}
              onSelect={(s) => (selectedSessionSignal.value = s)}
            />
          </aside>
        )}

        {/* 右侧主视口：全景审计图表 或 单会话沉浸详情 */}
        <main className="flex-1 overflow-y-auto lg:h-[calc(100vh-120px)] pr-1 space-y-6 w-full">
          {loadingSignal.value && (
            <div className="py-24 text-center text-zinc-500 text-sm animate-pulse">
              正在从本地 SQLite WAL 数据库加载全景认知指标与会话索引...
            </div>
          )}

          {!loadingSignal.value && selectedSession && (
            <SessionDetailPanel
              session={selectedSession}
              onClose={() => (selectedSessionSignal.value = null)}
            />
          )}

          {!loadingSignal.value && !selectedSession && m && (
            <>
              {/* 四大关键能耗卡片 */}
              <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-4">
                  <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                    <span>交互总场次</span>
                    <span className="text-[10px] text-zinc-500 font-mono">
                      [{activeRangeLabel}]
                    </span>
                  </div>
                  <div className="mt-1.5 text-2xl font-bold text-white tracking-tight">
                    {m.total_sessions} <span className="text-xs font-normal text-zinc-500">场</span>
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-500 truncate">
                    输入: {(m.total_user_chars || 0).toLocaleString()} 字符
                  </div>
                </div>

                <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-4">
                  <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                    <span>时长中位数 (P50)</span>
                    <span className="text-[10px] text-zinc-500 font-mono">
                      [{activeRangeLabel}]
                    </span>
                  </div>
                  <div className="mt-1.5 text-2xl font-bold text-indigo-400 tracking-tight">
                    {m.dur_stats?.median ?? 0}{' '}
                    <span className="text-xs font-normal text-zinc-500">min</span>
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-500 truncate">
                    多轮 P50: {m.multi_dur_stats?.median ?? 0}m | Max: {m.dur_stats?.max ?? 0}m
                  </div>
                </div>

                <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-4">
                  <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                    <span>总 Token 能耗</span>
                    <span className="text-[10px] text-zinc-500 font-mono">
                      [{activeRangeLabel}]
                    </span>
                  </div>
                  <div className="mt-1.5 text-2xl font-bold text-emerald-400 tracking-tight">
                    {(m.tok_stats?.total || 0).toLocaleString()}
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-500 truncate">
                    思考链 (Thinking): {m.tok_stats?.thought_ratio ?? '0%'}
                  </div>
                </div>

                <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-4">
                  <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                    <span>思维摩擦力</span>
                    <span className="text-[10px] text-zinc-500 font-mono">
                      [{activeRangeLabel}]
                    </span>
                  </div>
                  <div className="mt-1.5 text-2xl font-bold text-amber-400 tracking-tight">
                    {m.friction_stats?.branch_ratio ?? '0%'}
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-500 truncate">
                    {m.friction_stats?.branch_sessions ?? 0} 场分叉 (
                    {m.friction_stats?.total_retries ?? 0} 次重试)
                  </div>
                </div>
              </section>

              {/* 每日 Token 消耗趋势时序图 */}
              {m.daily_trends && m.daily_trends.length > 0 && (
                <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h2 className="text-sm font-semibold text-zinc-200">
                        📈 每日 Token 能耗趋势 (按时间序列)
                      </h2>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        展示【{activeRangeLabel}】周期内的总 Token 与思考链能耗
                      </p>
                    </div>
                    <span className="text-xs font-mono text-zinc-400 bg-zinc-800/60 px-2 py-1 rounded">
                      {m.daily_trends.length} 活跃天
                    </span>
                  </div>
                  <TokenTrendChart data={m.daily_trends} />
                </section>
              )}

              {/* 时长梯队与模型偏好双图并排 */}
              {m.total_sessions > 0 && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                  {m.duration_tiers && (
                    <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
                      <h2 className="text-sm font-semibold text-zinc-200 mb-1">
                        ⏱️ 心智时长梯队切片
                      </h2>
                      <p className="text-xs text-zinc-500 mb-3">
                        单次任务从首轮交互到最后收尾的时间窗口跨度
                      </p>
                      <DurationTiersChart tiers={m.duration_tiers} />
                    </section>
                  )}

                  {m.model_distribution && Object.keys(m.model_distribution).length > 0 && (
                    <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
                      <h2 className="text-sm font-semibold text-zinc-200 mb-1">🤖 模型偏好分布</h2>
                      <p className="text-xs text-zinc-500 mb-3">
                        各 Gemini 模型在所选周期内的调用场次
                      </p>
                      <ModelDistributionChart distribution={m.model_distribution} />
                    </section>
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
