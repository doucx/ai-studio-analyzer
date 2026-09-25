from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any


@dataclass
class ConversationTurn:
    """单轮对话数据 (支持 Token、思考链与分支追踪)"""

    role: str  # 'user' | 'model' | 'system'
    text: str  # 文本内容
    token_count: int = 0  # 该轮消耗的精确 Token 数量
    is_thought: bool = False  # 是否为 Gemini 2.0 Thinking 思考过程
    payload_type: str = "text"  # 'text' | 'inlineFile' | 'driveDocument' | 'other'
    timestamp: Optional[datetime] = None
    branch_parent: Optional[Any] = None  # 分支父节点引用
    branch_children: List[Any] = field(default_factory=list)  # 派生出的分支列表
    is_edited: bool = False  # 是否为用户手动编辑过的历史节点
    extra_metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PromptSession:
    """单个 AI Studio 对话会话 (支持生命周期与认知消耗审计)"""

    file_id: str  # Google Drive 文件 ID
    name: str  # 对话/文件名称
    model: str  # 绑定的模型标识 (如 gemini-1.5-pro)
    created_time: Optional[datetime]  # 云端创建时间
    modified_time: Optional[datetime]  # 最后修改时间
    turns: List[ConversationTurn]  # 会话的所有轮次
    system_instruction: str = ""  # 系统指令 / 前置协议

    @property
    def start_time(self) -> Optional[datetime]:
        """推导会话起始时间：优先采用 created_time，其次推导自首个有效 Chunk 的时间戳"""
        if self.created_time:
            return self.created_time
        turn_times = [t.timestamp for t in self.turns if t.timestamp]
        return min(turn_times) if turn_times else None

    @property
    def end_time(self) -> Optional[datetime]:
        """推导会话结束时间：结合末轮 Chunk 时间与 modified_time 的最新值"""
        turn_times = [t.timestamp for t in self.turns if t.timestamp]
        max_turn_time = max(turn_times) if turn_times else None
        if self.modified_time and max_turn_time:
            return max(self.modified_time, max_turn_time)
        return self.modified_time or max_turn_time

    @property
    def estimated_engagement_seconds(self) -> float:
        """
        基线心智活跃时长估算模型 (Active Cognitive Engagement Estimation):
        依据 (Token 消耗量 + 字符数 + 块数) 进行常态人机交互耗时建模：
        1. 交互轮次往返与思考基线：每块 15s；
        2. 用户输入字符推敲与键入：按 5 字符/秒 (约 150 字/分)；
        3. 模型输出阅读与理解：按 8 tokens/秒 (约 480 tokens/分)。
        """
        base_time = self.chunk_count * 15.0
        typing_time = self.total_user_chars / 5.0
        reading_time = self.total_tokens / 8.0
        est = max(15.0, base_time + typing_time + reading_time)
        return round(est, 1)

    @property
    def duration(self) -> Optional[timedelta]:
        """
        会话有效心智活跃时长 (Active Engagement Duration):
        消除 0s 假死现象并防范跨月闲置沉睡的无界累加 (如 74 天)。
        """
        turn_times = sorted([t.timestamp for t in self.turns if t.timestamp])

        # 分支 1：存在 >= 2 个有效 chunk 时间戳，按交互窗口累计并做 30 分钟空闲截断
        if len(turn_times) >= 2:
            active_sec = 0.0
            # 首轮启动心智基线
            first_t = self.turns[0] if self.turns else None
            f_chars = len(first_t.text) if first_t and first_t.role == "user" else 0
            f_tok = first_t.token_count if first_t else 0
            active_sec += max(15.0, min(120.0, 15.0 + f_chars / 5.0 + f_tok / 8.0))

            for i in range(len(turn_times) - 1):
                gap = (turn_times[i + 1] - turn_times[i]).total_seconds()
                if gap <= 0:
                    continue
                if gap <= 1800:  # 30 分钟以内视作连续交互会话
                    active_sec += gap
                else:
                    # 超过 30 分钟属于跨日或沉睡搁置，截断为空闲，仅计入该轮次推进的合理心智窗口
                    curr_turn = self.turns[i + 1] if i + 1 < len(self.turns) else None
                    c_chars = (
                        len(curr_turn.text)
                        if curr_turn and curr_turn.role == "user"
                        else 0
                    )
                    c_tok = curr_turn.token_count if curr_turn else 0
                    active_sec += max(
                        15.0, min(300.0, 15.0 + c_chars / 5.0 + c_tok / 8.0)
                    )

            return timedelta(seconds=round(active_sec, 1))

        # 分支 2：chunks 均缺失时间戳 (或仅 1 个时间戳)
        c_time = self.created_time
        m_time = self.modified_time

        # 若无文件级时间戳，或两者完全相等 (如克隆/导入导致 modified_time == created_time)
        if not c_time or not m_time:
            return None

        file_span = (m_time - c_time).total_seconds()
        if abs(file_span) < 1.0:
            # 明确标记为无法推导真实时长的无效会话，返回 None 避免 0s 假死污染统计
            return None

        if file_span < 0:
            return None

        # 若跨度在合理范围内 (不超过 30 分钟，或在估算时长的 2 倍内)，采用真实文件跨度
        est = self.estimated_engagement_seconds
        if file_span <= max(1800.0, est * 2.0):
            return timedelta(seconds=round(file_span, 1))

        # 否则 (例如文件跨越数天或数月，存在巨量沉睡无界累计)，截断为空闲，采信基线心智估算时长
        return timedelta(seconds=est)

    @property
    def duration_seconds(self) -> Optional[float]:
        """会话生命周期持续秒数 (未知或无效时返回 None)"""
        d = self.duration
        return round(d.total_seconds(), 1) if d is not None else None

    @property
    def duration_human(self) -> str:
        """生命周期人类友好格式展示 (如 2h 15m，无有效时间戳或 0s 则展示 '未知')"""
        if self.duration is None:
            return "未知"
        total_sec = int(self.duration.total_seconds())
        if total_sec < 60:
            return f"{total_sec}s"
        hours, remainder = divmod(total_sec, 3600)
        minutes, seconds = divmod(remainder, 60)
        parts = []
        if hours > 0:
            parts.append(f"{hours}h")
        if minutes > 0:
            parts.append(f"{minutes}m")
        if not parts:
            parts.append(f"{seconds}s")
        return " ".join(parts)

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
    def chunk_count(self) -> int:
        """会话包含的 Chunk (数据块) 总数"""
        return len(self.turns)

    @property
    def turn_count(self) -> int:
        """为向后兼容保留，直接返回 Chunk 总数"""
        return self.chunk_count

    @property
    def total_tokens(self) -> int:
        """该会话消耗的 Token 总量"""
        return sum(t.token_count for t in self.turns)

    @property
    def user_tokens(self) -> int:
        """用户端输入消耗的 Token 数"""
        return sum(t.token_count for t in self.turns if t.role == "user")

    @property
    def model_tokens(self) -> int:
        """模型端生成消耗的 Token 数 (含思考)"""
        return sum(t.token_count for t in self.turns if t.role == "model")

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
        """分支/重试派生次数"""
        return sum(
            1
            for t in self.turns
            if t.branch_parent is not None or len(t.branch_children) > 0 or t.is_edited
        )

    @property
    def has_branching(self) -> bool:
        """是否存在分支分叉或重试编辑"""
        return self.branch_count > 0
