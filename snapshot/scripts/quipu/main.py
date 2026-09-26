"""
Quipu Bridge - 统一认知对齐、生命周期与存储水合 CLI 工具箱
"""

import argparse
import sys
from datetime import datetime
from tqdm import tqdm

from core import (
    AlignmentProbe,
    QuipuRepositoryManager,
    read_git_plan_content,
)
from src.analyzer.cache import SQLiteCache


def format_pct(num: float, total: float) -> str:
    pct = (num / total * 100) if total > 0 else 0.0
    return f"{num}/{total} ({pct:.1f}%)"


def cmd_status(args):
    """显示 Quipu 仓库的认知审计与缓存状态"""
    repo = QuipuRepositoryManager(args.quipu_dir)
    status = repo.get_status()

    print("=" * 75)
    print("📊 Quipu 仓库认知桥接与缓存状态报告")
    print("=" * 75)
    print(f"📁 仓库目录:  {status['quipu_dir']}")
    print(f"🗃️ 数据库:    {status['db_path']}")
    print("-" * 75)
    print(
        f"• 状态节点总量:       {status['total_nodes']} 个 (Plan: {status['total_plans']}, Capture: {status['total_captures']})"
    )
    cache_badge = "✅ 完备" if status["uncached_plans"] == 0 else f"⚠️ 待补水 {status['uncached_plans']} 个"
    print(
        f"• Plan 正文缓存覆盖:  {format_pct(status['cached_plans'], status['total_plans'])} [{cache_badge}]"
    )
    print(
        f"• 认知意图回填覆盖:   {format_pct(status['intent_count'], status['total_plans'])}"
    )
    print("-" * 75)
    print("🕒 最近 Plan 样本状态 (最新 8 场):")
    for p in status["recent_plans"]:
        dt_str = datetime.fromtimestamp(p["timestamp"]).strftime("%Y-%m-%d %H:%M")
        c_mark = "✅" if p["has_cache"] else "❌"
        i_mark = "✅" if p["has_intent"] else "⚪"
        summary = (p["summary"][:42] + "..") if len(p["summary"]) > 42 else p["summary"]
        print(f"  [{p['commit_hash'][:7]}] {dt_str} (缓存:{c_mark} | 意图:{i_mark}) - {summary}")

    print("=" * 75)
    if status["uncached_plans"] > 0:
        print("💡 提示: 存在未缓存正文的 Plan 节点，可执行 `hydrate` 命令从 Git 一键补水加速。")
    if status["intent_count"] == 0 and status["total_plans"] > 0:
        print("💡 提示: 尚未回填认知意图，可执行 `sync` 命令与 AI Studio 进行自动溯源回填。")


def cmd_hydrate(args):
    """从 Git blob 批量提取 content.md 填补 nodes.plan_md_cache"""
    repo = QuipuRepositoryManager(args.quipu_dir)
    with repo.get_connection() as conn:
        cur = conn.cursor()
        query = """
            SELECT commit_hash, summary 
            FROM nodes 
            WHERE node_type = 'plan' 
              AND (plan_md_cache IS NULL OR length(plan_md_cache) < 20)
            ORDER BY timestamp DESC
        """
        if args.limit and args.limit > 0:
            query += f" LIMIT {args.limit}"
        cur.execute(query)
        targets = [dict(r) for r in cur.fetchall()]

        total = len(targets)
        print(f"💧 扫描到 {total} 个待补水的 Plan 节点...")
        if total == 0:
            print("✅ 所有的 Plan 节点均已包含正文缓存，无需补水！")
            return

        success = 0
        failed = 0

        with tqdm(total=total, desc="📦 补水缓存", unit="node", colour="blue") as pbar:
            for item in targets:
                commit_hash = item["commit_hash"]
                content = read_git_plan_content(repo.quipu_dir, commit_hash)
                if content and len(content) >= 20:
                    if not args.dry_run:
                        cur.execute(
                            "UPDATE nodes SET plan_md_cache = ? WHERE commit_hash = ?",
                            (content, commit_hash),
                        )
                    success += 1
                else:
                    failed += 1
                pbar.set_postfix({"成功": success, "未读出": failed})
                pbar.update(1)

        if not args.dry_run:
            conn.commit()
            print(f"\n🎉 补水完成: 成功为 {success} 个节点物化正文缓存 (失败/无正文: {failed})。")
        else:
            print(f"\n💡 [DRY-RUN] 演练完成: 可成功补水 {success} 个节点。")


