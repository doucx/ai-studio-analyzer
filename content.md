现在开始执行路线图中的 **Phase 2: ai-studio-analyzer 认知时量与时间线批量接口**。

我们将保持底层数据库与服务端的 UTC 标准时间格式不变，在后端构建本地日历聚合时间线端点（`GET /api/daily/timeline` 与 `GET /api/daily/today`），并在前端实现本地时区投影工具函数，消除会话详情中的时差滞后，同时在大盘顶部挂载【今日心智耗时】卡片。

## [WIP] feat(analyzer): 实现本地时区自适应、每日时间线聚合接口与今日看板卡片 (Phase 2)

### 用户需求
1. **解决时区倒退问题**：保持数据库底层标准的 UTC ISO-8601 原貌不变，前端展示时自动调用本地时区转换工具，彻底解决查看会话时间时出现的 8 小时倒退问题。
2. **规避 N+1 轮询瓶颈**：后端提供基于本地日历投影的批量聚合端点 `GET /api/daily/timeline` 和当天切片端点 `GET /api/daily/today`，支持跨日记快速反查与当天即时回填。
3. **增加实时度量卡片**：在前端全景大盘顶部增加【今日心智耗时】指示胶囊，直观展示今日 AI 活跃时长、交互场次与 Token 消耗。

### 评论
将时区计算放置在消费端和查询汇聚层（而不是重构或篡改已有底层数据库数据），是最稳定且具备跨时区适应性的方案。同时，`timeline` 批量接口为后续 Phase 3 中 `neuron daylog link-ai --all` 的毫秒级批量关联打下了关键前置支撑。

### 目标
1. 在 `src/server/api.py` 中添加 `GET /api/daily/timeline` 与 `GET /api/daily/today` 端点，根据服务运行环境的本地时区投影会话并聚合每日心智时长与能耗。
2. 在 `frontend/src/utils/date.ts` 中封装 `formatLocalTime` 工具函数，并替换 `SessionDetailPanel.tsx` 中的原始字符串切片。
3. 在 `frontend/src/types/metrics.ts` 和 `frontend/src/state/metrics.ts` 中增加每日时量类型定义与状态管理。
4. 在 `frontend/src/components/OverviewDashboard.tsx` 顶部增加【今日心智耗时】卡片并在 `app.tsx` 中配置自动拉取。

### 基本原理
- **时区安全**：使用 `datetime.fromisoformat(...).astimezone()` 解析 UTC 时间并投影到本地日历，避免临界跨天导致的日记归属错位。
- **批量聚合防 N+1**：通过单次查询内存汇总生成 `date_timeline` 结构，将原来需要发起数千次 HTTP 请求的逐日探针收敛为单次请求。
- **前端原生国际化**：利用浏览器的 `new Date(isoStr).toLocaleString()` 遵循终端用户本地时区和偏好格式。

### 标签
#intent/build #flow/ready #priority/high #comp/runtime #comp/cli #concept/ui #scope/api #scope/ux #ai/instruct #task/domain/analyzer #task/object/daily-timeline-api #task/action/implementation #task/state/begin

---

### Script

#### Acts 1: 在后端 API 中实现本地时间线与今日切片端点

在 `src/server/api.py` 中增加 `GET /api/daily/timeline` 与 `GET /api/daily/today`。

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~python
from src.analyzer.drive import DriveClient
from src.analyzer.metrics import calculate_session_metrics
from src.analyzer.parser import parse_prompt_json
from src.analyzer.sync import fetch_remote_files

router = APIRouter(prefix="/api")
cache = SQLiteCache(cache_dir=".cache")
~~~~~
~~~~~python
from src.analyzer.drive import DriveClient
from src.analyzer.metrics import calculate_session_metrics
from src.analyzer.parser import parse_prompt_json
from src.analyzer.sync import fetch_remote_files

router = APIRouter(prefix="/api")
cache = SQLiteCache(cache_dir=".cache")


def _format_seconds_human(total_sec: float | int) -> str:
    total_sec = int(total_sec)
    if total_sec < 60:
        return f"{total_sec}s"
    hours, remainder = divmod(total_sec, 3600)
    minutes, _ = divmod(remainder, 60)
    parts = []
    if hours > 0:
        parts.append(f"{hours}h")
    if minutes > 0:
        parts.append(f"{minutes}m")
    if not parts:
        parts.append("0m")
    return " ".join(parts)
