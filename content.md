这两个问题切中要害。持续时长为 0 是因为 Google Drive 的 `createdTime` 属于云端文件元数据，未保存在 AI Studio 内部 JSON 中，导致纯离线加载时由于缺少起点时间戳退化为 0；同时将导出报表改为显式 `--export` 触发，避免反复产生冗余文件。

## [WIP] fix(metrics,cli): 修复会话生命周期时长为零的问题并默认关闭产物导出

### 错误分析
1. **持续时长归零的原因**：
   - AI Studio 导出的原始 JSON 的顶层只有 `chunkedPrompt`、`runSettings` 和 `systemInstruction`，并没有顶层的 `createdTime` 字段。
   - 离线从 SQLite 加载时，`loader.py` 只能从 `file_cache` 恢复 `file_id`、`modified_time` 和内部 JSON，由于缺乏 `created_time`，旧逻辑 `if self.created_time and self.modified_time:` 判定失败，直接返回 `None` / `0.0`。
   - **修复方案**：虽然顶层没有 `createdTime`，但 `chunkedPrompt.chunks` 中的**每个交互块均带有精确到毫秒的 `createTime`**。会话的真正开始时间是首个 chunk 的时间戳，结束时间是末个 chunk 时间戳与 `modified_time` 的最大值。通过时序插值推导，即可在离线状态下精确恢复每场对话的真实交互跨度。
2. **产物默认输出问题**：
   - 之前的 CLI 默认直接写入 `first_prompts_for_clustering.jsonl` 和 `prompts_summary.csv`，容易在频繁调试和查看指标时污染工作区根目录。
   - **修复方案**：将 `--no-export` 逻辑反转为 `--export` 开关，默认仅在终端打印分析看板，只有显式传入 `--export` 时才写入磁盘文件。

### 用户需求
1. 默认执行 `analyze` 或 `pull` 时**不再生成导出文件**，仅打印终端指标，需支持通过 `--export` 参数显式开启导出。
2. 修复生命周期持续时长（Duration）始终显示为 0.0 分钟的问题，准确统计各会话的时长分布。

### 评论
依赖云端外部元数据的计算模型是不稳健的；依靠会话内部的天然交互时序（Chunks的时序序列）推导生命周期，不仅解决了离线元数据丢失的问题，而且比云端单纯的文件创建时间更加准确地反映了用户在当前会话中从第一句到最后一句的“实际心智驻留时间”。默认关闭文件导出则符合标准 Unix 命令行工具的优雅准则。

### 目标
1. 升级 `src/analyzer/models.py`：新增 `start_time` 与 `end_time` 推导属性，结合 Chunks 时间戳与修改时间计算真实跨度。
2. 升级 `src/analyzer/metrics.py`：细化生命周期指标，分别展示全量会话与多轮深度会话的平均驻留时长。
3. 调整 `main.py`：将导出选项改为 `--export`，默认不输出文件。

### 基本原理
每个有效会话都至少包含一个用户提问 chunk。首个提问块的创建时间点即为会话思维流启动的原点；末尾交互块（或云端保存修改点）为会话终止点。两者相减即可得到该思维流的真实生命周期。

### 标签
#intent/fix #flow/ready #priority/high #comp/runtime #comp/cli #concept/state #scope/core #scope/ux #ai/instruct #task/domain/analytics #task/object/duration-and-cli-flags #task/action/bug-fix #task/state/continue

---

### Script

#### Acts 1: 升级 `src/analyzer/models.py`，基于 Chunks 时间序列推导生命周期

为 `PromptSession` 增加自适应时间序列边界推导（`start_time` 与 `end_time`），彻底解决离线时缺少 `createdTime` 的问题。

~~~~~act
write_file
src/analyzer/models.py
~~~~~
~~~~~python
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any


