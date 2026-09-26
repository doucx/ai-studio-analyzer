"""
Quipu ↔ AI Studio 认知溯源轻量级回填工具 (带 tqdm 进度条与静默对齐版)

功能:
1. 扫描目标 Quipu 仓库中的 plan 节点。
2. 基于时钟因果窗口与多维模糊特征，精准匹配 AI Studio 对应的 Model Turn。
3. 提取轻量级指针链接（包含前端 Chunk 锚点）、原生链接与思考链摘要，写入 Quipu 的 intent_md 与 ai_context。
"""

import argparse
import os
import sqlite3
import sys
from tqdm import tqdm

from inspect_quipu_alignment import AlignmentProbe
from src.analyzer.cache import SQLiteCache


def sync_intents(
    quipu_dir: str,
    analyzer_port: int = 5173,
    min_score: float = 0.45,
    window_hours: float = 24.0,
    force: bool = False,
    dry_run: bool = False,
    verbose: bool = False,
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

    total_nodes = len(nodes_to_sync)
    print(f"🔍 检索到 {total_nodes} 个待对齐/刷新的 Quipu 节点 (force={force})。")
    if not nodes_to_sync:
        print("✅ 所有 Plan 节点均已包含意图内容，无需处理。如需全量重新对齐请添加 --force 参数。")
        conn.close()
        return

    success_count = 0
    skipped_count = 0

    with tqdm(
        total=total_nodes,
        desc="⚡ 回填意图",
        unit="node",
        bar_format="{l_bar}{bar:30}{r_bar}",
        colour="cyan",
    ) as pbar:
        for node in nodes_to_sync:
            best = probe.match_node(node)
            if not best or best["total_score"] < min_score:
                skipped_count += 1
                pbar.set_postfix({"成功": success_count, "跳过": skipped_count})
                pbar.update(1)
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

            # 同时将精炼内容写入 intent_md 与 ai_context
            if not dry_run:
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO private_data (node_hash, intent_md, ai_context)
                    VALUES (?, ?, ?)
                    """,
                    (commit_hash, ai_context_md, ai_context_md),
                )

            success_count += 1
            pbar.set_postfix({"成功": success_count, "跳过": skipped_count})

            if verbose:
                prefix = "[DRY-RUN] " if dry_run else ""
                tqdm.write(
                    f"  ✅ {prefix}成功回填: [{commit_hash[:8]}] -> {best['session_name']} (Turn #{turn_idx}, 得分: {best['total_score']:.3f})"
                )

            pbar.update(1)

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
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="详细日志模式，显示每条成功回填的详细信息",
    )

    args = parser.parse_args()
    sync_intents(
        quipu_dir=args.quipu_dir,
        analyzer_port=args.port,
        min_score=args.min_score,
        window_hours=args.window_hours,
        force=args.force,
        dry_run=args.dry_run,
        verbose=args.verbose,
    )
