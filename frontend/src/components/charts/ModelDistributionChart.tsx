import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from 'chart.js';
import { useEffect, useRef } from 'preact/hooks';

ChartJS.register(CategoryScale, LinearScale, BarElement, BarController, Tooltip, Legend);

interface Props {
  distribution: Record<string, number>;
}

export function ModelDistributionChart({ distribution }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<ChartJS | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    // 按会话数从多到少排序，并格式化模型名
    const entries = Object.entries(distribution).sort((a, b) => b[1] - a[1]);
    const labels = entries.map(([m]) => m.replace('models/', ''));
    const dataValues = entries.map(([, count]) => count);

    chartRef.current = new ChartJS(canvasRef.current, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: '会话场数',
            data: dataValues,
            backgroundColor: 'rgba(99, 102, 241, 0.7)', // indigo-500
            hoverBackgroundColor: '#818cf8',
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
            backgroundColor: '#18181b',
            titleColor: '#f4f4f5',
            bodyColor: '#e4e4e7',
            borderColor: '#27272a',
            borderWidth: 1,
            callbacks: {
              label(context) {
                return ` 会话数: ${context.raw} 场`;
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
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [distribution]);

  return (
    <div className="relative w-full h-64">
      <canvas ref={canvasRef} />
    </div>
  );
}
