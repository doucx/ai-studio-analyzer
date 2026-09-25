import base64
from datetime import datetime
from typing import Optional, Dict, Any
from .models import PromptSession, ConversationTurn


def is_valid_prompt_file(name: str) -> bool:
    """过滤粘贴板缓存与纯图片临时文件"""
    if name.startswith("Paste "):
        return False
    lower = name.lower()
    if lower.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif")):
        return False
    return True


def parse_prompt_json(
    file_meta: Optional[Dict[str, Any]], raw_data: Dict[str, Any]
) -> Optional[PromptSession]:
    """
    将 Google AI Studio 原始 JSON 转化为结构化的 PromptSession 对象。
    兼容 chunkedPrompt 结构以及新版 Gemini contents 结构，
    完整提取 Token 统计、思考链 (Thinking)、分支树 (Branching) 与系统指令。
    """
    if not raw_data or not isinstance(raw_data, dict):
        return None

    file_meta = file_meta or {}
    model = raw_data.get("runSettings", {}).get("model", "unknown")
    sys_instruction = raw_data.get("systemInstruction", {}).get("text", "")
    turns = []

    # 1. 核心 chunkedPrompt 结构
    if "chunkedPrompt" in raw_data:
        chunks = raw_data.get("chunkedPrompt", {}).get("chunks", [])
        for c in chunks:
            role = c.get("role", "user")
            token_count = c.get("tokenCount", 0)
            is_thought = bool(c.get("isThought", False))
            branch_parent = c.get("branchParent")
            branch_children = c.get("branchChildren", [])
            is_edited = bool(c.get("isEdited", False))

            # 解析 chunk 产生的时间戳
            chunk_time = None
            if "createTime" in c:
                try:
                    chunk_time = datetime.fromisoformat(
                        c["createTime"].replace("Z", "+00:00")
                    )
                except Exception:
                    pass

            text = ""
            payload_type = "text"
            extra_meta = {}

            # 优先分支 1: 外部云盘大文档引用 (Insert from Drive)
            if "driveDocument" in c:
                doc_id = c["driveDocument"].get("id", "unknown")
                payload_type = "driveDocument"
                text = f"📄 挂载云盘大文档 (ID: {doc_id})"
                extra_meta["doc_id"] = doc_id
            # 优先分支 2: 内联 Base64 编码文件
            elif "inlineFile" in c:
                file_info = c["inlineFile"]
                mime = file_info.get("mimeType", "")
                payload_type = "inlineFile"
                if "text" in mime or "json" in mime or "xml" in mime:
                    try:
                        raw_bytes = base64.b64decode(file_info.get("data", ""))
                        text = (
                            raw_bytes.decode("utf-8", errors="ignore")[:300]
                            + "... [内联文本附件]"
                        )
                    except Exception:
                        text = "[无法解码的文本附件]"
                else:
                    text = f"[{mime} 媒体附件]"
            # 分支 3: 常规纯文本交互
            elif "text" in c:
                text = c.get("text", "")
                payload_type = "text"

            if text or is_thought or token_count > 0:
                turns.append(
                    ConversationTurn(
                        role=role,
                        text=text,
                        token_count=token_count,
                        is_thought=is_thought,
                        payload_type=payload_type,
                        timestamp=chunk_time,
                        branch_parent=branch_parent,
                        branch_children=branch_children,
                        is_edited=is_edited,
                        extra_metadata=extra_meta,
                    )
                )

    # 2. 兼容标准 Gemini contents 结构
    elif "contents" in raw_data:
        contents = raw_data.get("contents", [])
        for item in contents:
            role = item.get("role", "user")
            parts = item.get("parts", [])
            text_blocks = [p.get("text", "") for p in parts if "text" in p]
            combined_text = "\n".join(text_blocks)
            if combined_text:
                turns.append(
                    ConversationTurn(
                        role=role,
                        text=combined_text,
                        token_count=0,
                        payload_type="text",
                    )
                )

    if not turns:
        return None

    # 解析会话层时间戳
    created_time = None
    modified_time = None

    raw_created = (
        file_meta.get("createdTime")
        or raw_data.get("createTime")
        or raw_data.get("createdTime")
    )
    if raw_created:
        try:
            created_time = datetime.fromisoformat(
                str(raw_created).replace("Z", "+00:00")
            )
        except Exception:
            pass

    raw_modified = file_meta.get("modifiedTime") or raw_data.get("modifiedTime")
    if raw_modified:
        try:
            modified_time = datetime.fromisoformat(
                str(raw_modified).replace("Z", "+00:00")
            )
        except Exception:
            pass

    # 解析名称
    name = (
        file_meta.get("name")
        or raw_data.get("name")
        or raw_data.get("title")
        or "Untitled"
    )

    return PromptSession(
        file_id=file_meta.get("id", ""),
        name=name,
        model=model,
        created_time=created_time,
        modified_time=modified_time,
        turns=turns,
        system_instruction=sys_instruction,
    )
