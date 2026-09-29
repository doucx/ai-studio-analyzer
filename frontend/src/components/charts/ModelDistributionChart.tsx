import type { ChartConfiguration } from 'chart.js';
import { useMemo } from 'preact/hooks';
import { BaseChart } from './base/BaseChart';
import { CHART_PALETTE, defaultDarkScales, defaultDarkTooltipOptions } from './base/chartTheme';

interface Props {
  distribution: Record<string, number>;
  onSelectModel?: (model: string) => void;
}

export function ModelDistributionChart({ distribution, onSelectModel }: Props) {
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
        onHover: (event, elements) => {
          if (event.native?.target) {
            (event.native.target as HTMLElement).style.cursor = elements.length
              ? 'pointer'
              : 'default';
          }
        },
        onClick: (_event, elements) => {
          if (elements.length > 0 && onSelectModel) {
            const idx = elements[0].index;
            if (labels[idx]) {
              onSelectModel(labels[idx]);
            }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...defaultDarkTooltipOptions,
            callbacks: {
              label(context) {
                return ` 会话数: ${context.raw} 场 (点击下钻查看)`;
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
  }, [distribution, onSelectModel]);

  return <BaseChart config={chartConfig} heightClass="h-64" />;
}
