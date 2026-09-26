import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-preact';
import { removeToast, toastsSignal } from '../state/toast';

export function ToastContainer() {
  const toasts = toastsSignal.value;

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0">
      {toasts.map((toast) => {
        let borderClass = 'border-indigo-500/40 bg-zinc-900/95 text-indigo-300';
        let icon = <Info size={16} className="text-indigo-400 shrink-0 mt-0.5" />;

        if (toast.type === 'success') {
          borderClass = 'border-emerald-500/50 bg-zinc-900/95 text-emerald-300';
          icon = <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />;
        } else if (toast.type === 'warning') {
          borderClass = 'border-amber-500/50 bg-zinc-900/95 text-amber-300';
          icon = <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />;
        } else if (toast.type === 'error') {
          borderClass = 'border-red-500/50 bg-zinc-900/95 text-red-300';
          icon = <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />;
        }

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-2.5 p-3 rounded-lg border shadow-xl backdrop-blur-md transition-all duration-200 text-xs leading-relaxed animate-in fade-in slide-in-from-bottom-2 ${borderClass}`}
          >
            {icon}
            <div className="flex-1 font-sans break-words">{toast.message}</div>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              className="text-zinc-400 hover:text-zinc-200 transition p-0.5 rounded cursor-pointer shrink-0"
              title="关闭通知"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}