"""
AI Studio Analyzer - 搜索引擎代码与多场景检索覆盖率基准测试工具
用法:
  python scripts/test_search_coverage.py
  python scripts/test_search_coverage.py --samples 30 --verbose
"""

import argparse
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path

# 注入项目根目录以确保正确导入 src 模块
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.analyzer.cache import SQLiteCache

# 常见代码特征模式
CODE_PATTERNS = [
    re.compile(r"```(?:\w+)?\n([\s\S]+?)\n```"),  # Markdown 代码块
    re.compile(r"(?:def|class|function|import|export|const|let|var)\s+[\w_]+"),
    re.compile(r"[a-zA-Z_]\w*\([^)]*\)"),  # 函数调用
]


@dataclass
class TestCase:
    category: str
    query: str
    target_file_id: str
    target_name: str
    description: str


@dataclass
class TestResult:
    test_case: TestCase
    hit_top1: bool
    hit_top5: bool
    duration_ms: float
    total_returned: int
    matched_rank: int | None = None
    error: str | None = None


def extract_code_snippets_from_text(text: str) -> list[str]:
    """从纯文本中提取有代表性的代码行或代码块"""
    snippets = []
    # 1. 优先提取 Markdown 代码围栏
    fence_matches = CODE_PATTERNS[0].findall(text)
    for block in fence_matches:
        lines = [line.rstrip() for line in block.strip().splitlines() if line.strip()]
        if len(lines) >= 2:
            snippets.append("\n".join(lines[:6]))

    # 2. 若无围栏，抽取包含关键字的代码行
    if not snippets:
        lines = text.splitlines()
        candidate_lines = []
        for line in lines:
            trimmed = line.strip()
            if (
                any(
                    k in trimmed
                    for k in (
                        "def ",
                        "class ",
                        "import ",
                        "return ",
                        "SELECT ",
                        "const ",
                        "function",
                        "=>",
                    )
                )
                and len(trimmed) >= 10
            ):
                candidate_lines.append(trimmed)

        if candidate_lines:
            snippets.append("\n".join(candidate_lines[:3]))

    return snippets


