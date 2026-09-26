## [WIP] fix: 修复 Quipu 意图写入目标列并支持强制刷新

### 错误分析
在 Quipu 数据库中，`private_data` 表虽然包含 `intent_md` 与 `ai_context` 两列，但 Quipu 引擎（`sqlite_index.py`）当前硬编码仅读取 `intent_md` 列作为节点的私有展示数据。由于此前回填脚本将指针 Markdown 仅存入 `ai_context` 并将 `intent_md` 置空，导致 Quipu TUI 读取到空字符串，呈现出“开发者意图下方空白”的现象。

### 用户需求
修复 `sync_intents_to_quipu.py`，将生成的轻量认知溯源卡片写入 Quipu 实际展示所依赖的 `intent_md` 列中，并支持 `--force` 参数以允许全量重新刷入已处理过的节点。

### 评论
该修复不增加任何存储负担（依然维持在 300 字节左右的纯指针与摘要卡片），同时精准命中了 Quipu 的数据消费接口，能立竿见影地激活终端 UI 的意图呈现。

### 目标
1. 修改 `sync_intents_to_quipu.py` 的 SQL 查询与写入逻辑，将精简溯源卡片直接注入 `intent_md` 与 `ai_context`。
2. 增加 `--force` 参数，以便能够一键重新刷新此前被写入空内容的 66 个节点。

### 基本原理
Quipu 的 `view_model.py` 通过 `reader.get_private_data()` 取出 `intent_md`，若该字段有值，即原样渲染在 `== 🧠 开发者意图 ===========` 区域。通过将本地跳转 URL、AI Studio 原生 URL 和 Thinking Process 摘要作为 Markdown 注入 `intent_md`，Quipu 终端无需任何改动即可完美展示。

### 标签
#intent/fix #flow/ready #priority/high #comp/cli #concept/history #concept/ui #scope/dx #ai/instruct #task/domain/integration #task/object/quipu-ai-studio-alignment #task/action/bug-fix #task/state/continue #task/status/active

---

### Script

#### Acts 1: 修正 `sync_intents_to_quipu.py` 写入逻辑与强制覆盖支持

将轻量卡片同时注入 `intent_md` 和 `ai_context`，并增加 `--force` 参数。

~~~~~act
write_file
sync_intents_to_quipu.py
~~~~~
~~~~~python
"""
Quipu ↔ AI Studio 认知溯源轻量级回填工具 (修复 intent_md 写入目标列版)

功能:
1. 扫描目标 Quipu 仓库中的 plan 节点。
2. 基于时钟因果窗口与多维模糊特征，精准匹配 AI Studio 对应的 Model Turn。
3. 提取轻量级指针链接（包含前端 Chunk 锚点）、原生链接与思考链摘要，写入 Quipu 的 intent_md 与 ai_context。
"""

import argparse
import os
import sqlite3
import sys

from inspect_quipu_alignment import AlignmentProbe
from src.analyzer.cache import SQLiteCache


