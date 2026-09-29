import { Activity, Check, Cpu, Globe, Loader2, Save, Sliders, Wrench } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { OpsTerminalDrawer } from '../components/OpsTerminalDrawer';
import { DiagnosticsTab } from '../components/settings/DiagnosticsTab';
import { GeneralTab } from '../components/settings/GeneralTab';
import { MetricsTab } from '../components/settings/MetricsTab';
import { OperationsTab } from '../components/settings/OperationsTab';
import { OutlierDrawerModal } from '../components/settings/OutlierDrawerModal';
import { isJobRunningSignal, terminalOpenSignal } from '../state/ops';
import {
  configLoadingSignal,
  configSavingSignal,
  configSignal,
  fetchSettings,
  saveSettings,
} from '../state/settings';

type SubTab = 'general' | 'metrics' | 'operations' | 'diagnostics';

export function SettingsRoute() {
  const [activeTab, setActiveTab] = useState<SubTab>('general');
  const [form, setForm] = useState(configSignal.value);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // 运维操作自定义配置
  const [batchSize, setBatchSize] = useState<number>(300);
  const [vacuumOnReindex, setVacuumOnReindex] = useState<boolean>(true);
  const [allFilesSyncConfirm, setAllFilesSyncConfirm] = useState<boolean>(false);

  useEffect(() => {
    fetchSettings().then(() => {
      setForm(configSignal.value);
    });
  }, []);

  const handleSave = async () => {
    const ok = await saveSettings(form);
    if (ok) {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    }
  };

  const isSaving = configSavingSignal.value;
  const isLoading = configLoadingSignal.value;
  const isJobRunning = isJobRunningSignal.value;
  const isTerminalOpen = terminalOpenSignal.value;

  return (
    <div
      className={`w-full p-4 md:p-6 pb-24 transition-all duration-300 relative ${
        isTerminalOpen ? 'lg:pr-[430px] xl:pr-[470px]' : ''
      }`}
    >
      <div className="max-w-6xl mx-auto space-y-6">
        {/* 头部标题与保存指示条 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <Sliders size={20} className="text-indigo-400" />
              <span>系统与控制中心</span>
              <span className="text-[10px] font-mono uppercase bg-indigo-950/80 text-indigo-400 border border-indigo-800/60 px-1.5 py-0.5 rounded font-normal">
                v0.3 Pro Workstation
              </span>
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              统一控制 Google API 代理网络、同步策略、低频重型运维与全盘深度健康探针
            </p>
          </div>

          <div className="flex items-center gap-2">
            {saveSuccess && (
              <span className="text-xs text-emerald-400 flex items-center gap-1 font-mono">
                <Check size={14} /> 已保存生效
              </span>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded transition shadow-sm flex items-center gap-1.5 cursor-pointer"
            >
              {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              <span>{isSaving ? '正在保存...' : '保存配置'}</span>
            </button>
          </div>
        </div>

        {/* 二级 Tab 导航切换 */}
        <div className="flex items-center gap-1 border-b border-zinc-800 bg-zinc-900/50 p-1 rounded-lg">
          <button
            type="button"
            onClick={() => setActiveTab('general')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'general'
                ? 'bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Globe size={14} className={activeTab === 'general' ? 'text-indigo-400' : ''} />
            <span>网络与常规设置</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('metrics')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'metrics'
                ? 'bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Cpu size={14} className={activeTab === 'metrics' ? 'text-indigo-400' : ''} />
            <span>心智度量偏好</span>
          </button>

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
            <span>系统健康探针</span>
          </button>
        </div>

        {isLoading ? (
          <div className="py-24 text-center text-xs text-zinc-500 animate-pulse">
            正在加载系统配置参数...
          </div>
        ) : null}

        {!isLoading && activeTab === 'general' && <GeneralTab form={form} setForm={setForm} />}

        {!isLoading && activeTab === 'metrics' && <MetricsTab form={form} setForm={setForm} />}

        {!isLoading && activeTab === 'operations' && (
          <OperationsTab
            batchSize={batchSize}
            setBatchSize={setBatchSize}
            vacuumOnReindex={vacuumOnReindex}
            setVacuumOnReindex={setVacuumOnReindex}
            allFilesSyncConfirm={allFilesSyncConfirm}
            setAllFilesSyncConfirm={setAllFilesSyncConfirm}
          />
        )}

        {!isLoading && activeTab === 'diagnostics' && <DiagnosticsTab />}

        <OutlierDrawerModal />
      </div>

      <OpsTerminalDrawer />
    </div>
  );
}
