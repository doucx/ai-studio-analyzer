import { signal } from '@preact/signals';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  durationMs: number;
}

export const toastsSignal = signal<ToastItem[]>([]);

export function addToast(message: string, type: ToastType = 'info', durationMs = 4000) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const newToast: ToastItem = { id, type, message, durationMs };

  toastsSignal.value = [...toastsSignal.value, newToast];

  if (durationMs > 0) {
    setTimeout(() => {
      removeToast(id);
    }, durationMs);
  }
}

export function removeToast(id: string) {
  toastsSignal.value = toastsSignal.value.filter((t) => t.id !== id);
}