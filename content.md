好的，我将把 `inspect_quipu_alignment.py` 和 `sync_intents_to_quipu.py` 这两个认知对齐与回填脚本收拢至独立的 `scripts/quipu/` 专用目录，并为其配置路径寻址防护与平滑进度条。

## [WIP] refactor(quipu): 将 Quipu 认知对齐与回填脚本归类至专用脚本目录

### 用户需求
开辟一个独立清晰的目录存放与 Quipu 相关的两个脚本（`inspect_quipu_alignment.py` 与 `sync_intents_to_quipu.py`），避免根目录结构混乱，同时集成上一轮所要求的静默进度条改造，并遵循 Quipu 规范完成归档。

### 评论
随着分析器功能从只读审计扩展到与外部工作区（如 Quipu）双向回填，根目录下零散的诊断与同步脚本需要按照职责清晰划分。收拢至 `scripts/quipu/` 能够让工具链更加模块化，便于后续版本维护与外部集成。

### 目标
1. 创建专用脚本目录 `scripts/quipu/`。
2. 将 `inspect_quipu_alignment.py` 和 `sync_intents_to_quipu.py` 移动至该目录下。
3. 注入 `sys.path` 项目根目录自动解析逻辑，确保从任何目录启动脚本均能无缝加载 `src.analyzer`。
4. 将此前设计的 `tqdm` 进度条与实时状态统计完整落地到 `sync_intents_to_quipu.py` 中。

### 基本原理
将两个脚本集中存放后，脚本执行时的 `sys.path[0]` 会变为 `scripts/quipu/`。为了确保 `src.analyzer` 相关的包依然能够被 Python 解释器正确导入，通过 `pathlib.Path(__file__).resolve().parents[2]` 动态定位项目根目录并安全注入 `sys.path`。同时，两个脚本在同一目录下依然保持相互直接引用，确保调用关系干净透明。

### 标签
#intent/refine #flow/ready #priority/medium #comp/cli #concept/sync #scope/dx #ai/instruct #task/domain/cli #task/object/quipu-scripts #task/action/refactor #task/state/begin

---

### Script

#### Acts 1: 创建目录并迁移脚本文件

创建 `scripts/quipu/` 目录并将两个脚本移动至新目录。

~~~~~act
run_command
~~~~~
~~~~~
mkdir -p scripts/quipu
~~~~~

~~~~~act
move_file
inspect_quipu_alignment.py
scripts/quipu/inspect_quipu_alignment.py
~~~~~

~~~~~act
move_file
sync_intents_to_quipu.py
scripts/quipu/sync_intents_to_quipu.py
~~~~~

#### Acts 2: 为 `inspect_quipu_alignment.py` 补充项目根路径解析

在脚本导入区前注入项目根目录路径，确保在子目录执行时依然能正确导入 `src.analyzer`。

~~~~~act
patch_file
scripts/quipu/inspect_quipu_alignment.py
~~~~~
~~~~~python
import argparse
import difflib
import os
import re
import sqlite3
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple
from tqdm import tqdm

from src.analyzer.cache import SQLiteCache
~~~~~
~~~~~python
import argparse
import difflib
import os
from pathlib import Path
import re
import sqlite3
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple
from tqdm import tqdm

# 将项目根目录注入 sys.path，保证无论在何处执行均能定位 src 模块
PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.analyzer.cache import SQLiteCache
~~~~~

#### Acts 3: 优化 `sync_intents_to_quipu.py` 路径解析并接入进度条

补全路径注入，同时集成 `tqdm` 进度条与状态显示，替换滚屏输出并支持 `-v / --verbose` 参数。

~~~~~act
patch_file
scripts/quipu/sync_intents_to_quipu.py
~~~~~
~~~~~python
import argparse
import os
import sqlite3
import sys

from inspect_quipu_alignment import AlignmentProbe
from src.analyzer.cache import SQLiteCache


def sync_intents(
    quipu_dir: str,
    analyzer_port: int = 5173,
    min_score: float = 0.45,
    window_hours: float = 24.0,
    force: bool = False,
    dry_run: bool = False,
):
~~~~~
~~~~~python
import argparse
import os
from pathlib import Path
import sqlite3
import sys
from tqdm import tqdm

