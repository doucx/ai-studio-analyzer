import { signal } from '@preact/signals';

export const syncInProgressSignal = signal<boolean>(false);
export const syncProgressTextSignal = signal<string>('');
export const syncVersionSignal = signal<number>(0);

import { addToast } from './toast';

export async function triggerSync(limit = 50) {
  syncInProgressSignal.value = true;
  syncProgressTextSignal.value = '准备同步...';
  try {
    const res = await fetch(`/api/sync?limit=${limit}`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'busy') {
        syncInProgressSignal.value = false;
        syncProgressTextSignal.value = '';
        addToast(data.message || '增量同步正在进行中，请勿重复触发', 'warning');
        return;
      }
    } else {
      syncInProgressSignal.value = false;
      syncProgressTextSignal.value = '';
      addToast(`触发同步请求失败 (HTTP ${res.status})`, 'error');
    }
  } catch (err) {
    console.error('触发同步失败:', err);
    syncInProgressSignal.value = false;
    syncProgressTextSignal.value = '';
    addToast(`网络异常，无法连接同步服务: ${String(err)}`, 'error');
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

  eventSource.addEventListener('sync_done', (e) => {
    syncInProgressSignal.value = false;
    syncProgressTextSignal.value = '';
    syncVersionSignal.value += 1;
    onSyncComplete();

    try {
      const result = JSON.parse(e.data);
      addToast(
        `增量同步完成：扫描 ${result.total_scanned} 篇，新增拉取 ${result.downloaded} 篇 (缓存总计: ${result.cache_total})`,
        'success',
        5000,
      );
    } catch {
      addToast('增量同步已顺利完成', 'success');
    }
  });

  eventSource.addEventListener('sync_error', (e) => {
    console.error('同步异常:', e.data);
    syncInProgressSignal.value = false;
    syncProgressTextSignal.value = '';

    let errorDetail = e.data;
    try {
      const parsed = JSON.parse(e.data);
      if (parsed.error) errorDetail = parsed.error;
    } catch {
      // 保留原始字符串
    }

    addToast(`同步任务异常中断: ${errorDetail}`, 'error', 7000);
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
