我们现在开始实施“真实推理 API 累积消耗模型 (Cumulative API Usage)”的双轨算力对照改造。

## [WIP] feat: 引入真实推理 API 累积消耗 (Cumulative Usage) 双轨模型

### 用户需求
1. 在后端 `PromptSession` 模型中实现大模型多轮调用的算力累积算法，准确还原“每次向模型提问都会把历史上下文全量作为输入重新发送”的真实 API 算力/计费消耗。
2. 在数据库索引（`session_index`）、度量聚合引擎（`metrics.py`）以及前端接口中打通 `cumulative_tokens` 数据链路。
3. 在前端全景大盘、会话详情面板和趋势图表中实现“静态上下文资产规模 (Footprint)”与“累计推理消耗 (Cumulative Usage)”的双轨对照。

### 评论
这是一次重要的认知审计精度演进。通过将 O(N) 静态文本规模与 O(N²) 滚动累积消耗解耦，用户可以清晰洞察会话中的“上下文膨胀系数”，直观评估长多轮交互对 Google API 配额与算力开销的真实影响。

### 目标
1. **模型层 (`models.py`)**：在 `PromptSession` 中新增 `cumulative_api_tokens` 计算属性，考虑多轮对话与思考链的响应分组。
2. **持久层 (`cache.py`)**：为 `session_index` 表无损平滑迁移新增 `cumulative_tokens` 列，并在索引写入时同步物化。
3. **指标层 (`metrics.py` & `server/api.py`)**：在聚合统计与时序趋势中计算 `cumulative_total`、放大倍率 `expansion_factor` 及每日累积能耗。
4. **呈现层 (前端 UI)**：更新类型定义、全景大盘指标卡片、时序趋势图以及会话详情面板。

### 基本原理
1. **响应边界划分算法**：遍历对话轮次序列，将连续的 `model` 块（思考链 + 回复文本）合并视为单次 API 请求的生成载荷（Output），此前沉淀的所有前置 Chunk 之和作为本次请求的输入载荷（Input）。
2. **非破坏性架构**：数据库使用 `ALTER TABLE ADD COLUMN IF NOT EXISTS`（通过捕获 `OperationalError` 安全兜底），现有缓存不需全量清除即可自动兼容。

### 标签
#intent/build #flow/ready #priority/high #comp/engine #comp/ui #concept/state #scope/core #scope/ux #ai/instruct #task/domain/metrics #task/object/cumulative-tokens-model #task/action/implementation #task/state/continue #task/status/active

---

### Script

#### Acts 1: 在 `models.py` 中推导真实 API 累积消耗

在 `PromptSession` 中增加 `cumulative_api_tokens` 属性。

~~~~~act
patch_file
src/analyzer/models.py
~~~~~
~~~~~python.old
    @property
    def total_tokens(self) -> int:
        """该会话消耗的 Token 总量"""
        return sum(t.token_count for t in self.turns)

    @property
    def user_tokens(self) -> int:
~~~~~
~~~~~python.new
    @property
    def total_tokens(self) -> int:
        """该会话消耗的 Token 总量 (静态上下文资产规模)"""
        return sum(t.token_count for t in self.turns)

    @property
    def cumulative_api_tokens(self) -> int:
        """
        推导实际与 API 交互时的累计算力/计费 Token 消耗量 (Cumulative API Usage):
        每一次模型回复，都会将此前沉淀的历史上下文全量作为输入发送给 API。
        对于单轮会话，累计消耗 == 上下文净规模 (total_tokens)；
        对于多轮会话，累计消耗会随上下文滚动呈二次方累积增长。
        """
        if not self.turns:
            return 0

        total_api_tokens = 0
        prefix_tokens = 0
        in_model_response = False

        for t in self.turns:
            if t.role == "model":
                if not in_model_response:
                    # 刚进入模型回复阶段，历史的所有前置上下文作为本次调用的 Prompt 输入
                    total_api_tokens += prefix_tokens
                    in_model_response = True
                # 输出生成的 tokens
                total_api_tokens += t.token_count
                prefix_tokens += t.token_count
            else:
                # user 或 system 等输入
                in_model_response = False
                prefix_tokens += t.token_count

        return max(total_api_tokens, self.total_tokens)

    @property
    def user_tokens(self) -> int:
~~~~~

#### Acts 2: 扩展 `cache.py` 索引表以持久化累积算力

