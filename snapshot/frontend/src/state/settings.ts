import { signal } from '@preact/signals';

export interface SystemConfig {
  proxy_url: string;
  token_path: string;
  creds_path: string;
  target_folder_name: string;
  auto_sync_enabled: boolean;
  auto_sync_interval: number;
  auto_sync_limit: number;
  idle_timeout_minutes: number;
  typing_chars_per_sec: number;
  reading_tokens_per_sec: number;
  base_chunk_seconds: number;
}

export const defaultConfig: SystemConfig = {
  proxy_url: 'http://127.0.0.1:7890',
  token_path: 'token.json',
  creds_path: 'credentials.json',
  target_folder_name: 'Google AI Studio',
  auto_sync_enabled: true,
  auto_sync_interval: 90,
  auto_sync_limit: 20,
  idle_timeout_minutes: 30,
  typing_chars_per_sec: 5.0,
  reading_tokens_per_sec: 8.0,
  base_chunk_seconds: 15.0,
};

export const configSignal = signal<SystemConfig>(defaultConfig);
export const configLoadingSignal = signal<boolean>(false);
export const configSavingSignal = signal<boolean>(false);
export const proxyTestingSignal = signal<boolean>(false);
export const proxyTestResultSignal = signal<{ ok: boolean; message: string } | null>(null);

export async function fetchSettings(): Promise<void> {
  configLoadingSignal.value = true;
  try {
    const res = await fetch('/api/settings');
    if (res.ok) {
      const data = await res.json();
      configSignal.value = data;
    }
  } catch (err) {
    console.error('加载系统配置失败:', err);
  } finally {
    configLoadingSignal.value = false;
  }
}

export async function saveSettings(newConfig: Partial<SystemConfig>): Promise<boolean> {
  configSavingSignal.value = true;
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig),
    });
    if (res.ok) {
      const data = await res.json();
      configSignal.value = data.config;
      return true;
    }
    return false;
  } catch (err) {
    console.error('保存系统配置失败:', err);
    return false;
  } finally {
    configSavingSignal.value = false;
  }
}

export async function testProxy(proxyUrl: string): Promise<void> {
  proxyTestingSignal.value = true;
  proxyTestResultSignal.value = null;
  try {
    const res = await fetch('/api/settings/test-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proxy_url: proxyUrl }),
    });
    if (res.ok) {
      const data = await res.json();
      proxyTestResultSignal.value = data;
    }
  } catch (err) {
    proxyTestResultSignal.value = { ok: false, message: `测试网络异常: ${String(err)}` };
  } finally {
    proxyTestingSignal.value = false;
  }
}
