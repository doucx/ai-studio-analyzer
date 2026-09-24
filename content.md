好的，我将通过一个完整的 Quipu 计划来端到端实施方案 B（全局时间范围过滤器）。

## [WIP] feat(dashboard): 实现全局时间范围切片过滤器与指标联动

### 用户需求
为 AI Studio Analyzer 落地全局时间范围过滤器，支持「7天」、「30天」、「90天」、「今年」与「全部」5 档切片，让全看板的四大关键指标卡、Token 趋势图、心智时长梯队、模型偏好分布、最近会话列表及数据导出均实现实时时空对齐与毫秒级联动。

### 评论
全局时间切片是心智与认知审计系统迈向实用化和周期复盘的关键能力。通过在后端引入内存常驻对象池并利用 Pandas 毫秒级重投影，既保证了全看板深度联动的准确性，又避免了反复读取磁盘带来的延迟，用户体验极其平滑。

### 目标
1. **指标空状态保护**：修改 `src/analyzer/metrics.py`，使空数据时返回标准零值结构，防止无记录时前端报错。
2. **后端内存重投影与接口扩展**：重构 `src/server/api.py`，引入全局内存池 `_ALL_SESSIONS` 与 `filter_sessions_by_range` 工具函数，为 `/api/metrics`、`/api/sessions`、`/api/export/csv`、`/api/export/jsonl` 增加 `range` 参数支持。
3. **前端时间控制器与状态联动**：修改 `frontend/src/app.tsx`，引入 `timeRangeSignal`，在 Header 加入 Segmented Control 胶囊切换按钮组，使所有指标、图表、表格与导出按钮响应当前时间窗口。

### 基本原理
- **后端策略**：服务启动时预热加载全量 `PromptSession` 到内存。当收到前端携带 `range` 的请求时，以 `session.end_time`（最后修改或末轮发言时间）作为时间锚点进行切片，由 Pandas 进行指标聚合，计算延迟小于 5ms。
- **前端策略**：使用 Preact Signals 管理全局 `timeRange` 状态，切换切片时通过异步请求拉取投影数据，导出链接动态附带 `?range=`，并在时间窗口无数据时提供温和的 Empty State 提示。

### 标签
#intent/build #flow/ready #priority/high #comp/cli #comp/runtime #concept/state #concept/ui #scope/core #scope/ux #ai/instruct #task/domain/ui #task/object/global-time-filter #task/action/integration #task/state/begin

---

### Script

#### Acts 1: 完善指标计算引擎的空状态默认结构

修改 `src/analyzer/metrics.py`，确保在无匹配会话时返回完整的零值结构。

~~~~~act
write_file
src/analyzer/metrics.py
~~~~~
~~~~~python
from typing import List, Dict, Any
import pandas as pd
from .models import PromptSession


