收到，我们立即开始在 `ai-studio-analyzer` 中实施 `/api/daily/timeline` 的跨日会话解析与耗时均分支持。

## [WIP] feat(server): 支持会话跨日多日记映射与心智耗时均分

### 用户需求
针对长线会话跨越多个自然日的情况，提取 `chunkedPrompt.chunks` 中真实的 `createTime` 集合，使同一个会话能够在它活跃的所有历史日记中均被正确引用与溯源；对于总持续耗时，将其平均分摊到所涉及的跨天天数中。

### 评论
这是一个关键的体验升级。它打破了以往单纯依赖 `modified_time` 单一时间戳导致的前序活跃日“溯源盲区”，使得多天持续推进的大型任务能够在每一天的日记中均有迹可循，同时均分耗时避免了单日时间过度膨胀。

### 目标
1. 修改 `src/server/api.py` 中的 `get_daily_timeline` 路由函数。
2. 在遍历会话索引时，按需读取原始 chunk 的 `createTime` 并转换为本地日期集合。
3. 对涉及多日的会话，计算平均分摊耗时 `total_duration / days_count`，并生成带有 `(跨N天均分)` 的可读标签。
4. 将该会话分别挂载至所涉及日期的 timeline 桶内。

### 基本原理
通过在生成时间线时检查原始 chunk 的创建时间戳，构建 `日期 -> 当日最新时刻` 的映射。如果会话只在一天内完成，则保持原本行为；如果跨越多个自然日，则将该条目派发到对应的每一天，并按天数等分分配总时长秒数与总 token 消耗量，确保日记端 `link-ai` 查询任意活跃日期时都能准确拉取。

### 标签
#intent/build #flow/ready #priority/high #comp/runtime #concept/api #scope/api #ai/instruct #task/domain/analyzer #task/object/daily-timeline #task/action/cross-day-split #task/state/begin #task/status/active

---

### Script

#### Acts 1: 升级 `get_daily_timeline` 支持跨日检测与均分

我们将修改 `src/server/api.py` 中的 `get_daily_timeline` 实现，使其支持读取 chunk 跨日并均分派发。

~~~~~act
check_cwd_match
/home/doucx/Documents/Projects/ai-studio-analyzer
~~~~~

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~python.old
@router.get("/daily/timeline")
def get_daily_timeline(days: Optional[int] = None):
    """
    按本地日历日期聚合返回所有会话的每日时间线 (一次性拉取，规避 N+1 轮询)。
    """
    indices = cache.query_indices()
    local_tz = datetime.now().astimezone().tzinfo

    timeline: dict[str, dict] = {}

    for idx in indices:
        mtime_str = idx["modified_time"] or idx["created_time"]
        if not mtime_str:
            continue
        try:
            dt_utc = datetime.fromisoformat(mtime_str.replace("Z", "+00:00"))
            dt_local = dt_utc.astimezone(local_tz)
            date_key = dt_local.strftime("%Y-%m-%d")
        except Exception:
            continue

        if date_key not in timeline:
            timeline[date_key] = {
                "date": date_key,
                "total_duration_seconds": 0.0,
                "total_tokens": 0,
                "thought_tokens": 0,
                "session_count": 0,
                "sessions": [],
            }

        dur_sec = idx.get("duration_seconds") or 0.0
        timeline[date_key]["total_duration_seconds"] += dur_sec
        timeline[date_key]["total_tokens"] += idx.get("total_tokens", 0)
        timeline[date_key]["thought_tokens"] += idx.get("thought_tokens", 0)
        timeline[date_key]["session_count"] += 1

        timeline[date_key]["sessions"].append(
            {
                "file_id": idx["file_id"],
                "name": idx["name"],
                "model": idx["model"].replace("models/", ""),
                "duration": idx["duration_human"],
                "duration_seconds": idx.get("duration_seconds"),
                "tokens": idx.get("total_tokens", 0),
                "thought_tokens": idx.get("thought_tokens", 0),
                "first_prompt": idx.get("first_prompt") or "",
                "time_local": dt_local.strftime("%H:%M"),
            }
        )

    sorted_dates = sorted(timeline.keys(), reverse=True)
    if days and days > 0:
        sorted_dates = sorted_dates[:days]

    result = {}
    for d in sorted_dates:
        item = timeline[d]
        item["total_duration_human"] = _format_seconds_human(
            item["total_duration_seconds"]
        )
        item["sessions"].sort(key=lambda s: s.get("time_local", ""), reverse=True)
        result[d] = item

    return {"date_timeline": result}