def cmd_clear(args):
    """安全清空仓库已有的意图回填数据"""
    repo = QuipuRepositoryManager(args.quipu_dir)
    status = repo.get_status()

    if status["intent_count"] == 0:
        print("ℹ️ 目标仓库的 private_data 中不存在任何意图回填记录，无需清空。")
        return

    print(f"⚠️ 即将清空 [{repo.quipu_dir}] 中的 {status['intent_count']} 条意图回填数据！")
    if not args.yes:
        confirm = input("确定继续执行清空吗? [y/N]: ").strip().lower()
        if confirm != "y":
            print("🚫 操作已取消。")
            return

    deleted = repo.clear_intents(force=True)
    print(f"✨ 已成功清空 {deleted} 条 intent_md 记录。现在可使用 sync 重新进行纯净对齐。")


def cmd_probe(args):
    """执行无副作用的对齐探针与时钟因果审计"""
    repo = QuipuRepositoryManager(args.quipu_dir)
    cache = SQLiteCache(cache_dir=args.cache_dir)
    probe = AlignmentProbe(analyzer_cache=cache, window_hours=args.window_hours)

    print("=" * 80)
    print("🔬 Quipu ↔ AI Studio 认知溯源对齐探针 [深度审计模式]")
    print("=" * 80)
    print(f"📁 Quipu 仓库:  {repo.quipu_dir}")
    print(f"📦 Analyzer 库:  {cache.db_path} ({cache.count()} 场会话)")
    print(f"🎯 审查规模:    最近 {args.limit} 个 Plan 节点 | 回溯窗口: {args.window_hours}h | 判定基线: {args.min_score}")
    print("-" * 80)

    with repo.get_connection() as conn:
        cur = conn.cursor()
        query = "SELECT commit_hash, output_tree, timestamp, summary, plan_md_cache FROM nodes WHERE node_type = 'plan' ORDER BY timestamp DESC"
        if args.limit and args.limit > 0:
            query += f" LIMIT {args.limit}"
        cur.execute(query)
        nodes = [dict(r) for r in cur.fetchall()]

    if not nodes:
        print("⚠️ 未检索到 Plan 节点。")
        return

    strong_hits = []
    borderline_hits = []
    missed_count = 0
    penetrated_count = 0

    with tqdm(nodes, desc="⚡ 正在对齐历史节点", unit="node", colour="green") as pbar:
        for node in pbar:
            # 自动兜底提取
            if not node.get("plan_md_cache") or len(node["plan_md_cache"]) < 20:
                node["plan_md_cache"] = read_git_plan_content(repo.quipu_dir, node["commit_hash"])

            if not node.get("plan_md_cache") or len(node["plan_md_cache"]) < 20:
                missed_count += 1
                continue

            res = probe.match_node(node)
            if not res or res["total_score"] < 0.30:
                missed_count += 1
            elif res["total_score"] >= args.min_score:
                strong_hits.append(res)
                if res.get("is_penetrated"):
                    penetrated_count += 1
            else:
                borderline_hits.append(res)

    total_scanned = len(nodes)
    strong_count = len(strong_hits)
    border_count = len(borderline_hits)
    hit_rate = (strong_count / total_scanned * 100) if total_scanned > 0 else 0

    print("\n" + "=" * 80)
    print("📊 批量认知溯源对齐 - 统计审计总览")
    print("=" * 80)
    print(f"  - 审计 Quipu Plan 节点总量:    {total_scanned} 场")
    print(f"  - ✅ 确定置信命中 (Score>={args.min_score}):  {strong_count} 场 (命中率: {hit_rate:.1f}%)")
    print(f"  - ⚠️  临界弱相关 (0.30<=Score<{args.min_score}): {border_count} 场")
    print(f"  - ❌ 未命中 (Score<0.30 或无正文):  {missed_count} 场")
    print("-" * 80)
    if strong_count > 0:
        avg_score = sum(s["total_score"] for s in strong_hits) / strong_count
        avg_time_gap = sum(s["time_diff_minutes"] for s in strong_hits) / strong_count
        print(f"  - 🧠 短指令向前穿透率:          {penetrated_count}/{strong_count} ({(penetrated_count/strong_count*100):.1f}%)")
        print(f"  - 📈 强命中平均置信度得分:      {avg_score:.3f}")
        print(f"  - ⏱️  真实时差 (Quipu执行 - AI生成): 平均 {avg_time_gap:.1f} 分钟")

        # 打印置信度最高的代表样本
        best_sample = max(strong_hits, key=lambda x: x["total_score"])
        print("\n🌟 [最高置信度代表样本]:")
        print(f"  Commit: [{best_sample['quipu_commit'][:8]}] {best_sample['quipu_summary']}")
        print(f"  AI会话: {best_sample['session_name']} (Turn #{best_sample['turn_index']}, 得分: {best_sample['total_score']:.3f})")
        print(f"  意图:   \"{best_sample.get('user_prompt', '')[:100]}...\"")
    print("=" * 80)


