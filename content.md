好的，我将把 `scripts/quipu/` 目录重构成一个功能闭环的统一工具箱：提供单一的 CLI 入口点 `main.py`，并将功能拆分为 `status`（健康度诊断）、`hydrate`（Git正文补水）、`sync`（意图回填）、`probe`（对齐审查）与 `clear`（意图重置）等完整生命周期命令。

## [WIP] refactor(quipu): 构建统一 CLI 桥接工具箱并形成全流程生命周期闭环

### 用户需求
1. 为 `scripts/quipu` 构建唯一的命令行入口，收拢分散的脚本。
2. 增加状态与完整率看板（如显示 `plan_md_cache` 覆盖率、`intent_md` 回填率）。
3. 增加生命周期闭环功能，包括正文缓存批量补水 (`hydrate`) 和意图清空重置 (`clear`)。

### 评论
此前散落的单独脚本缺乏统一的参数调度与状态感知。通过建立统一的 CLI 桥接器（Quipu Bridge CLI），将底层的对齐引擎抽象为 `core.py`，外部通过 `status -> hydrate -> probe -> sync -> clear` 组成完整的生命周期闭环，大幅提升了操作确定性与开发者体验。

### 目标
1. 创建 `scripts/quipu/core.py`，集中封装 Git blob 提取、SQLite 状态审计、缓存水合及对齐探针等核心逻辑。
2. 创建 `scripts/quipu/main.py` 及 `__main__.py`，提供多子命令统一分发的 CLI 入口：
   - `status`: 输出节点总数、Plan 缓存完整率、意图回填覆盖率及近期样本。
   - `hydrate`: 批量从 Git 的 `content.md` 补水物化 `plan_md_cache`。
   - `probe`: 执行批量对齐审查与时钟时区因果分析。
   - `sync`: 执行带进度条与热回填的认知意图同步。
   - `clear`: 安全清空已回填的意图数据（支持演练与确认）。
3. 清理已整合的旧入口文件。

### 基本原理
Quipu 仓库历史的维护遵循“Git 真实事实 -> SQLite 视图索引 -> 认知元数据强化”的三层架构。新架构将状态感知（`status`）作为决策依据，缺失时可由 `hydrate` 快速修复物理缓存，随后运行 `sync` 进行认知强化；若要重新实验匹配算法，可通过 `clear` 安全重置意图，从而形成闭环。

### 标签
#intent/refine #flow/ready #priority/high #comp/cli #concept/sync #scope/core #scope/dx #ai/instruct #task/domain/cli #task/object/quipu-bridge #task/action/refactor #task/state/continue

---

### Script

#### Acts 1: 构建核心支持库 `scripts/quipu/core.py`

集中封装 Git 提取、状态审计、缓存补水与对齐探针等引擎级逻辑。

~~~~~act
write_file
scripts/quipu/core.py
~~~~~
~~~~~python
"""
Quipu ↔ AI Studio 认知溯源核心引擎与基础设施模块
"""

import difflib
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

# 将项目根目录注入 sys.path，保证无论在何处执行均能定位 src 模块
PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.analyzer.cache import SQLiteCache
from src.analyzer.models import PromptSession
from src.analyzer.parser import parse_prompt_json

PATH_PATTERN = re.compile(
    r"[a-zA-Z0-9_\u4e00-\u9fa5\.\-]+/[a-zA-Z0-9_\u4e00-\u9fa5\.\-\/]+\.[a-zA-Z0-9]+"
)
HEADING_PATTERN = re.compile(r"^\s*#{1,6}\s+(.*)", re.MULTILINE)
TRIGGER_WORDS_PATTERN = re.compile(
    r"^(开始|开始实施|实施|执行|继续|好的|收到|ok|yes|按此修改|可以|开始写代码|同意|按照计划执行|按方案|go|proceed)[!。！~ \.]*$",
    re.IGNORECASE,
)


def get_quipu_db_path(quipu_dir: str) -> str:
    abs_dir = os.path.abspath(quipu_dir)
    db_path = os.path.join(abs_dir, ".quipu", "history.sqlite")
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"未找到 Quipu 数据库: {db_path}，请确认目录是否为有效 Quipu 仓库。")
    return db_path