~~~~~

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~python
@router.get("/metrics")
def get_metrics(range: str = "all"):
    """
    基于 session_index 表毫秒级聚合认知与交互指标（耗时 <10ms）。
    """
    range_start = _get_range_start_iso(range)
    indices = cache.query_indices(range_start_iso=range_start)
    return calculate_session_metrics(indices)
~~~~~
~~~~~python
@router.get("/daily/timeline")
def get_daily_timeline(days: Optional[int] = None):
    """
    按本地日历日期聚合返回所有会话的每日时间线 (一次性拉取，规避 N+1 轮询)。
    """
    indices = cache.query_indices()
    local_tz = datetime.now().astimezone().tzinfo

    timeline: dict[str, dict] = {}

    for idx in indices:
        mtime_str = idx["modified_time"] or idx["created_time"]
        if not mtime_str:
            continue
        try:
            dt_utc = datetime.fromisoformat(mtime_str.replace("Z", "+00:00"))
            dt_local = dt_utc.astimezone(local_tz)
            date_key = dt_local.strftime("%Y-%m-%d")
        except Exception:
            continue

        if date_key not in timeline:
            timeline[date_key] = {
                "date": date_key,
                "total_duration_seconds": 0.0,
                "total_tokens": 0,
                "thought_tokens": 0,
                "session_count": 0,
                "sessions": [],
            }

        dur_sec = idx.get("duration_seconds") or 0.0
        timeline[date_key]["total_duration_seconds"] += dur_sec
        timeline[date_key]["total_tokens"] += idx.get("total_tokens", 0)
        timeline[date_key]["thought_tokens"] += idx.get("thought_tokens", 0)
        timeline[date_key]["session_count"] += 1

        timeline[date_key]["sessions"].append(
            {
                "file_id": idx["file_id"],
                "name": idx["name"],
                "model": idx["model"].replace("models/", ""),
                "duration": idx["duration_human"],
                "duration_seconds": idx.get("duration_seconds"),
                "tokens": idx.get("total_tokens", 0),
                "thought_tokens": idx.get("thought_tokens", 0),
                "first_prompt": idx.get("first_prompt") or "",
                "time_local": dt_local.strftime("%H:%M"),
            }
        )

    sorted_dates = sorted(timeline.keys(), reverse=True)
    if days and days > 0:
        sorted_dates = sorted_dates[:days]

    result = {}
    for d in sorted_dates:
        item = timeline[d]
        item["total_duration_human"] = _format_seconds_human(
            item["total_duration_seconds"]
        )
        item["sessions"].sort(key=lambda s: s.get("time_local", ""), reverse=True)
        result[d] = item

    return {"date_timeline": result}


@router.get("/daily/today")
def get_daily_today():
    """
    获取今天（本地日历）的交互场次、总心智耗时与能耗切片。
    """
    today_str = datetime.now().astimezone().strftime("%Y-%m-%d")
    timeline_resp = get_daily_timeline()
    today_item = timeline_resp["date_timeline"].get(
        today_str,
        {
            "date": today_str,
            "total_duration_seconds": 0.0,
            "total_duration_human": "0m",
            "total_tokens": 0,
            "thought_tokens": 0,
            "session_count": 0,
            "sessions": [],
        },
    )
    return today_item


@router.get("/metrics")
def get_metrics(range: str = "all"):
    """
    基于 session_index 表毫秒级聚合认知与交互指标（耗时 <10ms）。
    """
    range_start = _get_range_start_iso(range)
    indices = cache.query_indices(range_start_iso=range_start)
    return calculate_session_metrics(indices)
~~~~~

#### Acts 2: 封装前端本地时区转换工具并修复会话详情时差

创建 `frontend/src/utils/date.ts`，并在 `SessionDetailPanel.tsx` 中应用，消除 8 小时倒退。

~~~~~act
write_file
frontend/src/utils/date.ts
~~~~~
~~~~~typescript
/**
 * 本地时区格式化工具函数：基于浏览器原生时区能力安全转换 ISO-8601 时间串。
 */
export function formatLocalTime(isoStr: string | null | undefined, includeTime = true): string {
  if (!isoStr) return '未知';
  try {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return isoStr;
    if (!includeTime) {
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    }
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return isoStr;
  }
}
~~~~~

