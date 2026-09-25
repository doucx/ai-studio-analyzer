增量同步完成后交互流未自动刷新的原因在于：`SessionDetailPanel` 仅在会话的 `file_id` 发生改变时才会重新请求详情接口，而在同步完成时没有响应式的信号触发其重新加载。

我将为同步模块增加一个响应式的同步版本信号 `syncVersionSignal`，并在增量同步完成时自动递增；同时让 `SessionDetailPanel` 监听此信号，在同步完成时静默获取最新的对话轮次，并补充手动刷新按钮，实现无感知平滑更新。

## [WIP] feat: 增量同步完成后自动刷新当前会话的交互轮次流

### 用户需求
当增量同步（Sync）完成后，若用户正处于某个会话的详情视图中，交互轮次流应立刻自动拉取并呈现最新数据，而无需先退出详情面板再重新进入。

### 评论
这是一个显著提升使用体验的关键改动。在 AI Studio 对话进行中的场景下，用户经常需要边聊边同步并查看审计状态。支持同步完成后的自动响应式刷新，能让工作台与云端会话无缝保持最新状态，消除多余的手动导航操作。

### 目标
1. 在 `frontend/src/state/sync.ts` 中引入响应式原子 `syncVersionSignal`，在每次收到 `sync_done` 事件时递增版本计数。
2. 在 `frontend/src/components/SessionDetailPanel.tsx` 中订阅该信号，当同步完成或用户手动点击刷新时，重新获取当前会话详情并渲染最新轮次。
3. 避免刷新时整页闪烁，如果已有历史数据则进行原地平滑更新，同时在操作栏提供局部刷新交互。

### 基本原理
利用 `@preact/signals` 的响应式机制：在 SSE 监听到后端 `sync_done` 广播后，不仅触发列表和指标重新请求，也递增 `syncVersionSignal`。`SessionDetailPanel` 将 `syncVersionSignal.value` 作为依赖项，触发拉取 `/api/sessions/{file_id}`。若面板已处于激活状态，保持已有轮次展示，获取完成后无缝替换为最新结果，保证平滑流畅的体验。

### 标签
#intent/build #flow/ready #priority/high #comp/ui #concept/sync #scope/ux #ai/instruct #task/domain/ui #task/object/session-detail-sync #task/action/implementation #task/state/begin

---

### Script

#### Acts 1: 在同步状态中增加版本信号并在同步完成时触发递增

为 `sync.ts` 导出 `syncVersionSignal`，并在 `sync_done` 回调中自增。

~~~~~act
patch_file
frontend/src/state/sync.ts
~~~~~
~~~~~typescript.old
import { signal } from '@preact/signals';

export const syncInProgressSignal = signal<boolean>(false);
export const syncProgressTextSignal = signal<string>('');

export async function triggerSync(limit = 50) {
~~~~~
~~~~~typescript.new
import { signal } from '@preact/signals';

export const syncInProgressSignal = signal<boolean>(false);
export const syncProgressTextSignal = signal<string>('');
export const syncVersionSignal = signal<number>(0);

export async function triggerSync(limit = 50) {
~~~~~

~~~~~act
patch_file
frontend/src/state/sync.ts
~~~~~
~~~~~typescript.old
  eventSource.addEventListener('sync_done', () => {
    syncInProgressSignal.value = false;
    syncProgressTextSignal.value = '';
    onSyncComplete();
  });
~~~~~
~~~~~typescript.new
  eventSource.addEventListener('sync_done', () => {
    syncInProgressSignal.value = false;
    syncProgressTextSignal.value = '';
    syncVersionSignal.value += 1;
    onSyncComplete();
  });
~~~~~

#### Acts 2: 让 SessionDetailPanel 响应同步完成事件并支持静默重新获取

在 `SessionDetailPanel.tsx` 中引入 `syncVersionSignal`，在同步完成时重新拉取详情，并添加局部刷新按钮。

~~~~~act
patch_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~typescript.old
  MessagesSquare,
  Paperclip,
  User,
  X,
} from 'lucide-preact';
import { marked } from 'marked';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ConversationTurnItem, SessionDetail, SessionItem } from '../types/metrics';
~~~~~
~~~~~typescript.new
  MessagesSquare,
  Paperclip,
  RefreshCw,
  User,
  X,
} from 'lucide-preact';
import { marked } from 'marked';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { syncVersionSignal } from '../state/sync';
import type { ConversationTurnItem, SessionDetail, SessionItem } from '../types/metrics';
~~~~~

~~~~~act
patch_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~typescript.old
export function SessionDetailPanel({ session, onClose }: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [showMetadata, setShowMetadata] = useState<boolean>(true);

  const aiStudioUrl = `https://aistudio.google.com/prompts/${session.file_id}`;

  useEffect(() => {
    setLoading(true);
    fetch(`/api/sessions/${session.file_id}`)
      .then((res) => res.json())
      .then((data) => {
        setDetail(data);
      })
      .catch((err) => {
        console.error('获取会话详情失败:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [session.file_id]);
~~~~~
~~~~~typescript.new
export function SessionDetailPanel({ session, onClose }: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [showMetadata, setShowMetadata] = useState<boolean>(true);

  const aiStudioUrl = `https://aistudio.google.com/prompts/${session.file_id}`;

  const fetchSessionDetail = useCallback(
    async (isSilent = false) => {
      if (!isSilent) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      try {
        const res = await fetch(`/api/sessions/${session.file_id}`);
        const data = await res.json();
        setDetail(data);
      } catch (err) {
        console.error('获取会话详情失败:', err);
      } finally {
        if (!isSilent) {
          setLoading(false);
        } else {
          setRefreshing(false);
        }
      }
    },
    [session.file_id],
  );

  // 初次进入或切换会话时全屏加载；增量同步完成触发 syncVersionSignal 时静默刷新
  useEffect(() => {
    const isInitialLoad = !detail || detail.file_id !== session.file_id;
    fetchSessionDetail(!isInitialLoad);
  }, [session.file_id, syncVersionSignal.value, fetchSessionDetail]);
~~~~~

~~~~~act
patch_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~typescript.old
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowMetadata(!showMetadata)}
            className="px-2.5 py-1 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded border border-zinc-700/80 transition"
            title="切换元数据卡片可见性"
          >
            {showMetadata ? '隐藏统计' : '显示统计'}
          </button>
~~~~~
~~~~~typescript.new
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => fetchSessionDetail(true)}
            disabled={loading || refreshing}
            className="px-2.5 py-1 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 rounded border border-zinc-700/80 transition flex items-center gap-1"
            title="刷新当前会话内容"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">刷新</span>
          </button>
          <button
            type="button"
            onClick={() => setShowMetadata(!showMetadata)}
            className="px-2.5 py-1 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded border border-zinc-700/80 transition"
            title="切换元数据卡片可见性"
          >
            {showMetadata ? '隐藏统计' : '显示统计'}
          </button>
~~~~~

### 下一步建议
- 在前端运行 `npm run check` 校验代码格式与类型安全。
- 在实际会话中触发一次增量同步，验证面板在增量同步完成后是否能平滑刷出最新的对话轮次。
