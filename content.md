我已经彻底定位了生命周期时长出现“0s 假死”与“沉睡闲置时间无界累计（高达 74 天）”的病因，并设计了交互式有效心智活跃时长（Active Engagement Time）估算与状态机方案。

现在为您生成完整的执行计划：

## [WIP] fix: 重构会话生命周期时长推导状态机消除 0s 假死与沉睡累加

### 错误分析

1. **Chunk 时间戳缺失退化为 0s**：
   Google AI Studio 导出的会话中，许多内部 `chunk` 没有带细粒度 `createTime` 时间戳。原算法退化为 `modified_time - created_time`；对于批量同步、转存或克隆的文件，两个时间戳完全一致（差值为 0），被粗暴认定为 `0s`。这导致分位数统计严重失真，P50 持续时长沦为 `0.0 分钟`，甚至交互 123 轮的高频会话也显示为 `0s`。
2. **闲置沉睡时间无界累计**：
   若会话跨越数周或数月后仅被再次打开或保存一次，算法机械计算其起始与结束时间差，将中间数星期的空闲搁置无差别累加，导致最大时长被膨胀至 `106,810 分钟`（74 天）。
3. **统计口径污染**：
   指标聚合引擎未对无效/未知时间戳进行有效性校验（NaN/None 过滤），让伪 0s 记录充斥分位数与时长梯队。

### 用户需求

1. 重构时长推导状态机（`src/analyzer/models.py`）：
   - 当 chunks 均缺失有效时间戳且 `modified_time == created_time`（或文件时间差 < 1s）时，明确标记时长为 `None` / `未知`，拒绝粗暴输出 `0s`。
   - 引入有效心智活跃时长（Active Engagement Time）状态机：
     - 当存在多个有效时间戳时，若相邻轮次间隔超过 30 分钟，自动截断为空闲（Idle），仅累计有效交互与合理心智推进窗口。
     - 若时间戳缺失或文件跨度远超合理区间，依据 `(Token 消耗量 + 字符数 + 块数)` 建立基线心智时长估算模型（Baseline Cognitive Duration Estimation）。
2. 同步适配 SQLite 索引表、指标聚合引擎、数据导出器及前端展示卡片。

### 评论

这是一个极其关键的算法修复。会话生命周期与心智时长是衡量用户在 AI 协作中思考阻抗与投入深度的核心维度。修复该问题后，P50/P75 将真实反映用户与模型交互的活跃时间，同时彻底剔除长尾沉睡假死数据。

### 目标

1. 在 `src/analyzer/models.py` 中重构 `duration`、`duration_seconds` 与 `duration_human`，引入 `estimated_engagement_seconds` 估算模型和 30 分钟空闲截断状态机。
2. 更新 `src/analyzer/cache.py`，允许 `session_index` 表中 `duration_seconds` 为 NULL，并在重建索引时彻底清理旧约束。
3. 更新 `src/analyzer/metrics.py`，确保时长分位数与时长梯队仅统计有效活跃时长（$\ge 10$ 秒且非空），杜绝无效样本干扰。
4. 更新 `src/analyzer/exporter.py` 与 `inspect_health.py`，适配 `duration_seconds` 为空的情况。
5. 更新前端 `metrics.ts` 类型定义与 `SessionDetailPanel.tsx`、`SessionsRoute.tsx` 详情渲染，优雅展示“未知”状态。

### 基本原理

通过“多轮时间戳连续性检验 + 30 分钟空闲截断 + 缺失时间戳基线估算 + 导入同时间戳标记为未知”的四级分流状态机：
1. **多时间戳场景**：将轮次时间戳排序，相邻间隔 $\le 30$ 分钟计入真实跨度；$> 30$ 分钟则断定为异步沉睡，截断为空闲并仅计入该轮次推进的合理思考/阅读心智窗口。
2. **缺失时间戳场景**：若文件修改时间与创建时间几乎相等，断定无法测定真实交互过程，标记为 `None`（前端展示“未知”），不在指标中充当 0s。
3. **沉睡长线会话**：若文件跨度高达几十天但缺少细粒度时间戳，采信基于用户输入字符（5 字符/秒）、模型 Token 阅读（8 tokens/秒）和块数基线的有效心智估算时长，消除 74 天的无界伪时长。

### 标签

#intent/fix #flow/ready #priority/critical #comp/engine #concept/state #scope/core #ai/refine #task/domain/analytics #task/object/session-duration-algorithm #task/action/bug-fix #task/state/begin

---

### Script

