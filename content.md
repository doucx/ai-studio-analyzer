我将为你生成一个完整的重构计划，全面升级后端数据解析、索引提取以及前端卡片呈现，彻底解决 AI Studio 内部内联大文件（`inlineFile`）带来的文本截断、首轮意图被覆盖和阅读体验差的问题。

## [WIP] refactor: 全面优化内联文件 (inlineFile) 的解码、意图提取与前端交互展示

### 用户需求
1. **完整解码与丰富元数据支持**：AI Studio 在对话中内嵌的代码、XML 或大文档（`inlineFile`）需被完整安全解码，保留 MIME 类型、字节体积和显示名称，避免被 300 字符暴力截断。
2. **首轮提问智能提取（消除噪音）**：当会话第一轮包含大型附件时，会话列表与聚类摘要应优先提取用户的真实提问文本，并将附件作为紧凑前缀标明（如 `[📎 text/plain] ...`），而非将整个 XML/代码片段作为 `first_prompt`。
3. **前端专属交互卡片**：在会话详情中，为 `inlineFile` 提供类似 `driveDocument` 的专用青色/靛蓝卡片，展示文件名、MIME 类型、Token 开销与体积，支持点击折叠/展开预览、一键复制及本地下载，避免附件破坏对话 Markdown 流。
4. **本地极速重新索引**：提供零网络开销的本地 SQLite 会话索引刷新能力，使历史数据立即享受优化的摘要展示。

### 评论
随着 Gemini 2.0 / AI Studio 对长上下文和多模态交互的深化，用户高频将工程代码库或结构化数据直接粘贴或挂载到对话作为上下文背景。现有系统将其作为普通文本处理且硬编码切除，严重损害了代码审阅和历史检索价值。此重构能极大提升开发者在离线审计此类工程级多轮会话时的体验。

### 目标
1. 在 `src/analyzer/parser.py` 中引入广义文本 MIME 探测，保留完整解码文本，将大小与 MIME 写入 `extra_metadata`。
2. 在 `src/analyzer/models.py` 中新增 `first_effective_prompt` 属性，并在 `cache.py` 和 `exporter.py` 中优先采用该属性。
3. 在 `src/server/api.py` 的轮次详情中下发 `extra_metadata`，并新增 `/api/reindex` 接口。
4. 在 `frontend/src/types/metrics.ts` 和 `frontend/src/components/SessionDetailPanel.tsx` 中新增内联附件卡片、展开预览与下载组件。

### 基本原理
通过将“数据载荷（附件）”与“用户意图（Prompt）”在数据建模阶段语义解耦：在解析阶段把内联文件作为结构化上下文实体保留；在索引阶段通过智能指针穿透附件定位真正的文字需求；在渲染阶段通过按需折叠的交互组件呈现代码与文档，兼顾性能与阅读流畅性。

### 标签
#intent/refine #flow/ready #priority/high #comp/engine #comp/interfaces #concept/parser #concept/ui #scope/core #scope/ux #ai/instruct #task/domain/analyzer #task/object/inline-file-support #task/action/refactor #task/state/begin #task/status/active

---

### Script

#### Acts 1: 升级后端内联文件解析与文本 MIME 支持

在 `src/analyzer/parser.py` 中扩充文本 MIME 检测逻辑，提取内联文件完整内容及元数据。

~~~~~act
patch_file
src/analyzer/parser.py
~~~~~
~~~~~python
def is_valid_prompt_file(name: str) -> bool:
    """过滤粘贴板缓存与纯图片临时文件"""
    if name.startswith("Paste "):
        return False
    lower = name.lower()
    if lower.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif")):
        return False
    return True
~~~~~
~~~~~python
def is_valid_prompt_file(name: str) -> bool:
    """过滤粘贴板缓存与纯图片临时文件"""
    if name.startswith("Paste "):
        return False
    lower = name.lower()
    if lower.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif")):
        return False
    return True


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
~~~~~

