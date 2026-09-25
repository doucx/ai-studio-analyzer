已完成 Phase 2 基于 `preact-iso` 的页面级路由骨架设计。

我们将引入 `preact-iso` 极轻量路由库（约 1.5KB），将应用拆分为独立的**全景大盘路由 (`/`)** 与**会话工作台路由 (`/sessions` 与 `/sessions/:id`)**，使每个会话具备原生 URL 寻址与分享能力，并在顶部导航栏加入多视图切换 Tab。

## [WIP] feat(frontend): 基于 preact-iso 构建页面级多路由骨架

### 用户需求
推进前端重构路线图第二阶段（Phase 2: 页面级骨架与路由拆分）：
1. 引入 `preact-iso` 路由解决方案，解决单屏堆砌视图过载的问题；
2. 将全景概览看板拆分为独立页面路由（`/`）；
3. 将会话检索与沉浸详情拆分为独立工作台路由（`/sessions` 与 `/sessions/:id`），支持根据 URL 路径直接定位和分享具体会话；
4. 在全局 Header 中添加视图导航 Tab，并在未找到路由时提供 404 兜底机制。

### 评论
当前系统虽然通过 Phase 1 完成了状态解耦，但所有 UI 仍集中在单屏展示。引入轻量路由后，系统获得了真正的页面级隔离与深度链接能力（Deep Linking），彻底解决了用户刷新页面会话丢失、无法收藏特定会话 URL 的痛点，也为后续接入「`/topics` 主题认知分析」与「`/cloud` 词云透视」预留了标准插槽。

### 目标
1. 在 `frontend/package.json` 中声明 `preact-iso` 依赖并完成安装；
2. 新建 `frontend/src/routes/OverviewRoute.tsx`：承接全景大盘看板视图；
3. 新建 `frontend/src/routes/SessionsRoute.tsx`：承接虚拟滚动列表与会话详情的双栏/单栏工作台视图，支持 `:id` 动态路径解析；
4. 新建 `frontend/src/routes/NotFoundRoute.tsx`：提供优雅的路由兜底回跳；
5. 重构 `frontend/src/app.tsx`：集成 `LocationProvider`、`Router` 与全局导航 Tab。

### 基本原理
`preact-iso` 是 Preact 官方推荐的超轻量客户端/同构路由组件库。其核心通过 `LocationProvider` 监听 HTML5 History API，配合 `Router` 进行模式匹配，并通过 `useRoute()` 和 `useLocation()` 实现动态参数抽取和编程式导航。相比庞大的通用路由库，`preact-iso` 体积仅 1.5KB，完美契合本项目毫秒级极速交互的技术基调。

### 标签
#intent/build #flow/ready #priority/high
#comp/frontend #concept/navigation #scope/ux #scope/dx
#ai/instruct
#task/domain/ui
#task/object/routing-infrastructure
#task/action/implementation
#task/state/continue #task/status/active

---

### Script

#### Acts 1: 添加 `preact-iso` 依赖并执行安装

更新 `frontend/package.json` 并执行安装指令引入 `preact-iso`。

~~~~~act
patch_file
frontend/package.json
~~~~~
~~~~~json
    "marked": "^18.0.14",
    "preact": "^10.25.4",
    "tailwind-merge": "^2.5.5"
  },
~~~~~
~~~~~json
    "marked": "^18.0.14",
    "preact": "^10.25.4",
    "preact-iso": "^2.9.1",
    "tailwind-merge": "^2.5.5"
  },
~~~~~

#### Acts 2: 创建全景大盘路由页面 (`routes/OverviewRoute.tsx`)

承接指标大盘，当数据处于加载期时呈现骨架占位，数据就绪后渲染 `OverviewDashboard`。

~~~~~act
write_file
frontend/src/routes/OverviewRoute.tsx
~~~~~
~~~~~typescript
import { OverviewDashboard } from '../components/OverviewDashboard';
import {
  TIME_RANGE_OPTIONS,
  metricsLoadingSignal,
  metricsSignal,
  timeRangeSignal,
} from '../state/metrics';

