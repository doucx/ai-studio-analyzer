import {
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  OctagonX,
  Terminal,
  Trash2,
} from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  abortCurrentJob,
  activeTaskNameSignal,
  clearTerminalLogs,
  isJobRunningSignal,
  terminalLogsSignal,
  terminalOpenSignal,
  terminalProgressSignal,
} from '../state/ops';

export function OpsTerminalDrawer() {
  const isOpen = terminalOpenSignal.value;
  const isRunning = isJobRunningSignal.value;
  const taskName = activeTaskNameSignal.value || '系统维护任务';
  const logs = terminalLogsSignal.value;
  const progress = terminalProgressSignal.value;

  const terminalBodyRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);

  // 自锁滚动监听：当用户向上滚动时不强行吸底；滚到底部时恢复随动
  const handleScroll = () => {
    if (!terminalBodyRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = terminalBodyRef.current;
    const isAtBottom = scrollHeight - scrollTop <= clientHeight + 35;
    setAutoScroll(isAtBottom);
  };

  useEffect(() => {
    if (autoScroll && terminalBodyRef.current) {
      terminalBodyRef.current.scrollTop = terminalBodyRef.current.scrollHeight;
    }
  }, [logs.length, autoScroll]);

  const handleExportLogs = () => {
    const text = logs.map((l) => `[${l.time}] [${l.level.toUpperCase()}] ${l.message}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ops_log_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside
      aria-label="运维终端控制台"
      className={`fixed bottom-0 right-0 left-0 z-40 bg-zinc-950/95 border-t border-zinc-800 shadow-2xl backdrop-blur-md transition-all duration-300 flex flex-col ${
        isOpen ? 'h-72 sm:h-80' : 'h-10'
      }`}
    >
      {/* 终端顶栏状态条 */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-900/90 border-b border-zinc-800/80 text-xs select-none">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              terminalOpenSignal.value = !terminalOpenSignal.value;
            }}
            className="flex items-center gap-1.5 font-mono text-zinc-300 hover:text-white font-semibold cursor-pointer bg-transparent border-none p-0"
          >
            <Terminal size={14} className="text-indigo-400" />
            <span>运维终端控制台</span>
            {isOpen ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>

          {isRunning ? (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-950 text-indigo-300 border border-indigo-800/60 animate-pulse">
              <Loader2 size={11} className="animate-spin" />
              <span>{taskName} 正在运行</span>
            </span>
          ) : (
            <span className="text-[10px] font-mono text-zinc-500 bg-zinc-800/60 px-1.5 py-0.5 rounded">
              就绪
            </span>
          )}

          {progress && (
            <span className="text-[11px] font-mono text-zinc-400 hidden sm:inline">
              进度: {progress.current}/{progress.total} ({progress.percent}%)
              {progress.speed && ` · ${progress.speed}`}
              {progress.wal_human && ` · WAL: ${progress.wal_human}`}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isRunning && (
            <button
              type="button"
              onClick={abortCurrentJob}
              className="px-2 py-0.5 text-[11px] font-medium bg-red-950 hover:bg-red-900 text-red-300 border border-red-800/80 rounded transition flex items-center gap-1 cursor-pointer"
              title="优雅中止当前任务"
            >
              <OctagonX size={12} />
              <span>中止任务</span>
            </button>
          )}

          {isOpen && (
            <>
              <button
                type="button"
                onClick={clearTerminalLogs}
                className="p-1 text-zinc-400 hover:text-zinc-200 bg-zinc-800/80 hover:bg-zinc-700 rounded transition cursor-pointer"
                title="清空控制台日志"
              >
                <Trash2 size={12} />
              </button>
              <button
                type="button"
                onClick={handleExportLogs}
                className="p-1 text-zinc-400 hover:text-zinc-200 bg-zinc-800/80 hover:bg-zinc-700 rounded transition cursor-pointer"
                title="导出日志文本"
              >
                <Download size={12} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* 实时进度条指示 */}
      {progress && (
        <div className="w-full bg-zinc-900 h-1 overflow-hidden">
          <div
            className="bg-indigo-500 h-full transition-all duration-200"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      )}

      {/* 日志字符流主体视口 */}
      {isOpen && (
        <div
          ref={terminalBodyRef}
          onScroll={handleScroll}
          className="flex-1 p-3 overflow-y-auto font-mono text-xs leading-relaxed space-y-1 select-text bg-black/60"
        >
          {logs.length === 0 ? (
            <div className="text-zinc-600 text-[11px] py-6 text-center">
              终端控制台就绪，请在上方控制面板触发同步、重建或诊断任务
            </div>
          ) : (
            logs.map((log) => {
              let colorClass = 'text-zinc-300';
              if (log.level === 'warn') colorClass = 'text-amber-300';
              if (log.level === 'error') colorClass = 'text-red-400';
              if (log.level === 'success') colorClass = 'text-emerald-300 font-semibold';

              return (
                <div key={log.id} className="flex items-start gap-2 break-all">
                  <span className="text-zinc-600 shrink-0 select-none">[{log.time}]</span>
                  <span className={colorClass}>{log.message}</span>
                </div>
              );
            })
          )}
        </div>
      )}
    </aside>
  );
}
