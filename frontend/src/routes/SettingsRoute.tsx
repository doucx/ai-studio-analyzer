import {
  Activity,
  AlertTriangle,
  Check,
  Cpu,
  Database,
  Flame,
  Globe,
  HardDrive,
  Layers,
  LineChart,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Sliders,
  Sparkles,
  Wrench,
  X,
  Zap,
} from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { OpsTerminalDrawer } from '../components/OpsTerminalDrawer';
import { SessionDetailPanel } from '../components/SessionDetailPanel';
import {
  closeOutlierSession,
  healthDiagnosticsSignal,
  healthLoadingSignal,
  isJobRunningSignal,
  openOutlierSession,
  outlierDrawerSessionSignal,
  runHealthDiagnostic,
  runSchemaDiagnostic,
  schemaDiagnosticsSignal,
  schemaLoadingSignal,
  triggerOpsCheckpoint,
  triggerOpsReindex,
  triggerOpsSync,
  triggerOpsVacuum,
  vacuumResultSignal,
} from '../state/ops';
import {
  configLoadingSignal,
  configSavingSignal,
  configSignal,
  fetchSettings,
  proxyTestResultSignal,
  proxyTestingSignal,
  saveSettings,
  testProxy,
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

  const isTesting = proxyTestingSignal.value;
  const testResult = proxyTestResultSignal.value;
  const isSaving = configSavingSignal.value;
  const isLoading = configLoadingSignal.value;

  const isJobRunning = isJobRunningSignal.value;
  const healthData = healthDiagnosticsSignal.value;
  const isHealthLoading = healthLoadingSignal.value;
  const schemaData = schemaDiagnosticsSignal.value;
  const isSchemaLoading = schemaLoadingSignal.value;
  const outlierSession = outlierDrawerSessionSignal.value;
  const vacuumResult = vacuumResultSignal.value;

  return (
    <div className="max-w-6xl mx-auto w-full p-4 md:p-6 pb-24 space-y-6 relative">
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

      {/* Tab 1: 网络与常规设置 */}
      {!isLoading && activeTab === 'general' && (
        <div className="space-y-6">
          <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5 space-y-4">
            <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
              <Globe size={15} className="text-indigo-400" />
              <span>Google API 代理与网络</span>
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div className="md:col-span-2 space-y-1.5">
                <label htmlFor="proxy-url-input" className="text-xs text-zinc-400">
                  HTTP / HTTPS 代理地址 (留空表示直连)
                </label>
                <input
                  id="proxy-url-input"
                  type="text"
                  value={form.proxy_url}
                  onInput={(e) =>
                    setForm({ ...form, proxy_url: (e.target as HTMLInputElement).value })
                  }
                  placeholder="如 http://127.0.0.1:7890"
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 outline-none"
                />
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => testProxy(form.proxy_url)}
                  disabled={isTesting}
                  className="w-full px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded border border-zinc-700 transition flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {isTesting ? <Loader2 size={13} className="animate-spin" /> : null}
                  <span>{isTesting ? '正在探测 Google...' : '测试代理连通性'}</span>
                </button>
              </div>
            </div>

            {testResult && (
              <div
                className={`p-3 rounded text-xs font-mono border ${
                  testResult.ok
                    ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                    : 'bg-red-950/40 border-red-800/60 text-red-300'
                }`}
              >
                {testResult.message}
              </div>
            )}
          </section>

          <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5 space-y-4">
            <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
              <Database size={15} className="text-indigo-400" />
              <span>Google 云端凭据与文件夹</span>
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="target-folder-input" className="text-xs text-zinc-400">
                  AI Studio 目标文件夹名称
                </label>
                <input
                  id="target-folder-input"
                  type="text"
                  value={form.target_folder_name}
                  onInput={(e) =>
                    setForm({ ...form, target_folder_name: (e.target as HTMLInputElement).value })
                  }
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded px-3 py-1.5 text-xs text-zinc-200 outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="token-path-input" className="text-xs text-zinc-400">
                  授权令牌保存路径 (Token File)
                </label>
                <input
                  id="token-path-input"
                  type="text"
                  value={form.token_path}
                  onInput={(e) =>
                    setForm({ ...form, token_path: (e.target as HTMLInputElement).value })
                  }
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 outline-none"
                />
              </div>
            </div>
          </section>

          <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5 space-y-4">
            <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
              <Activity size={15} className="text-indigo-400" />
              <span>视口唤醒与自动同步</span>
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="sync-interval-input" className="text-xs text-zinc-400">
                  焦点唤醒触发最小冷却 (秒)
                </label>
                <input
                  id="sync-interval-input"
                  type="number"
                  value={form.auto_sync_interval}
                  onInput={(e) =>
                    setForm({
                      ...form,
                      auto_sync_interval: Number((e.target as HTMLInputElement).value),
                    })
                  }
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="sync-limit-input" className="text-xs text-zinc-400">
                  自动同步拉取规模 (最新篇数)
                </label>
                <input
                  id="sync-limit-input"
                  type="number"
                  value={form.auto_sync_limit}
                  onInput={(e) =>
                    setForm({
                      ...form,
                      auto_sync_limit: Number((e.target as HTMLInputElement).value),
                    })
                  }
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 outline-none"
                />
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Tab 2: 心智度量偏好 */}
      {!isLoading && activeTab === 'metrics' && (
        <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5 space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
              <Cpu size={15} className="text-indigo-400" />
              <span>人机心智活跃时长估算模型 (Cognitive Model Hyperparameters)</span>
            </h2>
            <p className="text-xs text-zinc-500 mt-1">
              调整认知审计模型中关于用户构思打字、模型阅读消化以及跨日闲置截断的计算超参数
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label htmlFor="typing-speed-input" className="text-xs text-zinc-400">
                用户键入构思基线 (字符/秒)
              </label>
              <input
                id="typing-speed-input"
                type="number"
                step="0.5"
                value={form.typing_chars_per_sec}
                onInput={(e) =>
                  setForm({
                    ...form,
                    typing_chars_per_sec: Number((e.target as HTMLInputElement).value),
                  })
                }
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 outline-none"
              />
              <p className="text-[11px] text-zinc-500">
                默认 5.0 字符/秒（约 150 汉字/分钟），用于评估用户在输入框中推敲提示词的时间。
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="reading-speed-input" className="text-xs text-zinc-400">
                模型回答阅读基线 (Tokens/秒)
              </label>
              <input
                id="reading-speed-input"
                type="number"
                step="0.5"
                value={form.reading_tokens_per_sec}
                onInput={(e) =>
                  setForm({
                    ...form,
                    reading_tokens_per_sec: Number((e.target as HTMLInputElement).value),
                  })
                }
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 outline-none"
              />
              <p className="text-[11px] text-zinc-500">
                默认 8.0 tokens/秒（约 480 tokens/分钟），评估吸收和理解模型长回复的心智消耗。
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="base-chunk-input" className="text-xs text-zinc-400">
                单块往返交互基线 (秒)
              </label>
              <input
                id="base-chunk-input"
                type="number"
                value={form.base_chunk_seconds}
                onInput={(e) =>
                  setForm({
                    ...form,
                    base_chunk_seconds: Number((e.target as HTMLInputElement).value),
                  })
                }
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 outline-none"
              />
              <p className="text-[11px] text-zinc-500">
                每轮往返的上下文切换最小基准耗时（默认 15 秒）。
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="idle-timeout-input" className="text-xs text-zinc-400">
                会话空闲截断阈值 (分钟)
              </label>
              <input
                id="idle-timeout-input"
                type="number"
                value={form.idle_timeout_minutes}
                onInput={(e) =>
                  setForm({
                    ...form,
                    idle_timeout_minutes: Number((e.target as HTMLInputElement).value),
                  })
                }
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 outline-none"
              />
              <p className="text-[11px] text-zinc-500">
                交互间隔超过此阈值视作中断搁置，不计入连续生命周期，防止将隔夜闲置误判为耗时。
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: 运维与存储控制台 (正式版) */}
      {activeTab === 'operations' && (
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

                {/* 全量拉取危险确认弹层 */}
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
                        ⚠️
                        全量扫描将遍历云端所有历史文件，耗时较长并消耗较多网络配额，请确认代理通畅。
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
      )}

      {/* Tab 4: 系统健康探针 (正式版) */}
      {activeTab === 'diagnostics' && (
        <div className="space-y-6">
          <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-300 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity size={16} className="text-emerald-400 shrink-0" />
              <span>
                为确保日常页面秒开，健康度探针与 Schema 采样已配置为<strong>按需手动触发</strong>。
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isHealthLoading}
                onClick={runHealthDiagnostic}
                className="px-3 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded transition shadow-sm flex items-center gap-1.5 cursor-pointer"
              >
                {isHealthLoading ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Activity size={12} />
                )}
                <span>{healthData ? '刷新健康检测' : '立即运行全盘检测'}</span>
              </button>
              <button
                type="button"
                disabled={isSchemaLoading}
                onClick={() => runSchemaDiagnostic(300)}
                className="px-3 py-1 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 rounded border border-zinc-700 transition flex items-center gap-1.5 cursor-pointer"
              >
                {isSchemaLoading ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Layers size={12} />
                )}
                <span>采样 Schema 拓扑</span>
              </button>
            </div>
          </div>

          {/* 健康检测报告渲染区域 */}
          {healthData && (
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* 物理与表一致性四大卡片 */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
                <div className="p-3.5 bg-zinc-900/60 border border-zinc-800 rounded-lg">
                  <div className="text-[11px] text-zinc-400">主库 / WAL 体积</div>
                  <div className="text-base font-bold text-white font-mono mt-0.5">
                    {healthData.physical.db_size_human}
                  </div>
                  <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                    WAL: {healthData.physical.wal_size_human}
                  </div>
                </div>

                <div className="p-3.5 bg-zinc-900/60 border border-zinc-800 rounded-lg">
                  <div className="text-[11px] text-zinc-400">碎片空闲占比 (Freelist)</div>
                  <div
                    className={`text-base font-bold font-mono mt-0.5 ${
                      healthData.physical.frag_ratio > 15 ? 'text-amber-400' : 'text-emerald-400'
                    }`}
                  >
                    {healthData.physical.frag_ratio}%
                  </div>
                  <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                    碎片空间: {healthData.physical.freelist_human}
                  </div>
                </div>

                <div className="p-3.5 bg-zinc-900/60 border border-zinc-800 rounded-lg">
                  <div className="text-[11px] text-zinc-400">索引与数据一致性</div>
                  <div className="text-base font-bold text-white font-mono mt-0.5">
                    {healthData.schema_counts.is_aligned ? (
                      <span className="text-emerald-400 flex items-center gap-1">
                        <Check size={14} /> 100% 对齐
                      </span>
                    ) : (
                      <span className="text-amber-400 flex items-center gap-1">
                        <AlertTriangle size={14} /> 待对齐
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                    缓存 {healthData.schema_counts.file_cache} / 索引{' '}
                    {healthData.schema_counts.session_index}
                  </div>
                </div>

                <div className="p-3.5 bg-zinc-900/60 border border-zinc-800 rounded-lg">
                  <div className="text-[11px] text-zinc-400">SQLite 完整性校验</div>
                  <div className="text-base font-bold text-emerald-400 font-mono mt-0.5">
                    {healthData.physical.integrity_check}
                  </div>
                  <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                    探测耗时: {healthData.physical.check_time_seconds}s
                  </div>
                </div>
              </div>

              {/* 核心指标分位数阶梯表 */}
              <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
                    <LineChart size={15} className="text-indigo-400" />
                    <span>核心指标分位数阶梯 (Quantile Distributions)</span>
                  </h3>
                  <span className="text-xs font-mono text-zinc-400">
                    样本总量: {healthData.cognitive_buckets.total_sessions} 场
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="text-[11px] text-zinc-400 border-b border-zinc-800 bg-zinc-950/40">
                      <tr>
                        <th className="py-2 px-3">指标项</th>
                        <th className="py-2 px-2 text-right">Min</th>
                        <th className="py-2 px-2 text-right">P10</th>
                        <th className="py-2 px-2 text-right text-indigo-300">P50 (中位)</th>
                        <th className="py-2 px-2 text-right">P75</th>
                        <th className="py-2 px-2 text-right">P90</th>
                        <th className="py-2 px-2 text-right">P99</th>
                        <th className="py-2 px-3 text-right">Max</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/40 text-zinc-300">
                      <tr>
                        <td className="py-2.5 px-3 text-zinc-200 font-medium">对话轮次 (Turns)</td>
                        <td className="py-2.5 px-2 text-right">{healthData.quantiles.turns.min}</td>
                        <td className="py-2.5 px-2 text-right">{healthData.quantiles.turns.p10}</td>
                        <td className="py-2.5 px-2 text-right text-indigo-300 font-bold">
                          {healthData.quantiles.turns.p50}
                        </td>
                        <td className="py-2.5 px-2 text-right">{healthData.quantiles.turns.p75}</td>
                        <td className="py-2.5 px-2 text-right">{healthData.quantiles.turns.p90}</td>
                        <td className="py-2.5 px-2 text-right">{healthData.quantiles.turns.p99}</td>
                        <td className="py-2.5 px-3 text-right">{healthData.quantiles.turns.max}</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 text-zinc-200 font-medium">Token 消耗规模</td>
                        <td className="py-2.5 px-2 text-right">
                          {healthData.quantiles.tokens.min.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-2 text-right">
                          {healthData.quantiles.tokens.p10.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-2 text-right text-indigo-300 font-bold">
                          {healthData.quantiles.tokens.p50.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-2 text-right">
                          {healthData.quantiles.tokens.p75.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-2 text-right">
                          {healthData.quantiles.tokens.p90.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-2 text-right">
                          {healthData.quantiles.tokens.p99.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {healthData.quantiles.tokens.max.toLocaleString()}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 text-zinc-200 font-medium">思考链 (Thinking)</td>
                        <td className="py-2.5 px-2 text-right">
                          {healthData.quantiles.thought.min.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-2 text-right">
                          {healthData.quantiles.thought.p10.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-2 text-right text-indigo-300 font-bold">
                          {healthData.quantiles.thought.p50.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-2 text-right">
                          {healthData.quantiles.thought.p75.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-2 text-right">
                          {healthData.quantiles.thought.p90.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-2 text-right">
                          {healthData.quantiles.thought.p99.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {healthData.quantiles.thought.max.toLocaleString()}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 text-zinc-200 font-medium">持续时长 (分钟)</td>
                        <td className="py-2.5 px-2 text-right">
                          {healthData.quantiles.duration.min}m
                        </td>
                        <td className="py-2.5 px-2 text-right">
                          {healthData.quantiles.duration.p10}m
                        </td>
                        <td className="py-2.5 px-2 text-right text-indigo-300 font-bold">
                          {healthData.quantiles.duration.p50}m
                        </td>
                        <td className="py-2.5 px-2 text-right">
                          {healthData.quantiles.duration.p75}m
                        </td>
                        <td className="py-2.5 px-2 text-right">
                          {healthData.quantiles.duration.p90}m
                        </td>
                        <td className="py-2.5 px-2 text-right">
                          {healthData.quantiles.duration.p99}m
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {healthData.quantiles.duration.max}m
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Top 3 离群怪兽样本排查 (支持点击穿透直达) */}
              <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
                      <Flame size={15} className="text-red-400" />
                      <span>长尾离群怪兽样本排查 (Top Outliers)</span>
                    </h3>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      排查易造成反序列化卡顿或算力激增的极端样本，点击任意卡片即可在右侧抽屉直接展开该会话。
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* 体积最大 Top 3 */}
                  <div className="p-3 bg-zinc-950/60 border border-zinc-800 rounded-lg space-y-2.5">
                    <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1">
                      <span>📦 单条原始 JSON 体积 Top 3</span>
                    </span>
                    <div className="space-y-1.5">
                      {healthData.outliers.largest_files.map((item, idx) => (
                        <button
                          type="button"
                          key={item.file_id}
                          onClick={() => openOutlierSession(item.file_id, item.name)}
                          className="w-full text-left p-2 rounded bg-zinc-900/80 hover:bg-zinc-800/80 border border-zinc-800/80 transition flex items-center justify-between cursor-pointer group"
                        >
                          <div className="min-w-0 pr-2">
                            <div className="text-xs font-medium text-zinc-200 truncate group-hover:text-indigo-400">
                              #{idx + 1} {item.name}
                            </div>
                            <div className="text-[10px] text-zinc-500 font-mono">
                              {item.turn_count} 轮 · {item.total_tokens.toLocaleString()} tok
                            </div>
                          </div>
                          <span className="text-xs font-mono font-bold text-amber-400 shrink-0">
                            {item.byte_len_human}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Token 能耗 Top 3 */}
                  <div className="p-3 bg-zinc-950/60 border border-zinc-800 rounded-lg space-y-2.5">
                    <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1">
                      <span>⚡ Token 能耗最高 Top 3</span>
                    </span>
                    <div className="space-y-1.5">
                      {healthData.outliers.top_tokens.map((item, idx) => (
                        <button
                          type="button"
                          key={item.file_id}
                          onClick={() => openOutlierSession(item.file_id, item.name)}
                          className="w-full text-left p-2 rounded bg-zinc-900/80 hover:bg-zinc-800/80 border border-zinc-800/80 transition flex items-center justify-between cursor-pointer group"
                        >
                          <div className="min-w-0 pr-2">
                            <div className="text-xs font-medium text-zinc-200 truncate group-hover:text-indigo-400">
                              #{idx + 1} {item.name}
                            </div>
                            <div className="text-[10px] text-zinc-500 font-mono">
                              思考链: {item.thought_tokens.toLocaleString()} tok
                            </div>
                          </div>
                          <span className="text-xs font-mono font-bold text-indigo-400 shrink-0">
                            {item.total_tokens.toLocaleString()}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 轮次最深 Top 3 */}
                  <div className="p-3 bg-zinc-950/60 border border-zinc-800 rounded-lg space-y-2.5">
                    <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1">
                      <span>🔄 对话轮次最深 Top 3</span>
                    </span>
                    <div className="space-y-1.5">
                      {healthData.outliers.top_turns.map((item, idx) => (
                        <button
                          type="button"
                          key={item.file_id}
                          onClick={() => openOutlierSession(item.file_id, item.name)}
                          className="w-full text-left p-2 rounded bg-zinc-900/80 hover:bg-zinc-800/80 border border-zinc-800/80 transition flex items-center justify-between cursor-pointer group"
                        >
                          <div className="min-w-0 pr-2">
                            <div className="text-xs font-medium text-zinc-200 truncate group-hover:text-indigo-400">
                              #{idx + 1} {item.name}
                            </div>
                            <div className="text-[10px] text-zinc-500 font-mono">
                              时长: {item.duration_human}
                            </div>
                          </div>
                          <span className="text-xs font-mono font-bold text-emerald-400 shrink-0">
                            {item.turn_count} 轮
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* Schema 骨架分析报告渲染 */}
          {schemaData && (
            <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5 space-y-4 animate-in fade-in duration-300">
              <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
                <Layers size={15} className="text-cyan-400" />
                <span>数据 Schema 拓扑与载荷形态分布 (采样 {schemaData.sampled_records} 篇)</span>
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-zinc-400">Chunk 对话载荷形态分布</div>
                  <div className="space-y-1.5">
                    {schemaData.payload_types.map((p) => (
                      <div
                        key={p.type}
                        className="flex items-center justify-between p-2 rounded bg-zinc-950/60 border border-zinc-800/60 text-xs font-mono"
                      >
                        <span className="text-zinc-300">形态: [{p.type}]</span>
                        <span className="text-indigo-400 font-bold">{p.count} 次</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-zinc-400">顶层 Key 覆盖频率</div>
                  <div className="space-y-1.5">
                    {schemaData.top_level_keys.map((k) => (
                      <div
                        key={k.key}
                        className="flex items-center justify-between p-2 rounded bg-zinc-950/60 border border-zinc-800/60 text-xs font-mono"
                      >
                        <span className="text-zinc-300">{k.key}</span>
                        <span className="text-emerald-400">
                          {k.count} ({k.ratio}%)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}

          {!healthData && !schemaData && (
            <div className="py-20 text-center text-xs text-zinc-500 space-y-2 border border-dashed border-zinc-800 rounded-lg">
              <div>暂未运行诊断。请点击右上角【立即运行全盘检测】生成最新健康报告。</div>
            </div>
          )}
        </div>
      )}

      {/* 离群怪兽样本抽屉查看面板 */}
      {outlierSession && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-4xl bg-zinc-950 h-full shadow-2xl border-l border-zinc-800 flex flex-col p-4 sm:p-6 overflow-hidden animate-in slide-in-from-right duration-300">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800 mb-4">
              <span className="text-xs font-mono text-amber-400 font-semibold flex items-center gap-1.5">
                <Flame size={14} />
                <span>离群样本穿透审查: {outlierSession.name}</span>
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
      )}

      {/* 常驻运维终端抽屉 */}
      <OpsTerminalDrawer />
    </div>
  );
}
