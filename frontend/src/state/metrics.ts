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
export const customStartDateSignal = signal<string | null>(null);
export const customEndDateSignal = signal<string | null>(null);

export const metricsSignal = signal<MetricsSummary | null>(null);
export const metricsLoadingSignal = signal<boolean>(true);
export const todayMetricsSignal = signal<DailyTimelineItem | null>(null);
export const allDailyTrendsSignal = signal<DailyTrendItem[]>([]);

export async function fetchAllDailyTrends() {
  if (allDailyTrendsSignal.value.length > 0) return;
  try {
    const res = await fetch('/api/metrics?range=all');
    if (res.ok) {
      const data: MetricsSummary = await res.json();
      if (data.daily_trends) {
        allDailyTrendsSignal.value = data.daily_trends;
      }
    }
  } catch (err) {
    console.error('加载全量历史时序趋势失败:', err);
  }
}

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

export async function fetchMetrics(
  range: TimeRange = timeRangeSignal.value,
  start: string | null = customStartDateSignal.value,
  end: string | null = customEndDateSignal.value,
) {
  if (!metricsSignal.value) {
    metricsLoadingSignal.value = true;
  }
  try {
    let url = `/api/metrics?range=${range}`;
    if (start) url += `&start=${encodeURIComponent(start)}`;
    if (end) url += `&end=${encodeURIComponent(end)}`;
    const res = await fetch(url);
    const data = await res.json();
    metricsSignal.value = data;
    if (range === 'all' && !start && !end && data.daily_trends) {
      allDailyTrendsSignal.value = data.daily_trends;
    }
  } catch (err) {
    console.error('加载审计指标失败:', err);
  } finally {
    metricsLoadingSignal.value = false;
  }
}

export function setTimeRange(newRange: TimeRange) {
  timeRangeSignal.value = newRange;
  customStartDateSignal.value = null;
  customEndDateSignal.value = null;
}

export function setCustomDateRange(start: string, end: string) {
  customStartDateSignal.value = start;
  customEndDateSignal.value = end;
}
