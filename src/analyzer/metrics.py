from collections import Counter, defaultdict
from typing import Any


def _quantile(sorted_vals: list[float], pct: float) -> float:
    """计算已升序排列数组的分位数"""
    if not sorted_vals:
        return 0.0
    idx = int(len(sorted_vals) * pct)
    return float(sorted_vals[min(idx, len(sorted_vals) - 1)])


def calculate_session_metrics(
    sessions: list[Any],
    is_single_day: bool = False,
    single_date: str | None = None,
) -> dict[str, Any]:
    """
    轻量高性能认知与交互指标引擎 (纯 Python 原生实现，零第三方数据科学依赖)：
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

    # 1. 结构化抽取标准化记录
    records = []
    first_item = sessions[0]
    if isinstance(first_item, dict):
        for d in sessions:
            dur_sec = d.get("duration_seconds")
            dur_min = round(dur_sec / 60.0, 2) if dur_sec is not None else None
            tot_tok = int(d.get("total_tokens") or 0)
            cum_tok = int(d.get("cumulative_tokens") or tot_tok)
            records.append(
                {
                    "file_id": d["file_id"],
                    "date": d.get("date"),
                    "turn_count": int(d.get("turn_count") or 0),
                    "duration_seconds": dur_sec,
                    "duration_minutes": dur_min,
                    "total_tokens": tot_tok,
                    "cumulative_tokens": cum_tok,
                    "thought_tokens": int(d.get("thought_tokens") or 0),
                    "user_chars": int(d.get("user_char_count") or 0),
                    "has_branching": bool(d.get("has_branching", False)),
                    "branch_count": int(d.get("branch_count") or 0),
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
            dur_min = round(dur_sec / 60.0, 2) if dur_sec is not None else None
            tot_tok = int(s.total_tokens)
            cum_tok = int(getattr(s, "cumulative_api_tokens", tot_tok))
            records.append(
                {
                    "file_id": s.file_id,
                    "date": date_str,
                    "turn_count": int(s.turn_count),
                    "duration_seconds": dur_sec,
                    "duration_minutes": dur_min,
                    "total_tokens": tot_tok,
                    "cumulative_tokens": cum_tok,
                    "thought_tokens": int(s.thought_tokens),
                    "user_chars": int(s.total_user_chars),
                    "has_branching": bool(s.has_branching),
                    "branch_count": int(s.branch_count),
                    "has_sys_instruction": bool(s.system_instruction),
                    "model": s.model,
                    "active_dates": None,
                    "modified_time": s.modified_time.isoformat()
                    if s.modified_time
                    else None,
                }
            )

    # 2. 对话轮次分位数 (纯 Python 原生聚合)
    turn_counts = [r["turn_count"] for r in records]
    sorted_turns = sorted(turn_counts)
    sum_turns = sum(turn_counts)
    deep_count = sum(1 for t in turn_counts if t >= 5)

    turn_stats = {
        "mean": round(sum_turns / total_sessions, 2),
        "median": round(_quantile(sorted_turns, 0.50), 1),
        "p75": round(_quantile(sorted_turns, 0.75), 1),
        "p90": round(_quantile(sorted_turns, 0.90), 1),
        "deep_count": deep_count,
        "deep_ratio": f"{round((deep_count / total_sessions) * 100, 1)}%",
    }

    # 3. 会话时长 (Duration) 分位数与长尾过滤 (>= 10秒为有效会话)
    valid_durs = [
        r["duration_minutes"]
        for r in records
        if r["duration_seconds"] is not None and r["duration_seconds"] >= 10
    ]
    if valid_durs:
        sorted_durs = sorted(valid_durs)
        dur_stats = {
            "mean": round(sum(sorted_durs) / len(sorted_durs), 1),
            "median": round(_quantile(sorted_durs, 0.50), 1),
            "p75": round(_quantile(sorted_durs, 0.75), 1),
            "p90": round(_quantile(sorted_durs, 0.90), 1),
            "max": round(sorted_durs[-1], 1),
            "valid_count": len(sorted_durs),
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

    # 多轮深入会话 (>= 2轮 且 >= 10秒) 时长统计
    multi_durs = [
        r["duration_minutes"]
        for r in records
        if r["turn_count"] >= 2
        and r["duration_seconds"] is not None
        and r["duration_seconds"] >= 10
    ]
    if multi_durs:
        sorted_m_durs = sorted(multi_durs)
        multi_dur_stats = {
            "mean": round(sum(sorted_m_durs) / len(sorted_m_durs), 1),
            "median": round(_quantile(sorted_m_durs, 0.50), 1),
            "p75": round(_quantile(sorted_m_durs, 0.75), 1),
            "p90": round(_quantile(sorted_m_durs, 0.90), 1),
        }
    else:
        multi_dur_stats = {"mean": 0.0, "median": 0.0, "p75": 0.0, "p90": 0.0}

    # 时长梯队切片
    all_valid_mins = [
        r["duration_minutes"] for r in records if r["duration_minutes"] is not None
    ]
    denom = len(all_valid_mins) if all_valid_mins else total_sessions

    tier_flash = sum(1 for m in all_valid_mins if m < 10)
    tier_focus = sum(1 for m in all_valid_mins if 10 <= m < 60)
    tier_deep = sum(1 for m in all_valid_mins if 60 <= m < 360)
    tier_epic = sum(1 for m in all_valid_mins if m >= 360)

    duration_tiers = {
        "flash": (tier_flash, f"{round(tier_flash / denom * 100, 1)}%"),
        "focus": (tier_focus, f"{round(tier_focus / denom * 100, 1)}%"),
        "deep": (tier_deep, f"{round(tier_deep / denom * 100, 1)}%"),
        "epic": (tier_epic, f"{round(tier_epic / denom * 100, 1)}%"),
    }

    # 4. Token 消耗分位数与累计推理算力
    tok_vals = [r["total_tokens"] for r in records]
    sorted_toks = sorted(tok_vals)
    total_tokens = sum(tok_vals)
    total_thought_tokens = sum(r["thought_tokens"] for r in records)
    total_cumulative_tokens = sum(r["cumulative_tokens"] for r in records)
    expansion_factor = (
        f"{round(total_cumulative_tokens / total_tokens, 2)}x"
        if total_tokens > 0
        else "1.0x"
    )

    tok_stats = {
        "total": total_tokens,
        "cumulative_total": total_cumulative_tokens,
        "expansion_factor": expansion_factor,
        "mean": round(total_tokens / total_sessions, 0),
        "median": round(_quantile(sorted_toks, 0.50), 0),
        "p75": round(_quantile(sorted_toks, 0.75), 0),
        "p90": round(_quantile(sorted_toks, 0.90), 0),
        "total_thought": total_thought_tokens,
        "thought_ratio": f"{round(total_thought_tokens / total_tokens * 100, 2)}%"
        if total_tokens > 0
        else "0%",
    }

    # 5. 思维摩擦力与分支
    branch_sessions = sum(1 for r in records if r["has_branching"])
    friction_stats = {
        "branch_sessions": branch_sessions,
        "branch_ratio": f"{round(branch_sessions / total_sessions * 100, 1)}%",
        "total_retries": sum(r["branch_count"] for r in records),
    }

    # 6. 模型偏好分布 (使用 Counter 替代 value_counts)
    model_dist = dict(Counter(r["model"] for r in records).most_common())

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
        # 使用哈希表替代 DataFrame.groupby('date')，保持 O(N) 极速升序聚合
        date_map = defaultdict(
            lambda: {
                "total_tokens": 0,
                "cumulative_tokens": 0,
                "thought_tokens": 0,
                "sessions": 0,
                "turns": 0,
            }
        )

        for r in records:
            d_str = r.get("date")
            if not d_str:
                continue
            entry = date_map[d_str]
            entry["total_tokens"] += r["total_tokens"]
            entry["cumulative_tokens"] += r["cumulative_tokens"]
            entry["thought_tokens"] += r["thought_tokens"]
            entry["sessions"] += 1
            entry["turns"] += r["turn_count"]

        sorted_dates = sorted(date_map.keys())
        for d_str in sorted_dates:
            item = date_map[d_str]
            daily_trends.append(
                {
                    "date": d_str,
                    "total_tokens": item["total_tokens"],
                    "cumulative_tokens": item["cumulative_tokens"],
                    "thought_tokens": item["thought_tokens"],
                    "sessions": item["sessions"],
                    "turns": item["turns"],
                }
            )

    return {
        "total_sessions": total_sessions,
        "total_turns": sum_turns,
        "total_user_chars": sum(r["user_chars"] for r in records),
        "turn_stats": turn_stats,
        "dur_stats": dur_stats,
        "multi_dur_stats": multi_dur_stats,
        "duration_tiers": duration_tiers,
        "tok_stats": tok_stats,
        "friction_stats": friction_stats,
        "sys_instruction_count": sum(1 for r in records if r["has_sys_instruction"]),
        "model_distribution": model_dist,
        "daily_trends": daily_trends,
        "trend_granularity": "hour" if is_single_day else "day",
        "single_date": single_date if is_single_day else None,
    }