def calculate_session_metrics(sessions: List[PromptSession]) -> Dict[str, Any]:
    """
    基于 pandas 的稳健认知与交互指标引擎：
    1. 引入中位数 (Median) 与分位数 (P75, P90)，抗长尾极值干扰
    2. 生命周期心智时长梯队切片
    3. Token 能耗与思考链细分
    4. 沟通阻抗与模型分布
    """
    if not sessions:
        return {
            "total_sessions": 0,
            "total_turns": 0,
            "total_user_chars": 0,
            "turn_stats": {
                "mean": 0.0,
                "median": 0.0,
                "p75": 0.0,
                "p90": 0.0,
                "deep_count": 0,
                "deep_ratio": "0.0%",
            },
            "dur_stats": {
                "mean": 0.0,
                "median": 0.0,
                "p75": 0.0,
                "p90": 0.0,
                "max": 0.0,
                "valid_count": 0,
            },
            "multi_dur_stats": {
                "mean": 0.0,
                "median": 0.0,
                "p75": 0.0,
                "p90": 0.0,
            },
            "duration_tiers": {
                "flash": (0, "0.0%"),
                "focus": (0, "0.0%"),
                "deep": (0, "0.0%"),
                "epic": (0, "0.0%"),
            },
            "tok_stats": {
                "total": 0,
                "mean": 0.0,
                "median": 0.0,
                "p75": 0.0,
                "p90": 0.0,
                "total_thought": 0,
                "thought_ratio": "0%",
            },
            "friction_stats": {
                "branch_sessions": 0,
                "branch_ratio": "0.0%",
                "total_retries": 0,
            },
            "sys_instruction_count": 0,
            "model_distribution": {},
            "daily_trends": [],
            "message": "当前时间范围内无会话记录",
        }

    total_sessions = len(sessions)

    # 1. 构造结构化 DataFrame
    records = []
    for s in sessions:
        st = s.start_time or s.modified_time
        date_str = st.strftime("%Y-%m-%d") if st else None
        records.append(
            {
                "file_id": s.file_id,
                "date": date_str,
                "turn_count": s.turn_count,
                "duration_seconds": s.duration_seconds,
                "duration_minutes": round(s.duration_seconds / 60, 2),
                "total_tokens": s.total_tokens,
                "thought_tokens": s.thought_tokens,
                "user_chars": s.total_user_chars,
                "has_branching": s.has_branching,
                "branch_count": s.branch_count,
                "has_sys_instruction": bool(s.system_instruction),
                "model": s.model,
            }
        )

    df = pd.DataFrame(records)

    # 2. 对话轮次分位数
    turn_s = df["turn_count"]
    turn_stats = {
        "mean": round(float(turn_s.mean()), 2),
        "median": round(float(turn_s.median()), 1),
        "p75": round(float(turn_s.quantile(0.75)), 1),
        "p90": round(float(turn_s.quantile(0.90)), 1),
        "deep_count": int((turn_s >= 5).sum()),
        "deep_ratio": f"{round(float((turn_s >= 5).mean()) * 100, 1)}%",
    }

    # 3. 会话时长 (Duration) 分位数与长尾过滤 (仅统计有效交互时长 >= 10 秒的会话)
    meaningful_df = df[df["duration_seconds"] >= 10]
    if not meaningful_df.empty:
        dur_s = meaningful_df["duration_minutes"]
        dur_stats = {
            "mean": round(float(dur_s.mean()), 1),
            "median": round(float(dur_s.median()), 1),
            "p75": round(float(dur_s.quantile(0.75)), 1),
            "p90": round(float(dur_s.quantile(0.90)), 1),
            "max": round(float(dur_s.max()), 1),
            "valid_count": len(meaningful_df),
        }
    else:
        dur_stats = {
            "mean": 0.0,
            "median": 0.0,
            "p75": 0.0,
            "p90": 0.0,
            "max": 0.0,
            "valid_count": 0,
        }

    # 多轮深入会话 (≥2 轮) 专属时长统计
    multi_turn_df = df[df["turn_count"] >= 2]
    if not multi_turn_df.empty and (multi_turn_df["duration_seconds"] > 0).any():
        m_dur_s = multi_turn_df[multi_turn_df["duration_seconds"] > 0][
            "duration_minutes"
        ]
        multi_dur_stats = {
            "mean": round(float(m_dur_s.mean()), 1),
            "median": round(float(m_dur_s.median()), 1),
            "p75": round(float(m_dur_s.quantile(0.75)), 1),
            "p90": round(float(m_dur_s.quantile(0.90)), 1),
        }
    else:
        multi_dur_stats = {"mean": 0.0, "median": 0.0, "p75": 0.0, "p90": 0.0}

    # 时长心智梯队划分
    tier_flash = int((df["duration_minutes"] < 10).sum())  # 即时快问 (<10m)
    tier_focus = int(
        ((df["duration_minutes"] >= 10) & (df["duration_minutes"] < 60)).sum()
    )  # 聚焦推进 (10~60m)
    tier_deep = int(
        ((df["duration_minutes"] >= 60) & (df["duration_minutes"] < 360)).sum()
    )  # 深度攻坚 (1~6h)
    tier_epic = int((df["duration_minutes"] >= 360).sum())  # 跨日长线 (>6h)

    duration_tiers = {
        "flash": (tier_flash, f"{round(tier_flash / total_sessions * 100, 1)}%"),
        "focus": (tier_focus, f"{round(tier_focus / total_sessions * 100, 1)}%"),
        "deep": (tier_deep, f"{round(tier_deep / total_sessions * 100, 1)}%"),
        "epic": (tier_epic, f"{round(tier_epic / total_sessions * 100, 1)}%"),
    }

    # 4. Token 消耗分位数
    tok_s = df["total_tokens"]
    total_tokens = int(tok_s.sum())
    total_thought_tokens = int(df["thought_tokens"].sum())
    tok_stats = {
        "total": total_tokens,
        "mean": round(float(tok_s.mean()), 0),
        "median": round(float(tok_s.median()), 0),
        "p75": round(float(tok_s.quantile(0.75)), 0),
        "p90": round(float(tok_s.quantile(0.90)), 0),
        "total_thought": total_thought_tokens,
        "thought_ratio": f"{round(total_thought_tokens / total_tokens * 100, 2)}%"
        if total_tokens > 0
        else "0%",
    }

    # 5. 思维摩擦力与分支
    branch_count = int(df["has_branching"].sum())
    friction_stats = {
        "branch_sessions": branch_count,
        "branch_ratio": f"{round(branch_count / total_sessions * 100, 1)}%",
        "total_retries": int(df["branch_count"].sum()),
    }

    # 6. 模型偏好分布
    model_dist = df["model"].value_counts().to_dict()

    # 7. 每日 Token 消耗与活跃趋势聚合 (按日期升序)
    daily_trends = []
    valid_dates_df = df[df["date"].notna()]
    if not valid_dates_df.empty:
        grouped = (
            valid_dates_df.groupby("date")
            .agg(
                total_tokens=("total_tokens", "sum"),
                thought_tokens=("thought_tokens", "sum"),
                sessions=("file_id", "count"),
                turns=("turn_count", "sum"),
            )
            .reset_index()
            .sort_values("date")
        )

        for _, row in grouped.iterrows():
            daily_trends.append(
                {
                    "date": str(row["date"]),
                    "total_tokens": int(row["total_tokens"]),
                    "thought_tokens": int(row["thought_tokens"]),
                    "sessions": int(row["sessions"]),
                    "turns": int(row["turns"]),
                }
            )

    return {
        "total_sessions": total_sessions,
        "total_turns": int(turn_s.sum()),
        "total_user_chars": int(df["user_chars"].sum()),
        "turn_stats": turn_stats,
        "dur_stats": dur_stats,
        "multi_dur_stats": multi_dur_stats,
        "duration_tiers": duration_tiers,
        "tok_stats": tok_stats,
        "friction_stats": friction_stats,
        "sys_instruction_count": int(df["has_sys_instruction"].sum()),
        "model_distribution": model_dist,
        "daily_trends": daily_trends,
    }
