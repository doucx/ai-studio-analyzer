import { signal } from '@preact/signals';

export const syncInProgressSignal = signal<boolean>(false);
export const syncProgressTextSignal = signal<string>('');

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
