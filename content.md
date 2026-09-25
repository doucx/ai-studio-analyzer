好的，我已为你设计并整理好历史会话查看器与会话面板的整体落地方案。我们将重构为现代 Master-Detail 左右工作台布局：左侧集成支持 5,000+ 会话的轻量高性能虚拟列表与实时搜索，右侧提供全景认知看板与单会话沉浸详情的双向无缝切换，同时彻底废弃底部冗余的静态硬编码表格。

## [WIP] feat: 重构左右分栏工作台并引入 5000+ 会话虚拟列表与会话面板

### 用户需求
1. 实现支持 5,000+ 条会话顺畅浏览的历史会话查看器，避免大量 DOM 节点导致页面卡顿。
2. 设计可复用的会话详情面板，当前阶段支持直通 Google AI Studio 云端跳转（`https://aistudio.google.com/prompts/${file_id}`），并为未来的 Markdown 提示词渲染器预留空间。
3. 重构页面整体布局，淘汰底部采样 30 条的简易静态表格，提升全景看板与单会话审计的联动效率。

### 评论
当前单页瀑布流布局在面对海量历史对话时无法承载高密度的检索与沉浸查看需求。通过重构为 Master-Detail（左侧虚拟会话检索栏 + 右侧全景看板/单会话详情动态视口），既能将数千条历史的探索体验提升至 60fps，又为后续提示词清洗、聚类与 Markdown 解析提供了稳定的宿主架构。

### 目标
1. 后端支持全量轻量会话元数据下发及单会话完整轮次详情查询（`/api/sessions/{file_id}`）。
2. 在前端实现自研轻量固定高度虚拟滚动列表组件（`VirtualSessionList`），支持关键字即时模糊检索与多维排序。
3. 创建会话详情面板（`SessionDetailPanel`），呈现会话生命周期、思维摩擦力、首轮 Prompt 与直达 Google AI Studio 的跳转动作。
4. 将 `app.tsx` 页面重构为分栏工作台，移除过时的底部静态表格。

### 基本原理
- **虚拟列表原理**：基于容器 `scrollTop` 与卡片固定高度动态计算 `startIndex` 与 `endIndex`，配合少量前后 Buffer，即使有 50,000 条数据也仅保持渲染 ~15 个 DOM 节点，内存与渲染压力降至恒定常数。
- **动态工作区**：右侧视口在“全局看板概览（Overview）”与“会话深度审计（Detail）”之间自由切换，既保留宏观时序走势，又能深潜单场会话微观指标。

### 标签
#intent/build #flow/ready #priority/high #comp/cli #concept/ui #scope/ux #ai/instruct #task/domain/ui #task/object/virtual-session-explorer #task/action/implementation #task/state/begin

---

### Script

#### Acts 1: 扩展后端会话接口以支持全量索引与单会话详情获取

修改 `src/server/api.py`，允许 `limit=None` 时拉取当前周期全量会话，并新增 `/api/sessions/{file_id}` 接口。

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~python
@router.get("/sessions")
def list_sessions(range: str = "all", limit: int = 50):
    """
    按时间窗口过滤后，返回按最后修改时间倒序的会话列表摘要
    """
    all_sessions = _ensure_sessions_loaded()
    filtered = filter_sessions_by_range(all_sessions, range)
    sorted_sessions = sorted(
        filtered,
        key=lambda s: s.modified_time.isoformat() if s.modified_time else "",
        reverse=True,
    )
    return [
        {
            "file_id": s.file_id,
            "name": s.name,
            "model": s.model,
            "turn_count": s.turn_count,
            "total_tokens": s.total_tokens,
            "thought_tokens": s.thought_tokens,
            "duration_human": s.duration_human,
            "duration_seconds": s.duration_seconds,
            "has_branching": s.has_branching,
            "branch_count": s.branch_count,
            "first_prompt": s.user_prompts[0] if s.user_prompts else "",
            "modified_time": s.modified_time.isoformat() if s.modified_time else None,
            "created_time": s.created_time.isoformat() if s.created_time else None,
        }
        for s in sorted_sessions[:limit]
    ]