def read_git_plan_content(quipu_dir: str, commit_hash: str) -> Optional[str]:
    """通过 Git 从快照 commit 的树根目录提取 content.md 正文"""
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


def extract_paths(text: str) -> Set[str]:
    matches = PATH_PATTERN.findall(text)
    return {m.strip() for m in matches if not m.startswith("http") and "/" in m}


def extract_title(text: str) -> str:
    match = HEADING_PATTERN.search(text)
    if match:
        return match.group(1).strip()
    for line in text.splitlines():
        line = line.strip()
        if line:
            return line[:60]
    return ""


def text_similarity(a: str, b: str, max_chars: int = 2500) -> float:
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a[:max_chars], b[:max_chars]).quick_ratio()


def set_jaccard(set_a: Set[str], set_b: Set[str]) -> float:
    if not set_a or not set_b:
        return 0.0
    intersection = len(set_a & set_b)
    union = len(set_a | set_b)
    return intersection / union if union > 0 else 0.0


def resolve_effective_user_prompt(
    session: PromptSession, model_turn_idx: int
) -> Tuple[str, bool]:
    user_turns = []
    for i in range(model_turn_idx):
        t = session.turns[i]
        if t.role == "user" and t.text and t.payload_type == "text":
            user_turns.append(t.text.strip())

    if not user_turns:
        return "", False

    immediate_prompt = user_turns[-1]
    is_short = (
        len(immediate_prompt) < 18
        or TRIGGER_WORDS_PATTERN.match(immediate_prompt) is not None
    )

    if is_short and len(user_turns) >= 2:
        substantive_prompt = user_turns[-2]
        combined_intent = (
            f"[前置诉求]: {substantive_prompt}\n"
            f"        ➔ [触发确认]: {immediate_prompt}"
        )
        return combined_intent, True

    return immediate_prompt, False


