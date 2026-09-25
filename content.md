好的，我现在为你生成修复方案，重构后端解析优先级并为前端添加专属的云盘大文档卡片渲染。

## [WIP] fix: 修复云盘大文档解析优先级及 Markdown 语法吞噬缺陷

### 错误分析

1. **Markdown 规范吞噬语法**：前端 `SessionDetailPanel.tsx` 引入了 `marked.parse` 解析对话内容，后端传入的文本为形如 `[挂载云盘大文档 ID: 1FD90...]`。在 CommonMark / GFM 规范中，`[label]: url` 属于「链接引用定义 (Link Reference Definition)」，它被引擎作为内部隐形索引处理，不生成任何 DOM 元素，导致渲染结果为空字符串。
2. **后端 `if...elif` 条件短路**：在 `src/analyzer/parser.py` 中，`if "text" in c:` 位于 `elif "driveDocument" in c:` 之前。当 Google AI Studio 返回包含 `"text": ""` 默认键的大文档 Chunk 时，空文本优先命中了分支 A，导致云盘大文档分支被直接跳过。

### 用户需求
恢复「挂载云盘大文档」在对话流中的正常可见性，并提供清晰直观的交互卡片（展示文档 ID、快速复制及 Drive 打开入口）。

### 评论
将结构化的附件载荷（云盘大文档）与非结构化的自然语言正文混入同一个 Markdown 解析器本身存在设计风险。通过对 `payload_type === 'driveDocument'` 进行 UI 分流与结构化呈现，既能从根本上规避 Markdown 转义风险，又能显著提升用户界面的专业度。

### 目标
1. **调整解析器条件顺序 (`src/analyzer/parser.py`)**：优先判定 `driveDocument` 与 `inlineFile`，并在 `extra_metadata` 中抽取保存独立的 `doc_id`。
2. **前端附件卡片化 (`frontend/src/components/SessionDetailPanel.tsx`)**：针对 `payload_type === 'driveDocument'` 独立渲染专属卡片，包含文档 ID、复制与跳转链接，不再受 Markdown 语法干扰。

### 基本原理
- **优先解构特定类型**：在解析器中按照从特殊到通用的顺序处理 Chunk，杜绝空字符串抢占。
- **UI 语义化分流**：识别 `driveDocument`，以带有 📄 标识的高亮卡片替换单纯的纯文本排版，保留原始直链与交互能力。

### 标签
#intent/fix #flow/ready #priority/high #comp/runtime #comp/cli #concept/parser #concept/ui #scope/core #scope/ux #ai/instruct #task/domain/parser #task/object/drive-document-rendering #task/action/bug-fix #task/state/begin

---

### Script

#### Acts 1: 调整后端 `parser.py` 载荷解析优先级并提取文档 ID

调整 `src/analyzer/parser.py`，优先匹配 `driveDocument` 与 `inlineFile`，并将提取出的 ID 存入元数据。

~~~~~act
patch_file
src/analyzer/parser.py
~~~~~
~~~~~python
            text = ""
            payload_type = "text"

            # 分支 A: 纯文本交互
            if "text" in c:
                text = c.get("text", "")
                payload_type = "text"
            # 分支 B: 内联 Base64 编码文件
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
            # 分支 C: 外部云盘大文档引用 (Insert from Drive)
            elif "driveDocument" in c:
                doc_id = c["driveDocument"].get("id", "unknown")
                payload_type = "driveDocument"
                text = f"[挂载云盘大文档 ID: {doc_id}]"

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
                    )
                )
~~~~~
~~~~~python
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
~~~~~

#### Acts 2: 前端详情面板为云盘大文档提供专属卡片 UI

在 `frontend/src/components/SessionDetailPanel.tsx` 中检测 `payload_type === 'driveDocument'`，渲染独立的文档卡片。

~~~~~act
patch_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~python
function TurnMessage({ turn, index }: { turn: ConversationTurnItem; index: number }) {
  const [isThinkingOpen, setIsThinkingOpen] = useState(false);

  const htmlContent = useMemo(() => {
    try {
      return marked.parse(turn.text || '');
    } catch {
      return turn.text;
    }
  }, [turn.text]);

  const isUser = turn.role === 'user';
  const isThought = turn.is_thought;
~~~~~
~~~~~python
function TurnMessage({ turn, index }: { turn: ConversationTurnItem; index: number }) {
  const [isThinkingOpen, setIsThinkingOpen] = useState(false);

  // 提取可能的 Drive 文件 ID (支持格式: "ID: xxx" 或 "[挂载云盘大文档 ID: xxx]")
  const driveDocId = useMemo(() => {
    if (turn.payload_type !== 'driveDocument') return null;
    const match = turn.text.match(/ID:\s*([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }, [turn.payload_type, turn.text]);

  const htmlContent = useMemo(() => {
    try {
      return marked.parse(turn.text || '');
    } catch {
      return turn.text;
    }
  }, [turn.text]);

  const isUser = turn.role === 'user';
  const isThought = turn.is_thought;
~~~~~

~~~~~act
patch_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~python
      {/* 消息正文：由外部 Markdown 渲染器全屏呈现 */}
      <div className="p-4 sm:p-5">
        <div
          className="prose-chat max-w-none"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: 用于渲染本地 SQLite 缓存中对话记录的 Markdown 解析输出
          dangerouslySetInnerHTML={{ __html: htmlContent as string }}
        />
      </div>
    </div>
  );
}
~~~~~
~~~~~python
      {/* 消息正文：云盘大文档专属卡片 或 Markdown 正文呈现 */}
      <div className="p-4 sm:p-5">
        {turn.payload_type === 'driveDocument' ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-indigo-950/30 border border-indigo-800/40 rounded-lg">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-xl">📄</span>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-indigo-300">挂载云盘大文档</div>
                <div className="text-[11px] text-zinc-400 font-mono truncate">
                  ID: <span className="text-zinc-200 select-all">{driveDocId || turn.text}</span>
                </div>
              </div>
            </div>

            {driveDocId && (
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={`https://drive.google.com/file/d/${driveDocId}/view`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1 text-[11px] font-medium bg-indigo-600/80 hover:bg-indigo-600 text-white rounded transition flex items-center gap-1"
                >
                  <span>🔗</span>
                  <span>在云盘查看</span>
                </a>
              </div>
            )}
          </div>
        ) : (
          <div
            className="prose-chat max-w-none"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: 用于渲染本地 SQLite 缓存中对话记录的 Markdown 解析输出
            dangerouslySetInnerHTML={{ __html: htmlContent as string }}
          />
        )}
      </div>
    </div>
  );
}
~~~~~

### 下一步建议
1. 刷新浏览器并打开包含 Google Drive 大文档附件的会话，验证是否已显示蓝紫色高亮的「📄 挂载云盘大文档」卡片以及「🔗 在云盘查看」跳转按钮。
2. 若该会话此前已缓存在内存中且当时被解析为空，可点击顶栏「增量同步 (50)」或重启后端服务以重新加载最新的对象状态。
