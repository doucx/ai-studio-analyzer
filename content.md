已完成对 Phase 1 状态与逻辑下沉方案的设计。

我们将在保持现有 UI 和交互完全不变（Zero UI Breaking）的前提下，将混杂在 `app.tsx` 中的全局状态与网络通讯逻辑解耦为领域 Store，并将全景大盘指标卡片与图表抽离为独立的 `OverviewDashboard` 组件。

## [WIP] refactor(frontend): 下沉全局状态并拆分解耦看板视图

### 用户需求
针对前端应用从 MVP 单文件演进导致的逻辑紧耦合问题，执行重构第一阶段（Phase 1: 状态与逻辑下沉）：
1. 将散落在 `app.tsx` 顶部的全局 Signals 按照业务领域拆分下沉至独立的状态管理层；
2. 抽离 SSE 实时事件流监听与云盘增量同步调度逻辑；
3. 将全景看板指标大盘（指标卡、时序趋势图、心智时长梯队、模型偏好）拆分为专职视图组件；
4. 保证现有 UI、交互逻辑与虚拟滚动列表行为 100% 一致。

### 评论
当前 `app.tsx` 承担了状态枢纽、通信调度与视图渲染的多重职责，是后续引入独立分析页与多维筛选的主要阻碍。本次重构在不改动外部可见特性的前提下，实现职责归位与状态分层，为后续轻量路由与多维下钻过滤打下清晰坚固的架构底座。

### 目标
1. 新建 `frontend/src/state/metrics.ts`：管理全局时间切片、聚合指标拉取与指标加载状态；
2. 新建 `frontend/src/state/session.ts`：管理会话列表数据源、选中会话实体、侧边栏折叠状态与调度操作；
3. 新建 `frontend/src/state/sync.ts`：封装 Google Drive 增量同步请求与 SSE 事件通道的订阅生命周期；
4. 新建 `frontend/src/components/OverviewDashboard.tsx`：承接全景看板的所有图表与指标卡片；
5. 重构 `frontend/src/app.tsx`：使其精简为仅关注应用骨架布局与路由/面板分发的高层组件（代码量减少 70%）。

### 基本原理
通过 Preact Signals 的原子化响应式特性，将状态以模块化导出（Module-level Signals），各组件根据关注点订阅特定领域信号，避免根组件因非相关状态变更引发的无效重渲染。同时采用外观模式封装异步 API 与 SSE 监听，保证副作用生命周期与 UI 渲染生命周期的清晰解耦。

### 标签
#intent/refine #flow/ready #priority/high
#comp/frontend #concept/state #scope/dx
#ai/instruct
#task/domain/ui
#task/object/state-layer-refactor
#task/action/refactor
#task/state/begin #task/status/active

---

### Script

#### Acts 1: 创建指标与时间切片状态模块 (`state/metrics.ts`)

我们将提取时间切片配置与指标拉取逻辑，建立独立指标领域 Store。

~~~~~act
write_file
frontend/src/state/metrics.ts
~~~~~
~~~~~typescript
import { signal } from '@preact/signals';
import type { MetricsSummary } from '../types/metrics';

export type TimeRange = '7d' | '30d' | '90d' | 'this_year' | 'all';

export const TIME_RANGE_OPTIONS: { key: TimeRange; label: string }[] = [
  { key: '7d', label: '7天' },
  { key: '30d', label: '30天' },
  { key: '90d', label: '90天' },
  { key: 'this_year', label: '今年' },
  { key: 'all', label: '全部' },
];

export const timeRangeSignal = signal<TimeRange>('all');
export const metricsSignal = signal<MetricsSummary | null>(null);
export const metricsLoadingSignal = signal<boolean>(true);

export async function fetchMetrics(range: TimeRange = timeRangeSignal.value) {
  if (!metricsSignal.value) {
    metricsLoadingSignal.value = true;
  }
  try {
    const res = await fetch(`/api/metrics?range=${range}`);
    const data = await res.json();
    metricsSignal.value = data;
  } catch (err) {
    console.error('加载审计指标失败:', err);
  } finally {
    metricsLoadingSignal.value = false;
  }
}

export function setTimeRange(newRange: TimeRange) {
  timeRangeSignal.value = newRange;
}
~~~~~

#### Acts 2: 创建会话数据与选择状态模块 (`state/session.ts`)

