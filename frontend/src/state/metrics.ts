import { signal } from '@preact/signals';
import type { DailyTimelineItem, MetricsSummary } from '../types/metrics';

export type TimeRange = '1d' | '7d' | '30d' | '90d' | 'this_year' | 'all';

export const TIME_RANGE_OPTIONS: { key: TimeRange; label: string }[] = [
  { key: '1d', label: '1天' },
  { key: '7d', label: '7天' },
  { key: '30d', label: '30天' },
  { key: '90d', label: '90天' },
  { key: 'this_year', label: '今年' },
  { key: 'all', label: '全部' },
];

export const timeRangeSignal = signal<TimeRange>('all');
export const metricsSignal = signal<MetricsSummary | null>(null);
export const metricsLoadingSignal = signal<boolean>(true);
export const todayMetricsSignal = signal<DailyTimelineItem | null>(null);

export async function fetchTodayMetrics() {
  try {
    const res = await fetch('/api/daily/today');
    if (res.ok) {
      const data: DailyTimelineItem = await res.json();
      todayMetricsSignal.value = data;
    }
  } catch (err) {
    console.error('加载今日认知时量切片失败:', err);
  }
}

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