~~~~~act
patch_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~typescript
import { marked } from 'marked';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { syncVersionSignal } from '../state/sync';
import type { ConversationTurnItem, SessionDetail, SessionItem } from '../types/metrics';
~~~~~
~~~~~typescript
import { marked } from 'marked';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { syncVersionSignal } from '../state/sync';
import type { ConversationTurnItem, SessionDetail, SessionItem } from '../types/metrics';
import { formatLocalTime } from '../utils/date';
~~~~~

~~~~~act
patch_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~typescript
          <div className="bg-zinc-900/80 border border-zinc-800/60 rounded p-2.5">
            <div className="text-[10px] text-zinc-400">最后修改时间</div>
            <div className="text-xs font-medium text-zinc-300 font-mono mt-1 truncate">
              {session.modified_time
                ? session.modified_time.replace('T', ' ').slice(0, 16)
                : '未知'}
            </div>
            <div className="text-[10px] text-zinc-500 truncate">
              创建: {session.created_time ? session.created_time.slice(0, 10) : '未知'}
            </div>
          </div>
~~~~~
~~~~~typescript
          <div className="bg-zinc-900/80 border border-zinc-800/60 rounded p-2.5">
            <div className="text-[10px] text-zinc-400">最后修改时间</div>
            <div className="text-xs font-medium text-zinc-300 font-mono mt-1 truncate" title={session.modified_time || ''}>
              {formatLocalTime(session.modified_time)}
            </div>
            <div className="text-[10px] text-zinc-500 truncate" title={session.created_time || ''}>
              创建: {formatLocalTime(session.created_time, false)}
            </div>
          </div>
~~~~~

#### Acts 3: 扩充度量类型与前端状态管理

在 `frontend/src/types/metrics.ts` 与 `frontend/src/state/metrics.ts` 声明每日时间线类型并增加获取逻辑。

~~~~~act
patch_file
frontend/src/types/metrics.ts
~~~~~
~~~~~typescript
export interface SessionDetail extends SessionItem {
  total_user_chars: number;
  system_instruction: string;
  turns: ConversationTurnItem[];
}
~~~~~
~~~~~typescript
export interface SessionDetail extends SessionItem {
  total_user_chars: number;
  system_instruction: string;
  turns: ConversationTurnItem[];
}

export interface DailySessionBrief {
  file_id: string;
  name: string;
  model: string;
  duration: string;
  duration_seconds: number | null;
  tokens: number;
  thought_tokens: number;
  first_prompt: string;
  time_local: string;
}

export interface DailyTimelineItem {
  date: string;
  total_duration_seconds: number;
  total_duration_human: string;
  total_tokens: number;
  thought_tokens: number;
  session_count: number;
  sessions: DailySessionBrief[];
}
~~~~~

~~~~~act
patch_file
frontend/src/state/metrics.ts
~~~~~
~~~~~typescript
import { signal } from '@preact/signals';
import type { MetricsSummary } from '../types/metrics';

export type TimeRange = '7d' | '30d' | '90d' | 'this_year' | 'all';
~~~~~
~~~~~typescript
import { signal } from '@preact/signals';
import type { DailyTimelineItem, MetricsSummary } from '../types/metrics';

export type TimeRange = '7d' | '30d' | '90d' | 'this_year' | 'all';
~~~~~

~~~~~act
patch_file
frontend/src/state/metrics.ts
~~~~~
~~~~~typescript
export const timeRangeSignal = signal<TimeRange>('all');
export const metricsSignal = signal<MetricsSummary | null>(null);
export const metricsLoadingSignal = signal<boolean>(true);

