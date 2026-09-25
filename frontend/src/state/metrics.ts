import { signal } from '@preact/signals';
import type { MetricsSummary } from '../types/metrics';

export type TimeRange = '7d' | '30d' | '90d' | 'this_year' | 'all';

export const TIME_RANGE_OPTIONS: { key: TimeRange; label: string }[] = [
  { key: '7d', label: '7天' },
  { key: '30d', label: '30天' },
  { key: '90d', label: '90天' },
  { key: 'this_year', label: '今年' },
  { key: 'all', label: '全部' },
];

export const timeRangeSignal = signal<TimeRange>('all');
export const metricsSignal = signal<MetricsSummary | null>(null);
export const metricsLoadingSignal = signal<boolean>(true);

export async function fetchMetrics(range: TimeRange = timeRangeSignal.value) {
  if (!metricsSignal.value) {
    metricsLoadingSignal.value = true;
  }
  try {
    const res = await fetch(`/api/metrics?range=${range}`);
    const data = await res.json();
    metricsSignal.value = data;
  } catch (err) {
    console.error('加载审计指标失败:', err);
  } finally {
    metricsLoadingSignal.value = false;
  }
}

export function setTimeRange(newRange: TimeRange) {
  timeRangeSignal.value = newRange;
}
