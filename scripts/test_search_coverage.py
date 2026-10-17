"""
AI Studio Analyzer - 搜索引擎 IR 质量评测与白盒诊断基准工具
(Search IR Evaluator & Diagnostic Inspector)

用法:
  # 运行全维度信息检索基准评测 (MRR@5, Top-1, Top-5, P95 延迟)
  python scripts/test_search_coverage.py
  python scripts/test_search_coverage.py --samples 20 --verbose

  # 白盒深度诊断透视特定查询
  python scripts/test_search_coverage.py --explain "TypeScript 编译无任何错误。"
  python scripts/test_search_coverage.py --explain "src/analyzer/search.py"
"""

import argparse
import html
import json
import re
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.analyzer.cache import SQLiteCache
from src.analyzer.parser import parse_prompt_json
from src.analyzer.search import search_service

# 常见路径与代码块正则模式
PATH_PATTERN = re.compile(
    r"[a-zA-Z0-9_\u4e00-\u9fa5\.\-]+/[a-zA-Z0-9_\u4e00-\u9fa5\.\-\/]+\.[a-zA-Z0-9]+"
)
CODE_FENCE_PATTERN = re.compile(r"```([a-zA-Z0-9_\-\+]*)\n([\s\S]+?)\n```")
CJK_SENTENCE_PATTERN = re.compile(r"([^。！？\n]{18,80}[。！？])")

GENERIC_PATH_BLACKLIST = {
    "package.json",
    "tsconfig.json",
    "types/index.ts",
    "src/index.ts",
    ".gitignore",
    "README.md",
}


@dataclass
class TestCase:
    case_id: str
    category: str
    query: str
    target_file_id: str
    target_name: str
    description: str


@dataclass
class EvalResult:
    test_case: TestCase
    hit_top1: bool
    hit_top5: bool
    target_rank: int | None
    reciprocal_rank: float
    duration_ms: float
    top1_title: str
    total_returned: int


def clean_markdown_inline(text: str) -> str:
    t = re.sub(r"(\*\*|__)(.*?)\1", r"\2", text)
    t = re.sub(r"(\*|_)(.*?)\1", r"\2", t)
    t = re.sub(r"\[([^\]]+)\]\([^\)]+\)", r"\1", t)
    t = re.sub(r"^(?:[-*+]|\d+\.)\s+", "", t).strip()
    return t


