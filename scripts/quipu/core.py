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