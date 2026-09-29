import {
  ChevronLeft,
  ChevronRight,
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: 需在日志条目新增时触发吸底随动
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
    <>
      {/* 展开/收起同位按钮：固定在同一个屏幕物理位置 (右上角)，点击无需挪动鼠标 */}
      <button
        type="button"
        onClick={() => {
          terminalOpenSignal.value = !isOpen;
        }}
        className={`fixed top-[62px] right-3.5 z-50 flex items-center gap-1.5 px-3 py-1.5 rounded-md shadow-xl backdrop-blur-md transition-all cursor-pointer font-mono text-xs border ${
          isOpen
            ? 'bg-zinc-800/90 hover:bg-zinc-700 text-zinc-200 border-zinc-700'
            : 'bg-zinc-900/95 hover:bg-zinc-800 text-zinc-300 border-zinc-700/80 hover:text-white'
        }`}
        title={isOpen ? '收起控制台' : '展开控制台'}
      >
        <Terminal size={14} className="text-indigo-400 shrink-0" />
        <span className="font-semibold">{isOpen ? '收起终端' : '运维终端'}</span>
        {isRunning && (
          <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping shrink-0" />
        )}
        {isOpen ? (
          <ChevronRight size={13} className="text-zinc-400 shrink-0" />
        ) : (
          <ChevronLeft size={13} className="text-zinc-400 shrink-0" />
        )}
      </button>

      {/* 右侧展开全高侧面板 */}
      <aside
        aria-label="运维终端控制台"
        className={`fixed top-14 right-0 bottom-0 z-40 bg-zinc-950/95 border-l border-zinc-800 shadow-2xl backdrop-blur-md transition-transform duration-300 flex flex-col w-full sm:w-[420px] lg:w-[460px] ${
          isOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none'
        }`}
      >
        {/* 顶端留白标题栏 (避让右上角同位切换按钮，极简纯净) */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-900/80 border-b border-zinc-800/80 text-xs select-none shrink-0 pr-36">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono font-semibold text-zinc-300 truncate">控制台输出</span>
            {isRunning ? (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-950 text-indigo-300 border border-indigo-800/60 animate-pulse">
                <Loader2 size={10} className="animate-spin" />
                <span>运行中</span>
              </span>
            ) : (
              <span className="text-[10px] font-mono text-zinc-500 bg-zinc-800/60 px-1.5 py-0.5 rounded">
                就绪 · {logs.length} 行
              </span>
            )}
          </div>
        </div>

        {/* 顶端直通主体视口：全部空间专供文本日志展示 */}
        <div
          ref={terminalBodyRef}
          onScroll={handleScroll}
          className="flex-1 p-3.5 overflow-y-auto font-mono text-xs leading-relaxed space-y-1.5 select-text bg-black/60"
        >
          {logs.length === 0 ? (
            <div className="text-zinc-600 text-[11px] py-20 text-center">
              终端控制台就绪，请在左侧控制面板触发同步、重建或诊断任务
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

        {/* 最底端：任务进度条、状态指标与操作按钮区 */}
        <div className="border-t border-zinc-800/80 bg-zinc-900/95 flex flex-col shrink-0 select-none">
          {/* 实时进度条指示 */}
          {progress && (
            <div className="w-full bg-zinc-950 h-1.5 overflow-hidden border-b border-zinc-800/60">
              <div
                className="bg-indigo-500 h-full transition-all duration-200"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          )}

          {/* 底栏信息与操作控制 */}
          <div className="px-3.5 py-2.5 flex items-center justify-between text-xs font-mono gap-2">
            <div className="min-w-0 flex-1 space-y-0.5">
              {progress ? (
                <>
                  <div className="flex items-center justify-between text-[11px] text-zinc-300">
                    <span className="truncate">{taskName}</span>
                    <span className="text-indigo-400 font-semibold shrink-0">
                      {progress.percent}%
                    </span>
                  </div>
                  <div className="text-[10px] text-zinc-500 flex items-center justify-between gap-2">
                    <span>
                      {progress.current}/{progress.total}
                    </span>
                    {progress.speed && <span>{progress.speed}</span>}
                    {progress.wal_human && <span>WAL: {progress.wal_human}</span>}
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2 text-zinc-500 text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/80 shrink-0" />
                  <span>任务队列空闲就绪</span>
                </div>
              )}
            </div>

            {/* 底栏操作快捷按钮组 */}
            <div className="flex items-center gap-1.5 shrink-0">
              {isRunning && (
                <button
                  type="button"
                  onClick={abortCurrentJob}
                  className="px-2 py-1 text-[11px] font-medium bg-red-950 hover:bg-red-900 text-red-300 border border-red-800/80 rounded transition flex items-center gap-1 cursor-pointer"
                  title="优雅中止当前任务"
                >
                  <OctagonX size={12} />
                  <span>中止</span>
                </button>
              )}
              <button
                type="button"
                onClick={clearTerminalLogs}
                className="p-1 text-zinc-400 hover:text-zinc-200 bg-zinc-800/80 hover:bg-zinc-700 rounded transition cursor-pointer"
                title="清空控制台日志"
              >
                <Trash2 size={13} />
              </button>
              <button
                type="button"
                onClick={handleExportLogs}
                className="p-1 text-zinc-400 hover:text-zinc-200 bg-zinc-800/80 hover:bg-zinc-700 rounded transition cursor-pointer"
                title="导出日志文本"
              >
                <Download size={13} />
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}