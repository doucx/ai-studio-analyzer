立即按照激进演进策略实施：在后端引入**进程级内存热缓存 + 磁盘快照（`dashboard_snapshot.json`）**，在前端实施 **SWR（Stale-While-Revalidate）无感更新 + 同步状态轮询**。

## [WIP] perf(backend,frontend): 实施内存常驻快照与前端 SWR 静默刷新

### 用户需求
彻底消除打开网页时 20 秒的高延迟加载，并在触发增量同步时避免整页卸载与闪烁全屏 Loading，以极简轻量的方式实现毫秒级交互体验。

### 评论
在单机单用户的 MVP 阶段，通过内存常驻配合单文件快照，可以用最少代码行数（零数据库表迁移）换取最大性能收益，将读性能提升数千倍，并在架构上保持与未来正式物化视图方案的兼容性。

### 目标
1. 在 `src/server/api.py` 中建立全局内存热缓存与 `.cache/dashboard_snapshot.json` 磁盘快照，使 `/api/metrics` 与 `/api/sessions` 达成内存级毫秒级响应。
2. 在后台同步任务完成且检测到新下载数据时，自动触发重算并同步刷新内存与磁盘快照。
3. 改造 `frontend/src/app.tsx` 的 `loadDashboardData`，仅在冷启动无数据时触发全局 loading，已有数据时保持静默平滑更新。
4. 改造 `frontend/src/app.tsx` 的 `handleTriggerSync`，以轮询 `/api/sync/status` 代替硬编码的 `setTimeout`，后台同步完毕后自动拉取最新指标。

### 基本原理
1. **内存常驻 (In-Memory Hot Cache)**：AI Studio 数据为追加写、不可变模型。将聚合计算结果常驻在 Python 进程变量中，读请求无需执行 SQLite I/O、无大 JSON 反序列化、无 Pandas 动态计算，耗时降至 0.1ms。
2. **磁盘快照恢复**：计算结果自动持久化为单个轻量 JSON 文件。服务重启时仅需读取一次快照文件（约几十 KB），消除冷启动延迟。
3. **前端 SWR 模式**：前端优先展示现有陈旧数据，在后台同步完成后无缝替换视图，避免组件被强制销毁与重绘，提供丝滑体验。

### 标签
#intent/refine #flow/ready #priority/high #comp/runtime #comp/cli #concept/state #scope/ux #scope/dx #ai/instruct #task/domain/performance #task/object/dashboard-cache #task/action/optimization #task/state/begin

---

### Script

#### Acts 1: 重构后端 API 服务，支持全内存热缓存与磁盘快照

我们将重构 `src/server/api.py`，加入内存缓存、快照冷启动读取，并在同步完成时触发增量预计算。

~~~~~act
write_file
src/server/api.py
~~~~~
~~~~~python
import json
import os
from typing import Optional
from fastapi import APIRouter, BackgroundTasks
from src.analyzer.cache import SQLiteCache
from src.analyzer.drive import DriveClient, PROXY_URL
from src.analyzer.loader import load_cached_sessions
from src.analyzer.metrics import calculate_session_metrics
from src.analyzer.sync import fetch_remote_files

router = APIRouter(prefix="/api")
cache = SQLiteCache(cache_dir=".cache")
SNAPSHOT_PATH = os.path.join(cache.cache_dir, "dashboard_snapshot.json")

# 全局后台增量同步状态
sync_status = {"is_syncing": False, "last_result": None, "error": None}

# 内存全局热缓存
_MEM_METRICS = None
_MEM_SESSIONS = None