~~~~~
~~~~~python
@router.get("/sessions")
def list_sessions(range: str = "all", limit: Optional[int] = None):
    """
    按时间窗口过滤后，返回按最后修改时间倒序的会话列表摘要。
    当 limit 为 None 或 <= 0 时，返回当前范围全量列表供前端虚拟滚动使用。
    """
    all_sessions = _ensure_sessions_loaded()
    filtered = filter_sessions_by_range(all_sessions, range)
    sorted_sessions = sorted(
        filtered,
        key=lambda s: s.modified_time.isoformat() if s.modified_time else "",
        reverse=True,
    )
    result_slice = sorted_sessions if (limit is None or limit <= 0) else sorted_sessions[:limit]
    return [
        {
            "file_id": s.file_id,
            "name": s.name,
            "model": s.model,
            "turn_count": s.turn_count,
            "total_tokens": s.total_tokens,
            "thought_tokens": s.thought_tokens,
            "duration_human": s.duration_human,
            "duration_seconds": s.duration_seconds,
            "has_branching": s.has_branching,
            "branch_count": s.branch_count,
            "first_prompt": s.user_prompts[0] if s.user_prompts else "",
            "modified_time": s.modified_time.isoformat() if s.modified_time else None,
            "created_time": s.created_time.isoformat() if s.created_time else None,
        }
        for s in result_slice
    ]


@router.get("/sessions/{file_id}")
def get_session_detail(file_id: str):
    """获取单个会话的完整轮次与核心参数，为提示词详情展示做准备"""
    all_sessions = _ensure_sessions_loaded()
    target = next((s for s in all_sessions if s.file_id == file_id), None)
    if not target:
        return {"error": "未找到指定的会话记录"}

    return {
        "file_id": target.file_id,
        "name": target.name,
        "model": target.model,
        "created_time": target.created_time.isoformat() if target.created_time else None,
        "modified_time": target.modified_time.isoformat() if target.modified_time else None,
        "duration_human": target.duration_human,
        "duration_seconds": target.duration_seconds,
        "turn_count": target.turn_count,
        "total_tokens": target.total_tokens,
        "thought_tokens": target.thought_tokens,
        "total_user_chars": target.total_user_chars,
        "has_branching": target.has_branching,
        "branch_count": target.branch_count,
        "system_instruction": target.system_instruction,
        "turns": [
            {
                "role": t.role,
                "text": t.text,
                "token_count": t.token_count,
                "is_thought": t.is_thought,
                "payload_type": t.payload_type,
                "timestamp": t.timestamp.isoformat() if t.timestamp else None,
                "is_edited": t.is_edited,
            }
            for t in target.turns
        ],
    }
~~~~~

#### Acts 2: 补充前端类型定义

更新 `frontend/src/types/metrics.ts`，增加单会话详情的类型定义。

~~~~~act
patch_file
frontend/src/types/metrics.ts
~~~~~
~~~~~typescript
export interface SessionItem {
  file_id: string;
  name: string;
  model: string;
  turn_count: number;
  total_tokens: number;
  thought_tokens: number;
  duration_human: string;
  duration_seconds: number;
  has_branching: boolean;
  branch_count: number;
  first_prompt: string;
  modified_time: string | null;
  created_time: string | null;
}
~~~~~
~~~~~typescript
export interface SessionItem {
  file_id: string;
  name: string;
  model: string;
  turn_count: number;
  total_tokens: number;
  thought_tokens: number;
  duration_human: string;
  duration_seconds: number;
  has_branching: boolean;
  branch_count: number;
  first_prompt: string;
  modified_time: string | null;
  created_time: string | null;
}

export interface ConversationTurnItem {
  role: 'user' | 'model' | 'system';
  text: string;
  token_count: number;
  is_thought: boolean;
  payload_type: string;
  timestamp: string | null;
  is_edited: boolean;
}

export interface SessionDetail extends SessionItem {
  total_user_chars: number;
  system_instruction: string;
  turns: ConversationTurnItem[];
}
~~~~~

#### Acts 3: 创建高性能虚拟会话列表组件

新建 `frontend/src/components/VirtualSessionList.tsx`，支持数千条会话的 60fps 顺滑滚动、关键字即时搜索与多维排序。

