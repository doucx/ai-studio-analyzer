from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional, Dict, Any


@dataclass
class ConversationTurn:
    """单轮对话数据"""
    role: str                       # 'user' | 'model' | 'system'
    text: str                       # 文本内容
    timestamp: Optional[datetime] = None
    extra_metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PromptSession:
    """单个 AI Studio 对话会话"""
    file_id: str                    # Google Drive 文件 ID
    name: str                       # 对话/文件名称
    model: str                      # 绑定的模型标识 (如 gemini-1.5-pro)
    created_time: Optional[datetime]# 云端创建时间
    modified_time: Optional[datetime]# 最后修改时间
    turns: List[ConversationTurn]   # 会话的所有轮次
    
    @property
    def user_prompts(self) -> List[str]:
        """提取所有属于用户的发言"""
        return [turn.text for turn in self.turns if turn.role == 'user']

    @property
    def turn_count(self) -> int:
        """对话轮次总数"""
        return len(self.turns)

    @property
    def total_user_chars(self) -> int:
        """用户提问的总字符量（精力消耗代理指标之一）"""
        return sum(len(text) for text in self.user_prompts)