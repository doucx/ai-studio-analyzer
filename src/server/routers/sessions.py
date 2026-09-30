"""
会话工作台列表、详情、FTS 全文检索与原始数据导出路由
"""

import html
import json
import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from src.analyzer.parser import parse_prompt_json
from src.server.routers.common import cache, resolve_time_bounds

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Sessions"])


class SearchRequest(BaseModel):
    q: str
    range: str = "all"
    start: str | None = None
    end: str | None = None
    model: str | None = None
    depth: str | None = None
    scope: str = "range"
    limit: int = 50
    offset: int = 0


def safe_highlight_line(line: str, terms: list[str]) -> str:
    """安全转义 HTML 特殊字符，仅允许高亮 <mark> 标签存在，彻底杜绝 HTML 标签注入"""
    if not line:
        return ""
    if not terms:
        return html.escape(line)

    line_lower = line.lower()
    matches: list[tuple[int, int]] = []
    for t in terms:
        t_len = len(t)
        if t_len == 0:
            continue
        start = 0
        while True:
            pos = line_lower.find(t.lower(), start)
            if pos == -1:
                break
            matches.append((pos, pos + t_len))
            start = pos + 1

    if not matches:
        return html.escape(line)

    # 按起始位置升序排序并合并重叠匹配区间
    matches.sort(key=lambda x: (x[0], -x[1]))
    merged: list[list[int]] = []
    for start_pos, end_pos in matches:
        if not merged:
            merged.append([start_pos, end_pos])
        else:
            prev = merged[-1]
            if start_pos <= prev[1]:
                prev[1] = max(prev[1], end_pos)
            else:
                merged.append([start_pos, end_pos])

    result: list[str] = []
    last_idx = 0
    mark_start = (
        '<mark class="bg-indigo-500/40 text-indigo-200 font-semibold px-0.5 rounded">'
    )
    mark_end = "</mark>"

    for start_pos, end_pos in merged:
        if start_pos > last_idx:
            result.append(html.escape(line[last_idx:start_pos]))
        result.append(mark_start)
        result.append(html.escape(line[start_pos:end_pos]))
        result.append(mark_end)
        last_idx = end_pos

    if last_idx < len(line):
        result.append(html.escape(line[last_idx:]))

    return "".join(result)


def extract_rg_matches(
    raw_data: dict[str, Any],
    query: str,
    context_lines: int = 2,
    max_matches: int = 1,
) -> list[dict[str, Any]]:
    """从原始会话中提取包含多行或多关键词匹配项的 turn 及其类似 rg -C 上下文"""
    if not raw_data or not query:
        return []

    chunks = raw_data.get("chunkedPrompt", {}).get("chunks", [])
    if not chunks and "contents" in raw_data:
        chunks = []
        for c in raw_data.get("contents", []):
            parts = c.get("parts", [])
            text = "\n".join(p.get("text", "") for p in parts if "text" in p)
            chunks.append({"role": c.get("role", "user"), "text": text})

    query_lines = [l.strip() for l in query.strip().splitlines() if len(l.strip()) >= 2]
    terms = (
        query_lines
        if len(query_lines) > 1
        else [t.strip() for t in query.strip().split() if len(t.strip()) >= 2]
    )
    terms = sorted(set(terms), key=len, reverse=True)
    if not terms:
        return []

    matches = []
    for idx, c in enumerate(chunks):
        role = c.get("role", "user")
        is_thought = bool(c.get("isThought", False))
        text = c.get("text", "") or ""

        text_lower = text.lower()
        matched_term = next((t for t in terms if t.lower() in text_lower), None)
        if not matched_term:
            continue

        lines = text.splitlines()
        hit_indices = [
            i
            for i, line in enumerate(lines)
            if any(t.lower() in line.lower() for t in terms)
        ]
        if not hit_indices:
            continue

        hit_idx = hit_indices[0]
        start_line = max(0, hit_idx - context_lines)
        end_line = min(len(lines), hit_idx + context_lines + 1)

        line_items = []
        for l_num in range(start_line, end_line):
            is_hit = l_num in hit_indices
            display_line = safe_highlight_line(lines[l_num], terms if is_hit else [])
            line_items.append(
                {
                    "line_no": l_num + 1,
                    "is_hit": is_hit,
                    "text": display_line,
                }
            )

        sibling_preview = None
        if role == "user" and idx + 1 < len(chunks):
            next_t = chunks[idx + 1].get("text", "") or ""
            if next_t.strip():
                sibling_preview = {
                    "role": chunks[idx + 1].get("role", "model"),
                    "text": next_t.strip().replace("\n", " ")[:90],
                }
        elif role == "model" and idx > 0:
            prev_t = chunks[idx - 1].get("text", "") or ""
            if prev_t.strip():
                sibling_preview = {
                    "role": chunks[idx - 1].get("role", "user"),
                    "text": prev_t.strip().replace("\n", " ")[:90],
                }

        role_display = "thinking" if is_thought else role
        matches.append(
            {
                "turn_index": idx + 1,
                "role": role_display,
                "lines": line_items,
                "sibling": sibling_preview,
            }
        )

        if len(matches) >= max_matches:
            break

    return matches


