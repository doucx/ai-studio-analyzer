好的，这个方案以极轻量的指针引用规避了大型工程上下文（如 `PathInspectorResults`）对 Quipu 数据库的体积污染，同时利用 Web 端的富文本渲染能力实现了沉浸式的对话锚点定位。

我将生成一个完整的 Quipu 计划，创建 `sync_intents_to_quipu.py` 自动化回填脚本，并在前端组件 `SessionDetailPanel.tsx` 中接入 Chunk 锚点 ID 与平滑滚动高亮机制。

## [WIP] feat: 实施 AI Studio 与 Quipu 认知溯源轻量级回填及 Chunk 锚点定位

### 用户需求
1. 实现 `sync_intents_to_quipu.py` 脚本，将 AI Studio 对话的定位链接（指向前端特定 Chunk 锚点 `#turn-{index}`）及思考链摘要回填至 Quipu 的 `private_data` 表，避免直接复制巨型输入文本导致 Quipu 存储膨胀。
2. 前端 `SessionDetailPanel` 需支持根据 URL 的 `#turn-{index}` 锚点自动平滑滚动并短暂呼吸高亮对应轮次，实现一键从终端/文档穿透至 Web 工作台精准对齐定位。

### 评论
该方案完美贯彻了 Unix 哲学的“单一事实来源”与“引用代替冗余副本”原则。Quipu 数据库保持原本的轻量纯净（单节点仅增加约 300 字节的 Markdown 指针），而完整的上下文渲染、代码树折叠与语法高亮全部委托给前端展示，是投入产出比最高的落地路径。

### 目标
1. 新建 `sync_intents_to_quipu.py`，支持扫描目标 Quipu 仓库未绑定的 `plan` 节点、进行因果时序与特征对齐、生成标准化引用 Markdown 并批量写回 `private_data` 表。
2. 修改 `frontend/src/components/SessionDetailPanel.tsx`，为每一个交互轮次注入 `id="turn-{index + 1}"` 属性，并监听锚点自动执行 `scrollIntoView` 与高亮动效。

### 基本原理
1. **轻量回填设计**：回填内容由三部分组成：本地 Analyzer 锚点直达 URL（支持 `#turn-N`）、Google AI Studio 原生工程链接、以及精简的思考链（Thinking Process）引用。这样既提供了极佳的终端速览体验，又保留了点击直达完整交互现场的能力。
2. **前端 Hash 自动寻址**：在详情加载完成后，检测 `window.location.hash`。若匹配 `#turn-\d+`，延迟 150ms 触发元素居中滚动并注入临时脉冲环（`ring-2 ring-indigo-500`），保证用户视觉焦点即刻锁定目标交互块。

### 标签
#intent/build #flow/ready #priority/high #comp/cli #comp/ui #concept/history #concept/ui #scope/dx #scope/ux #ai/instruct #insight #task/domain/integration #task/object/quipu-ai-studio-alignment #task/action/implementation #task/state/begin #task/status/active

---

### Script

#### Acts 1: 创建认知溯源回填脚本 `sync_intents_to_quipu.py`

创建 `sync_intents_to_quipu.py` 工具，读取 Quipu 数据库中待对齐的 Plan 节点，并以轻量指针模式写回 `private_data`。