# 将项目根目录注入 sys.path，保证无论在何处执行均能定位 src 模块
PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from inspect_quipu_alignment import AlignmentProbe
from src.analyzer.cache import SQLiteCache


def sync_intents(
    quipu_dir: str,
    analyzer_port: int = 5173,
    min_score: float = 0.45,
    window_hours: float = 24.0,
    force: bool = False,
    dry_run: bool = False,
    verbose: bool = False,
):
~~~~~

~~~~~act
patch_file
scripts/quipu/sync_intents_to_quipu.py
~~~~~
~~~~~python
    print(f"🔍 检索到 {len(nodes_to_sync)} 个待对齐/刷新的 Quipu 节点 (force={force})。")
    if not nodes_to_sync:
        print("✅ 所有 Plan 节点均已包含意图内容，无需处理。如需全量重新对齐请添加 --force 参数。")
        conn.close()
        return

    success_count = 0
    skipped_count = 0

    for node in nodes_to_sync:
        best = probe.match_node(node)
        if not best or best["total_score"] < min_score:
            skipped_count += 1
            continue

        commit_hash = node["commit_hash"]
        file_id = best["ai_file_id"]
        turn_idx = best["turn_index"]
        model = best["model"].replace("models/", "")
        time_gap = best["time_diff_minutes"]

        # 构建轻量级 Markdown 引用卡片
        analyzer_url = (
            f"http://localhost:{analyzer_port}/sessions/{file_id}#turn-{turn_idx}"
        )
        google_url = f"https://aistudio.google.com/prompts/{file_id}"

        thinking_section = ""
        if best.get("thinking_process"):
            t_snippet = best["thinking_process"].strip()
            if len(t_snippet) > 400:
                t_snippet = t_snippet[:400] + "..."
            thinking_lines = t_snippet.replace("\n", "\n> ")
            thinking_section = (
                f"\n\n> 💭 **思考链摘要 (Thinking Process)**:\n> {thinking_lines}"
            )

        ai_context_md = (
            f"🔗 **AI 认知上下文溯源 (匹配度: {best['total_score']:.2f})**:\n"
            f"* 🖥️ **本地工作台**: [{best['session_name']} (Turn #{turn_idx})]({analyzer_url})\n"
            f"* 🌐 **Google AI Studio**: [在原生工作台打开]({google_url})\n"
            f"* 🤖 **模型**: `{model}` (时序相隔: {time_gap} 分钟)"
            f"{thinking_section}"
        )

        # 【核心修复】：同时将精炼内容写入 intent_md 与 ai_context
        # 满足 Quipu 的 sqlite_index.py 仅 SELECT intent_md 的设计
        if not dry_run:
            cursor.execute(
                """
                INSERT OR REPLACE INTO private_data (node_hash, intent_md, ai_context)
                VALUES (?, ?, ?)
                """,
                (commit_hash, ai_context_md, ai_context_md),
            )

        success_count += 1
        prefix = "[DRY-RUN] " if dry_run else ""
        print(
            f"  ✅ {prefix}成功回填: [{commit_hash[:8]}] -> {best['session_name']} (Turn #{turn_idx}, 得分: {best['total_score']:.3f})"
        )

    if not dry_run:
        conn.commit()
        print(f"\n🎉 写入完成: 成功回填 {success_count} 个节点至 intent_md (跳过/未达阈值: {skipped_count})。")
    else:
        print(f"\n💡 [DRY-RUN] 预演完成: 可对齐 {success_count} 个节点 (跳过: {skipped_count})。")
