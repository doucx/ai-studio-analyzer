import { Check, ChevronDown, ChevronRight, Copy, Sliders } from 'lucide-preact';
import { useState } from 'preact/hooks';

export function SystemInstructionCard({ instruction }: { instruction: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!instruction || !instruction.trim()) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(instruction);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('复制系统指令失败:', err);
    }
  };

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

        <button
          type="button"
          onClick={handleCopy}
          className={`px-2 py-1 text-[11px] rounded transition flex items-center gap-1 border ${
            copied
              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
              : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 border-zinc-700/60'
          }`}
          title="复制系统提示词"
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
