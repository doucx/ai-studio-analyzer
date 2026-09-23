from typing import List, Dict, Any
from .models import PromptSession


def calculate_session_metrics(sessions: List[PromptSession]) -> Dict[str, Any]:
    """
    计算关键消耗指标：
    1. 会话总数与总提问轮次
    2. 深度会长会话（轮次 > 5）占比
    3. 模型使用分布
    4. 用户提问字数统计与生命周期概况
    """
    if not sessions:
        return {"total_sessions": 0}

    total_sessions = len(sessions)
    total_turns = sum(s.turn_count for s in sessions)
    total_user_chars = sum(s.total_user_chars for s in sessions)
    deep_sessions = [s for s in sessions if s.turn_count >= 5]

    model_distribution: Dict[str, int] = {}
    for s in sessions:
        model_distribution[s.model] = model_distribution.get(s.model, 0) + 1

    return {
        "total_sessions": total_sessions,
        "total_turns": total_turns,
        "avg_turns_per_session": round(total_turns / total_sessions, 2),
        "total_user_chars": total_user_chars,
        "deep_session_count": len(deep_sessions),
        "deep_session_ratio": f"{round(len(deep_sessions) / total_sessions * 100, 1)}%",
        "model_distribution": model_distribution,
    }