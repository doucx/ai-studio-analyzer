import type { ChartConfiguration } from 'chart.js';
import { useMemo } from 'preact/hooks';
import type { DailyTrendItem } from '../../types/metrics';
import { BaseChart } from './base/BaseChart';
import { CHART_PALETTE, defaultDarkScales, defaultDarkTooltipOptions } from './base/chartTheme';

export type TrendMode = 'tokens' | 'chunks' | 'sessions';

interface Props {
  data: DailyTrendItem[];
  mode?: TrendMode;
}

export function TokenTrendChart({ data, mode = 'tokens' }: Props) {
  const chartConfig = useMemo<ChartConfiguration<'line' | 'bar'>>(() => {
    const labels = data.map((d) => d.date);

    // 1. 上下文 Token 规模模式 (静态规模 vs 累计推理消耗)
    if (mode === 'tokens') {
      const totalTokens = data.map((d) => d.total_tokens);
      const cumulativeTokens = data.map((d) => d.cumulative_tokens ?? d.total_tokens);
      const thoughtTokens = data.map((d) => d.thought_tokens);

      return {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: '静态上下文规模',
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
              label: '累计推理 API 消耗',
              data: cumulativeTokens,
              borderColor: '#fbbf24', // amber-400
              backgroundColor: 'rgba(251, 191, 36, 0.08)',
              fill: true,
              tension: 0.3,
              borderWidth: 2,
              pointRadius: labels.length > 40 ? 0 : 2.5,
              pointHoverRadius: 5,
            },
            {
              label: '思考链 (Thinking) 规模',
              data: thoughtTokens,
              borderColor: CHART_PALETTE.emerald,
              backgroundColor: CHART_PALETTE.emeraldBg,
              fill: true,
              tension: 0.3,
              borderWidth: 1.8,
              pointRadius: labels.length > 40 ? 0 : 2,
              pointHoverRadius: 4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
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
              ticks: { ...defaultDarkScales.x.ticks, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
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
    }

    // 2. Chunk 交互推进量模式 (平滑折线面积图)
    if (mode === 'chunks') {
      const chunks = data.map((d) => d.turns);

      return {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Chunk 推进量',
              data: chunks,
              borderColor: CHART_PALETTE.sky,
              backgroundColor: 'rgba(56, 189, 248, 0.12)',
              fill: true,
              tension: 0.3,
              borderWidth: 2,
              pointRadius: labels.length > 40 ? 0 : 2.5,
              pointHoverRadius: 5,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              ...defaultDarkTooltipOptions,
              callbacks: {
                label(context) {
                  const val = Number(context.raw) || 0;
                  return ` Chunk 推进量: ${val.toLocaleString()} 个数据块`;
                },
              },
            },
          },
          scales: {
            x: {
              ...defaultDarkScales.x,
              ticks: { ...defaultDarkScales.x.ticks, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
            },
            y: {
              ...defaultDarkScales.y,
              ticks: {
                ...defaultDarkScales.y.ticks,
                precision: 0,
              },
            },
          },
        },
      };
    }

    // 3. 每日会话场次活跃度模式 (平滑折线面积图)
    const sessions = data.map((d) => d.sessions);
    return {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '会话场次',
            data: sessions,
            borderColor: CHART_PALETTE.indigo,
            backgroundColor: CHART_PALETTE.indigoBg,
            fill: true,
            tension: 0.3,
            borderWidth: 2,
            pointRadius: labels.length > 40 ? 0 : 2.5,
            pointHoverRadius: 5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...defaultDarkTooltipOptions,
            callbacks: {
              label(context) {
                const val = Number(context.raw) || 0;
                return ` 活跃会话: ${val} 场`;
              },
            },
          },
        },
        scales: {
          x: {
            ...defaultDarkScales.x,
            ticks: { ...defaultDarkScales.x.ticks, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
          },
          y: {
            ...defaultDarkScales.y,
            ticks: {
              ...defaultDarkScales.y.ticks,
              precision: 0,
            },
          },
        },
      },
    };
  }, [data, mode]);

  return <BaseChart config={chartConfig} heightClass="h-72" />;
}