好的，接下来我们执行 **Step 2**：在数据模型、解析器及指标引擎中，完整补齐生命周期（`duration`）、精确 Token 统计（包含思考链 Token）以及分支分叉（`branching`）标记。

## [WIP] feat(models,parser): 补齐生命周期 duration、精确 token 统计与分支标记

### 用户需求
1. 在 `models.py` 的 `PromptSession` 中新增会话生命周期属性（`duration = modified_time - created_time` 及秒数换算）。
2. 在 `ConversationTurn` 和 `PromptSession` 中补齐每轮交互的精确 Token 消耗（`token_count`）、思考链标记（`is_thought`）、载荷类型（`payload_type`）以及分支编辑标记（`branch_parent`, `branch_children`, `is_edited`）。
3. 升级 `parser.py`，完整解析 `chunkedPrompt` 中的多模态载荷与元数据，并提取系统指令（`systemInstruction`）。
4. 在 `metrics.py` 与 `exporter.py` 中输出新增的 Token 能耗与心智摩擦力指标。

### 评论
从粗粒度的“用户提问字符数”升维到“生命周期时长”、“Token 真实能耗”和“分支重试率”，是实现你设想的“思维摩擦力测量”与“心智负荷分型”的关键前提。通过精确捕获 `isThought` 与 `branching`，系统能直接量化哪些会话引发了模型的深度思考、哪些会话发生了反复修改重试。

### 目标
1. **升级 `src/analyzer/models.py`**：
   - 扩充 `ConversationTurn` 字段：`token_count`, `is_thought`, `payload_type`, `branch_parent`, `branch_children`, `is_edited`。
   - 在 `PromptSession` 增加 `duration`, `duration_seconds`, `total_tokens`, `thought_tokens`, `has_branching`, `branch_count`, `system_instruction` 等属性与字段。
2. **升级 `src/analyzer/parser.py`**：
   - 在遍历 `chunks` 时，无损提取 `tokenCount`、`isThought`、`branchParent`、`branchChildren`、`isEdited` 及创建时间。
   - 解析 Base64 附件和 Drive 引用文档作为独立载荷类型。
   - 提取 `systemInstruction.text`。
3. **升级 `src/analyzer/metrics.py`**：
   - 计算并打印：全局 Token 消耗量、思考链 Token 占比、平均会话持续时长、产生分支/重试的困境会话占比。
4. **升级 `src/analyzer/exporter.py`**：
   - 在导出的 CSV 与 JSONL 中补充持续时长、Token 总量与分支标记。

### 基本原理
1. **非侵入式派生计算**：生命周期与 Token 统计通过 `@property` 动态计算，保持类结构的轻量与响应性。
2. **多模态与思维链分流**：将常规问答与 `isThought` 思考块清晰拆分，使后续分析既能评估真实答案，又能单独评估模型的后台思考能耗。

### 标签
#intent/build #flow/ready #priority/high #comp/runtime #concept/state #concept/parser #scope/core #scope/api #ai/instruct #task/domain/analytics #task/object/session-metrics-and-tokens #task/action/implementation #task/state/begin

---

### Script

#### Acts 1: 升级 `src/analyzer/models.py`，扩展多维元数据与计算属性

扩充 `ConversationTurn` 与 `PromptSession`，定义时长、Token 聚合与分支判断逻辑。

~~~~~act
write_file
src/analyzer/models.py
~~~~~
~~~~~python
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any


