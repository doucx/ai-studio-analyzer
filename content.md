好的，我将开始进行代码重构与升级。我不会运行任何 npm 安装指令，所有第三方包的安装将由您自行执行。

## [WIP] feat: 重构交互轮次流并支持 Markdown 渲染与侧边栏折叠

### 用户需求
1. 移除 `SessionDetailPanel` 中冗余的「💬 首轮 Prompt 提问全文」卡片。
2. 放大「交互轮次流」，去除高度和截断限制，让其充满整个视口，营造原生 AI 对话工作台的沉浸式只读体验。
3. 引入外部成熟的 Markdown 渲染器（`marked`），优雅渲染代码块、列表、表格与段落。
4. 在每个轮次 Chunk 的右上角增加一键复制按钮与即时反馈。
5. 支持自由收起与展开「会话历史」侧边栏，折叠后会话工作台横向铺满全屏。

### 评论
将原本局促的小列表预览重构为全屏自适应的沉浸式对话流，是构建个人认知审计工作台的关键一步。去除冗余的首轮卡片并引入 Markdown 渲染后，会话记录不仅能进行元数据审计，更能作为高质量的离线知识库直接阅读与复盘。

### 目标
1. 在 `frontend/src/index.css` 中增加精细化的暗色系 `.prose-chat` Markdown 样式定义。
2. 重构 `frontend/src/components/SessionDetailPanel.tsx`：
   - 移除首轮提问卡片。
   - 引入 `marked` 渲染 `turn.text` 为富文本。
   - 为每个轮次增加带状态反馈（1.5s）的复制按钮。
   - 优化布局结构为 Flex 列自适应撑满，使轮次流独占主要视口区域。
3. 修改 `frontend/src/app.tsx`：
   - 增加侧边栏折叠状态响应控制。
   - 在顶部添加侧边栏收起/展开控制按钮，并在侧边栏折叠后让主工作区横向 100% 铺满。

### 基本原理
- **Markdown 渲染**: 选用极度轻量、性能极高且无框架侵入的 `marked`，在前端将对话文本解析为符合排版标准的 HTML，并通过 Preact 的 `dangerouslySetInnerHTML` 渲染。
- **纯 CSS 增强**: 在 `index.css` 中为 `.prose-chat` 下的 `pre`, `code`, `table`, `blockquote` 等标签提供深色模式的主题定制，无需额外加载重量级排版包。
- **状态流控制**: 通过 Preact Signals 管理全局侧边栏折叠状态，切换平滑无多余重渲染。

### 标签
#intent/build #flow/ready #priority/high #comp/interfaces #concept/ui #scope/ux #ai/instruct #task/domain/ui #task/object/session-detail-view #task/action/refactor #task/state/begin

---

### Script

#### Acts 1: 在样式表中补充 Markdown 渲染排版样式

我们在 `frontend/src/index.css` 中加入 `.prose-chat` 类，以支持模型输出的代码、引用、表格等元素的深色模式排版。

~~~~~act
write_file
frontend/src/index.css
~~~~~
~~~~~css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  min-height: 100vh;
  font-feature-settings: "cv02", "cv03", "cv04", "cv11";
}

/* 沉浸式只读对话流 Markdown 排版规范 */
.prose-chat {
  color: #d4d4d8;
  font-size: 0.875rem;
  line-height: 1.625;
  word-break: break-word;
}

.prose-chat p {
  margin-top: 0.5rem;
  margin-bottom: 0.5rem;
}

.prose-chat p:first-child {
  margin-top: 0;
}

.prose-chat p:last-child {
  margin-bottom: 0;
}

.prose-chat h1,
.prose-chat h2,
.prose-chat h3,
.prose-chat h4 {
  color: #f4f4f5;
  font-weight: 600;
  margin-top: 1rem;
  margin-bottom: 0.5rem;
}

.prose-chat h1 { font-size: 1.25rem; }
.prose-chat h2 { font-size: 1.125rem; }
.prose-chat h3 { font-size: 1rem; }