@dataclass
class ConversationTurn:
    """单轮对话数据 (支持 Token、思考链与分支追踪)"""
    role: str                       # 'user' | 'model' | 'system'
    text: str                       # 文本内容
    token_count: int = 0            # 该轮消耗的精确 Token 数量
    is_thought: bool = False        # 是否为 Gemini 2.0 Thinking 思考过程
    payload_type: str = "text"      # 'text' | 'inlineFile' | 'driveDocument' | 'other'
    timestamp: Optional[datetime] = None
    branch_parent: Optional[Any] = None       # 分支父节点引用
    branch_children: List[Any] = field(default_factory=list) # 派生出的分支列表
    is_edited: bool = False         # 是否为用户手动编辑过的历史节点
    extra_metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PromptSession:
    """单个 AI Studio 对话会话 (支持生命周期与认知消耗审计)"""
    file_id: str                    # Google Drive 文件 ID
    name: str                       # 对话/文件名称
    model: str                      # 绑定的模型标识 (如 gemini-1.5-pro)
    created_time: Optional[datetime] # 云端创建时间
    modified_time: Optional[datetime]# 最后修改时间
    turns: List[ConversationTurn]   # 会话的所有轮次
    system_instruction: str = ""    # 系统指令 / 前置协议

    @property
    def start_time(self) -> Optional[datetime]:
        """推导会话起始时间：优先采用 created_time，其次推导自首个有效 Chunk 的时间戳"""
        if self.created_time:
            return self.created_time
        turn_times = [t.timestamp for t in self.turns if t.timestamp]
        return min(turn_times) if turn_times else None

    @property
    def end_time(self) -> Optional[datetime]:
        """推导会话结束时间：结合末轮 Chunk 时间与 modified_time 的最新值"""
        turn_times = [t.timestamp for t in self.turns if t.timestamp]
        max_turn_time = max(turn_times) if turn_times else None
        if self.modified_time and max_turn_time:
            return max(self.modified_time, max_turn_time)
        return self.modified_time or max_turn_time

    @property
    def duration(self) -> Optional[timedelta]:
        """会话生命周期持续时间 (从首轮交互到最后修改/回复)"""
        start = self.start_time
        end = self.end_time
        if start and end:
            delta = end - start
            return delta if delta.total_seconds() >= 0 else timedelta(0)
        return None

    @property
    def duration_seconds(self) -> float:
        """会话生命周期持续秒数"""
        d = self.duration
        return round(d.total_seconds(), 1) if d else 0.0

    @property
    def duration_human(self) -> str:
        """生命周期人类友好格式展示 (如 2h 15m)"""
        if not self.duration:
            return "0s"
        total_sec = int(self.duration.total_seconds())
        if total_sec < 60:
            return f"{total_sec}s"
        hours, remainder = divmod(total_sec, 3600)
        minutes, seconds = divmod(remainder, 60)
        parts = []
        if hours > 0:
            parts.append(f"{hours}h")
        if minutes > 0:
            parts.append(f"{minutes}m")
        if not parts:
            parts.append(f"{seconds}s")
        return " ".join(parts)

    @property
    def user_prompts(self) -> List[str]:
        """提取所有属于用户的有效发言文本"""
        return [turn.text for turn in self.turns if turn.role == 'user']

    @property
    def turn_count(self) -> int:
        """对话轮次总数 (排除纯思考块)"""
        return len([t for t in self.turns if not t.is_thought])

    @property
    def total_tokens(self) -> int:
        """该会话消耗的 Token 总量"""
        return sum(t.token_count for t in self.turns)

    @property
    def user_tokens(self) -> int:
        """用户端输入消耗的 Token 数"""
        return sum(t.token_count for t in self.turns if t.role == 'user')

    @property
    def model_tokens(self) -> int:
        """模型端生成消耗的 Token 数 (含思考)"""
        return sum(t.token_count for t in self.turns if t.role == 'model')

    @property
    def thought_tokens(self) -> int:
        """模型专属思考链 (Thinking) 消耗的 Token 计数"""
        return sum(t.token_count for t in self.turns if t.is_thought)

    @property
    def total_user_chars(self) -> int:
        """用户提问的总字符量"""
        return sum(len(text) for text in self.user_prompts)

    @property
    def branch_count(self) -> int:
        """分支/重试派生次数"""
        return sum(1 for t in self.turns if t.branch_parent is not None or len(t.branch_children) > 0 or t.is_edited)

    @property
    def has_branching(self) -> bool:
        """是否存在分支分叉或重试编辑"""
        return self.branch_count > 0