class AlignmentProbe:
    """Quipu ↔ AI Studio 认知特征多维对齐探针"""

    def __init__(self, analyzer_cache: SQLiteCache, window_hours: float = 24.0):
        self.cache = analyzer_cache
        self.window_hours = window_hours

    def match_node(self, node: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        q_time_float = float(node["timestamp"])
        q_dt_utc = datetime.fromtimestamp(q_time_float, tz=timezone.utc)
        q_dt_local = datetime.fromtimestamp(q_time_float).astimezone()

        plan_content = node.get("plan_md_cache") or ""
        q_title = extract_title(plan_content) or node.get("summary", "")
        q_paths = extract_paths(plan_content)

        t_max_iso = datetime.fromtimestamp(
            q_time_float + 600, tz=timezone.utc
        ).isoformat()
        t_min_iso = datetime.fromtimestamp(
            q_time_float - (self.window_hours * 3600), tz=timezone.utc
        ).isoformat()

        sql = """
            SELECT file_id, name, model, modified_time, created_time
            FROM session_index
            WHERE modified_time >= ? AND modified_time <= ?
            ORDER BY modified_time DESC
        """
        with self.cache._get_connection() as conn:
            cur = conn.cursor()
            cur.execute(sql, (t_min_iso, t_max_iso))
            candidate_sessions = [dict(r) for r in cur.fetchall()]

        if not candidate_sessions:
            return None

        best_candidate = None
        highest_score = -1.0

        for cs in candidate_sessions:
            file_id = cs["file_id"]
            raw_data = self.cache.get(file_id)
            if not raw_data:
                continue

            session = parse_prompt_json(
                {
                    "id": file_id,
                    "name": cs["name"],
                    "modifiedTime": cs["modified_time"],
                    "createdTime": cs.get("created_time"),
                },
                raw_data,
            )
            if not session or not session.turns:
                continue

            for idx, turn in enumerate(session.turns):
                if turn.role != "model" or turn.is_thought or not turn.text:
                    continue

                m_text = turn.text
                m_title = extract_title(m_text)
                m_paths = extract_paths(m_text)

                path_score = set_jaccard(q_paths, m_paths)
                title_score = (
                    text_similarity(q_title, m_title)
                    if (q_title and m_title)
                    else 0.0
                )
                body_score = text_similarity(plan_content, m_text)

                turn_time_utc = turn.timestamp
                if turn_time_utc:
                    if turn_time_utc.tzinfo is None:
                        turn_time_utc = turn_time_utc.replace(tzinfo=timezone.utc)
                    turn_time_utc = turn_time_utc.astimezone(timezone.utc)
                else:
                    turn_time_utc = (
                        session.modified_time.astimezone(timezone.utc)
                        if session.modified_time
                        else None
                    )

                if turn_time_utc:
                    time_diff_sec = q_dt_utc.timestamp() - turn_time_utc.timestamp()
                    abs_diff = abs(time_diff_sec)
                    time_score = max(0.0, 1.0 - (abs_diff / (self.window_hours * 3600)))
                else:
                    time_diff_sec = 0.0
                    time_score = 0.5

                base_score = (
                    path_score * 0.35
                    + title_score * 0.20
                    + body_score * 0.30
                    + time_score * 0.15
                )

                if body_score >= 0.55 and path_score >= 0.25:
                    synergy_boost = min(0.12, (body_score - 0.5) * 0.2)
                    final_score = min(1.0, base_score + synergy_boost)
                else:
                    final_score = base_score

                if final_score > highest_score:
                    highest_score = final_score
                    user_prompt, is_penetrated = resolve_effective_user_prompt(
                        session, idx
                    )

                    thinking_text = ""
                    for prev_i in range(idx - 1, -1, -1):
                        p_turn = session.turns[prev_i]
                        if p_turn.is_thought:
                            thinking_text = p_turn.text
                            break

                    best_candidate = {
                        "quipu_commit": node["commit_hash"],
                        "quipu_summary": node.get("summary", ""),
                        "quipu_epoch": q_time_float,
                        "quipu_time_local": q_dt_local.strftime("%Y-%m-%d %H:%M:%S %Z"),
                        "quipu_time_utc": q_dt_utc.strftime("%Y-%m-%d %H:%M:%S UTC"),
                        "ai_file_id": file_id,
                        "session_name": session.name,
                        "model": session.model,
                        "turn_index": idx + 1,
                        "turn_time_local": turn_time_utc.astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")
                        if turn_time_utc
                        else "未知",
                        "turn_time_utc": turn_time_utc.strftime("%Y-%m-%d %H:%M:%S UTC")
                        if turn_time_utc
                        else "未知",
                        "total_score": round(final_score, 3),
                        "sub_scores": {
                            "paths": round(path_score, 3),
                            "title": round(title_score, 3),
                            "body": round(body_score, 3),
                            "time": round(time_score, 3),
                        },
                        "time_diff_seconds": round(time_diff_sec, 1),
                        "time_diff_minutes": round(time_diff_sec / 60.0, 2),
                        "user_prompt": user_prompt,
                        "is_penetrated": is_penetrated,
                        "thinking_process": thinking_text,
                        "paths_match": list(q_paths & m_paths),
                    }

        return best_candidate


class QuipuRepositoryManager:
    """Quipu 目标仓库物理及逻辑管理门面"""

    def __init__(self, quipu_dir: str):
        self.quipu_dir = os.path.abspath(quipu_dir)
        self.db_path = get_quipu_db_path(self.quipu_dir)

    def get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def ensure_private_data_schema(self, conn: sqlite3.Connection):
        conn.execute("""
            CREATE TABLE IF NOT EXISTS private_data (
                node_hash TEXT(40) PRIMARY KEY,
                intent_md TEXT,
                ai_context TEXT,
                created_at REAL DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (node_hash) REFERENCES nodes(commit_hash) ON DELETE CASCADE
            );
        """)
        conn.commit()

    def get_status(self) -> Dict[str, Any]:
        """获取目标仓库的状态统计与完整率"""
        with self.get_connection() as conn:
            self.ensure_private_data_schema(conn)
            cur = conn.cursor()

            cur.execute("SELECT COUNT(*) FROM nodes;")
            total_nodes = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM nodes WHERE node_type = 'plan';")
            total_plans = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM nodes WHERE node_type = 'capture';")
            total_captures = cur.fetchone()[0]

            cur.execute("""
                SELECT COUNT(*) FROM nodes 
                WHERE node_type = 'plan' 
                  AND plan_md_cache IS NOT NULL 
                  AND length(plan_md_cache) >= 20;
            """)
            cached_plans = cur.fetchone()[0]

            cur.execute("""
                SELECT COUNT(*) FROM private_data 
                WHERE intent_md IS NOT NULL AND trim(intent_md) != '';
            """)
            intent_count = cur.fetchone()[0]

            # 抓取最近 8 个 Plan 样本
            cur.execute("""
                SELECT n.commit_hash, n.timestamp, n.summary,
                       CASE WHEN n.plan_md_cache IS NOT NULL AND length(n.plan_md_cache) >= 20 THEN 1 ELSE 0 END as has_cache,
                       CASE WHEN p.intent_md IS NOT NULL AND trim(p.intent_md) != '' THEN 1 ELSE 0 END as has_intent
                FROM nodes n
                LEFT JOIN private_data p ON n.commit_hash = p.node_hash
                WHERE n.node_type = 'plan'
                ORDER BY n.timestamp DESC
                LIMIT 8;
            """)
            recent_plans = [dict(r) for r in cur.fetchall()]

        cache_ratio = (cached_plans / total_plans * 100) if total_plans > 0 else 0.0
        intent_ratio = (intent_count / total_plans * 100) if total_plans > 0 else 0.0

        return {
            "quipu_dir": self.quipu_dir,
            "db_path": self.db_path,
            "total_nodes": total_nodes,
            "total_plans": total_plans,
            "total_captures": total_captures,
            "cached_plans": cached_plans,
            "uncached_plans": max(0, total_plans - cached_plans),
            "cache_ratio": round(cache_ratio, 1),
            "intent_count": intent_count,
            "intent_ratio": round(intent_ratio, 1),
            "recent_plans": recent_plans,
        }

    def clear_intents(self, force: bool = False) -> int:
        """清空仓库已有的意图回填数据"""
        with self.get_connection() as conn:
            self.ensure_private_data_schema(conn)
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) FROM private_data WHERE intent_md IS NOT NULL;")
            count = cur.fetchone()[0]
            if count > 0:
                cur.execute("DELETE FROM private_data;")
                conn.commit()
            return count