~~~~~
~~~~~python.new
@router.get("/daily/timeline")
def get_daily_timeline(days: Optional[int] = None):
    """
    按本地日历日期聚合返回所有会话的每日时间线 (一次性拉取，规避 N+1 轮询)。
    若会话包含跨多个自然日的交互 Chunk，自动派发到每一天的记录中，并将总耗时平均分摊。
    """
    indices = cache.query_indices()
    local_tz = datetime.now().astimezone().tzinfo

    timeline: dict[str, dict] = {}

    for idx in indices:
        file_id = idx["file_id"]

        # 1. 尝试从原始缓存中提取该会话所有 chunk 发生的时间戳与落入的本地日期
        date_time_map: dict[str, str] = {}
        raw_data = cache.get(file_id)
        if raw_data and "chunkedPrompt" in raw_data:
            chunks = raw_data.get("chunkedPrompt", {}).get("chunks", [])
            for c in chunks:
                if "createTime" in c:
                    try:
                        c_dt = datetime.fromisoformat(
                            c["createTime"].replace("Z", "+00:00")
                        ).astimezone(local_tz)
                        d_str = c_dt.strftime("%Y-%m-%d")
                        t_str = c_dt.strftime("%H:%M")
                        # 保留当天交互的最晚时间
                        if d_str not in date_time_map or t_str > date_time_map[d_str]:
                            date_time_map[d_str] = t_str
                    except Exception:
                        pass

        # 兜底：若 chunk 中无时间戳，回退使用 modified_time / created_time
        if not date_time_map:
            mtime_str = idx["modified_time"] or idx["created_time"]
            if mtime_str:
                try:
                    dt_utc = datetime.fromisoformat(mtime_str.replace("Z", "+00:00"))
                    dt_local = dt_utc.astimezone(local_tz)
                    date_time_map[dt_local.strftime("%Y-%m-%d")] = dt_local.strftime("%H:%M")
                except Exception:
                    pass

        if not date_time_map:
            continue

        # 2. 均分耗时与消耗
        total_dur_sec = idx.get("duration_seconds") or 0.0
        days_count = max(1, len(date_time_map))
        split_dur_sec = total_dur_sec / days_count

        dur_label = _format_seconds_human(split_dur_sec)
        if days_count > 1:
            dur_label = f"{dur_label} (跨{days_count}天均分)"

        total_tok = idx.get("total_tokens", 0)
        thought_tok = idx.get("thought_tokens", 0)

        # 3. 分发到各天的 timeline
        for date_key, time_local in date_time_map.items():
            if date_key not in timeline:
                timeline[date_key] = {
                    "date": date_key,
                    "total_duration_seconds": 0.0,
                    "total_tokens": 0,
                    "thought_tokens": 0,
                    "session_count": 0,
                    "sessions": [],
                }

            timeline[date_key]["total_duration_seconds"] += split_dur_sec
            timeline[date_key]["total_tokens"] += total_tok // days_count
            timeline[date_key]["thought_tokens"] += thought_tok // days_count
            timeline[date_key]["session_count"] += 1

            timeline[date_key]["sessions"].append(
                {
                    "file_id": file_id,
                    "name": idx["name"],
                    "model": idx["model"].replace("models/", ""),
                    "duration": dur_label,
                    "duration_seconds": split_dur_sec,
                    "tokens": total_tok,
                    "thought_tokens": thought_tok,
                    "first_prompt": idx.get("first_prompt") or "",
                    "time_local": time_local,
                    "cross_days": days_count,
                }
            )

    sorted_dates = sorted(timeline.keys(), reverse=True)
    if days and days > 0:
        sorted_dates = sorted_dates[:days]

    result = {}
    for d in sorted_dates:
        item = timeline[d]
        item["total_duration_human"] = _format_seconds_human(
            item["total_duration_seconds"]
        )
        item["sessions"].sort(key=lambda s: s.get("time_local", ""), reverse=True)
        result[d] = item

    return {"date_timeline": result}
~~~~~

---

### 下一步建议
1. 执行本计划以完成 `ai-studio-analyzer` 的跨日均分与多天时间线映射。
2. 随后转向 `neuron` 仓库，实施 `auto_links.py`（卡片表格化、精准字数、时间呈现与去 Emoji）及 `link_ai.py`（彻底去除 Emoji 保持纯净）。
