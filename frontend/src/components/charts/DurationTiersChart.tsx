import { ArcElement, Chart as ChartJS, DoughnutController, Legend, Tooltip } from 'chart.js';
import { useEffect, useRef } from 'preact/hooks';

ChartJS.register(ArcElement, Tooltip, Legend, DoughnutController);

interface Props {
  tiers: {
    flash: [number, string];
    focus: [number, string];
    deep: [number, string];
    epic: [number, string];
  };
}

export function DurationTiersChart({ tiers }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<ChartJS | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const labels = ['即时快问 (<10m)', '聚焦推进 (10~60m)', '深度攻坚 (1~6h)', '跨日长线 (>6h)'];
    const dataValues = [tiers.flash[0], tiers.focus[0], tiers.deep[0], tiers.epic[0]];

    chartRef.current = new ChartJS(canvasRef.current, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [
          {
            data: dataValues,
            backgroundColor: [
              '#38bdf8', // sky-400
              '#818cf8', // indigo-400
              '#fbbf24', // amber-400
              '#f87171', // red-400
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
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: '#a1a1aa',
              font: { size: 10.5 },
              boxWidth: 10,
              padding: 12,
              usePointStyle: true,
            },
          },
          tooltip: {
            backgroundColor: '#18181b',
            titleColor: '#f4f4f5',
            bodyColor: '#e4e4e7',
            borderColor: '#27272a',
            borderWidth: 1,
            callbacks: {
              label(context) {
                const total = dataValues.reduce((a, b) => a + b, 0);
                const val = Number(context.raw) || 0;
                const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0';
                return ` ${context.label}: ${val} 场 (${pct}%)`;
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
  }, [tiers]);

  return (
    <div className="relative w-full h-64">
      <canvas ref={canvasRef} />
    </div>
  );
}