.prose-chat ul,
.prose-chat ol {
  margin-top: 0.5rem;
  margin-bottom: 0.5rem;
  padding-left: 1.25rem;
}

.prose-chat ul { list-style-type: disc; }
.prose-chat ol { list-style-type: decimal; }

.prose-chat li {
  margin-top: 0.25rem;
  margin-bottom: 0.25rem;
}

.prose-chat blockquote {
  border-left: 3px solid #6366f1;
  padding-left: 0.75rem;
  color: #a1a1aa;
  font-style: italic;
  margin: 0.75rem 0;
}

.prose-chat code:not(pre code) {
  background-color: rgba(39, 39, 42, 0.8);
  border: 1px solid rgba(63, 63, 70, 0.4);
  padding: 0.15rem 0.35rem;
  border-radius: 0.25rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.8125rem;
  color: #e4e4e7;
}

.prose-chat pre {
  background-color: #09090b !important;
  border: 1px solid #27272a;
  border-radius: 0.5rem;
  padding: 0.75rem 1rem;
  overflow-x: auto;
  margin: 0.75rem 0;
}

.prose-chat pre code {
  background: transparent;
  padding: 0;
  border: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.8125rem;
  color: #f4f4f5;
  line-height: 1.5;
}

.prose-chat table {
  width: 100%;
  border-collapse: collapse;
  margin: 0.75rem 0;
  font-size: 0.8125rem;
}

.prose-chat th,
.prose-chat td {
  border: 1px solid #27272a;
  padding: 0.4rem 0.6rem;
  text-align: left;
}

.prose-chat th {
  background-color: #18181b;
  color: #e4e4e7;
  font-weight: 600;
}

.prose-chat hr {
  border: 0;
  border-top: 1px solid #27272a;
  margin: 1rem 0;
}
~~~~~

#### Acts 2: 彻底重构 `SessionDetailPanel.tsx`

我们将移除原有的独立首轮提问卡片，引入 `marked`，在每个 Chunk 右上角添加复制按钮，并将交互轮次流放大撑满垂直区域。

~~~~~act
write_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~tsx
import { marked } from 'marked';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ConversationTurnItem, SessionDetail, SessionItem } from '../types/metrics';

marked.setOptions({
  breaks: true,
  gfm: true,
});

interface Props {
  session: SessionItem;
  onClose: () => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('复制失败:', err);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`px-2 py-1 text-[11px] rounded transition flex items-center gap-1 border ${
        copied
          ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
          : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 border-zinc-700/60'
      }`}
      title="复制本轮纯文本内容"
    >
      {copied ? (
        <>
          <span>✓</span>
          <span>已复制</span>
        </>
      ) : (
        <>
          <span>📋</span>
          <span>复制</span>
        </>
      )}
    </button>
  );
}

