from typing import Optional, Dict, Any
from datetime import datetime
from .models import PromptSession, ConversationTurn


def is_valid_prompt_file(name: str) -> bool:
    """过滤粘贴板缓存与非文本文件"""
    if name.startswith("Paste "):
        return False
    lower = name.lower()
    if lower.endswith(('.png', '.jpg', '.jpeg', '.webp', '.gif')):
        return False
    return True


def parse_prompt_json(file_meta: Optional[Dict[str, Any]], raw_data: Dict[str, Any]) -> Optional[PromptSession]:
    """
    将 Google AI Studio 原始 JSON 转化为结构化的 PromptSession 对象。
    兼容 chunkedPrompt 结构以及标准 contents 结构。
    支持 file_meta 为空或仅部分元数据的场景（如完全离线从 SQLite 恢复）。
    """
    if not raw_data:
        return None

    file_meta = file_meta or {}
    model = raw_data.get("runSettings", {}).get("model", "unknown")
    turns = []

    # 1. 兼容旧版/常用 chunkedPrompt 结构
    if "chunkedPrompt" in raw_data:
        chunks = raw_data.get("chunkedPrompt", {}).get("chunks", [])
        for c in chunks:
            role = c.get("role", "user")
            text = c.get("text", "")
            if text:
                turns.append(ConversationTurn(role=role, text=text))

    # 2. 兼容新版 Gemini contents 结构
    elif "contents" in raw_data:
        contents = raw_data.get("contents", [])
        for item in contents:
            role = item.get("role", "user")
            parts = item.get("parts", [])
            text_blocks = [p.get("text", "") for p in parts if "text" in p]
            combined_text = "\n".join(text_blocks)
            if combined_text:
                turns.append(ConversationTurn(role=role, text=combined_text))

    if not turns:
        return None

    # 解析时间戳
    created_time = None
    modified_time = None
    
    raw_created = file_meta.get("createdTime") or raw_data.get("createTime") or raw_data.get("createdTime")
    if raw_created:
        try:
            created_time = datetime.fromisoformat(str(raw_created).replace("Z", "+00:00"))
        except Exception:
            pass

    raw_modified = file_meta.get("modifiedTime") or raw_data.get("modifiedTime")
    if raw_modified:
        try:
            modified_time = datetime.fromisoformat(str(raw_modified).replace("Z", "+00:00"))
        except Exception:
            pass

    # 解析会话名称
    name = file_meta.get("name") or raw_data.get("name") or raw_data.get("title") or "Untitled"

    return PromptSession(
        file_id=file_meta.get("id", ""),
        name=name,
        model=model,
        created_time=created_time,
        modified_time=modified_time,
        turns=turns
    )