~~~~~

#### Acts 2: 构建统一入口 `scripts/quipu/main.py` 及桥接包

实现 `status`, `hydrate`, `sync`, `probe`, `clear` 统一子命令系统。

~~~~~act
write_file
scripts/quipu/main.py
~~~~~
~~~~~python
"""
Quipu Bridge - 统一认知对齐、生命周期与存储水合 CLI 工具箱
"""

import argparse
import sys
from datetime import datetime
from tqdm import tqdm

from core import (
    AlignmentProbe,
    QuipuRepositoryManager,
    read_git_plan_content,
)
from src.analyzer.cache import SQLiteCache


def format_pct(num: float, total: float) -> str:
    pct = (num / total * 100) if total > 0 else 0.0
    return f"{num}/{total} ({pct:.1f}%)"


def cmd_status(args):
    """显示 Quipu 仓库的认知审计与缓存状态"""
    repo = QuipuRepositoryManager(args.quipu_dir)
    status = repo.get_status()

    print("=" * 75)
    print("📊 Quipu 仓库认知桥接与缓存状态报告")
    print("=" * 75)
    print(f"📁 仓库目录:  {status['quipu_dir']}")
    print(f"🗃️ 数据库:    {status['db_path']}")
    print("-" * 75)
    print(
        f"• 状态节点总量:       {status['total_nodes']} 个 (Plan: {status['total_plans']}, Capture: {status['total_captures']})"
    )
    cache_badge = "✅ 完备" if status["uncached_plans"] == 0 else f"⚠️ 待补水 {status['uncached_plans']} 个"
    print(
        f"• Plan 正文缓存覆盖:  {format_pct(status['cached_plans'], status['total_plans'])} [{cache_badge}]"
    )
    print(
        f"• 认知意图回填覆盖:   {format_pct(status['intent_count'], status['total_plans'])}"
    )
    print("-" * 75)
    print("🕒 最近 Plan 样本状态 (最新 8 场):")
    for p in status["recent_plans"]:
        dt_str = datetime.fromtimestamp(p["timestamp"]).strftime("%Y-%m-%d %H:%M")
        c_mark = "✅" if p["has_cache"] else "❌"
        i_mark = "✅" if p["has_intent"] else "⚪"
        summary = (p["summary"][:42] + "..") if len(p["summary"]) > 42 else p["summary"]
        print(f"  [{p['commit_hash'][:7]}] {dt_str} (缓存:{c_mark} | 意图:{i_mark}) - {summary}")

    print("=" * 75)
    if status["uncached_plans"] > 0:
        print("💡 提示: 存在未缓存正文的 Plan 节点，可执行 `hydrate` 命令从 Git 一键补水加速。")
    if status["intent_count"] == 0 and status["total_plans"] > 0:
        print("💡 提示: 尚未回填认知意图，可执行 `sync` 命令与 AI Studio 进行自动溯源回填。")


