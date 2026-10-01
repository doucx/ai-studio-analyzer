import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Globe,
  KeyRound,
  Loader2,
  LogOut,
} from 'lucide-preact';
import { useEffect } from 'preact/hooks';
import type { SystemConfig } from '../../state/settings';
import {
  authLoadingSignal,
  authStatusSignal,
  fetchAuthStatus,
  proxyTestResultSignal,
  proxyTestingSignal,
  testProxy,
  triggerGoogleLogin,
  triggerGoogleLogout,
} from '../../state/settings';

interface Props {
  form: SystemConfig;
  setForm: (cfg: SystemConfig) => void;
}

export function GeneralTab({ form, setForm }: Props) {
  const isTesting = proxyTestingSignal.value;
  const testResult = proxyTestResultSignal.value;
  const authStatus = authStatusSignal.value;
  const isAuthLoading = authLoadingSignal.value;

  useEffect(() => {
    fetchAuthStatus();
  }, []);

  return (
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
              onInput={(e) => setForm({ ...form, proxy_url: (e.target as HTMLInputElement).value })}
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
            <Database size={15} className="text-indigo-400" />
            <span>Google 云端凭据与授权状态</span>
          </h2>
          <div className="flex items-center gap-2">
            {authStatus &&
              (authStatus.has_token && !authStatus.is_expired ? (
                <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded flex items-center gap-1">
                  <CheckCircle2 size={12} /> 授权有效中
                </span>
              ) : (
                <span className="text-[11px] font-mono text-amber-400 bg-amber-950/60 border border-amber-800/60 px-2 py-0.5 rounded flex items-center gap-1">
                  <AlertTriangle size={12} /> 未授权或令牌已失效
                </span>
              ))}
          </div>
        </div>

        {/* 交互式授权操作栏 */}
        <div className="p-3.5 rounded-lg bg-zinc-950 border border-zinc-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="space-y-1">
            <div className="font-medium text-zinc-200 flex items-center gap-1.5">
              <KeyRound size={14} className="text-amber-400" />
              <span>Google 账号 OAuth 鉴权管理</span>
            </div>
            <p className="text-[11px] text-zinc-500">
              {authStatus?.has_credentials
                ? authStatus.has_token && !authStatus.is_expired
                  ? '凭据与令牌就绪，可随时重新鉴权以刷新访问凭证。'
                  : 'Token 凭据已过期或被撤销，请点击右侧按钮拉起浏览器重新完成授权。'
                : `⚠️ 缺少凭据文件: 请确保将 Google Cloud 下载的 credentials.json 放入 ${authStatus?.creds_path || '.cache/credentials.json'}`}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={isAuthLoading || !authStatus?.has_credentials}
              onClick={triggerGoogleLogin}
              className="px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded transition shadow-sm flex items-center gap-1.5 cursor-pointer"
            >
              {isAuthLoading ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <KeyRound size={13} />
              )}
              <span>{isAuthLoading ? '正在拉起浏览器...' : '登录 / 重新授权'}</span>
            </button>

            {authStatus?.has_token && (
              <button
                type="button"
                disabled={isAuthLoading}
                onClick={triggerGoogleLogout}
                className="px-2.5 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 rounded border border-zinc-700 transition flex items-center gap-1 cursor-pointer"
                title="清除本地保存的 token.json"
              >
                <LogOut size={13} />
                <span>注销</span>
              </button>
            )}
          </div>
        </div>

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

          <div className="space-y-1.5">
            <label htmlFor="creds-path-input" className="text-xs text-zinc-400">
              OAuth 凭据文件路径 (Credentials File)
            </label>
            <input
              id="creds-path-input"
              type="text"
              value={form.creds_path}
              onInput={(e) =>
                setForm({ ...form, creds_path: (e.target as HTMLInputElement).value })
              }
              className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 outline-none"
            />
          </div>
        </div>
      </section>

      <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
            <Activity size={15} className="text-indigo-400" />
            <span>视口唤醒与后台自动增量同步</span>
          </h2>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.auto_sync_enabled}
              onChange={(e) =>
                setForm({ ...form, auto_sync_enabled: (e.target as HTMLInputElement).checked })
              }
              className="w-4 h-4 rounded bg-zinc-950 border-zinc-700 text-indigo-600 focus:ring-0 cursor-pointer"
            />
            <span className="text-xs text-zinc-300">启用页面切回自动同步</span>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="sync-interval-input" className="text-xs text-zinc-400">
              切回唤醒最小冷却时间 (秒)
            </label>
            <input
              id="sync-interval-input"
              type="number"
              disabled={!form.auto_sync_enabled}
              value={form.auto_sync_interval}
              onInput={(e) =>
                setForm({
                  ...form,
                  auto_sync_interval: Number((e.target as HTMLInputElement).value),
                })
              }
              className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 disabled:opacity-50 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 outline-none"
            />
            <p className="text-[11px] text-zinc-500">
              离开标签页后重新切回时，超过此冷却阈值才会静默探测 Google 云端更新。
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="sync-limit-input" className="text-xs text-zinc-400">
              增量自动拉取条目数 (篇)
            </label>
            <input
              id="sync-limit-input"
              type="number"
              disabled={!form.auto_sync_enabled}
              value={form.auto_sync_limit}
              onInput={(e) =>
                setForm({
                  ...form,
                  auto_sync_limit: Number((e.target as HTMLInputElement).value),
                })
              }
              className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 disabled:opacity-50 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 outline-none"
            />
            <p className="text-[11px] text-zinc-500">
              每次自动唤醒触发时按最近修改时间拉取的最大对话篇数（推荐 10~30 篇）。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
