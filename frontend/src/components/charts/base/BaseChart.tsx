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
      // 若图表类型一致，原地更新配置与数据，避免重复销毁重建
      const currentConfig = chartRef.current.config as ChartConfiguration;
      if (currentConfig.type === config.type) {
        chartRef.current.data = config.data;
        chartRef.current.options = config.options || {};
        chartRef.current.update();
        return;
      }
      chartRef.current.destroy();
      chartRef.current = null;
    }

    chartRef.current = new ChartJS(canvasRef.current, config);
  }, [config]);

  useEffect(() => {
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, []);

  return (
    <div className={`relative w-full ${heightClass} ${className}`}>
      <canvas ref={canvasRef} />
    </div>
  );
}