~~~~~

#### Acts 2: 细化 `src/analyzer/metrics.py` 的时长统计

区分“全量平均时长”与“持续攻坚多轮会话的平均交互时长”，更具洞察价值。

~~~~~act
write_file
src/analyzer/metrics.py
~~~~~
~~~~~python
from typing import List, Dict, Any
from .models import PromptSession


def calculate_session_metrics(sessions: List[PromptSession]) -> Dict[str, Any]:
    """
    计算关键认知与交互消耗指标：
    1. 基础吞吐：会话总数、对话轮次
    2. 计算能耗：Token 消耗总量、思考链 (Thinking) Token 比例
    3. 任务耐受与生命周期：全量平均时长、多轮深度会话平均交互时长
    4. 思维摩擦力：重试与分支会话比例、分支总次数
    5. 模型偏好与系统指令部署概况
    """
    if not sessions:
        return {"total_sessions": 0}

    total_sessions = len(sessions)
    total_turns = sum(s.turn_count for s in sessions)
    total_user_chars = sum(s.total_user_chars for s in sessions)

    # 1. 计算能耗 (Token 维度)
    total_tokens = sum(s.total_tokens for s in sessions)
    total_thought_tokens = sum(s.thought_tokens for s in sessions)
    thought_ratio = (
        f"{round(total_thought_tokens / total_tokens * 100, 2)}%"
        if total_tokens > 0 else "0%"
    )

    # 2. 任务耐受度与生命周期 (Duration 维度)
    deep_sessions = [s for s in sessions if s.turn_count >= 5]
    multi_turn_sessions = [s for s in sessions if s.turn_count >= 2]

    # 有效持续时长（大于 10 秒的会话）
    meaningful_durations = [s.duration_seconds for s in sessions if s.duration_seconds >= 10]
    avg_duration_min = (
        round(sum(meaningful_durations) / len(meaningful_durations) / 60, 1)
        if meaningful_durations else 0.0
    )

    # 专门计算多轮会话（≥2轮）的平均驻留时长
    multi_turn_durations = [s.duration_seconds for s in multi_turn_sessions if s.duration_seconds > 0]
    avg_multi_turn_duration_min = (
        round(sum(multi_turn_durations) / len(multi_turn_durations) / 60, 1)
        if multi_turn_durations else 0.0
    )

    # 3. 思维摩擦力与沟通阻抗 (Branching 维度)
    branching_sessions = [s for s in sessions if s.has_branching]
    total_branches = sum(s.branch_count for s in sessions)

    # 4. 模型使用分布
    model_distribution: Dict[str, int] = {}
    for s in sessions:
        model_distribution[s.model] = model_distribution.get(s.model, 0) + 1

    # 5. 系统指令部署会话数
    with_sys_instruction_count = sum(1 for s in sessions if s.system_instruction)

    return {
        "total_sessions": total_sessions,
        "total_turns": total_turns,
        "avg_turns_per_session": round(total_turns / total_sessions, 2),
        "total_user_chars": total_user_chars,
        "deep_session_count": len(deep_sessions),
        "deep_session_ratio": f"{round(len(deep_sessions) / total_sessions * 100, 1)}%",
        "avg_duration_minutes": avg_duration_min,
        "avg_multi_turn_duration_minutes": avg_multi_turn_duration_min,
        "total_tokens": total_tokens,
        "avg_tokens_per_session": round(total_tokens / total_sessions, 0) if total_sessions else 0,
        "total_thought_tokens": total_thought_tokens,
        "thought_token_ratio": thought_ratio,
        "friction_sessions_count": len(branching_sessions),
        "friction_session_ratio": f"{round(len(branching_sessions) / total_sessions * 100, 1)}%",
        "total_branch_retries": total_branches,
        "sys_instruction_configured_count": with_sys_instruction_count,
        "model_distribution": model_distribution,
    }
