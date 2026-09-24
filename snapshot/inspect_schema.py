"""
AI Studio 缓存数据 Schema 探针脚本 (支持长文本与 Base64 压缩展示)
"""
import glob
import json
import os
from collections import Counter, defaultdict
from typing import Any, Dict, List


def truncate_large_content(obj: Any, max_str_len: int = 80) -> Any:
    """
    递归截断并压缩过长的字段值（尤其是 inlineFile.data、长 text 等）。
    """
    if isinstance(obj, str):
        if len(obj) > max_str_len:
            head = obj[: max_str_len // 2]
            tail = obj[-max_str_len // 4 :]
            return f"{head}...[已折叠 {len(obj)} 字符]...{tail}"
        return obj
    elif isinstance(obj, dict):
        return {k: truncate_large_content(v, max_str_len) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [truncate_large_content(item, max_str_len) for item in obj]
    return obj


def get_shape_summary(obj: Any, depth: int = 0, max_depth: int = 2) -> Any:
    """递归提取 JSON 的数据结构拓扑骨架"""
    if depth >= max_depth:
        return type(obj).__name__

    if isinstance(obj, dict):
        return {k: get_shape_summary(v, depth + 1, max_depth) for k, v in obj.items()}
    elif isinstance(obj, list):
        if not obj:
            return "[] (empty)"
        return [get_shape_summary(obj[0], depth + 1, max_depth)]
    else:
        return type(obj).__name__


def inspect_cache_files(cache_dir: str = ".cache", str_truncate_limit: int = 80):
    db_path = os.path.join(cache_dir, "cache.db")
    records = []

    # 优先从 SQLite 加载
    if os.path.exists(db_path):
        from src.analyzer.cache import SQLiteCache
        cache = SQLiteCache(cache_dir=cache_dir)
        total_in_db = cache.count()
        if total_in_db > 0:
            print(f"🔍 发现 SQLite 数据库 ({db_path})，共包含 {total_in_db} 条缓存记录，正在分析...\n")
            for file_id, _, data in cache.iter_all_data():
                records.append((f"{file_id}.json", data))

    # 若 SQLite 无数据，回退至扫描平铺 JSON
    if not records:
        files = glob.glob(os.path.join(cache_dir, "*.json"))
        files = [f for f in files if not f.endswith("index.json")]

        if not files:
            print(f"❌ 在 {cache_dir} 下未找到任何已缓存的对话数据 (SQLite 或 JSON)。")
            return

        print(f"🔍 发现 {len(files)} 个平铺 JSON 缓存文件，正在分析数据格式...\n")
        for fpath in files:
            file_name = os.path.basename(fpath)
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                records.append((file_name, data))
            except Exception as e:
                corrupted_files.append((file_name, str(e)))
                continue

    top_level_keys_counter = Counter()
    schema_signatures = defaultdict(list)
    chunk_types_counter = Counter()
    corrupted_files = []

    for file_name, data in records:
        if not isinstance(data, dict):
            continue

        # 1. 统计顶层键名
        keys_tuple = tuple(sorted(data.keys()))
        top_level_keys_counter.update(keys_tuple)

        # 2. 统计 chunks 内部载荷形态 (text, driveDocument, inlineFile 等)
        chunks = data.get("chunkedPrompt", {}).get("chunks", [])
        for chunk in chunks:
            payload_types = [k for k in chunk.keys() if k not in ("role", "tokenCount", "createTime")]
            chunk_types_counter[", ".join(sorted(payload_types))] += 1

        # 3. 记录不同结构签名的代表文件
        sig_str = json.dumps(get_shape_summary(data, max_depth=2), ensure_ascii=False, sort_keys=True)
        if len(schema_signatures[sig_str]) < 2:
            schema_signatures[sig_str].append((file_name, data))

    # --- 打印分析结果 ---

    print("=" * 30 + " 1. 顶层 Key 出现频率 " + "=" * 30)
    for key, count in top_level_keys_counter.most_common():
        percentage = round((count / len(files)) * 100, 1)
        print(f"  - {key:<25} : 出现 {count} 次 ({percentage}%)")

    print("\n" + "=" * 30 + " 2. 对话载荷类型分布 (Chunk Payloads) " + "=" * 30)
    for p_type, count in chunk_types_counter.most_common():
        label = p_type if p_type else "(仅元数据/空)"
        print(f"  - 载荷形态 [{label}]: 出现 {count} 次")

    print("\n" + "=" * 30 + " 3. 典型数据骨架 (已开启长文本折叠) " + "=" * 30)
    for idx, (sig, samples) in enumerate(schema_signatures.items(), start=1):
        sample_names = [s[0] for s in samples]
        raw_sample = samples[0][1]
        print(f"\n▶ 格式形态 #{idx} (命中样本: {sample_names}):")
        print(json.dumps(json.loads(sig), indent=2, ensure_ascii=False))

        # 核心对话探测，使用截断输出
        print("  💡 核心对话字段探测 (采样首个 Chunk):")
        chunks = raw_sample.get("chunkedPrompt", {}).get("chunks", [])
        if chunks:
            sample_chunk = chunks[0]
            # 深度截断长文本 / Base64 数据
            compressed_chunk = truncate_large_content(sample_chunk, max_str_len=str_truncate_limit)
            print(f"    - Chunk 结构示例:")
            print("      " + json.dumps(compressed_chunk, ensure_ascii=False))

        sys_inst = raw_sample.get("systemInstruction", {})
        if sys_inst:
            compressed_sys = truncate_large_content(sys_inst, max_str_len=str_truncate_limit)
            print(f"    - 系统指令: {json.dumps(compressed_sys, ensure_ascii=False)}")

    if corrupted_files:
        print("\n" + "=" * 30 + " 异常/非有效 JSON 文件 " + "=" * 30)
        for fname, err in corrupted_files:
            print(f"  - {fname}: {err}")


if __name__ == "__main__":
    inspect_cache_files(".cache", str_truncate_limit=80)
