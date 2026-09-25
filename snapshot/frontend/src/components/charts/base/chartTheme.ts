import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  DoughnutController,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip,
  type TooltipOptions,
} from 'chart.js';

// 统一注册 Chart.js 所需的所有核心组件与控制器
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  BarElement,
  BarController,
  ArcElement,
  DoughnutController,
  Title,
  Tooltip,
  Legend,
  Filler,
);

/**
 * 工作台统一暗色调色板 (Design Tokens)
 */
export const CHART_PALETTE = {
  indigo: '#818cf8', // 主强调色 (indigo-400)
  indigoBg: 'rgba(129, 140, 248, 0.12)',
  emerald: '#34d399', // 思考/健康色 (emerald-400)
  emeraldBg: 'rgba(52, 211, 153, 0.08)',
  sky: '#38bdf8', // 快速梯队 (sky-400)
  amber: '#fbbf24', // 攻坚/警告 (amber-400)
  red: '#f87171', // 极长线 (red-400)
  border: '#27272a', // zinc-800
  grid: 'rgba(63, 63, 70, 0.25)', // zinc-700/25
  textMuted: '#71717a', // zinc-500
  textSecondary: '#a1a1aa', // zinc-400
  textBright: '#f4f4f5', // zinc-100
  tooltipBg: '#18181b', // zinc-900
};

/**
 * 统一定义暗色 Tooltip 视觉参数
 */
export const defaultDarkTooltipOptions: Partial<TooltipOptions> = {
  backgroundColor: CHART_PALETTE.tooltipBg,
  titleColor: CHART_PALETTE.textBright,
  bodyColor: '#e4e4e7',
  borderColor: CHART_PALETTE.border,
  borderWidth: 1,
  padding: 10,
  cornerRadius: 6,
};

/**
 * 统一定义笛卡尔坐标轴暗色网格与字体
 */
export const defaultDarkScales = {
  x: {
    grid: { color: CHART_PALETTE.grid },
    ticks: {
      color: CHART_PALETTE.textMuted,
      font: { size: 10 },
    },
  },
  y: {
    grid: { color: CHART_PALETTE.grid },
    ticks: {
      color: CHART_PALETTE.textMuted,
      font: { size: 10 },
    },
  },
};