@dataclass
class ConversationTurn:
    """单轮对话数据 (增强版：支持 Token、思考链与分支追踪)"""
    role: str                       # 'user' | 'model' | 'system'
    text: str                       # 文本内容
    token_count: int = 0            # 该轮消耗的精确 Token 数量
    is_thought: bool = False        # 是否为 Gemini 2.0 Thinking 思考过程
    payload_type: str = "text"      # 'text' | 'inlineFile' | 'driveDocument' | 'other'
    timestamp: Optional[datetime] = None
    branch_parent: Optional[Any] = None       # 分支父节点引用
    branch_children: List[Any] = field(default_factory=list) # 派生出的分支列表
    is_edited: bool = False         # 是否为用户手动编辑过的历史节点
    extra_metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PromptSession:
    """单个 AI Studio 对话会话 (支持生命周期与认知消耗审计)"""
    file_id: str                    # Google Drive 文件 ID
    name: str                       # 对话/文件名称
    model: str                      # 绑定的模型标识 (如 gemini-1.5-pro)
    created_time: Optional[datetime] # 云端创建时间
    modified_time: Optional[datetime]# 最后修改时间
    turns: List[ConversationTurn]   # 会话的所有轮次
    system_instruction: str = ""    # 系统指令 / 前置协议

    @property
    def duration(self) -> Optional[timedelta]:
        """会话生命周期持续时间 (modified_time - created_time)"""
        if self.created_time and self.modified_time:
            delta = self.modified_time - self.created_time
            return delta if delta.total_seconds() >= 0 else timedelta(0)
        return None

    @property
    def duration_seconds(self) -> float:
        """会话生命周期持续秒数"""
        d = self.duration
        return round(d.total_seconds(), 1) if d else 0.0

    @property
    def duration_human(self) -> str:
        """生命周期人类友好格式展示 (如 2h 15m)"""
        if not self.duration:
            return "0s"
        total_sec = int(self.duration.total_seconds())
        hours, remainder = divmod(total_sec, 3600)
        minutes, seconds = divmod(remainder, 60)
        parts = []
        if hours > 0:
            parts.append(f"{hours}h")
        if minutes > 0:
            parts.append(f"{minutes}m")
        if seconds > 0 or not parts:
            parts.append(f"{seconds}s")
        return " ".join(parts)

    @property
    def user_prompts(self) -> List[str]:
        """提取所有属于用户的有效发言文本 (排除非纯文本挂载标记)"""
        return [turn.text for turn in self.turns if turn.role == 'user']

    @property
    def turn_count(self) -> int:
        """对话轮次总数 (排除纯思考块)"""
        return len([t for t in self.turns if not t.is_thought])

    @property
    def total_tokens(self) -> int:
        """该会话消耗的 Token 总量 (含上下文输入、生成与思考)"""
        return sum(t.token_count for t in self.turns)

    @property
    def user_tokens(self) -> int:
        """用户端输入消耗的 Token 数"""
        return sum(t.token_count for t in self.turns if t.role == 'user')

    @property
    def model_tokens(self) -> int:
        """模型端生成消耗的 Token 数 (含思考)"""
        return sum(t.token_count for t in self.turns if t.role == 'model')

    @property
    def thought_tokens(self) -> int:
        """模型专属思考链 (Thinking) 消耗的 Token 计数"""
        return sum(t.token_count for t in self.turns if t.is_thought)

    @property
    def total_user_chars(self) -> int:
        """用户提问的总字符量"""
        return sum(len(text) for text in self.user_prompts)

    @property
    def branch_count(self) -> int:
        """分支/重试派生次数 (衡量沟通阻抗与思维摩擦力)"""
        return sum(1 for t in self.turns if t.branch_parent is not None or len(t.branch_children) > 0 or t.is_edited)

    @property
    def has_branching(self) -> bool:
        """是否存在分支分叉或重试编辑"""
        return self.branch_count > 0
~~~~~

#### Acts 2: 升级 `src/analyzer/parser.py`，完整捕获 Token 与分支结构

解析 `chunks` 中的 `tokenCount`、`isThought`、Base64 附件、Drive 大文档及分支信息。

~~~~~act
write_file
src/analyzer/parser.py
~~~~~
~~~~~python
import base64
from datetime import datetime
from typing import Optional, Dict, Any
from .models import PromptSession, ConversationTurn


def is_valid_prompt_file(name: str) -> bool:
    """过滤粘贴板缓存与纯图片临时文件"""
    if name.startswith("Paste "):
        return False
    lower = name.lower()
    if lower.endswith(('.png', '.jpg', '.jpeg', '.webp', '.gif')):
        return False
    return True


