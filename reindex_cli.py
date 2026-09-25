"""
AI Studio 离线索引重建与诊断探针工具 (带 tqdm 细粒度进度条与 WAL 实时监控)

使用方式:
  python reindex_cli.py
  python reindex_cli.py --batch-checkpoint 200 --no-vacuum
"""

import argparse
import os
import sys
import time
from tqdm import tqdm

from src.analyzer.cache import SQLiteCache
from src.analyzer.parser import parse_prompt_json


def get_file_size_str(filepath: str) -> str:
    """获取人类友好的文件大小表示"""
    if not os.path.exists(filepath):
        return "0 B"
    size_bytes = os.path.getsize(filepath)
    for unit in ["B", "KB", "MB", "GB"]:
        if size_bytes < 1024.0:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024.0
    return f"{size_bytes:.1f} TB"


def main():
    parser = argparse.ArgumentParser(description="AI Studio 离线索引重建与诊断工具")
    parser.add_argument(
        "--cache-dir", default=".cache", help="缓存目录路径 (默认: .cache)"
    )
    parser.add_argument(
        "--batch-checkpoint",
        type=int,
        default=300,
        help="每处理多少条会话主动执行一次 WAL Checkpoint (默认: 300)",
    )
    parser.add_argument(
        "--no-vacuum", action="store_true", help="跳过最终的 VACUUM 碎片压缩"
    )
    args = parser.parse_args()

    cache = SQLiteCache(cache_dir=args.cache_dir)
    db_path = cache.db_path
    wal_path = f"{db_path}-wal"

    print("=" * 65)
    print("🛠️  AI Studio 离线索引重建工具 (Index & FTS Rebuilder)")
    print("=" * 65)
    print(f"📁 目标数据库: {db_path} ({get_file_size_str(db_path)})")
    print(f"📦 WAL 日志体: {wal_path} ({get_file_size_str(wal_path)})")

    # 1. 扫描读取全部待处理 file_id
    print("\n🔍 正在获取 file_cache 全量记录 ID 清单...")
    t0 = time.time()
    file_records = []
    with cache._get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT file_id, modified_time FROM file_cache;")
        file_records = cursor.fetchall()

    total_files = len(file_records)
    if total_files == 0:
        print("❌ file_cache 中未检索到任何会话记录，无需重建。")
        return

    print(f"✅ 成功加载 {total_files} 条记录元信息 (耗时: {time.time() - t0:.2f}s)")

    # 2. 清理旧索引结构
    print("🧹 正在清空旧版二级索引 (session_index) 与 FTS5 全文虚表 (session_fts)...")
    cache.clear_indices()
    print("✨ 旧索引与虚表已重置完成，准备写入新索引。\n")

    # 3. 循环带进度条解析与索引构建
    success_count = 0
    parse_failed_count = 0
    t_start = time.time()

    with tqdm(
        total=total_files,
        desc="🔨 重建进度",
        unit="会话",
        bar_format="{l_bar}{bar:30}{r_bar}",
        colour="green",
    ) as pbar:
        for idx, row in enumerate(file_records, start=1):
            file_id = row["file_id"]
            mtime = row["modified_time"]

            # 抓取单条原始 JSON
            raw_data = cache.get(file_id)
            if not raw_data:
                parse_failed_count += 1
                pbar.update(1)
                continue

            file_meta = {
                "id": file_id,
                "modifiedTime": mtime or raw_data.get("modifiedTime"),
                "name": raw_data.get("name", "Untitled"),
            }

            try:
                session = parse_prompt_json(file_meta, raw_data)
                if session:
                    cache.upsert_session_index(session)
                    cache.upsert_session_fts(session)
                    success_count += 1
                else:
                    parse_failed_count += 1
            except Exception:
                parse_failed_count += 1

            # 周期性平抑 WAL 体积
            if idx % args.batch_checkpoint == 0:
                try:
                    cache.checkpoint(truncate=False)
                except Exception:
                    pass

            # 刷新状态栏监控指标 (每 20 条采样一次文件大小，降低系统调用开销)
            if idx % 20 == 0 or idx == total_files:
                wal_size = get_file_size_str(wal_path)
                pbar.set_postfix(
                    {
                        "成功": success_count,
                        "跳过": parse_failed_count,
                        "WAL体积": wal_size,
                    }
                )

            pbar.update(1)

    elapsed = time.time() - t_start
    print(
        f"\n🎉 索引构建完成！有效写入: {success_count} 条, 失败/跳过: {parse_failed_count} 条"
    )
    print(
        f"⏱️  纯处理耗时: {elapsed:.2f} 秒 (平均 {(elapsed / total_files * 1000):.1f} ms/条)"
    )

    # 4. 彻底截断 WAL 并清理碎片
    print("\n📦 正在执行最终 WAL Checkpoint (TRUNCATE) 并刷回磁盘...")
    try:
        busy, log_pages, ckpt_pages = cache.checkpoint(truncate=True)
        print(
            f"✅ Checkpoint 完成 (busy={busy}, log_pages={log_pages}, ckpt_pages={ckpt_pages})"
        )
    except Exception as e:
        print(f"⚠️ Checkpoint 异常: {e}")

    if not args.no_vacuum:
        print("🗜️  正在执行 VACUUM 碎片整理与磁盘空间压缩...")
        t_vac = time.time()
        try:
            cache.vacuum()
            print(f"✅ VACUUM 完成 (耗时: {time.time() - t_vac:.2f}s)")
        except Exception as e:
            print(f"⚠️ VACUUM 异常: {e}")

    print("\n" + "=" * 65)
    print("📊 最终数据库与日志体积状态:")
    print(f"  - 主库文件 cache.db:     {get_file_size_str(db_path)}")
    print(f"  - WAL 日志 cache.db-wal: {get_file_size_str(wal_path)}")
    print("=" * 65)


if __name__ == "__main__":
    main()