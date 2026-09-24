这个重构方向非常符合现代个人数据工具的演进路线。我将按照“Git 式分布式架构”的设想，把系统的网络同步（`fetch`）与本地离线计算（`analyze`）在架构和 CLI 层面进行彻底解耦。

## [WIP] feat(cli): 重构为 Git 式子命令体系 (fetch/analyze/pull) 解耦同步与分析

### 用户需求
1. 实现类似 Git 的分布式工作模式，使网络拉取与本地计算解耦：
   - `fetch`：增量同步远程更新（仅拉取最近修改的文件写入 SQLite 数据库），不阻塞、不触发数据分析。
   - `analyze`：纯本地离线运行（默认分析本地 SQLite 中全量 3000+ 会话，或根据参数切片），完全无需网络连接。
   - `pull`：组合操作，快速拉取最近更新后，立即在本地全量资产上执行分析。
2. 彻底解决“想快速拉取几个新会话却丢失全量分析”、“想做全量分析却被迫全量扫描云端”的矛盾。

### 评论
将 I/O 采集与 CPU/内存分析阶段解耦是高成熟度系统的标准设计。以前的设计将分析受限于本次同步的文件列表；解耦后，SQLite 成为本地的“对象仓库”，所有分析命令均默认基于全量历史资产运作，网络拉取则可以轻量、高频进行。

### 目标
1. **重构 `src/analyzer/parser.py`**：支持在无云端完整元数据时，直接基于 SQLite 存储的载荷与时间戳反序列化为完整的 `PromptSession`。
2. **新增 `src/analyzer/sync.py`**：将 Drive 同步与增量落库逻辑封装为纯粹的 `fetch_remote_files` 函数。
3. **新增 `src/analyzer/loader.py`**：提供从 SQLite 流式批量加载并解析 `PromptSession` 的离线加载器，支持数量限制或全量加载。
4. **重写 `main.py`**：引入 `argparse` 子命令解析器，提供 `fetch`、`analyze`、`pull` 三个标准子命令，并在无参数时提供友好的默认行为。

### 基本原理
1. **对象仓库模式 (Local Repository Pattern)**：本地 SQLite 数据库作为全量历史数据的单一真实事实源。`fetch` 负责单向填充与更新本地库，`loader` 与 `analyze` 仅与本地库交互，实现 0 网络依赖的秒级分析。
2. **CLI 语义正交化**：参数 `--limit` 在 `fetch` 中代表“远程扫描上限”，在 `analyze` 中代表“本地分析采样上限”，各司其职，互不干扰。

### 标签
#intent/build #flow/ready #priority/high #comp/cli #comp/runtime #concept/executor #scope/api #scope/ux #ai/instruct #task/domain/cli #task/object/subcommands-git-style #task/action/refactor #task/state/continue

---

### Script

#### Acts 1: 增强 `src/analyzer/parser.py`，支持从纯缓存字段反序列化

增强解析器对 `file_meta` 缺失或部分字段缺失时的容错性，优先从 `raw_data` 内置字段或回退值填充标题和时间戳。