def cmd_hydrate(args):
    """从 Git blob 批量提取 content.md 填补 nodes.plan_md_cache"""
    repo = QuipuRepositoryManager(args.quipu_dir)
    with repo.get_connection() as conn:
        cur = conn.cursor()
        query = """
            SELECT commit_hash, summary 
            FROM nodes 
            WHERE node_type = 'plan' 
              AND (plan_md_cache IS NULL OR length(plan_md_cache) < 20)
            ORDER BY timestamp DESC
        """
        if args.limit and args.limit > 0:
            query += f" LIMIT {args.limit}"
        cur.execute(query)
        targets = [dict(r) for r in cur.fetchall()]

        total = len(targets)
        print(f"💧 扫描到 {total} 个待补水的 Plan 节点...")
        if total == 0:
            print("✅ 所有的 Plan 节点均已包含正文缓存，无需补水！")
            return

        success = 0
        failed = 0

        with tqdm(total=total, desc="📦 补水缓存", unit="node", colour="blue") as pbar:
            for item in targets:
                commit_hash = item["commit_hash"]
                content = read_git_plan_content(repo.quipu_dir, commit_hash)
                if content and len(content) >= 20:
                    if not args.dry_run:
                        cur.execute(
                            "UPDATE nodes SET plan_md_cache = ? WHERE commit_hash = ?",
                            (content, commit_hash),
                        )
                    success += 1
                else:
                    failed += 1
                pbar.set_postfix({"成功": success, "未读出": failed})
                pbar.update(1)

        if not args.dry_run:
            conn.commit()
            print(f"\n🎉 补水完成: 成功为 {success} 个节点物化正文缓存 (失败/无正文: {failed})。")
        else:
            print(f"\n💡 [DRY-RUN] 演练完成: 可成功补水 {success} 个节点。")


def cmd_clear(args):
    """安全清空仓库已有的意图回填数据"""
    repo = QuipuRepositoryManager(args.quipu_dir)
    status = repo.get_status()

    if status["intent_count"] == 0:
        print("ℹ️ 目标仓库的 private_data 中不存在任何意图回填记录，无需清空。")
        return

    print(f"⚠️ 即将清空 [{repo.quipu_dir}] 中的 {status['intent_count']} 条意图回填数据！")
    if not args.yes:
        confirm = input("确定继续执行清空吗? [y/N]: ").strip().lower()
        if confirm != "y":
            print("🚫 操作已取消。")
            return

    deleted = repo.clear_intents(force=True)
    print(f"✨ 已成功清空 {deleted} 条 intent_md 记录。现在可使用 sync 重新进行纯净对齐。")


