from typing import Any

import pandas as pd


def calculate_session_metrics(
    sessions: list[Any],
    is_single_day: bool = False,
    single_date: str | None = None,
) -> dict[str, Any]:
    """
    基于 pandas 的稳健认知与交互指标引擎：
    兼容 PromptSession 实例列表或来自 session_index 表的字典列表，
    当为单日场景时支持自动切换为 24 小时槽位分时趋势。
    """
    if not sessions:
        empty_trends = []
        if is_single_day:
            empty_trends = [
                {
                    "date": f"{h:02d}:00",
                    "total_tokens": 0,
                    "cumulative_tokens": 0,
                    "thought_tokens": 0,
                    "sessions": 0,
                    "turns": 0,
                }
                for h in range(24)
            ]
        return {
            "total_sessions": 0,
            "total_turns": 0,
            "total_user_chars": 0,
            "turn_stats": {
                "mean": 0.0,
                "median": 0.0,
                "p75": 0.0,
                "p90": 0.0,
                "deep_count": 0,
                "deep_ratio": "0.0%",
            },
            "dur_stats": {
                "mean": 0.0,
                "median": 0.0,
                "p75": 0.0,
                "p90": 0.0,
                "max": 0.0,
                "valid_count": 0,
            },
            "multi_dur_stats": {
                "mean": 0.0,
                "median": 0.0,
                "p75": 0.0,
                "p90": 0.0,
            },
            "duration_tiers": {
                "flash": (0, "0.0%"),
                "focus": (0, "0.0%"),
                "deep": (0, "0.0%"),
                "epic": (0, "0.0%"),
            },
            "tok_stats": {
                "total": 0,
                "cumulative_total": 0,
                "expansion_factor": "1.0x",
                "mean": 0.0,
                "median": 0.0,
                "p75": 0.0,
                "p90": 0.0,
                "total_thought": 0,
                "thought_ratio": "0%",
            },
            "friction_stats": {
                "branch_sessions": 0,
                "branch_ratio": "0.0%",
                "total_retries": 0,
            },
            "sys_instruction_count": 0,
            "model_distribution": {},
            "daily_trends": empty_trends,
            "trend_granularity": "hour" if is_single_day else "day",
            "single_date": single_date if is_single_day else None,
            "message": "当前时间范围内无会话记录",
        }

    total_sessions = len(sessions)

    # 1. 构造结构化 DataFrame (自适应字典或 PromptSession 对象)
    records = []
    first_item = sessions[0]
    if isinstance(first_item, dict):
        for d in sessions:
            dur_sec = d.get("duration_seconds")
            dur_min = round(dur_sec / 60, 2) if dur_sec is not None else None
            tot_tok = d.get("total_tokens", 0)
            cum_tok = d.get("cumulative_tokens") or tot_tok
            records.append(
                {
                    "file_id": d["file_id"],
                    "date": d.get("date"),
                    "turn_count": d.get("turn_count", 0),
                    "duration_seconds": dur_sec,
                    "duration_minutes": dur_min,
                    "total_tokens": tot_tok,
                    "cumulative_tokens": cum_tok,
                    "thought_tokens": d.get("thought_tokens", 0),
                    "user_chars": d.get("user_char_count", 0),
                    "has_branching": bool(d.get("has_branching", False)),
                    "branch_count": d.get("branch_count", 0),
                    "has_sys_instruction": bool(d.get("has_sys_instruction", False)),
                    "model": d.get("model", "unknown"),
                    "active_dates": d.get("active_dates"),
                    "modified_time": d.get("modified_time"),
                }
            )
    else:
        for s in sessions:
            st = s.start_time or s.modified_time
            date_str = st.strftime("%Y-%m-%d") if st else None
            dur_sec = s.duration_seconds
            dur_min = round(dur_sec / 60, 2) if dur_sec is not None else None
            tot_tok = s.total_tokens
            cum_tok = getattr(s, "cumulative_api_tokens", tot_tok)
            records.append(
                {
                    "file_id": s.file_id,
                    "date": date_str,
                    "turn_count": s.turn_count,
                    "duration_seconds": dur_sec,
                    "duration_minutes": dur_min,
                    "total_tokens": tot_tok,
                    "cumulative_tokens": cum_tok,
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

    # 3. 会话时长 (Duration) 分位数与长尾过滤 (仅统计有效交互时长 >= 10 秒的非空会话)
    meaningful_df = df[df["duration_seconds"].notna() & (df["duration_seconds"] >= 10)]
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
    multi_turn_df = df[
        (df["turn_count"] >= 2)
        & df["duration_seconds"].notna()
        & (df["duration_seconds"] >= 10)
    ]
    if not multi_turn_df.empty:
        m_dur_s = multi_turn_df["duration_minutes"]
        multi_dur_stats = {
            "mean": round(float(m_dur_s.mean()), 1),
            "median": round(float(m_dur_s.median()), 1),
            "p75": round(float(m_dur_s.quantile(0.75)), 1),
            "p90": round(float(m_dur_s.quantile(0.90)), 1),
        }
    else:
        multi_dur_stats = {"mean": 0.0, "median": 0.0, "p75": 0.0, "p90": 0.0}

    # 时长心智梯队划分 (仅基于具有有效时长的样本，避免未知样本充当即时快问)
    valid_dur_df = df[df["duration_minutes"].notna()]
    valid_dur_total = len(valid_dur_df) if not valid_dur_df.empty else total_sessions
    denom = valid_dur_total if valid_dur_total > 0 else 1

    tier_flash = int((valid_dur_df["duration_minutes"] < 10).sum())  # 即时快问 (<10m)
    tier_focus = int(
        (
            (valid_dur_df["duration_minutes"] >= 10)
            & (valid_dur_df["duration_minutes"] < 60)
        ).sum()
    )  # 聚焦推进 (10~60m)
    tier_deep = int(
        (
            (valid_dur_df["duration_minutes"] >= 60)
            & (valid_dur_df["duration_minutes"] < 360)
        ).sum()
    )  # 深度攻坚 (1~6h)
    tier_epic = int((valid_dur_df["duration_minutes"] >= 360).sum())  # 跨日长线 (>6h)

    duration_tiers = {
        "flash": (tier_flash, f"{round(tier_flash / denom * 100, 1)}%"),
        "focus": (tier_focus, f"{round(tier_focus / denom * 100, 1)}%"),
        "deep": (tier_deep, f"{round(tier_deep / denom * 100, 1)}%"),
        "epic": (tier_epic, f"{round(tier_epic / denom * 100, 1)}%"),
    }

    # 4. Token 消耗分位数与累计推理算力
    tok_s = df["total_tokens"]
    total_tokens = int(tok_s.sum())
    total_thought_tokens = int(df["thought_tokens"].sum())
    total_cumulative_tokens = int(df["cumulative_tokens"].sum())
    expansion_factor = (
        f"{round(total_cumulative_tokens / total_tokens, 2)}x"
        if total_tokens > 0
        else "1.0x"
    )

    tok_stats = {
        "total": total_tokens,
        "cumulative_total": total_cumulative_tokens,
        "expansion_factor": expansion_factor,
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

    # 7. 时序走势聚合：若为单日场景则生成 24 个小时槽位分布，否则按日聚合
    daily_trends = []

    if is_single_day and single_date:
        import json
        from datetime import datetime

        hourly_buckets = [
            {
                "date": f"{h:02d}:00",
                "total_tokens": 0,
                "cumulative_tokens": 0,
                "thought_tokens": 0,
                "sessions": 0,
                "turns": 0,
            }
            for h in range(24)
        ]

        for r in records:
            matched_hour = None
            active_dates_str = r.get("active_dates")
            if active_dates_str:
                try:
                    ad = json.loads(active_dates_str)
                    if single_date in ad:
                        time_part = ad[single_date]
                        matched_hour = int(time_part.split(":")[0])
                except (ValueError, KeyError, TypeError):
                    pass

            if matched_hour is None:
                m_str = r.get("modified_time")
                if m_str:
                    try:
                        m_dt = datetime.fromisoformat(m_str).astimezone()
                        if m_dt.strftime("%Y-%m-%d") == single_date:
                            matched_hour = m_dt.hour
                    except (ValueError, TypeError):
                        pass

            if matched_hour is not None and 0 <= matched_hour <= 23:
                bucket = hourly_buckets[matched_hour]
                bucket["total_tokens"] += r["total_tokens"]
                bucket["cumulative_tokens"] += r["cumulative_tokens"]
                bucket["thought_tokens"] += r["thought_tokens"]
                bucket["sessions"] += 1
                bucket["turns"] += r["turn_count"]

        daily_trends = hourly_buckets
    else:
        valid_dates_df = df[df["date"].notna()]
        if not valid_dates_df.empty:
            grouped = (
                valid_dates_df.groupby("date")
                .agg(
                    total_tokens=("total_tokens", "sum"),
                    cumulative_tokens=("cumulative_tokens", "sum"),
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
                        "cumulative_tokens": int(row["cumulative_tokens"]),
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
        "trend_granularity": "hour" if is_single_day else "day",
        "single_date": single_date if is_single_day else None,
    }
