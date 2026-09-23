"""
AI Studio Analyzer 统一调度入口
"""
import sys
from src.analyzer.drive import DriveClient, PROXY_URL
from src.analyzer.cache import LocalCache
from src.analyzer.parser import is_valid_prompt_file, parse_prompt_json
from src.analyzer.metrics import calculate_session_metrics
from src.analyzer.exporter import export_first_prompts_to_jsonl, export_prompts_summary_csv


def main():
    print("=" * 60)
    print("🚀 启动 Google AI Studio 历史提问分析器")
    print("=" * 60)

    # 1. 初始化客户端与本地缓存
    client = DriveClient(proxy_url=PROXY_URL)
    cache = LocalCache(cache_dir=".cache")

    # 2. 定位 AI Studio 目录
    folder_id = client.find_ai_studio_folder()
    if not folder_id:
        print("❌ 未能找到 Google AI Studio 目录，请检查云盘授权。")
        sys.exit(1)

    # 3. 拉取文件元数据列表
    print("📥 正在扫描云盘中的对话文件元数据...")
    files = client.list_files(folder_id)
    print(f"📊 云盘总计包含 {len(files)} 个文件。")

    # 4. 增量拉取与解析
    sessions = []
    download_count = 0
    cache_hit_count = 0

    print("⚡ 正在解析对话内容（支持本地增量缓存）...")
    for idx, fmeta in enumerate(files, 1):
        fid = fmeta["id"]
        fname = fmeta.get("name", "")
        mtime = fmeta.get("modifiedTime", "")

        if not is_valid_prompt_file(fname):
            continue

        # 缓存命中检测
        if cache.is_cached(fid, mtime):
            raw_data = cache.get(fid)
            cache_hit_count += 1
        else:
            raw_data = client.download_json(fid)
            if raw_data:
                cache.put(fid, mtime, raw_data)
                download_count += 1

        session = parse_prompt_json(fmeta, raw_data)
        if session:
            sessions.append(session)

    print(f"\n✅ 数据载入完成：有效会话 {len(sessions)} 个 (本地缓存命中: {cache_hit_count}, 新拉取: {download_count})")

    # 5. 指标概览
    metrics = calculate_session_metrics(sessions)
    print("\n" + "=" * 30 + " 📊 核心指标概览 " + "=" * 30)
    print(f"  - 总有效会话数:       {metrics['total_sessions']}")
    print(f"  - 总对话轮次 (Turns): {metrics['total_turns']} (平均每会话: {metrics['avg_turns_per_session']} 轮)")
    print(f"  - 深度攻坚会话 (≥5轮): {metrics['deep_session_count']} 场 (占比 {metrics['deep_session_ratio']})")
    print(f"  - 用户提问总字数:     {metrics['total_user_chars']} 字符")
    print(f"  - 模型使用分布:       {metrics['model_distribution']}")
    print("=" * 76)

    # 6. 导出产物
    jsonl_output = "first_prompts_for_clustering.jsonl"
    csv_output = "prompts_summary.csv"
    export_first_prompts_to_jsonl(sessions, jsonl_output)
    export_prompts_summary_csv(sessions, csv_output)

    print(f"\n📁 分析产物已生成：")
    print(f"  1. 首轮提问清洗集 (可直接供 LLM 聚类分类): ./{jsonl_output}")
    print(f"  2. 对话概览指标明细 (CSV 报表):             ./{csv_output}")


if __name__ == "__main__":
    main()