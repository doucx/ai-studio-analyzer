import {
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Paperclip,
  User,
} from 'lucide-preact';
import { marked } from 'marked';
import { useMemo, useState } from 'preact/hooks';
import type { ConversationTurnItem } from '../../types/metrics';

marked.setOptions({
  breaks: true,
  gfm: true,
});

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

function DownloadImageButton({
  base64Data,
  mimeType,
  filename,
}: { base64Data: string; mimeType: string; filename: string }) {
  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = `data:${mimeType};base64,${base64Data}`;
    a.download = filename;
    a.click();
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      className="px-2 py-1 text-[11px] rounded transition flex items-center gap-1 border bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 border-zinc-700/60 cursor-pointer"
      title="下载图片文件"
    >
      <Download size={12} />
      <span>下载</span>
    </button>
  );
}

export function TurnMessage({ turn, index }: { turn: ConversationTurnItem; index: number }) {
  const [isThinkingOpen, setIsThinkingOpen] = useState(false);
  const [isAttachmentOpen, setIsAttachmentOpen] = useState(false);

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
        ) : turn.payload_type === 'inlineImage' ? (
          <div className="rounded-lg border border-purple-900/40 bg-purple-950/20 overflow-hidden">
            <div className="px-3.5 py-2.5 flex items-center justify-between bg-purple-950/40 border-b border-purple-900/30 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <ImageIcon size={14} className="text-purple-400 shrink-0" />
                <div className="min-w-0">
                  <span className="font-semibold text-purple-300">
                    图片附件 (inlineImage)
                  </span>
                  <span className="ml-2 font-mono text-[11px] text-purple-400/80">
                    {turn.extra_metadata?.mime_type || 'image/png'}
                    {turn.extra_metadata?.byte_size !== undefined &&
                      ` · ${(turn.extra_metadata.byte_size / 1024).toFixed(1)} KB`}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsAttachmentOpen(!isAttachmentOpen)}
                  className="px-2 py-1 text-[11px] font-mono rounded bg-purple-900/40 hover:bg-purple-900/60 text-purple-200 border border-purple-800/50 transition cursor-pointer flex items-center gap-1"
                >
                  {isAttachmentOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  <span>{isAttachmentOpen ? '收起大图' : '展开大图'}</span>
                </button>
                {turn.extra_metadata?.data && (
                  <DownloadImageButton
                    base64Data={turn.extra_metadata.data}
                    mimeType={turn.extra_metadata.mime_type || 'image/png'}
                    filename={`image_turn_${index + 1}.${(turn.extra_metadata.mime_type || 'image/png').split('/')[1] || 'png'}`}
                  />
                )}
              </div>
            </div>

            <div className="p-3 bg-black/40 flex justify-center items-center">
              {turn.extra_metadata?.data ? (
                <button
                  type="button"
                  onClick={() => setIsAttachmentOpen(!isAttachmentOpen)}
                  className="p-0 border-0 bg-transparent cursor-pointer flex justify-center w-full"
                  title={isAttachmentOpen ? '点击收起大图' : '点击展开大图'}
                >
                  <img
                    src={`data:${turn.extra_metadata.mime_type || 'image/png'};base64,${turn.extra_metadata.data}`}
                    alt={`Turn ${index + 1} Image Attachment`}
                    className={`rounded border border-purple-900/30 object-contain transition-all duration-200 ${
                      isAttachmentOpen ? 'max-h-[700px] w-auto' : 'max-h-48 hover:opacity-90'
                    }`}
                    loading="lazy"
                  />
                </button>
              ) : (
                <span className="text-zinc-500 text-xs font-mono">{turn.text}</span>
              )}
            </div>
          </div>
        ) : (
          <div
            className="prose-chat max-w-none"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: 渲染本地 Markdown 解析
            dangerouslySetInnerHTML={{ __html: htmlContent as string }}
          />
        )}
      </div>
    </div>
  );
}
