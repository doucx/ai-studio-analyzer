# [WIP] fix: 调整 SessionDetailPanel 中锚点跳转的滚动对齐方式

### 用户需求
当用户通过带有 `#turn-X` 锚点的 URL 访问特定对话轮次时 (`http://localhost:5173/sessions/...#turn-24`)，当前页面会将目标 chunk 滚动到视口中央 (`block: 'center'`)，导致用户视野落在该块的中间而不是最顶端。用户希望能够精确跳转并对齐到该 chunk 的最顶端。

### 评论
这是一个关于交互体验 (UX) 的微调。将滚动对齐方式从 `center` 改为 `start` 更符合常规网页锚点和阅读流的直觉，能够让用户一目了然地看到目标轮次的头部元数据。

### 目标
1. 修改 `frontend/src/components/SessionDetailPanel.tsx` 中处理 URL 锚点跳转的 `scrollIntoView` 逻辑。
2. 将 `{ behavior: 'smooth', block: 'center' }` 调整为 `{ behavior: 'smooth', block: 'start' }`。

### 基本原理
在 Preact 组件中，利用 `useEffect` 监听加载完成的 `detail?.turns`，通过 `document.querySelector(hash)` 捕获对应的 DOM 元素。原生 DOM API 的 `scrollIntoView({ behavior: 'smooth', block: 'start' })` 可以精确控制元素顶部与滚动容器顶端对齐，从而满足将目标 chunk 滚动到最顶端的需求。

### 标签
#intent/fix #flow/ready #priority/medium #comp/cli #concept/ui #scope/ux #ai/instruct #task/domain/ui #task/object/session-detail-panel #task/action/fix-scroll-alignment #task/state/begin

---

### Script

#### Acts 1: 修改 `SessionDetailPanel.tsx` 中的滚动行为

使用 `patch_file` 将 `scrollIntoView` 的 `block` 参数由 `'center'` 修改为 `'start'`。

~~~~~act
patch_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~typescript.old
          const targetEl = document.querySelector(hash);
          if (targetEl) {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetEl.classList.add(
              'ring-2',
              'ring-indigo-500',
              'transition-all',
              'duration-500'
            );
            setTimeout(() => {
              targetEl.classList.remove('ring-2', 'ring-indigo-500');
            }, 2500);
          }
~~~~~
~~~~~typescript.new
          const targetEl = document.querySelector(hash);
          if (targetEl) {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            targetEl.classList.add(
              'ring-2',
              'ring-indigo-500',
              'transition-all',
              'duration-500'
            );
            setTimeout(() => {
              targetEl.classList.remove('ring-2', 'ring-indigo-500');
            }, 2500);
          }
~~~~~

### 下一步建议
- 验证修改后的滚动效果是否能够准确对齐到目标 chunk 的顶端。
- 确认无误后，可以通过独立的 `[COMMIT]` 计划提交此修复。