#### Acts 1: 重构 `src/analyzer/models.py` 中的时长推导状态机

在 `PromptSession` 类中引入基线心智时长估算模型 `estimated_engagement_seconds`，并重构 `duration`、`duration_seconds` 与 `duration_human` 的推导逻辑。

~~~~~act
patch_file
src/analyzer/models.py
~~~~~
~~~~~python.old
    @property
    def duration(self) -> Optional[timedelta]:
        """会话生命周期持续时间 (从首轮交互到最后修改/回复)"""
        start = self.start_time
        end = self.end_time
        if start and end:
            delta = end - start
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
~~~~~
~~~~~python.new
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
                    c_chars = len(curr_turn.text) if curr_turn and curr_turn.role == "user" else 0
                    c_tok = curr_turn.token_count if curr_turn else 0
                    active_sec += max(15.0, min(300.0, 15.0 + c_chars / 5.0 + c_tok / 8.0))

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
~~~~~

#### Acts 2: 调整 `src/analyzer/cache.py` 中 `duration_seconds` 的 NULL 约束与重建重置

使 `session_index` 表结构允许 `duration_seconds` 存放 NULL，并在 `clear_indices` 中完整 drop 表以实现平滑重构。

~~~~~act
patch_file
src/analyzer/cache.py
~~~~~
~~~~~python.old
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS session_index (
                    file_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    model TEXT NOT NULL,
                    turn_count INTEGER NOT NULL,
                    total_tokens INTEGER NOT NULL,
                    thought_tokens INTEGER NOT NULL,
                    user_char_count INTEGER NOT NULL,
                    duration_seconds REAL NOT NULL,
                    duration_human TEXT NOT NULL,
                    has_branching INTEGER NOT NULL,
                    branch_count INTEGER NOT NULL,
                    has_sys_instruction INTEGER NOT NULL,
                    first_prompt TEXT,
                    created_time TEXT,
                    modified_time TEXT,
                    date TEXT
                );
            """)
~~~~~
~~~~~python.new
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS session_index (
                    file_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    model TEXT NOT NULL,
                    turn_count INTEGER NOT NULL,
                    total_tokens INTEGER NOT NULL,
                    thought_tokens INTEGER NOT NULL,
                    user_char_count INTEGER NOT NULL,
                    duration_seconds REAL,
                    duration_human TEXT NOT NULL,
                    has_branching INTEGER NOT NULL,
                    branch_count INTEGER NOT NULL,
                    has_sys_instruction INTEGER NOT NULL,
                    first_prompt TEXT,
                    created_time TEXT,
                    modified_time TEXT,
                    date TEXT
                );
            """)
~~~~~

~~~~~act
patch_file
src/analyzer/cache.py
~~~~~
~~~~~python.old
    def clear_indices(self):
        """清空二级索引与 FTS 虚表并重新初始化结构（重建前调用）"""
        with self._get_connection() as conn:
            conn.execute("DROP TABLE IF EXISTS session_fts;")
            conn.execute("DELETE FROM session_index;")
            conn.commit()
        self._init_db()
~~~~~
~~~~~python.new
    def clear_indices(self):
        """清空二级索引与 FTS 虚表并重新初始化结构（重建前调用）"""
        with self._get_connection() as conn:
            conn.execute("DROP TABLE IF EXISTS session_fts;")
            conn.execute("DROP TABLE IF EXISTS session_index;")
            conn.commit()
        self._init_db()
~~~~~

#### Acts 3: 调整 `src/analyzer/metrics.py` 指标聚合引擎

在指标计算中处理 `duration_seconds` 为 `None` 的场景，确保有效时长与梯队切片只基于具有真实时长的样本进行统计。