~~~~~act
patch_file
src/analyzer/parser.py
~~~~~
~~~~~python.old
def parse_prompt_json(file_meta: Dict[str, Any], raw_data: Dict[str, Any]) -> Optional[PromptSession]:
    """
    将 Google AI Studio 原始 JSON 转化为结构化的 PromptSession 对象。
    兼容 chunkedPrompt 结构以及标准 contents 结构。
    """
    if not raw_data:
        return None

    model = raw_data.get("runSettings", {}).get("model", "unknown")
    turns = []

    # 1. 兼容旧版/常用 chunkedPrompt 结构
    if "chunkedPrompt" in raw_data:
        chunks = raw_data.get("chunkedPrompt", {}).get("chunks", [])
        for c in chunks:
            role = c.get("role", "user")
            text = c.get("text", "")
            if text:
                turns.append(ConversationTurn(role=role, text=text))

    # 2. 兼容新版 Gemini contents 结构
    elif "contents" in raw_data:
        contents = raw_data.get("contents", [])
        for item in contents:
            role = item.get("role", "user")
            parts = item.get("parts", [])
            text_blocks = [p.get("text", "") for p in parts if "text" in p]
            combined_text = "\n".join(text_blocks)
            if combined_text:
                turns.append(ConversationTurn(role=role, text=combined_text))

    if not turns:
        return None

    # 解析时间戳
    created_time = None
    modified_time = None
    if "createdTime" in file_meta:
        try:
            created_time = datetime.fromisoformat(file_meta["createdTime"].replace("Z", "+00:00"))
        except Exception:
            pass
    if "modifiedTime" in file_meta:
        try:
            modified_time = datetime.fromisoformat(file_meta["modifiedTime"].replace("Z", "+00:00"))
        except Exception:
            pass

    return PromptSession(
        file_id=file_meta.get("id", ""),
        name=file_meta.get("name", "Untitled"),
        model=model,
        created_time=created_time,
        modified_time=modified_time,
        turns=turns
    )
~~~~~
~~~~~python.new
def parse_prompt_json(file_meta: Optional[Dict[str, Any]], raw_data: Dict[str, Any]) -> Optional[PromptSession]:
    """
    将 Google AI Studio 原始 JSON 转化为结构化的 PromptSession 对象。
    兼容 chunkedPrompt 结构以及标准 contents 结构。
    支持 file_meta 为空或仅部分元数据的场景（如完全离线从 SQLite 恢复）。
    """
    if not raw_data:
        return None

    file_meta = file_meta or {}
    model = raw_data.get("runSettings", {}).get("model", "unknown")
    turns = []

    # 1. 兼容旧版/常用 chunkedPrompt 结构
    if "chunkedPrompt" in raw_data:
        chunks = raw_data.get("chunkedPrompt", {}).get("chunks", [])
        for c in chunks:
            role = c.get("role", "user")
            text = c.get("text", "")
            if text:
                turns.append(ConversationTurn(role=role, text=text))

    # 2. 兼容新版 Gemini contents 结构
    elif "contents" in raw_data:
        contents = raw_data.get("contents", [])
        for item in contents:
            role = item.get("role", "user")
            parts = item.get("parts", [])
            text_blocks = [p.get("text", "") for p in parts if "text" in p]
            combined_text = "\n".join(text_blocks)
            if combined_text:
                turns.append(ConversationTurn(role=role, text=combined_text))

    if not turns:
        return None

    # 解析时间戳
    created_time = None
    modified_time = None
    
    raw_created = file_meta.get("createdTime") or raw_data.get("createTime") or raw_data.get("createdTime")
    if raw_created:
        try:
            created_time = datetime.fromisoformat(str(raw_created).replace("Z", "+00:00"))
        except Exception:
            pass

    raw_modified = file_meta.get("modifiedTime") or raw_data.get("modifiedTime")
    if raw_modified:
        try:
            modified_time = datetime.fromisoformat(str(raw_modified).replace("Z", "+00:00"))
        except Exception:
            pass

    # 解析会话名称
    name = file_meta.get("name") or raw_data.get("name") or raw_data.get("title") or "Untitled"

    return PromptSession(
        file_id=file_meta.get("id", ""),
        name=name,
        model=model,
        created_time=created_time,
        modified_time=modified_time,
        turns=turns
    )
~~~~~

#### Acts 2: 新增 `src/analyzer/sync.py` 封装增量同步 (fetch) 逻辑

独立管理网络与 SQLite 写入的职责，支持进度条输出与统计反馈。

~~~~~act
write_file
src/analyzer/sync.py
~~~~~
~~~~~python
"""
AI Studio 远程增量同步模块 (类 git fetch/pull 网络层)
"""
from typing import Optional, Tuple
from tqdm import tqdm
from .drive import DriveClient
from .cache import SQLiteCache
from .parser import is_valid_prompt_file