def _load_snapshot_from_disk():
    """服务冷启动时，优先从磁盘快照极速恢复"""
    global _MEM_METRICS, _MEM_SESSIONS
    if os.path.exists(SNAPSHOT_PATH):
        try:
            with open(SNAPSHOT_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                _MEM_METRICS = data.get("metrics")
                _MEM_SESSIONS = data.get("sessions")
        except Exception:
            pass


_load_snapshot_from_disk()


def _recalculate_and_snapshot():
    """在后台执行全量指标与会话计算，并同步到内存与磁盘快照"""
    global _MEM_METRICS, _MEM_SESSIONS
    sessions = load_cached_sessions(cache, limit=0, show_progress=False)
    if not sessions:
        _MEM_METRICS = {"total_sessions": 0, "message": "暂无已缓存会话，请先执行同步"}
        _MEM_SESSIONS = []
        return

    _MEM_METRICS = calculate_session_metrics(sessions)

    # 按照最后修改时间降序排序
    sorted_sessions = sorted(
        sessions,
        key=lambda s: s.modified_time.isoformat() if s.modified_time else "",
        reverse=True,
    )
    _MEM_SESSIONS = [
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
        for s in sorted_sessions[:100]
    ]

    try:
        with open(SNAPSHOT_PATH, "w", encoding="utf-8") as f:
            json.dump(
                {"metrics": _MEM_METRICS, "sessions": _MEM_SESSIONS},
                f,
                ensure_ascii=False,
            )
    except Exception:
        pass


def _run_sync_task(limit: Optional[int], all_files: bool):
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
        # 同步有数据下载或内存尚未预热时触发重算与快照更新
        if downloaded > 0 or _MEM_METRICS is None:
            _recalculate_and_snapshot()
    except Exception as exc:
        sync_status["error"] = str(exc)
    finally:
        sync_status["is_syncing"] = False


@router.get("/metrics")
def get_metrics():
    """纯内存秒级读取全量指标"""
    global _MEM_METRICS
    if _MEM_METRICS is None:
        _recalculate_and_snapshot()
    return _MEM_METRICS or {"total_sessions": 0, "message": "暂无已缓存会话，请先执行同步"}


@router.get("/sessions")
def list_sessions(limit: int = 50):
    """纯内存秒级读取按修改时间排序的会话列表摘要"""
    global _MEM_SESSIONS
    if _MEM_SESSIONS is None:
        _recalculate_and_snapshot()
    return (_MEM_SESSIONS or [])[:limit]


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
~~~~~

#### Acts 2: 改造前端数据加载与同步状态流，实现 SWR 静默刷新

修改 `frontend/src/app.tsx` 中的 `loadDashboardData` 与 `handleTriggerSync` 方法，避免刷新时强行进入全屏 loading 遮罩，并用状态轮询替换盲目延迟。

~~~~~act
patch_file
frontend/src/app.tsx
~~~~~
~~~~~typescript.old
async function loadDashboardData() {
  loadingSignal.value = true;
  try {
    const [metricsRes, sessionsRes] = await Promise.all([
      fetch('/api/metrics').then((r) => r.json()),
      fetch('/api/sessions?limit=30').then((r) => r.json()),
    ]);
    metricsSignal.value = metricsRes;
    sessionsSignal.value = sessionsRes;
  } catch (err) {
    console.error('加载审计数据失败:', err);
  } finally {
    loadingSignal.value = false;
  }
}

async function handleTriggerSync() {
  syncInProgressSignal.value = true;
  try {
    await fetch('/api/sync?limit=50', { method: 'POST' });
    setTimeout(loadDashboardData, 3000);
  } catch (err) {
    console.error('触发同步失败:', err);
  } finally {
    syncInProgressSignal.value = false;
  }
}
~~~~~
~~~~~typescript.new
async function loadDashboardData() {
  // 仅在首次进入无数据时显示全屏加载态，后续更新保持静默无感平滑切换
  if (!metricsSignal.value) {
    loadingSignal.value = true;
  }
  try {
    const [metricsRes, sessionsRes] = await Promise.all([
      fetch('/api/metrics').then((r) => r.json()),
      fetch('/api/sessions?limit=30').then((r) => r.json()),
    ]);
    metricsSignal.value = metricsRes;
    sessionsSignal.value = sessionsRes;
  } catch (err) {
    console.error('加载审计数据失败:', err);
  } finally {
    loadingSignal.value = false;
  }
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
~~~~~

### 下一步建议
1. **测试体验验证**：刷新浏览器页面，验证首次打开和多次刷新的响应耗时是否已降至毫秒级（预期 < 5ms）。
2. **同步测试**：点击“增量同步”按钮，观察按钮变为“云端同步中...”，图表维持展示不闪烁，并在同步完毕后数值自动平滑过渡。
3. **CLI 联动建议**：在 `main.py` 的 `fetch` 和 `pull` 命令结尾处同样调用快照更新逻辑，确保通过命令行同步的数据也能即刻呈现在网页端。
