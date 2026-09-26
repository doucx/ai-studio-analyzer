好的，我已经完成了针对顶部导航栏精简与版本信息迁移的计划。通过移除左上角冗余的 Brain 图标及主标题，可以直接为多标签切换及右侧操作栏释放更多水平视口空间；同时将版本号徽章迁移至“系统与控制中心”标题旁，更加契合其元信息属性。

## [WIP] refactor(frontend): 精简顶部导航栏并迁移版本号徽章至系统设置

### 用户需求

1. 移除全局头部 `HeaderBar` 左上角的 Brain 图标按钮以及应用标题/版本号区块。
2. 将版本标识（`v0.2 Workstation`）迁移至系统设置页面（`SettingsRoute`）中呈现。

### 评论

原左上角的 Brain 按钮与“全景大盘” Tab 功能重叠，而固定标题在小屏或窄屏下会挤压导航 Tab 与同步状态栏的展示空间。去除冗余元素后能够大幅提升 HeaderBar 的信息密度与紧凑度；将版本号置于系统设置页属于标准的控制台设计范式。

### 目标

1. 在 `frontend/src/app.tsx` 中移除 Brain 图标按钮及标题容器，清理未引用的 `Brain` 图标导入，并移除 `<nav>` 多余的左侧外边距。
2. 在 `frontend/src/routes/SettingsRoute.tsx` 的头部标题右侧嵌入版本号徽章。

### 基本原理

通过纯前端组件结构微调完成布局优化：
- 清理 `HeaderBar` 左侧冗余的 DOM 节点，使导航菜单能够直接在侧边栏折叠按钮之后紧凑排布。
- 利用 Biome/TypeScript 检查要求，移除未引用的 `Brain` 图标组件以避免编译或 Lint 警告。
- 在 `SettingsRoute` 的 `h1` 标题旁内嵌原有样式的微型徽章，既保留版本提示，又不抢占核心工作台空间。

### 标签

#intent/refine #flow/ready #priority/medium #comp/cli #concept/ui #scope/ux #ai/instruct #task/domain/ui #task/object/header-bar #task/action/refactor #task/state/continue #task/status/active

---

### Script

#### Acts 1: 精简 `HeaderBar` 布局并清理未使用的图标

~~~~~act
patch_file
frontend/src/app.tsx
~~~~~
~~~~~typescript.old
import {
  Brain,
  LayoutDashboard,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings as SettingsIcon,
} from 'lucide-preact';
~~~~~
~~~~~typescript.new
import {
  LayoutDashboard,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings as SettingsIcon,
} from 'lucide-preact';
~~~~~

~~~~~act
patch_file
frontend/src/app.tsx
~~~~~
~~~~~typescript.old
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
~~~~~
~~~~~typescript.new
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
~~~~~

#### Acts 2: 将版本号徽章添加到系统设置页标题

~~~~~act
patch_file
frontend/src/routes/SettingsRoute.tsx
~~~~~
~~~~~typescript.old
      {/* 头部标题与保存指示条 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Sliders size={20} className="text-indigo-400" />
            <span>系统与控制中心</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
~~~~~
~~~~~typescript.new
      {/* 头部标题与保存指示条 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Sliders size={20} className="text-indigo-400" />
            <span>系统与控制中心</span>
            <span className="text-[10px] font-mono uppercase bg-indigo-950/80 text-indigo-400 border border-indigo-800/60 px-1.5 py-0.5 rounded font-normal">
              v0.2 Workstation
            </span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
~~~~~

### 下一步建议

1. 在前端开发服务器或构建中测试查看顶部栏渲染效果（可在 `frontend` 目录运行 `npm run check` 验证类型与规范）。
2. 确认界面交互满意后，若无需其他样式微调，可生成 `[COMMIT]` 计划将此次 UI 精简提交至版本控制。