def fetch_remote_files(
    client: DriveClient,
    cache: SQLiteCache,
    limit: Optional[int] = 50,
    all_files: bool = False
) -> Tuple[int, int, int]:
    """
    增量拉取云盘最近修改的文件并写入 SQLite 缓存。
    
    :param client: Google Drive 客户端
    :param cache: 本地 SQLite 缓存
    :param limit: 拉取文件上限（若 all_files=True 则忽略）
    :param all_files: 是否全量扫描
    :return: (检索有效文件总数, 缓存命中跳过数, 实际拉取写入数)
    """
    max_results = None if (all_files or limit is None or limit <= 0) else limit

    folder_id = client.find_ai_studio_folder()
    if not folder_id:
        raise RuntimeError("未能找到 Google AI Studio 目录，请检查云盘权限。")

    print(f"📥 正在扫描云端文件元数据 (按最近修改降序, 目标拉取: {max_results if max_results else '全量'})...")
    files = client.list_files(folder_id=folder_id, max_results=max_results, order_by="modifiedTime desc")
    valid_files = [f for f in files if is_valid_prompt_file(f.get("name", ""))]

    download_count = 0
    cache_hit_count = 0

    with tqdm(valid_files, desc="云盘增量同步", unit="file") as pbar:
        for fmeta in pbar:
            fid = fmeta["id"]
            mtime = fmeta.get("modifiedTime", "")

            if cache.is_cached(fid, mtime):
                cache_hit_count += 1
            else:
                raw_data = client.download_json(fid)
                if raw_data:
                    # 保留云端元数据中的 name 与 createdTime 补充到原始数据中（若原 JSON 缺失）
                    if "name" not in raw_data and "name" in fmeta:
                        raw_data["name"] = fmeta["name"]
                    if "createdTime" not in raw_data and "createdTime" in fmeta:
                        raw_data["createdTime"] = fmeta["createdTime"]

                    cache.put(fid, mtime, raw_data)
                    download_count += 1

            pbar.set_postfix({
                "命中(跳过)": cache_hit_count,
                "云端拉取": download_count
            })

    return len(valid_files), cache_hit_count, download_count
~~~~~

#### Acts 3: 新增 `src/analyzer/loader.py` 封装离线加载器

纯本地从 SQLite 流式读取并转化为 `PromptSession` 对象。

~~~~~act
write_file
src/analyzer/loader.py
~~~~~
~~~~~python
"""
AI Studio 本地对象加载模块 (纯离线从 SQLite 加载数据)
"""
from typing import List, Optional
from tqdm import tqdm
from .cache import SQLiteCache
from .models import PromptSession
from .parser import parse_prompt_json


def load_cached_sessions(
    cache: SQLiteCache,
    limit: Optional[int] = None,
    show_progress: bool = True
) -> List[PromptSession]:
    """
    从本地 SQLite 数据库离线加载已解析的会话列表。

    :param cache: SQLiteCache 实例
    :param limit: 加载上限（None 或 <= 0 表示全量加载）
    :param show_progress: 是否显示加载进度条
    :return: List[PromptSession]
    """
    total_in_db = cache.count()
    if total_in_db == 0:
        return []

    target_count = total_in_db if (limit is None or limit <= 0) else min(limit, total_in_db)
    sessions: List[PromptSession] = []

    iterator = cache.iter_all_data()
    if show_progress:
        iterator = tqdm(iterator, total=target_count, desc="离线读取解析", unit="session")

    for file_id, mtime, raw_data in iterator:
        file_meta = {
            "id": file_id,
            "modifiedTime": mtime,
            "name": raw_data.get("name", "Untitled")
        }
        session = parse_prompt_json(file_meta, raw_data)
        if session:
            sessions.append(session)
            if limit and len(sessions) >= limit:
                break

    return sessions
~~~~~

#### Acts 4: 重构 `main.py` 为 Git 风格子命令入口

将统一入口重构为支持 `fetch`、`analyze`、`pull` 的 Git 风格命令行。