~~~~~act
patch_file
src/analyzer/parser.py
~~~~~
~~~~~python
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
~~~~~
~~~~~python
            # 优先分支 2: 内联 Base64 编码文件
            elif "inlineFile" in c:
                file_info = c["inlineFile"]
                mime = file_info.get("mimeType", "application/octet-stream")
                display_name = file_info.get("displayName") or file_info.get("name") or ""
                payload_type = "inlineFile"
                raw_b64 = file_info.get("data", "")
                raw_bytes = b""
                try:
                    if raw_b64:
                        raw_bytes = base64.b64decode(raw_b64)
                except Exception:
                    pass

                byte_size = len(raw_bytes)
                extra_meta = {
                    "mime_type": mime,
                    "byte_size": byte_size,
                    "display_name": display_name,
                }

                if is_text_mime(mime):
                    try:
                        text = raw_bytes.decode("utf-8", errors="replace")
                    except Exception:
                        text = "[无法按 UTF-8 解码的文本附件]"
                else:
                    text = f"[{mime} 媒体/二进制附件 ({byte_size} bytes)]"
~~~~~

#### Acts 2: 在数据模型与缓存层实现首轮提问智能提取

在 `src/analyzer/models.py` 增加 `first_effective_prompt` 穿透提取逻辑，并在 `cache.py` 与 `exporter.py` 中应用。

~~~~~act
patch_file
src/analyzer/models.py
~~~~~
~~~~~python
    @property
    def user_prompts(self) -> List[str]:
        """提取所有属于用户的有效发言文本"""
        return [turn.text for turn in self.turns if turn.role == "user"]

    @property
    def turn_count(self) -> int:
~~~~~
~~~~~python
    @property
    def user_prompts(self) -> List[str]:
        """提取所有属于用户的有效发言文本"""
        return [turn.text for turn in self.turns if turn.role == "user"]

    @property
    def first_effective_prompt(self) -> str:
        """
        推导会话的首轮核心用户提示词：
        跳过纯内联附件，定位用户真实的意图提问；若首轮附带附件，则附带紧凑标签前缀。
        """
        user_turns = [t for t in self.turns if t.role == "user"]
        if not user_turns:
            return ""

        first_turn = user_turns[0]
        if first_turn.payload_type == "inlineFile":
            mime = first_turn.extra_metadata.get("mime_type", "附件")
            # 寻找后续首条真实文本提问
            subsequent_prompt = next(
                (
                    t.text.strip()
                    for t in user_turns[1:]
                    if t.payload_type == "text" and t.text.strip()
                ),
                "",
            )
            if subsequent_prompt:
                return f"[📎 {mime}] {subsequent_prompt}"
            return f"[📎 附件: {mime}]"

        return first_turn.text.strip()

    @property
    def turn_count(self) -> int:
~~~~~

~~~~~act
patch_file
src/analyzer/cache.py
~~~~~
~~~~~python
    def upsert_session_index(self, s: Any):
        """将单个会话摘要物化写入索引表"""
        st = s.start_time or s.modified_time
        date_str = st.strftime("%Y-%m-%d") if st else None
        first_prompt = s.user_prompts[0] if s.user_prompts else ""
        c_time = s.created_time.isoformat() if s.created_time else None
        m_time = s.modified_time.isoformat() if s.modified_time else None
~~~~~
~~~~~python
    def upsert_session_index(self, s: Any):
        """将单个会话摘要物化写入索引表"""
        st = s.start_time or s.modified_time
        date_str = st.strftime("%Y-%m-%d") if st else None
        first_prompt = getattr(s, "first_effective_prompt", None) or (
            s.user_prompts[0] if s.user_prompts else ""
        )
        c_time = s.created_time.isoformat() if s.created_time else None
        m_time = s.modified_time.isoformat() if s.modified_time else None
~~~~~

~~~~~act
patch_file
src/analyzer/exporter.py
~~~~~
~~~~~python
def export_first_prompts_to_jsonl(sessions: List[PromptSession], output_path: str):
    """
    将所有会话的「首轮提问」导出为 JSONL 文件，
    包含生命周期与 Token 能耗标签，便于 LLM 进行意图与阻抗聚类。
    """
    with open(output_path, "w", encoding="utf-8") as f:
        for s in sessions:
            if s.user_prompts:
                record = {
                    "file_id": s.file_id,
                    "title": s.name,
                    "first_prompt": s.user_prompts[0],
                    "total_turns": s.turn_count,
                    "total_tokens": s.total_tokens,
                    "duration_seconds": s.duration_seconds,
                    "has_branching": s.has_branching,
                    "model": s.model,
                    "created_time": s.created_time.isoformat()
                    if s.created_time
                    else None,
                }
                f.write(json.dumps(record, ensure_ascii=False) + "\n")