def cmd_sync(args):
    """执行 AI Studio 意图回填到 Quipu (带进度条与热回填)"""
    repo = QuipuRepositoryManager(args.quipu_dir)
    cache = SQLiteCache(cache_dir=args.cache_dir)
    probe = AlignmentProbe(analyzer_cache=cache, window_hours=args.window_hours)

    conn = repo.get_connection()
    repo.ensure_private_data_schema(conn)
    cur = conn.cursor()

    filter_sql = ""
    if not args.force:
        filter_sql = "AND (p.intent_md IS NULL OR trim(p.intent_md) = '')"

    query = f"""
        SELECT n.commit_hash, n.output_tree, n.timestamp, n.summary, n.plan_md_cache
        FROM nodes n
        LEFT JOIN private_data p ON n.commit_hash = p.node_hash
        WHERE n.node_type = 'plan' 
          {filter_sql}
        ORDER BY n.timestamp DESC
    """
    cur.execute(query)
    nodes = [dict(r) for r in cur.fetchall()]

    total = len(nodes)
    print(f"🔍 检索到 {total} 个待对齐/刷新的 Quipu 节点 (force={args.force})。")
    if total == 0:
        if not args.force:
            print("✅ 检索到的所有 Plan 节点均已包含意图内容，无需处理。如需全量重新对齐请添加 --force 参数。")
        else:
            print("⚠️ 未检索到任何 Plan 节点。")
        conn.close()
        return

    success_count = 0
    skipped_count = 0
    hydrated_cache_count = 0

    with tqdm(total=total, desc="⚡ 回填意图", unit="node", colour="cyan") as pbar:
        for node in nodes:
            plan_content = node.get("plan_md_cache")
            if not plan_content or len(plan_content) < 20:
                git_content = read_git_plan_content(repo.quipu_dir, node["commit_hash"])
                if git_content:
                    node["plan_md_cache"] = git_content
                    plan_content = git_content
                    if not args.dry_run:
                        try:
                            cur.execute(
                                "UPDATE nodes SET plan_md_cache = ? WHERE commit_hash = ?",
                                (git_content, node["commit_hash"]),
                            )
                            hydrated_cache_count += 1
                        except Exception:
                            pass

            if not plan_content or len(plan_content) < 20:
                skipped_count += 1
                pbar.set_postfix({"成功": success_count, "跳过": skipped_count})
                pbar.update(1)
                continue

            best = probe.match_node(node)
            if not best or best["total_score"] < args.min_score:
                skipped_count += 1
                pbar.set_postfix({"成功": success_count, "跳过": skipped_count})
                pbar.update(1)
                continue

            commit_hash = node["commit_hash"]
            file_id = best["ai_file_id"]
            turn_idx = best["turn_index"]
            model = best["model"].replace("models/", "")
            time_gap = best["time_diff_minutes"]

            analyzer_url = f"http://localhost:{args.port}/sessions/{file_id}#turn-{turn_idx}"
            google_url = f"https://aistudio.google.com/prompts/{file_id}"

            thinking_section = ""
            if best.get("thinking_process"):
                t_snippet = best["thinking_process"].strip()
                if len(t_snippet) > 400:
                    t_snippet = t_snippet[:400] + "..."
                thinking_lines = t_snippet.replace("\n", "\n> ")
                thinking_section = f"\n\n> 💭 **思考链摘要 (Thinking Process)**:\n> {thinking_lines}"

            ai_context_md = (
                f"🔗 **AI 认知上下文溯源 (匹配度: {best['total_score']:.2f})**:\n"
                f"* 🖥️ **本地工作台**: [{best['session_name']} (Turn #{turn_idx})]({analyzer_url})\n"
                f"* 🌐 **Google AI Studio**: [在原生工作台打开]({google_url})\n"
                f"* 🤖 **模型**: `{model}` (时序相隔: {time_gap} 分钟)"
                f"{thinking_section}"
            )

            if not args.dry_run:
                cur.execute(
                    """
                    INSERT OR REPLACE INTO private_data (node_hash, intent_md, ai_context)
                    VALUES (?, ?, ?)
                    """,
                    (commit_hash, ai_context_md, ai_context_md),
                )

            success_count += 1
            pbar.set_postfix({"成功": success_count, "跳过": skipped_count})

            if args.verbose:
                prefix = "[DRY-RUN] " if args.dry_run else ""
                tqdm.write(
                    f"  ✅ {prefix}成功回填: [{commit_hash[:8]}] -> {best['session_name']} (Turn #{turn_idx}, 得分: {best['total_score']:.3f})"
                )

            pbar.update(1)

    if not args.dry_run:
        conn.commit()
        hydrate_msg = f"，同时自动补水了 {hydrated_cache_count} 个节点的 plan_md_cache" if hydrated_cache_count > 0 else ""
        print(f"\n🎉 写入完成: 成功回填 {success_count} 个节点至 intent_md (跳过/未达阈值: {skipped_count}{hydrate_msg})。")
    else:
        print(f"\n💡 [DRY-RUN] 预演完成: 可对齐 {success_count} 个节点 (跳过: {skipped_count})。")

    conn.close()


