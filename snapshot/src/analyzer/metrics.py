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