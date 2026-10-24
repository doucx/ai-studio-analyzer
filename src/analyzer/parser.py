import base64
import binascii
import logging
from datetime import UTC, datetime
from typing import Any

from .models import ConversationTurn, PromptSession

logger = logging.getLogger(__name__)


def parse_plain_session(
    raw_data: dict[str, Any],
    file_id: str | None = None,
    web_base_url: str | None = None,
) -> PromptSession | None:
    """
    将 Plain 调试会话 JSON 规范化转换为标准的 PromptSession 对象。
    兼容 Plain 的消息流、思考链、代码库包与用量统计。
    """
    if not isinstance(raw_data, dict):
        return None

    raw_id = raw_data.get("id") or file_id or "unknown"
    normalized_id = raw_id if raw_id.startswith("plain:") else f"plain:{raw_id}"

    title = raw_data.get("title") or "新调试会话"
    meta = raw_data.get("meta", {})
    model = meta.get("model") or "unknown"
    system_prompt = meta.get("system_prompt") or ""
    sys_tokens = (
        meta.get("token_estimate", {}).get("tokens")
        if isinstance(meta.get("token_estimate"), dict)
        else 0
    )
    if not sys_tokens and system_prompt:
        sys_tokens = max(1, int(len(system_prompt) / 3.0))

    created_at_ms = raw_data.get("created_at")
    updated_at_ms = raw_data.get("updated_at")

    created_time = (
        datetime.fromtimestamp(created_at_ms / 1000.0, tz=UTC)
        if created_at_ms
        else None
    )
    modified_time = (
        datetime.fromtimestamp(updated_at_ms / 1000.0, tz=UTC)
        if updated_at_ms
        else created_time
    )

    turns: list[ConversationTurn] = []
    messages = raw_data.get("messages", [])

    for msg in messages:
        if not isinstance(msg, dict):
            continue

        role_str = msg.get("role", "user")
        msg_role = "user" if role_str == "user" else "model"
        msg_type = msg.get("type", "text")
        content = msg.get("content", "") or ""
        reasoning_content = msg.get("reasoning_content", "") or ""

        ts_ms = msg.get("timestamp")
        msg_time = (
            datetime.fromtimestamp(ts_ms / 1000.0, tz=UTC) if ts_ms else modified_time
        )

        usage = msg.get("usage") or {}
        comp_tokens = int(usage.get("completion_tokens") or 0)
        prompt_tokens = int(usage.get("prompt_tokens") or 0)

        # 1. 若为 Assistant 且包含思考链，优先提取独立的思维链 Turn
        if msg_role == "model" and reasoning_content:
            turns.append(
                ConversationTurn(
                    role="model",
                    text=reasoning_content,
                    token_count=max(1, int(len(reasoning_content) / 3.0)),
                    is_thought=True,
                    payload_type="text",
                    timestamp=msg_time,
                )
            )

        # 2. 映射正文 Turn：识别大附件包或常规纯文本
        if msg_type == "package":
            pkg_name = msg.get("name") or "代码库包"
            pkg_bytes = int(msg.get("char_count") or len(content))
            turns.append(
                ConversationTurn(
                    role="user",
                    text=content,
                    token_count=prompt_tokens or max(1, int(len(content) / 3.0)),
                    is_thought=False,
                    payload_type="inlineFile",
                    timestamp=msg_time,
                    extra_metadata={
                        "display_name": pkg_name,
                        "byte_size": pkg_bytes,
                        "mime_type": "text/plain",
                    },
                )
            )
        else:
            token_count = (
                comp_tokens
                if msg_role == "model"
                else (prompt_tokens or max(1, int(len(content) / 3.0)))
            )
            turns.append(
                ConversationTurn(
                    role=msg_role,
                    text=content,
                    token_count=token_count,
                    is_thought=False,
                    payload_type="text",
                    timestamp=msg_time,
                )
            )

    clean_base_url = web_base_url.rstrip("/") if web_base_url else ""
    raw_session_id = normalized_id.replace("plain:", "")
    origin_web_url = (
        f"{clean_base_url}/#/session/{raw_session_id}" if clean_base_url else None
    )

    return PromptSession(
        file_id=normalized_id,
        name=title,
        model=model,
        created_time=created_time,
        modified_time=modified_time,
        turns=turns,
        system_instruction=system_prompt,
        system_instruction_tokens=sys_tokens or 0,
        source="plain",
        web_url=origin_web_url,
    )


def is_valid_prompt_file(name: str) -> bool:
    """过滤粘贴板缓存与纯图片临时文件"""
    if name.startswith("Paste "):
        return False
    lower = name.lower()
    return not lower.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif"))


