import { signal } from '@preact/signals';
import type { SessionItem } from '../types/metrics';
import { timeRangeSignal } from './metrics';

export const sessionsSignal = signal<SessionItem[]>([]);
export const selectedSessionSignal = signal<SessionItem | null>(null);
export const sessionsLoadingSignal = signal<boolean>(true);
export const sidebarCollapsedSignal = signal<boolean>(false);

export async function fetchSessions(range = timeRangeSignal.value) {
  if (sessionsSignal.value.length === 0) {
    sessionsLoadingSignal.value = true;
  }
  try {
    const res = await fetch(`/api/sessions?range=${range}`);
    const data = await res.json();
    sessionsSignal.value = data;
  } catch (err) {
    console.error('加载会话列表失败:', err);
  } finally {
    sessionsLoadingSignal.value = false;
  }
}

export function selectSession(session: SessionItem | null) {
  selectedSessionSignal.value = session;
}

export function toggleSidebar() {
  sidebarCollapsedSignal.value = !sidebarCollapsedSignal.value;
}