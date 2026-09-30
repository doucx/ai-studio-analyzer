import { Flame, X } from 'lucide-preact';
import { closeOutlierSession, outlierDrawerSessionSignal } from '../../state/ops';
import { SessionDetailPanel } from '../SessionDetailPanel';

export function OutlierDrawerModal() {
  const outlierSession = outlierDrawerSessionSignal.value;
  if (!outlierSession) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex justify-end">
      <div className="w-full max-w-4xl bg-zinc-950 h-full shadow-2xl border-l border-zinc-800 flex flex-col p-4 sm:p-6 overflow-hidden animate-in slide-in-from-right duration-300">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800 mb-4">
          <span className="text-xs font-mono text-amber-400 font-semibold flex items-center gap-1.5">
            <Flame size={14} />
            <span>离群会话详情审查: {outlierSession.name}</span>
          </span>
          <button
            type="button"
            onClick={closeOutlierSession}
            className="p-1 rounded text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SessionDetailPanel session={outlierSession} onClose={closeOutlierSession} />
        </div>
      </div>
    </div>
  );
}