~~~~~act
write_file
sync_intents_to_quipu.py
~~~~~
~~~~~python
"""
Quipu ↔ AI Studio 认知溯源轻量级回填工具

功能:
1. 扫描目标 Quipu 仓库中未关联 ai_context 的 plan 节点。
2. 基于时钟因果窗口与多维模糊特征，精准匹配 AI Studio 对应的 Model Turn。
3. 提取轻量级指针链接（包含前端 Chunk 锚点）、原生链接与思考链摘要，写入 Quipu 的 private_data 表。
"""

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
    dry_run: bool = False,
):
    quipu_dir_abs = os.path.abspath(quipu_dir)
    db_path = os.path.join(quipu_dir_abs, ".quipu", "history.sqlite")
    if not os.path.exists(db_path):
        print(f"❌ 未找到 Quipu 数据库: {db_path}")
        sys.exit(1)

    cache = SQLiteCache(cache_dir=".cache")
    probe = AlignmentProbe(analyzer_cache=cache, window_hours=window_hours)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # 确保 private_data 表存在
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS private_data (
            node_hash TEXT(40) PRIMARY KEY,
            intent_md TEXT,
            ai_context TEXT,
            created_at REAL DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (node_hash) REFERENCES nodes(commit_hash) ON DELETE CASCADE
        );
    """)

    cursor.execute("""
        SELECT n.commit_hash, n.output_tree, n.timestamp, n.summary, n.plan_md_cache
        FROM nodes n
        LEFT JOIN private_data p ON n.commit_hash = p.node_hash
        WHERE n.node_type = 'plan' 
          AND n.plan_md_cache IS NOT NULL 
          AND length(n.plan_md_cache) > 20
          AND (p.ai_context IS NULL OR p.ai_context = '')
        ORDER BY n.timestamp DESC
    """)
    nodes_to_sync = [dict(r) for r in cursor.fetchall()]

    print(f"🔍 检索到 {len(nodes_to_sync)} 个尚未关联 AI 认知的 Quipu 节点。")
    if not nodes_to_sync:
        print("✅ 所有 Plan 节点均已对齐，无需处理。")
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

        if not dry_run:
            cursor.execute(
                """
                INSERT OR REPLACE INTO private_data (node_hash, intent_md, ai_context)
                VALUES (?, COALESCE((SELECT intent_md FROM private_data WHERE node_hash = ?), ''), ?)
                """,
                (commit_hash, commit_hash, ai_context_md),
            )

        success_count += 1
        prefix = "[DRY-RUN] " if dry_run else ""
        print(
            f"  ✅ {prefix}成功对齐: [{commit_hash[:8]}] -> {best['session_name']} (Turn #{turn_idx}, 得分: {best['total_score']:.3f})"
        )

    if not dry_run:
        conn.commit()
        print(f"\n🎉 写入完成: 成功回填 {success_count} 个节点 (跳过/未达阈值: {skipped_count})。")
    else:
        print(f"\n💡 [DRY-RUN] 预演完成: 可对齐 {success_count} 个节点 (跳过: {skipped_count})。")

    conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Quipu ↔ AI Studio 认知溯源轻量级回填工具"
    )
    parser.add_argument(
        "--quipu-dir",
        required=True,
        help="目标 Quipu 仓库的工作区根目录路径",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=5173,
        help="AI Studio Analyzer 前端服务端口 (默认: 5173)",
    )
    parser.add_argument(
        "--min-score",
        type=float,
        default=0.45,
        help="判定的最低置信度得分 (默认: 0.45)",
    )
    parser.add_argument(
        "--window-hours",
        type=float,
        default=24.0,
        help="时间因果窗口大小/小时 (默认: 24.0)",
    )
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
        dry_run=args.dry_run,
    )
~~~~~

#### Acts 2: 为前端 `SessionDetailPanel` 增加 Chunk 锚点与平滑定位动效

在 `frontend/src/components/SessionDetailPanel.tsx` 中为每轮消息注入 `id={`turn-${index + 1}`}`，并在初次挂载后根据当前 URL Hash 实现自动定位与聚焦动效。

~~~~~act
patch_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~typescript.old
  if (isThought) {
    return (
      <div className="rounded-lg border border-emerald-900/30 bg-emerald-950/15 overflow-hidden">
        <div className="px-3.5 py-2 flex items-center justify-between bg-emerald-950/30 border-b border-emerald-900/20 text-xs text-emerald-400 font-mono">
~~~~~
~~~~~typescript.new
  if (isThought) {
    return (
      <div
        id={`turn-${index + 1}`}
        className="rounded-lg border border-emerald-900/30 bg-emerald-950/15 overflow-hidden scroll-mt-4"
      >
        <div className="px-3.5 py-2 flex items-center justify-between bg-emerald-950/30 border-b border-emerald-900/20 text-xs text-emerald-400 font-mono">
~~~~~

~~~~~act
patch_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~typescript.old
  return (
    <div
      className={`rounded-lg border transition shadow-sm ${
        isUser
          ? 'bg-zinc-900/90 border-indigo-900/40 pl-1 border-l-4 border-l-indigo-500'
          : 'bg-zinc-900/50 border-zinc-800'
      }`}
    >
      {/* 消息 Chunk 头部元数据栏 */}
~~~~~
~~~~~typescript.new
  return (
    <div
      id={`turn-${index + 1}`}
      className={`rounded-lg border transition shadow-sm scroll-mt-4 ${
        isUser
          ? 'bg-zinc-900/90 border-indigo-900/40 pl-1 border-l-4 border-l-indigo-500'
          : 'bg-zinc-900/50 border-zinc-800'
      }`}
    >
      {/* 消息 Chunk 头部元数据栏 */}
~~~~~

~~~~~act
patch_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~typescript.old
  useEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }
    if (syncVersion > 0) {
      const controller = new AbortController();
      fetchSessionDetail(true, controller.signal);
      return () => {
        controller.abort();
      };
    }
  }, [syncVersion, fetchSessionDetail]);

  return (
    <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg flex flex-col h-full min-h-[calc(100vh-140px)]">
~~~~~
~~~~~typescript.new
  useEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }
    if (syncVersion > 0) {
      const controller = new AbortController();
      fetchSessionDetail(true, controller.signal);
      return () => {
        controller.abort();
      };
    }
  }, [syncVersion, fetchSessionDetail]);

  // 3. 处理 URL 锚点定位与平滑滚动高亮聚焦 (#turn-X)
  useEffect(() => {
    if (!loading && detail?.turns && detail.turns.length > 0) {
      const hash = window.location.hash;
      if (hash && hash.startsWith('#turn-')) {
        const timer = setTimeout(() => {
          const targetEl = document.querySelector(hash);
          if (targetEl) {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetEl.classList.add(
              'ring-2',
              'ring-indigo-500',
              'transition-all',
              'duration-500'
            );
            setTimeout(() => {
              targetEl.classList.remove('ring-2', 'ring-indigo-500');
            }, 2500);
          }
        }, 150);
        return () => clearTimeout(timer);
      }
    }
  }, [loading, detail]);

  return (
    <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg flex flex-col h-full min-h-[calc(100vh-140px)]">
~~~~~

### 下一步建议
1. **执行验证**：
   - 运行 `python sync_intents_to_quipu.py --quipu-dir . --dry-run` 先行演练，确认准备写入的记录无误。
   - 去掉 `--dry-run` 标志执行真实写入：`python sync_intents_to_quipu.py --quipu-dir .`。
2. **终端与导出联动核验**：
   - 在 Quipu 仓库中执行 `quipu show HEAD` 或进入 `quipu ui` 按 `v` 打开详情，核验右侧 `== 🧠 开发者意图 ===========` 是否呈现出整洁的本地 Analyzer 与 Google 原生跳转链接及思考链摘要。
   - 点击生成的链接（如 `http://localhost:5173/sessions/...#turn-N`），确认浏览器自动平滑滑动至对应的交互轮次并触发高亮脉冲。
