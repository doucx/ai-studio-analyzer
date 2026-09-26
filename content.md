好的，我们现在开始实施重构治理。本方案将彻底消除全局顶部导航栏的布局抖动（Layer Shift / CLS），同时建立 Preact Signal 驱动的轻量全局 Toast 通知系统，全面覆盖增量同步的触发防御、进度反馈与异常捕获。

## [WIP] feat(frontend): 彻底根治 Header 布局抖动并引入全局 Toast 反馈系统

### 用户需求

1. 解决 HeaderBar 中侧边栏折叠按钮在切换路由时动态增删导致的横向排版跳跃。
2. 解决增量同步按钮由于内容文本剧烈伸缩导致的宽度抖动。
3. 解决点击增量同步时的静默失败与视觉反馈断层，构建全局 Toast 通知系统。

### 评论

这是一次非常关键的用户体验与健壮性改造：
- 将局部视图的控制权（侧边栏开关）归还给局部工作台，彻底释放全局顶栏的稳定性；
- 锁定同步操作按钮的尺寸与文案，将细粒度状态剥离至 Toast 体系；
- 建立对后端 `status: "busy"` 与 SSE `sync_error` 的全链路拦截，彻底告别静默失败。

### 目标

1. 创建 `frontend/src/state/toast.ts` 与 `frontend/src/components/ToastContainer.tsx`，支持 `success`, `error`, `warning`, `info` 四种状态。
2. 重构 `frontend/src/state/sync.ts`：解析 `triggerSync` 返回的 JSON，若后端处于 `busy` 状态弹出警告 Toast；在 `sync_done` 时弹出成功拉取汇总 Toast；在 `sync_error` 时透出具体错误原因。
3. 重构 `frontend/src/app.tsx`：移除顶栏的侧边栏折叠按钮，将同步按钮文案与宽度固定（`min-w-[92px]` 居中显示），挂载 `<ToastContainer />`。
4. 在 `frontend/src/components/VirtualSessionList.tsx` 与 `frontend/src/routes/SessionsRoute.tsx` 内部集成折叠/展开按钮，实现就近视图控制且零跳变。

### 基本原理

1. **结构恒定性**：HeaderBar 在所有路由、所有状态下其子组件数量与尺寸保持 100% 静态不变，从而将 Cumulative Layout Shift (CLS) 归零。
2. **状态解耦**：按钮仅负责触发动作（`增量同步` ↔ `同步中` 4 字等宽切换），进度细节交由 Toast 广播，避免高频 Reflow。
3. **响应式通知管道**：使用 Preact Signal 维护全局 Toast 队列，在异步事件流回调中无缝触发 UI 提醒，确保网络或认证异常第一时间被用户感知。

### 标签

#intent/build #flow/ready #priority/high #comp/cli #concept/ui #concept/state #scope/ux #ai/instruct #task/domain/ui #task/object/toast-and-layout-stability #task/action/implementation #task/state/begin #task/status/active

---

### Script

#### Acts 1: 创建 Toast 状态管理与展示容器

创建基于 Preact Signal 的全局 Toast 状态驱动与悬浮通知组件。

~~~~~act
write_file
frontend/src/state/toast.ts
~~~~~
~~~~~typescript
import { signal } from '@preact/signals';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  durationMs: number;
}

export const toastsSignal = signal<ToastItem[]>([]);

export function addToast(message: string, type: ToastType = 'info', durationMs = 4000) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const newToast: ToastItem = { id, type, message, durationMs };

  toastsSignal.value = [...toastsSignal.value, newToast];

  if (durationMs > 0) {
    setTimeout(() => {
      removeToast(id);
    }, durationMs);
  }
}

export function removeToast(id: string) {
  toastsSignal.value = toastsSignal.value.filter((t) => t.id !== id);
}
~~~~~

~~~~~act
write_file
frontend/src/components/ToastContainer.tsx
~~~~~
~~~~~typescript
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-preact';
import { removeToast, toastsSignal } from '../state/toast';