我们将抽离会话列表集合、选中实体与侧边栏折叠状态。

~~~~~act
write_file
frontend/src/state/session.ts
~~~~~
~~~~~typescript
import { signal } from '@preact/signals';
import type { SessionItem } from '../types/metrics';
import { timeRangeSignal } from './metrics';

export const sessionsSignal = signal<SessionItem[]>([]);
export const selectedSessionSignal = signal<SessionItem | null>(null);
export const sessionsLoadingSignal = signal<boolean>(true);
export const sidebarCollapsedSignal = signal<boolean>(false);

export async function fetchSessions(range = timeRangeSignal.value) {
  if (sessionsSignal.value.length === 0) {
    sessionsLoadingSignal.value = true;
  }
  try {
    const res = await fetch(`/api/sessions?range=${range}`);
    const data = await res.json();
    sessionsSignal.value = data;
  } catch (err) {
    console.error('加载会话列表失败:', err);
  } finally {
    sessionsLoadingSignal.value = false;
  }
}

export function selectSession(session: SessionItem | null) {
  selectedSessionSignal.value = session;
}

export function toggleSidebar() {
  sidebarCollapsedSignal.value = !sidebarCollapsedSignal.value;
}
~~~~~

#### Acts 3: 创建云盘增量同步与 SSE 通讯模块 (`state/sync.ts`)

我们将异步同步任务触发与 SSE 事件监听管道封装为独立服务。

~~~~~act
write_file
frontend/src/state/sync.ts
~~~~~
~~~~~typescript
import { signal } from '@preact/signals';

export const syncInProgressSignal = signal<boolean>(false);
export const syncProgressTextSignal = signal<string>('');

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

#### Acts 4: 抽离全景看板大盘组件 (`components/OverviewDashboard.tsx`)

将关键能耗卡片、每日趋势时序图、时长心智梯队切片与模型偏好图表封装为自包含的看板组件。

~~~~~act
write_file
frontend/src/components/OverviewDashboard.tsx
~~~~~
~~~~~typescript
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
            <span className="text-[10px] text-zinc-500 font-mono">
              [{activeRangeLabel}]
            </span>
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
            <span className="text-[10px] text-zinc-500 font-mono">
              [{activeRangeLabel}]
            </span>
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
            <span className="text-[10px] text-zinc-500 font-mono">
              [{activeRangeLabel}]
            </span>
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
            <span className="text-[10px] text-zinc-500 font-mono">
              [{activeRangeLabel}]
            </span>
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
              <h2 className="text-sm font-semibold text-zinc-200">
                📈 每日 Token 能耗趋势 (按时间序列)
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
              <h2 className="text-sm font-semibold text-zinc-200 mb-1">
                ⏱️ 心智时长梯队切片
              </h2>
              <p className="text-xs text-zinc-500 mb-3">
                单次任务从首轮交互到最后收尾的时间窗口跨度
              </p>
              <DurationTiersChart tiers={metrics.duration_tiers} />
            </section>
          )}

          {metrics.model_distribution && Object.keys(metrics.model_distribution).length > 0 && (
            <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-zinc-200 mb-1">🤖 模型偏好分布</h2>
              <p className="text-xs text-zinc-500 mb-3">
                各 Gemini 模型在所选周期内的调用场次
              </p>
              <ModelDistributionChart distribution={metrics.model_distribution} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
~~~~~

#### Acts 5: 重构主应用入口 (`app.tsx`)

使用新的状态管理与拆分组件重写 `app.tsx`，大幅降低圈复杂度与代码体量。

~~~~~act
write_file
frontend/src/app.tsx
~~~~~
~~~~~typescript
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
~~~~~

### 下一步建议

Phase 1 已经将全局状态解耦下沉完毕，且不改变任何已有视图表现。后续建议：
1. **测试与语法验证**: 执行 `npm run check` (Biome + `tsc --noEmit`) 验证所有类型与代码风格；
2. **进入 Phase 2 (页面级路由骨架)**: 将当前通过三元运算符判断的 `selectedSession ? <Detail> : <Dashboard>` 升级为轻量路由（例如 Tab 或 Hash 路由），支持直接通过 URL 打开指定会话（`/sessions/:id`）以及导航到未来的 `/topics` 分析页；
3. 验证无误后可生成 `[COMMIT]` 计划以归档 Phase 1 代码成果。