~~~~~act
write_file
frontend/src/components/VirtualSessionList.tsx
~~~~~
~~~~~typescript
import { useMemo, useRef, useState } from 'preact/hooks';
import type { SessionItem } from '../types/metrics';

interface Props {
  sessions: SessionItem[];
  selectedId: string | null;
  onSelect: (session: SessionItem) => void;
}

const ITEM_HEIGHT = 86; // 每项固定高度 86px
const BUFFER = 5; // 视口外缓冲项数

export function VirtualSessionList({ sessions, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'modified' | 'tokens' | 'turns'>('modified');

  // 客户端毫秒级本地过滤与排序
  const filteredSessions = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    let result = sessions;
    if (term) {
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(term) ||
          s.first_prompt.toLowerCase().includes(term) ||
          s.model.toLowerCase().includes(term)
      );
    }

    return [...result].sort((a, b) => {
      if (sortBy === 'tokens') {
        return b.total_tokens - a.total_tokens;
      }
      if (sortBy === 'turns') {
        return b.turn_count - a.turn_count;
      }
      const timeA = a.modified_time ? new Date(a.modified_time).getTime() : 0;
      const timeB = b.modified_time ? new Date(b.modified_time).getTime() : 0;
      return timeB - timeA;
    });
  }, [sessions, searchTerm, sortBy]);

  // 虚拟列表动态计算
  const totalHeight = filteredSessions.length * ITEM_HEIGHT;
  const containerHeight = containerRef.current?.clientHeight || 650;

  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER);
  const visibleCount = Math.ceil(containerHeight / ITEM_HEIGHT);
  const endIndex = Math.min(filteredSessions.length, startIndex + visibleCount + BUFFER * 2);
  const offsetY = startIndex * ITEM_HEIGHT;

  const visibleItems = filteredSessions.slice(startIndex, endIndex);

  return (
    <div className="flex flex-col h-full bg-zinc-900/60 border border-zinc-800 rounded-lg overflow-hidden">
      {/* 搜索与排序控制栏 */}
      <div className="p-3 border-b border-zinc-800 space-y-2 bg-zinc-900/90">
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <span className="font-semibold text-zinc-200">
            会话历史 ({filteredSessions.length} / {sessions.length})
          </span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy((e.target as HTMLSelectElement).value as any)}
            className="bg-zinc-950 border border-zinc-700 text-zinc-300 text-[11px] rounded px-1.5 py-0.5 outline-none focus:border-indigo-500"
          >
            <option value="modified">最近修改</option>
            <option value="tokens">Token 能耗</option>
            <option value="turns">轮次深度</option>
          </select>
        </div>

        <div className="relative">
          <input
            type="text"
            placeholder="搜索会话标题、首轮 Prompt、模型..."
            value={searchTerm}
            onInput={(e) => {
              setSearchTerm((e.target as HTMLInputElement).value);
              setScrollTop(0);
              if (containerRef.current) containerRef.current.scrollTop = 0;
            }}
            className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-500 outline-none transition"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-2 top-1 text-xs text-zinc-500 hover:text-zinc-300"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 虚拟滚动主体视口 */}
      <div
        ref={containerRef}
        onScroll={(e) => setScrollTop((e.target as HTMLElement).scrollTop)}
        className="flex-1 overflow-y-auto relative w-full divide-y divide-zinc-800/40 select-none"
      >
        {filteredSessions.length === 0 ? (
          <div className="p-8 text-center text-xs text-zinc-500">未检索到匹配的交互会话</div>
        ) : (
          <div style={{ height: `${totalHeight}px`, width: '100%', position: 'relative' }}>
            <div
              style={{
                transform: `translateY(${offsetY}px)`,
                willChange: 'transform',
                position: 'absolute',
                left: 0,
                right: 0,
                top: 0,
              }}
            >
              {visibleItems.map((s) => {
                const isSelected = selectedId === s.file_id;
                return (
                  <div
                    key={s.file_id}
                    onClick={() => onSelect(s)}
                    style={{ height: `${ITEM_HEIGHT}px` }}
                    className={`p-2.5 cursor-pointer transition flex flex-col justify-between border-b border-zinc-800/30 ${
                      isSelected
                        ? 'bg-indigo-950/60 border-l-2 border-l-indigo-500 text-white'
                        : 'hover:bg-zinc-800/40 text-zinc-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span
                        className="font-medium text-xs truncate flex-1 text-zinc-100"
                        title={s.name}
                      >
                        {s.name}
                      </span>
                      {s.has_branching && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-amber-950/80 text-amber-400 border border-amber-800/50">
                          分叉
                        </span>
                      )}
                      <span className="text-[10px] text-zinc-500 font-mono whitespace-nowrap">
                        {s.duration_human}
                      </span>
                    </div>

                    <p className="text-[11px] text-zinc-400 truncate font-sans">
                      {s.first_prompt || '(无首轮文本提示)'}
                    </p>

                    <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono">
                      <span className="bg-zinc-800/80 px-1 py-0.2 rounded text-zinc-400 max-w-[130px] truncate">
                        {s.model.replace('models/', '')}
                      </span>
                      <span>
                        {s.total_tokens.toLocaleString()} tok · {s.turn_count} 轮
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
~~~~~

#### Acts 4: 创建会话详情面板组件

新建 `frontend/src/components/SessionDetailPanel.tsx`，支持直达 Google AI Studio 跳转、认知能耗指标与 Prompt 全文速览。

~~~~~act
write_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~typescript
import { useEffect, useState } from 'preact/hooks';
import type { SessionDetail, SessionItem } from '../types/metrics';

interface Props {
  session: SessionItem;
  onClose: () => void;
}

export function SessionDetailPanel({ session, onClose }: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

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

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5 flex flex-col space-y-5">
      {/* 头部导航与操作条 */}
      <div className="flex items-start justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-white tracking-tight">{session.name}</h2>
            {session.has_branching && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-400 border border-amber-800/60 font-mono">
                分叉重试 {session.branch_count} 次
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-400 mt-1 font-mono">
            ID: {session.file_id} · 模型: {session.model.replace('models/', '')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={aiStudioUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3.5 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded transition shadow-sm flex items-center gap-1.5"
            title="在 Google AI Studio 原生工作台打开"
          >
            <span>🚀</span> 在 AI Studio 打开
          </a>
          <button
            type="button"
            onClick={onClose}
            className="px-2.5 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded transition"
          >
            返回看板
          </button>
        </div>
      </div>

      {/* 单会话微观指标卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-zinc-900 border border-zinc-800/80 rounded p-3">
          <div className="text-[11px] text-zinc-400">生命周期时长</div>
          <div className="text-lg font-bold text-indigo-400 font-mono mt-0.5">
            {session.duration_human}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">{session.duration_seconds} 秒</div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800/80 rounded p-3">
          <div className="text-[11px] text-zinc-400">总 Token 消耗</div>
          <div className="text-lg font-bold text-emerald-400 font-mono mt-0.5">
            {session.total_tokens.toLocaleString()}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">
            思考链: {session.thought_tokens.toLocaleString()}
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800/80 rounded p-3">
          <div className="text-[11px] text-zinc-400">有效交互轮次</div>
          <div className="text-lg font-bold text-white font-mono mt-0.5">{session.turn_count} 轮</div>
          <div className="text-[10px] text-zinc-500 mt-0.5">
            {session.turn_count >= 5 ? '深度多轮会话' : '轻量快问'}
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800/80 rounded p-3">
          <div className="text-[11px] text-zinc-400">最后修改时间</div>
          <div className="text-xs font-medium text-zinc-300 font-mono mt-1 truncate">
            {session.modified_time ? session.modified_time.replace('T', ' ').slice(0, 16) : '未知'}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">
            创建: {session.created_time ? session.created_time.slice(0, 10) : '未知'}
          </div>
        </div>
      </div>

      {/* 首轮核心提问预览 */}
      <div className="bg-zinc-900 border border-zinc-800 rounded p-4">
        <div className="text-xs font-semibold text-zinc-300 mb-2 flex items-center justify-between">
          <span>💬 首轮 Prompt 提问全文</span>
          <span className="text-[10px] text-zinc-500 font-mono">
            {session.first_prompt.length} 字符
          </span>
        </div>
        <div className="bg-zinc-950 p-3 rounded text-xs text-zinc-300 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed border border-zinc-800/60">
          {session.first_prompt || '(无文本提问)'}
        </div>
      </div>

      {/* 预留自研渲染器插槽与详细轮次预览 */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-zinc-200">
            📜 交互轮次流 ({detail?.turns?.length ?? 0} 个 Chunks)
          </h3>
          <span className="text-[10px] text-indigo-400 bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-800/40">
            完整 Markdown 渲染器插槽已就绪
          </span>
        </div>

        {loading ? (
          <div className="py-6 text-center text-xs text-zinc-500 animate-pulse">
            正在从 SQLite 数据库装载详细轮次流...
          </div>
        ) : (
          <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
            {detail?.turns?.map((turn, idx) => (
              <div
                key={idx}
                className={`p-2.5 rounded text-xs border ${
                  turn.role === 'user'
                    ? 'bg-zinc-950 border-zinc-800 text-zinc-200'
                    : turn.is_thought
                      ? 'bg-emerald-950/20 border-emerald-900/30 text-emerald-300'
                      : 'bg-zinc-900/90 border-zinc-800/80 text-zinc-300'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-1 font-mono">
                  <span className="font-semibold uppercase text-zinc-400">
                    {turn.is_thought ? '🧠 思考链 (Thinking)' : turn.role}
                  </span>
                  <span>{turn.token_count > 0 ? `${turn.token_count} tokens` : ''}</span>
                </div>
                <div className="font-sans line-clamp-3 whitespace-pre-wrap">{turn.text}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
~~~~~

#### Acts 5: 重构主应用布局为 Master-Detail 工作台

重写 `frontend/src/app.tsx`，将左侧设定为固定宽度虚拟列表，右侧动态切换全景看板与会话详情，移除旧底部的静态 Table。

~~~~~act
write_file
frontend/src/app.tsx
~~~~~
~~~~~typescript
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { DurationTiersChart } from './components/charts/DurationTiersChart';
import { ModelDistributionChart } from './components/charts/ModelDistributionChart';
import { TokenTrendChart } from './components/charts/TokenTrendChart';
import { SessionDetailPanel } from './components/SessionDetailPanel';
import { VirtualSessionList } from './components/VirtualSessionList';
import type { MetricsSummary, SessionItem } from './types/metrics';

export type TimeRange = '7d' | '30d' | '90d' | 'this_year' | 'all';

const timeRangeSignal = signal<TimeRange>('all');
const metricsSignal = signal<MetricsSummary | null>(null);
const sessionsSignal = signal<SessionItem[]>([]);
const selectedSessionSignal = signal<SessionItem | null>(null);
const loadingSignal = signal<boolean>(true);
const syncInProgressSignal = signal<boolean>(false);

const TIME_RANGE_OPTIONS: { key: TimeRange; label: string }[] = [
  { key: '7d', label: '7天' },
  { key: '30d', label: '30天' },
  { key: '90d', label: '90天' },
  { key: 'this_year', label: '今年' },
  { key: 'all', label: '全部' },
];

async function loadDashboardData(range: TimeRange = timeRangeSignal.value) {
  if (!metricsSignal.value) {
    loadingSignal.value = true;
  }
  try {
    // limit 缺省或传 0 拉取全量会话供虚拟滚动器自如调度
    const [metricsRes, sessionsRes] = await Promise.all([
      fetch(`/api/metrics?range=${range}`).then((r) => r.json()),
      fetch(`/api/sessions?range=${range}`).then((r) => r.json()),
    ]);
    metricsSignal.value = metricsRes;
    sessionsSignal.value = sessionsRes;
  } catch (err) {
    console.error('加载审计数据失败:', err);
  } finally {
    loadingSignal.value = false;
  }
}

function handleTimeRangeChange(newRange: TimeRange) {
  timeRangeSignal.value = newRange;
  loadDashboardData(newRange);
}

async function handleTriggerSync() {
  syncInProgressSignal.value = true;
  try {
    await fetch('/api/sync?limit=50', { method: 'POST' });
    const timer = setInterval(async () => {
      try {
        const res = await fetch('/api/sync/status').then((r) => r.json());
        if (!res.is_syncing) {
          clearInterval(timer);
          syncInProgressSignal.value = false;
          await loadDashboardData();
        }
      } catch {
        clearInterval(timer);
        syncInProgressSignal.value = false;
      }
    }, 1000);
  } catch (err) {
    console.error('触发同步失败:', err);
    syncInProgressSignal.value = false;
  }
}

export function App() {
  useEffect(() => {
    loadDashboardData();
  }, []);

  const m = metricsSignal.value;
  const sessions = sessionsSignal.value;
  const currentRange = timeRangeSignal.value;
  const activeRangeLabel = TIME_RANGE_OPTIONS.find((o) => o.key === currentRange)?.label || '全部';
  const selectedSession = selectedSessionSignal.value;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans">
      {/* 顶部全局控制栏 */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <span className="text-2xl cursor-pointer" onClick={() => (selectedSessionSignal.value = null)}>
            🧠
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h1
                className="text-lg font-bold tracking-tight text-white cursor-pointer hover:text-indigo-400 transition"
                onClick={() => (selectedSessionSignal.value = null)}
              >
                AI Studio Analyzer
              </h1>
              <span className="text-[10px] font-mono uppercase bg-indigo-950/80 text-indigo-400 border border-indigo-800/60 px-1.5 py-0.2 rounded">
                v0.2 Workstation
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">
              5,000+ 会话虚拟工作台 · 个人认知审计与元工作流沉淀
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* 全局时间范围胶囊 */}
          <div className="inline-flex items-center rounded-lg bg-zinc-900 border border-zinc-800 p-0.5 shadow-inner">
            {TIME_RANGE_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => handleTimeRangeChange(key)}
                className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${
                  currentRange === key
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-zinc-800 hidden sm:block" />

          {/* 快捷操作组 */}
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={`/api/export/csv?range=${currentRange}`}
              download
              className="px-2.5 py-1 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded transition"
            >
              📥 CSV
            </a>
            <a
              href={`/api/export/jsonl?range=${currentRange}`}
              download
              className="px-2.5 py-1 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded transition"
            >
              📑 JSONL
            </a>
            <button
              type="button"
              onClick={handleTriggerSync}
              disabled={syncInProgressSignal.value}
              className="px-3 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded transition shadow-sm"
            >
              {syncInProgressSignal.value ? '同步中...' : '增量同步 (50)'}
            </button>
          </div>
        </div>
      </header>

      {/* 工作台主视口：Master-Detail 布局 */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden p-4 md:p-6 gap-6 max-w-7xl w-full mx-auto">
        {/* 左侧栏：5000+ 虚拟列表会话查看器 (固定宽 360px ~ 380px) */}
        <aside className="w-full lg:w-[380px] h-[520px] lg:h-[calc(100vh-120px)] flex-shrink-0">
          <VirtualSessionList
            sessions={sessions}
            selectedId={selectedSession?.file_id ?? null}
            onSelect={(s) => (selectedSessionSignal.value = s)}
          />
        </aside>

        {/* 右侧主视口：全景审计图表 或 单会话沉浸详情 */}
        <main className="flex-1 overflow-y-auto lg:h-[calc(100vh-120px)] pr-1 space-y-6">
          {loadingSignal.value && (
            <div className="py-24 text-center text-zinc-500 text-sm animate-pulse">
              正在从本地 SQLite WAL 数据库加载全景认知指标与会话索引...
            </div>
          )}

          {!loadingSignal.value && selectedSession && (
            <SessionDetailPanel
              session={selectedSession}
              onClose={() => (selectedSessionSignal.value = null)}
            />
          )}

          {!loadingSignal.value && !selectedSession && m && (
            <>
              {/* 四大关键能耗卡片 */}
              <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-4">
                  <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                    <span>交互总场次</span>
                    <span className="text-[10px] text-zinc-500 font-mono">[{activeRangeLabel}]</span>
                  </div>
                  <div className="mt-1.5 text-2xl font-bold text-white tracking-tight">
                    {m.total_sessions} <span className="text-xs font-normal text-zinc-500">场</span>
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-500 truncate">
                    输入: {(m.total_user_chars || 0).toLocaleString()} 字符
                  </div>
                </div>

                <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-4">
                  <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                    <span>时长中位数 (P50)</span>
                    <span className="text-[10px] text-zinc-500 font-mono">[{activeRangeLabel}]</span>
                  </div>
                  <div className="mt-1.5 text-2xl font-bold text-indigo-400 tracking-tight">
                    {m.dur_stats?.median ?? 0}{' '}
                    <span className="text-xs font-normal text-zinc-500">min</span>
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-500 truncate">
                    多轮 P50: {m.multi_dur_stats?.median ?? 0}m | Max: {m.dur_stats?.max ?? 0}m
                  </div>
                </div>

                <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-4">
                  <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                    <span>总 Token 能耗</span>
                    <span className="text-[10px] text-zinc-500 font-mono">[{activeRangeLabel}]</span>
                  </div>
                  <div className="mt-1.5 text-2xl font-bold text-emerald-400 tracking-tight">
                    {(m.tok_stats?.total || 0).toLocaleString()}
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-500 truncate">
                    思考链 (Thinking): {m.tok_stats?.thought_ratio ?? '0%'}
                  </div>
                </div>

                <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-4">
                  <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                    <span>思维摩擦力</span>
                    <span className="text-[10px] text-zinc-500 font-mono">[{activeRangeLabel}]</span>
                  </div>
                  <div className="mt-1.5 text-2xl font-bold text-amber-400 tracking-tight">
                    {m.friction_stats?.branch_ratio ?? '0%'}
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-500 truncate">
                    {m.friction_stats?.branch_sessions ?? 0} 场分叉 ({m.friction_stats?.total_retries ?? 0} 次重试)
                  </div>
                </div>
              </section>

              {/* 每日 Token 消耗趋势时序图 */}
              {m.daily_trends && m.daily_trends.length > 0 && (
                <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h2 className="text-sm font-semibold text-zinc-200">
                        📈 每日 Token 能耗趋势 (按时间序列)
                      </h2>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        展示【{activeRangeLabel}】周期内的总 Token 与思考链能耗
                      </p>
                    </div>
                    <span className="text-xs font-mono text-zinc-400 bg-zinc-800/60 px-2 py-1 rounded">
                      {m.daily_trends.length} 活跃天
                    </span>
                  </div>
                  <TokenTrendChart data={m.daily_trends} />
                </section>
              )}

              {/* 时长梯队与模型偏好双图并排 */}
              {m.total_sessions > 0 && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                  {m.duration_tiers && (
                    <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
                      <h2 className="text-sm font-semibold text-zinc-200 mb-1">⏱️ 心智时长梯队切片</h2>
                      <p className="text-xs text-zinc-500 mb-3">
                        单次任务从首轮交互到最后收尾的时间窗口跨度
                      </p>
                      <DurationTiersChart tiers={m.duration_tiers} />
                    </section>
                  )}

                  {m.model_distribution && Object.keys(m.model_distribution).length > 0 && (
                    <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
                      <h2 className="text-sm font-semibold text-zinc-200 mb-1">🤖 模型偏好分布</h2>
                      <p className="text-xs text-zinc-500 mb-3">
                        各 Gemini 模型在所选周期内的调用场次
                      </p>
                      <ModelDistributionChart distribution={m.model_distribution} />
                    </section>
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
~~~~~

### 下一步建议
1. **启动测试验证**：在终端启动前端与后端开发服务，验证左侧虚拟列表在 5k 会话下的秒级模糊搜索与滚动平滑度。
2. **提示词 Markdown 渲染器**：当需要直接在本地浏览完整会话内容时，可在 `SessionDetailPanel` 中引入 `@tailwindcss/typography` 与轻量 Markdown 解析器（如 `marked`），将各轮次（包括 Thinking 思考块）以折叠式对话流直接渲染。
