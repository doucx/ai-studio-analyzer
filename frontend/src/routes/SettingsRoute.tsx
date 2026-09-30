import { Check, Cpu, Globe, Loader2, Monitor, Save, Sliders } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { GeneralTab } from '../components/settings/GeneralTab';
import { MetricsTab } from '../components/settings/MetricsTab';
import { PreferencesTab } from '../components/settings/PreferencesTab';
import {
  configLoadingSignal,
  configSavingSignal,
  configSignal,
  fetchSettings,
  saveSettings,
} from '../state/settings';

type SubTab = 'general' | 'metrics' | 'preferences';

export function SettingsRoute() {
  const [activeTab, setActiveTab] = useState<SubTab>('general');
  const [form, setForm] = useState(configSignal.value);
  const [saveSuccess, setSaveSuccess] = useState(false);

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

  return (
    <div className="w-full p-4 md:p-6 pb-24 relative">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* 头部标题与保存指示条 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <Sliders size={20} className="text-indigo-400" />
              <span>系统与偏好设置</span>
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              配置 Google API 代理、视口同步策略、心智审计模型超参数及界面交互偏好
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

        {/* 设置分类 Tab 导航切换 */}
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
            <span>网络与同步策略</span>
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
            <span>认知度量模型</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('preferences')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'preferences'
                ? 'bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Monitor size={14} className={activeTab === 'preferences' ? 'text-indigo-400' : ''} />
            <span>检索与阅读偏好</span>
          </button>
        </div>

        {isLoading ? (
          <div className="py-24 text-center text-xs text-zinc-500 animate-pulse">
            正在加载系统配置参数...
          </div>
        ) : null}

        {!isLoading && activeTab === 'general' && <GeneralTab form={form} setForm={setForm} />}

        {!isLoading && activeTab === 'metrics' && <MetricsTab form={form} setForm={setForm} />}

        {!isLoading && activeTab === 'preferences' && (
          <PreferencesTab form={form} setForm={setForm} />
        )}
      </div>
    </div>
  );
}
