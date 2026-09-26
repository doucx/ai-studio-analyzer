import { signal } from '@preact/signals';

export const syncInProgressSignal = signal<boolean>(false);
export const syncProgressTextSignal = signal<string>('');
export const syncVersionSignal = signal<number>(0);

export async function triggerSync(limit = 50) {
  syncInProgressSignal.value = true;
  syncProgressTextSignal.value = '准备同步...';
  try {
    await fetch(`/api/sync?limit=${limit}`, { method: 'POST' });
  } catch (err) {
    console.error('触发同步失败:', err);
    syncInProgressSignal.value = false;
    syncProgressTextSignal.value = '';
  }
}

export function setupSyncEventListener(onSyncComplete: () => void): () => void {
  const eventSource = new EventSource('/api/sync/events');

  eventSource.addEventListener('sync_progress', (e) => {
    try {
      const data = JSON.parse(e.data);
      syncProgressTextSignal.value = `${data.current}/${data.total} (拉取:${data.downloaded})`;
    } catch {
      // 忽略解析错误
    }
  });

  eventSource.addEventListener('sync_done', () => {
    syncInProgressSignal.value = false;
    syncProgressTextSignal.value = '';
    syncVersionSignal.value += 1;
    onSyncComplete();
  });

  eventSource.addEventListener('sync_error', (e) => {
    console.error('同步异常:', e.data);
    syncInProgressSignal.value = false;
    syncProgressTextSignal.value = '';
  });

  return () => {
    eventSource.close();
  };
}

/**
 * 视口唤醒与窗口焦点感知自动同步监听器
 * 仅当用户切换回本标签页且距离上次同步超过 intervalMs 时静默触发
 */
export function setupAutoSyncOnFocus(intervalMs = 90_000, limit = 20): () => void {
  let lastSyncTime = Date.now();

  const handleCheckSync = () => {
    if (syncInProgressSignal.value) return;
    const now = Date.now();
    if (now - lastSyncTime >= intervalMs) {
      lastSyncTime = now;
      triggerSync(limit);
    }
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      handleCheckSync();
    }
  };

  window.addEventListener('focus', handleCheckSync);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  return () => {
    window.removeEventListener('focus', handleCheckSync);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}
