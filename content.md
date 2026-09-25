明白了，针对您指出的这三个细节，我将统一进行修正：
1. 去除 `SessionDetailPanel` 内部重复的收起侧栏按钮，仅保留顶部导航最左上角的收起/展开按钮；
2. 在全局 CSS 中声明 `color-scheme: dark` 并统一注入暗色系滚动条样式，彻底告别浏览器默认的亮白底色滚动条；
3. 移除多余的占位说明文案 “已挂载 Markdown 富文本只读视图”。

## [WIP] fix: 清理冗余侧栏控件与提示文本并统一暗色模式滚动条

### 错误分析
1. **重复按钮交互混乱**：在全局导航栏已有侧栏折叠按钮的情况下，`SessionDetailPanel` 头部又注入了独立的收起按钮，导致视觉元素重复且职权不清晰。
2. **滚动条原生浅色溢出**：Webkit 及现代浏览器在 Windows/Linux 或未强制覆盖的情况下，若未在 `:root` / `body` 声明 `color-scheme: dark` 和 `::-webkit-scrollbar` / `scrollbar-color`，长列表容器在暗色背景下会呈现出刺眼的白色/浅灰底原生滚动条，严重破坏沉浸感。
3. **冗余阶段性文本遗留**：`SessionDetailPanel` 内部先前留作状态提示的 `<span>已挂载 Markdown 富文本只读视图</span>` 已完成历史使命，继续留存显得冗余。

### 用户需求
1. 移除 `SessionDetailPanel` 内重复的侧栏收起按钮，仅保留全局最左上角的收起控件。
2. 页面与容器的滚动条统一改为深色/透明轨道的暗色样式。
3. 彻底删除 “已挂载 Markdown 富文本只读视图” 提示文本。

### 评论
这些细节打磨非常关键，消除了界面交互中的重复冗余并补全了完整的暗色视觉闭环，使整个工作台的质感从“原型拼接”提升为“成熟的产品级只读终端”。

### 目标
1. 在 `frontend/src/index.css` 中注入 `:root { color-scheme: dark; }` 并定义极简的深色滚动条样式。
2. 修改 `frontend/src/components/SessionDetailPanel.tsx`，移除头部多余按钮与轮次流右上角占位提示。
3. 同步清理 `frontend/src/app.tsx` 中向 `SessionDetailPanel` 传递的不再需要的 props。

### 基本原理
- **`color-scheme: dark` 与滚动条系统**: 现代浏览器（Chrome、Edge、Safari、Firefox）通过该标准属性会自动将表单控件、默认滚动条背景与系统主题对齐；搭配 `scrollbar-width: thin` 和 `::-webkit-scrollbar` 能够实现像素级的优雅暗色细条滚动体验。
- **界面去冗**: 遵循单一职责，折叠侧栏属于整体布局层级的功能，理应由顶部 App 布局统一控制。

### 标签
#intent/fix #flow/ready #priority/medium #comp/interfaces #concept/ui #scope/ux #ai/instruct #task/domain/ui #task/object/session-detail-view #task/action/bug-fix #task/state/continue

---

### Script

#### Acts 1: 全局注入暗色滚动条样式规范

我们在 `frontend/src/index.css` 顶部添加 `color-scheme: dark` 与自定义细窄暗色滑块样式。

~~~~~act
patch_file
frontend/src/index.css
~~~~~
~~~~~css.old
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  min-height: 100vh;
  font-feature-settings: "cv02", "cv03", "cv04", "cv11";
}
~~~~~
~~~~~css.new
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: dark;
}

/* 全局优雅暗色滚动条 */
* {
  scrollbar-width: thin;
  scrollbar-color: #3f3f46 transparent;
}

::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background-color: #3f3f46;
  border-radius: 9999px;
}

::-webkit-scrollbar-thumb:hover {
  background-color: #52525b;
}

body {
  margin: 0;
  min-height: 100vh;
  background-color: #09090b;
  font-feature-settings: "cv02", "cv03", "cv04", "cv11";
}
~~~~~

#### Acts 2: 清理 `SessionDetailPanel.tsx` 中的重复按钮与多余文案

移除头部多余的展开/收起按钮，并清除 `已挂载 Markdown 富文本只读视图` 提示文本。

~~~~~act
patch_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~typescript.old
interface Props {
  session: SessionItem;
  onClose: () => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}
~~~~~
~~~~~typescript.new
interface Props {
  session: SessionItem;
  onClose: () => void;
}
~~~~~

