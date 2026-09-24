在分析代码后发现，Chart.js 图表无法渲染的根本原因是：**各个图表组件在使用模块化注册时，遗漏了图表类型对应的控制器（Controllers）**，同时图表外层容器缺少 `relative` 定位可能导致 Chart.js 自适应尺寸计算失败。

我将生成执行计划，补齐 `DoughnutController`、`BarController` 与 `LineController` 的注册并优化容器样式。

## [WIP] fix: 补全 Chart.js 控制器注册并修复图表渲染异常

### 错误分析

在使用 Chart.js v4+ 的按需导入（Tree-shaking）机制时，调用 `new ChartJS(canvas, { type: '...' })` 必须显式注册对应的控制器（Controller），否则 Chart.js 内部会抛出异常：
- `DurationTiersChart.tsx`: 仅注册了 `ArcElement, Tooltip, Legend`，缺少 `DoughnutController`，抛出 `"doughnut" is not a registered controller.`。
- `ModelDistributionChart.tsx`: 仅注册了尺度和元素，缺少 `BarController`，抛出 `"bar" is not a registered controller.`。
- `TokenTrendChart.tsx`: 仅注册了尺度和元素，缺少 `LineController`，抛出 `"line" is not a registered controller.`。

此外，Canvas 父容器未设置 `relative` 定位，在 Chart.js 配置 `maintainAspectRatio: false` 时可能引起布局计算尺寸为 0 或溢出。

### 用户需求

修复前端 Dashboard 中各指标图表（Token 消耗趋势、心智时长切片、模型偏好分布）无法正常显示的问题，确保图表正确绘制并自适应缩放。

### 评论

Chart.js v4 严格模块化，未注册控制器是常见故障。修复后即可恢复高性能客户端图表渲染，无需引入庞大的全量包，兼顾加载性能与运行稳定性。

### 目标

1. 在 `DurationTiersChart.tsx` 中导入并注册 `DoughnutController`，父容器追加 `relative`。
2. 在 `ModelDistributionChart.tsx` 中导入并注册 `BarController`，父容器追加 `relative`。
3. 在 `TokenTrendChart.tsx` 中导入并注册 `LineController`，父容器追加 `relative`。

### 基本原理

1. 引入对应图表类型的 Controller 后，Chart.js 内部的控制器注册表完备，能够正确识别 `type: 'doughnut' | 'bar' | 'line'` 的配置。
2. 为父容器添加 Tailwind `relative` 定位类，确保 Chart.js 监听窗口 resize 并计算 Canvas 绝对比例时的几何锚点稳定。

### 标签

#intent/fix #flow/ready #priority/high
#comp/runtime #concept/ui #scope/ux
#ai/instruct
#task/domain/ui #task/object/chart-controllers #task/action/bug-fix
#task/state/begin #task/status/active

---

### Script

#### Acts 1: 修复 `DurationTiersChart.tsx` 控制器注册

在时长梯队环形图中补齐 `DoughnutController` 注册并补充外层容器相对定位。

~~~~~act
patch_file
frontend/src/components/charts/DurationTiersChart.tsx
~~~~~
~~~~~typescript.old
import { useEffect, useRef } from 'preact/hooks';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend);
~~~~~
~~~~~typescript.new
import { useEffect, useRef } from 'preact/hooks';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  DoughnutController,
} from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend, DoughnutController);
~~~~~

~~~~~act
patch_file
frontend/src/components/charts/DurationTiersChart.tsx
~~~~~
~~~~~typescript.old
  return (
    <div className="w-full h-64">
      <canvas ref={canvasRef} />
    </div>
  );
~~~~~
~~~~~typescript.new
  return (
    <div className="relative w-full h-64">
      <canvas ref={canvasRef} />
    </div>
  );
~~~~~

#### Acts 2: 修复 `ModelDistributionChart.tsx` 控制器注册

在模型分布柱状图中补齐 `BarController` 注册并补充外层容器相对定位。

~~~~~act
patch_file
frontend/src/components/charts/ModelDistributionChart.tsx
~~~~~
~~~~~typescript.old
import { useEffect, useRef } from 'preact/hooks';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);
~~~~~
~~~~~typescript.new
import { useEffect, useRef } from 'preact/hooks';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  BarController,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, BarController, Tooltip, Legend);
~~~~~

~~~~~act
patch_file
frontend/src/components/charts/ModelDistributionChart.tsx
~~~~~
~~~~~typescript.old
  return (
    <div className="w-full h-64">
      <canvas ref={canvasRef} />
    </div>
  );
~~~~~
~~~~~typescript.new
  return (
    <div className="relative w-full h-64">
      <canvas ref={canvasRef} />
    </div>
  );
~~~~~

#### Acts 3: 修复 `TokenTrendChart.tsx` 控制器注册

在每日趋势折线图中补齐 `LineController` 注册并补充外层容器相对定位。

~~~~~act
patch_file
frontend/src/components/charts/TokenTrendChart.tsx
~~~~~
~~~~~typescript.old
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import type { DailyTrendItem } from '../../types/metrics';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);
~~~~~
~~~~~typescript.new
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
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
~~~~~

~~~~~act
patch_file
frontend/src/components/charts/TokenTrendChart.tsx
~~~~~
~~~~~typescript.old
  return (
    <div className="w-full h-72">
      <canvas ref={canvasRef} />
    </div>
  );
~~~~~
~~~~~typescript.new
  return (
    <div className="relative w-full h-72">
      <canvas ref={canvasRef} />
    </div>
  );
~~~~~

### 下一步建议

1. 执行补丁后，重新刷新前端页面 (`http://localhost:5173`)，检查浏览器 DevTools Console 中是否已消除 `"is not a registered controller"` 报错，并验证图表是否正常呈现。
2. 若本地 SQLite 尚未同步云盘对话数据，需在终端运行 `python main.py fetch -n 50` 或点击页面右上角的「增量同步」按钮拉取会话以填充指标。
