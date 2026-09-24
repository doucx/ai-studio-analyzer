我将实施收敛方案：将系统全面收敛为纯 Web 架构，移除 `main.py` 中多余的 CLI 子命令和终端报表打印逻辑，使其退化为极简的一键启动器；同时在后端 API 与前端界面补齐 CSV 和 JSONL 数据导出能力。

## [WIP] refactor: 收敛架构为纯 Web 端并迁移导出能力

### 用户需求
移除冗余的 CLI 工具与终端文本报表逻辑，使整个项目聚焦于纯 Web 端单入口架构，降低代码维护成本，并将 CLI 中的数据导出能力完整迁移至 Web 界面。

### 评论
收敛为 Web 单入口能够彻底消除“CLI 增量拉取后 Web 端未刷新”的数据割裂风险，避免同一套统计指标在终端与浏览器中维护两套展现逻辑，显著精简核心代码库。

### 目标
1. 重构 `main.py`，移除 `argparse` 子命令解析及所有终端报表打印函数，简化为纯粹的一键本地服务启动入口。
2. 在 `src/server/api.py` 中挂载 `/api/export/csv` 与 `/api/export/jsonl` 端点，支持从浏览器直接下载分析明细报表与聚类清洗集。
3. 在 `frontend/src/app.tsx` 顶部控制条增设原生导出按钮，实现一站式查看与下载。

### 基本原理
1. **单一入口原则 (Single Entrypoint)**：将 `main.py` 收敛为轻量服务启动器，统一通过本地 Web 服务提供增量同步、指标审计、图表切片与文件导出功能。
2. **零拷贝文件流响应**：后端导出接口使用 FastAPI 原生 `FileResponse`，结合既有的 `exporter.py`，直接将生成的 CSV 和 JSONL 传输给客户端，无需客户端具备终端执行环境。

### 标签
#intent/refine #flow/ready #priority/high #comp/cli #comp/runtime #concept/ui #scope/ux #scope/dx #ai/instruct #task/domain/cli #task/object/web-convergence #task/action/refactor #task/state/begin

---

### Script

#### Acts 1: 精简 `main.py` 为纯粹的一键服务启动器

将原本 200 余行的复杂 CLI 调度与终端报表打印逻辑精简为仅保留服务启动能力的入口脚本。

~~~~~act
write_file
main.py
~~~~~
~~~~~python
"""
AI Studio Analyzer - 本地服务启动入口

使用方式:
  python main.py
"""

import uvicorn


def main():
    port = 8000
    print("=" * 60)
    print(f"🚀 AI Studio Analyzer 看板服务正在启动: http://127.0.0.1:{port}")
    print(f"📖 Swagger 接口调试文档:             http://127.0.0.1:{port}/docs")
    print("=" * 60)
    uvicorn.run("src.server.app:app", host="127.0.0.1", port=port, reload=True)


if __name__ == "__main__":
    main()
~~~~~

#### Acts 2: 在后端 API 中集成 CSV 与 JSONL 导出接口

在 `src/server/api.py` 中引入 `exporter` 模块，新增两个供浏览器直接下载报表的 GET 端点。

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~python.old
import json
import os
from typing import Optional
from fastapi import APIRouter, BackgroundTasks
from src.analyzer.cache import SQLiteCache
from src.analyzer.drive import DriveClient, PROXY_URL
from src.analyzer.loader import load_cached_sessions
from src.analyzer.metrics import calculate_session_metrics
from src.analyzer.sync import fetch_remote_files
~~~~~
~~~~~python.new
import json
import os
import tempfile
from typing import Optional
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
from src.analyzer.sync import fetch_remote_files
~~~~~

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~python.old
@router.get("/sync/status")
def get_sync_status():
    """查询后台同步进度状态"""
    return sync_status
~~~~~
~~~~~python.new
@router.get("/sync/status")
def get_sync_status():
    """查询后台同步进度状态"""
    return sync_status


@router.get("/export/csv")
def export_csv():
    """导出全量会话指标明细 CSV"""
    sessions = load_cached_sessions(cache, limit=0, show_progress=False)
    if not sessions:
        return {"error": "暂无可导出会话"}
    tmp_path = os.path.join(tempfile.gettempdir(), "prompts_summary.csv")
    export_prompts_summary_csv(sessions, tmp_path)
    return FileResponse(
        path=tmp_path,
        filename="prompts_summary.csv",
        media_type="text/csv",
    )


@router.get("/export/jsonl")
def export_jsonl():
    """导出首轮提问清洗集 JSONL (用于聚类与反思)"""
    sessions = load_cached_sessions(cache, limit=0, show_progress=False)
    if not sessions:
        return {"error": "暂无可导出会话"}
    tmp_path = os.path.join(tempfile.gettempdir(), "first_prompts_for_clustering.jsonl")
    export_first_prompts_to_jsonl(sessions, tmp_path)
    return FileResponse(
        path=tmp_path,
        filename="first_prompts_for_clustering.jsonl",
        media_type="application/jsonlines",
    )
~~~~~

#### Acts 3: 在前端控制条增设导出按钮

在 `frontend/src/app.tsx` 顶部的控制按钮区域加入“导出 CSV”与“导出 JSONL”链接，实现原生一键下载。

~~~~~act
patch_file
frontend/src/app.tsx
~~~~~
~~~~~typescript.old
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={loadDashboardData}
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
~~~~~
~~~~~typescript.new
        <div className="flex items-center gap-2.5 flex-wrap">
          <a
            href="/api/export/csv"
            download
            className="px-3 py-1.5 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded transition flex items-center gap-1.5"
          >
            <span>📥</span> 导出 CSV
          </a>
          <a
            href="/api/export/jsonl"
            download
            className="px-3 py-1.5 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded transition flex items-center gap-1.5"
          >
            <span>📑</span> 导出 JSONL
          </a>
          <button
            type="button"
            onClick={loadDashboardData}
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
~~~~~

### 下一步建议
1. **启动测试**：在终端直接执行 `python main.py`，确认服务顺利启动且无任何命令行报错。
2. **导出功能测试**：在浏览器顶部控制栏点击“导出 CSV”和“导出 JSONL”，确认能否正常下载结构化表格和首轮提问清洗集文件。
3. **环境与文档同步**：可根据需要清理 `README.md` 中旧的 CLI 命令说明（如 `python main.py analyze` 等），使文档与纯 Web 架构保持一致。
