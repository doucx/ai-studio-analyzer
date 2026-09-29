"""
AI Studio Analyzer - 代码库健康度与大文件重构体检脚本
零依赖执行：python scripts/health_check.py [--warn 300] [--error 500] [--strict]
"""

import argparse
import ast
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

# 终端 ANSI 颜色配置
CYAN = "\033[36m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
BOLD = "\033[1m"
RESET = "\033[0m"

IGNORE_DIRS = {
    ".git",
    "node_modules",
    "dist",
    "build",
    "__pycache__",
    ".pytest_cache",
    ".cache",
    ".venv",
    "venv",
}
SOURCE_EXTS = {".py", ".ts", ".tsx", ".js", ".jsx"}


@dataclass
class FunctionIssue:
    name: str
    lines: int
    start_line: int


@dataclass
class FileMetric:
    rel_path: str
    extension: str
    total_lines: int
    code_lines: int
    blank_lines: int
    comment_lines: int
    routes_count: int = 0
    components_count: int = 0
    large_functions: list[FunctionIssue] = field(default_factory=list)


def count_lines(content: str, ext: str) -> tuple[int, int, int, int]:
    lines = content.splitlines()
    total = len(lines)
    blank = sum(1 for line in lines if not line.strip())
    comment = 0
    in_block_comment = False

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if ext == ".py":
            if stripped.startswith("#"):
                comment += 1
        elif ext in {".ts", ".tsx", ".js", ".jsx"}:
            if in_block_comment:
                comment += 1
                if "*/" in stripped:
                    in_block_comment = False
            elif stripped.startswith("/*"):
                comment += 1
                if "*/" not in stripped:
                    in_block_comment = True
            elif stripped.startswith("//"):
                comment += 1

    code = total - blank - comment
    return total, code, blank, comment


def analyze_python_ast(
    content: str, max_func_lines: int = 60
) -> tuple[int, list[FunctionIssue]]:
    """分析 Python 代码中的路由数量和过大函数"""
    routes = 0
    large_funcs = []
    try:
        tree = ast.parse(content)
    except SyntaxError:
        return 0, []

    for node in ast.walk(tree):
        # 统计 FastAPI 路由装饰器
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for decorator in node.decorator_list:
                dec_str = ast.unparse(decorator) if hasattr(ast, "unparse") else ""
                if any(
                    m in dec_str
                    for m in [".get(", ".post(", ".put(", ".delete(", ".patch("]
                ):
                    routes += 1

            # 统计超长函数
            lines = (node.end_lineno or node.lineno) - node.lineno + 1
            if lines > max_func_lines:
                large_funcs.append(
                    FunctionIssue(name=node.name, lines=lines, start_line=node.lineno)
                )

    return routes, large_funcs


def analyze_frontend_file(
    content: str, ext: str, max_func_lines: int = 80
) -> tuple[int, list[FunctionIssue]]:
    """分析前端组件数量及超长函数/组件"""
    components = 0
    large_funcs = []

    if ext in {".tsx", ".jsx"}:
        func_comp_pattern = re.compile(
            r"^(?:export\s+)?function\s+([A-Z]\w+)\s*\(", re.MULTILINE
        )
        const_comp_pattern = re.compile(
            r"^(?:export\s+)?const\s+([A-Z]\w+)\s*=\s*(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>",
            re.MULTILINE,
        )
        components += len(func_comp_pattern.findall(content))
        components += len(const_comp_pattern.findall(content))

    return components, large_funcs


def scan_repository(
    root_dir: Path, warn_limit: int = 300, error_limit: int = 500
) -> list[FileMetric]:
    metrics: list[FileMetric] = []

    for path in root_dir.rglob("*"):
        if not path.is_file():
            continue
        if any(part in IGNORE_DIRS for part in path.parts):
            continue
        if path.suffix not in SOURCE_EXTS:
            continue

        try:
            content = path.read_text(encoding="utf-8", errors="replace")
        except (OSError, UnicodeError):
            content = None

        if content is None:
            continue

        total, code, blank, comment = count_lines(content, path.suffix)
        rel_path = str(path.relative_to(root_dir))

        fm = FileMetric(
            rel_path=rel_path,
            extension=path.suffix,
            total_lines=total,
            code_lines=code,
            blank_lines=blank,
            comment_lines=comment,
        )

        if path.suffix == ".py":
            routes, large_funcs = analyze_python_ast(content)
            fm.routes_count = routes
            fm.large_functions = large_funcs
        elif path.suffix in {".tsx", ".jsx", ".ts", ".js"}:
            comps, large_funcs = analyze_frontend_file(content, path.suffix)
            fm.components_count = comps
            fm.large_functions = large_funcs

        metrics.append(fm)

    metrics.sort(key=lambda m: m.total_lines, reverse=True)
    return metrics


