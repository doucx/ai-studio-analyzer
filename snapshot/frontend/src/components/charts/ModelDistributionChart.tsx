import type { ChartConfiguration } from 'chart.js';
import { useMemo } from 'preact/hooks';
import { BaseChart } from './base/BaseChart';
import { CHART_PALETTE, defaultDarkScales, defaultDarkTooltipOptions } from './base/chartTheme';

interface Props {
  distribution: Record<string, number>;
}

export function ModelDistributionChart({ distribution }: Props) {
  const chartConfig = useMemo<ChartConfiguration<'bar'>>(() => {
    const entries = Object.entries(distribution).sort((a, b) => b[1] - a[1]);
    const labels = entries.map(([m]) => m.replace('models/', ''));
    const dataValues = entries.map(([, count]) => count);

    return {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: '会话场数',
            data: dataValues,
            backgroundColor: 'rgba(99, 102, 241, 0.7)',
            hoverBackgroundColor: CHART_PALETTE.indigo,
            borderRadius: 4,
            borderSkipped: false,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...defaultDarkTooltipOptions,
            callbacks: {
              label(context) {
                return ` 会话数: ${context.raw} 场`;
              },
            },
          },
        },
        scales: {
          x: {
            ...defaultDarkScales.x,
            ticks: {
              ...defaultDarkScales.x.ticks,
              precision: 0,
            },
          },
          y: {
            grid: { display: false },
            ticks: {
              color: '#d4d4d8',
              font: { size: 11 },
            },
          },
        },
      },
    };
  }, [distribution]);

  return <BaseChart config={chartConfig} heightClass="h-64" />;
}