def sync_intents(
    quipu_dir: str,
    analyzer_port: int = 5173,
    min_score: float = 0.45,
    window_hours: float = 24.0,
    force: bool = False,
    dry_run: bool = False,
):
    quipu_dir_abs = os.path.abspath(quipu_dir)
    db_path = os.path.join(quipu_dir_abs, ".quipu", "history.sqlite")
    if not os.path.exists(db_path):
        print(f"❌ 未找到 Quipu 数据库: {db_path}")
        sys.exit(1)

    cache = SQLiteCache(cache_dir=".cache")
    probe = AlignmentProbe(analyzer_cache=cache, window_hours=window_hours)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS private_data (
            node_hash TEXT(40) PRIMARY KEY,
            intent_md TEXT,
            ai_context TEXT,
            created_at REAL DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (node_hash) REFERENCES nodes(commit_hash) ON DELETE CASCADE
        );
    """)

    # 根据 force 参数决定是全量重刷还是仅补全缺失
    filter_sql = ""
    if not force:
        filter_sql = "AND (p.intent_md IS NULL OR p.intent_md = '')"

    query = f"""
        SELECT n.commit_hash, n.output_tree, n.timestamp, n.summary, n.plan_md_cache
        FROM nodes n
        LEFT JOIN private_data p ON n.commit_hash = p.node_hash
        WHERE n.node_type = 'plan' 
          AND n.plan_md_cache IS NOT NULL 
          AND length(n.plan_md_cache) > 20
          {filter_sql}
        ORDER BY n.timestamp DESC
    """
    cursor.execute(query)
    nodes_to_sync = [dict(r) for r in cursor.fetchall()]

    print(f"🔍 检索到 {len(nodes_to_sync)} 个待对齐/刷新的 Quipu 节点 (force={force})。")
    if not nodes_to_sync:
        print("✅ 所有 Plan 节点均已包含意图内容，无需处理。如需全量重新对齐请添加 --force 参数。")
        conn.close()
        return

    success_count = 0
    skipped_count = 0

    for node in nodes_to_sync:
        best = probe.match_node(node)
        if not best or best["total_score"] < min_score:
            skipped_count += 1
            continue

        commit_hash = node["commit_hash"]
        file_id = best["ai_file_id"]
        turn_idx = best["turn_index"]
        model = best["model"].replace("models/", "")
        time_gap = best["time_diff_minutes"]

        # 构建轻量级 Markdown 引用卡片
        analyzer_url = (
            f"http://localhost:{analyzer_port}/sessions/{file_id}#turn-{turn_idx}"
        )
        google_url = f"https://aistudio.google.com/prompts/{file_id}"

        thinking_section = ""
        if best.get("thinking_process"):
            t_snippet = best["thinking_process"].strip()
            if len(t_snippet) > 400:
                t_snippet = t_snippet[:400] + "..."
            thinking_lines = t_snippet.replace("\n", "\n> ")
            thinking_section = (
                f"\n\n> 💭 **思考链摘要 (Thinking Process)**:\n> {thinking_lines}"
            )

        ai_context_md = (
            f"🔗 **AI 认知上下文溯源 (匹配度: {best['total_score']:.2f})**:\n"
            f"* 🖥️ **本地工作台**: [{best['session_name']} (Turn #{turn_idx})]({analyzer_url})\n"
            f"* 🌐 **Google AI Studio**: [在原生工作台打开]({google_url})\n"
            f"* 🤖 **模型**: `{model}` (时序相隔: {time_gap} 分钟)"
            f"{thinking_section}"
        )

        # 【核心修复】：同时将精炼内容写入 intent_md 与 ai_context
        # 满足 Quipu 的 sqlite_index.py 仅 SELECT intent_md 的设计
        if not dry_run:
            cursor.execute(
                """
                INSERT OR REPLACE INTO private_data (node_hash, intent_md, ai_context)
                VALUES (?, ?, ?)
                """,
                (commit_hash, ai_context_md, ai_context_md),
            )

        success_count += 1
        prefix = "[DRY-RUN] " if dry_run else ""
        print(
            f"  ✅ {prefix}成功回填: [{commit_hash[:8]}] -> {best['session_name']} (Turn #{turn_idx}, 得分: {best['total_score']:.3f})"
        )

    if not dry_run:
        conn.commit()
        print(f"\n🎉 写入完成: 成功回填 {success_count} 个节点至 intent_md (跳过/未达阈值: {skipped_count})。")
    else:
        print(f"\n💡 [DRY-RUN] 预演完成: 可对齐 {success_count} 个节点 (跳过: {skipped_count})。")

    conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Quipu ↔ AI Studio 认知溯源轻量级回填工具"
    )
    parser.add_argument(
        "--quipu-dir",
        required=True,
        help="目标 Quipu 仓库的工作区根目录路径",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=5173,
        help="AI Studio Analyzer 前端服务端口 (默认: 5173)",
    )
    parser.add_argument(
        "--min-score",
        type=float,
        default=0.45,
        help="判定的最低置信度得分 (默认: 0.45)",
    )
    parser.add_argument(
        "--window-hours",
        type=float,
        default=24.0,
        help="时间因果窗口大小/小时 (默认: 24.0)",
    )
    parser.add_argument(
        "--force",
        "-f",
        action="store_true",
        help="强制重新覆盖已有 private_data 内容",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="演练模式，仅打印对齐计划，不写入 Quipu 数据库",
    )

    args = parser.parse_args()
    sync_intents(
        quipu_dir=args.quipu_dir,
        analyzer_port=args.port,
        min_score=args.min_score,
        window_hours=args.window_hours,
        force=args.force,
        dry_run=args.dry_run,
    )
~~~~~

### 下一步建议
1. **执行强制重新回填**：
   运行以下命令，带上 `--force` 重新刷新被置空的节点：
   ```bash
   python sync_intents_to_quipu.py --quipu-dir . --force
   ```
2. **在 Quipu 验证呈现**：
   再次在当前项目运行 `quipu ui`，按 `v` 打开内容视图，此时右侧 `== 🧠 开发者意图 ===========` 下方将清晰呈现出：
   - 带有会话名与 `#turn-N` 的本地 Analyzer 直达链接
   - Google AI Studio 云端跳转链接
   - 模型名称与执行时差
   - 格式优雅的 Thinking Process 思考链引用块
3. **点击验证锚点定位**：
   在终端中按住 Ctrl/Cmd 点击生成的本地 URL（例如 `http://localhost:5173/sessions/...#turn-13`），验证浏览器端自动平滑滑动到指定对话卡片并高亮脉冲。