def is_text_mime(mime: str) -> bool:
    """判断 MIME 类型是否属于可直接阅读或展示的文本/代码类文件"""
    m = mime.lower()
    return (
        m.startswith("text/")
        or "json" in m
        or "xml" in m
        or "javascript" in m
        or "typescript" in m
        or "yaml" in m
        or "csv" in m
        or "sql" in m
        or "markdown" in m
        or "x-sh" in m
        or "x-python" in m
    )


def parse_prompt_json(
    file_meta: dict[str, Any] | None, raw_data: dict[str, Any]
) -> PromptSession | None:
    """
    将 Google AI Studio 原始 JSON 转化为结构化的 PromptSession 对象。
    兼容 chunkedPrompt 结构以及新版 Gemini contents 结构，
    完整提取 Token 统计、思考链 (Thinking)、分支树 (Branching) 与系统指令。
    """
    if not raw_data or not isinstance(raw_data, dict):
        return None

    # 自动探测分发：若匹配 Plain 会话特征 (包含 messages 列表与 meta 字典)
    if (
        "messages" in raw_data
        and "meta" in raw_data
        and "chunkedPrompt" not in raw_data
    ):
        fid = file_meta.get("id") if file_meta else None
        return parse_plain_session(raw_data, file_id=fid)

    file_meta = file_meta or {}
    model = raw_data.get("runSettings", {}).get("model", "unknown")
    sys_inst_obj = raw_data.get("systemInstruction", {})
    sys_instruction = ""
    sys_inst_tokens = 0

    if isinstance(sys_inst_obj, dict):
        sys_instruction = sys_inst_obj.get("text", "")
        if "tokenCount" in sys_inst_obj:
            sys_inst_tokens = int(sys_inst_obj.get("tokenCount") or 0)
        elif not sys_instruction and "parts" in sys_inst_obj:
            parts = sys_inst_obj.get("parts", [])
            sys_instruction = "\n".join(p.get("text", "") for p in parts if "text" in p)
    elif isinstance(sys_inst_obj, str):
        sys_instruction = sys_inst_obj

    # 若无显式标注的 tokenCount，按多语言通用分词基线保守估算 (约 1 token / 3.0 字符)
    if sys_instruction and sys_inst_tokens <= 0:
        sys_inst_tokens = max(1, int(len(sys_instruction) / 3.0))

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
                    chunk_time = datetime.fromisoformat(c["createTime"])
                except (ValueError, TypeError) as err:
                    logger.debug("解析 chunk 时间戳失败: %s", err)

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
                mime = file_info.get("mimeType", "application/octet-stream")
                display_name = (
                    file_info.get("displayName") or file_info.get("name") or ""
                )
                payload_type = "inlineFile"
                raw_b64 = file_info.get("data", "")
                raw_bytes = b""
                try:
                    if raw_b64:
                        raw_bytes = base64.b64decode(raw_b64)
                except (ValueError, binascii.Error) as err:
                    logger.debug("解码附件 base64 失败: %s", err)

                byte_size = len(raw_bytes)
                extra_meta = {
                    "mime_type": mime,
                    "byte_size": byte_size,
                    "display_name": display_name,
                }

                if is_text_mime(mime):
                    try:
                        text = raw_bytes.decode("utf-8", errors="replace")
                    except UnicodeDecodeError:
                        text = "[无法按 UTF-8 解码的文本附件]"
                else:
                    text = f"[{mime} 媒体/二进制附件 ({byte_size} bytes)]"
            # 优先分支 3: 内联 Base64 编码图片
            elif "inlineImage" in c:
                img_info = c["inlineImage"]
                mime = img_info.get("mimeType", "image/png")
                raw_b64 = img_info.get("data", "")
                byte_size = int(len(raw_b64) * 3 / 4) if raw_b64 else 0
                payload_type = "inlineImage"
                extra_meta = {
                    "mime_type": mime,
                    "byte_size": byte_size,
                    "data": raw_b64,
                }
                text = f"[{mime} 图片附件 ({round(byte_size / 1024, 1)} KB)]"
            # 分支 4: 常规纯文本交互
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
            created_time = datetime.fromisoformat(str(raw_created))
        except (ValueError, TypeError) as err:
            logger.debug("解析 createdTime 失败: %s", err)

    raw_modified = file_meta.get("modifiedTime") or raw_data.get("modifiedTime")
    if raw_modified:
        try:
            modified_time = datetime.fromisoformat(str(raw_modified))
        except (ValueError, TypeError) as err:
            logger.debug("解析 modifiedTime 失败: %s", err)

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
        system_instruction_tokens=sys_inst_tokens,
    )