在 `session_index` 中添加 `cumulative_tokens` 字段，并在 `upsert_session_index` 时物化存储。

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
                    duration_seconds REAL,
                    duration_human TEXT NOT NULL,
                    has_branching INTEGER NOT NULL,
                    branch_count INTEGER NOT NULL,
                    has_sys_instruction INTEGER NOT NULL,
                    first_prompt TEXT,
                    created_time TEXT,
                    modified_time TEXT,
                    date TEXT,
                    active_dates TEXT
                );
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_sidx_mtime 
                ON session_index(modified_time DESC);
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
                    date TEXT,
                    active_dates TEXT,
                    cumulative_tokens INTEGER DEFAULT 0
                );
            """)
            # 增量字段平滑迁移
            try:
                cursor.execute(
                    "ALTER TABLE session_index ADD COLUMN cumulative_tokens INTEGER DEFAULT 0;"
                )
            except sqlite3.OperationalError:
                pass
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_sidx_mtime 
                ON session_index(modified_time DESC);
            """)
~~~~~

~~~~~act
patch_file
src/analyzer/cache.py
~~~~~
~~~~~python.old
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO session_index (
                    file_id, name, model, turn_count, total_tokens, thought_tokens,
                    user_char_count, duration_seconds, duration_human, has_branching,
                    branch_count, has_sys_instruction, first_prompt, created_time,
                    modified_time, date, active_dates
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(file_id) DO UPDATE SET
                    name = excluded.name,
                    model = excluded.model,
                    turn_count = excluded.turn_count,
                    total_tokens = excluded.total_tokens,
                    thought_tokens = excluded.thought_tokens,
                    user_char_count = excluded.user_char_count,
                    duration_seconds = excluded.duration_seconds,
                    duration_human = excluded.duration_human,
                    has_branching = excluded.has_branching,
                    branch_count = excluded.branch_count,
                    has_sys_instruction = excluded.has_sys_instruction,
                    first_prompt = excluded.first_prompt,
                    created_time = excluded.created_time,
                    modified_time = excluded.modified_time,
                    date = excluded.date,
                    active_dates = excluded.active_dates;
            """,
                (
                    s.file_id,
                    s.name,
                    s.model,
                    s.turn_count,
                    s.total_tokens,
                    s.thought_tokens,
                    s.total_user_chars,
                    s.duration_seconds,
                    s.duration_human,
                    1 if s.has_branching else 0,
                    s.branch_count,
                    1 if s.system_instruction else 0,
                    first_prompt,
                    c_time,
                    m_time,
                    date_str,
                    active_dates_json,
                ),
            )
            conn.commit()
~~~~~
~~~~~python.new
        cum_tokens = getattr(s, "cumulative_api_tokens", s.total_tokens)
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO session_index (
                    file_id, name, model, turn_count, total_tokens, thought_tokens,
                    user_char_count, duration_seconds, duration_human, has_branching,
                    branch_count, has_sys_instruction, first_prompt, created_time,
                    modified_time, date, active_dates, cumulative_tokens
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(file_id) DO UPDATE SET
                    name = excluded.name,
                    model = excluded.model,
                    turn_count = excluded.turn_count,
                    total_tokens = excluded.total_tokens,
                    thought_tokens = excluded.thought_tokens,
                    user_char_count = excluded.user_char_count,
                    duration_seconds = excluded.duration_seconds,
                    duration_human = excluded.duration_human,
                    has_branching = excluded.has_branching,
                    branch_count = excluded.branch_count,
                    has_sys_instruction = excluded.has_sys_instruction,
                    first_prompt = excluded.first_prompt,
                    created_time = excluded.created_time,
                    modified_time = excluded.modified_time,
                    date = excluded.date,
                    active_dates = excluded.active_dates,
                    cumulative_tokens = excluded.cumulative_tokens;
            """,
                (
                    s.file_id,
                    s.name,
                    s.model,
                    s.turn_count,
                    s.total_tokens,
                    s.thought_tokens,
                    s.total_user_chars,
                    s.duration_seconds,
                    s.duration_human,
                    1 if s.has_branching else 0,
                    s.branch_count,
                    1 if s.system_instruction else 0,
                    first_prompt,
                    c_time,
                    m_time,
                    date_str,
                    active_dates_json,
                    cum_tokens,
                ),
            )
            conn.commit()
~~~~~

#### Acts 3: 在 `metrics.py` 中增加累积消耗与膨胀倍率统计

在全量指标计算引擎中增加对 `cumulative_tokens` 的提取与聚合。

~~~~~act
patch_file
src/analyzer/metrics.py
~~~~~
~~~~~python.old
    first_item = sessions[0]
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
~~~~~python.new
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
~~~~~

