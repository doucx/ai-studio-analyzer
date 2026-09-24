"""
AI Studio 缓存数据 Schema 探针脚本 (直接基于 SQLite WAL 数据库，支持长文本与 Base64 压缩展示)
"""
import json
import os
from collections import Counter, defaultdict
from typing import Any
from src.analyzer.cache import SQLiteCache


def truncate_large_content(obj: Any, max_str_len: int = 80) -> Any:
    """递归截断并压缩过长的字段值（特别是 inlineFile.data、超长 text 等）"""
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


def inspect_cache_database(cache_dir: str = ".cache", str_truncate_limit: int = 80):
    cache = SQLiteCache(cache_dir=cache_dir)
    total_records = cache.count()

    if total_records == 0:
        print(f"❌ 在 {cache.db_path} 中未发现任何已缓存的会话记录。")
        return

    print(f"🔍 正在从 SQLite 数据库 ({cache.db_path}) 分析 {total_records} 条缓存记录...\n")

    top_level_keys_counter = Counter()
    schema_signatures = defaultdict(list)
    chunk_types_counter = Counter()

    for file_id, _, data in cache.iter_all_data():
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

        # 3. 记录不同结构签名的代表样本
        sig_str = json.dumps(get_shape_summary(data, max_depth=2), ensure_ascii=False, sort_keys=True)
        if len(schema_signatures[sig_str]) < 2:
            schema_signatures[sig_str].append((file_id, data))

    # --- 打印分析结果 ---

    print("=" * 30 + " 1. 顶层 Key 出现频率 " + "=" * 30)
    for key, count in top_level_keys_counter.most_common():
        percentage = round((count / total_records) * 100, 1)
        print(f"  - {key:<25} : 出现 {count} 次 ({percentage}%)")

    print("\n" + "=" * 30 + " 2. 对话载荷类型分布 (Chunk Payloads) " + "=" * 30)
    for p_type, count in chunk_types_counter.most_common():
        label = p_type if p_type else "(仅元数据/空)"
        print(f"  - 载荷形态 [{label}]: 出现 {count} 次")

    print("\n" + "=" * 30 + " 3. 典型数据骨架 (已开启长文本折叠) " + "=" * 30)
    for idx, (sig, samples) in enumerate(schema_signatures.items(), start=1):
        sample_ids = [s[0] for s in samples]
        raw_sample = samples[0][1]
        print(f"\n▶ 格式形态 #{idx} (命中样本 File ID: {sample_ids}):")
        print(json.dumps(json.loads(sig), indent=2, ensure_ascii=False))

        print("  💡 核心对话字段探测 (采样首个 Chunk):")
        chunks = raw_sample.get("chunkedPrompt", {}).get("chunks", [])
        if chunks:
            sample_chunk = chunks[0]
            compressed_chunk = truncate_large_content(sample_chunk, max_str_len=str_truncate_limit)
            print(f"    - Chunk 结构示例:")
            print("      " + json.dumps(compressed_chunk, ensure_ascii=False))

        sys_inst = raw_sample.get("systemInstruction", {})
        if sys_inst:
            compressed_sys = truncate_large_content(sys_inst, max_str_len=str_truncate_limit)
            print(f"    - 系统指令: {json.dumps(compressed_sys, ensure_ascii=False)}")


if __name__ == "__main__":
    inspect_cache_database(".cache", str_truncate_limit=80)