export function ToastContainer() {
  const toasts = toastsSignal.value;

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0">
      {toasts.map((toast) => {
        let borderClass = 'border-indigo-500/40 bg-zinc-900/95 text-indigo-300';
        let icon = <Info size={16} className="text-indigo-400 shrink-0 mt-0.5" />;

        if (toast.type === 'success') {
          borderClass = 'border-emerald-500/50 bg-zinc-900/95 text-emerald-300';
          icon = <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />;
        } else if (toast.type === 'warning') {
          borderClass = 'border-amber-500/50 bg-zinc-900/95 text-amber-300';
          icon = <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />;
        } else if (toast.type === 'error') {
          borderClass = 'border-red-500/50 bg-zinc-900/95 text-red-300';
          icon = <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />;
        }

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-2.5 p-3 rounded-lg border shadow-xl backdrop-blur-md transition-all duration-200 text-xs leading-relaxed animate-in fade-in slide-in-from-bottom-2 ${borderClass}`}
          >
            {icon}
            <div className="flex-1 font-sans break-words">{toast.message}</div>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              className="text-zinc-400 hover:text-zinc-200 transition p-0.5 rounded cursor-pointer shrink-0"
              title="关闭通知"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
~~~~~

#### Acts 2: 升级同步状态机接入全局 Toast

在 `sync.ts` 中拦截后端的 `busy` 响应、透出 `sync_error` 并向用户提示 `sync_done` 的执行成果。

~~~~~act
patch_file
frontend/src/state/sync.ts
~~~~~
~~~~~typescript.old
export async function triggerSync(limit = 50) {
  syncInProgressSignal.value = true;
  syncProgressTextSignal.value = '准备同步...';
  try {
    await fetch(`/api/sync?limit=${limit}`, { method: 'POST' });
  } catch (err) {
    console.error('触发同步失败:', err);
    syncInProgressSignal.value = false;
    syncProgressTextSignal.value = '';
  }
}

export function setupSyncEventListener(onSyncComplete: () => void): () => void {
  const eventSource = new EventSource('/api/sync/events');

  eventSource.addEventListener('sync_progress', (e) => {
    try {
      const data = JSON.parse(e.data);
      syncProgressTextSignal.value = `${data.current}/${data.total} (拉取:${data.downloaded})`;
    } catch {
      // 忽略解析错误
    }
  });

  eventSource.addEventListener('sync_done', () => {
    syncInProgressSignal.value = false;
    syncProgressTextSignal.value = '';
    syncVersionSignal.value += 1;
    onSyncComplete();
  });

  eventSource.addEventListener('sync_error', (e) => {
    console.error('同步异常:', e.data);
    syncInProgressSignal.value = false;
    syncProgressTextSignal.value = '';
  });

  return () => {
    eventSource.close();
  };
}
~~~~~
~~~~~typescript.new
import { addToast } from './toast';

export async function triggerSync(limit = 50) {
  syncInProgressSignal.value = true;
  syncProgressTextSignal.value = '准备同步...';
  try {
    const res = await fetch(`/api/sync?limit=${limit}`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'busy') {
        syncInProgressSignal.value = false;
        syncProgressTextSignal.value = '';
        addToast(data.message || '增量同步正在进行中，请勿重复触发', 'warning');
        return;
      }
    } else {
      syncInProgressSignal.value = false;
      syncProgressTextSignal.value = '';
      addToast(`触发同步请求失败 (HTTP ${res.status})`, 'error');
    }
  } catch (err) {
    console.error('触发同步失败:', err);
    syncInProgressSignal.value = false;
    syncProgressTextSignal.value = '';
    addToast(`网络异常，无法连接同步服务: ${String(err)}`, 'error');
  }
}

export function setupSyncEventListener(onSyncComplete: () => void): () => void {
  const eventSource = new EventSource('/api/sync/events');

  eventSource.addEventListener('sync_progress', (e) => {
    try {
      const data = JSON.parse(e.data);
      syncProgressTextSignal.value = `${data.current}/${data.total} (拉取:${data.downloaded})`;
    } catch {
      // 忽略解析错误
    }
  });

  eventSource.addEventListener('sync_done', (e) => {
    syncInProgressSignal.value = false;
    syncProgressTextSignal.value = '';
    syncVersionSignal.value += 1;
    onSyncComplete();

    try {
      const result = JSON.parse(e.data);
      addToast(
        `增量同步完成：扫描 ${result.total_scanned} 篇，新增拉取 ${result.downloaded} 篇 (缓存总计: ${result.cache_total})`,
        'success',
        5000,
      );
    } catch {
      addToast('增量同步已顺利完成', 'success');
    }
  });

  eventSource.addEventListener('sync_error', (e) => {
    console.error('同步异常:', e.data);
    syncInProgressSignal.value = false;
    syncProgressTextSignal.value = '';

    let errorDetail = e.data;
    try {
      const parsed = JSON.parse(e.data);
      if (parsed.error) errorDetail = parsed.error;
    } catch {
      // 保留原始字符串
    }

    addToast(`同步任务异常中断: ${errorDetail}`, 'error', 7000);
  });

  return () => {
    eventSource.close();
  };
}
~~~~~

#### Acts 3: 优化 HeaderBar 彻底消除排版抖动并挂载 ToastContainer

移除顶层侧边栏折叠按钮，固定增量同步按钮的等宽文本与 `min-w-[92px]` 尺寸，并在全局挂载 `<ToastContainer />`。

~~~~~act
patch_file
frontend/src/app.tsx
~~~~~
~~~~~typescript.old
import {
  LayoutDashboard,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings as SettingsIcon,
} from 'lucide-preact';
import { LocationProvider, Route, Router, useLocation } from 'preact-iso';
import { useEffect } from 'preact/hooks';
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
import { fetchSessions, sidebarCollapsedSignal, toggleSidebar } from './state/session';
import {
  setupAutoSyncOnFocus,
  setupSyncEventListener,
  syncInProgressSignal,
  syncProgressTextSignal,
  triggerSync,
} from './state/sync';
~~~~~
~~~~~typescript.new
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
~~~~~

~~~~~act
patch_file
frontend/src/app.tsx
~~~~~
~~~~~typescript.old
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

        {/* 页面主视图切换 Tab */}
        <nav className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 p-0.5 rounded-lg text-xs">
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
          <button
            type="button"
            onClick={() => route('/settings')}
            className={`px-3 py-1 rounded-md font-medium transition flex items-center gap-1.5 ${
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

        {/* 增量同步操作组 */}
        <div className="flex items-center gap-2 flex-wrap">
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
~~~~~
~~~~~typescript.new
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
~~~~~

~~~~~act
patch_file
frontend/src/app.tsx
~~~~~
~~~~~typescript.old
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
      </div>
    </LocationProvider>
  );
~~~~~
~~~~~typescript.new
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
~~~~~

#### Acts 4: 在会话工作台内原生集成无抖动的侧边栏折叠按钮

在 `VirtualSessionList` 标题栏放置“收起”按钮；在 `SessionsRoute` 侧边栏折叠后提供显式展开按钮。

~~~~~act
patch_file
frontend/src/components/VirtualSessionList.tsx
~~~~~
~~~~~typescript.old
import { Loader2 } from 'lucide-preact';
import { useRef, useState } from 'preact/hooks';
import {
  type DepthFilter,
  type SortOption,
  availableModelsSignal,
  depthFilterSignal,
  filteredSessionsSignal,
  ftsResultsSignal,
  handleSearchInput,
  isFilterActiveSignal,
  isSearchingFtsSignal,
  resetFilters,
  searchKeywordSignal,
  selectedModelSignal,
  sessionsSignal,
  sortBySignal,
} from '../state/session';
~~~~~
~~~~~typescript.new
import { Loader2, PanelLeftClose } from 'lucide-preact';
import { useRef, useState } from 'preact/hooks';
import {
  type DepthFilter,
  type SortOption,
  availableModelsSignal,
  depthFilterSignal,
  filteredSessionsSignal,
  ftsResultsSignal,
  handleSearchInput,
  isFilterActiveSignal,
  isSearchingFtsSignal,
  resetFilters,
  searchKeywordSignal,
  selectedModelSignal,
  sessionsSignal,
  sortBySignal,
  toggleSidebar,
} from '../state/session';
~~~~~

~~~~~act
patch_file
frontend/src/components/VirtualSessionList.tsx
~~~~~
~~~~~typescript.old
        {/* 第一行：状态指示与排序选择 */}
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-zinc-200">
              会话历史 ({filteredSessions.length} / {totalSessionsCount})
            </span>
            {isFilterActive && (
              <button
                type="button"
                onClick={resetFilters}
                className="text-[10px] text-indigo-400 hover:text-indigo-300 underline font-mono cursor-pointer ml-1"
                title="清空所有过滤条件"
              >
                [重置]
              </button>
            )}
          </div>

          <select
            value={currentSort}
            onChange={(e) => {
              sortBySignal.value = (e.target as HTMLSelectElement).value as SortOption;
            }}
            className="bg-zinc-950 border border-zinc-700 text-zinc-300 text-[11px] rounded px-1.5 py-0.5 outline-none focus:border-indigo-500"
          >
            {ftsResultsSignal.value !== null && <option value="relevance">相关度</option>}
            <option value="modified">最近修改</option>
            <option value="tokens">Token 能耗</option>
            <option value="chunks">Chunk 数量</option>
          </select>
        </div>
~~~~~
~~~~~typescript.new
        {/* 第一行：状态指示与排序选择 */}
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-zinc-200">
              会话历史 ({filteredSessions.length} / {totalSessionsCount})
            </span>
            {isFilterActive && (
              <button
                type="button"
                onClick={resetFilters}
                className="text-[10px] text-indigo-400 hover:text-indigo-300 underline font-mono cursor-pointer ml-1"
                title="清空所有过滤条件"
              >
                [重置]
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <select
              value={currentSort}
              onChange={(e) => {
                sortBySignal.value = (e.target as HTMLSelectElement).value as SortOption;
              }}
              className="bg-zinc-950 border border-zinc-700 text-zinc-300 text-[11px] rounded px-1.5 py-0.5 outline-none focus:border-indigo-500"
            >
              {ftsResultsSignal.value !== null && <option value="relevance">相关度</option>}
              <option value="modified">最近修改</option>
              <option value="tokens">Token 能耗</option>
              <option value="chunks">Chunk 数量</option>
            </select>

            <button
              type="button"
              onClick={toggleSidebar}
              className="p-1 text-zinc-400 hover:text-zinc-200 bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-700/60 rounded transition cursor-pointer"
              title="收起会话历史列表"
            >
              <PanelLeftClose size={13} />
            </button>
          </div>
        </div>
~~~~~

~~~~~act
patch_file
frontend/src/routes/SessionsRoute.tsx
~~~~~
~~~~~typescript.old
import { MessagesSquare } from 'lucide-preact';
import { useLocation, useRoute } from 'preact-iso';
import { useMemo } from 'preact/hooks';
import { SessionDetailPanel } from '../components/SessionDetailPanel';
import { VirtualSessionList } from '../components/VirtualSessionList';
import {
  filteredSessionsSignal,
  sessionsLoadingSignal,
  sessionsSignal,
  sidebarCollapsedSignal,
} from '../state/session';
import type { SessionItem } from '../types/metrics';
~~~~~
~~~~~typescript.new
import { MessagesSquare, PanelLeftOpen } from 'lucide-preact';
import { useLocation, useRoute } from 'preact-iso';
import { useMemo } from 'preact/hooks';
import { SessionDetailPanel } from '../components/SessionDetailPanel';
import { VirtualSessionList } from '../components/VirtualSessionList';
import {
  filteredSessionsSignal,
  sessionsLoadingSignal,
  sessionsSignal,
  sidebarCollapsedSignal,
  toggleSidebar,
} from '../state/session';
import type { SessionItem } from '../types/metrics';
~~~~~

~~~~~act
patch_file
frontend/src/routes/SessionsRoute.tsx
~~~~~
~~~~~typescript.old
      {/* 右侧：单会话详情 或 空状态引导 */}
      <main className="flex-1 overflow-y-auto lg:h-[calc(100vh-120px)] pr-1 w-full flex flex-col">
        {isLoading && sessions.length === 0 ? (
          <div className="py-24 text-center text-zinc-500 text-sm animate-pulse">
            正在载入会话工作台索引...
          </div>
        ) : currentSession ? (
          <SessionDetailPanel
            key={currentSession.file_id}
            session={currentSession}
            onClose={handleCloseDetail}
          />
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
~~~~~
~~~~~typescript.new
      {/* 右侧：单会话详情 或 空状态引导 */}
      <main className="flex-1 overflow-y-auto lg:h-[calc(100vh-120px)] pr-1 w-full flex flex-col relative">
        {/* 侧边栏折叠时的主视口快捷展开入口 */}
        {isSidebarCollapsed && (
          <div className="mb-3 flex items-center">
            <button
              type="button"
              onClick={toggleSidebar}
              className="px-2.5 py-1 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700/80 rounded transition flex items-center gap-1.5 shadow-sm cursor-pointer"
              title="展开会话历史列表"
            >
              <PanelLeftOpen size={14} className="text-indigo-400" />
              <span>展开会话历史</span>
            </button>
          </div>
        )}

        {isLoading && sessions.length === 0 ? (
          <div className="py-24 text-center text-zinc-500 text-sm animate-pulse">
            正在载入会话工作台索引...
          </div>
        ) : currentSession ? (
          <SessionDetailPanel
            key={currentSession.file_id}
            session={currentSession}
            onClose={handleCloseDetail}
          />
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
~~~~~

### 下一步建议

1. 刷新浏览器并测试在“全景大盘”、“会话工作台”和“系统控制台”之间来回切换，观察 Header 导航栏是否已达到完全零横向抖动（CLS = 0）。
2. 点击“增量同步”按钮：
   - 验证按钮文案平滑切换（`增量同步` ↔ `同步中...`），按钮宽度固定不变；
   - 观察右下角是否正常弹出“增量同步完成”或“增量同步正在进行中”的优雅 Toast 浮层；
   - 若刻意切断代理或触发异常，检查是否能在 Toast 中直接清晰看到错误原因。
3. 验证通过后，如果无需其他微调，可生成独立的 `[COMMIT]` 计划。