~~~~~act
patch_file
src/analyzer/metrics.py
~~~~~
~~~~~python.old
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
~~~~~
~~~~~python.new
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
~~~~~

~~~~~act
patch_file
src/analyzer/metrics.py
~~~~~
~~~~~python.old
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
~~~~~
~~~~~python.new
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
~~~~~

#### Acts 4: 在 `server/api.py` 中输出 `cumulative_tokens`

在会话列表与详情接口中透出 `cumulative_tokens`。

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~python.old
            "turn_count": idx["turn_count"],
            "chunk_count": idx["turn_count"],
            "total_tokens": idx["total_tokens"],
            "thought_tokens": idx["thought_tokens"],
            "duration_human": idx["duration_human"],
~~~~~
~~~~~python.new
            "turn_count": idx["turn_count"],
            "chunk_count": idx["turn_count"],
            "total_tokens": idx["total_tokens"],
            "cumulative_tokens": idx.get("cumulative_tokens") or idx["total_tokens"],
            "thought_tokens": idx["thought_tokens"],
            "duration_human": idx["duration_human"],
~~~~~

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~python.old
        "total_tokens": target.total_tokens,
        "thought_tokens": target.thought_tokens,
        "total_user_chars": target.total_user_chars,
~~~~~
~~~~~python.new
        "total_tokens": target.total_tokens,
        "cumulative_tokens": target.cumulative_api_tokens,
        "thought_tokens": target.thought_tokens,
        "total_user_chars": target.total_user_chars,
~~~~~

#### Acts 5: 更新前端类型声明与指标卡片展示

在前端类型 `metrics.ts` 中声明字段，并在 `OverviewDashboard.tsx` 与 `SessionDetailPanel.tsx` 中呈现双轨指标。

~~~~~act
patch_file
frontend/src/types/metrics.ts
~~~~~
~~~~~typescript.old
export interface TokStats {
  total: number;
  mean: number;
  median: number;
  p75: number;
  p90: number;
  total_thought: number;
  thought_ratio: string;
}
~~~~~
~~~~~typescript.new
export interface TokStats {
  total: number;
  cumulative_total?: number;
  expansion_factor?: string;
  mean: number;
  median: number;
  p75: number;
  p90: number;
  total_thought: number;
  thought_ratio: string;
}
~~~~~

~~~~~act
patch_file
frontend/src/types/metrics.ts
~~~~~
~~~~~typescript.old
export interface DailyTrendItem {
  date: string;
  total_tokens: number;
  thought_tokens: number;
  sessions: number;
  turns: number;
}
~~~~~
~~~~~typescript.new
export interface DailyTrendItem {
  date: string;
  total_tokens: number;
  cumulative_tokens?: number;
  thought_tokens: number;
  sessions: number;
  turns: number;
}
~~~~~

~~~~~act
patch_file
frontend/src/types/metrics.ts
~~~~~
~~~~~typescript.old
  turn_count: number;
  chunk_count?: number;
  total_tokens: number;
  thought_tokens: number;
  duration_human: string;
~~~~~
~~~~~typescript.new
  turn_count: number;
  chunk_count?: number;
  total_tokens: number;
  cumulative_tokens?: number;
  thought_tokens: number;
  duration_human: string;
~~~~~

~~~~~act
patch_file
frontend/src/components/OverviewDashboard.tsx
~~~~~
~~~~~typescript.old
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-4">
          <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
            <span>总 Token 规模</span>
            <span className="text-[10px] text-zinc-500 font-mono">[{activeRangeLabel}]</span>
          </div>
          <div className="mt-1.5 text-2xl font-bold text-emerald-400 tracking-tight">
            {(metrics.tok_stats?.total || 0).toLocaleString()}
          </div>
          <div className="mt-1 text-[11px] text-zinc-500 truncate" title="会话最终上下文规模，含思考链占比">
            上下文规模 · 思考: {metrics.tok_stats?.thought_ratio ?? '0%'}
          </div>
        </div>
~~~~~
~~~~~typescript.new
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-4">
          <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
            <span>总 Token (静态上下文)</span>
            <span className="text-[10px] text-zinc-500 font-mono">[{activeRangeLabel}]</span>
          </div>
          <div className="mt-1.5 text-2xl font-bold text-emerald-400 tracking-tight">
            {(metrics.tok_stats?.total || 0).toLocaleString()}
          </div>
          <div className="mt-1 text-[11px] text-zinc-400 truncate" title="累计 API 推理算力消耗，较静态规模的膨胀倍率">
            累计 API 消耗: <strong className="text-emerald-300">{(metrics.tok_stats?.cumulative_total || metrics.tok_stats?.total || 0).toLocaleString()}</strong> ({metrics.tok_stats?.expansion_factor ?? '1.0x'})
          </div>
        </div>
