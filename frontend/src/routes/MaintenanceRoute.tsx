import { Activity, Wrench } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { OpsTerminalDrawer } from '../components/OpsTerminalDrawer';
import { DiagnosticsTab } from '../components/settings/DiagnosticsTab';
import { OperationsTab } from '../components/settings/OperationsTab';
import { OutlierDrawerModal } from '../components/settings/OutlierDrawerModal';
import { isJobRunningSignal, terminalOpenSignal } from '../state/ops';

type SubTab = 'operations' | 'diagnostics';

export function MaintenanceRoute() {
  const [activeTab, setActiveTab] = useState<SubTab>('operations');

  // 运维操作受控配置项
  const [batchSize, setBatchSize] = useState<number>(300);
  const [vacuumOnReindex, setVacuumOnReindex] = useState<boolean>(true);
  const [allFilesSyncConfirm, setAllFilesSyncConfirm] = useState<boolean>(false);

  const isJobRunning = isJobRunningSignal.value;
  const isTerminalOpen = terminalOpenSignal.value;

  return (
    <div
      className={`w-full p-4 md:p-6 pb-24 transition-all duration-300 relative ${
        isTerminalOpen ? 'lg:pr-[430px] xl:pr-[470px]' : ''
      }`}
    >
      <div className="max-w-6xl mx-auto space-y-6">
        {/* 头部标题栏 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <Wrench size={20} className="text-amber-400" />
              <span>系统运维与存储中心</span>
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              提供排他性写锁运维、SQLite FTS5 全文重建、WAL 归零截断、磁盘 VACUUM
              瘦身与深度全盘健康探针
            </p>
          </div>
        </div>

        {/* 二级功能分类 Tab 导航切换 */}
        <div className="flex items-center gap-1 border-b border-zinc-800 bg-zinc-900/50 p-1 rounded-lg">
          <button
            type="button"
            onClick={() => setActiveTab('operations')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'operations'
                ? 'bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Wrench size={14} className={activeTab === 'operations' ? 'text-amber-400' : ''} />
            <span>运维与存储控制台</span>
            {isJobRunning && (
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping ml-0.5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('diagnostics')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'diagnostics'
                ? 'bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Activity size={14} className={activeTab === 'diagnostics' ? 'text-emerald-400' : ''} />
            <span>系统健康度与 Schema 探针</span>
          </button>
        </div>

        {/* 视口内容切换 */}
        {activeTab === 'operations' && (
          <OperationsTab
            batchSize={batchSize}
            setBatchSize={setBatchSize}
            vacuumOnReindex={vacuumOnReindex}
            setVacuumOnReindex={setVacuumOnReindex}
            allFilesSyncConfirm={allFilesSyncConfirm}
            setAllFilesSyncConfirm={setAllFilesSyncConfirm}
          />
        )}

        {activeTab === 'diagnostics' && <DiagnosticsTab />}

        <OutlierDrawerModal />
      </div>

      <OpsTerminalDrawer />
    </div>
  );
}