~~~~~act
write_file
main.py
~~~~~
~~~~~python
"""
AI Studio Analyzer - 统一调度入口 (Git 风格分布式架构)

常用命令:
  1. python main.py fetch [-n 50]       # 增量拉取云端最近 50 个修改的文件写入 SQLite
  2. python main.py analyze [--all]     # 纯离线全量分析本地 SQLite 缓存的所有会话
  3. python main.py pull [-n 50]        # 组合操作：快速拉取最新 50 个文件，随后全量分析本地数据
"""
import argparse
import sys
from src.analyzer.drive import DriveClient, PROXY_URL
from src.analyzer.cache import SQLiteCache
from src.analyzer.sync import fetch_remote_files
from src.analyzer.loader import load_cached_sessions
from src.analyzer.metrics import calculate_session_metrics
from src.analyzer.exporter import export_first_prompts_to_jsonl, export_prompts_summary_csv


def run_analyze(cache: SQLiteCache, limit: int = 0, export: bool = True):
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
    print("\n" + "=" * 30 + " 📊 核心指标概览 " + "=" * 30)
    print(f"  - 分析会话总数:       {metrics['total_sessions']}")
    print(f"  - 总对话轮次 (Turns): {metrics['total_turns']} (平均每会话: {metrics['avg_turns_per_session']} 轮)")
    print(f"  - 深度攻坚会话 (≥5轮): {metrics['deep_session_count']} 场 (占比 {metrics['deep_session_ratio']})")
    print(f"  - 用户提问总字数:     {metrics['total_user_chars']} 字符")
    print(f"  - 模型使用分布:       {metrics['model_distribution']}")
    print("=" * 76)

    # 导出报表产物
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
    run_analyze(cache, limit=args.limit, export=not args.no_export)


def cmd_pull(args):
    """先拉取增量，再全量分析 (类似 git pull)"""
    cmd_fetch(args)
    cache = SQLiteCache(cache_dir=".cache")
    run_analyze(cache, limit=0, export=not args.no_export)


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
    parser_analyze.add_argument("--no-export", action="store_true", help="仅打印控制台指标，不导出 CSV/JSONL 文件")

    # 3. pull 子命令
    parser_pull = subparsers.add_parser("pull", help="[组合] 增量拉取最近文件更新本地库，随后执行全量分析")
    parser_pull.add_argument("-n", "--limit", type=int, default=50, help="增量拉取数量限制 (默认: 50)")
    parser_pull.add_argument("--all", action="store_true", help="全量扫描云盘并分析")
    parser_pull.add_argument("--no-export", action="store_true", help="分析完成后不导出 CSV/JSONL 文件")

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
        # 无子命令时，默认行为相当于 pull -n 50，同时打印引导提示
        print("💡 未指定子命令，默认执行 `pull` 流程 (先增量同步最近 50 个文件，再全量分析本地数据)。")
        print("   可用子命令: `fetch` (仅同步), `analyze` (仅本地分析), `pull` (同步并分析)")
        print("   运行 `python main.py -h` 可查看完整指令选项。\n")
        class DefaultArgs:
            limit = 50
            all = False
            no_export = False
        cmd_pull(DefaultArgs())


if __name__ == "__main__":
    main()
~~~~~

### 下一步建议

1. **测试秒级离线全量分析**：
   运行 `python main.py analyze`，不需要开启网络和代理，验证本地 3000+ 条会话是否在几百毫秒内完成全量指标聚合与报表生成。
2. **测试轻量网络增量同步**：
   运行 `python main.py fetch -n 10`，验证是否仅轻量扫描云端最近 10 个修改项并快速落库退出。
3. **探索下一步演进**：
   - 在 `loader.py` 或 `cache.py` 中引入 SQLite FTS5 虚表，赋予系统离线搜索全文会话的能力（如 `python main.py search "DPDR"`）。
   - 将 Schema 中的新维度（思考块 `isThought`、Thinking Token 预算、分叉 Regenerate 次数）补充进 `calculate_session_metrics` 报告中。