~~~~~

#### Acts 3: 调整 `main.py` 默认关闭导出产物，并优化看板指标展示

将参数由 `--no-export` 调整为显式 `--export`，默认不写入文件；并在看板中打印多轮交互的平均时长。

~~~~~act
write_file
main.py
~~~~~
~~~~~python
"""
AI Studio Analyzer - 统一调度入口 (Git 风格分布式体系)

常用命令:
  1. python main.py fetch [-n 50]         # 增量拉取云端最近 50 个修改的文件写入 SQLite
  2. python main.py analyze [--export]   # 纯离线全量分析本地 SQLite 缓存 (加 --export 导出 CSV/JSONL)
  3. python main.py pull [-n 50]          # 组合操作：快速拉取最新 50 个文件，随后全量分析本地数据
"""
import argparse
import sys
from src.analyzer.drive import DriveClient, PROXY_URL
from src.analyzer.cache import SQLiteCache
from src.analyzer.sync import fetch_remote_files
from src.analyzer.loader import load_cached_sessions
from src.analyzer.metrics import calculate_session_metrics
from src.analyzer.exporter import export_first_prompts_to_jsonl, export_prompts_summary_csv


def run_analyze(cache: SQLiteCache, limit: int = 0, export: bool = False):
    """纯离线本地计算与报表分析"""
    print("\n" + "=" * 60)
    print("📊 启动本地离线认知与交互审计 (Analyzer)")
    if limit > 0:
        print(f"📌 分析模式: 采样分析本地前 {limit} 个会话")
    else:
        print("📌 分析模式: [全量分析] 正在读取本地 SQLite 全部会话资产...")
    print("=" * 60)

    sessions = load_cached_sessions(cache, limit=limit, show_progress=True)
    if not sessions:
        print("⚠️ 未加载到有效会话。请先运行 `python main.py fetch` 同步数据。")
        return

    # 指标计算
    metrics = calculate_session_metrics(sessions)
    print("\n" + "=" * 30 + " 📊 认知与能耗全景概览 " + "=" * 30)
    print(f"  - 分析会话总数:           {metrics['total_sessions']}")
    print(f"  - 总对话轮次 (Turns):     {metrics['total_turns']} (平均每会话: {metrics['avg_turns_per_session']} 轮)")
    print(f"  - 深度攻坚会话 (≥5轮):     {metrics['deep_session_count']} 场 (占比 {metrics['deep_session_ratio']})")
    print(f"  - 平均交互时长 (有效跨度): {metrics['avg_duration_minutes']} 分钟 (多轮深入会话平均: {metrics['avg_multi_turn_duration_minutes']} 分钟)")
    print(f"  - 计算能耗 (Total Tokens): {metrics['total_tokens']:,} (平均每会话: {int(metrics['avg_tokens_per_session']):,} Tokens)")
    print(f"  - 思考链消耗 (Thinking):   {metrics['total_thought_tokens']:,} Tokens (占总能耗: {metrics['thought_token_ratio']})")
    print(f"  - 思维摩擦力 (重试/分支):   {metrics['friction_sessions_count']} 场 (占比: {metrics['friction_session_ratio']}, 累计分支重试: {metrics['total_branch_retries']} 次)")
    print(f"  - 系统指令部署会话数:     {metrics['sys_instruction_configured_count']} 场")
    print(f"  - 用户提问总字数:         {metrics['total_user_chars']:,} 字符")
    print(f"  - 模型偏好分布:           {metrics['model_distribution']}")
    print("=" * 76)

    # 导出报表产物（仅在显式指定 --export 时生成）
    if export:
        jsonl_output = "first_prompts_for_clustering.jsonl"
        csv_output = "prompts_summary.csv"
        export_first_prompts_to_jsonl(sessions, jsonl_output)
        export_prompts_summary_csv(sessions, csv_output)
        print(f"\n📁 分析产物已生成 (基于全量 {len(sessions)} 条资产):")
        print(f"  1. 首轮提问清洗集 (用于聚类与反思): ./{jsonl_output}")
        print(f"  2. 对话概览指标明细 (CSV 报表):        ./{csv_output}")