~~~~~

~~~~~act
patch_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~typescript.old
          <div className="bg-zinc-900/80 border border-zinc-800/60 rounded p-2.5">
            <div className="text-[10px] text-zinc-400">总 Token 消耗</div>
            <div className="text-base font-bold text-emerald-400 font-mono mt-0.5">
              {session.total_tokens.toLocaleString()}
            </div>
            <div className="text-[10px] text-zinc-500">
              思考链: {session.thought_tokens.toLocaleString()}
            </div>
          </div>
~~~~~
~~~~~typescript.new
          <div className="bg-zinc-900/80 border border-zinc-800/60 rounded p-2.5">
            <div className="text-[10px] text-zinc-400">上下文规模 / API消耗</div>
            <div className="text-base font-bold text-emerald-400 font-mono mt-0.5">
              {session.total_tokens.toLocaleString()}
            </div>
            <div className="text-[10px] text-zinc-500" title="估算实际 API 累计算力消耗">
              累计推理: {(detail?.cumulative_tokens ?? session.cumulative_tokens ?? session.total_tokens).toLocaleString()}
            </div>
          </div>
~~~~~

#### Acts 6: 在趋势图 Tooltip 中对比静态规模与累计算力

在 `TokenTrendChart.tsx` 的 Tooltip 和图例中体现累积 API 消耗曲线。

~~~~~act
patch_file
frontend/src/components/charts/TokenTrendChart.tsx
~~~~~
~~~~~typescript.old
    // 1. 上下文 Token 规模模式 (双折线面积图)
    if (mode === 'tokens') {
      const totalTokens = data.map((d) => d.total_tokens);
      const thoughtTokens = data.map((d) => d.thought_tokens);

      return {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: '总 Token 规模',
              data: totalTokens,
              borderColor: CHART_PALETTE.indigo,
              backgroundColor: CHART_PALETTE.indigoBg,
              fill: true,
              tension: 0.3,
              borderWidth: 2,
              pointRadius: labels.length > 40 ? 0 : 2.5,
              pointHoverRadius: 5,
            },
            {
              label: '思考链 (Thinking) 规模',
              data: thoughtTokens,
              borderColor: CHART_PALETTE.emerald,
              backgroundColor: CHART_PALETTE.emeraldBg,
              fill: true,
              tension: 0.3,
              borderWidth: 1.8,
              pointRadius: labels.length > 40 ? 0 : 2.5,
              pointHoverRadius: 5,
            },
          ],
        },
~~~~~
~~~~~typescript.new
    // 1. 上下文 Token 规模模式 (静态规模 vs 累计推理消耗)
    if (mode === 'tokens') {
      const totalTokens = data.map((d) => d.total_tokens);
      const cumulativeTokens = data.map((d) => d.cumulative_tokens ?? d.total_tokens);
      const thoughtTokens = data.map((d) => d.thought_tokens);

      return {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: '静态上下文规模',
              data: totalTokens,
              borderColor: CHART_PALETTE.indigo,
              backgroundColor: CHART_PALETTE.indigoBg,
              fill: true,
              tension: 0.3,
              borderWidth: 2,
              pointRadius: labels.length > 40 ? 0 : 2.5,
              pointHoverRadius: 5,
            },
            {
              label: '累计推理 API 消耗',
              data: cumulativeTokens,
              borderColor: '#f59e0b', // amber-500
              backgroundColor: 'transparent',
              borderDash: [4, 4],
              borderWidth: 1.8,
              pointRadius: 0,
              pointHoverRadius: 4,
            },
            {
              label: '思考链 (Thinking) 规模',
              data: thoughtTokens,
              borderColor: CHART_PALETTE.emerald,
              backgroundColor: CHART_PALETTE.emeraldBg,
              fill: false,
              tension: 0.3,
              borderWidth: 1.5,
              pointRadius: labels.length > 40 ? 0 : 2,
              pointHoverRadius: 4,
            },
          ],
        },
~~~~~

### 下一步建议
1. **执行离线索引重建**：执行 `python reindex_cli.py`，使数据库中的全部历史会话立刻物化计算并写入 `cumulative_tokens`。
2. **前端语法与类型校验**：执行 `npm --prefix frontend run check` 验证 TypeScript 与 Biome 规则。