~~~~~act
patch_file
src/analyzer/metrics.py
~~~~~
~~~~~python.old
    if isinstance(first_item, dict):
        for d in sessions:
            dur_sec = d.get("duration_seconds", 0.0)
            records.append(
                {
                    "file_id": d["file_id"],
                    "date": d.get("date"),
                    "turn_count": d.get("turn_count", 0),
                    "duration_seconds": dur_sec,
                    "duration_minutes": round(dur_sec / 60, 2),
                    "total_tokens": d.get("total_tokens", 0),
                    "thought_tokens": d.get("thought_tokens", 0),
                    "user_chars": d.get("user_char_count", 0),
                    "has_branching": bool(d.get("has_branching", False)),
                    "branch_count": d.get("branch_count", 0),
                    "has_sys_instruction": bool(d.get("has_sys_instruction", False)),
                    "model": d.get("model", "unknown"),
                }
            )
    else:
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
~~~~~
~~~~~python.new
    if isinstance(first_item, dict):
        for d in sessions:
            dur_sec = d.get("duration_seconds")
            dur_min = round(dur_sec / 60, 2) if dur_sec is not None else None
            records.append(
                {
                    "file_id": d["file_id"],
                    "date": d.get("date"),
                    "turn_count": d.get("turn_count", 0),
                    "duration_seconds": dur_sec,
                    "duration_minutes": dur_min,
                    "total_tokens": d.get("total_tokens", 0),
                    "thought_tokens": d.get("thought_tokens", 0),
                    "user_chars": d.get("user_char_count", 0),
                    "has_branching": bool(d.get("has_branching", False)),
                    "branch_count": d.get("branch_count", 0),
                    "has_sys_instruction": bool(d.get("has_sys_instruction", False)),
                    "model": d.get("model", "unknown"),
                }
            )
    else:
        for s in sessions:
            st = s.start_time or s.modified_time
            date_str = st.strftime("%Y-%m-%d") if st else None
            dur_sec = s.duration_seconds
            dur_min = round(dur_sec / 60, 2) if dur_sec is not None else None
            records.append(
                {
                    "file_id": s.file_id,
                    "date": date_str,
                    "turn_count": s.turn_count,
                    "duration_seconds": dur_sec,
                    "duration_minutes": dur_min,
                    "total_tokens": s.total_tokens,
                    "thought_tokens": s.thought_tokens,
                    "user_chars": s.total_user_chars,
                    "has_branching": s.has_branching,
                    "branch_count": s.branch_count,
                    "has_sys_instruction": bool(s.system_instruction),
                    "model": s.model,
                }
            )
~~~~~

~~~~~act
patch_file
src/analyzer/metrics.py
~~~~~
~~~~~python.old
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
~~~~~
~~~~~python.new
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
        ((valid_dur_df["duration_minutes"] >= 10) & (valid_dur_df["duration_minutes"] < 60)).sum()
    )  # 聚焦推进 (10~60m)
    tier_deep = int(
        ((valid_dur_df["duration_minutes"] >= 60) & (valid_dur_df["duration_minutes"] < 360)).sum()
    )  # 深度攻坚 (1~6h)
    tier_epic = int((valid_dur_df["duration_minutes"] >= 360).sum())  # 跨日长线 (>6h)

    duration_tiers = {
        "flash": (tier_flash, f"{round(tier_flash / denom * 100, 1)}%"),
        "focus": (tier_focus, f"{round(tier_focus / denom * 100, 1)}%"),
        "deep": (tier_deep, f"{round(tier_deep / denom * 100, 1)}%"),
        "epic": (tier_epic, f"{round(tier_epic / denom * 100, 1)}%"),
    }
~~~~~

#### Acts 4: 更新 `src/analyzer/exporter.py` 与 `inspect_health.py` 探针适配

确保 CSV 导出与健康度诊断探针能够正确识别 None 并在诊断报告中输出纯净的分位数阶梯。

~~~~~act
patch_file
src/analyzer/exporter.py
~~~~~
~~~~~python.old
            writer.writerow(
                {
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
                    "first_prompt_preview": preview,
                }
            )
~~~~~
~~~~~python.new
            writer.writerow(
                {
                    "file_id": s.file_id,
                    "title": s.name,
                    "model": s.model,
                    "turn_count": s.turn_count,
                    "duration_human": s.duration_human,
                    "duration_seconds": s.duration_seconds
                    if s.duration_seconds is not None
                    else "",
                    "total_tokens": s.total_tokens,
                    "thought_tokens": s.thought_tokens,
                    "has_branching": s.has_branching,
                    "branch_count": s.branch_count,
                    "user_char_count": s.total_user_chars,
                    "first_prompt_preview": preview,
                }
            )
~~~~~

~~~~~act
patch_file
inspect_health.py
~~~~~
~~~~~python.old
    cursor.execute("""
        SELECT 
            turn_count, 
            total_tokens, 
            thought_tokens, 
            duration_seconds / 60.0 AS duration_min,
            user_char_count,
            has_branching,
            branch_count,
            model
        FROM session_index;
    """)
    rows = cursor.fetchall()

    turn_counts = [r["turn_count"] for r in rows]
    total_tokens = [r["total_tokens"] for r in rows]
    thought_tokens = [r["thought_tokens"] for r in rows]
    durations = [r["duration_min"] for r in rows]
    user_chars = [r["user_char_count"] for r in rows]
