import { type ChartConfiguration, Chart as ChartJS } from 'chart.js';
import { useEffect, useRef } from 'preact/hooks';

interface BaseChartProps {
  config: ChartConfiguration;
  className?: string;
  heightClass?: string;
}

export function BaseChart({ config, className = '', heightClass = 'h-64' }: BaseChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<ChartJS | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    chartRef.current = new ChartJS(canvasRef.current, config);

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [config]);

  return (
    <div className={`relative w-full ${heightClass} ${className}`}>
      <canvas ref={canvasRef} />
    </div>
  );
}