def cmd_fetch(args):
    """仅网络同步"""
    print("=" * 60)
    print("🔄 正在执行云端增量同步 (Fetch)")
    print("=" * 60)
    client = DriveClient(proxy_url=PROXY_URL)
    cache = SQLiteCache(cache_dir=".cache")

    total_valid, hits, downloaded = fetch_remote_files(
        client=client,
        cache=cache,
        limit=args.limit,
        all_files=args.all
    )
    print(f"\n✅ 同步完成: 扫描有效项 {total_valid} | 命中缓存 {hits} | 增量下载 {downloaded}")
    print(f"📦 本地 SQLite 现有总会话数: {cache.count()}")


def cmd_analyze(args):
    """仅本地离线分析"""
    cache = SQLiteCache(cache_dir=".cache")
    run_analyze(cache, limit=args.limit, export=args.export)


def cmd_pull(args):
    """先拉取增量，再全量分析"""
    cmd_fetch(args)
    cache = SQLiteCache(cache_dir=".cache")
    run_analyze(cache, limit=0, export=args.export)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Google AI Studio 历史对话分析器 (Git 风格分布式体系)",
        formatter_class=argparse.RawTextHelpFormatter
    )
    subparsers = parser.add_subparsers(dest="command", help="子命令 (输入 -h 查看详情)")

    # 1. fetch 子命令
    parser_fetch = subparsers.add_parser("fetch", help="[网络] 增量拉取云端最近修改的文件写入本地 SQLite")
    parser_fetch.add_argument("-n", "--limit", type=int, default=50, help="远程扫描拉取数量限制 (默认: 50)")
    parser_fetch.add_argument("--all", action="store_true", help="全量扫描云盘 (忽略 -n)")

    # 2. analyze 子命令
    parser_analyze = subparsers.add_parser("analyze", help="[离线] 纯离线分析本地 SQLite 缓存的历史会话")
    parser_analyze.add_argument("-n", "--limit", type=int, default=0, help="分析会话上限 (默认 0 表示全量分析)")
    parser_analyze.add_argument("--export", action="store_true", help="显式导出 CSV 与 JSONL 分析文件 (默认不导出)")

    # 3. pull 子命令
    parser_pull = subparsers.add_parser("pull", help="[组合] 增量拉取最近文件更新本地库，随后执行全量分析")
    parser_pull.add_argument("-n", "--limit", type=int, default=50, help="增量拉取数量限制 (默认: 50)")
    parser_pull.add_argument("--all", action="store_true", help="全量扫描云盘并分析")
    parser_pull.add_argument("--export", action="store_true", help="分析完成后显式导出 CSV 与 JSONL 文件 (默认不导出)")

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "fetch":
        cmd_fetch(args)
    elif args.command == "analyze":
        cmd_analyze(args)
    elif args.command == "pull":
        cmd_pull(args)
    else:
        print("💡 未指定子命令，默认执行 `analyze` 查看本地指标看板。")
        print("   可用子命令: `fetch` (仅同步), `analyze` (仅本地分析), `pull` (同步并分析)")
        print("   运行 `python main.py -h` 可查看完整指令选项。\n")
        class DefaultArgs:
            limit = 0
            export = False
        cmd_analyze(DefaultArgs())


if __name__ == "__main__":
    main()
~~~~~

### 下一步建议

1. **测试离线时长统计**：
   运行 `python main.py analyze`，验证控制台输出中的“平均交互时长”与“多轮深入会话平均时长”是否已正常显示出真实分钟数，且工作区没有多余的 CSV/JSONL 生成。
2. **测试显式导出**：
   运行 `python main.py analyze --export`，验证在显式指定参数时才导出两个分析文件。
