import csv
import json
from typing import List
from .models import PromptSession


def export_first_prompts_to_jsonl(sessions: List[PromptSession], output_path: str):
    """
    将所有会话的「首轮提问」导出为 JSONL 文件，
    包含生命周期与 Token 能耗标签，便于 LLM 进行意图与阻抗聚类。
    """
    with open(output_path, "w", encoding="utf-8") as f:
        for s in sessions:
            if s.user_prompts:
                record = {
                    "file_id": s.file_id,
                    "title": s.name,
                    "first_prompt": s.user_prompts[0],
                    "total_turns": s.turn_count,
                    "total_tokens": s.total_tokens,
                    "duration_seconds": s.duration_seconds,
                    "has_branching": s.has_branching,
                    "model": s.model,
                    "created_time": s.created_time.isoformat() if s.created_time else None
                }
                f.write(json.dumps(record, ensure_ascii=False) + "\n")


def export_prompts_summary_csv(sessions: List[PromptSession], output_path: str):
    """导出所有会话的概览统计报表 CSV (包含生命周期、Token 及摩擦力指标)"""
    fieldnames = [
        "file_id",
        "title",
        "model",
        "turn_count",
        "duration_human",
        "duration_seconds",
        "total_tokens",
        "thought_tokens",
        "has_branching",
        "branch_count",
        "user_char_count",
        "first_prompt_preview"
    ]
    with open(output_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for s in sessions:
            first_prompt = s.user_prompts[0] if s.user_prompts else ""
            preview = first_prompt[:80].replace("\n", " ") + ("..." if len(first_prompt) > 80 else "")
            writer.writerow({
                "file_id": s.file_id,
                "title": s.name,
                "model": s.model,
                "turn_count": s.turn_count,
                "duration_human": s.duration_human,
                "duration_seconds": s.duration_seconds,
                "total_tokens": s.total_tokens,
                "thought_tokens": s.thought_tokens,
                "has_branching": s.has_branching,
                "branch_count": s.branch_count,
                "user_char_count": s.total_user_chars,
                "first_prompt_preview": preview
            })