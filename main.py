"""
AI Studio Analyzer 统一调度入口
"""
import argparse
import sys
from tqdm import tqdm
from src.analyzer.drive import DriveClient, PROXY_URL
from src.analyzer.cache import LocalCache
from src.analyzer.parser import is_valid_prompt_file, parse_prompt_json
from src.analyzer.metrics import calculate_session_metrics
from src.analyzer.exporter import export_first_prompts_to_jsonl, export_prompts_summary_csv


def parse_args():
    parser = argparse.ArgumentParser(description="Google AI Studio 历史对话分析器")
    parser.add_argument(
        "-n", "--limit",
        type=int,
        default=100,
        help="拉取文件的最大数量限制（默认拉取最新的 100 个；设为 0 或使用 --all 则全量拉取）"
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="全量拉取云盘中所有文件（会忽略 --limit）"
    )
    return parser.parse_args()


def main():
    args = parse_args()
    limit = None if (args.all or args.limit <= 0) else args.limit

    print("=" * 60)
    print("🚀 启动 Google AI Studio 历史提问分析器")
    if limit:
        print(f"📌 当前运行模式: [最新优先抽样] 最多拉取最近的 {limit} 个文件 (使用 --all 可全量拉取)")
    else:
        print("📌 当前运行模式: [全量同步] 正在扫描全量文件...")
    print("=" * 60)

    # 1. 初始化客户端与本地缓存
    client = DriveClient(proxy_url=PROXY_URL)
    cache = LocalCache(cache_dir=".cache")

    # 2. 定位 AI Studio 目录
    folder_id = client.find_ai_studio_folder()
    if not folder_id:
        print("❌ 未能找到 Google AI Studio 目录，请检查云盘授权。")
        sys.exit(1)

    # 3. 按时间降序拉取文件元数据列表
    print("\n📥 正在获取云盘文件列表 (按最后修改时间降序)...")
    files = client.list_files(folder_id=folder_id, max_results=limit, order_by="modifiedTime desc")
    print(f"📊 成功检索到 {len(files)} 个待匹配文件。")

    # 4. 过滤有效文件名
    valid_file_metas = [f for f in files if is_valid_prompt_file(f.get("name", ""))]
    print(f"🔍 剔除图片/粘贴板临时项后，共 {len(valid_file_metas)} 个待解析对话。")

    # 5. 带 tqdm 进度条的增量同步与解析
    sessions = []
    download_count = 0
    cache_hit_count = 0

    print("\n⚡ 开始同步与解析对话内容：")
    with tqdm(valid_file_metas, desc="处理进度", unit="file") as pbar:
        for fmeta in pbar:
            fid = fmeta["id"]
            mtime = fmeta.get("modifiedTime", "")

            # 缓存检测
            if cache.is_cached(fid, mtime):
                raw_data = cache.get(fid)
                cache_hit_count += 1
            else:
                raw_data = client.download_json(fid)
                if raw_data:
                    cache.put(fid, mtime, raw_data)
                    download_count += 1

            pbar.set_postfix({
                "缓存命中": cache_hit_count,
                "云端拉取": download_count
            })

            session = parse_prompt_json(fmeta, raw_data)
            if session:
                sessions.append(session)

    print(f"\n✅ 数据载入完成：成功解析有效会话 {len(sessions)} 个 (本地缓存命中: {cache_hit_count}, 云端拉取: {download_count})")

    if not sessions:
        print("⚠️ 未解析到有效对话内容。")
        return

    # 6. 指标概览
    metrics = calculate_session_metrics(sessions)
    print("\n" + "=" * 30 + " 📊 核心指标概览 " + "=" * 30)
    print(f"  - 分析会话数:         {metrics['total_sessions']}")
    print(f"  - 总对话轮次 (Turns): {metrics['total_turns']} (平均每会话: {metrics['avg_turns_per_session']} 轮)")
    print(f"  - 深度攻坚会话 (≥5轮): {metrics['deep_session_count']} 场 (占比 {metrics['deep_session_ratio']})")
    print(f"  - 用户提问总字数:     {metrics['total_user_chars']} 字符")
    print(f"  - 模型使用分布:       {metrics['model_distribution']}")
    print("=" * 76)

    # 7. 导出产物
    jsonl_output = "first_prompts_for_clustering.jsonl"
    csv_output = "prompts_summary.csv"
    export_first_prompts_to_jsonl(sessions, jsonl_output)
    export_prompts_summary_csv(sessions, csv_output)

    print(f"\n📁 分析产物已生成：")
    print(f"  1. 首轮提问清洗集 (用于 LLM 意图聚类): ./{jsonl_output}")
    print(f"  2. 对话概览指标明细 (CSV 报表):        ./{csv_output}")


if __name__ == "__main__":
    main()