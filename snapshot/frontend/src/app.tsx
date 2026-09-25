import {
  Brain,
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
            <RefreshCw size={13} className={syncInProgressSignal.value ? 'animate-spin' : ''} />
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
