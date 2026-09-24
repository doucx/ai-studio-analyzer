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

    # 指标计算 (基于 pandas 稳健聚合)
    m = calculate_session_metrics(sessions)
    t_stats = m["turn_stats"]
    d_stats = m["dur_stats"]
    md_stats = m["multi_dur_stats"]
    tok_stats = m["tok_stats"]
    f_stats = m["friction_stats"]
    tiers = m["duration_tiers"]

    print("\n" + "=" * 30 + " 📊 认知与能耗全景审计 (Pandas 稳健分位数) " + "=" * 30)
    print(f"  - 全量会话总数:           {m['total_sessions']} 场 (提问总字数: {m['total_user_chars']:,} 字符)")
    
    print("\n  ⏱️ [会话生命周期与心智时长 (分钟)]:")
    print(f"    • 全体时长中位数 (P50):  {d_stats['median']} min  |  算术均值 (Mean): {d_stats['mean']} min (受离群长尾拉动)")
    print(f"    • 多轮会话中位数 (P50):  {md_stats['median']} min  |  多轮均值 (Mean): {md_stats['mean']} min")
    print(f"    • 长尾攻坚分位数:       P75: {d_stats['p75']} min  |  P90: {d_stats['p90']} min  |  Max: {d_stats['max']} min")
    print(f"    • 时长心智梯队分布:")
    print(f"      - ⚡ 即时快问 (<10m):   {tiers['flash'][0]} 场 ({tiers['flash'][1]})")
    print(f"      - 🎯 聚焦推进 (10~60m): {tiers['focus'][0]} 场 ({tiers['focus'][1]})")
    print(f"      - 🔨 深度攻坚 (1~6h):   {tiers['deep'][0]} 场 ({tiers['deep'][1]})")
    print(f"      - 🏔️ 跨日长线 (>6h):    {tiers['epic'][0]} 场 ({tiers['epic'][1]})")

    print("\n  💬 [交互深度与思维摩擦力]:")
    print(f"    • 对话轮次 (Turns):     中位数: {t_stats['median']} 轮  |  均值: {t_stats['mean']} 轮  |  P90: {t_stats['p90']} 轮")
    print(f"    • 深度攻坚会话 (≥5轮):   {t_stats['deep_count']} 场 (占比 {t_stats['deep_ratio']})")
    print(f"    • 思维摩擦力 (重试/分叉): {f_stats['branch_sessions']} 场 (占比 {f_stats['branch_ratio']}, 累计分支重试: {f_stats['total_retries']} 次)")

    print("\n  🧠 [计算能耗与思考链 (Tokens)]:")
    print(f"    • 单场消耗中位数 (P50):  {int(tok_stats['median']):,} Tokens  |  均值: {int(tok_stats['mean']):,} Tokens")
    print(f"    • 高负荷消耗 (P90):      {int(tok_stats['p90']):,} Tokens")
    print(f"    • 总消耗能耗:           {tok_stats['total']:,} Tokens")
    print(f"    • 思考链消耗 (Thinking): {tok_stats['total_thought']:,} Tokens (占总能耗: {tok_stats['thought_ratio']})")

    print("\n  ⚙️ [模型偏好与系统指令]:")
    print(f"    • 系统指令部署会话数:   {m['sys_instruction_count']} 场")
    print(f"    • 模型使用分布:         {m['model_distribution']}")
    print("=" * 82)

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

    # 4. serve 子命令
    parser_serve = subparsers.add_parser("serve", help="[服务] 启动 FastAPI 本地数据后端服务")
    parser_serve.add_argument("--host", type=str, default="127.0.0.1", help="绑定监听地址 (默认: 127.0.0.1)")
    parser_serve.add_argument("-p", "--port", type=int, default=8000, help="监听端口 (默认: 8000)")
    parser_serve.add_argument("--reload", action="store_true", help="代码热重载模式")

    return parser


def cmd_serve(args):
    """启动 FastAPI 服务"""
    import uvicorn
    print("=" * 60)
    print(f"🚀 启动 AI Studio Analyzer 后端服务: http://{args.host}:{args.port}")
    print(f"📖 Swagger 交互式文档地址:   http://{args.host}:{args.port}/docs")
    print("=" * 60)
    uvicorn.run("src.server.app:app", host=args.host, port=args.port, reload=args.reload)


def main():
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "fetch":
        cmd_fetch(args)
    elif args.command == "analyze":
        cmd_analyze(args)
    elif args.command == "pull":
        cmd_pull(args)
    elif args.command == "serve":
        cmd_serve(args)
    else:
        print("💡 未指定子命令，默认执行 `analyze` 查看本地指标看板。")
        print("   可用子命令: `fetch` (仅同步), `analyze` (仅本地分析), `pull` (同步并分析), `serve` (启动API服务)")
        print("   运行 `python main.py -h` 可查看完整指令选项。\n")
        class DefaultArgs:
            limit = 0
            export = False
        cmd_analyze(DefaultArgs())


if __name__ == "__main__":
    main()