~~~~~

#### Acts 2: 改造后端 API 层支持全局内存常驻与时间范围切片

更新 `src/server/api.py`，引入常驻内存会话池 `_ALL_SESSIONS`、时间切片过滤函数 `filter_sessions_by_range`，并在所有接口支持 `range` 参数。

~~~~~act
write_file
src/server/api.py
~~~~~
~~~~~python
import os
import tempfile
from datetime import datetime, timedelta, timezone
from typing import Optional, List
from fastapi import APIRouter, BackgroundTasks
from fastapi.responses import FileResponse
from src.analyzer.cache import SQLiteCache
from src.analyzer.drive import DriveClient, PROXY_URL
from src.analyzer.exporter import (
    export_first_prompts_to_jsonl,
    export_prompts_summary_csv,
)
from src.analyzer.loader import load_cached_sessions
from src.analyzer.metrics import calculate_session_metrics
from src.analyzer.models import PromptSession
from src.analyzer.sync import fetch_remote_files

router = APIRouter(prefix="/api")
cache = SQLiteCache(cache_dir=".cache")

# 全局后台增量同步状态
sync_status = {"is_syncing": False, "last_result": None, "error": None}

# 内存常驻已反序列化的全量会话对象池
_ALL_SESSIONS: Optional[List[PromptSession]] = None