~~~~~act
patch_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~typescript.old
export function SessionDetailPanel({
  session,
  onClose,
  isSidebarCollapsed = false,
  onToggleSidebar,
}: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [showMetadata, setShowMetadata] = useState<boolean>(true);

  const aiStudioUrl = `https://aistudio.google.com/prompts/${session.file_id}`;

  useEffect(() => {
    setLoading(true);
    fetch(`/api/sessions/${session.file_id}`)
      .then((res) => res.json())
      .then((data) => {
        setDetail(data);
      })
      .catch((err) => {
        console.error('获取会话详情失败:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [session.file_id]);

  return (
    <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg flex flex-col h-full min-h-[calc(100vh-140px)]">
      {/* 头部导航与操作条 */}
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-3.5 bg-zinc-900/90 backdrop-blur sticky top-0 z-10 rounded-t-lg">
        <div className="flex items-center gap-3 min-w-0">
          {onToggleSidebar && (
            <button
              type="button"
              onClick={onToggleSidebar}
              className="p-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded border border-zinc-700/80 transition flex items-center justify-center shrink-0"
              title={isSidebarCollapsed ? '展开历史侧边栏' : '收起历史侧边栏以全屏浏览'}
            >
              {isSidebarCollapsed ? '📂 展开侧栏' : '◀ 收起侧栏'}
            </button>
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white tracking-tight truncate max-w-md">
                {session.name}
              </h2>
              {session.has_branching && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-400 border border-amber-800/60 font-mono shrink-0">
                  分叉 {session.branch_count} 次
                </span>
              )}
            </div>
            <p className="text-[11px] text-zinc-400 font-mono truncate">
              ID: {session.file_id} · 模型: {session.model.replace('models/', '')}
            </p>
          </div>
        </div>
~~~~~
~~~~~typescript.new
export function SessionDetailPanel({ session, onClose }: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [showMetadata, setShowMetadata] = useState<boolean>(true);

  const aiStudioUrl = `https://aistudio.google.com/prompts/${session.file_id}`;

  useEffect(() => {
    setLoading(true);
    fetch(`/api/sessions/${session.file_id}`)
      .then((res) => res.json())
      .then((data) => {
        setDetail(data);
      })
      .catch((err) => {
        console.error('获取会话详情失败:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [session.file_id]);

  return (
    <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg flex flex-col h-full min-h-[calc(100vh-140px)]">
      {/* 头部导航与操作条 */}
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-3.5 bg-zinc-900/90 backdrop-blur sticky top-0 z-10 rounded-t-lg">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-white tracking-tight truncate max-w-md">
              {session.name}
            </h2>
            {session.has_branching && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-400 border border-amber-800/60 font-mono shrink-0">
                分叉 {session.branch_count} 次
              </span>
            )}
          </div>
          <p className="text-[11px] text-zinc-400 font-mono truncate">
            ID: {session.file_id} · 模型: {session.model.replace('models/', '')}
          </p>
        </div>
~~~~~

~~~~~act
patch_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~typescript.old
      {/* 全屏只读交互轮次流 */}
      <div className="flex-1 flex flex-col p-4 sm:p-6 overflow-hidden">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
              <span>💬</span> 交互轮次流
            </h3>
            <span className="text-xs font-mono text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded">
              {detail?.turns?.length ?? session.turn_count} 个 Chunks
            </span>
          </div>
          <span className="text-xs text-zinc-500 hidden sm:inline">
            已挂载 Markdown 富文本只读视图
          </span>
        </div>
~~~~~
~~~~~typescript.new
      {/* 全屏只读交互轮次流 */}
      <div className="flex-1 flex flex-col p-4 sm:p-6 overflow-hidden">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
              <span>💬</span> 交互轮次流
            </h3>
            <span className="text-xs font-mono text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded">
              {detail?.turns?.length ?? session.turn_count} 个 Chunks
            </span>
          </div>
        </div>
~~~~~

#### Acts 3: 在 `app.tsx` 中移除传给 `SessionDetailPanel` 的冗余参数

~~~~~act
patch_file
frontend/src/app.tsx
~~~~~
~~~~~typescript.old
          {!loadingSignal.value && selectedSession && (
            <SessionDetailPanel
              session={selectedSession}
              onClose={() => (selectedSessionSignal.value = null)}
              isSidebarCollapsed={isSidebarCollapsed}
              onToggleSidebar={() => (sidebarCollapsedSignal.value = !sidebarCollapsedSignal.value)}
            />
          )}
~~~~~
~~~~~typescript.new
          {!loadingSignal.value && selectedSession && (
            <SessionDetailPanel
              session={selectedSession}
              onClose={() => (selectedSessionSignal.value = null)}
            />
          )}
~~~~~

---

### 下一步建议
1. **本地预览**: 请刷新或重新打开浏览器页面，查看滚动条是否已变为深色细条，以及右上角/头部按钮是否已整理干净。
2. **代码检查**: 在 `frontend` 目录下运行 `npm run check`，确认无类型或 linter 报错。