def cmd_probe(args):
    """执行无副作用的对齐探针与时钟因果审计"""
    repo = QuipuRepositoryManager(args.quipu_dir)
    cache = SQLiteCache(cache_dir=args.cache_dir)
    probe = AlignmentProbe(analyzer_cache=cache, window_hours=args.window_hours)

    print("=" * 80)
    print("🔬 Quipu ↔ AI Studio 认知溯源对齐探针 [深度审计模式]")
    print("=" * 80)
    print(f"📁 Quipu 仓库:  {repo.quipu_dir}")
    print(f"📦 Analyzer 库:  {cache.db_path} ({cache.count()} 场会话)")
    print(f"🎯 审查规模:    最近 {args.limit} 个 Plan 节点 | 回溯窗口: {args.window_hours}h | 判定基线: {args.min_score}")
    print("-" * 80)

    with repo.get_connection() as conn:
        cur = conn.cursor()
        query = "SELECT commit_hash, output_tree, timestamp, summary, plan_md_cache FROM nodes WHERE node_type = 'plan' ORDER BY timestamp DESC"
        if args.limit and args.limit > 0:
            query += f" LIMIT {args.limit}"
        cur.execute(query)
        nodes = [dict(r) for r in cur.fetchall()]

    if not nodes:
        print("⚠️ 未检索到 Plan 节点。")
        return

    strong_hits = []
    borderline_hits = []
    missed_count = 0
    penetrated_count = 0

    with tqdm(nodes, desc="⚡ 正在对齐历史节点", unit="node", colour="green") as pbar:
        for node in pbar:
            # 自动兜底提取
            if not node.get("plan_md_cache") or len(node["plan_md_cache"]) < 20:
                node["plan_md_cache"] = read_git_plan_content(repo.quipu_dir, node["commit_hash"])

            if not node.get("plan_md_cache") or len(node["plan_md_cache"]) < 20:
                missed_count += 1
                continue

            res = probe.match_node(node)
            if not res or res["total_score"] < 0.30:
                missed_count += 1
            elif res["total_score"] >= args.min_score:
                strong_hits.append(res)
                if res.get("is_penetrated"):
                    penetrated_count += 1
            else:
                borderline_hits.append(res)

    total_scanned = len(nodes)
    strong_count = len(strong_hits)
    border_count = len(borderline_hits)
    hit_rate = (strong_count / total_scanned * 100) if total_scanned > 0 else 0

    print("\n" + "=" * 80)
    print("📊 批量认知溯源对齐 - 统计审计总览")
    print("=" * 80)
    print(f"  - 审计 Quipu Plan 节点总量:    {total_scanned} 场")
    print(f"  - ✅ 确定置信命中 (Score>={args.min_score}):  {strong_count} 场 (命中率: {hit_rate:.1f}%)")
    print(f"  - ⚠️  临界弱相关 (0.30<=Score<{args.min_score}): {border_count} 场")
    print(f"  - ❌ 未命中 (Score<0.30 或无正文):  {missed_count} 场")
    print("-" * 80)
    if strong_count > 0:
        avg_score = sum(s["total_score"] for s in strong_hits) / strong_count
        avg_time_gap = sum(s["time_diff_minutes"] for s in strong_hits) / strong_count
        print(f"  - 🧠 短指令向前穿透率:          {penetrated_count}/{strong_count} ({(penetrated_count/strong_count*100):.1f}%)")
        print(f"  - 📈 强命中平均置信度得分:      {avg_score:.3f}")
        print(f"  - ⏱️  真实时差 (Quipu执行 - AI生成): 平均 {avg_time_gap:.1f} 分钟")

        # 打印置信度最高的代表样本
        best_sample = max(strong_hits, key=lambda x: x["total_score"])
        print("\n🌟 [最高置信度代表样本]:")
        print(f"  Commit: [{best_sample['quipu_commit'][:8]}] {best_sample['quipu_summary']}")
        print(f"  AI会话: {best_sample['session_name']} (Turn #{best_sample['turn_index']}, 得分: {best_sample['total_score']:.3f})")
        print(f"  意图:   \"{best_sample.get('user_prompt', '')[:100]}...\"")
    print("=" * 80)