def _ensure_sessions_loaded() -> List[PromptSession]:
    """确保内存中常驻已解析的全量会话列表"""
    global _ALL_SESSIONS
    if _ALL_SESSIONS is None:
        _ALL_SESSIONS = load_cached_sessions(cache, limit=0, show_progress=False)
    return _ALL_SESSIONS


def filter_sessions_by_range(
    sessions: List[PromptSession], range_key: str
) -> List[PromptSession]:
    """
    根据时间范围切片关键词过滤会话：
    - '7d': 最近 7 天
    - '30d': 最近 30 天
    - '90d': 最近 90 天
    - 'this_year': 今年以来
    - 'all': 全量历史
    """
    if range_key == "all" or not sessions:
        return sessions

    now = datetime.now(timezone.utc)
    if range_key == "7d":
        start_time = now - timedelta(days=7)
    elif range_key == "30d":
        start_time = now - timedelta(days=30)
    elif range_key == "90d":
        start_time = now - timedelta(days=90)
    elif range_key == "this_year":
        start_time = datetime(now.year, 1, 1, tzinfo=timezone.utc)
    else:
        return sessions

    filtered = []
    for s in sessions:
        ref_time = s.end_time or s.modified_time or s.start_time
        if ref_time:
            # 兼容带时区与不带时区的时间戳比较
            if ref_time.tzinfo is None:
                ref_time = ref_time.replace(tzinfo=timezone.utc)
            if ref_time >= start_time:
                filtered.append(s)
    return filtered


def _run_sync_task(limit: Optional[int], all_files: bool):
    global _ALL_SESSIONS
    sync_status["is_syncing"] = True
    sync_status["error"] = None
    try:
        client = DriveClient(proxy_url=PROXY_URL)
        total, hits, downloaded = fetch_remote_files(
            client=client, cache=cache, limit=limit, all_files=all_files
        )
        sync_status["last_result"] = {
            "total_scanned": total,
            "cache_hits": hits,
            "downloaded": downloaded,
            "cache_total": cache.count(),
        }
        # 如果有新下载内容，重新加载内存常驻会话池
        if downloaded > 0 or _ALL_SESSIONS is None:
            _ALL_SESSIONS = load_cached_sessions(cache, limit=0, show_progress=False)
    except Exception as exc:
        sync_status["error"] = str(exc)
    finally:
        sync_status["is_syncing"] = False


@router.get("/metrics")
def get_metrics(range: str = "all"):
    """
    基于内存常驻会话，极速按时间窗口投影指标计算。
    支持 range: '7d' | '30d' | '90d' | 'this_year' | 'all'
    """
    all_sessions = _ensure_sessions_loaded()
    filtered = filter_sessions_by_range(all_sessions, range)
    return calculate_session_metrics(filtered)


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


@router.post("/sync")
def trigger_sync(
    background_tasks: BackgroundTasks, limit: int = 50, all_files: bool = False
):
    """异步触发云端增量同步任务"""
    if sync_status["is_syncing"]:
        return {"status": "busy", "message": "增量同步正在进行中，请勿重复触发"}

    background_tasks.add_task(_run_sync_task, limit=limit, all_files=all_files)
    mode_text = "全量" if all_files else f"最近 {limit} 条"
    return {"status": "started", "message": f"后台已启动云盘增量拉取 ({mode_text})"}


@router.get("/sync/status")
def get_sync_status():
    """查询后台同步进度状态"""
    return sync_status


