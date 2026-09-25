import { OverviewDashboard } from '../components/OverviewDashboard';
import {
  TIME_RANGE_OPTIONS,
  metricsLoadingSignal,
  metricsSignal,
  timeRangeSignal,
} from '../state/metrics';

export function OverviewRoute() {
  const metrics = metricsSignal.value;
  const isLoading = metricsLoadingSignal.value;
  const currentRange = timeRangeSignal.value;
  const activeRangeLabel = TIME_RANGE_OPTIONS.find((o) => o.key === currentRange)?.label || '全部';

  if (isLoading && !metrics) {
    return (
      <div className="py-24 text-center text-zinc-500 text-sm animate-pulse">
        正在从本地 SQLite 数据库聚合全景认知审计指标...
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="py-24 text-center text-zinc-500 text-sm">
        未检索到符合当前时间切片的统计指标
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto w-full p-4 md:p-6 overflow-y-auto">
      <OverviewDashboard metrics={metrics} activeRangeLabel={activeRangeLabel} />
    </div>
  );
}