export async function fetchMetrics(range: TimeRange = timeRangeSignal.value) {
~~~~~
~~~~~typescript
export const timeRangeSignal = signal<TimeRange>('all');
export const metricsSignal = signal<MetricsSummary | null>(null);
export const metricsLoadingSignal = signal<boolean>(true);
export const todayMetricsSignal = signal<DailyTimelineItem | null>(null);

export async function fetchTodayMetrics() {
  try {
    const res = await fetch('/api/daily/today');
    if (res.ok) {
      const data: DailyTimelineItem = await res.json();
      todayMetricsSignal.value = data;
    }
  } catch (err) {
    console.error('加载今日认知时量切片失败:', err);
  }
}

export async function fetchMetrics(range: TimeRange = timeRangeSignal.value) {
~~~~~

~~~~~act
patch_file
frontend/src/app.tsx
~~~~~
~~~~~typescript
import {
  TIME_RANGE_OPTIONS,
  type TimeRange,
  fetchMetrics,
  setTimeRange,
  timeRangeSignal,
} from './state/metrics';
~~~~~
~~~~~typescript
import {
  TIME_RANGE_OPTIONS,
  type TimeRange,
  fetchMetrics,
  fetchTodayMetrics,
  setTimeRange,
  timeRangeSignal,
} from './state/metrics';
~~~~~

~~~~~act
patch_file
frontend/src/app.tsx
~~~~~
~~~~~typescript
function loadAllData(range: TimeRange = timeRangeSignal.value) {
  return Promise.all([fetchMetrics(range), fetchSessions(range)]);
}
~~~~~
~~~~~typescript
function loadAllData(range: TimeRange = timeRangeSignal.value) {
  return Promise.all([fetchMetrics(range), fetchSessions(range), fetchTodayMetrics()]);
}
~~~~~

#### Acts 4: 在全景大盘顶部挂载【今日心智耗时】指标胶囊

在 `frontend/src/components/OverviewDashboard.tsx` 挂载今日认知指标展示条。

~~~~~act
patch_file
frontend/src/components/OverviewDashboard.tsx
~~~~~
~~~~~typescript
import { Bot, Clock, LineChart } from 'lucide-preact';
import type { MetricsSummary } from '../types/metrics';
import { DurationTiersChart } from './charts/DurationTiersChart';
import { ModelDistributionChart } from './charts/ModelDistributionChart';
import { TokenTrendChart } from './charts/TokenTrendChart';

interface Props {
  metrics: MetricsSummary;
  activeRangeLabel: string;
}

export function OverviewDashboard({ metrics, activeRangeLabel }: Props) {
  return (
    <div className="space-y-6">
      {/* 四大关键能耗卡片 */}
~~~~~
~~~~~typescript
import { Activity, Bot, Clock, LineChart, Sparkles } from 'lucide-preact';
import { todayMetricsSignal } from '../state/metrics';
import type { MetricsSummary } from '../types/metrics';
import { DurationTiersChart } from './charts/DurationTiersChart';
import { ModelDistributionChart } from './charts/ModelDistributionChart';
import { TokenTrendChart } from './charts/TokenTrendChart';

interface Props {
  metrics: MetricsSummary;
  activeRangeLabel: string;
}

export function OverviewDashboard({ metrics, activeRangeLabel }: Props) {
  const today = todayMetricsSignal.value;

  return (
    <div className="space-y-6">
      {/* 今日心智耗时状态条 */}
      {today && (
        <section className="bg-gradient-to-r from-indigo-950/40 via-zinc-900/60 to-zinc-900/40 border border-indigo-900/30 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Sparkles size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-zinc-100">今日人机心智活跃</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                  {today.date}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                今天已沉浸交互 <strong className="text-indigo-400">{today.session_count}</strong> 场
                {today.sessions.length > 0 && ` · 最近会话: ${today.sessions[0].name}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-6 sm:gap-8 self-end sm:self-auto text-xs font-mono">
            <div className="text-right">
              <div className="text-[10px] text-zinc-500 uppercase">活跃总时长</div>
              <div className="text-lg font-bold text-indigo-400">{today.total_duration_human}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-zinc-500 uppercase">总 Token 消耗</div>
              <div className="text-lg font-bold text-emerald-400">
                {today.total_tokens.toLocaleString()}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 四大关键能耗卡片 */}
~~~~~

### 下一步建议
1. 在前端目录执行检查：
   ```bash
   cd frontend && npm run check
   ```
   确认 TypeScript 类型与 Biome 代码规范全部通过。
2. 启动服务进行本地验证：
   ```bash
   python main.py
   ```
   并在浏览器中访问 `http://127.0.0.1:8000/docs`，验证 `GET /api/daily/timeline` 与 `GET /api/daily/today` 返回的数据结构。
3. 验证通过后，即可推进至 **Phase 3: 跨系统 API 桥接**（在 `neuron` 中实现 `link-ai` 命令，直连该后端进行日记回填）。
