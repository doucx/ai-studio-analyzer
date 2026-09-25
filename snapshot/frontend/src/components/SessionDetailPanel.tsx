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
              {session.modified_time
                ? session.modified_time.replace('T', ' ').slice(0, 16)
                : '未知'}
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