def export_prompts_summary_csv(sessions: List[PromptSession], output_path: str):
    """导出所有会话的概览统计报表 CSV (包含生命周期、Token 及摩擦力指标)"""
    fieldnames = [
        "file_id",
        "title",
        "model",
        "turn_count",
        "duration_human",
        "duration_seconds",
        "total_tokens",
        "thought_tokens",
        "has_branching",
        "branch_count",
        "user_char_count",
        "first_prompt_preview",
    ]
    with open(output_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for s in sessions:
            first_prompt = s.user_prompts[0] if s.user_prompts else ""
            preview = first_prompt[:80].replace("\n", " ") + (
                "..." if len(first_prompt) > 80 else ""
            )
~~~~~
~~~~~python
def export_first_prompts_to_jsonl(sessions: List[PromptSession], output_path: str):
    """
    将所有会话的「首轮提问」导出为 JSONL 文件，
    包含生命周期与 Token 能耗标签，便于 LLM 进行意图与阻抗聚类。
    """
    with open(output_path, "w", encoding="utf-8") as f:
        for s in sessions:
            prompt_text = getattr(s, "first_effective_prompt", None) or (
                s.user_prompts[0] if s.user_prompts else ""
            )
            if prompt_text:
                record = {
                    "file_id": s.file_id,
                    "title": s.name,
                    "first_prompt": prompt_text,
                    "total_turns": s.turn_count,
                    "total_tokens": s.total_tokens,
                    "duration_seconds": s.duration_seconds,
                    "has_branching": s.has_branching,
                    "model": s.model,
                    "created_time": s.created_time.isoformat()
                    if s.created_time
                    else None,
                }
                f.write(json.dumps(record, ensure_ascii=False) + "\n")


def export_prompts_summary_csv(sessions: List[PromptSession], output_path: str):
    """导出所有会话的概览统计报表 CSV (包含生命周期、Token 及摩擦力指标)"""
    fieldnames = [
        "file_id",
        "title",
        "model",
        "turn_count",
        "duration_human",
        "duration_seconds",
        "total_tokens",
        "thought_tokens",
        "has_branching",
        "branch_count",
        "user_char_count",
        "first_prompt_preview",
    ]
    with open(output_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for s in sessions:
            first_prompt = getattr(s, "first_effective_prompt", None) or (
                s.user_prompts[0] if s.user_prompts else ""
            )
            preview = first_prompt[:80].replace("\n", " ") + (
                "..." if len(first_prompt) > 80 else ""
            )
~~~~~

#### Acts 3: 后端 API 下发元数据并增加本地重新索引接口

在 `src/server/api.py` 中将 `extra_metadata` 序列化输出给前端，并提供 `/api/reindex` 接口。

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~python
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
~~~~~
~~~~~python
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


@router.post("/reindex")
def reindex_cache():
    """基于本地 SQLite file_cache 增量重新生成并同步 session_index（耗时 <1s）"""
    count = 0
    for file_id, mtime, raw_data in cache.iter_all_data():
        file_meta = {
            "id": file_id,
            "modifiedTime": mtime,
            "name": raw_data.get("name", "Untitled"),
        }
        session = parse_prompt_json(file_meta, raw_data)
        if session:
            cache.upsert_session_index(session)
            count += 1
    return {"status": "success", "reindexed_count": count}
~~~~~

#### Acts 4: 前端类型与会话详情面板交互重构

在 `frontend/src/types/metrics.ts` 补充类型定义，在 `frontend/src/components/SessionDetailPanel.tsx` 中实现内联附件专属卡片、折叠预览与下载组件。

~~~~~act
patch_file
frontend/src/types/metrics.ts
~~~~~
~~~~~python
export interface ConversationTurnItem {
  role: 'user' | 'model' | 'system';
  text: string;
  token_count: number;
  is_thought: boolean;
  payload_type: string;
  timestamp: string | null;
  is_edited: boolean;
}
~~~~~
~~~~~python
export interface ConversationTurnItem {
  role: 'user' | 'model' | 'system';
  text: string;
  token_count: number;
  is_thought: boolean;
  payload_type: string;
  timestamp: string | null;
  is_edited: boolean;
  extra_metadata?: {
    mime_type?: string;
    byte_size?: number;
    display_name?: string;
    doc_id?: string;
    [key: string]: unknown;
  };
}
~~~~~

~~~~~act
patch_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~tsx
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('复制失败:', err);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`px-2 py-1 text-[11px] rounded transition flex items-center gap-1 border ${
        copied
          ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
          : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 border-zinc-700/60'
      }`}
      title="复制本轮纯文本内容"
    >
      {copied ? (
        <>
          <span>✓</span>
          <span>已复制</span>
        </>
      ) : (
        <>
          <span>📋</span>
          <span>复制</span>
        </>
      )}
    </button>
  );
}