def parse_prompt_json(file_meta: Optional[Dict[str, Any]], raw_data: Dict[str, Any]) -> Optional[PromptSession]:
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
                    chunk_time = datetime.fromisoformat(c["createTime"].replace("Z", "+00:00"))
                except Exception:
                    pass

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
                        text = raw_bytes.decode("utf-8", errors="ignore")[:300] + "... [内联文本附件]"
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
                turns.append(ConversationTurn(
                    role=role,
                    text=text,
                    token_count=token_count,
                    is_thought=is_thought,
                    payload_type=payload_type,
                    timestamp=chunk_time,
                    branch_parent=branch_parent,
                    branch_children=branch_children,
                    is_edited=is_edited
                ))

    # 2. 兼容标准 Gemini contents 结构
    elif "contents" in raw_data:
        contents = raw_data.get("contents", [])
        for item in contents:
            role = item.get("role", "user")
            parts = item.get("parts", [])
            text_blocks = [p.get("text", "") for p in parts if "text" in p]
            combined_text = "\n".join(text_blocks)
            if combined_text:
                turns.append(ConversationTurn(
                    role=role,
                    text=combined_text,
                    token_count=0,
                    payload_type="text"
                ))

    if not turns:
        return None

    # 解析会话层时间戳
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

    # 解析名称
    name = file_meta.get("name") or raw_data.get("name") or raw_data.get("title") or "Untitled"

    return PromptSession(
        file_id=file_meta.get("id", ""),
        name=name,
        model=model,
        created_time=created_time,
        modified_time=modified_time,
        turns=turns,
        system_instruction=sys_instruction
    )
~~~~~

#### Acts 3: 升级 `src/analyzer/metrics.py` 计算 Token 能耗与认知摩擦力

将新增的 Token 消耗、思考链占比、持续时长与分支阻抗指标纳入全局统计。

~~~~~act
write_file
src/analyzer/metrics.py
~~~~~
~~~~~python
from typing import List, Dict, Any
from .models import PromptSession


def calculate_session_metrics(sessions: List[PromptSession]) -> Dict[str, Any]:
    """
    计算关键认知与交互消耗指标：
    1. 基础吞吐：会话总数、对话轮次
    2. 计算能耗：Token 消耗总量、思考链 (Thinking) Token 比例
    3. 任务耐受与深度：深度会话占比 (≥5轮)、会话平均持续时长
    4. 思维摩擦力：重试与分支会话比例、分支总次数
    5. 模型偏好与系统指令部署概况
    """
    if not sessions:
        return {"total_sessions": 0}

    total_sessions = len(sessions)
    total_turns = sum(s.turn_count for s in sessions)
    total_user_chars = sum(s.total_user_chars for s in sessions)

    # 1. 计算能耗 (Token 维度)
    total_tokens = sum(s.total_tokens for s in sessions)
    total_thought_tokens = sum(s.thought_tokens for s in sessions)
    thought_ratio = (
        f"{round(total_thought_tokens / total_tokens * 100, 2)}%"
        if total_tokens > 0 else "0%"
    )

    # 2. 任务耐受度与生命周期 (Duration 维度)
    deep_sessions = [s for s in sessions if s.turn_count >= 5]
    valid_durations = [s.duration_seconds for s in sessions if s.duration_seconds > 0]
    avg_duration_sec = (
        round(sum(valid_durations) / len(valid_durations), 1)
        if valid_durations else 0.0
    )
    avg_duration_min = round(avg_duration_sec / 60, 1)

    # 3. 思维摩擦力与沟通阻抗 (Branching 维度)
    branching_sessions = [s for s in sessions if s.has_branching]
    total_branches = sum(s.branch_count for s in sessions)

    # 4. 模型使用分布
    model_distribution: Dict[str, int] = {}
    for s in sessions:
        model_distribution[s.model] = model_distribution.get(s.model, 0) + 1

    # 5. 系统指令部署会话数
    with_sys_instruction_count = sum(1 for s in sessions if s.system_instruction)

    return {
        "total_sessions": total_sessions,
        "total_turns": total_turns,
        "avg_turns_per_session": round(total_turns / total_sessions, 2),
        "total_user_chars": total_user_chars,
        "deep_session_count": len(deep_sessions),
        "deep_session_ratio": f"{round(len(deep_sessions) / total_sessions * 100, 1)}%",
        "avg_duration_minutes": avg_duration_min,
        "total_tokens": total_tokens,
        "avg_tokens_per_session": round(total_tokens / total_sessions, 0) if total_sessions else 0,
        "total_thought_tokens": total_thought_tokens,
        "thought_token_ratio": thought_ratio,
        "friction_sessions_count": len(branching_sessions),
        "friction_session_ratio": f"{round(len(branching_sessions) / total_sessions * 100, 1)}%",
        "total_branch_retries": total_branches,
        "sys_instruction_configured_count": with_sys_instruction_count,
        "model_distribution": model_distribution,
    }
