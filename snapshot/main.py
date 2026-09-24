"""
AI Studio Analyzer - 统一调度入口 (Git 风格分布式体系)

常用命令:
  1. python main.py fetch [-n 50]         # 增量拉取云端最近 50 个修改的文件写入 SQLite
  2. python main.py analyze [--export]   # 纯离线全量分析本地 SQLite 缓存 (加 --export 导出 CSV/JSONL)
  3. python main.py pull [-n 50]          # 组合操作：快速拉取最新 50 个文件，随后全量分析本地数据
"""
import argparse
import sys
from src.analyzer.drive import DriveClient, PROXY_URL
from src.analyzer.cache import SQLiteCache
from src.analyzer.sync import fetch_remote_files
from src.analyzer.loader import load_cached_sessions
from src.analyzer.metrics import calculate_session_metrics
from src.analyzer.exporter import export_first_prompts_to_jsonl, export_prompts_summary_csv


def run_analyze(cache: SQLiteCache, limit: int = 0, export: bool = False):
    """纯离线本地计算与报表分析"""
    print("\n" + "=" * 60)
    print("📊 启动本地离线认知与交互审计 (Analyzer)")
    if limit > 0:
        print(f"📌 分析模式: 采样分析本地前 {limit} 个会话")
    else:
        print("📌 分析模式: [全量分析] 正在读取本地 SQLite 全部会话资产...")
    print("=" * 60)

    sessions = load_cached_sessions(cache, limit=limit, show_progress=True)
    if not sessions:
        print("⚠️ 未加载到有效会话。请先运行 `python main.py fetch` 同步数据。")
        return

    # 指标计算
    metrics = calculate_session_metrics(sessions)
    print("\n" + "=" * 30 + " 📊 认知与能耗全景概览 " + "=" * 30)
    print(f"  - 分析会话总数:           {metrics['total_sessions']}")
    print(f"  - 总对话轮次 (Turns):     {metrics['total_turns']} (平均每会话: {metrics['avg_turns_per_session']} 轮)")
    print(f"  - 深度攻坚会话 (≥5轮):     {metrics['deep_session_count']} 场 (占比 {metrics['deep_session_ratio']})")
    print(f"  - 平均交互时长 (有效跨度): {metrics['avg_duration_minutes']} 分钟 (多轮深入会话平均: {metrics['avg_multi_turn_duration_minutes']} 分钟)")
    print(f"  - 计算能耗 (Total Tokens): {metrics['total_tokens']:,} (平均每会话: {int(metrics['avg_tokens_per_session']):,} Tokens)")
    print(f"  - 思考链消耗 (Thinking):   {metrics['total_thought_tokens']:,} Tokens (占总能耗: {metrics['thought_token_ratio']})")
    print(f"  - 思维摩擦力 (重试/分支):   {metrics['friction_sessions_count']} 场 (占比: {metrics['friction_session_ratio']}, 累计分支重试: {metrics['total_branch_retries']} 次)")
    print(f"  - 系统指令部署会话数:     {metrics['sys_instruction_configured_count']} 场")
    print(f"  - 用户提问总字数:         {metrics['total_user_chars']:,} 字符")
    print(f"  - 模型偏好分布:           {metrics['model_distribution']}")
    print("=" * 76)

    # 导出报表产物（仅在显式指定 --export 时生成）
    if export:
        jsonl_output = "first_prompts_for_clustering.jsonl"
        csv_output = "prompts_summary.csv"
        export_first_prompts_to_jsonl(sessions, jsonl_output)
        export_prompts_summary_csv(sessions, csv_output)
        print(f"\n📁 分析产物已生成 (基于全量 {len(sessions)} 条资产):")
        print(f"  1. 首轮提问清洗集 (用于聚类与反思): ./{jsonl_output}")
        print(f"  2. 对话概览指标明细 (CSV 报表):        ./{csv_output}")


def cmd_fetch(args):
    """仅网络同步"""
    print("=" * 60)
    print("🔄 正在执行云端增量同步 (Fetch)")
    print("=" * 60)
    client = DriveClient(proxy_url=PROXY_URL)
    cache = SQLiteCache(cache_dir=".cache")

    total_valid, hits, downloaded = fetch_remote_files(
        client=client,
        cache=cache,
        limit=args.limit,
        all_files=args.all
    )
    print(f"\n✅ 同步完成: 扫描有效项 {total_valid} | 命中缓存 {hits} | 增量下载 {downloaded}")
    print(f"📦 本地 SQLite 现有总会话数: {cache.count()}")


def cmd_analyze(args):
    """仅本地离线分析"""
    cache = SQLiteCache(cache_dir=".cache")
    run_analyze(cache, limit=args.limit, export=args.export)


def cmd_pull(args):
    """先拉取增量，再全量分析"""
    cmd_fetch(args)
    cache = SQLiteCache(cache_dir=".cache")
    run_analyze(cache, limit=0, export=args.export)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Google AI Studio 历史对话分析器 (Git 风格分布式体系)",
        formatter_class=argparse.RawTextHelpFormatter
    )
    subparsers = parser.add_subparsers(dest="command", help="子命令 (输入 -h 查看详情)")

    # 1. fetch 子命令
    parser_fetch = subparsers.add_parser("fetch", help="[网络] 增量拉取云端最近修改的文件写入本地 SQLite")
    parser_fetch.add_argument("-n", "--limit", type=int, default=50, help="远程扫描拉取数量限制 (默认: 50)")
    parser_fetch.add_argument("--all", action="store_true", help="全量扫描云盘 (忽略 -n)")

    # 2. analyze 子命令
    parser_analyze = subparsers.add_parser("analyze", help="[离线] 纯离线分析本地 SQLite 缓存的历史会话")
    parser_analyze.add_argument("-n", "--limit", type=int, default=0, help="分析会话上限 (默认 0 表示全量分析)")
    parser_analyze.add_argument("--export", action="store_true", help="显式导出 CSV 与 JSONL 分析文件 (默认不导出)")

    # 3. pull 子命令
    parser_pull = subparsers.add_parser("pull", help="[组合] 增量拉取最近文件更新本地库，随后执行全量分析")
    parser_pull.add_argument("-n", "--limit", type=int, default=50, help="增量拉取数量限制 (默认: 50)")
    parser_pull.add_argument("--all", action="store_true", help="全量扫描云盘并分析")
    parser_pull.add_argument("--export", action="store_true", help="分析完成后显式导出 CSV 与 JSONL 文件 (默认不导出)")

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "fetch":
        cmd_fetch(args)
    elif args.command == "analyze":
        cmd_analyze(args)
    elif args.command == "pull":
        cmd_pull(args)
    else:
        print("💡 未指定子命令，默认执行 `analyze` 查看本地指标看板。")
        print("   可用子命令: `fetch` (仅同步), `analyze` (仅本地分析), `pull` (同步并分析)")
        print("   运行 `python main.py -h` 可查看完整指令选项。\n")
        class DefaultArgs:
            limit = 0
            export = False
        cmd_analyze(DefaultArgs())


if __name__ == "__main__":
    main()