"""
AI Studio Cache 健康度诊断与上下文认知假设验证探针 (只读模式，无锁零侵入)

使用方式:
  python inspect_health.py
  python inspect_health.py --cache-dir .cache
"""

import argparse
import os
import sqlite3
import sys
import time
from typing import Dict, List, Optional


def format_bytes(size: float) -> str:
    for unit in ["B", "KB", "MB", "GB"]:
        if size < 1024.0:
            return f"{size:.2f} {unit}"
        size /= 1024.0
    return f"{size:.2f} TB"


def format_num(n: int | float) -> str:
    if isinstance(n, int):
        return f"{n:,}"
    return f"{n:,.1f}"


def get_quantiles(values: List[float]) -> Dict[str, float]:
    if not values:
        return {"min": 0, "p10": 0, "p50": 0, "p75": 0, "p90": 0, "p99": 0, "max": 0}
    s = sorted(values)
    n = len(s)

    def q(pct: float) -> float:
        idx = int(n * pct)
        return s[min(idx, n - 1)]

    return {
        "min": s[0],
        "p10": q(0.10),
        "p50": q(0.50),
        "p75": q(0.75),
        "p90": q(0.90),
        "p99": q(0.99),
        "max": s[-1],
    }


def main():
    parser = argparse.ArgumentParser(description="AI Studio Cache 健康度与假设探针")
    parser.add_argument("--cache-dir", default=".cache", help="缓存目录路径 (默认: .cache)")
    args = parser.parse_args()

    db_path = os.path.join(args.cache_dir, "cache.db")
    wal_path = f"{db_path}-wal"

    if not os.path.exists(db_path):
        print(f"❌ 找不到数据库文件: {db_path}")
        sys.exit(1)

    print("=" * 70)
    print("🩺 AI Studio 缓存健康度诊断 & 认知假设验证报告")
    print("=" * 70)

    # 1. 物理与存储层基础检查 (只读打开，不写日志)
    db_size = os.path.getsize(db_path)
    wal_size = os.path.getsize(wal_path) if os.path.exists(wal_path) else 0

    conn = sqlite3.connect(f"file:{os.path.abspath(db_path)}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("PRAGMA page_size;")
    page_size = cursor.fetchone()[0]

    cursor.execute("PRAGMA page_count;")
    page_count = cursor.fetchone()[0]

    cursor.execute("PRAGMA freelist_count;")
    freelist_count = cursor.fetchone()[0]

    free_bytes = freelist_count * page_size
    frag_ratio = (free_bytes / db_size * 100) if db_size > 0 else 0

    # 完整性校验
    t0 = time.time()
    cursor.execute("PRAGMA quick_check;")
    check_res = cursor.fetchone()[0]
    check_time = time.time() - t0

    print("\n📁 [1. 物理层健康度 (Physical Health)]")
    print(f"  - 数据库文件 cache.db:      {format_bytes(db_size)} ({page_count} pages)")
    print(f"  - WAL 日志文件 cache.db-wal: {format_bytes(wal_size)}")
    print(f"  - 碎片空间 (Freelist):       {format_bytes(free_bytes)} (空闲占比: {frag_ratio:.1f}%)")
    print(f"  - 完整性校验 (Quick Check):  {check_res} (耗时: {check_time:.2f}s)")

    # 2. 表级一致性诊断
    def get_table_count(name: str) -> Optional[int]:
        try:
            cursor.execute(f"SELECT COUNT(*) FROM {name};")
            return cursor.fetchone()[0]
        except Exception:
            return None

    raw_count = get_table_count("file_cache") or 0
    idx_count = get_table_count("session_index") or 0
    fts_count = get_table_count("session_fts")

    print("\n🔗 [2. 逻辑层同步一致性 (Schema Consistency)]")
    print(f"  - 原始缓存文件数 (file_cache):    {format_num(raw_count)} 场")
    print(f"  - 二级聚合索引数 (session_index): {format_num(idx_count)} 场")
    print(f"  - 全文倒排索引数 (session_fts):   {format_num(fts_count) if fts_count is not None else '未创建'} 场")

    diff = raw_count - idx_count
    if diff == 0:
        print("  ✅ 索引状态: 100% 完整对齐，无遗漏未解析会话")
    else:
        print(f"  ⚠️  索引状态: 存在 {abs(diff)} 条未同步记录，建议运行 python reindex_cli.py 重建")

    if idx_count == 0:
        print("\n⚠️  session_index 为空，无法继续执行统计假设验证。")
        conn.close()
        return

    # 3. 核心统计指标与分位数提取
    cursor.execute("""
        SELECT 
            turn_count, 
            total_tokens, 
            thought_tokens, 
            duration_seconds / 60.0 AS duration_min,
            user_char_count,
            has_branching,
            branch_count,
            model
        FROM session_index;
    """)
    rows = cursor.fetchall()

    turn_counts = [r["turn_count"] for r in rows]
    total_tokens = [r["total_tokens"] for r in rows]
    thought_tokens = [r["thought_tokens"] for r in rows]
    durations = [r["duration_min"] for r in rows]
    user_chars = [r["user_char_count"] for r in rows]

    q_turns = get_quantiles(turn_counts)
    q_tokens = get_quantiles(total_tokens)
    q_thought = get_quantiles(thought_tokens)
    q_dur = get_quantiles(durations)
    q_chars = get_quantiles(user_chars)

    print("\n📊 [3. 核心指标分位数阶梯 (Quantile Distributions)]")
    print(f"{'指标项':<18} | {'Min':>8} | {'P10':>8} | {'P50 (中位)':>10} | {'P75':>8} | {'P90':>8} | {'P99':>9} | {'Max':>10}")
    print("-" * 92)
    print(f"{'对话轮次 (Turns)':<18} | {q_turns['min']:>8.0f} | {q_turns['p10']:>8.0f} | {q_turns['p50']:>10.0f} | {q_turns['p75']:>8.0f} | {q_turns['p90']:>8.0f} | {q_turns['p99']:>9.0f} | {q_turns['max']:>10.0f}")
    print(f"{'总 Token 消耗':<18} | {format_num(q_tokens['min']):>8} | {format_num(q_tokens['p10']):>8} | {format_num(q_tokens['p50']):>10} | {format_num(q_tokens['p75']):>8} | {format_num(q_tokens['p90']):>8} | {format_num(q_tokens['p99']):>9} | {format_num(q_tokens['max']):>10}")
    print(f"{'思考链 (Thinking)':<18} | {format_num(q_thought['min']):>8} | {format_num(q_thought['p10']):>8} | {format_num(q_thought['p50']):>10} | {format_num(q_thought['p75']):>8} | {format_num(q_thought['p90']):>8} | {format_num(q_thought['p99']):>9} | {format_num(q_thought['max']):>10}")
    print(f"{'持续时长 (分钟)':<18} | {q_dur['min']:>8.1f} | {q_dur['p10']:>8.1f} | {q_dur['p50']:>10.1f} | {q_dur['p75']:>8.1f} | {q_dur['p90']:>8.1f} | {q_dur['p99']:>9.1f} | {q_dur['max']:>10.1f}")
    print(f"{'用户输入 (字符数)':<18} | {format_num(q_chars['min']):>8} | {format_num(q_chars['p10']):>8} | {format_num(q_chars['p50']):>10} | {format_num(q_chars['p75']):>8} | {format_num(q_chars['p90']):>8} | {format_num(q_chars['p99']):>9} | {format_num(q_chars['max']):>10}")

    # 4. 假设切片验证
    print("\n🎯 [4. 上下文长度与认知假设切片]")

    # 假设 A: 上下文长度梯队
    tok_under_8k = sum(1 for t in total_tokens if t < 8_192)
    tok_8k_32k = sum(1 for t in total_tokens if 8_192 <= t < 32_768)
    tok_32k_128k = sum(1 for t in total_tokens if 32_768 <= t < 131_072)
    tok_over_128k = sum(1 for t in total_tokens if t >= 131_072)

    print("  🔹 假设 A: 对话上下文长度梯队 (Context Length Buckets):")
    print(f"    - 轻量快问 (< 8k tokens):        {tok_under_8k:>5} 场 ({tok_under_8k/len(rows)*100:>5.1f}%)")
    print(f"    - 标准推进 (8k ~ 32k tokens):    {tok_8k_32k:>5} 场 ({tok_8k_32k/len(rows)*100:>5.1f}%)")
    print(f"    - 深度攻坚 (32k ~ 128k tokens):  {tok_32k_128k:>5} 场 ({tok_32k_128k/len(rows)*100:>5.1f}%)")
    print(f"    - 巨型长文 (≥ 128k tokens):      {tok_over_128k:>5} 场 ({tok_over_128k/len(rows)*100:>5.1f}%)")

    # 假设 B: 对话轮次深度
    single_turn = sum(1 for t in turn_counts if t == 1)
    light_turn = sum(1 for t in turn_counts if 2 <= t <= 4)
    deep_turn = sum(1 for t in turn_counts if 5 <= t <= 15)
    epic_turn = sum(1 for t in turn_counts if t > 15)

    print("\n  🔹 假设 B: 交互轮次心智深度 (Turn Depth Buckets):")
    print(f"    - 单轮快问 (1 轮结束):          {single_turn:>5} 场 ({single_turn/len(rows)*100:>5.1f}%)")
    print(f"    - 轻量追问 (2 ~ 4 轮):           {light_turn:>5} 场 ({light_turn/len(rows)*100:>5.1f}%)")
    print(f"    - 深度讨论 (5 ~ 15 轮):          {deep_turn:>5} 场 ({deep_turn/len(rows)*100:>5.1f}%)")
    print(f"    - 长线马拉松 (> 15 轮):          {epic_turn:>5} 场 ({epic_turn/len(rows)*100:>5.1f}%)")

    # 假设 C: 思考链 (Thinking Process)
    thinking_sessions = sum(1 for t in thought_tokens if t > 0)
    sum_total_tokens = sum(total_tokens)
    sum_thought_tokens = sum(thought_tokens)
    thought_ratio = (sum_thought_tokens / sum_total_tokens * 100) if sum_total_tokens > 0 else 0

    print("\n  🔹 假设 C: 思考链 (Thinking) 渗透率与占比:")
    print(f"    - 触发思考链的会话数:            {thinking_sessions:>5} 场 ({thinking_sessions/len(rows)*100:>5.1f}%)")
    print(f"    - 思考链消耗占总 Token 比例:     {thought_ratio:>5.2f}% ({format_num(sum_thought_tokens)} / {format_num(sum_total_tokens)})")

    # 假设 D: 思维摩擦力与分支
    branch_sessions = sum(1 for r in rows if r["has_branching"])
    total_retries = sum(r["branch_count"] for r in rows)
    print("\n  🔹 假设 D: 思维阻抗与重试分支 (Friction & Branches):")
    print(f"    - 发生分叉/编辑重试的会话:       {branch_sessions:>5} 场 ({branch_sessions/len(rows)*100:>5.1f}%)")
    print(f"    - 累计重试分支总次数:            {total_retries:>5} 次")

    # 5. 极端“毒丸/怪兽”样本 (Outlier Hunter)
    print("\n🚨 [5. 极端长尾“毒丸”样本排查 (Top Outliers)]")

    # 5.1 单条 JSON 体积最大的前 3 个会话 (从 file_cache 探测)
    cursor.execute("""
        SELECT file_id, LENGTH(data) AS byte_len 
        FROM file_cache 
        ORDER BY byte_len DESC 
        LIMIT 3;
    """)
    top_large_files = cursor.fetchall()
    print("  📦 单条原始 JSON 体积最大 Top 3 (易造成反序列化卡顿):")
    for rank, row in enumerate(top_large_files, start=1):
        # 关联标题
        cursor.execute("SELECT name FROM session_index WHERE file_id = ?;", (row["file_id"],))
        srow = cursor.fetchone()
        name = srow["name"] if srow else "未知会话"
        print(f"    #{rank}. [{format_bytes(row['byte_len']):>9}] ID: {row['file_id']} - {name[:36]}")

    # 5.2 Token 消耗最大的前 3 个会话
    cursor.execute("""
        SELECT file_id, name, total_tokens, thought_tokens 
        FROM session_index 
        ORDER BY total_tokens DESC 
        LIMIT 3;
    """)
    top_tok = cursor.fetchall()
    print("\n  ⚡ Token 能耗最高 Top 3:")
    for rank, row in enumerate(top_tok, start=1):
        print(f"    #{rank}. [{format_num(row['total_tokens']):>9} tok] (思考: {format_num(row['thought_tokens'])}) ID: {row['file_id']} - {row['name'][:34]}")

    # 5.3 交互轮次最多的前 3 个会话
    cursor.execute("""
        SELECT file_id, name, turn_count, duration_human 
        FROM session_index 
        ORDER BY turn_count DESC 
        LIMIT 3;
    """)
    top_turns = cursor.fetchall()
    print("\n  🔄 轮次最深 Top 3:")
    for rank, row in enumerate(top_turns, start=1):
        print(f"    #{rank}. [{row['turn_count']:>4} 轮 | {row['duration_human']:>7}] ID: {row['file_id']} - {row['name'][:42]}")

    print("\n" + "=" * 70)
    print("💡 架构启示与结论总结:")
    p50_tok = q_tokens['p50']
    p90_tok = q_tokens['p90']
    print(f"  1. 绝大多数日常会话在 {p50_tok:.0f} Token 左右，但长尾 P90 跃升至 {p90_tok:.0f} Token。")
    print(f"  2. 单轮即走的会话占比达 {single_turn/len(rows)*100:.1f}%，列表虚拟滚动无需为默认项保留深层展开负担。")
    if top_large_files and top_large_files[0]["byte_len"] > 10 * 1024 * 1024:
        print(f"  3. 存在体积超 10MB 的怪兽会话 ({format_bytes(top_large_files[0]['byte_len'])})，详情面板必须继续使用按需惰性加载。")
    print("=" * 70)

    conn.close()


if __name__ == "__main__":
    main()