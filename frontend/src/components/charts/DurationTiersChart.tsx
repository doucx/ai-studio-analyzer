import type { ChartConfiguration } from 'chart.js';
import { useMemo } from 'preact/hooks';
import { BaseChart } from './base/BaseChart';
import { CHART_PALETTE, defaultDarkTooltipOptions } from './base/chartTheme';

interface Props {
  tiers: {
    flash: [number, string];
    focus: [number, string];
    deep: [number, string];
    epic: [number, string];
  };
  onSelectTier?: (tierKey: 'flash' | 'focus' | 'deep' | 'epic') => void;
}

export function DurationTiersChart({ tiers, onSelectTier }: Props) {
  const chartConfig = useMemo<ChartConfiguration<'doughnut'>>(() => {
    const labels = ['即时快问 (<10m)', '聚焦推进 (10~60m)', '深度攻坚 (1~6h)', '跨日长线 (>6h)'];
    const dataValues = [tiers.flash[0], tiers.focus[0], tiers.deep[0], tiers.epic[0]];

    return {
      type: 'doughnut',
      data: {
        labels,
        datasets: [
          {
            data: dataValues,
            backgroundColor: [
              CHART_PALETTE.sky,
              CHART_PALETTE.indigo,
              CHART_PALETTE.amber,
              CHART_PALETTE.red,
            ],
            borderColor: '#18181b',
            borderWidth: 2,
            hoverOffset: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        onHover: (event, elements) => {
          if (event.native?.target) {
            (event.native.target as HTMLElement).style.cursor = elements.length
              ? 'pointer'
              : 'default';
          }
        },
        onClick: (_event, elements) => {
          if (elements.length > 0 && onSelectTier) {
            const tierKeys: ('flash' | 'focus' | 'deep' | 'epic')[] = [
              'flash',
              'focus',
              'deep',
              'epic',
            ];
            const idx = elements[0].index;
            if (tierKeys[idx]) {
              onSelectTier(tierKeys[idx]);
            }
          }
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: CHART_PALETTE.textSecondary,
              font: { size: 10.5 },
              boxWidth: 10,
              padding: 12,
              usePointStyle: true,
            },
          },
          tooltip: {
            ...defaultDarkTooltipOptions,
            callbacks: {
              label(context) {
                const total = dataValues.reduce((a, b) => a + b, 0);
                const val = Number(context.raw) || 0;
                const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0';
                return ` ${context.label}: ${val} 场 (${pct}%) · 点击下钻`;
              },
            },
          },
        },
      },
    };
  }, [tiers, onSelectTier]);

  return <BaseChart config={chartConfig} heightClass="h-64" />;
}
