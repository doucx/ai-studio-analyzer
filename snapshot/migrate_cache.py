"""
AI Studio Analyzer 缓存迁移工具：将 .cache 平铺 JSON 数据迁移至 SQLite (cache.db)
"""
import argparse
import os
import sys
from tqdm import tqdm
from src.analyzer.cache import SQLiteCache


def parse_args():
    parser = argparse.ArgumentParser(description="将平铺 JSON 缓存迁移至 SQLite 单文件数据库")
    parser.add_argument(
        "--cache-dir",
        default=".cache",
        help="当前旧缓存所在的目录路径（默认: .cache）"
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="迁移并校验成功后，自动删除旧的平铺 JSON 文件及 index.json（释放磁盘空间与 Inode）"
    )
    return parser.parse_args()


def main():
    args = parse_args()
    cache_dir = args.cache_dir

    if not os.path.isdir(cache_dir):
        print(f"❌ 目录不存在: {cache_dir}")
        sys.exit(1)

    all_files = os.listdir(cache_dir)
    json_files = [f for f in all_files if f.endswith(".json") and f != "index.json"]
    total_json = len(json_files)

    print("=" * 60)
    print("📦 开始执行 AI Studio 缓存迁移 (Flat JSON -> SQLite WAL)")
    print(f"📁 缓存目录: {os.path.abspath(cache_dir)}")
    print(f"🔍 待迁移 JSON 文件数: {total_json}")
    print("=" * 60)

    if total_json == 0:
        print("ℹ️ 未发现需要迁移的平铺 JSON 文件。")
        return

    # 初始化 SQLite 缓存器
    cache = SQLiteCache(cache_dir=cache_dir, db_name="cache.db")
    before_count = cache.count()

    print(f"⚡ 正在批量将数据写入 SQLite (事务模式)...")
    success_count, skip_count = cache.migrate_from_directory(old_cache_dir=cache_dir)
    after_count = cache.count()

    print("\n" + "=" * 30 + " 📊 迁移完成报告 " + "=" * 30)
    print(f"  - 成功导入记录数: {success_count}")
    print(f"  - 异常跳过文件数: {skip_count}")
    print(f"  - 迁移前 SQLite 条目: {before_count}")
    print(f"  - 迁移后 SQLite 条目: {after_count}")
    print(f"  - 数据库文件位置: {cache.db_path}")
    print("=" * 68)

    # 清理旧平铺文件（如果用户指定了 --clean）
    if args.clean:
        print("\n🧹 正在清理旧的平铺 JSON 文件...")
        removed_count = 0
        for fname in tqdm(json_files, desc="清理进度", unit="file"):
            try:
                os.remove(os.path.join(cache_dir, fname))
                removed_count += 1
            except Exception:
                pass

        index_path = os.path.join(cache_dir, "index.json")
        if os.path.exists(index_path):
            try:
                os.remove(index_path)
            except Exception:
                pass

        print(f"✅ 清理完成：已安全移除 {removed_count} 个平铺 JSON 文件及 index.json。")
    else:
        print("\n💡 提示：原平铺 JSON 文件仍保留在磁盘上。")
        print("   如果你确认迁移后的数据正常，可手动删除或再次运行 `python migrate_cache.py --clean` 释放磁盘空间。")


if __name__ == "__main__":
    main()