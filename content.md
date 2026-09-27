好的，我将把时序趋势图中的“每日会话场次活跃度”模式从柱状图改为平滑折线面积图，以保持与 Token、Chunk 趋势一致的视觉体验与交互连续性。

## [WIP] style(frontend): 将每日会话场次时序图调整为平滑折线图

### 用户需求
在时序趋势图的“交互场次”模式中，将现有的柱状图（Bar Chart）改换为折线图（Line Chart），呈现更一致的时间序列流体形态。

### 评论
将离散的柱状图改为平滑折线图后，整个趋势卡片在三种视图（Token / Chunk / 场次）之间切换时，视觉语言保持统一（均支持平滑张力曲线、半透明阴影与 hover 交互聚焦），在多时间刻度下的起伏趋势对比更直观。

### 目标
在 `TokenTrendChart.tsx` 中，将 `mode === 'sessions'` 分支的配置改为带有半透明区域填充、平滑贝塞尔张力（tension: 0.3）以及索引交互聚焦的折线图。

### 基本原理
Chart.js 配置中将 `type` 调整为 `'line'`，并配置 `fill: true`、`borderColor`、`backgroundColor` 以及点半径规则，使样式与系统暗色 Design Tokens 完美契合。

### 标签
#intent/tune #flow/ready #priority/low #comp/ui #concept/ui #scope/ux #ai/instruct #task/domain/ui #task/object/sessions-trend-chart-type #task/action/refactor #task/state/continue #task/status/active

---

### Script

#### Acts 1: 调整 `TokenTrendChart.tsx` 会话场次为折线图

~~~~~act
patch_file
frontend/src/components/charts/TokenTrendChart.tsx
~~~~~
~~~~~typescript.old
    // 3. 每日会话场次活跃度模式 (带圆角暗色柱状图)
    const sessions = data.map((d) => d.sessions);
    return {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: '会话场次',
            data: sessions,
            backgroundColor: 'rgba(129, 140, 248, 0.75)',
            hoverBackgroundColor: CHART_PALETTE.indigo,
            borderRadius: 4,
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
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
~~~~~
~~~~~typescript.new
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
~~~~~

### 下一步建议
- 在前端工作台切换“交互场次”胶囊，观察折线在不同时间周期（7天、30天、全部）下的平滑渲染效果。