def build_high_entropy_test_cases(
    cache: SQLiteCache, samples_per_cat: int = 5
) -> list[TestCase]:
    """从本地真实缓存中基于物理包含与高信息熵原则自动挖掘测试用例"""
    test_cases: list[TestCase] = []
    seen_queries = set()

    with cache._get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT file_id, modified_time, data
            FROM file_cache
            ORDER BY modified_time DESC
            LIMIT ?;
            """,
            (samples_per_cat * 25,),
        )
        rows = cursor.fetchall()

    candidate_sessions = []
    for r in rows:
        fid = r["file_id"]
        try:
            raw_data = json.loads(r["data"])
            meta = {
                "id": fid,
                "modifiedTime": r["modified_time"],
                "name": raw_data.get("name", "Untitled"),
            }
            session = parse_prompt_json(meta, raw_data)
            if session and session.turns:
                candidate_sessions.append((fid, session))
        except (json.JSONDecodeError, TypeError):
            continue

    cat1_cjk = 0
    cat2_code = 0
    cat3_path = 0
    cat4_jitter = 0

    for fid, session in candidate_sessions:
        full_text = "\n".join(t.text for t in session.turns if t.text)

        # 类别 1: 中英文混排业务长句
        if cat1_cjk < samples_per_cat:
            cjk_matches = CJK_SENTENCE_PATTERN.findall(full_text)
            for raw_sentence in cjk_matches:
                cleaned = clean_markdown_inline(raw_sentence)
                has_en = bool(re.search(r"[a-zA-Z]{3,}", cleaned))
                if has_en and cleaned not in seen_queries and len(cleaned) >= 20:
                    test_cases.append(
                        TestCase(
                            case_id=f"TC-CJK-{cat1_cjk + 1:02d}",
                            category="1. 中英混排长句 (CJK Mixed)",
                            query=cleaned,
                            target_file_id=fid,
                            target_name=session.name,
                            description=f"高区分度中英文长句: {cleaned[:35]}...",
                        )
                    )
                    seen_queries.add(cleaned)
                    cat1_cjk += 1
                    break

        # 类别 2: 多行连续代码块
        if cat2_code < samples_per_cat:
            code_blocks = CODE_FENCE_PATTERN.findall(full_text)
            for _, body in code_blocks:
                lines = [l.rstrip() for l in body.splitlines() if l.strip()]
                if len(lines) >= 3:
                    sub_code = "\n".join(lines[:4])
                    if sub_code not in seen_queries and len(sub_code) >= 20:
                        test_cases.append(
                            TestCase(
                                case_id=f"TC-CODE-{cat2_code + 1:02d}",
                                category="2. 多行代码块 (Multiline Block)",
                                query=sub_code,
                                target_file_id=fid,
                                target_name=session.name,
                                description=f"连续 {min(4, len(lines))} 行代码块",
                            )
                        )
                        seen_queries.add(sub_code)
                        cat2_code += 1

                        # 类别 4: 代码缩进扰动
                        if cat4_jitter < samples_per_cat:
                            jittered = "\n".join(["   " + l.strip() for l in lines[:4]])
                            test_cases.append(
                                TestCase(
                                    case_id=f"TC-JITTER-{cat4_jitter + 1:02d}",
                                    category="4. 缩进扰动 (Whitespace Jitter)",
                                    query=jittered,
                                    target_file_id=fid,
                                    target_name=session.name,
                                    description="改变了首尾缩进与排版的多行代码",
                                )
                            )
                            cat4_jitter += 1
                        break

        # 类别 3: 工程物理路径
        if cat3_path < samples_per_cat:
            paths = PATH_PATTERN.findall(full_text)
            for p in paths:
                p_clean = p.strip()
                if (
                    not p_clean.startswith("http")
                    and p_clean.count("/") >= 2
                    and p_clean not in GENERIC_PATH_BLACKLIST
                    and p_clean not in seen_queries
                ):
                    test_cases.append(
                        TestCase(
                            case_id=f"TC-PATH-{cat3_path + 1:02d}",
                            category="3. 路径与调用符号 (Path & Symbol)",
                            query=p_clean,
                            target_file_id=fid,
                            target_name=session.name,
                            description=f"深层特征工程路径: {p_clean}",
                        )
                    )
                    seen_queries.add(p_clean)
                    cat3_path += 1
                    break

        if (
            cat1_cjk >= samples_per_cat
            and cat2_code >= samples_per_cat
            and cat3_path >= samples_per_cat
            and cat4_jitter >= samples_per_cat
        ):
            break

    return test_cases


def run_evaluation(
    cache: SQLiteCache, cases: list[TestCase], verbose: bool = False
) -> list[EvalResult]:
    """端到端评测当前生产系统的检索质量"""
    results: list[EvalResult] = []

    for idx, tc in enumerate(cases, start=1):
        t0 = time.perf_counter()
        hits = cache.search_fts(query=tc.query, limit=10)
        dur_ms = (time.perf_counter() - t0) * 1000.0

        hit_ids = [h["file_id"] for h in hits]
        target_rank = (
            (hit_ids.index(tc.target_file_id) + 1)
            if tc.target_file_id in hit_ids
            else None
        )

        hit_top1 = target_rank == 1
        hit_top5 = target_rank is not None and target_rank <= 5
        rr = (1.0 / target_rank) if (target_rank and target_rank <= 5) else 0.0

        res = EvalResult(
            test_case=tc,
            hit_top1=hit_top1,
            hit_top5=hit_top5,
            target_rank=target_rank,
            reciprocal_rank=rr,
            duration_ms=dur_ms,
            top1_title=hits[0]["name"] if hits else "无返回",
            total_returned=len(hits),
        )
        results.append(res)

        if verbose:
            tag = "🎯 Top-1" if hit_top1 else ("✨ Top-5" if hit_top5 else "❌ Miss")
            rank_str = f"Rank #{target_rank}" if target_rank else "Unranked"
            print(
                f"[{idx:02d}/{len(cases):02d}] {tag} ({dur_ms:4.1f}ms) [{rank_str}] {tc.case_id}: {tc.query[:40]!r}"
            )

    return results


def print_ir_report(results: list[EvalResult]):
    """打印标准信息检索（IR）量化度量报告"""
    categories = sorted({r.test_case.category for r in results})
    results_by_cat = defaultdict(list)
    for r in results:
        results_by_cat[r.test_case.category].append(r)

    print("\n" + "=" * 90)
    print("📊 AI Studio Analyzer - 搜索引擎 IR 质量评测报告")
    print("=" * 90)
    engine_type = (
        "Tantivy 两阶段微重排 (TantivyRescore)"
        if search_service.is_available()
        else "SQLite FTS5 Trigram (降级模式)"
    )
    print(f"⚙️  当前生产检索引擎: [{engine_type}]")
    print(f"📦 Tantivy 索引体积: {search_service.get_index_size_mb()} MB")
    print("-" * 90)
    print(
        f"{'测试场景分类':<34} | {'用例数':<5} | {'MRR@5':<8} | {'Top-1 命中率':<12} | {'Top-5 召回率':<12} | {'平均耗时':<8}"
    )
    print("-" * 90)

    total_cases = len(results)
    total_top1 = 0
    total_top5 = 0
    total_rr = 0.0
    all_latencies = [r.duration_ms for r in results]

    for cat in categories:
        items = results_by_cat[cat]
        c_len = len(items)
        c_top1 = sum(1 for x in items if x.hit_top1)
        c_top5 = sum(1 for x in items if x.hit_top5)
        c_mrr = sum(x.reciprocal_rank for x in items) / c_len if c_len else 0
        c_avg_t = sum(x.duration_ms for x in items) / c_len if c_len else 0

        total_top1 += c_top1
        total_top5 += c_top5
        total_rr += sum(x.reciprocal_rank for x in items)

        p_top1 = (c_top1 / c_len * 100) if c_len else 0
        p_top5 = (c_top5 / c_len * 100) if c_len else 0

        print(
            f"{cat:<32} | {c_len:<5} | {c_mrr:<8.3f} | {p_top1:>5.1f}% ({c_top1}/{c_len:<2}) | {p_top5:>5.1f}% ({c_top5}/{c_len:<2}) | {c_avg_t:>6.1f}ms"
        )

    print("-" * 90)
    overall_mrr = total_rr / total_cases if total_cases else 0
    overall_top1 = (total_top1 / total_cases * 100) if total_cases else 0
    overall_top5 = (total_top5 / total_cases * 100) if total_cases else 0
    avg_latency = sum(all_latencies) / total_cases if total_cases else 0
    all_latencies.sort()
    p95_latency = all_latencies[int(len(all_latencies) * 0.95)] if all_latencies else 0

    print(
        f"{'⚡ 全维度综合总计 (Overall)':<32} | {total_cases:<5} | {overall_mrr:<8.3f} | "
        f"{overall_top1:>5.1f}% ({total_top1}/{total_cases}) | {overall_top5:>5.1f}% ({total_top5}/{total_cases}) | {avg_latency:>6.1f}ms"
    )
    print(f"⏱️  延时基准: 平均: {avg_latency:.1f}ms | P95 尾部: {p95_latency:.1f}ms")
    print("=" * 90)

    bad_cases = [r for r in results if not r.hit_top1]
    if bad_cases:
        print("\n🔍 典型非 Top-1 样本诊断 (展示前 3 例):")
        for r in bad_cases[:3]:
            rank_str = f"Rank #{r.target_rank}" if r.target_rank else "未进入 Top 10"
            print(f"• [{r.test_case.category}] {r.test_case.case_id}")
            print(f"  查询词:   {r.test_case.query[:60]!r}")
            print(
                f"  目标会话: {r.test_case.target_name} ({r.test_case.target_file_id[:8]})"
            )
            print(f"  实际排名: {rank_str} | Top-1 误召回: {r.top1_title}")
            print()


def explain_query_pipeline(cache: SQLiteCache, query: str):
    """白盒透视特定 Query 在当前引擎的拆解、编译与精排对决"""
    print("\n" + "=" * 90)
    print(f"🔬 [检索引擎白盒透视] Query: {query!r}")
    print("=" * 90)

    if not search_service.is_available():
        print("⚠️  当前 Tantivy 引擎不可用，处于 SQLite 降级模式。")
        return

    # 1. 词法编译分析
    terms = search_service.extract_safe_terms(query)
    phrase = search_service.build_phrase_expression(query)
    print("🛠️  【Query 编译器分析 (Query Compiler)】:")
    print(f"   • 提取有效词元 ({len(terms)} 个): {terms}")
    print(f"   • 核心短语表达式:     {phrase!r}")

    # 2. 调用当前检索
    t0 = time.perf_counter()
    hits = cache.search_fts(query=query, limit=10)
    dur_ms = (time.perf_counter() - t0) * 1000.0

    print(f"\n📊 【检索结果候选池 (展示前 8 项，耗时 {dur_ms:.1f}ms)】:")
    print(f"{'Rank':<4} | {'File ID':<9} | {'综合得分':<8} | {'标题 (Session Name)'}")
    print("-" * 90)

    for rank, h in enumerate(hits[:8], start=1):
        fid = h["file_id"][:8]
        score = h.get("raw_rank", 0.0)
        name = h.get("name", "Untitled")[:40]
        print(f"#{rank:<3} | {fid:<9} | {score:<8.2f} | {name}")
        snippet = h.get("snippet", "").replace("\n", " ")[:120]
        if snippet:
            clean_snip = html.unescape(snippet)
            print(f"     ↳ 片段: {clean_snip}...")

    print("=" * 90 + "\n")


def main():
    parser = argparse.ArgumentParser(
        description="AI Studio Analyzer 检索引擎基准评测工具"
    )
    parser.add_argument(
        "--samples", type=int, default=5, help="每种测试分类采样的样本数量 (默认: 5)"
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true", help="详细打印每条测试用例状态"
    )
    parser.add_argument("--explain", default=None, help="白盒诊断透视指定的搜索查询词")
    args = parser.parse_args()

    cache = SQLiteCache()
    if cache.count() == 0:
        print("❌ 缓存数据库为空，请先同步数据。")
        return

    if args.explain:
        explain_query_pipeline(cache, args.explain)
        return

    print("🧪 正在基于高信息熵原则从本地缓存构建回归测试集...")
    cases = build_high_entropy_test_cases(cache, samples_per_cat=args.samples)
    print(f"✨ 成功构建 {len(cases)} 个多场景抗碰撞用例，开始执行评测...\n")

    results = run_evaluation(cache, cases, verbose=args.verbose)
    print_ir_report(results)


if __name__ == "__main__":
    main()