function TurnMessage({ turn, index }: { turn: ConversationTurnItem; index: number }) {
  const [isThinkingOpen, setIsThinkingOpen] = useState(false);
~~~~~
~~~~~tsx
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('复制失败:', err);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`px-2 py-1 text-[11px] rounded transition flex items-center gap-1 border ${
        copied
          ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
          : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 border-zinc-700/60'
      }`}
      title="复制本轮纯文本内容"
    >
      {copied ? (
        <>
          <span>✓</span>
          <span>已复制</span>
        </>
      ) : (
        <>
          <span>📋</span>
          <span>复制</span>
        </>
      )}
    </button>
  );
}

function DownloadButton({ text, filename }: { text: string; filename: string }) {
  const handleDownload = () => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      className="px-2 py-1 text-[11px] rounded transition flex items-center gap-1 border bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 border-zinc-700/60 cursor-pointer"
      title="下载文件附件"
    >
      <span>💾</span>
      <span>下载</span>
    </button>
  );
}

function TurnMessage({ turn, index }: { turn: ConversationTurnItem; index: number }) {
  const [isThinkingOpen, setIsThinkingOpen] = useState(false);
  const [isAttachmentOpen, setIsAttachmentOpen] = useState(false);
~~~~~

~~~~~act
patch_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~tsx
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
~~~~~
~~~~~tsx
      {/* 消息正文：云盘大文档专属卡片 或 内联附件卡片 或 Markdown 正文呈现 */}
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
        ) : turn.payload_type === 'inlineFile' ? (
          <div className="rounded-lg border border-cyan-900/40 bg-cyan-950/20 overflow-hidden">
            <div className="px-3.5 py-2.5 flex items-center justify-between bg-cyan-950/40 border-b border-cyan-900/30 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-base">📎</span>
                <div className="min-w-0">
                  <span className="font-semibold text-cyan-300 truncate">
                    {turn.extra_metadata?.display_name || '内联上下文文件 (inlineFile)'}
                  </span>
                  <span className="ml-2 font-mono text-[11px] text-cyan-400/80">
                    {turn.extra_metadata?.mime_type || 'text/plain'}
                    {turn.extra_metadata?.byte_size !== undefined &&
                      ` · ${(turn.extra_metadata.byte_size / 1024).toFixed(1)} KB`}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsAttachmentOpen(!isAttachmentOpen)}
                  className="px-2 py-1 text-[11px] font-mono rounded bg-cyan-900/40 hover:bg-cyan-900/60 text-cyan-200 border border-cyan-800/50 transition cursor-pointer"
                >
                  {isAttachmentOpen ? '▲ 收起内容' : '▼ 展开预览'}
                </button>
                <CopyButton text={turn.text} />
                <DownloadButton
                  text={turn.text}
                  filename={turn.extra_metadata?.display_name || `attachment_${index + 1}.txt`}
                />
              </div>
            </div>
            {isAttachmentOpen ? (
              <div className="p-4 text-xs font-mono whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto bg-black/40 text-cyan-100/90 select-text border-t border-cyan-900/20">
                {turn.text}
              </div>
            ) : (
              <button
                type="button"
                className="w-full text-left px-4 py-2 text-xs text-cyan-300/60 font-mono truncate cursor-pointer hover:bg-cyan-950/30 bg-transparent border-none"
                onClick={() => setIsAttachmentOpen(true)}
              >
                {turn.text.slice(0, 160)}...
              </button>
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
~~~~~

### 下一步建议
1. **本地索引刷新验证**：服务启动后可调用一次 `POST http://127.0.0.1:8000/api/reindex`，让本地历史缓存的会话列表立即更新首轮提问预览，消除旧的 XML 头部片段。
2. **前端代码检查**：进入 `frontend` 目录运行 `npm run check`，验证前端类型定义与代码格式完全合规。