def generate_test_cases(cache: SQLiteCache, sample_limit: int = 20) -> list[TestCase]:
    """从本地真实缓存中采样会话，生成 5 类典型搜索场景"""
    test_cases: list[TestCase] = []

    with cache._get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT f.file_id, s.name, f.content
            FROM session_fts f
            JOIN session_index s ON f.file_id = s.file_id
            WHERE length(f.content) >= 300
            ORDER BY s.modified_time DESC
            LIMIT ?;
        """,
            (sample_limit * 3,),
        )
        rows = cursor.fetchall()

    sampled_count = 0
    for r in rows:
        fid = r["file_id"]
        name = r["name"]
        content = r["content"]

        snippets = extract_code_snippets_from_text(content)
        if not snippets:
            continue

        base_code = snippets[0]
        code_lines = [l for l in base_code.splitlines() if l.strip()]
        if not code_lines:
            continue

        # 场景 1: 精确单行/双行代码检索
        exact_query = code_lines[0].strip()
        test_cases.append(
            TestCase(
                category="1. 精确代码行 (Exact Line)",
                query=exact_query,
                target_file_id=fid,
                target_name=name,
                description=f"检索首行代码: {exact_query[:40]}...",
            )
        )

        # 场景 2: 多行连续代码块 (Multiline Block)
        if len(code_lines) >= 2:
            multiline_query = "\n".join(code_lines[:3])
            test_cases.append(
                TestCase(
                    category="2. 多行代码块 (Multiline Block)",
                    query=multiline_query,
                    target_file_id=fid,
                    target_name=name,
                    description=f"检索 {min(3, len(code_lines))} 行连续代码块",
                )
            )

        # 场景 3: 富符号/括号/路径/类型表达式 (Symbol Heavy)
        symbol_line = next(
            (
                l
                for l in code_lines
                if any(c in l for c in ("(", ")", "->", ":", "/", "_", "{"))
            ),
            code_lines[0],
        )
        test_cases.append(
            TestCase(
                category="3. 富符号与表达式 (Symbol Heavy)",
                query=symbol_line.strip(),
                target_file_id=fid,
                target_name=name,
                description=f"含符号代码: {symbol_line[:40]}...",
            )
        )

        # 场景 4: 空格与缩进扰动 (Whitespace/Indent Jitter)
        if len(code_lines) >= 2:
            jittered_lines = ["  " + l.strip() for l in code_lines[:2]]  # 改变缩进
            jitter_query = "\n".join(jittered_lines)
            test_cases.append(
                TestCase(
                    category="4. 缩进与排版扰动 (Whitespace Jitter)",
                    query=jitter_query,
                    target_file_id=fid,
                    target_name=name,
                    description="改变了首尾缩进与空白的多行代码",
                )
            )

        # 场景 5: 词项篡改/部分模糊 (Perturbed / Fuzzy Fallback)
        if len(code_lines) >= 3:
            # 篡改第 2 行的某个单词，测试 OR/BM25 降级是否依然能把目标会话召回
            perturbed = [
                code_lines[0],
                "mock_unknown_function_call(xyz)",
                code_lines[2],
            ]
            fuzzy_query = "\n".join(perturbed)
            test_cases.append(
                TestCase(
                    category="5. 局部篡改模糊降级 (Fuzzy Fallback)",
                    query=fuzzy_query,
                    target_file_id=fid,
                    target_name=name,
                    description="混入 1 行未知代码，测试 BM25 模糊召回能力",
                )
            )

        sampled_count += 1
        if sampled_count >= sample_limit:
            break

    return test_cases


def run_benchmarks(
    cache: SQLiteCache, cases: list[TestCase], verbose: bool = False
) -> list[TestResult]:
    """运行全量测试用例并收集性能指标"""
    results: list[TestResult] = []

    for idx, tc in enumerate(cases, start=1):
        t0 = time.perf_counter()
        try:
            # 使用全库模式检索，验证召回能力
            items = cache.search_fts(query=tc.query, limit=20)
            elapsed_ms = (time.perf_counter() - t0) * 1000.0

            returned_ids = [item["file_id"] for item in items]
            hit_top1 = len(returned_ids) > 0 and returned_ids[0] == tc.target_file_id
            hit_top5 = tc.target_file_id in returned_ids[:5]
            rank = (
                (returned_ids.index(tc.target_file_id) + 1)
                if tc.target_file_id in returned_ids
                else None
            )

            res = TestResult(
                test_case=tc,
                hit_top1=hit_top1,
                hit_top5=hit_top5,
                duration_ms=elapsed_ms,
                total_returned=len(items),
                matched_rank=rank,
            )
            results.append(res)

            if verbose:
                mark = (
                    "✅ Top-1" if hit_top1 else ("✨ Top-5" if hit_top5 else "❌ Miss")
                )
                print(
                    f"[{idx:02d}/{len(cases)}] {mark} ({elapsed_ms:.1f}ms) [{tc.category}] {tc.description}"
                )
                if not hit_top5:
                    print(f"   ↳ 目标: {tc.target_name} ({tc.target_file_id[:8]})")
                    print(f"   ↳ Query: {tc.query[:60]!r}")

        except Exception as e:  # noqa: BLE001
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            results.append(
                TestResult(
                    test_case=tc,
                    hit_top1=False,
                    hit_top5=False,
                    duration_ms=elapsed_ms,
                    total_returned=0,
                    error=str(e),
                )
            )
            if verbose:
                print(f"[{idx:02d}/{len(cases)}] ⚠️ Error: {e} [{tc.category}]")

    return results


def print_summary_report(results: list[TestResult]):
    """打印分维度覆盖率与性能综合报告"""
    categories = sorted({r.test_case.category for r in results})

    print("\n" + "=" * 82)
    print("📊 AI Studio Analyzer 搜索引擎代码覆盖率评测报告")
    print("=" * 82)
    print(
        f"{'测试维度场景':<35} | {'样本数':<6} | {'Top-1 准确率':<12} | {'Top-5 召回率':<12} | {'平均耗时':<8}"
    )
    print("-" * 82)

    total_tests = len(results)
    total_top1 = sum(1 for r in results if r.hit_top1)
    total_top5 = sum(1 for r in results if r.hit_top5)
    total_time = sum(r.duration_ms for r in results)

    for cat in categories:
        cat_results = [r for r in results if r.test_case.category == cat]
        c_len = len(cat_results)
        c_top1 = sum(1 for r in cat_results if r.hit_top1)
        c_top5 = sum(1 for r in cat_results if r.hit_top5)
        avg_t = sum(r.duration_ms for r in cat_results) / c_len if c_len > 0 else 0

        p_top1 = (c_top1 / c_len * 100) if c_len > 0 else 0
        p_top5 = (c_top5 / c_len * 100) if c_len > 0 else 0

        print(
            f"{cat:<35} | {c_len:<6} | {p_top1:>5.1f}% ({c_top1}/{c_len}) | {p_top5:>5.1f}% ({c_top5}/{c_len}) | {avg_t:>6.1f}ms"
        )

    print("-" * 82)
    overall_top1_pct = (total_top1 / total_tests * 100) if total_tests > 0 else 0
    overall_top5_pct = (total_top5 / total_tests * 100) if total_tests > 0 else 0
    avg_total_time = total_time / total_tests if total_tests > 0 else 0

    print(
        f"{'⚡ 全维度综合总计':<35} | {total_tests:<6} | {overall_top1_pct:>5.1f}% ({total_top1}/{total_tests}) | {overall_top5_pct:>5.1f}% ({total_top5}/{total_tests}) | {avg_total_time:>6.1f}ms"
    )
    print("=" * 82)

    # 失败样本剖析
    failures = [r for r in results if not r.hit_top5]
    if failures:
        print(f"\n🔍 典型未召回样本诊断 (共 {len(failures)} 例，展示前 3 例):")
        for f in failures[:3]:
            print(f"• [{f.test_case.category}] 目标会话: {f.test_case.target_name}")
            print(f"  查询词: {f.test_case.query!r}")
            if f.error:
                print(f"  执行异常: {f.error}")
            else:
                print(f"  返回条数: {f.total_returned} 条 (未能在 Top 5 中命中目标)")
        print(
            "\n💡 提示: 可根据上述未召回样本的特征，调整 FTS 分词策略或增强模糊容错管道。"
        )


def main():
    parser = argparse.ArgumentParser(description="搜索引擎覆盖率量化基准评测")
    parser.add_argument(
        "--cache-dir", default=".cache", help="本地 SQLite 缓存目录 (默认: .cache)"
    )
    parser.add_argument(
        "--samples", type=int, default=15, help="抽样含代码会话数量 (默认: 15)"
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true", help="输出每条测试用例详情"
    )
    args = parser.parse_args()

    cache = SQLiteCache(cache_dir=args.cache_dir)
    if cache.count() == 0:
        print("❌ 未在缓存库中发现任何会话，请先执行同步拉取数据。")
        return

    print(f"🧪 正在从本地数据库扫描真实代码样本 (采样目标: {args.samples} 场会话)...")
    cases = generate_test_cases(cache, sample_limit=args.samples)
    print(f"✨ 成功构建 {len(cases)} 个多场景测试用例，开始执行基准测试...\n")

    results = run_benchmarks(cache, cases, verbose=args.verbose)
    print_summary_report(results)


if __name__ == "__main__":
    main()
