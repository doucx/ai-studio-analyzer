好的，我将在会话详情面板的“在 AI Studio 打开”按钮旁添加一个“下载原始 JSON”按钮，并在后端新增对应的原始数据下载 API。

## [WIP] feat(frontend): 会话详情面板新增下载原始会话 JSON 按钮

### 用户需求
在会话详情抽屉/面板顶部操作栏的“在 AI Studio 打开”按钮旁边，添加一个“下载原始会话 JSON”按钮，以便能够直接导出 Google AI Studio 原始缓存结构进行离线分析与调试。

### 评论
这是一个非常实用且低风险的开发者调试功能。通过直接将本地 SQLite 缓存中存储的原始会话数据提供下载，能够极大地方便针对特定会话的 Schema 结构探测和问题排查，避免直接操作数据库。

### 目标
1. 在后端 `src/server/api.py` 中增加 `GET /api/sessions/{file_id}/raw` 端点，支持带文件名下载附件。
2. 在前端 `SessionDetailPanel.tsx` 的操作栏中加入对应的下载按钮与图标。

### 基本原理
1. 后端直接利用 `cache.get(file_id)` 读取原始结构体，并以 `JSONResponse` 配合 `Content-Disposition: attachment` 头返回，确保浏览器能够直接触发下载。
2. 前端复用现有的操作栏按钮样式规范（暗色调，含状态与图标），提供平滑一致的视觉体验。

### 标签
#intent/build #flow/ready #priority/medium #scope/ux #scope/dx #ai/instruct #task/domain/ui #task/object/session-detail-raw-download #task/action/feature-add #task/state/begin

---

### Script

#### Acts 1: 后端新增原始 JSON 下载路由

在 `src/server/api.py` 中导入 `JSONResponse` 并添加 `/sessions/{file_id}/raw` 端点。

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~old
from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import FileResponse, StreamingResponse
from src.analyzer.cache import SQLiteCache
~~~~~
~~~~~new
from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from src.analyzer.cache import SQLiteCache
~~~~~

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~old
    return {
        "file_id": target.file_id,
        "name": target.name,
        "model": target.model,
        "created_time": target.created_time.isoformat()
        if target.created_time
        else None,
        "modified_time": target.modified_time.isoformat()
        if target.modified_time
        else None,
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


@router.post("/sync")
~~~~~
~~~~~new
    return {
        "file_id": target.file_id,
        "name": target.name,
        "model": target.model,
        "created_time": target.created_time.isoformat()
        if target.created_time
        else None,
        "modified_time": target.modified_time.isoformat()
        if target.modified_time
        else None,
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


@router.get("/sessions/{file_id}/raw")
def get_session_raw(file_id: str):
    """
    导出原始 Google AI Studio 缓存 JSON 格式数据便于调试
    """
    raw_data = cache.get(file_id)
    if not raw_data:
        return {"error": "未找到指定的会话记录"}
    return JSONResponse(
        content=raw_data,
        headers={"Content-Disposition": f'attachment; filename="{file_id}.json"'},
    )


@router.post("/sync")
~~~~~

#### Acts 2: 前端详情面板加入下载按钮

在 `SessionDetailPanel.tsx` 的头部操作条中加入“下载原始 JSON”按钮。

~~~~~act
patch_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~old
          <a
            href={aiStudioUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded transition shadow-sm flex items-center gap-1.5"
            title="在 Google AI Studio 原生工作台打开"
          >
            <span>🚀</span>
            <span className="hidden sm:inline">在 AI Studio 打开</span>
          </a>
          <button
            type="button"
            onClick={onClose}
            className="px-2.5 py-1 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded transition border border-zinc-700/80"
          >
            ✕ 关闭
          </button>
~~~~~
~~~~~new
          <a
            href={aiStudioUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded transition shadow-sm flex items-center gap-1.5"
            title="在 Google AI Studio 原生工作台打开"
          >
            <span>🚀</span>
            <span className="hidden sm:inline">在 AI Studio 打开</span>
          </a>
          <a
            href={`/api/sessions/${session.file_id}/raw`}
            download={`session_${session.file_id}.json`}
            className="px-2.5 py-1 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded border border-zinc-700/80 transition flex items-center gap-1.5"
            title="下载原始会话 JSON"
          >
            <span>💾</span>
            <span className="hidden sm:inline">下载原始 JSON</span>
          </a>
          <button
            type="button"
            onClick={onClose}
            className="px-2.5 py-1 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded transition border border-zinc-700/80"
          >
            ✕ 关闭
          </button>
~~~~~

### 下一步建议
1. 启动或刷新前端页面，点击任意会话进入详情，测试“下载原始 JSON”按钮是否能正常触发浏览器下载 `.json` 文件。
2. 如果格式符合预期，可以在后续确认无误后提交该 Git 变更。