@router.get("/export/csv")
def export_csv(range: str = "all"):
    """导出指定时间范围的会话指标明细 CSV"""
    all_sessions = _ensure_sessions_loaded()
    filtered = filter_sessions_by_range(all_sessions, range)
    if not filtered:
        return {"error": "当前时间范围内无可导出会话"}
    tmp_path = os.path.join(tempfile.gettempdir(), f"prompts_summary_{range}.csv")
    export_prompts_summary_csv(filtered, tmp_path)
    return FileResponse(
        path=tmp_path,
        filename=f"prompts_summary_{range}.csv",
        media_type="text/csv",
    )


@router.get("/export/jsonl")
def export_jsonl(range: str = "all"):
    """导出指定时间范围的首轮提问清洗集 JSONL"""
    all_sessions = _ensure_sessions_loaded()
    filtered = filter_sessions_by_range(all_sessions, range)
    if not filtered:
        return {"error": "当前时间范围内无可导出会话"}
    tmp_path = os.path.join(
        tempfile.gettempdir(), f"first_prompts_{range}_for_clustering.jsonl"
    )
    export_first_prompts_to_jsonl(filtered, tmp_path)
    return FileResponse(
        path=tmp_path,
        filename=f"first_prompts_{range}_for_clustering.jsonl",
        media_type="application/jsonlines",
    )
~~~~~

#### Acts 3: 前端页面集成全局时间范围选择器与全盘联动

更新 `frontend/src/app.tsx`：
1. 增加 `TimeRange` 状态 `timeRangeSignal`。
2. 数据加载函数和导出按钮全面透传当前时间切片。
3. 在顶部 Header 注入交互胶囊按钮组。
4. 添加空数据友好提示与统计卡片安全性保护。

~~~~~act
write_file
frontend/src/app.tsx
~~~~~
~~~~~tsx
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { DurationTiersChart } from './components/charts/DurationTiersChart';
import { ModelDistributionChart } from './components/charts/ModelDistributionChart';
import { TokenTrendChart } from './components/charts/TokenTrendChart';
import type { MetricsSummary, SessionItem } from './types/metrics';

export type TimeRange = '7d' | '30d' | '90d' | 'this_year' | 'all';

