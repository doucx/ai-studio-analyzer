好的，根据 Quipu 源码中各快照 commit 将正文存储在 `content.md` blob 的机制，以及 `CacheProjector` 默认不预填 `plan_md_cache` 的惰性策略，我将为 `inspect_quipu_alignment.py` 与 `sync_intents_to_quipu.py` 引入 Git 原生读取兜底与 SQLite 自动回填能力。

## [WIP] fix(quipu): 为认知对齐与回填脚本引入 Git content.md 惰性兜底读取与缓存回填

### 错误分析
在先前实现中，认知对齐探针与回填工具在 SQL 中使用了强过滤条件 `AND n.plan_md_cache IS NOT NULL AND length(n.plan_md_cache) > 20`。
然而根据 Quipu 核心模块 `quipu.engine.projector` 的实现，当仓库通过 clone、pull 或投影载入历史时，为了避免重型 I/O，`nodes.plan_md_cache` 默认被置为 `None`，真正的 Plan Markdown 保存在底层 Git 快照 commit 树根目录下的 `content.md` 中。
这导致任何投影生成的有效 Quipu 仓库（如 FormSight 中的 818 个 Plan 节点）都会在初次检索时被误判为空节点而全部过滤，检索结果为 0。

### 用户需求
修复 `scripts/quipu/` 下的对齐与回填脚本，使其支持从 Git 原生存储（`<commit_hash>:content.md`）按需加载 Plan 正文，并在获取后自动补写回目标仓库的 `nodes.plan_md_cache`，使历史投影节点能够正常参与认知回填。

### 评论
该修复严格遵循了 Quipu 自身在 `quipu.engine.sqlite_storage:get_node_content` 中的官方设计模式（即本地热缓存优先，缺失则 fallback 到 Git blob，读取后回填缓存）。这不仅解决了历史节点的对齐盲区，还能顺手为目标 Quipu 仓库完成热缓存水合。

### 目标
1. 在 `inspect_quipu_alignment.py` 与 `sync_intents_to_quipu.py` 中放宽 SQL 查询条件，移除对 `plan_md_cache` 非空的硬性限制。
2. 增加 `read_git_plan_content` 函数，使用 `git show <commit_hash>:content.md` 提取正文。
3. 在 `sync_intents_to_quipu.py` 中，将从 Git 懒加载的内容自动 `UPDATE` 回填到 SQLite `nodes.plan_md_cache` 中。
4. 修正空状态提示信息，避免误导为“全部已回填”。

### 基本原理
Quipu 快照提交的 Tree 结构规范为：
```
100444 blob <meta_hash>    metadata.json
100444 blob <content_hash> content.md
040000 tree <output_hash>  snapshot
```
当 SQLite 缺少缓存时，直接通过 `git show <commit_hash>:content.md` 可在数毫秒内解出文本。在处理流程中对正文为空的节点动态拉取并回填数据库，兼顾了首次对齐的完整性与后续执行的高速命中。

### 标签
#intent/fix #flow/ready #priority/high #comp/cli #concept/sync #scope/core #scope/dx #ai/instruct #task/domain/cli #task/object/quipu-scripts #task/action/bug-fix #task/state/continue

---

### Script

#### Acts 1: 为 `inspect_quipu_alignment.py` 增加 Git 读取兜底

放宽节点拉取 SQL，并在缺少 `plan_md_cache` 时回退至 Git blob 读取。

~~~~~act
patch_file
scripts/quipu/inspect_quipu_alignment.py
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
~~~~~
~~~~~python
import argparse
import difflib
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple
from tqdm import tqdm
~~~~~

