好的，我将把原始 JSON 导出接口调整为返回带有缩进（`indent=2`）且保留原生 UTF-8 编码的格式化内容，方便直接阅读与调试。

## [WIP] feat(server): 格式化导出的原始会话 JSON 内容

### 用户需求
下载的原始会话 JSON 文件需要进行排版格式化（Pretty-print），具有清晰的换行与缩进，便于人工直接阅读和调试分析。

### 评论
默认的 `JSONResponse` 会将数据序列化为无缩进的紧凑单行文本，对于体积较大、嵌套深度的 Google AI Studio 结构体非常不利于人工肉眼比对和阅读。采用 2 空格缩进并禁用 ASCII 转义（`ensure_ascii=False`）能够显著提升调试体验。

### 目标
1. 在 `src/server/api.py` 的 `/sessions/{file_id}/raw` 接口中，使用 `json.dumps(..., indent=2, ensure_ascii=False)` 进行美化排版。
2. 以带 UTF-8 字符集的 `Response(media_type="application/json; charset=utf-8")` 直接下发格式化后的内容。

### 基本原理
通过 `Response` 直接传输预格式化好的 UTF-8 字符串，绕过默认 `JSONResponse` 的紧凑序列化行为，同时保证中文等非 ASCII 文本不被转义为 `\uXXXX` 乱码，提供最佳的可读性。

### 标签
#intent/tune #flow/ready #priority/medium #scope/dx #ai/instruct #task/domain/server #task/object/raw-json-formatting #task/action/pretty-print #task/state/continue

---

### Script

#### Acts 1: 格式化导出接口响应内容

在 `src/server/api.py` 中引入 `Response` 并对 `get_session_raw` 添加缩进与编码格式化。

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~old
from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from src.analyzer.cache import SQLiteCache
~~~~~
~~~~~new
from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from src.analyzer.cache import SQLiteCache
~~~~~

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~old
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
~~~~~
~~~~~new
@router.get("/sessions/{file_id}/raw")
def get_session_raw(file_id: str):
    """
    导出原始 Google AI Studio 缓存 JSON 格式数据便于调试 (带缩进格式化)
    """
    raw_data = cache.get(file_id)
    if not raw_data:
        return {"error": "未找到指定的会话记录"}
    formatted_json = json.dumps(raw_data, indent=2, ensure_ascii=False)
    return Response(
        content=formatted_json,
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{file_id}.json"'},
    )
~~~~~

### 下一步建议
1. 在前端点击会话详情中的“下载原始 JSON”按钮，检查下载下来的 `.json` 文件是否已经具备整齐的换行、2 空格缩进以及正确的中文显示。
2. 确认效果后，可选择将这一批改动创建 Git 提交。
