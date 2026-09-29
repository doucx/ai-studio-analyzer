import {
  Flame,
  HardDrive,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Wrench,
  Zap,
} from 'lucide-preact';
import {
  isJobRunningSignal,
  triggerOpsCheckpoint,
  triggerOpsReindex,
  triggerOpsSync,
  triggerOpsVacuum,
  vacuumResultSignal,
} from '../../state/ops';

interface Props {
  batchSize: number;
  setBatchSize: (val: number) => void;
  vacuumOnReindex: boolean;
  setVacuumOnReindex: (val: boolean) => void;
  allFilesSyncConfirm: boolean;
  setAllFilesSyncConfirm: (val: boolean) => void;
}

export function OperationsTab({
  batchSize,
  setBatchSize,
  vacuumOnReindex,
  setVacuumOnReindex,
  allFilesSyncConfirm,
  setAllFilesSyncConfirm,
}: Props) {
  const isJobRunning = isJobRunningSignal.value;
  const vacuumResult = vacuumResultSignal.value;

  return (
    <div className="space-y-5">
      <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-300 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wrench size={16} className="text-amber-400 shrink-0" />
          <span>
            运维与重整属于受控写锁操作，系统已开启
            <strong>全局互斥锁</strong>与<strong>取消令牌机制</strong>，长任务可随时优雅截断。
          </span>
        </div>
        {isJobRunning && (
          <span className="text-[11px] text-amber-400 font-mono flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" /> 运维中
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 卡片 1: 云端拉取控制中心 */}
        <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
                <RefreshCw size={15} className="text-indigo-400" />
                <span>云端数据同步中心</span>
              </h3>
              <span className="text-[10px] text-indigo-400 bg-indigo-950/80 px-1.5 py-0.5 rounded border border-indigo-800/60 font-mono">
                Google Drive
              </span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              增量扫描云端目标文件夹中的对话 JSON。支持拉取最近 50/100 篇或全量全盘对齐。
            </p>
          </div>

          <div className="pt-2 border-t border-zinc-800/60 space-y-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isJobRunning}
                onClick={() => triggerOpsSync(50, false)}
                className="flex-1 px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 rounded border border-zinc-700 transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>增量拉取 (最新 50 篇)</span>
              </button>

              <button
                type="button"
                disabled={isJobRunning}
                onClick={() => triggerOpsSync(150, false)}
                className="px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 rounded border border-zinc-700 transition cursor-pointer"
              >
                <span>150 篇</span>
              </button>
            </div>

            <div className="p-2.5 rounded bg-zinc-950/60 border border-zinc-800 text-[11px] space-y-2">
              <div className="flex items-center justify-between text-zinc-400">
                <span className="flex items-center gap-1">
                  <Flame size={13} className="text-amber-400" />
                  <span>全盘全量扫描同步</span>
                </span>
                <button
                  type="button"
                  disabled={isJobRunning}
                  onClick={() => setAllFilesSyncConfirm(!allFilesSyncConfirm)}
                  className="text-indigo-400 hover:underline cursor-pointer"
                >
                  {allFilesSyncConfirm ? '取消确认' : '展开选项'}
                </button>
              </div>

              {allFilesSyncConfirm && (
                <div className="space-y-2 pt-1 border-t border-zinc-800">
                  <p className="text-amber-400/90 text-[11px] leading-relaxed">
                    ⚠️ 全量扫描将遍历云端所有历史文件，耗时较长并消耗较多网络配额，请确认代理通畅。
                  </p>
                  <button
                    type="button"
                    disabled={isJobRunning}
                    onClick={() => {
                      setAllFilesSyncConfirm(false);
                      triggerOpsSync(0, true);
                    }}
                    className="w-full px-3 py-1 text-xs font-medium bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded transition cursor-pointer"
                  >
                    确认执行全量扫描
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 卡片 2: 索引与 FTS 检索引擎重建 */}
        <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
                <Zap size={15} className="text-amber-400" />
                <span>索引与 FTS 全文引擎重整</span>
              </h3>
              <span className="text-[10px] text-amber-400 bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-800/60 font-mono">
                SQLite FTS5 Trigram
              </span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              重置 <code>session_index</code> 与 <code>session_fts</code>
              ，支持按批次平稳提交 Checkpoint，平抑 WAL 膨胀。
            </p>
          </div>

          <div className="pt-2 border-t border-zinc-800/60 space-y-3">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <label htmlFor="batch-slider" className="flex items-center gap-1">
                <span>批次 Checkpoint 规模:</span>
                <strong className="text-zinc-200 font-mono">{batchSize} 条/批</strong>
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={vacuumOnReindex}
                  onChange={(e) => setVacuumOnReindex((e.target as HTMLInputElement).checked)}
                  className="rounded bg-zinc-950 border-zinc-700 text-indigo-600"
                />
                <span className="text-[11px]">完成后执行 VACUUM</span>
              </label>
            </div>

            <input
              id="batch-slider"
              type="range"
              min="100"
              max="1000"
              step="50"
              value={batchSize}
              onInput={(e) => setBatchSize(Number((e.target as HTMLInputElement).value))}
              className="w-full accent-indigo-500 cursor-pointer"
            />

            <button
              type="button"
              disabled={isJobRunning}
              onClick={() => triggerOpsReindex(batchSize, vacuumOnReindex)}
              className="w-full px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded transition shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Sparkles size={13} />
              <span>⚡ 一键重建全文倒排与二级索引</span>
            </button>
          </div>
        </section>

        {/* 卡片 3: WAL 截断与合并刷盘 */}
        <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
                <RotateCcw size={15} className="text-sky-400" />
                <span>WAL 日志截断与主库合并</span>
              </h3>
              <span className="text-[10px] text-sky-400 bg-sky-950/80 px-1.5 py-0.5 rounded border border-sky-800/60 font-mono">
                PRAGMA TRUNCATE
              </span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              显式执行 <code>wal_checkpoint(TRUNCATE)</code>，将 <code>cache.db-wal</code>{' '}
              脏页完整写入主库并将日志归零释放磁盘空间。
            </p>
          </div>

          <div className="pt-2 border-t border-zinc-800/60">
            <button
              type="button"
              disabled={isJobRunning}
              onClick={triggerOpsCheckpoint}
              className="w-full px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 rounded border border-zinc-700 transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <HardDrive size={13} />
              <span>立即执行 WAL Checkpoint 刷盘</span>
            </button>
          </div>
        </section>

        {/* 卡片 4: 碎片整理与物理页面瘦身 */}
        <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
                <HardDrive size={15} className="text-emerald-400" />
                <span>碎片整理与数据库物理瘦身</span>
              </h3>
              <span className="text-[10px] text-emerald-400 bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-800/60 font-mono">
                VACUUM
              </span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              清理 Freelist 闲置页面碎片，重构 B-Tree 物理连续性并压缩 <code>cache.db</code>{' '}
              占用空间。
            </p>
          </div>

          <div className="pt-2 border-t border-zinc-800/60 space-y-2">
            {vacuumResult && (
              <div className="p-2 rounded bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 text-xs font-mono flex items-center justify-between">
                <span>已释放磁盘空间: {vacuumResult.freed_human}</span>
                <span>耗时: {vacuumResult.duration_seconds}s</span>
              </div>
            )}
            <button
              type="button"
              disabled={isJobRunning}
              onClick={triggerOpsVacuum}
              className="w-full px-3 py-1.5 text-xs font-medium bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded transition shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>执行 VACUUM 磁盘瘦身</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