~~~~~act
patch_file
scripts/quipu/inspect_quipu_alignment.py
~~~~~
~~~~~python
def load_quipu_plan_nodes(
    quipu_dir: str, limit: Optional[int] = None
) -> List[Dict[str, Any]]:
    db_path = os.path.join(quipu_dir, ".quipu", "history.sqlite")
    if not os.path.exists(db_path):
        print(f"❌ 未找到 Quipu 数据库: {db_path}")
        sys.exit(1)

    uri = f"file:{os.path.abspath(db_path)}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    query = """
        SELECT commit_hash, output_tree, timestamp, summary, plan_md_cache
        FROM nodes 
        WHERE node_type = 'plan' AND plan_md_cache IS NOT NULL AND length(plan_md_cache) > 20
        ORDER BY timestamp DESC
    """
    if limit and limit > 0:
        query += f" LIMIT {limit}"

    cursor.execute(query)
    rows = cursor.fetchall()
    nodes = [dict(r) for r in rows]
    conn.close()
    return nodes
~~~~~
~~~~~python
def read_git_plan_content(quipu_dir: str, commit_hash: str) -> Optional[str]:
    """通过 Git 原生对象库从快照 commit 提取 content.md 正文"""
    try:
        res = subprocess.run(
            ["git", "show", f"{commit_hash}:content.md"],
            cwd=quipu_dir,
            capture_output=True,
            text=True,
            check=True,
        )
        return res.stdout
    except Exception:
        return None


def load_quipu_plan_nodes(
    quipu_dir: str, limit: Optional[int] = None
) -> List[Dict[str, Any]]:
    db_path = os.path.join(quipu_dir, ".quipu", "history.sqlite")
    if not os.path.exists(db_path):
        print(f"❌ 未找到 Quipu 数据库: {db_path}")
        sys.exit(1)

    uri = f"file:{os.path.abspath(db_path)}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    query = """
        SELECT commit_hash, output_tree, timestamp, summary, plan_md_cache
        FROM nodes 
        WHERE node_type = 'plan'
        ORDER BY timestamp DESC
    """
    if limit and limit > 0:
        query += f" LIMIT {limit}"

    cursor.execute(query)
    rows = cursor.fetchall()
    nodes = []
    for r in rows:
        item = dict(r)
        content = item.get("plan_md_cache")
        if not content or len(content) < 20:
            content = read_git_plan_content(quipu_dir, item["commit_hash"])
            item["plan_md_cache"] = content
        if item["plan_md_cache"] and len(item["plan_md_cache"]) >= 20:
            nodes.append(item)

    conn.close()
    return nodes
~~~~~

#### Acts 2: 改造 `sync_intents_to_quipu.py` 支持 Git 兜底与数据库热回填

放宽 SQL，对无缓存节点从 Git 提取正文，并顺手 `UPDATE` 回填到目标仓库的 `nodes.plan_md_cache`。

~~~~~act
patch_file
scripts/quipu/sync_intents_to_quipu.py
~~~~~
~~~~~python
import argparse
import os
from pathlib import Path
import sqlite3
import sys
from tqdm import tqdm
~~~~~
~~~~~python
import argparse
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
from typing import Optional
from tqdm import tqdm
~~~~~

~~~~~act
patch_file
scripts/quipu/sync_intents_to_quipu.py
~~~~~
~~~~~python
from inspect_quipu_alignment import AlignmentProbe
from src.analyzer.cache import SQLiteCache


def sync_intents(
~~~~~
~~~~~python
from inspect_quipu_alignment import AlignmentProbe
from src.analyzer.cache import SQLiteCache


def read_git_plan_content(quipu_dir: str, commit_hash: str) -> Optional[str]:
    """通过 Git 从快照 commit 中提取 content.md 正文"""
    try:
        res = subprocess.run(
            ["git", "show", f"{commit_hash}:content.md"],
            cwd=quipu_dir,
            capture_output=True,
            text=True,
            check=True,
        )
        return res.stdout
    except Exception:
        return None


def sync_intents(
~~~~~

~~~~~act
patch_file
scripts/quipu/sync_intents_to_quipu.py
~~~~~
~~~~~python
    # 根据 force 参数决定是全量重刷还是仅补全缺失
    filter_sql = ""
    if not force:
        filter_sql = "AND (p.intent_md IS NULL OR p.intent_md = '')"

    query = f"""
        SELECT n.commit_hash, n.output_tree, n.timestamp, n.summary, n.plan_md_cache
        FROM nodes n
        LEFT JOIN private_data p ON n.commit_hash = p.node_hash
        WHERE n.node_type = 'plan' 
          AND n.plan_md_cache IS NOT NULL 
          AND length(n.plan_md_cache) > 20
          {filter_sql}
        ORDER BY n.timestamp DESC
    """
    cursor.execute(query)
    nodes_to_sync = [dict(r) for r in cursor.fetchall()]

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
~~~~~
~~~~~python
    # 根据 force 参数决定是全量重刷还是仅补全缺失
    filter_sql = ""
    if not force:
        filter_sql = "AND (p.intent_md IS NULL OR p.intent_md = '')"

    query = f"""
        SELECT n.commit_hash, n.output_tree, n.timestamp, n.summary, n.plan_md_cache
        FROM nodes n
        LEFT JOIN private_data p ON n.commit_hash = p.node_hash
        WHERE n.node_type = 'plan' 
          {filter_sql}
        ORDER BY n.timestamp DESC
    """
    cursor.execute(query)
    nodes_to_sync = [dict(r) for r in cursor.fetchall()]

    total_nodes = len(nodes_to_sync)
    print(f"🔍 检索到 {total_nodes} 个待对齐/刷新的 Quipu 节点 (force={force})。")
    if not nodes_to_sync:
        if not force:
            print("✅ 检索到的所有 Plan 节点均已包含意图内容，无需处理。如需全量重新对齐请添加 --force 参数。")
        else:
            print("⚠️ 未检索到任何 Plan 节点。")
        conn.close()
        return

    success_count = 0
    skipped_count = 0
    hydrated_cache_count = 0

    with tqdm(
        total=total_nodes,
        desc="⚡ 回填意图",
        unit="node",
        bar_format="{l_bar}{bar:30}{r_bar}",
        colour="cyan",
    ) as pbar:
        for node in nodes_to_sync:
            # 1. 若 plan_md_cache 缺失，从底层 Git 的 content.md 提取
            plan_content = node.get("plan_md_cache")
            if not plan_content or len(plan_content) < 20:
                git_content = read_git_plan_content(quipu_dir_abs, node["commit_hash"])
                if git_content:
                    node["plan_md_cache"] = git_content
                    plan_content = git_content
                    # 顺手回填到目标仓库 SQLite 的 plan_md_cache
                    if not dry_run:
                        try:
                            cursor.execute(
                                "UPDATE nodes SET plan_md_cache = ? WHERE commit_hash = ?",
                                (git_content, node["commit_hash"]),
                            )
                            hydrated_cache_count += 1
                        except Exception:
                            pass

            if not plan_content or len(plan_content) < 20:
                skipped_count += 1
                pbar.set_postfix({"成功": success_count, "跳过": skipped_count})
                pbar.update(1)
                continue

            best = probe.match_node(node)
            if not best or best["total_score"] < min_score:
                skipped_count += 1
                pbar.set_postfix({"成功": success_count, "跳过": skipped_count})
                pbar.update(1)
                continue
~~~~~

~~~~~act
patch_file
scripts/quipu/sync_intents_to_quipu.py
~~~~~
~~~~~python
    if not dry_run:
        conn.commit()
        print(f"\n🎉 写入完成: 成功回填 {success_count} 个节点至 intent_md (跳过/未达阈值: {skipped_count})。")
    else:
        print(f"\n💡 [DRY-RUN] 预演完成: 可对齐 {success_count} 个节点 (跳过: {skipped_count})。")
~~~~~
~~~~~python
    if not dry_run:
        conn.commit()
        hydrate_msg = f"，同时补水激活了 {hydrated_cache_count} 个节点的 plan_md_cache" if hydrated_cache_count > 0 else ""
        print(f"\n🎉 写入完成: 成功回填 {success_count} 个节点至 intent_md (跳过/未达阈值: {skipped_count}{hydrate_msg})。")
    else:
        print(f"\n💡 [DRY-RUN] 预演完成: 可对齐 {success_count} 个节点 (跳过: {skipped_count})。")
~~~~~

### 下一步建议
1. **执行验证**：运行 `python scripts/quipu/sync_intents_to_quipu.py --verbose --quipu-dir ../FormSight/`，观察是否成功扫描出 818 个节点并开始对齐。
2. **探针验证**：若需要查看对齐命中率分布，可先运行 `python scripts/quipu/inspect_quipu_alignment.py --quipu-dir ../FormSight/ --limit 50`。
