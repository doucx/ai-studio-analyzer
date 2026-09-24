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