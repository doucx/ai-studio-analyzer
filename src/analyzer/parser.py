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


def parse_prompt_json(file_meta: Dict[str, Any], raw_data: Dict[str, Any]) -> Optional[PromptSession]:
    """
    将 Google AI Studio 原始 JSON 转化为结构化的 PromptSession 对象。
    兼容 chunkedPrompt 结构以及标准 contents 结构。
    """
    if not raw_data:
        return None

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
    if "createdTime" in file_meta:
        try:
            created_time = datetime.fromisoformat(file_meta["createdTime"].replace("Z", "+00:00"))
        except Exception:
            pass
    if "modifiedTime" in file_meta:
        try:
            modified_time = datetime.fromisoformat(file_meta["modifiedTime"].replace("Z", "+00:00"))
        except Exception:
            pass

    return PromptSession(
        file_id=file_meta.get("id", ""),
        name=file_meta.get("name", "Untitled"),
        model=model,
        created_time=created_time,
        modified_time=modified_time,
        turns=turns
    )