import { useEffect } from 'preact/hooks';
import { OverviewDashboard } from './components/OverviewDashboard';
import { SessionDetailPanel } from './components/SessionDetailPanel';
import { VirtualSessionList } from './components/VirtualSessionList';
import {
  TIME_RANGE_OPTIONS,
  type TimeRange,
  fetchMetrics,
  metricsLoadingSignal,
  metricsSignal,
  setTimeRange,
  timeRangeSignal,
} from './state/metrics';
import {
  fetchSessions,
  selectSession,
  selectedSessionSignal,
  sessionsLoadingSignal,
  sessionsSignal,
  sidebarCollapsedSignal,
  toggleSidebar,
} from './state/session';
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

export function App() {
  useEffect(() => {
    loadAllData();
    const cleanupSync = setupSyncEventListener(() => {
      loadAllData();
    });
    return cleanupSync;
  }, []);

  const metrics = metricsSignal.value;
  const sessions = sessionsSignal.value;
  const currentRange = timeRangeSignal.value;
  const activeRangeLabel = TIME_RANGE_OPTIONS.find((o) => o.key === currentRange)?.label || '全部';
  const selectedSession = selectedSessionSignal.value;
  const isSidebarCollapsed = sidebarCollapsedSignal.value;
  const isLoading = metricsLoadingSignal.value && sessionsLoadingSignal.value;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans">
      {/* 顶部全局控制栏 */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleSidebar}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded transition text-xs"
            title={isSidebarCollapsed ? '展开会话历史侧边栏' : '收起会话历史侧边栏'}
          >
            {isSidebarCollapsed ? '📂 展开' : '◀ 收起'}
          </button>
          <button
            type="button"
            className="text-2xl cursor-pointer bg-transparent border-none p-0 leading-none"
            onClick={() => selectSession(null)}
            title="回到概览看板"
          >
            🧠
          </button>
          <div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="text-lg font-bold tracking-tight text-white cursor-pointer hover:text-indigo-400 transition bg-transparent border-none p-0 text-left"
                onClick={() => selectSession(null)}
              >
                AI Studio Analyzer
              </button>
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
              onClick={() => triggerSync(50)}
              disabled={syncInProgressSignal.value}
              className="px-3 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded transition shadow-sm"
            >
              {syncInProgressSignal.value
                ? syncProgressTextSignal.value
                  ? `同步中 ${syncProgressTextSignal.value}`
                  : '同步中...'
                : '增量同步 (50)'}
            </button>
          </div>
        </div>
      </header>

      {/* 工作台主视口：Master-Detail 布局 */}
      <div
        className={`flex-1 flex flex-col lg:flex-row overflow-hidden p-4 md:p-6 gap-6 w-full mx-auto transition-all duration-300 ${
          isSidebarCollapsed ? 'max-w-full px-6' : 'max-w-7xl'
        }`}
      >
        {/* 左侧栏：5000+ 虚拟列表会话查看器 */}
        {!isSidebarCollapsed && (
          <aside className="w-full lg:w-[380px] h-[520px] lg:h-[calc(100vh-120px)] flex-shrink-0">
            <VirtualSessionList
              sessions={sessions}
              selectedId={selectedSession?.file_id ?? null}
              onSelect={(s) => selectSession(s)}
            />
          </aside>
        )}

        {/* 右侧主视口：全景审计看板 或 单会话详情 */}
        <main className="flex-1 overflow-y-auto lg:h-[calc(100vh-120px)] pr-1 space-y-6 w-full">
          {isLoading && (
            <div className="py-24 text-center text-zinc-500 text-sm animate-pulse">
              正在从本地 SQLite WAL 数据库加载全景认知指标与会话索引...
            </div>
          )}

          {!isLoading && selectedSession && (
            <SessionDetailPanel
              session={selectedSession}
              onClose={() => selectSession(null)}
            />
          )}

          {!isLoading && !selectedSession && metrics && (
            <OverviewDashboard metrics={metrics} activeRangeLabel={activeRangeLabel} />
          )}
        </main>
      </div>
    </div>
  );
}