def main():
    parser = argparse.ArgumentParser(
        prog="quipu-bridge",
        description="Quipu ↔ AI Studio 认知溯源统一控制工具箱",
    )
    subparsers = parser.add_subparsers(dest="command", required=True, help="可执行的子命令")

    # 1. status 命令
    p_status = subparsers.add_parser("status", help="查看目标 Quipu 仓库的认知桥接状态与完整率")
    p_status.add_argument("--quipu-dir", "-d", default=".", help="Quipu 仓库工作区根路径 (默认: 当前目录)")
    p_status.set_defaults(func=cmd_status)

    # 2. hydrate 命令
    p_hydrate = subparsers.add_parser("hydrate", help="从 Git 快照提取 content.md 补水物化 plan_md_cache")
    p_hydrate.add_argument("--quipu-dir", "-d", default=".", help="Quipu 仓库工作区根路径 (默认: 当前目录)")
    p_hydrate.add_argument("--limit", "-n", type=int, default=None, help="限制本次补水的最大节点数")
    p_hydrate.add_argument("--dry-run", action="store_true", help="演练模式，不写数据库")
    p_hydrate.set_defaults(func=cmd_hydrate)

    # 3. sync 命令
    p_sync = subparsers.add_parser("sync", help="执行 AI Studio 意图回填到 Quipu 的 intent_md")
    p_sync.add_argument("--quipu-dir", "-d", default=".", help="Quipu 仓库工作区根路径 (默认: 当前目录)")
    p_sync.add_argument("--cache-dir", default=".cache", help="Analyzer 缓存目录 (默认: .cache)")
    p_sync.add_argument("--port", type=int, default=5173, help="Analyzer 前端端口 (默认: 5173)")
    p_sync.add_argument("--min-score", type=float, default=0.45, help="最低判定置信度得分 (默认: 0.45)")
    p_sync.add_argument("--window-hours", type=float, default=24.0, help="时钟因果窗口小时数 (默认: 24.0)")
    p_sync.add_argument("--force", "-f", action="store_true", help="强制覆盖已有的 intent_md")
    p_sync.add_argument("--dry-run", action="store_true", help="演练模式，仅打印回填计划")
    p_sync.add_argument("--verbose", "-v", action="store_true", help="详细日志模式")
    p_sync.set_defaults(func=cmd_sync)

    # 4. probe 命令
    p_probe = subparsers.add_parser("probe", help="无副作用地审查回溯对齐置信度与时区基准")
    p_probe.add_argument("--quipu-dir", "-d", default=".", help="Quipu 仓库工作区根路径 (默认: 当前目录)")
    p_probe.add_argument("--cache-dir", default=".cache", help="Analyzer 缓存目录 (默认: .cache)")
    p_probe.add_argument("--limit", type=int, default=100, help="审查的节点数量 (默认: 100)")
    p_probe.add_argument("--min-score", type=float, default=0.45, help="判定门限得分 (默认: 0.45)")
    p_probe.add_argument("--window-hours", type=float, default=24.0, help="时间因果窗口小时数 (默认: 24.0)")
    p_probe.set_defaults(func=cmd_probe)

    # 5. clear 命令
    p_clear = subparsers.add_parser("clear", help="清空目标 Quipu 仓库的 intent_md 回填数据")
    p_clear.add_argument("--quipu-dir", "-d", default=".", help="Quipu 仓库工作区根路径 (默认: 当前目录)")
    p_clear.add_argument("--yes", "-y", action="store_true", help="跳过人工确认，直接执行清空")
    p_clear.set_defaults(func=cmd_clear)

    parsed = parser.parse_args()
    parsed.func(parsed)


if __name__ == "__main__":
    main()