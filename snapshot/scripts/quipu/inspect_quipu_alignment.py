"""
AI Studio & Quipu 认知对齐探针脚本 (v0.3 - 时区基准诊断与 Chunk 级时序对齐版)
"""

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


def parse_iso_to_utc(iso_str: Optional[str]) -> Optional[datetime]:
    """统一将任何 ISO 时间字符串转换为带有 UTC 时区意识的 datetime"""
    if not iso_str:
        return None
    try:
        clean = str(iso_str).replace("Z", "+00:00")
        dt = datetime.fromisoformat(clean)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


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


class AlignmentProbe:
    def __init__(self, analyzer_cache: SQLiteCache, window_hours: float = 24.0):
        self.cache = analyzer_cache
        self.window_hours = window_hours

    def match_node(self, node: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        q_time_float = float(node["timestamp"])
        # 绝对 UTC 时间
        q_dt_utc = datetime.fromtimestamp(q_time_float, tz=timezone.utc)
        # 本地时区时间（用于展示与对照）
        q_dt_local = datetime.fromtimestamp(q_time_float).astimezone()

        plan_content = node["plan_md_cache"]
        q_title = extract_title(plan_content) or node.get("summary", "")
        q_paths = extract_paths(plan_content)

        # 时间窗口：允许未来 10 分钟（时钟误差）到前 window_hours 小时
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

            # 【关键修复】：必须将 modified_time 补入 file_meta，否则 session 层时间丢失
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

                # --- 细粒度时序对齐：优先采用当前 Chunk 自身的时间戳 ---
                turn_time_utc = turn.timestamp
                if turn_time_utc:
                    if turn_time_utc.tzinfo is None:
                        turn_time_utc = turn_time_utc.replace(
                            tzinfo=timezone.utc
                        )
                    turn_time_utc = turn_time_utc.astimezone(timezone.utc)
                else:
                    turn_time_utc = (
                        session.modified_time.astimezone(timezone.utc)
                        if session.modified_time
                        else None
                    )

                if turn_time_utc:
                    # 真实绝对物理时间差 (秒)
                    time_diff_sec = (
                        q_dt_utc.timestamp() - turn_time_utc.timestamp()
                    )
                    # 正常因果关系：AI 生成应当早于 Quipu 执行 (time_diff_sec >= 0)
                    abs_diff = abs(time_diff_sec)
                    time_score = max(
                        0.0, 1.0 - (abs_diff / (self.window_hours * 3600))
                    )
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
                        "quipu_time_local": q_dt_local.strftime(
                            "%Y-%m-%d %H:%M:%S %Z"
                        ),
                        "quipu_time_utc": q_dt_utc.strftime(
                            "%Y-%m-%d %H:%M:%S UTC"
                        ),
                        "ai_file_id": file_id,
                        "session_name": session.name,
                        "model": session.model,
                        "turn_index": idx + 1,
                        "turn_time_raw": str(
                            turn.timestamp or cs["modified_time"]
                        ),
                        "turn_time_local": turn_time_utc.astimezone().strftime(
                            "%Y-%m-%d %H:%M:%S %Z"
                        )
                        if turn_time_utc
                        else "未知",
                        "turn_time_utc": turn_time_utc.strftime(
                            "%Y-%m-%d %H:%M:%S UTC"
                        )
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


# ==============================================================================
# 时区诊断卡片渲染
# ==============================================================================


def print_timezone_diagnostic_card(item: Dict[str, Any]):
    """打印时区与因果时差深度剖析卡片"""
    print(f"\n🕒 【时钟与时区对齐诊断 - Commit: {item['quipu_commit'][:8]}】")
    print(
        f"  ├─ 📌 Quipu 执行时间:   {item['quipu_time_local']}  (UTC: {item['quipu_time_utc']}, Epoch: {item['quipu_epoch']:.1f})"
    )
    print(
        f"  ├─ 🤖 AI 生成时间:      {item['turn_time_local']}  (UTC: {item['turn_time_utc']})"
    )
    print(f"  ├─ ⏱️  真实时差:         {item['time_diff_minutes']} 分钟 ({item['time_diff_seconds']} 秒)")

    # 时区异动检测
    diff_sec = item["time_diff_seconds"]
    if 28000 <= abs(diff_sec) <= 29600:
        print(
            "  └─ 🚨 [时区异常预警]: 时差接近 8 小时 (约 28800 秒)！系统极可能将本地 UTC+8 时间当作 UTC 时间存入了库中！"
        )
    elif diff_sec < -300:
        print(
            f"  └─ ⚠️ [因果倒置警告]: AI 记录的时间比 Quipu 还要晚 {abs(item['time_diff_minutes'])} 分钟！请检查系统时钟同步。"
        )
    else:
        print(
            f"  └─ ✅ [时钟对齐健康]: 因果时序正常 (AI 生成比代码提交早 {item['time_diff_minutes']} 分钟)。"
        )


def print_exemplar_card(title: str, item: Dict[str, Any]):
    print(f"\n{title}")
    print(f"  Quipu: [{item['quipu_commit'][:8]}] {item['quipu_summary']}")
    print(
        f"  时间:  Quipu={item['quipu_time_local']} | AI={item['turn_time_local']} (相隔: {item['time_diff_minutes']} 分钟)"
    )
    print(
        f"  AI会话: {item['session_name']} (Turn #{item['turn_index']}) | 最终得分: {item['total_score']:.3f}"
    )
    print(
        f"  分项:  路径={item['sub_scores']['paths']} | 标题={item['sub_scores']['title']} | 正文={item['sub_scores']['body']} | 时间={item['sub_scores']['time']}"
    )
    if item["paths_match"]:
        print(f"  命中路径: {item['paths_match'][:3]}")

    if item.get("user_prompt"):
        p_text = item["user_prompt"].strip()
        if len(p_text) > 260:
            p_text = p_text[:260] + " ...[已折叠]"
        print(
            f"  🧠 【推导意图{' (已自动穿透)' if item['is_penetrated'] else ''}】:\n      \"{p_text}\""
        )
    if item.get("thinking_process"):
        t_text = item["thinking_process"].strip().replace("\n", " ")
        if len(t_text) > 120:
            t_text = t_text[:120] + "..."
        print(f"  💭 【思考链摘要】: \"{t_text}\"")


def main():
    parser = argparse.ArgumentParser(
        description="Quipu ↔ AI Studio 大批量溯源对齐与时区诊断探针"
    )
    parser.add_argument(
        "--quipu-dir", required=True, help="Quipu 目标仓库工作区根目录"
    )
    parser.add_argument(
        "--cache-dir", default=".cache", help="Analyzer 缓存目录"
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=100,
        help="批量审查的 Commit 规模 (默认: 100)",
    )
    parser.add_argument(
        "--window-hours",
        type=float,
        default=24.0,
        help="时钟因果窗口大小/小时 (默认: 24.0)",
    )
    parser.add_argument(
        "--min-score",
        type=float,
        default=0.45,
        help="强命中门限分数 (默认: 0.45)",
    )

    args = parser.parse_args()

    quipu_dir = os.path.abspath(args.quipu_dir)
    cache = SQLiteCache(cache_dir=args.cache_dir)

    print("=" * 80)
    print("🔬 Quipu ↔ AI Studio 认知溯源对齐探针 [时序因果与时区基准核验版]")
    print("=" * 80)
    print(f"📁 Quipu 仓库:  {quipu_dir}")
    print(f"📦 Analyzer 库:  {cache.db_path} ({cache.count()} 场会话)")
    print(
        f"🎯 审查规模:    最近 {args.limit} 个 Plan 节点 | 回溯窗口: {args.window_hours}h | 判定基线: {args.min_score}"
    )
    print("=" * 80)

    nodes = load_quipu_plan_nodes(quipu_dir, limit=args.limit)
    if not nodes:
        print("⚠️ 未检索到有效的 Plan 节点。")
        return

    probe = AlignmentProbe(
        analyzer_cache=cache, window_hours=args.window_hours
    )

    strong_hits: List[Dict[str, Any]] = []
    borderline_hits: List[Dict[str, Any]] = []
    missed_nodes: List[Dict[str, Any]] = []
    penetrated_count = 0

    for node in tqdm(nodes, desc="⚡ 正在对齐历史节点", unit="commit"):
        res = probe.match_node(node)
        if not res or res["total_score"] < 0.30:
            missed_nodes.append(node)
        elif res["total_score"] >= args.min_score:
            strong_hits.append(res)
            if res.get("is_penetrated"):
                penetrated_count += 1
        else:
            borderline_hits.append(res)

    total_scanned = len(nodes)
    strong_count = len(strong_hits)
    border_count = len(borderline_hits)
    missed_count = len(missed_nodes)
    hit_rate = (strong_count / total_scanned) * 100

    print("\n" + "=" * 80)
    print("📊 批量认知溯源对齐 - 统计审计总览")
    print("=" * 80)
    print(f"  - 审计 Quipu Plan 节点总量:    {total_scanned} 场")
    print(
        f"  - ✅ 确定置信命中 (Score>={args.min_score}):  {strong_count} 场 (命中率: {hit_rate:.1f}%)"
    )
    print(
        f"  - ⚠️  临界弱相关 (0.30<=Score<{args.min_score}): {border_count} 场 ({border_count / total_scanned * 100:.1f}%)"
    )
    print(
        f"  - ❌ 彻底未命中 (Score<0.30):      {missed_count} 场 ({missed_count / total_scanned * 100:.1f}%)"
    )
    print("-" * 80)
    if strong_count > 0:
        penetrate_ratio = (penetrated_count / strong_count) * 100
        avg_score = sum(s["total_score"] for s in strong_hits) / strong_count
        avg_time_gap = (
            sum(s["time_diff_minutes"] for s in strong_hits) / strong_count
        )
        print(
            f"  - 🧠 短指令向前穿透率:          {penetrated_count}/{strong_count} ({penetrate_ratio:.1f}%)"
        )
        print(
            f"  - 📈 强命中平均置信度得分:      {avg_score:.3f}"
        )
        print(
            f"  - ⏱️  真实时差 (Quipu执行 - AI生成): 平均 {avg_time_gap:.1f} 分钟"
        )
    print("=" * 80)

    # 1. 时区诊断专属展示
    if strong_hits:
        print_timezone_diagnostic_card(strong_hits[0])

    # 2. 代表性样本展示
    print("\n🌟 [标志性典型样本透视]")
    penetrated_samples = [s for s in strong_hits if s.get("is_penetrated")]
    if penetrated_samples:
        print_exemplar_card(
            "🔹 【典型 1: 短指令意图穿透成功样本】", penetrated_samples[0]
        )

    if strong_hits:
        highest_sample = max(strong_hits, key=lambda x: x["total_score"])
        print_exemplar_card(
            "🔹 【典型 2: 最高置信度对齐样本】", highest_sample
        )

    if borderline_hits:
        print_exemplar_card(
            "🔹 【典型 3: 临界/待裁决弱候选样本】", borderline_hits[0]
        )

    print("\n" + "=" * 80)


if __name__ == "__main__":
    main()
