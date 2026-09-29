import {
  Calendar,
  Check,
  ChevronDown,
  LayoutDashboard,
  MessagesSquare,
  RefreshCw,
  Settings as SettingsIcon,
} from 'lucide-preact';
import { LocationProvider, Route, Router, useLocation } from 'preact-iso';
import { useEffect, useState } from 'preact/hooks';
import { TimeSliceScrubber } from './components/TimeSliceScrubber';
import { ToastContainer } from './components/ToastContainer';
import { NotFoundRoute } from './routes/NotFoundRoute';
import { OverviewRoute } from './routes/OverviewRoute';
import { SessionsRoute } from './routes/SessionsRoute';
import { SettingsRoute } from './routes/SettingsRoute';
import {
  TIME_RANGE_OPTIONS,
  type TimeRange,
  allDailyTrendsSignal,
  customEndDateSignal,
  customStartDateSignal,
  fetchAllDailyTrends,
  fetchMetrics,
  fetchTodayMetrics,
  metricsSignal,
  setCustomDateRange,
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

function loadAllData(
  range: TimeRange = timeRangeSignal.value,
  start: string | null = customStartDateSignal.value,
  end: string | null = customEndDateSignal.value,
) {
  return Promise.all([
    fetchMetrics(range, start, end),
    fetchSessions(range, start, end),
    fetchTodayMetrics(),
  ]);
}

function handleTimeRangeChange(newRange: TimeRange) {
  setTimeRange(newRange);
  loadAllData(newRange, null, null);
}

function HeaderBar() {
  const { path, route } = useLocation();
  const currentRange = timeRangeSignal.value;
  const customStart = customStartDateSignal.value;
  const customEnd = customEndDateSignal.value;
  const isSessionsView = path.startsWith('/sessions');

  const [isCustomOpen, setIsCustomOpen] = useState(false);
  const [tempStart, setTempStart] = useState(customStart || '');
  const [tempEnd, setTempEnd] = useState(customEnd || '');

  const isCustomActive = Boolean(customStart && customEnd);

  // 优先采用全量趋势波形，若未初始化则回退至当前 metrics 的 trends
  const trendData =
    allDailyTrendsSignal.value.length > 0
      ? allDailyTrendsSignal.value
      : metricsSignal.value?.daily_trends || [];

  const handleOpenCustom = () => {
    fetchAllDailyTrends();
    const sorted = [...trendData].sort((a, b) => a.date.localeCompare(b.date));
    const firstDate = sorted.length > 0 ? sorted[0].date : '';
    const lastDate = sorted.length > 0 ? sorted[sorted.length - 1].date : '';

    setTempStart(customStart || firstDate);
    setTempEnd(customEnd || lastDate);
    setIsCustomOpen(!isCustomOpen);
  };

  const applyCustomRange = () => {
    if (!tempStart || !tempEnd) return;
    if (tempStart > tempEnd) {
      setCustomDateRange(tempEnd, tempStart);
      loadAllData(currentRange, tempEnd, tempStart);
    } else {
      setCustomDateRange(tempStart, tempEnd);
      loadAllData(currentRange, tempStart, tempEnd);
    }
    setIsCustomOpen(false);
  };

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

      <div className="flex items-center gap-3 flex-wrap relative">
        {/* 全局时间范围胶囊 + 精确自定义起止日期 */}
        <div className="inline-flex items-center rounded-lg bg-zinc-900 border border-zinc-800 p-0.5 shadow-inner">
          {TIME_RANGE_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => handleTimeRangeChange(key)}
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all cursor-pointer ${
                currentRange === key && !isCustomActive
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              }`}
            >
              {label}
            </button>
          ))}

          {/* 精确日期区间触发胶囊 */}
          <div className="relative">
            <button
              type="button"
              onClick={handleOpenCustom}
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all flex items-center gap-1 cursor-pointer ${
                isCustomActive
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              }`}
              title="自定义选择从 A 日到 B 日的闭区间"
            >
              <Calendar size={12} />
              <span>
                {isCustomActive ? `${customStart?.slice(5)} ~ ${customEnd?.slice(5)}` : '指定区间'}
              </span>
              <ChevronDown size={11} />
            </button>

            {/* 专业时序切片器面板 (支持时序波形圈选 + 双把手拖拽) */}
            {isCustomOpen && (
              <div className="absolute right-0 top-9 z-50 bg-zinc-950 border border-zinc-700/80 rounded-xl p-4 shadow-2xl space-y-4 w-[340px] sm:w-[480px] md:w-[540px] animate-in fade-in zoom-in-95 duration-150">
                <div className="text-xs font-semibold text-zinc-200 flex items-center justify-between border-b border-zinc-800/80 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Calendar size={14} className="text-indigo-400" />
                    <span>时空波形切片器 (闭区间圈选)</span>
                  </div>
                  {isCustomActive && (
                    <button
                      type="button"
                      onClick={() => {
                        handleTimeRangeChange(currentRange);
                        setIsCustomOpen(false);
                      }}
                      className="text-[11px] text-zinc-400 hover:text-indigo-300 underline cursor-pointer"
                    >
                      清空自定义区间
                    </button>
                  )}
                </div>

                {/* 交互波形切片器核心组件 */}
                <TimeSliceScrubber
                  dailyTrends={trendData}
                  startDate={tempStart}
                  endDate={tempEnd}
                  onRangeChange={(start, end) => {
                    setTempStart(start);
                    setTempEnd(end);
                  }}
                />

                {/* 辅助微调输入框与操作动作条 */}
                <div className="grid grid-cols-2 gap-3 pt-1 border-t border-zinc-800/60">
                  <div className="space-y-1">
                    <label htmlFor="temp-start-date" className="text-[10px] text-zinc-400 block font-mono">
                      起始日期 (Start)
                    </label>
                    <input
                      id="temp-start-date"
                      type="date"
                      value={tempStart}
                      onChange={(e) => setTempStart((e.target as HTMLInputElement).value)}
                      className="w-full bg-zinc-900 border border-zinc-700/80 rounded px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="temp-end-date" className="text-[10px] text-zinc-400 block font-mono">
                      截止日期 (End)
                    </label>
                    <input
                      id="temp-end-date"
                      type="date"
                      value={tempEnd}
                      onChange={(e) => setTempEnd((e.target as HTMLInputElement).value)}
                      className="w-full bg-zinc-900 border border-zinc-700/80 rounded px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-zinc-800">
                  <span className="text-[11px] text-zinc-500 font-mono hidden sm:inline">
                    提示: 拖动左右两端手柄或中间窗口可快速圈选
                  </span>
                  <div className="flex items-center gap-2 ml-auto">
                    <button
                      type="button"
                      onClick={() => setIsCustomOpen(false)}
                      className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 rounded hover:bg-zinc-800 transition cursor-pointer"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={applyCustomRange}
                      disabled={!tempStart || !tempEnd}
                      className="px-4 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-md transition flex items-center gap-1.5 shadow-sm cursor-pointer"
                    >
                      <Check size={13} />
                      <span>生效区间</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
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
