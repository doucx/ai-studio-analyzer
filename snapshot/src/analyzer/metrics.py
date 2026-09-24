from typing import List, Dict, Any
import pandas as pd
from .models import PromptSession


def calculate_session_metrics(sessions: List[PromptSession]) -> Dict[str, Any]:
    """
    基于 pandas 的稳健认知与交互指标引擎：
    1. 引入中位数 (Median) 与分位数 (P75, P90)，抗长尾极值干扰
    2. 生命周期心智时长梯队切片
    3. Token 能耗与思考链细分
    4. 沟通阻抗与模型分布
    """
    if not sessions:
        return {"total_sessions": 0}

    total_sessions = len(sessions)

    # 1. 构造结构化 DataFrame
    records = []
    for s in sessions:
        st = s.start_time or s.modified_time
        date_str = st.strftime("%Y-%m-%d") if st else None
        records.append(
            {
                "file_id": s.file_id,
                "date": date_str,
                "turn_count": s.turn_count,
                "duration_seconds": s.duration_seconds,
                "duration_minutes": round(s.duration_seconds / 60, 2),
                "total_tokens": s.total_tokens,
                "thought_tokens": s.thought_tokens,
                "user_chars": s.total_user_chars,
                "has_branching": s.has_branching,
                "branch_count": s.branch_count,
                "has_sys_instruction": bool(s.system_instruction),
                "model": s.model,
            }
        )

    df = pd.DataFrame(records)

    # 2. 对话轮次分位数
    turn_s = df["turn_count"]
    turn_stats = {
        "mean": round(float(turn_s.mean()), 2),
        "median": round(float(turn_s.median()), 1),
        "p75": round(float(turn_s.quantile(0.75)), 1),
        "p90": round(float(turn_s.quantile(0.90)), 1),
        "deep_count": int((turn_s >= 5).sum()),
        "deep_ratio": f"{round(float((turn_s >= 5).mean()) * 100, 1)}%",
    }

    # 3. 会话时长 (Duration) 分位数与长尾过滤 (仅统计有效交互时长 >= 10 秒的会话)
    meaningful_df = df[df["duration_seconds"] >= 10]
    if not meaningful_df.empty:
        dur_s = meaningful_df["duration_minutes"]
        dur_stats = {
            "mean": round(float(dur_s.mean()), 1),
            "median": round(float(dur_s.median()), 1),
            "p75": round(float(dur_s.quantile(0.75)), 1),
            "p90": round(float(dur_s.quantile(0.90)), 1),
            "max": round(float(dur_s.max()), 1),
            "valid_count": len(meaningful_df),
        }
    else:
        dur_stats = {
            "mean": 0.0,
            "median": 0.0,
            "p75": 0.0,
            "p90": 0.0,
            "max": 0.0,
            "valid_count": 0,
        }

    # 多轮深入会话 (≥2 轮) 专属时长统计
    multi_turn_df = df[df["turn_count"] >= 2]
    if not multi_turn_df.empty and (multi_turn_df["duration_seconds"] > 0).any():
        m_dur_s = multi_turn_df[multi_turn_df["duration_seconds"] > 0][
            "duration_minutes"
        ]
        multi_dur_stats = {
            "mean": round(float(m_dur_s.mean()), 1),
            "median": round(float(m_dur_s.median()), 1),
            "p75": round(float(m_dur_s.quantile(0.75)), 1),
            "p90": round(float(m_dur_s.quantile(0.90)), 1),
        }
    else:
        multi_dur_stats = {"mean": 0.0, "median": 0.0, "p75": 0.0, "p90": 0.0}

    # 时长心智梯队划分
    tier_flash = int((df["duration_minutes"] < 10).sum())  # 即时快问 (<10m)
    tier_focus = int(
        ((df["duration_minutes"] >= 10) & (df["duration_minutes"] < 60)).sum()
    )  # 聚焦推进 (10~60m)
    tier_deep = int(
        ((df["duration_minutes"] >= 60) & (df["duration_minutes"] < 360)).sum()
    )  # 深度攻坚 (1~6h)
    tier_epic = int((df["duration_minutes"] >= 360).sum())  # 跨日长线 (>6h)

    duration_tiers = {
        "flash": (tier_flash, f"{round(tier_flash / total_sessions * 100, 1)}%"),
        "focus": (tier_focus, f"{round(tier_focus / total_sessions * 100, 1)}%"),
        "deep": (tier_deep, f"{round(tier_deep / total_sessions * 100, 1)}%"),
        "epic": (tier_epic, f"{round(tier_epic / total_sessions * 100, 1)}%"),
    }

    # 4. Token 消耗分位数
    tok_s = df["total_tokens"]
    total_tokens = int(tok_s.sum())
    total_thought_tokens = int(df["thought_tokens"].sum())
    tok_stats = {
        "total": total_tokens,
        "mean": round(float(tok_s.mean()), 0),
        "median": round(float(tok_s.median()), 0),
        "p75": round(float(tok_s.quantile(0.75)), 0),
        "p90": round(float(tok_s.quantile(0.90)), 0),
        "total_thought": total_thought_tokens,
        "thought_ratio": f"{round(total_thought_tokens / total_tokens * 100, 2)}%"
        if total_tokens > 0
        else "0%",
    }

    # 5. 思维摩擦力与分支
    branch_count = int(df["has_branching"].sum())
    friction_stats = {
        "branch_sessions": branch_count,
        "branch_ratio": f"{round(branch_count / total_sessions * 100, 1)}%",
        "total_retries": int(df["branch_count"].sum()),
    }

    # 6. 模型偏好分布
    model_dist = df["model"].value_counts().to_dict()

    # 7. 每日 Token 消耗与活跃趋势聚合 (按日期升序)
    daily_trends = []
    valid_dates_df = df[df["date"].notna()]
    if not valid_dates_df.empty:
        grouped = (
            valid_dates_df.groupby("date")
            .agg(
                total_tokens=("total_tokens", "sum"),
                thought_tokens=("thought_tokens", "sum"),
                sessions=("file_id", "count"),
                turns=("turn_count", "sum"),
            )
            .reset_index()
            .sort_values("date")
        )

        for _, row in grouped.iterrows():
            daily_trends.append(
                {
                    "date": str(row["date"]),
                    "total_tokens": int(row["total_tokens"]),
                    "thought_tokens": int(row["thought_tokens"]),
                    "sessions": int(row["sessions"]),
                    "turns": int(row["turns"]),
                }
            )

    return {
        "total_sessions": total_sessions,
        "total_turns": int(turn_s.sum()),
        "total_user_chars": int(df["user_chars"].sum()),
        "turn_stats": turn_stats,
        "dur_stats": dur_stats,
        "multi_dur_stats": multi_dur_stats,
        "duration_tiers": duration_tiers,
        "tok_stats": tok_stats,
        "friction_stats": friction_stats,
        "sys_instruction_count": int(df["has_sys_instruction"].sum()),
        "model_distribution": model_dist,
        "daily_trends": daily_trends,
    }
