import type { ChartConfiguration } from 'chart.js';
import { useMemo } from 'preact/hooks';
import type { DailyTrendItem } from '../../types/metrics';
import { BaseChart } from './base/BaseChart';
import { CHART_PALETTE, defaultDarkScales, defaultDarkTooltipOptions } from './base/chartTheme';

interface Props {
  data: DailyTrendItem[];
}

export function TokenTrendChart({ data }: Props) {
  const chartConfig = useMemo<ChartConfiguration<'line'>>(() => {
    const labels = data.map((d) => d.date);
    const totalTokens = data.map((d) => d.total_tokens);
    const thoughtTokens = data.map((d) => d.thought_tokens);

    return {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '总 Token 消耗',
            data: totalTokens,
            borderColor: CHART_PALETTE.indigo,
            backgroundColor: CHART_PALETTE.indigoBg,
            fill: true,
            tension: 0.3,
            borderWidth: 2,
            pointRadius: labels.length > 40 ? 0 : 2.5,
            pointHoverRadius: 5,
          },
          {
            label: '思考链 (Thinking) 消耗',
            data: thoughtTokens,
            borderColor: CHART_PALETTE.emerald,
            backgroundColor: CHART_PALETTE.emeraldBg,
            fill: true,
            tension: 0.3,
            borderWidth: 1.8,
            pointRadius: labels.length > 40 ? 0 : 2.5,
            pointHoverRadius: 5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: CHART_PALETTE.textSecondary,
              font: { size: 11 },
              boxWidth: 12,
              usePointStyle: true,
            },
          },
          tooltip: {
            ...defaultDarkTooltipOptions,
            callbacks: {
              label(context) {
                const val = Number(context.raw) || 0;
                return ` ${context.dataset.label}: ${val.toLocaleString()} tokens`;
              },
            },
          },
        },
        scales: {
          x: {
            ...defaultDarkScales.x,
            ticks: {
              ...defaultDarkScales.x.ticks,
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 12,
            },
          },
          y: {
            ...defaultDarkScales.y,
            ticks: {
              ...defaultDarkScales.y.ticks,
              callback(value) {
                const num = Number(value);
                if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
                if (num >= 1_000) return `${(num / 1_000).toFixed(0)}k`;
                return num;
              },
            },
          },
        },
      },
    };
  }, [data]);

  return <BaseChart config={chartConfig} heightClass="h-72" />;
}
