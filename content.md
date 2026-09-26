好的，我们将落地方案 A（基于视口唤醒与窗口焦点的智能自动同步）。

这套方案将在前端状态管理中引入防抖限流的焦点监听器：当用户从 Google AI Studio 网页等外部窗口切换回本应用、或者重新激活浏览器标签页时，系统会在距离上次同步超过设定阈值（默认 90 秒）的情况下，自动触发轻量级的后台增量同步（最近 20 篇），无需人工干预且避免任何无意义的后台死循环消耗。

## [WIP] feat(frontend): 实现基于窗口焦点与可见性的智能自动同步

### 用户需求
为 AI Studio Analyzer 接入无感的自动增量同步能力。避免低效无节制的后台定时盲轮询，转为在用户切换至看板视口时智能唤醒同步。

### 评论
采用浏览器原生的 `visibilitychange` 和 `window.focus` 事件监听，将同步动作与用户的注意力窗口直接挂钩。既保障了用户每次回到看板时看到的数据始终是最新状态，又在用户离开或闲置时实现完全零网络消耗，是面向本地审计工作台的最优权衡。

### 目标
1. 在 `frontend/src/state/sync.ts` 中实现 `setupAutoSyncOnFocus` 监听函数，设定合理防抖间隔（默认 90 秒）与扫描规模（轻量级 20 篇）。
2. 在 `frontend/src/app.tsx` 的全局挂载生命周期中集成该监听器，并确保组件卸载时正确移除事件监听。

### 基本原理
监听 `document.visibilityState === 'visible'` 与 `window.onfocus` 事件。每次事件触发时检查当前是否已有正在执行的同步任务（`syncInProgressSignal.value`）以及距离上次同步的时间戳。仅在满足时间跨度阈值时触发 `triggerSync(20)`。当用户切回前台时，后端会通过现有的 SSE 事件通道实时推送进度并在完成后刷新看板。

### 标签
#intent/build #flow/ready #priority/medium #comp/ui #concept/sync #scope/ux #ai/instruct #task/domain/sync #task/object/auto-sync-focus #task/action/implementation #task/state/begin #task/status/active

---

### Script

#### Acts 1: 在同步状态模块中实现视口焦点感知监听器

在 `frontend/src/state/sync.ts` 中封装 `setupAutoSyncOnFocus` 函数，提供时间戳保护与事件注销清理机制。

~~~~~act
patch_file
frontend/src/state/sync.ts
~~~~~
~~~~~typescript.old
  return () => {
    eventSource.close();
  };
}
~~~~~
~~~~~typescript.new
  return () => {
    eventSource.close();
  };
}

/**
 * 视口唤醒与窗口焦点感知自动同步监听器
 * 仅当用户切换回本标签页且距离上次同步超过 intervalMs 时静默触发
 */
export function setupAutoSyncOnFocus(intervalMs = 90_000, limit = 20): () => void {
  let lastSyncTime = Date.now();

  const handleCheckSync = () => {
    if (syncInProgressSignal.value) return;
    const now = Date.now();
    if (now - lastSyncTime >= intervalMs) {
      lastSyncTime = now;
      triggerSync(limit);
    }
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      handleCheckSync();
    }
  };

  window.addEventListener('focus', handleCheckSync);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  return () => {
    window.removeEventListener('focus', handleCheckSync);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}
~~~~~

#### Acts 2: 在 App 入口挂载自动同步生命周期

在 `frontend/src/app.tsx` 中导入 `setupAutoSyncOnFocus` 并在 `App` 组件的初始化 Effect 中进行注册与销毁绑定。

~~~~~act
patch_file
frontend/src/app.tsx
~~~~~
~~~~~typescript.old
import {
  setupSyncEventListener,
  syncInProgressSignal,
  syncProgressTextSignal,
  triggerSync,
} from './state/sync';
~~~~~
~~~~~typescript.new
import {
  setupAutoSyncOnFocus,
  setupSyncEventListener,
  syncInProgressSignal,
  syncProgressTextSignal,
  triggerSync,
} from './state/sync';
~~~~~

~~~~~act
patch_file
frontend/src/app.tsx
~~~~~
~~~~~typescript.old
export function App() {
  useEffect(() => {
    loadAllData();
    const cleanupSync = setupSyncEventListener(() => {
      loadAllData();
    });
    return cleanupSync;
  }, []);
~~~~~
~~~~~typescript.new
export function App() {
  useEffect(() => {
    loadAllData();
    const cleanupSync = setupSyncEventListener(() => {
      loadAllData();
    });
    const cleanupAutoSync = setupAutoSyncOnFocus();
    return () => {
      cleanupSync();
      cleanupAutoSync();
    };
  }, []);
~~~~~

### 下一步建议
1. **测试体验**: 在浏览器中打开看板后，切换到其他标签页或 AI Studio 网页与模型进行一轮问答，并在大约 1.5 分钟后切回看板，验证顶部是否自动展示 `同步中...` 并在完成后自动更新最新会话。
2. **代码提交**: 确认交互行为符合预期后，即可生成独立的 `[COMMIT]` 计划将前端自动感知同步的修改提交至 Git 仓库。
