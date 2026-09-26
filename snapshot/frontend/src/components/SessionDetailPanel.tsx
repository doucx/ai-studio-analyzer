import {
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileCode,
  FileText,
  MessagesSquare,
  Paperclip,
  Sliders,
  User,
  X,
} from 'lucide-preact';
import { marked } from 'marked';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { syncVersionSignal } from '../state/sync';
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
          <Check size={12} className="text-emerald-400" />
          <span>已复制</span>
        </>
      ) : (
        <>
          <Copy size={12} />
          <span>复制</span>
        </>
      )}
    </button>
  );
}

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
  const [isOpen, setIsOpen] = useState(false);

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
  const [isThinkingOpen, setIsThinkingOpen] = useState(false);
  const [isAttachmentOpen, setIsAttachmentOpen] = useState(false);

  // 提取可能的 Drive 文件 ID (支持格式: "ID: xxx" 或 "[挂载云盘大文档 ID: xxx]")
  const driveDocId = useMemo(() => {
    if (turn.payload_type !== 'driveDocument') return null;
    const match = turn.text.match(/ID:\s*([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }, [turn.payload_type, turn.text]);

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
      <div
        id={`turn-${index + 1}`}
        className="rounded-lg border border-emerald-900/30 bg-emerald-950/15 overflow-hidden scroll-mt-4"
      >
        <div className="px-3.5 py-2 flex items-center justify-between bg-emerald-950/30 border-b border-emerald-900/20 text-xs text-emerald-400 font-mono">
          <button
            type="button"
            className="flex items-center gap-2 cursor-pointer select-none hover:text-emerald-300 transition bg-transparent border-none p-0 text-emerald-400 font-mono"
            onClick={() => setIsThinkingOpen(!isThinkingOpen)}
          >
            {isThinkingOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <span className="font-semibold flex items-center gap-1">
              <Brain size={13} />
              <span>思考链 (Thinking Process)</span>
            </span>
            <span className="text-[10px] text-emerald-500/80">
              {turn.token_count > 0 ? `${turn.token_count.toLocaleString()} tokens` : ''}
            </span>
          </button>
          <CopyButton text={turn.text} />
        </div>
        {isThinkingOpen ? (
          <div className="p-4 text-xs text-emerald-300/90 font-mono whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto bg-black/20">
            {turn.text}
          </div>
        ) : (
          <button
            type="button"
            className="w-full text-left px-4 py-2 text-xs text-emerald-400/60 font-mono truncate cursor-pointer hover:bg-emerald-900/10 bg-transparent border-none"
            onClick={() => setIsThinkingOpen(true)}
          >
            {turn.text.slice(0, 140)}...
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      id={`turn-${index + 1}`}
      className={`rounded-lg border transition shadow-sm scroll-mt-4 ${
        isUser
          ? 'bg-zinc-900/90 border-indigo-900/40 pl-1 border-l-4 border-l-indigo-500'
          : 'bg-zinc-900/50 border-zinc-800'
      }`}
    >
      {/* 消息 Chunk 头部元数据栏 */}
      <div className="px-4 py-2.5 flex items-center justify-between border-b border-zinc-800/60 text-xs">
        <div className="flex items-center gap-2">
          <span
            className={`font-semibold uppercase text-[11px] px-2 py-0.5 rounded font-mono flex items-center gap-1 ${
              isUser
                ? 'bg-indigo-950 text-indigo-300 border border-indigo-800/60'
                : 'bg-zinc-800 text-zinc-300 border border-zinc-700/60'
            }`}
          >
            {isUser ? <User size={11} /> : <Bot size={11} />}
            <span>{isUser ? 'User' : 'Model'}</span>
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

      {/* 消息正文：云盘大文档专属卡片 或 内联附件卡片 或 Markdown 正文呈现 */}
      <div className="p-4 sm:p-5">
        {turn.payload_type === 'driveDocument' ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-indigo-950/30 border border-indigo-800/40 rounded-lg">
            <div className="flex items-center gap-2.5 min-w-0">
              <FileText size={20} className="text-indigo-400 shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-indigo-300">挂载云盘大文档</div>
                <div className="text-[11px] text-zinc-400 font-mono truncate">
                  ID: <span className="text-zinc-200 select-all">{driveDocId || turn.text}</span>
                </div>
              </div>
            </div>

            {driveDocId && (
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={`https://drive.google.com/file/d/${driveDocId}/view`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1 text-[11px] font-medium bg-indigo-600/80 hover:bg-indigo-600 text-white rounded transition flex items-center gap-1"
                >
                  <ExternalLink size={12} />
                  <span>在云盘查看</span>
                </a>
              </div>
            )}
          </div>
        ) : turn.payload_type === 'inlineFile' ? (
          <div className="rounded-lg border border-cyan-900/40 bg-cyan-950/20 overflow-hidden">
            <div className="px-3.5 py-2.5 flex items-center justify-between bg-cyan-950/40 border-b border-cyan-900/30 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <Paperclip size={14} className="text-cyan-400 shrink-0" />
                <div className="min-w-0">
                  <span className="font-semibold text-cyan-300 truncate">
                    {turn.extra_metadata?.display_name || '内联上下文文件 (inlineFile)'}
                  </span>
                  <span className="ml-2 font-mono text-[11px] text-cyan-400/80">
                    {turn.extra_metadata?.mime_type || 'text/plain'}
                    {turn.extra_metadata?.byte_size !== undefined &&
                      ` · ${(turn.extra_metadata.byte_size / 1024).toFixed(1)} KB`}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsAttachmentOpen(!isAttachmentOpen)}
                  className="px-2 py-1 text-[11px] font-mono rounded bg-cyan-900/40 hover:bg-cyan-900/60 text-cyan-200 border border-cyan-800/50 transition cursor-pointer flex items-center gap-1"
                >
                  {isAttachmentOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  <span>{isAttachmentOpen ? '收起内容' : '展开预览'}</span>
                </button>
                <CopyButton text={turn.text} />
                <DownloadButton
                  text={turn.text}
                  filename={turn.extra_metadata?.display_name || `attachment_${index + 1}.txt`}
                />
              </div>
            </div>
            {isAttachmentOpen ? (
              <div className="p-4 text-xs font-mono whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto bg-black/40 text-cyan-100/90 select-text border-t border-cyan-900/20">
                {turn.text}
              </div>
            ) : (
              <button
                type="button"
                className="w-full text-left px-4 py-2 text-xs text-cyan-300/60 font-mono truncate cursor-pointer hover:bg-cyan-950/30 bg-transparent border-none"
                onClick={() => setIsAttachmentOpen(true)}
              >
                {turn.text.slice(0, 160)}...
              </button>
            )}
          </div>
        ) : (
          <div
            className="prose-chat max-w-none"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: 用于渲染本地 SQLite 缓存中对话记录的 Markdown 解析输出
            dangerouslySetInnerHTML={{ __html: htmlContent as string }}
          />
        )}
      </div>
    </div>
  );
}

export function SessionDetailPanel({ session, onClose }: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [_refreshing, setRefreshing] = useState<boolean>(false);
  const [showMetadata, setShowMetadata] = useState<boolean>(true);

  const aiStudioUrl = `https://aistudio.google.com/prompts/${session.file_id}`;

  const fetchSessionDetail = useCallback(
    async (isSilent = false, signal?: AbortSignal) => {
      if (!isSilent) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      try {
        const res = await fetch(`/api/sessions/${session.file_id}`, { signal });
        if (!res.ok) return;
        const data = await res.json();
        setDetail(data);
      } catch (err: unknown) {
        if ((err as Error)?.name !== 'AbortError') {
          console.error('获取会话详情失败:', err);
        }
      } finally {
        if (!signal?.aborted) {
          if (!isSilent) {
            setLoading(false);
          } else {
            setRefreshing(false);
          }
        }
      }
    },
    [session.file_id],
  );

  // 1. 初次进入或切换会话时全屏加载，并重置旧详情数据以避免数据脏读
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setDetail(null);
    fetchSessionDetail(false, controller.signal);
    return () => {
      controller.abort();
    };
  }, [fetchSessionDetail]);

  // 2. 外部增量同步完成触发 syncVersionSignal 递增时，静默刷新当前打开的会话
  const syncVersion = syncVersionSignal.value;
  const isInitialMountRef = useRef(true);

  useEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }
    if (syncVersion > 0) {
      const controller = new AbortController();
      fetchSessionDetail(true, controller.signal);
      return () => {
        controller.abort();
      };
    }
  }, [syncVersion, fetchSessionDetail]);

  // 3. 处理 URL 锚点定位与平滑滚动高亮聚焦 (#turn-X)
  useEffect(() => {
    if (!loading && detail?.turns && detail.turns.length > 0) {
      const hash = window.location.hash;
      if (hash && hash.startsWith('#turn-')) {
        const timer = setTimeout(() => {
          const targetEl = document.querySelector(hash);
          if (targetEl) {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetEl.classList.add(
              'ring-2',
              'ring-indigo-500',
              'transition-all',
              'duration-500'
            );
            setTimeout(() => {
              targetEl.classList.remove('ring-2', 'ring-indigo-500');
            }, 2500);
          }
        }, 150);
        return () => clearTimeout(timer);
      }
    }
  }, [loading, detail]);

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
            <ExternalLink size={13} />
            <span className="hidden sm:inline">在 AI Studio 打开</span>
          </a>
          <a
            href={`/api/sessions/${session.file_id}/raw`}
            download={`session_${session.file_id}.json`}
            className="px-2.5 py-1 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded border border-zinc-700/80 transition flex items-center gap-1.5"
            title="下载原始会话 JSON"
          >
            <FileCode size={13} />
            <span className="hidden sm:inline">下载原始 JSON</span>
          </a>
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded transition border border-zinc-700/80 flex items-center gap-1"
            title="关闭详情"
          >
            <X size={13} />
            <span className="hidden sm:inline">关闭</span>
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
            <div className="text-[10px] text-zinc-500">
              {session.duration_seconds !== null && session.duration_seconds !== undefined
                ? `${session.duration_seconds} 秒`
                : '持续时间未记录'}
            </div>
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
            <div className="text-[10px] text-zinc-400">交互 Chunks 总数</div>
            <div className="text-base font-bold text-white font-mono mt-0.5">
              {detail?.turns?.length ?? session.chunk_count ?? session.turn_count} 块
            </div>
            <div className="text-[10px] text-zinc-500">
              {(detail?.turns?.length ?? session.chunk_count ?? session.turn_count) >= 7
                ? '深度攻坚'
                : '轻量快问'}
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
              <MessagesSquare size={15} className="text-indigo-400" />
              <span>交互轮次流</span>
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
      </div>
    </div>
  );
}
