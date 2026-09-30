"""
AI Studio Analyzer - 认知资产与 Token 分层剥离审计脚本
用法:
  python scripts/analyze_token_breakdown.py
  python scripts/analyze_token_breakdown.py --top 5
"""

import argparse
import sys
import time
from pathlib import Path

# 确保能加载 src 模块
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.analyzer.cache import SQLiteCache
from src.analyzer.parser import parse_prompt_json


def get_quantiles(values: list[float | int]) -> dict[str, float]:
    """计算分位数序列"""
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


def format_pct(part: float, total: float) -> str:
    return f"{part / total * 100:.2f}%" if total > 0 else "0.00%"


def format_num(val: float) -> str:
    if isinstance(val, int) or val.is_integer():
        return f"{int(val):,}"
    return f"{val:,.1f}"


def run_breakdown_analysis(cache_dir: str = ".cache", top_k: int = 5):
    cache = SQLiteCache(cache_dir=cache_dir)
    total_cached = cache.count()

    print("=" * 85)
    print("🔬 AI Studio 全盘资产解构审计：会话 Token 物理构成与真实意图剥离")
    print("=" * 85)
    print(f"📁 缓存数据库: {cache.db_path} (共 {total_cached:,} 场会话)\n")

    if total_cached == 0:
        print("❌ 数据库为空，请先同步数据。")
        return

    # 全局累计聚合
    agg_totals = {
        "user_net_tokens": 0,  # 用户纯 Prompt (无附件)
        "user_chars": 0,  # 用户纯 Prompt 字符数
        "context_file_tokens": 0,  # inlineFile + driveDocument 附件
        "sys_instruction_tokens": 0,  # 系统提示词
        "model_net_tokens": 0,  # 模型纯输出
        "model_thought_tokens": 0,  # 思考链
        "session_static_total": 0,  # 静态上下文总和
    }

    # 单会话分布聚合 (用于算 P50~P99)
    session_metrics = {
        "user_net": [],
        "user_chars": [],
        "context_files": [],
        "sys_instruction": [],
        "model_net": [],
        "model_thought": [],
        "total_static": [],
    }

    # 离群排查: 追踪挂载文件最大的会话、模型回答最长的会话、纯 Prompt 最长的会话
    outliers = {
        "top_context_files": [],
        "top_user_prompts": [],
        "top_model_outputs": [],
    }

    t0 = time.perf_counter()
    processed_count = 0

    print("⏳ 正在逐轮解构 3,700+ 场会话的 Chunks 结构，请稍候...")

    for file_id, mtime, raw_data in cache.iter_all_data():
        processed_count += 1
        meta = {
            "id": file_id,
            "modifiedTime": mtime,
            "name": raw_data.get("name", "Untitled"),
        }
        session = parse_prompt_json(meta, raw_data)
        if not session:
            continue

        s_user_net = 0
        s_user_chars = 0
        s_context_files = 0
        s_model_net = 0
        s_model_thought = 0

        for t in session.turns:
            tok = t.token_count or 0
            if t.role == "user":
                if t.payload_type in ("inlineFile", "driveDocument", "inlineImage"):
                    s_context_files += tok
                else:
                    # 纯文本 Prompt
                    s_user_net += tok
                    s_user_chars += len(t.text or "")
            elif t.role == "model":
                if t.is_thought:
                    s_model_thought += tok
                else:
                    s_model_net += tok

        s_sys = session.system_instruction_tokens or 0
        s_total = s_user_net + s_context_files + s_sys + s_model_net + s_model_thought

        # 累计全局
        agg_totals["user_net_tokens"] += s_user_net
        agg_totals["user_chars"] += s_user_chars
        agg_totals["context_file_tokens"] += s_context_files
        agg_totals["sys_instruction_tokens"] += s_sys
        agg_totals["model_net_tokens"] += s_model_net
        agg_totals["model_thought_tokens"] += s_model_thought
        agg_totals["session_static_total"] += s_total

        # 收集会话级样本
        session_metrics["user_net"].append(s_user_net)
        session_metrics["user_chars"].append(s_user_chars)
        session_metrics["context_files"].append(s_context_files)
        session_metrics["sys_instruction"].append(s_sys)
        session_metrics["model_net"].append(s_model_net)
        session_metrics["model_thought"].append(s_model_thought)
        session_metrics["total_static"].append(s_total)

        # 收集极端样例
        outliers["top_context_files"].append((session.name, s_context_files, file_id))
        outliers["top_user_prompts"].append(
            (session.name, s_user_net, s_user_chars, file_id)
        )
        outliers["top_model_outputs"].append((session.name, s_model_net, file_id))

    elapsed = time.perf_counter() - t0
    grand_total = agg_totals["session_static_total"] or 1

    print(f"✅ 完成！扫描处理 {processed_count:,} 场会话，耗时: {elapsed:.2f} 秒\n")

    # ---------------- 报告 1: 全局宏观资产构成剖析 ----------------
    print("-" * 85)
    print("📊 1. 全局静态 Token 资产拆解宏观分布 (Grand Total Composition)")
    print("-" * 85)
    print(
        f"{'资产分层维度':<28} | {'累计 Token 总量':<16} | {'宏观大盘占比':<12} | {'备注说明'}"
    )
    print("-" * 85)
    print(
        f"{'👤 用户纯意图 (User Net)':<26} | "
        f"{format_num(agg_totals['user_net_tokens']):<16} | "
        f"{format_pct(agg_totals['user_net_tokens'], grand_total):<12} | "
        f"纯打字/Prompt (总字数: {format_num(agg_totals['user_chars'])})"
    )
    print(
        f"{'📦 挂载附件/代码库 (Files/Docs)':<23} | "
        f"{format_num(agg_totals['context_file_tokens']):<16} | "
        f"{format_pct(agg_totals['context_file_tokens'], grand_total):<12} | "
        f"inlineFile / driveDocument 注入"
    )
    print(
        f"{'⚙️ 系统提示词 (Sys Instruction)':<24} | "
        f"{format_num(agg_totals['sys_instruction_tokens']):<16} | "
        f"{format_pct(agg_totals['sys_instruction_tokens'], grand_total):<12} | "
        f"System Prompt 前置沉淀"
    )
    print(
        f"{'🤖 模型生成净正文 (Model Net)':<24} | "
        f"{format_num(agg_totals['model_net_tokens']):<16} | "
        f"{format_pct(agg_totals['model_net_tokens'], grand_total):<12} | "
        f"AI 实际给出的文本/代码回复"
    )
    print(
        f"{'💭 模型深层思考 (Thinking)':<24} | "
        f"{format_num(agg_totals['model_thought_tokens']):<16} | "
        f"{format_pct(agg_totals['model_thought_tokens'], grand_total):<12} | "
        f"Gemini 2.0 思考链算力"
    )
    print("-" * 85)
    print(
        f"{'🌟 静态总和 (Static Total)':<26} | {format_num(grand_total):<16} | 100.00%      |"
    )
    print("-" * 85)

    # 计算膨胀系数
    net_user = agg_totals["user_net_tokens"] or 1
    file_ratio = agg_totals["context_file_tokens"] / net_user
    print(
        f"\n💡 关键洞察: 你的外部文件/代码挂载量 是 纯用户意图输入量 的 【{file_ratio:.1f} 倍】！"
    )
    print(
        f"   如果拿全量上下文来做搜索或心智度量，用户意图会被稀释至仅占 {format_pct(net_user, grand_total)}。"
    )

    # ---------------- 报告 2: 单场会话分位数阶梯对比 ----------------
    print("\n" + "-" * 85)
    print("📈 2. 单场会话分位数阶梯对比 (Quantile Distributions per Session)")
    print("-" * 85)
    print(
        f"{'分层指标项':<24} | {'Min':>8} | {'P10':>8} | {'P50 (中位)':>10} | {'P75':>10} | {'P90':>10} | {'P99':>10} | {'Max':>10}"
    )
    print("-" * 85)

    dims = [
        ("👤 用户纯 Prompt (Token)", session_metrics["user_net"]),
        ("⌨️ 用户纯输入字数 (Chars)", session_metrics["user_chars"]),
        ("📦 外部代码/附件 (Token)", session_metrics["context_files"]),
        ("🤖 模型输出正文 (Token)", session_metrics["model_net"]),
        ("💭 思考链 (Token)", session_metrics["model_thought"]),
        ("📚 会话静态总 Token", session_metrics["total_static"]),
    ]

    for label, vals in dims:
        q = get_quantiles(vals)
        print(
            f"{label:<22} | "
            f"{format_num(q['min']):>8} | "
            f"{format_num(q['p10']):>8} | "
            f"{format_num(q['p50']):>10} | "
            f"{format_num(q['p75']):>10} | "
            f"{format_num(q['p90']):>10} | "
            f"{format_num(q['p99']):>10} | "
            f"{format_num(q['max']):>10}"
        )
    print("-" * 85)

    # ---------------- 报告 3: 极端离群样本洞察 ----------------
    print(f"\n🏆 3. Top {top_k} 典型极端特征会话榜")
    print("-" * 85)

    print("📦 [挂载代码库/附件最大 Top 5]:")
    outliers["top_context_files"].sort(key=lambda x: x[1], reverse=True)
    for rank, (name, tok, fid) in enumerate(outliers["top_context_files"][:top_k], 1):
        print(f"  #{rank} [{format_num(tok)} tok] {name[:45]} (ID: {fid[:10]}...)")

    print("\n✍️ [用户纯输入最长 Top 5]:")
    outliers["top_user_prompts"].sort(key=lambda x: x[1], reverse=True)
    for rank, (name, tok, chars, fid) in enumerate(
        outliers["top_user_prompts"][:top_k], 1
    ):
        print(
            f"  #{rank} [{format_num(tok)} tok / {format_num(chars)} 字] {name[:45]} (ID: {fid[:10]}...)"
        )

    print("\n📜 [模型输出回复最多 Top 5]:")
    outliers["top_model_outputs"].sort(key=lambda x: x[1], reverse=True)
    for rank, (name, tok, fid) in enumerate(outliers["top_model_outputs"][:top_k], 1):
        print(f"  #{rank} [{format_num(tok)} tok] {name[:45]} (ID: {fid[:10]}...)")
    print("=" * 85 + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="AI Studio 认知资产与分层 Token 统计脚本"
    )
    parser.add_argument("--cache-dir", default=".cache", help="缓存目录")
    parser.add_argument("--top", type=int, default=5, help="排查离群榜单数量")
    args = parser.parse_args()

    run_breakdown_analysis(cache_dir=args.cache_dir, top_k=args.top)