export function OverviewRoute() {
  const metrics = metricsSignal.value;
  const isLoading = metricsLoadingSignal.value;
  const currentRange = timeRangeSignal.value;
  const activeRangeLabel = TIME_RANGE_OPTIONS.find((o) => o.key === currentRange)?.label || '全部';

  if (isLoading && !metrics) {
    return (
      <div className="py-24 text-center text-zinc-500 text-sm animate-pulse">
        正在从本地 SQLite 数据库聚合全景认知审计指标...
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="py-24 text-center text-zinc-500 text-sm">
        未检索到符合当前时间切片的统计指标
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto w-full p-4 md:p-6 overflow-y-auto">
      <OverviewDashboard metrics={metrics} activeRangeLabel={activeRangeLabel} />
    </div>
  );
}
~~~~~

#### Acts 3: 创建会话工作台路由页面 (`routes/SessionsRoute.tsx`)

处理 `/sessions` 与 `/sessions/:id`，支持根据路由参数自动高亮选中项、双栏/全屏响应式布局以及 URL 双向绑定。

~~~~~act
write_file
frontend/src/routes/SessionsRoute.tsx
~~~~~
~~~~~typescript
import { useLocation, useRoute } from 'preact-iso';
import { useMemo } from 'preact/hooks';
import { SessionDetailPanel } from '../components/SessionDetailPanel';
import { VirtualSessionList } from '../components/VirtualSessionList';
import type { SessionItem } from '../types/metrics';
import {
  sessionsLoadingSignal,
  sessionsSignal,
  sidebarCollapsedSignal,
} from '../state/session';

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
            <div className="text-4xl mb-3">💬</div>
            <h3 className="text-base font-semibold text-zinc-300">会话工作台已就绪</h3>
            <p className="text-xs text-zinc-500 mt-1 max-w-sm leading-relaxed">
              请在左侧列表中选择任意会话，查看包含完整 Markdown 呈现、内联附件、思考链与分支追踪的详细对话流。
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
~~~~~

#### Acts 4: 创建 404 兜底路由 (`routes/NotFoundRoute.tsx`)

为非法或过期的 URL 路径提供优雅的友好提示与导航跳回。

~~~~~act
write_file
frontend/src/routes/NotFoundRoute.tsx
~~~~~
~~~~~typescript
import { useLocation } from 'preact-iso';

export function NotFoundRoute() {
  const { route } = useLocation();

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-16 text-center">
      <div className="text-5xl mb-4">🔍</div>
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

#### Acts 5: 重构主应用入口 (`app.tsx`) 集成路由与导航栏

使用 `LocationProvider` 与 `Router` 装配整个前端体系，并加入视图 Tab。

~~~~~act
write_file
frontend/src/app.tsx
~~~~~
~~~~~typescript
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
import {
  fetchSessions,
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
            className="p-1.5 text-zinc-400 hover:text-zinc-200 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded transition text-xs"
            title={isSidebarCollapsed ? '展开会话历史侧边栏' : '收起会话历史侧边栏'}
          >
            {isSidebarCollapsed ? '📂 展开' : '◀ 收起'}
          </button>
        )}
        <button
          type="button"
          className="text-2xl cursor-pointer bg-transparent border-none p-0 leading-none"
          onClick={() => route('/')}
          title="回到概览看板"
        >
          🧠
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
            className={`px-3 py-1 rounded-md font-medium transition ${
              path === '/'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
          >
            📊 全景大盘
          </button>
          <button
            type="button"
            onClick={() => route('/sessions')}
            className={`px-3 py-1 rounded-md font-medium transition ${
              isSessionsView
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
          >
            💬 会话工作台
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

### 下一步建议

Phase 2 已经将页面级路由骨架搭建完毕，支持多视图切换与原生 URL 会话持久化。后续建议：
1. **代码检查与构建验证**: 执行 `cd frontend && npm run check`（包含 Biome 代码校验与 TypeScript 类型检查）确认无任何类型与语法警告；
2. **进入 Phase 3 (会话多维复合筛选)**: 针对笔记《查看不同模型轮次深度的会话明细.md》的要求，在 `SessionsRoute` 中为虚拟列表上方增加「模型多选筛选器」与「轮次深度分段按钮（单轮快问 / 多轮攻坚 / 分叉重试）」；
3. 验证功能正常后，可提交对应的 Git 变更记录。