~~~~~

#### Acts 4: 升级 `src/analyzer/exporter.py`，输出扩展字段

在报表中增加时长、Token 与分支字段。

~~~~~act
write_file
src/analyzer/exporter.py
~~~~~
~~~~~python
import csv
import json
from typing import List
from .models import PromptSession


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
                    "created_time": s.created_time.isoformat() if s.created_time else None
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
        "first_prompt_preview"
    ]
    with open(output_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for s in sessions:
            first_prompt = s.user_prompts[0] if s.user_prompts else ""
            preview = first_prompt[:80].replace("\n", " ") + ("..." if len(first_prompt) > 80 else "")
            writer.writerow({
                "file_id": s.file_id,
                "title": s.name,
                "model": s.model,
                "turn_count": s.turn_count,
                "duration_human": s.duration_human,
                "duration_seconds": s.duration_seconds,
                "total_tokens": s.total_tokens,
                "thought_tokens": s.thought_tokens,
                "has_branching": s.has_branching,
                "branch_count": s.branch_count,
                "user_char_count": s.total_user_chars,
                "first_prompt_preview": preview
            })
~~~~~

#### Acts 5: 更新 `main.py` 控制台指标输出，直观展现多维洞察

更新打印函数，直接展示 Token 总能耗、思考链消耗、平均生命周期和分支摩擦力指标。

~~~~~act
patch_file
main.py
~~~~~
~~~~~python.old
    # 指标计算
    metrics = calculate_session_metrics(sessions)
    print("\n" + "=" * 30 + " 📊 核心指标概览 " + "=" * 30)
    print(f"  - 分析会话总数:       {metrics['total_sessions']}")
    print(f"  - 总对话轮次 (Turns): {metrics['total_turns']} (平均每会话: {metrics['avg_turns_per_session']} 轮)")
    print(f"  - 深度攻坚会话 (≥5轮): {metrics['deep_session_count']} 场 (占比 {metrics['deep_session_ratio']})")
    print(f"  - 用户提问总字数:     {metrics['total_user_chars']} 字符")
    print(f"  - 模型使用分布:       {metrics['model_distribution']}")
    print("=" * 76)
~~~~~
~~~~~python.new
    # 指标计算
    metrics = calculate_session_metrics(sessions)
    print("\n" + "=" * 30 + " 📊 认知与能耗全景概览 " + "=" * 30)
    print(f"  - 分析会话总数:           {metrics['total_sessions']}")
    print(f"  - 总对话轮次 (Turns):     {metrics['total_turns']} (平均每会话: {metrics['avg_turns_per_session']} 轮)")
    print(f"  - 深度攻坚会话 (≥5轮):     {metrics['deep_session_count']} 场 (占比 {metrics['deep_session_ratio']})")
    print(f"  - 平均持续时长 (Duration): {metrics['avg_duration_minutes']} 分钟")
    print(f"  - 计算能耗 (Total Tokens): {metrics['total_tokens']:,} (平均每会话: {int(metrics['avg_tokens_per_session']):,} Tokens)")
    print(f"  - 思考链消耗 (Thinking):   {metrics['total_thought_tokens']:,} Tokens (占总能耗: {metrics['thought_token_ratio']})")
    print(f"  - 思维摩擦力 (重试/分支):   {metrics['friction_sessions_count']} 场 (占比: {metrics['friction_session_ratio']}, 累计分支重试: {metrics['total_branch_retries']} 次)")
    print(f"  - 系统指令部署会话数:     {metrics['sys_instruction_configured_count']} 场")
    print(f"  - 用户提问总字数:         {metrics['total_user_chars']:,} 字符")
    print(f"  - 模型偏好分布:           {metrics['model_distribution']}")
    print("=" * 76)
~~~~~

### 下一步建议

1. **运行离线分析验证**：
   运行 `python main.py analyze`，观察输出的 Token 能耗、思考链占比与平均时长指标。
2. **查看生成的报表**：
   打开 `prompts_summary.csv`，可以按 `duration_seconds`、`total_tokens` 或 `branch_count` 排序，快速找出你历史上耗费心力最大、推敲最深的会话。
3. **推进至 Step 3 / 领域切片**：
   引入时间衰减与领域切片（代码、DPDR/情绪、心象、认知审计），为后续 Web UI 提供多维度聚合 API。
