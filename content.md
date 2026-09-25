我已为你设计好系统提示词（System Instruction）的展示方案。

在会话详情面板（`SessionDetailPanel`）中，系统提示词是决定整场会话行为与上下文基调的最高前置规则。最合适的位置是将其置于「交互轮次流」正文的最上方（首轮提问之前），作为专属的系统层卡片：
1. **视觉层次明确**：采用区别于普通用户对话与模型回复的暗紫色微光调色板（`purple-950/20`），配备 `Sliders` 图标和字符数统计标签；
2. **纯文本与排版安全**：严格遵循要求，不使用 Markdown 解析，直接采用 `font-mono`、`whitespace-pre-wrap` 与 `select-text` 保持原始文本的换行、缩进及字符完整性；
3. **支持折叠与一键复制**：默认展开以便即时审查上下文，提供折叠控制与 `CopyButton` 便于快速复用。

以下是具体的变更计划：

## [WIP] feat: 在会话详情面板中支持系统提示词的纯文本展示

### 用户需求
在会话详情面板中展示 Google AI Studio 对话的系统提示词（System Instruction）。要求放置在合适显眼的位置，且系统提示词不需要经过 Markdown 渲染，直接以纯文本形式展示。

### 评论
当前后端 `/api/sessions/{file_id}` 接口及前端 `SessionDetail` 类型均已完整携带 `system_instruction` 数据，但前端面板之前仅循环渲染了 `turns` 消息列表。补充系统提示词卡片后，能还原 Google AI Studio 原生工程化对话的完整上下文闭环，极大方便了 Prompt 工程师排查人设协议与调优参数。

### 目标
1. 在 `frontend/src/components/SessionDetailPanel.tsx` 中新增 `SystemInstructionCard` 组件。
2. 以等宽纯文本（`font-mono`、`whitespace-pre-wrap`）渲染系统提示词，不经过 Markdown 解析。
3. 提供折叠/展开与内容复制功能。
4. 在交互轮次流顶部条件渲染该卡片（仅当存在非空系统指令时显示）。

### 基本原理
将系统提示词作为会话交互流的“第 0 轮全局设定”，置于所有 `turns` 轮次组件前跟随滚动视口呈现。使用只读容器包裹，通过 `max-h-80 overflow-y-auto` 避免长提示词过度挤压下方的对话区，同时满足开箱即看与不触发 Markdown 潜在格式误解析的要求。

### 标签
#intent/build #flow/ready #priority/medium #comp/ui #concept/ui #scope/ux #ai/instruct #task/domain/ui #task/object/system-instruction-viewer #task/action/implementation #task/state/begin

---

### Script

#### Acts 1: 在 `SessionDetailPanel.tsx` 中集成系统提示词展示卡片

我们将引入 `Sliders` 图标，新增 `SystemInstructionCard` 纯文本展示组件，并在交互轮次流的最上方渲染它。

~~~~~act
patch_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~typescript.old
  MessagesSquare,
  Paperclip,
  User,
  X,
} from 'lucide-preact';
~~~~~
~~~~~typescript.new
  MessagesSquare,
  Paperclip,
  Sliders,
  User,
  X,
} from 'lucide-preact';
~~~~~

~~~~~act
patch_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~typescript.old
function DownloadButton({ text, filename }: { text: string; filename: string }) {
  const handleDownload = () => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      className="px-2 py-1 text-[11px] rounded transition flex items-center gap-1 border bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 border-zinc-700/60 cursor-pointer"
      title="下载文件附件"
    >
      <Download size={12} />
      <span>下载</span>
    </button>
  );
}

function TurnMessage({ turn, index }: { turn: ConversationTurnItem; index: number }) {
~~~~~
~~~~~typescript.new
function DownloadButton({ text, filename }: { text: string; filename: string }) {
  const handleDownload = () => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      className="px-2 py-1 text-[11px] rounded transition flex items-center gap-1 border bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 border-zinc-700/60 cursor-pointer"
      title="下载文件附件"
    >
      <Download size={12} />
      <span>下载</span>
    </button>
  );
}

function SystemInstructionCard({ instruction }: { instruction: string }) {
  const [isOpen, setIsOpen] = useState(true);

  if (!instruction || !instruction.trim()) return null;

  return (
    <div className="rounded-lg border border-purple-900/40 bg-purple-950/20 overflow-hidden shadow-sm">
      <div className="px-3.5 py-2.5 flex items-center justify-between bg-purple-950/40 border-b border-purple-900/30 text-xs">
        <button
          type="button"
          className="flex items-center gap-2 cursor-pointer select-none hover:text-purple-300 transition bg-transparent border-none p-0 text-purple-400 font-mono"
          onClick={() => setIsOpen(!isOpen)}
        >
          {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span className="font-semibold flex items-center gap-1.5">
            <Sliders size={13} />
            <span>系统提示词 (System Instruction)</span>
          </span>
          <span className="text-[10px] text-purple-400/80 bg-purple-900/40 px-1.5 py-0.5 rounded border border-purple-800/50">
            {instruction.length.toLocaleString()} 字符
          </span>
        </button>
        <CopyButton text={instruction} />
      </div>

      {isOpen ? (
        <div className="p-4 text-xs text-purple-100/90 font-mono whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto bg-black/40 border-t border-purple-900/20 select-text">
          {instruction}
        </div>
      ) : (
        <button
          type="button"
          className="w-full text-left px-4 py-2 text-xs text-purple-400/60 font-mono truncate cursor-pointer hover:bg-purple-950/30 bg-transparent border-none"
          onClick={() => setIsOpen(true)}
        >
          {instruction.slice(0, 140)}...
        </button>
      )}
    </div>
  );
}

function TurnMessage({ turn, index }: { turn: ConversationTurnItem; index: number }) {
~~~~~

~~~~~act
patch_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~typescript.old
        {loading ? (
          <div className="py-24 text-center text-xs text-zinc-500 animate-pulse">
            正在从本地 SQLite 加载完整对话轮次...
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {detail?.turns && detail.turns.length > 0 ? (
              detail.turns.map((turn, idx) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 对话轮次流按时间严格保序，无需进行动态重排
                <TurnMessage key={`turn-${idx}`} turn={turn} index={idx} />
              ))
            ) : (
              <div className="py-16 text-center text-zinc-500 text-xs">
                暂无对话内容或数据未同步
              </div>
            )}
          </div>
        )}
~~~~~
~~~~~typescript.new
        {loading ? (
          <div className="py-24 text-center text-xs text-zinc-500 animate-pulse">
            正在从本地 SQLite 加载完整对话轮次...
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {detail?.system_instruction ? (
              <SystemInstructionCard instruction={detail.system_instruction} />
            ) : null}
            {detail?.turns && detail.turns.length > 0 ? (
              detail.turns.map((turn, idx) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 对话轮次流按时间严格保序，无需进行动态重排
                <TurnMessage key={`turn-${idx}`} turn={turn} index={idx} />
              ))
            ) : (
              <div className="py-16 text-center text-zinc-500 text-xs">
                暂无对话内容或数据未同步
              </div>
            )}
          </div>
        )}
~~~~~

### 下一步建议

1. **类型检查与 Lint 验证**：在前端目录运行 `npm run check`，验证 Biome 格式与 TypeScript 编译器是否通过。
2. **列表筛选增强**：目前左侧列表支持「全部/快问/攻坚/分叉」筛选，未来可以考虑在列表或过滤栏增加「带系统提示词」的快速胶囊筛选器。
