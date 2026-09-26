import {
  Activity,
  Check,
  Cpu,
  Database,
  Globe,
  Loader2,
  Save,
  Sliders,
  Wrench,
} from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
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

  return (
    <div className="max-w-5xl mx-auto w-full p-4 md:p-6 space-y-6">
      {/* 头部标题与保存指示条 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Sliders size={20} className="text-indigo-400" />
            <span>系统与控制中心</span>
            <span className="text-[10px] font-mono uppercase bg-indigo-950/80 text-indigo-400 border border-indigo-800/60 px-1.5 py-0.5 rounded font-normal">
              v0.2 Workstation
            </span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            管理代理网络、同步策略与度量超参数；查看存储重整与底层诊断规划
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
            <span>{isSaving ? '正在保存...' : '保存当前配置'}</span>
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
          <span>运维与存储 (维护)</span>
          <span className="text-[9px] bg-zinc-700/80 px-1 py-0.2 rounded text-zinc-300 font-mono">
            骨架
          </span>
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
          <span className="text-[9px] bg-zinc-700/80 px-1 py-0.2 rounded text-zinc-300 font-mono">
            骨架
          </span>
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

      {/* Tab 3: 运维与存储 (骨架) */}
      {activeTab === 'operations' && (
        <div className="space-y-5">
          <div className="p-3 bg-amber-950/20 border border-amber-900/40 rounded-lg text-xs text-amber-300">
            💡
            【运维与存储中心】属于命令式重型操作区域，目前处于架构骨架阶段，后续将把终端脚本完整接入至此。
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-zinc-900/30 border border-zinc-800/80 rounded-lg p-5 space-y-3 opacity-90">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-zinc-200">全量全盘扫描同步</span>
                <span className="text-[10px] text-amber-400 bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-800/50">
                  待接入
                </span>
              </div>
              <p className="text-xs text-zinc-500 leading-relaxed">
                遍历 Google Drive 目标文件夹中的所有历史 JSON
                并增量补全本地缓存。附带网络风险与配额提示。
              </p>
              <button
                type="button"
                disabled
                className="px-3 py-1.5 text-xs rounded bg-zinc-800/60 text-zinc-500 cursor-not-allowed border border-zinc-700/40"
              >
                全量拉取 (All Files)
              </button>
            </div>

            <div className="bg-zinc-900/30 border border-zinc-800/80 rounded-lg p-5 space-y-3 opacity-90">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-zinc-200">索引与 FTS 虚表重建</span>
                <span className="text-[10px] text-amber-400 bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-800/50">
                  待接入
                </span>
              </div>
              <p className="text-xs text-zinc-500 leading-relaxed">
                迁移整合 <code>reindex_cli.py</code>，支持分批 Checkpoint 进度条广播与 FTS5 Trigram
                倒排重建。
              </p>
              <button
                type="button"
                disabled
                className="px-3 py-1.5 text-xs rounded bg-zinc-800/60 text-zinc-500 cursor-not-allowed border border-zinc-700/40"
              >
                一键重建索引 (Reindex)
              </button>
            </div>

            <div className="bg-zinc-900/30 border border-zinc-800/80 rounded-lg p-5 space-y-3 opacity-90">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-zinc-200">WAL 日志截断与合并</span>
                <span className="text-[10px] text-amber-400 bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-800/50">
                  待接入
                </span>
              </div>
              <p className="text-xs text-zinc-500 leading-relaxed">
                显式触发 <code>PRAGMA wal_checkpoint(TRUNCATE)</code>，将 <code>cache.db-wal</code>{' '}
                安全刷回主库并释放磁盘空间。
              </p>
              <button
                type="button"
                disabled
                className="px-3 py-1.5 text-xs rounded bg-zinc-800/60 text-zinc-500 cursor-not-allowed border border-zinc-700/40"
              >
                合并 WAL 日志
              </button>
            </div>

            <div className="bg-zinc-900/30 border border-zinc-800/80 rounded-lg p-5 space-y-3 opacity-90">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-zinc-200">碎片整理与磁盘压缩</span>
                <span className="text-[10px] text-amber-400 bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-800/50">
                  待接入
                </span>
              </div>
              <p className="text-xs text-zinc-500 leading-relaxed">
                执行 SQLite <code>VACUUM</code> 整理 Freelist
                碎片并重构数据库物理页面（需排他写锁）。
              </p>
              <button
                type="button"
                disabled
                className="px-3 py-1.5 text-xs rounded bg-zinc-800/60 text-zinc-500 cursor-not-allowed border border-zinc-700/40"
              >
                执行 VACUUM 压缩
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: 系统健康探针 (骨架) */}
      {activeTab === 'diagnostics' && (
        <div className="space-y-5">
          <div className="p-3 bg-emerald-950/20 border border-emerald-900/40 rounded-lg text-xs text-emerald-300">
            🩺
            【系统健康探针】用于可视化审查数据库物理状态与数据拓扑，当前为骨架视图，后续将直接按需触发脚本。
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-zinc-900/30 border border-zinc-800/80 rounded-lg p-5 space-y-3 opacity-90">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-zinc-200">健康度诊断与离群值探针</span>
                <span className="text-[10px] text-emerald-400 bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-800/50">
                  对应 inspect_health.py
                </span>
              </div>
              <p className="text-xs text-zinc-500 leading-relaxed">
                呈现数据库体积、WAL
                开销、碎片空闲率、指标分位数阶梯以及体积/耗能前列的“怪兽离群样本”。
              </p>
              <button
                type="button"
                disabled
                className="px-3 py-1.5 text-xs rounded bg-zinc-800/60 text-zinc-500 cursor-not-allowed border border-zinc-700/40"
              >
                运行健康检测 (按需触发)
              </button>
            </div>

            <div className="bg-zinc-900/30 border border-zinc-800/80 rounded-lg p-5 space-y-3 opacity-90">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-zinc-200">
                  缓存数据 Schema 骨架探针
                </span>
                <span className="text-[10px] text-emerald-400 bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-800/50">
                  对应 inspect_schema.py
                </span>
              </div>
              <p className="text-xs text-zinc-500 leading-relaxed">
                抽样分析会话数据形态、统计顶层字段频率及 Chunks 载荷结构（文本 / 内联文件 /
                云盘挂载）。
              </p>
              <button
                type="button"
                disabled
                className="px-3 py-1.5 text-xs rounded bg-zinc-800/60 text-zinc-500 cursor-not-allowed border border-zinc-700/40"
              >
                采样分析 Schema (按需触发)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