const timeRangeSignal = signal<TimeRange>('all');
const metricsSignal = signal<MetricsSummary | null>(null);
const sessionsSignal = signal<SessionItem[]>([]);
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
  // 仅在首次进入无数据时显示全屏加载态，后续更新保持静默无感平滑切换
  if (!metricsSignal.value) {
    loadingSignal.value = true;
  }
  try {
    const [metricsRes, sessionsRes] = await Promise.all([
      fetch(`/api/metrics?range=${range}`).then((r) => r.json()),
      fetch(`/api/sessions?range=${range}&limit=30`).then((r) => r.json()),
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

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 md:p-10 max-w-7xl mx-auto font-sans">
      {/* 顶部标题与控制条 */}
      <header className="flex flex-col lg:flex-row lg:items-center justify-between border-b border-zinc-800 pb-6 gap-5">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-2xl">🧠</span>
            <h1 className="text-2xl font-bold tracking-tight text-white">AI Studio Analyzer</h1>
            <span className="text-xs font-mono uppercase bg-indigo-950/80 text-indigo-400 border border-indigo-800/60 px-2 py-0.5 rounded">
              Auditor v0.1
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            个人认知与交互审计系统 · 纯离线高性能分析与元工作流沉淀
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* 全局时间范围胶囊选择器 */}
          <div className="inline-flex items-center rounded-lg bg-zinc-900 border border-zinc-800 p-0.5 shadow-inner">
            {TIME_RANGE_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => handleTimeRangeChange(key)}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${
                  currentRange === key
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="h-5 w-px bg-zinc-800 hidden sm:block" />

          {/* 导出与同步操作组 */}
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={`/api/export/csv?range=${currentRange}`}
              download
              className="px-3 py-1.5 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded transition flex items-center gap-1.5"
              title={`导出 ${activeRangeLabel} 的 CSV 报表`}
            >
              <span>📥</span> 导出 CSV
            </a>
            <a
              href={`/api/export/jsonl?range=${currentRange}`}
              download
              className="px-3 py-1.5 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded transition flex items-center gap-1.5"
              title={`导出 ${activeRangeLabel} 的 JSONL 清洗集`}
            >
              <span>📑</span> 导出 JSONL
            </a>
            <button
              type="button"
              onClick={() => loadDashboardData(currentRange)}
              className="px-3 py-1.5 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded transition"
            >
              刷新指标
            </button>
            <button
              type="button"
              onClick={handleTriggerSync}
              disabled={syncInProgressSignal.value}
              className="px-3.5 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded transition shadow-sm"
            >
              {syncInProgressSignal.value ? '云端同步中...' : '增量同步 (Fetch 50)'}
            </button>
          </div>
        </div>
      </header>

      {/* 加载状态 */}
      {loadingSignal.value && (
        <div className="py-20 text-center text-zinc-500 text-sm animate-pulse">
          正在从本地 SQLite WAL 对象库加载全景认知指标...
        </div>
      )}

      {/* 核心指标概览 */}
      {!loadingSignal.value && m && (
        <main className="mt-8 space-y-8">
          {/* 四大关键能耗卡片 */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-5">
              <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                <span>交互会话场次</span>
                <span className="text-[10px] text-zinc-500 lowercase font-mono">[{activeRangeLabel}]</span>
              </div>
              <div className="mt-2 text-2xl font-bold text-white tracking-tight">
                {m.total_sessions} <span className="text-sm font-normal text-zinc-500">场</span>
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                总字数: {(m.total_user_chars || 0).toLocaleString()} 字符
              </div>
            </div>

            <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-5">
              <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                <span>生命周期中位数 (P50)</span>
                <span className="text-[10px] text-zinc-500 lowercase font-mono">[{activeRangeLabel}]</span>
              </div>
              <div className="mt-2 text-2xl font-bold text-indigo-400 tracking-tight">
                {m.dur_stats?.median ?? 0}{' '}
                <span className="text-sm font-normal text-zinc-500">min</span>
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                多轮攻坚 P50: {m.multi_dur_stats?.median ?? 0} min | Max: {m.dur_stats?.max ?? 0}{' '}
                min
              </div>
            </div>

            <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-5">
              <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                <span>总 Token 能耗</span>
                <span className="text-[10px] text-zinc-500 lowercase font-mono">[{activeRangeLabel}]</span>
              </div>
              <div className="mt-2 text-2xl font-bold text-emerald-400 tracking-tight">
                {(m.tok_stats?.total || 0).toLocaleString()}
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                思考链 (Thinking): {m.tok_stats?.thought_ratio ?? '0%'}
              </div>
            </div>

            <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-5">
              <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                <span>思维摩擦力 (重试/分叉)</span>
                <span className="text-[10px] text-zinc-500 lowercase font-mono">[{activeRangeLabel}]</span>
              </div>
              <div className="mt-2 text-2xl font-bold text-amber-400 tracking-tight">
                {m.friction_stats?.branch_ratio ?? '0%'}
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                {m.friction_stats?.branch_sessions ?? 0} 场出现分叉 (累计{' '}
                {m.friction_stats?.total_retries ?? 0} 次重试)
              </div>
            </div>
          </section>

          {/* 当该时间范围内没有会话时的 Empty State 提示 */}
          {m.total_sessions === 0 && (
            <div className="p-8 text-center bg-zinc-900/30 border border-dashed border-zinc-800 rounded-lg">
              <p className="text-zinc-400 text-sm">
                在【{activeRangeLabel}】周期内暂无交互会话记录。
              </p>
              <button
                type="button"
                onClick={() => handleTimeRangeChange('all')}
                className="mt-3 text-xs text-indigo-400 hover:text-indigo-300 underline"
              >
                切换为查看全部历史
              </button>
            </div>
          )}

          {/* 每日 Token 消耗趋势时序图 */}
          {m.daily_trends && m.daily_trends.length > 0 && (
            <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-200">
                    📈 每日 Token 能耗趋势 (按时间序列)
                  </h2>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    展示【{activeRangeLabel}】周期内的总 Token 与模型思考链 (Thinking) 能耗走势
                  </p>
                </div>
                <span className="text-xs font-mono text-zinc-400 bg-zinc-800/60 px-2 py-1 rounded">
                  {m.daily_trends.length} 个活跃天
                </span>
              </div>
              <TokenTrendChart data={m.daily_trends} />
            </section>
          )}

          {/* 时长梯队与模型分布双图并排 */}
          {m.total_sessions > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 心智时长梯队环形图 */}
              {m.duration_tiers && (
                <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
                  <h2 className="text-sm font-semibold text-zinc-200 mb-1">⏱️ 心智时长梯队切片</h2>
                  <p className="text-xs text-zinc-500 mb-4">
                    单次任务从首轮交互到最后收尾的时间窗口跨度 ({activeRangeLabel})
                  </p>
                  <DurationTiersChart tiers={m.duration_tiers} />
                </section>
              )}

              {/* 模型使用偏好条形图 */}
              {m.model_distribution && Object.keys(m.model_distribution).length > 0 && (
                <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
                  <h2 className="text-sm font-semibold text-zinc-200 mb-1">🤖 模型偏好与实验分布</h2>
                  <p className="text-xs text-zinc-500 mb-4">
                    各 Gemini 模型在所选周期内的调用总场次 ({activeRangeLabel})
                  </p>
                  <ModelDistributionChart distribution={m.model_distribution} />
                </section>
              )}
            </div>
          )}

          {/* 最近会话列表预览 */}
          {sessions.length > 0 && (
            <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-zinc-200">
                  📋 交互会话明细 (周期: {activeRangeLabel}，采样前 {sessions.length} 场)
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-zinc-300">
                  <thead className="bg-zinc-900/80 text-zinc-400 uppercase text-[10px] tracking-wider border-b border-zinc-800">
                    <tr>
                      <th className="py-2.5 px-3">会话标题</th>
                      <th className="py-2.5 px-3">模型</th>
                      <th className="py-2.5 px-3">轮次</th>
                      <th className="py-2.5 px-3">时长</th>
                      <th className="py-2.5 px-3">Token 消耗</th>
                      <th className="py-2.5 px-3">首轮提问预览</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50 font-mono">
                    {sessions.map((s) => (
                      <tr key={s.file_id} className="hover:bg-zinc-800/40 transition">
                        <td className="py-2.5 px-3 font-sans font-medium text-white max-w-[200px] truncate">
                          {s.name}
                          {s.has_branching && (
                            <span className="ml-1.5 px-1 py-0.2 bg-amber-950/80 text-amber-400 border border-amber-800/50 text-[10px] rounded">
                              分叉
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-zinc-400">
                          {s.model.replace('models/', '')}
                        </td>
                        <td className="py-2.5 px-3">{s.turn_count} 轮</td>
                        <td className="py-2.5 px-3">{s.duration_human}</td>
                        <td className="py-2.5 px-3">{s.total_tokens.toLocaleString()}</td>
                        <td className="py-2.5 px-3 font-sans text-zinc-400 max-w-xs truncate">
                          {s.first_prompt || '(无文本提问)'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </main>
      )}
    </div>
  );
}
~~~~~

### 下一步建议
1. **本地调试与验证**：运行前端检查命令（如 `cd frontend && pnpm check` 或 `npm run check`），并启动 FastAPI (`python main.py`) 验证切换 7d / 30d / 90d / this_year / all 时的联动效果与导出正确性。
2. **提交版本**：确认效果符合预期后，使用 `[COMMIT]` 计划将此次时间范围切片过滤器的改动提交到 Git 仓库。