~~~~~
~~~~~python
    total_nodes = len(nodes_to_sync)
    print(f"🔍 检索到 {total_nodes} 个待对齐/刷新的 Quipu 节点 (force={force})。")
    if not nodes_to_sync:
        print("✅ 所有 Plan 节点均已包含意图内容，无需处理。如需全量重新对齐请添加 --force 参数。")
        conn.close()
        return

    success_count = 0
    skipped_count = 0

    with tqdm(
        total=total_nodes,
        desc="⚡ 回填意图",
        unit="node",
        bar_format="{l_bar}{bar:30}{r_bar}",
        colour="cyan",
    ) as pbar:
        for node in nodes_to_sync:
            best = probe.match_node(node)
            if not best or best["total_score"] < min_score:
                skipped_count += 1
                pbar.set_postfix({"成功": success_count, "跳过": skipped_count})
                pbar.update(1)
                continue

            commit_hash = node["commit_hash"]
            file_id = best["ai_file_id"]
            turn_idx = best["turn_index"]
            model = best["model"].replace("models/", "")
            time_gap = best["time_diff_minutes"]

            # 构建轻量级 Markdown 引用卡片
            analyzer_url = (
                f"http://localhost:{analyzer_port}/sessions/{file_id}#turn-{turn_idx}"
            )
            google_url = f"https://aistudio.google.com/prompts/{file_id}"

            thinking_section = ""
            if best.get("thinking_process"):
                t_snippet = best["thinking_process"].strip()
                if len(t_snippet) > 400:
                    t_snippet = t_snippet[:400] + "..."
                thinking_lines = t_snippet.replace("\n", "\n> ")
                thinking_section = (
                    f"\n\n> 💭 **思考链摘要 (Thinking Process)**:\n> {thinking_lines}"
                )

            ai_context_md = (
                f"🔗 **AI 认知上下文溯源 (匹配度: {best['total_score']:.2f})**:\n"
                f"* 🖥️ **本地工作台**: [{best['session_name']} (Turn #{turn_idx})]({analyzer_url})\n"
                f"* 🌐 **Google AI Studio**: [在原生工作台打开]({google_url})\n"
                f"* 🤖 **模型**: `{model}` (时序相隔: {time_gap} 分钟)"
                f"{thinking_section}"
            )

            # 同时将精炼内容写入 intent_md 与 ai_context
            if not dry_run:
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO private_data (node_hash, intent_md, ai_context)
                    VALUES (?, ?, ?)
                    """,
                    (commit_hash, ai_context_md, ai_context_md),
                )

            success_count += 1
            pbar.set_postfix({"成功": success_count, "跳过": skipped_count})

            if verbose:
                prefix = "[DRY-RUN] " if dry_run else ""
                tqdm.write(
                    f"  ✅ {prefix}成功回填: [{commit_hash[:8]}] -> {best['session_name']} (Turn #{turn_idx}, 得分: {best['total_score']:.3f})"
                )

            pbar.update(1)

    if not dry_run:
        conn.commit()
        print(f"\n🎉 写入完成: 成功回填 {success_count} 个节点至 intent_md (跳过/未达阈值: {skipped_count})。")
    else:
        print(f"\n💡 [DRY-RUN] 预演完成: 可对齐 {success_count} 个节点 (跳过: {skipped_count})。")
~~~~~

~~~~~act
patch_file
scripts/quipu/sync_intents_to_quipu.py
~~~~~
~~~~~python
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="演练模式，仅打印对齐计划，不写入 Quipu 数据库",
    )

    args = parser.parse_args()
    sync_intents(
        quipu_dir=args.quipu_dir,
        analyzer_port=args.port,
        min_score=args.min_score,
        window_hours=args.window_hours,
        force=args.force,
        dry_run=args.dry_run,
    )
~~~~~
~~~~~python
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="演练模式，仅打印对齐计划，不写入 Quipu 数据库",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="详细日志模式，显示每条成功回填的详细信息",
    )

    args = parser.parse_args()
    sync_intents(
        quipu_dir=args.quipu_dir,
        analyzer_port=args.port,
        min_score=args.min_score,
        window_hours=args.window_hours,
        force=args.force,
        dry_run=args.dry_run,
        verbose=args.verbose,
    )
~~~~~

### 下一步建议
1. **测试执行**：在命令行尝试运行 `python scripts/quipu/sync_intents_to_quipu.py --dry-run --quipu-dir <path>` 验证路径导入和进度条效果。
2. **文档更新**：在 `README.md` 的工具指引部分更新执行路径为 `python scripts/quipu/sync_intents_to_quipu.py`。
