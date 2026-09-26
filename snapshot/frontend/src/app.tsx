import {
  LayoutDashboard,
  MessagesSquare,
  RefreshCw,
  Settings as SettingsIcon,
} from 'lucide-preact';
import { LocationProvider, Route, Router, useLocation } from 'preact-iso';
import { useEffect } from 'preact/hooks';
import { ToastContainer } from './components/ToastContainer';
import { NotFoundRoute } from './routes/NotFoundRoute';
import { OverviewRoute } from './routes/OverviewRoute';
import { SessionsRoute } from './routes/SessionsRoute';
import { SettingsRoute } from './routes/SettingsRoute';
import {
  TIME_RANGE_OPTIONS,
  type TimeRange,
  fetchMetrics,
  setTimeRange,
  timeRangeSignal,
} from './state/metrics';
import { fetchSessions } from './state/session';
import {
  setupAutoSyncOnFocus,
  setupSyncEventListener,
  syncInProgressSignal,
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
  const isSessionsView = path.startsWith('/sessions');

  return (
    <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur px-6 py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-4 sticky top-0 z-20">
      <div className="flex items-center gap-3">
        {/* 页面主视图切换 Tab (零前置偏移，尺寸绝对恒定) */}
        <nav className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 p-0.5 rounded-lg text-xs">
          <button
            type="button"
            onClick={() => route('/')}
            className={`px-3 py-1 rounded-md font-medium transition flex items-center gap-1.5 cursor-pointer ${
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
            className={`px-3 py-1 rounded-md font-medium transition flex items-center gap-1.5 cursor-pointer ${
              isSessionsView
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
          >
            <MessagesSquare size={13} />
            <span>会话工作台</span>
          </button>
          <button
            type="button"
            onClick={() => route('/settings')}
            className={`px-3 py-1 rounded-md font-medium transition flex items-center gap-1.5 cursor-pointer ${
              path.startsWith('/settings')
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
          >
            <SettingsIcon size={13} />
            <span>系统控制台</span>
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
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all cursor-pointer ${
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

        {/* 增量同步操作组：等宽固定无抖动设计 */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => triggerSync(50)}
            disabled={syncInProgressSignal.value}
            className="px-3 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded transition shadow-sm flex items-center justify-center gap-1.5 min-w-[96px] cursor-pointer"
            title="拉取 Google 云端最近 50 条修改的会话"
          >
            <RefreshCw size={13} className={syncInProgressSignal.value ? 'animate-spin' : ''} />
            <span>{syncInProgressSignal.value ? '同步中...' : '增量同步'}</span>
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
    const cleanupAutoSync = setupAutoSyncOnFocus();
    return () => {
      cleanupSync();
      cleanupAutoSync();
    };
  }, []);

  return (
    <LocationProvider>
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans">
        <HeaderBar />
        <Router>
          <Route path="/" component={OverviewRoute} />
          <Route path="/sessions" component={SessionsRoute} />
          <Route path="/sessions/:id" component={SessionsRoute} />
          <Route path="/settings" component={SettingsRoute} />
          <Route default component={NotFoundRoute} />
        </Router>
        <ToastContainer />
      </div>
    </LocationProvider>
  );
}