def cmd_sync(args):
    """执行 AI Studio 意图回填到 Quipu (带进度条与热回填)"""
    repo = QuipuRepositoryManager(args.quipu_dir)
    cache = SQLiteCache(cache_dir=args.cache_dir)
    probe = AlignmentProbe(analyzer_cache=cache, window_hours=args.window_hours)

    conn = repo.get_connection()
    repo.ensure_private_data_schema(conn)
    cur = conn.cursor()

    filter_sql = ""
    if not args.force:
        filter_sql = "AND (p.intent_md IS NULL OR trim(p.intent_md) = '')"

    query = f"""
        SELECT n.commit_hash, n.output_tree, n.timestamp, n.summary, n.plan_md_cache
        FROM nodes n
        LEFT JOIN private_data p ON n.commit_hash = p.node_hash
        WHERE n.node_type = 'plan' 
          {filter_sql}
        ORDER BY n.timestamp DESC
    """
    cur.execute(query)
    nodes = [dict(r) for r in cur.fetchall()]

    total = len(nodes)
    print(f"🔍 检索到 {total} 个待对齐/刷新的 Quipu 节点 (force={args.force})。")
    if total == 0:
        if not args.force:
            print("✅ 检索到的所有 Plan 节点均已包含意图内容，无需处理。如需全量重新对齐请添加 --force 参数。")
        else:
            print("⚠️ 未检索到任何 Plan 节点。")
        conn.close()
        return

    success_count = 0
    skipped_count = 0
    hydrated_cache_count = 0

    with tqdm(total=total, desc="⚡ 回填意图", unit="node", colour="cyan") as pbar:
        for node in nodes:
            plan_content = node.get("plan_md_cache")
            if not plan_content or len(plan_content) < 20:
                git_content = read_git_plan_content(repo.quipu_dir, node["commit_hash"])
                if git_content:
                    node["plan_md_cache"] = git_content
                    plan_content = git_content
                    if not args.dry_run:
                        try:
                            cur.execute(
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
            if not best or best["total_score"] < args.min_score:
                skipped_count += 1
                pbar.set_postfix({"成功": success_count, "跳过": skipped_count})
                pbar.update(1)
                continue

            commit_hash = node["commit_hash"]
            file_id = best["ai_file_id"]
            turn_idx = best["turn_index"]
            model = best["model"].replace("models/", "")
            time_gap = best["time_diff_minutes"]

            analyzer_url = f"http://localhost:{args.port}/sessions/{file_id}#turn-{turn_idx}"
            google_url = f"https://aistudio.google.com/prompts/{file_id}"

            thinking_section = ""
            if best.get("thinking_process"):
                t_snippet = best["thinking_process"].strip()
                if len(t_snippet) > 400:
                    t_snippet = t_snippet[:400] + "..."
                thinking_lines = t_snippet.replace("\n", "\n> ")
                thinking_section = f"\n\n> 💭 **思考链摘要 (Thinking Process)**:\n> {thinking_lines}"

            ai_context_md = (
                f"🔗 **AI 认知上下文溯源 (匹配度: {best['total_score']:.2f})**:\n"
                f"* 🖥️ **本地工作台**: [{best['session_name']} (Turn #{turn_idx})]({analyzer_url})\n"
                f"* 🌐 **Google AI Studio**: [在原生工作台打开]({google_url})\n"
                f"* 🤖 **模型**: `{model}` (时序相隔: {time_gap} 分钟)"
                f"{thinking_section}"
            )

            if not args.dry_run:
                cur.execute(
                    """
                    INSERT OR REPLACE INTO private_data (node_hash, intent_md, ai_context)
                    VALUES (?, ?, ?)
                    """,
                    (commit_hash, ai_context_md, ai_context_md),
                )

            success_count += 1
            pbar.set_postfix({"成功": success_count, "跳过": skipped_count})

            if args.verbose:
                prefix = "[DRY-RUN] " if args.dry_run else ""
                tqdm.write(
                    f"  ✅ {prefix}成功回填: [{commit_hash[:8]}] -> {best['session_name']} (Turn #{turn_idx}, 得分: {best['total_score']:.3f})"
                )

            pbar.update(1)

    if not args.dry_run:
        conn.commit()
        hydrate_msg = f"，同时自动补水了 {hydrated_cache_count} 个节点的 plan_md_cache" if hydrated_cache_count > 0 else ""
        print(f"\n🎉 写入完成: 成功回填 {success_count} 个节点至 intent_md (跳过/未达阈值: {skipped_count}{hydrate_msg})。")
    else:
        print(f"\n💡 [DRY-RUN] 预演完成: 可对齐 {success_count} 个节点 (跳过: {skipped_count})。")

    conn.close()


def main():
    parser = argparse.ArgumentParser(
        prog="quipu-bridge",
        description="Quipu ↔ AI Studio 认知溯源统一控制工具箱",
    )
    subparsers = parser.add_subparsers(dest="command", required=True, help="可执行的子命令")

    # 1. status 命令
    p_status = subparsers.add_parser("status", help="查看目标 Quipu 仓库的认知桥接状态与完整率")
    p_status.add_argument("--quipu-dir", "-d", default=".", help="Quipu 仓库工作区根路径 (默认: 当前目录)")
    p_status.set_defaults(func=cmd_status)

    # 2. hydrate 命令
    p_hydrate = subparsers.add_parser("hydrate", help="从 Git 快照提取 content.md 补水物化 plan_md_cache")
    p_hydrate.add_argument("--quipu-dir", "-d", default=".", help="Quipu 仓库工作区根路径 (默认: 当前目录)")
    p_hydrate.add_argument("--limit", "-n", type=int, default=None, help="限制本次补水的最大节点数")
    p_hydrate.add_argument("--dry-run", action="store_true", help="演练模式，不写数据库")
    p_hydrate.set_defaults(func=cmd_hydrate)

    # 3. sync 命令
    p_sync = subparsers.add_parser("sync", help="执行 AI Studio 意图回填到 Quipu 的 intent_md")
    p_sync.add_argument("--quipu-dir", "-d", default=".", help="Quipu 仓库工作区根路径 (默认: 当前目录)")
    p_sync.add_argument("--cache-dir", default=".cache", help="Analyzer 缓存目录 (默认: .cache)")
    p_sync.add_argument("--port", type=int, default=5173, help="Analyzer 前端端口 (默认: 5173)")
    p_sync.add_argument("--min-score", type=float, default=0.45, help="最低判定置信度得分 (默认: 0.45)")
    p_sync.add_argument("--window-hours", type=float, default=24.0, help="时钟因果窗口小时数 (默认: 24.0)")
    p_sync.add_argument("--force", "-f", action="store_true", help="强制覆盖已有的 intent_md")
    p_sync.add_argument("--dry-run", action="store_true", help="演练模式，仅打印回填计划")
    p_sync.add_argument("--verbose", "-v", action="store_true", help="详细日志模式")
    p_sync.set_defaults(func=cmd_sync)

    # 4. probe 命令
    p_probe = subparsers.add_parser("probe", help="无副作用地审查回溯对齐置信度与时区基准")
    p_probe.add_argument("--quipu-dir", "-d", default=".", help="Quipu 仓库工作区根路径 (默认: 当前目录)")
    p_probe.add_argument("--cache-dir", default=".cache", help="Analyzer 缓存目录 (默认: .cache)")
    p_probe.add_argument("--limit", type=int, default=100, help="审查的节点数量 (默认: 100)")
    p_probe.add_argument("--min-score", type=float, default=0.45, help="判定门限得分 (默认: 0.45)")
    p_probe.add_argument("--window-hours", type=float, default=24.0, help="时间因果窗口小时数 (默认: 24.0)")
    p_probe.set_defaults(func=cmd_probe)

    # 5. clear 命令
    p_clear = subparsers.add_parser("clear", help="清空目标 Quipu 仓库的 intent_md 回填数据")
    p_clear.add_argument("--quipu-dir", "-d", default=".", help="Quipu 仓库工作区根路径 (默认: 当前目录)")
    p_clear.add_argument("--yes", "-y", action="store_true", help="跳过人工确认，直接执行清空")
    p_clear.set_defaults(func=cmd_clear)

    parsed = parser.parse_args()
    parsed.func(parsed)


if __name__ == "__main__":
    main()
~~~~~

~~~~~act
write_file
scripts/quipu/__init__.py
~~~~~
~~~~~python
"""
scripts.quipu 包
"""
~~~~~

~~~~~act
write_file
scripts/quipu/__main__.py
~~~~~
~~~~~python
from .main import main

if __name__ == "__main__":
    main()
~~~~~

#### Acts 3: 移除冗余的旧脚本文件

删除已被统一入口接管的旧文件，确保代码库干净清晰。

~~~~~act
delete_file
scripts/quipu/inspect_quipu_alignment.py
~~~~~

~~~~~act
delete_file
scripts/quipu/sync_intents_to_quipu.py
~~~~~

### 下一步建议
1. **测试状态看板**：在终端运行 `python scripts/quipu/main.py status --quipu-dir ../FormSight/`，查看 818 个节点的覆盖率及样本状态。
2. **测试批量补水**：运行 `python scripts/quipu/main.py hydrate --quipu-dir ../FormSight/`，将 818 个节点的 Plan 文本全部预热物化。
3. **测试意图同步**：运行 `python scripts/quipu/main.py sync --quipu-dir ../FormSight/`，观察带进度条的认知对齐回填。
4. **生命周期演练**：可随时使用 `python scripts/quipu/main.py clear --quipu-dir ../FormSight/` 重置回填，形成完整的生命周期闭环。