def execute_session_search(
    q: str,
    range: str = "all",
    start: str | None = None,
    end: str | None = None,
    model: str | None = None,
    depth: str | None = None,
    scope: str = "range",
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, Any]]:
    if scope == "all":
        start_iso, end_iso, start_d, end_d = None, None, None, None
    else:
        start_iso, end_iso, start_d, end_d = resolve_time_bounds(range, start, end)

    results = cache.search_fts(
        query=q,
        limit=limit,
        offset=offset,
        range_start_iso=start_iso,
        range_end_iso=end_iso,
        start_date=start_d,
        end_date=end_d,
        model=model,
        depth=depth,
    )

    if q and results:
        for item in results:
            fid = item.get("file_id")
            raw_data = cache.get(fid) if fid else None
            if raw_data:
                item["search_matches"] = extract_rg_matches(
                    raw_data, q, context_lines=2, max_matches=1
                )
            else:
                item["search_matches"] = []

    return results


@router.get("/sessions")
def list_sessions(
    range: str = "all",
    start: str | None = None,
    end: str | None = None,
    model: str | None = None,
    depth: str | None = None,
    limit: int | None = None,
):
    """基于 session_index 极速返回会话列表，支持下推过滤"""
    start_iso, end_iso, start_d, end_d = resolve_time_bounds(range, start, end)
    indices = cache.query_indices(
        range_start_iso=start_iso,
        range_end_iso=end_iso,
        start_date=start_d,
        end_date=end_d,
        model=model,
        depth=depth,
        limit=limit,
    )
    return [
        {
            "file_id": idx["file_id"],
            "name": idx["name"],
            "model": idx["model"],
            "turn_count": idx["turn_count"],
            "chunk_count": idx["turn_count"],
            "total_tokens": idx["total_tokens"],
            "cumulative_tokens": idx.get("cumulative_tokens") or idx["total_tokens"],
            "thought_tokens": idx["thought_tokens"],
            "duration_human": idx["duration_human"],
            "duration_seconds": idx["duration_seconds"],
            "has_branching": bool(idx["has_branching"]),
            "branch_count": idx["branch_count"],
            "first_prompt": idx["first_prompt"] or "",
            "modified_time": idx["modified_time"],
            "created_time": idx["created_time"],
        }
        for idx in indices
    ]


@router.get("/sessions/search")
def search_sessions_get(
    q: str,
    range: str = "all",
    start: str | None = None,
    end: str | None = None,
    model: str | None = None,
    depth: str | None = None,
    scope: str = "range",
    limit: int = 50,
    offset: int = 0,
):
    """基于 SQLite FTS5 全文索引的高性能深度检索接口 (GET 方式)"""
    return execute_session_search(
        q=q,
        range=range,
        start=start,
        end=end,
        model=model,
        depth=depth,
        scope=scope,
        limit=limit,
        offset=offset,
    )


@router.post("/sessions/search")
def search_sessions_post(req: SearchRequest):
    """基于 SQLite FTS5 全文索引的高性能深度检索接口 (POST 方式)"""
    return execute_session_search(
        q=req.q,
        range=req.range,
        start=req.start,
        end=req.end,
        model=req.model,
        depth=req.depth,
        scope=req.scope,
        limit=req.limit,
        offset=req.offset,
    )


@router.get("/sessions/{file_id}")
def get_session_detail(file_id: str):
    """按需从 file_cache 读取并解析单个会话的详细轮次"""
    raw_data = cache.get(file_id)
    if not raw_data:
        raise HTTPException(status_code=404, detail="未找到指定的会话记录")

    file_meta = {"id": file_id, "name": raw_data.get("name", "Untitled")}
    target = parse_prompt_json(file_meta, raw_data)
    if not target:
        raise HTTPException(status_code=500, detail="解析会话数据失败")

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
        "chunk_count": target.chunk_count,
        "total_tokens": target.total_tokens,
        "cumulative_tokens": target.cumulative_api_tokens,
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
                "extra_metadata": t.extra_metadata,
            }
            for t in target.turns
        ],
    }


@router.get("/sessions/{file_id}/raw")
def get_session_raw(file_id: str):
    """导出原始 Google AI Studio 缓存 JSON 格式数据"""
    raw_data = cache.get(file_id)
    if not raw_data:
        return {"error": "未找到指定的会话记录"}
    formatted_json = json.dumps(raw_data, indent=2, ensure_ascii=False)
    return Response(
        content=formatted_json,
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{file_id}.json"'},
    )
