我们立即着手移除旧版遗留的 CSV 与 JSONL 导出功能，包括前端顶部导航栏的操作入口、后端对应的导出路由及其全量加载逻辑，并清理不再使用的导出器模块。

## [WIP] refactor: 移除旧版 CSV 与 JSONL 导出功能及相关实现

### 用户需求
移除前端界面右上角的 CSV 与 JSONL 导出按钮，同时清理后端对应的 `export_prompts_summary_csv`、`export_first_prompts_to_jsonl`、临时全量加载逻辑及 `/api/export/*` 接口，为后续重构更优雅的导出架构做准备。

### 评论
当前导出实现属于 MVP 时期的临时方案，依赖无缓存保护的内存全量加载（`_ensure_sessions_loaded`）与粗粒度文件拼装，既不具备流式处理能力，又破坏了系统当前完全基于 SQLite 索引毫秒级响应的轻量化原则。及时剥离此类债务代码是保持系统精简与后续高质量重构的关键步骤。

### 目标
1. 从前端 `frontend/src/app.tsx` 中移除 `FileSpreadsheet` 和 `FileText` 图标导入，并删除顶部导航栏中的 CSV 与 JSONL 下载链接。
2. 从后端 `src/server/api.py` 中移除 `/api/export/csv` 和 `/api/export/jsonl` 路由定义，清理未使用的全量加载辅助函数 `_ensure_sessions_loaded`、`filter_sessions_by_range` 及相关导入。
3. 删除已废弃的导出实现文件 `src/analyzer/exporter.py`。

### 基本原理
前端 HeaderBar 仅保留增量同步按钮，使界面视觉聚焦于核心审计交互；后端移除基于内存全量拉取的旧路由与未使用的依赖包导入（如 `tempfile`、`FileResponse`），消除潜在的内存泄漏风险；直接删除 `src/analyzer/exporter.py` 保持包目录整洁。

### 标签
#intent/refine #flow/ready #priority/medium #comp/cli #concept/ui #scope/api #scope/ux #ai/instruct #task/domain/export #task/object/export-cleanup #task/action/cleanup #task/state/begin

---

### Script

#### Acts 1: 移除前端顶部导航栏的 CSV/JSONL 导出按钮及图标导入

编辑 `frontend/src/app.tsx`，移除 `FileSpreadsheet` 与 `FileText` 图标导入，并删除顶栏中的导出链接。

~~~~~act
patch_file
frontend/src/app.tsx
~~~~~
~~~~~tsx.old
import {
  Brain,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
} from 'lucide-preact';
~~~~~
~~~~~tsx.new
import {
  Brain,
  LayoutDashboard,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
} from 'lucide-preact';
~~~~~

~~~~~act
patch_file
frontend/src/app.tsx
~~~~~
~~~~~tsx.old
        {/* 快捷导出与增量同步操作组 */}
        <div className="flex items-center gap-2 flex-wrap">
          <a
            href={`/api/export/csv?range=${currentRange}`}
            download
            className="px-2.5 py-1 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded transition flex items-center gap-1"
            title="导出概览 CSV"
          >
            <FileSpreadsheet size={13} />
            <span>CSV</span>
          </a>
          <a
            href={`/api/export/jsonl?range=${currentRange}`}
            download
            className="px-2.5 py-1 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded transition flex items-center gap-1"
            title="导出提问聚类 JSONL"
          >
            <FileText size={13} />
            <span>JSONL</span>
          </a>
          <button
            type="button"
            onClick={() => triggerSync(50)}
            disabled={syncInProgressSignal.value}
            className="px-3 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded transition shadow-sm flex items-center gap-1.5"
          >
            <RefreshCw size={13} className={syncInProgressSignal.value ? 'animate-spin' : ''} />
            <span>
              {syncInProgressSignal.value
                ? syncProgressTextSignal.value
                  ? `同步中 ${syncProgressTextSignal.value}`
                  : '同步中...'
                : '增量同步 (50)'}
            </span>
          </button>
        </div>
~~~~~
~~~~~tsx.new
        {/* 增量同步操作组 */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => triggerSync(50)}
            disabled={syncInProgressSignal.value}
            className="px-3 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded transition shadow-sm flex items-center gap-1.5"
          >
            <RefreshCw size={13} className={syncInProgressSignal.value ? 'animate-spin' : ''} />
            <span>
              {syncInProgressSignal.value
                ? syncProgressTextSignal.value
                  ? `同步中 ${syncProgressTextSignal.value}`
                  : '同步中...'
                : '增量同步 (50)'}
            </span>
          </button>
        </div>
~~~~~

#### Acts 2: 移除后端 API 导出路由与废弃的全量加载辅助函数

编辑 `src/server/api.py`，移除 `FileResponse`、`tempfile` 及 `src.analyzer.exporter` 导入，同时移除 `_ensure_sessions_loaded`、`filter_sessions_by_range` 和两个导出接口。

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~python.old
import asyncio
import json
import os
import tempfile
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Set
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import FileResponse, Response, StreamingResponse
from src.analyzer.cache import SQLiteCache
from src.analyzer.drive import DriveClient, PROXY_URL
from src.analyzer.exporter import (
    export_first_prompts_to_jsonl,
    export_prompts_summary_csv,
)
from src.analyzer.loader import load_cached_sessions
from src.analyzer.metrics import calculate_session_metrics
from src.analyzer.models import PromptSession
from src.analyzer.parser import parse_prompt_json
from src.analyzer.sync import fetch_remote_files
~~~~~
~~~~~python.new
import asyncio
import json
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Set
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from src.analyzer.cache import SQLiteCache
from src.analyzer.drive import DriveClient, PROXY_URL
from src.analyzer.metrics import calculate_session_metrics
from src.analyzer.parser import parse_prompt_json
from src.analyzer.sync import fetch_remote_files
~~~~~

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~python.old
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
~~~~~
~~~~~python.new
def _run_sync_task(limit: Optional[int], all_files: bool):
~~~~~

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~python.old
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


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
~~~~~python.new
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
~~~~~

#### Acts 3: 删除已废弃的导出器文件

删除 `src/analyzer/exporter.py`。

~~~~~act
delete_file
src/analyzer/exporter.py
~~~~~

### 下一步建议
1. **类型检查与前端校验**: 在 `frontend` 目录下运行 `npm run check`，验证 Preact 组件的编译与 Linter 是否正常。
2. **新导出架构设计**: 后续如需重新设计导出功能，建议直接依托 SQLite 的 `session_index` 进行流式游标查询（StreamingResponse），避免将全量原始会话加载到内存中；或者在前端提供基于当前过滤列表直接导出 JSON/CSV 的客户端流式导出功能。
