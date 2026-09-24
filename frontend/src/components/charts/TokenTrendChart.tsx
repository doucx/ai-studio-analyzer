import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip,
} from 'chart.js';
import { useEffect, useRef } from 'preact/hooks';
import type { DailyTrendItem } from '../../types/metrics';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  Title,
  Tooltip,
  Legend,
  Filler,
);

interface Props {
  data: DailyTrendItem[];
}

export function TokenTrendChart({ data }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<ChartJS | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const labels = data.map((d) => d.date);
    const totalTokens = data.map((d) => d.total_tokens);
    const thoughtTokens = data.map((d) => d.thought_tokens);

    chartRef.current = new ChartJS(canvasRef.current, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '总 Token 消耗',
            data: totalTokens,
            borderColor: '#818cf8', // indigo-400
            backgroundColor: 'rgba(129, 140, 248, 0.12)',
            fill: true,
            tension: 0.3,
            borderWidth: 2,
            pointRadius: labels.length > 40 ? 0 : 2.5,
            pointHoverRadius: 5,
          },
          {
            label: '思考链 (Thinking) 消耗',
            data: thoughtTokens,
            borderColor: '#34d399', // emerald-400
            backgroundColor: 'rgba(52, 211, 153, 0.08)',
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
              color: '#a1a1aa',
              font: { size: 11 },
              boxWidth: 12,
              usePointStyle: true,
            },
          },
          tooltip: {
            backgroundColor: '#18181b',
            titleColor: '#f4f4f5',
            bodyColor: '#e4e4e7',
            borderColor: '#27272a',
            borderWidth: 1,
            padding: 10,
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
            grid: { color: 'rgba(63, 63, 70, 0.25)' },
            ticks: {
              color: '#71717a',
              font: { size: 10 },
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 12,
            },
          },
          y: {
            grid: { color: 'rgba(63, 63, 70, 0.25)' },
            ticks: {
              color: '#71717a',
              font: { size: 10 },
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
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [data]);

  return (
    <div className="relative w-full h-72">
      <canvas ref={canvasRef} />
    </div>
  );
}