def calculate_health_score(
    metrics: list[FileMetric], warn_limit: int, error_limit: int
) -> tuple[float, list[str]]:
    deductions = 0.0
    issues: list[str] = []

    for m in metrics:
        if m.total_lines > error_limit:
            penalty = min(15.0, (m.total_lines - error_limit) / 30.0)
            deductions += penalty
            issues.append(
                f"[严重大文件] {m.rel_path} 达 {m.total_lines} 行 (超过严重阈值 {error_limit} 行)"
            )
        elif m.total_lines > warn_limit:
            penalty = min(5.0, (m.total_lines - warn_limit) / 40.0)
            deductions += penalty
            issues.append(
                f"[较大文件] {m.rel_path} 达 {m.total_lines} 行 (超过建议阈值 {warn_limit} 行)"
            )

        if m.routes_count > 10:
            deductions += 6.0
            issues.append(
                f"[路由集中] {m.rel_path} 包含 {m.routes_count} 个接口路由，缺乏子路由模块拆分"
            )

        if m.components_count > 3:
            deductions += 4.0
            issues.append(
                f"[组件未解耦] {m.rel_path} 单文件定义了 {m.components_count} 个 React/Preact 组件"
            )

    score = max(0.0, min(100.0, 100.0 - deductions))
    return round(score, 1), issues


def print_report(
    metrics: list[FileMetric],
    warn_limit: int,
    error_limit: int,
    score: float,
    issues: list[str],
):
    print("\n" + "=" * 80)
    print(f"{BOLD}📊 AI Studio Analyzer - 代码库健康度与重构体检报告{RESET}")
    print("=" * 80)

    score_color = GREEN if score >= 85 else (YELLOW if score >= 65 else RED)
    print(f"整体健康度评分: {score_color}{BOLD}{score} / 100{RESET}")

    total_files = len(metrics)
    total_loc = sum(m.total_lines for m in metrics)
    severe_files = [m for m in metrics if m.total_lines > error_limit]
    warning_files = [m for m in metrics if warn_limit < m.total_lines <= error_limit]

    print(
        f"扫描源码文件: {total_files} 个 | 源码总量: {total_loc:,} 行 (纯代码: {sum(m.code_lines for m in metrics):,})"
    )
    print(
        f"状态分布: {RED}严重超长 (> {error_limit} 行): {len(severe_files)} 个{RESET} | "
        f"{YELLOW}偏大待拆分 (> {warn_limit} 行): {len(warning_files)} 个{RESET} | "
        f"{GREEN}健康 (< {warn_limit} 行): {total_files - len(severe_files) - len(warning_files)} 个{RESET}"
    )
    print("-" * 80)

    print(
        f"{BOLD}{'文件路径':<48} | {'总行数':<8} | {'代码':<6} | {'特征与状态':<16}{RESET}"
    )
    print("-" * 80)

    for m in metrics[:10]:
        if m.total_lines > error_limit:
            color = RED
            tag = "💥 严重超标"
        elif m.total_lines > warn_limit:
            color = YELLOW
            tag = "⚠️ 建议重构"
        else:
            color = GREEN
            tag = "✅ 健康"

        extra = []
        if m.routes_count:
            extra.append(f"{m.routes_count} 路由")
        if m.components_count > 1:
            extra.append(f"{m.components_count} 组件")
        extra_str = f"({', '.join(extra)})" if extra else ""

        print(
            f"{color}{m.rel_path:<48}{RESET} | {color}{m.total_lines:>6} L{RESET} | {m.code_lines:>6} | {tag} {extra_str}"
        )

    if issues:
        print("\n" + "=" * 80)
        print(f"{BOLD}🔍 核心重构热点关注列表:{RESET}")
        print("=" * 80)
        for issue in issues[:8]:
            if "[严重大文件]" in issue or "[路由集中]" in issue:
                print(f" {RED}•{RESET} {issue}")
            else:
                print(f" {YELLOW}•{RESET} {issue}")
    print("=" * 80 + "\n")


def main():
    parser = argparse.ArgumentParser(description="代码库大文件与健康度检查工具")
    parser.add_argument("--warn", type=int, default=300, help="警告阈值 (默认 300 行)")
    parser.add_argument(
        "--error", type=int, default=500, help="严重超标阈值 (默认 500 行)"
    )
    parser.add_argument(
        "--strict", action="store_true", help="严格模式: 若健康分低于 80 则退出码非 0"
    )
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parents[1]
    metrics = scan_repository(
        project_root, warn_limit=args.warn, error_limit=args.error
    )
    score, issues = calculate_health_score(metrics, args.warn, args.error)

    print_report(metrics, args.warn, args.error, score, issues)

    if args.strict and score < 80.0:
        sys.exit(1)


if __name__ == "__main__":
    main()