~~~~~
~~~~~python.new
    cursor.execute("""
        SELECT 
            turn_count, 
            total_tokens, 
            thought_tokens, 
            CASE 
                WHEN duration_seconds IS NOT NULL THEN duration_seconds / 60.0 
                ELSE NULL 
            END AS duration_min,
            user_char_count,
            has_branching,
            branch_count,
            model
        FROM session_index;
    """)
    rows = cursor.fetchall()

    turn_counts = [r["turn_count"] for r in rows]
    total_tokens = [r["total_tokens"] for r in rows]
    thought_tokens = [r["thought_tokens"] for r in rows]
    durations = [
        r["duration_min"]
        for r in rows
        if r["duration_min"] is not None and r["duration_min"] > 0
    ]
    user_chars = [r["user_char_count"] for r in rows]
~~~~~

#### Acts 5: 前端类型与详情卡片适配

更新前端类型定义 `duration_seconds: number | null`，并在 `SessionDetailPanel.tsx` 与 `SessionsRoute.tsx` 中优雅展示。

~~~~~act
patch_file
frontend/src/types/metrics.ts
~~~~~
~~~~~typescript.old
export interface SessionItem {
  file_id: string;
  name: string;
  model: string;
  turn_count: number;
  chunk_count?: number;
  total_tokens: number;
  thought_tokens: number;
  duration_human: string;
  duration_seconds: number;
  has_branching: boolean;
  branch_count: number;
  first_prompt: string;
  modified_time: string | null;
  created_time: string | null;
  snippet?: string;
}
~~~~~
~~~~~typescript.new
export interface SessionItem {
  file_id: string;
  name: string;
  model: string;
  turn_count: number;
  chunk_count?: number;
  total_tokens: number;
  thought_tokens: number;
  duration_human: string;
  duration_seconds: number | null;
  has_branching: boolean;
  branch_count: number;
  first_prompt: string;
  modified_time: string | null;
  created_time: string | null;
  snippet?: string;
}
~~~~~

~~~~~act
patch_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~typescript.old
          <div className="bg-zinc-900/80 border border-zinc-800/60 rounded p-2.5">
            <div className="text-[10px] text-zinc-400">生命周期时长</div>
            <div className="text-base font-bold text-indigo-400 font-mono mt-0.5">
              {session.duration_human}
            </div>
            <div className="text-[10px] text-zinc-500">{session.duration_seconds} 秒</div>
          </div>
~~~~~
~~~~~typescript.new
          <div className="bg-zinc-900/80 border border-zinc-800/60 rounded p-2.5">
            <div className="text-[10px] text-zinc-400">生命周期时长</div>
            <div className="text-base font-bold text-indigo-400 font-mono mt-0.5">
              {session.duration_human}
            </div>
            <div className="text-[10px] text-zinc-500">
              {session.duration_seconds !== null && session.duration_seconds !== undefined
                ? `${session.duration_seconds} 秒`
                : '持续时间未记录'}
            </div>
          </div>
~~~~~

~~~~~act
patch_file
frontend/src/routes/SessionsRoute.tsx
~~~~~
~~~~~typescript.old
    return {
      file_id: selectedId,
      name: '加载会话中...',
      model: 'unknown',
      turn_count: 0,
      total_tokens: 0,
      thought_tokens: 0,
      duration_human: '',
      duration_seconds: 0,
      has_branching: false,
      branch_count: 0,
      first_prompt: '',
      modified_time: null,
      created_time: null,
    };
~~~~~
~~~~~typescript.new
    return {
      file_id: selectedId,
      name: '加载会话中...',
      model: 'unknown',
      turn_count: 0,
      total_tokens: 0,
      thought_tokens: 0,
      duration_human: '未知',
      duration_seconds: null,
      has_branching: false,
      branch_count: 0,
      first_prompt: '',
      modified_time: null,
      created_time: null,
    };
~~~~~

### 下一步建议

1. **执行离线索引全量重建**：
   运行 `python reindex_cli.py`，根据新的状态机逻辑重新解析 `file_cache` 并更新 `session_index` 表，彻底修复历史数据库中的时长字段。
2. **运行健康度探针验证**：
   运行 `python inspect_health.py`，检查 P50、P75 与 Max 的时长指标阶梯是否已恢复真实健康的分钟级数值，验证 `0.0 分钟` 与 `74 天` 异常是否已被彻底消除。
3. **前端编译检查**：
   在 `frontend` 目录下运行 `pnpm run check` 验证 TypeScript 类型与格式规范。