function TurnMessage({ turn, index }: { turn: ConversationTurnItem; index: number }) {
  const [isThinkingOpen, setIsThinkingOpen] = useState(false);

  const htmlContent = useMemo(() => {
    try {
      return marked.parse(turn.text || '');
    } catch {
      return turn.text;
    }
  }, [turn.text]);

  const isUser = turn.role === 'user';
  const isThought = turn.is_thought;

  if (isThought) {
    return (
      <div className="rounded-lg border border-emerald-900/30 bg-emerald-950/15 overflow-hidden">
        <div className="px-3.5 py-2 flex items-center justify-between bg-emerald-950/30 border-b border-emerald-900/20 text-xs text-emerald-400 font-mono">
          <div
            className="flex items-center gap-2 cursor-pointer select-none hover:text-emerald-300 transition"
            onClick={() => setIsThinkingOpen(!isThinkingOpen)}
          >
            <span>{isThinkingOpen ? '▼' : '▶'}</span>
            <span className="font-semibold flex items-center gap-1">
              <span>🧠</span> 思考链 (Thinking Process)
            </span>
            <span className="text-[10px] text-emerald-500/80">
              {turn.token_count > 0 ? `${turn.token_count.toLocaleString()} tokens` : ''}
            </span>
          </div>
          <CopyButton text={turn.text} />
        </div>
        {isThinkingOpen ? (
          <div className="p-4 text-xs text-emerald-300/90 font-mono whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto bg-black/20">
            {turn.text}
          </div>
        ) : (
          <div
            className="px-4 py-2 text-xs text-emerald-400/60 font-mono truncate cursor-pointer hover:bg-emerald-900/10"
            onClick={() => setIsThinkingOpen(true)}
          >
            {turn.text.slice(0, 140)}...
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border transition shadow-sm ${
        isUser
          ? 'bg-zinc-900/90 border-indigo-900/40 pl-1 border-l-4 border-l-indigo-500'
          : 'bg-zinc-900/50 border-zinc-800'
      }`}
    >
      {/* 消息 Chunk 头部元数据栏 */}
      <div className="px-4 py-2.5 flex items-center justify-between border-b border-zinc-800/60 text-xs">
        <div className="flex items-center gap-2">
          <span
            className={`font-semibold uppercase text-[11px] px-2 py-0.5 rounded font-mono ${
              isUser
                ? 'bg-indigo-950 text-indigo-300 border border-indigo-800/60'
                : 'bg-zinc-800 text-zinc-300 border border-zinc-700/60'
            }`}
          >
            {isUser ? '👤 User' : '🤖 Model'}
          </span>
          <span className="text-zinc-500 text-[11px] font-mono">#{index + 1}</span>
          {turn.token_count > 0 && (
            <span className="text-[11px] text-zinc-500 font-mono">
              {turn.token_count.toLocaleString()} tokens
            </span>
          )}
          {turn.is_edited && (
            <span className="text-[10px] text-amber-400 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/40">
              已编辑重试
            </span>
          )}
        </div>

        <CopyButton text={turn.text} />
      </div>

      {/* 消息正文：由外部 Markdown 渲染器全屏呈现 */}
      <div className="p-4 sm:p-5">
        <div
          className="prose-chat max-w-none"
          dangerouslySetInnerHTML={{ __html: htmlContent as string }}
        />
      </div>
    </div>
  );
}

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

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowMetadata(!showMetadata)}
            className="px-2.5 py-1 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded border border-zinc-700/80 transition"
            title="切换元数据卡片可见性"
          >
            {showMetadata ? '隐藏统计' : '显示统计'}
          </button>
          <a
            href={aiStudioUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded transition shadow-sm flex items-center gap-1.5"
            title="在 Google AI Studio 原生工作台打开"
          >
            <span>🚀</span>
            <span className="hidden sm:inline">在 AI Studio 打开</span>
          </a>
          <button
            type="button"
            onClick={onClose}
            className="px-2.5 py-1 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded transition border border-zinc-700/80"
          >
            ✕ 关闭
          </button>
        </div>
      </div>

      {/* 可选紧凑指标卡片（支持折叠） */}
      {showMetadata && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 border-b border-zinc-800/80 bg-zinc-950/40">
          <div className="bg-zinc-900/80 border border-zinc-800/60 rounded p-2.5">
            <div className="text-[10px] text-zinc-400">生命周期时长</div>
            <div className="text-base font-bold text-indigo-400 font-mono mt-0.5">
              {session.duration_human}
            </div>
            <div className="text-[10px] text-zinc-500">{session.duration_seconds} 秒</div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800/60 rounded p-2.5">
            <div className="text-[10px] text-zinc-400">总 Token 消耗</div>
            <div className="text-base font-bold text-emerald-400 font-mono mt-0.5">
              {session.total_tokens.toLocaleString()}
            </div>
            <div className="text-[10px] text-zinc-500">
              思考链: {session.thought_tokens.toLocaleString()}
            </div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800/60 rounded p-2.5">
            <div className="text-[10px] text-zinc-400">有效交互轮次</div>
            <div className="text-base font-bold text-white font-mono mt-0.5">
              {session.turn_count} 轮
            </div>
            <div className="text-[10px] text-zinc-500">
              {session.turn_count >= 5 ? '深度多轮' : '轻量快问'}
            </div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800/60 rounded p-2.5">
            <div className="text-[10px] text-zinc-400">最后修改时间</div>
            <div className="text-xs font-medium text-zinc-300 font-mono mt-1 truncate">
              {session.modified_time ? session.modified_time.replace('T', ' ').slice(0, 16) : '未知'}
            </div>
            <div className="text-[10px] text-zinc-500 truncate">
              创建: {session.created_time ? session.created_time.slice(0, 10) : '未知'}
            </div>
          </div>
        </div>
      )}

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

        {loading ? (
          <div className="py-24 text-center text-xs text-zinc-500 animate-pulse">
            正在从本地 SQLite 加载完整对话轮次...
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {detail?.turns && detail.turns.length > 0 ? (
              detail.turns.map((turn, idx) => <TurnMessage key={idx} turn={turn} index={idx} />)
            ) : (
              <div className="py-16 text-center text-zinc-500 text-xs">
                暂无对话内容或数据未同步
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
~~~~~

#### Acts 3: 在 `app.tsx` 中集成侧边栏收起控制与全屏主视口自适应

我们引入 `isSidebarCollapsed` 状态，并为侧边栏提供展开/收起切换逻辑，使主视口在收起时能够自适应横向撑满整屏。

~~~~~act
patch_file
frontend/src/app.tsx
~~~~~
~~~~~typescript.old
const selectedSessionSignal = signal<SessionItem | null>(null);
const loadingSignal = signal<boolean>(true);
const syncInProgressSignal = signal<boolean>(false);
~~~~~
~~~~~typescript.new
const selectedSessionSignal = signal<SessionItem | null>(null);
const loadingSignal = signal<boolean>(true);
const syncInProgressSignal = signal<boolean>(false);
const sidebarCollapsedSignal = signal<boolean>(false);
~~~~~

~~~~~act
patch_file
frontend/src/app.tsx
~~~~~
~~~~~typescript.old
  const activeRangeLabel = TIME_RANGE_OPTIONS.find((o) => o.key === currentRange)?.label || '全部';
  const selectedSession = selectedSessionSignal.value;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans">
      {/* 顶部全局控制栏 */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <span className="text-2xl cursor-pointer" onClick={() => (selectedSessionSignal.value = null)}>
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

      {/* 工作台主视口：Master-Detail 布局 */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden p-4 md:p-6 gap-6 max-w-7xl w-full mx-auto">
        {/* 左侧栏：5000+ 虚拟列表会话查看器 (固定宽 360px ~ 380px) */}
        <aside className="w-full lg:w-[380px] h-[520px] lg:h-[calc(100vh-120px)] flex-shrink-0">
          <VirtualSessionList
            sessions={sessions}
            selectedId={selectedSession?.file_id ?? null}
            onSelect={(s) => (selectedSessionSignal.value = s)}
          />
        </aside>

        {/* 右侧主视口：全景审计图表 或 单会话沉浸详情 */}
        <main className="flex-1 overflow-y-auto lg:h-[calc(100vh-120px)] pr-1 space-y-6">
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
~~~~~
~~~~~typescript.new
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
          <span className="text-2xl cursor-pointer" onClick={() => (selectedSessionSignal.value = null)}>
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
              isSidebarCollapsed={isSidebarCollapsed}
              onToggleSidebar={() => (sidebarCollapsedSignal.value = !sidebarCollapsedSignal.value)}
            />
          )}
~~~~~

### 下一步建议

由于我们在前端代码中引入了 `marked` 作为 Markdown 渲染器，并且遵循了您的要求未自动执行任何 npm 命令：

1. **安装依赖包**：
   请在终端进入 `frontend` 目录并安装 `marked`（以及可选的类型定义）：
   ```bash
   cd frontend
   npm install marked
   npm install -D @types/marked
   ```

2. **验证构建与格式化**：
   安装完成后，您可以运行：
   ```bash
   npm run check
   npm run build
   ```
   启动开发服务器 `npm run dev` 即可立即体验全屏沉浸式的 AI 对话只读工作台。如确认无误，我们可以进行 Git 提交。
