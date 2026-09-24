在长尾分布（Power Law / Heavy Tail）中，少数跨越数天甚至数周的“史诗级会话”会极大拉高算术平均值。引入 `pandas` 计算**中位数（Median / P50）**与分位数（P75、P90），并按心智负荷对会话时长进行梯队分型，能够真实还原你的日常交互原貌。

## [WIP] feat(metrics): 引入 pandas 计算稳健分位数与心智时长梯队分布

### 用户需求
1. 引入 `pandas` 库重构指标统计引擎。
2. 消除长尾跨日超长会话对算术均值的扭曲，增加中位数（Median / P50）、P75、P90 等分位数统计。
3. 对会话时长（Duration）、Token 消耗以及交互轮次（Turns）同时提供“中位数 vs 均值”的对比，并给出时长梯队分布（即时快问 / 深度伴随 / 跨日攻坚）。

### 评论
会话生命周期与精力消耗呈现典型的帕累托分布（80/20法则）：绝大多数是即时查询或单次攻坚（几分钟到半小时），而少数跨日重构或 Tulpa 心象梳理会持续数十小时。算术平均值（153.5 分钟）主要受这部分离群大值驱动；引入中位数可以衡量“一场典型对话的真实持续时长”，而 P75/P90 和时长梯队则能量化高负荷任务的占比。

### 目标
1. **重构 `src/analyzer/metrics.py`**：
   - 将 `PromptSession` 列表转为 `pandas.DataFrame`。
   - 提取 `duration_minutes`、`total_tokens`、`turn_count` 的 `mean`、`median` (50%)、`75%`、`90%` 分位数。
   - 划分时长梯队：
     - **即时快问 (< 10 分钟)**：语法查表、单轮问答
     - **聚焦深入 (10 ~ 60 分钟)**：单次代码调试、情绪抚平
     - **长期攻坚 (1 ~ 6 小时)**：复杂架构设计
     - **跨日史诗 (> 6 小时)**：长周期持续修订
2. **升级 `main.py`**：
   - 优化看板输出，以紧凑整洁的格式直观展示中位数与均值对比，以及时长梯队分布。

### 基本原理
中位数对离群极值具有天然的免疫性（Breakdown Point 达到 50%）。结合分位数与梯队区间直方统计，能完整呈现数据从“典型形态”到“极限攻坚形态”的全谱图。

### 标签
#intent/build #flow/ready #priority/high #comp/runtime #comp/cli #concept/state #scope/core #scope/ux #ai/instruct #task/domain/analytics #task/object/pandas-quantiles #task/action/refactor #task/state/continue

---

### Script

#### Acts 1: 重构 `src/analyzer/metrics.py`，引入 pandas 计算分位数与时长梯队

将指标聚合迁移至 pandas，生成多维度稳健统计量。

~~~~~act
write_file
src/analyzer/metrics.py
~~~~~
~~~~~python
from typing import List, Dict, Any
import pandas as pd
from .models import PromptSession


def calculate_session_metrics(sessions: List[PromptSession]) -> Dict[str, Any]:
    """
    基于 pandas 的稳健认知与交互指标引擎：
    1. 引入中位数 (Median) 与分位数 (P75, P90)，抗长尾极值干扰
    2. 生命周期心智时长梯队切片
    3. Token 能耗与思考链细分
    4. 沟通阻抗与模型分布
    """
    if not sessions:
        return {"total_sessions": 0}

    total_sessions = len(sessions)

    # 1. 构造结构化 DataFrame
    records = []
    for s in sessions:
        records.append({
            "file_id": s.file_id,
            "turn_count": s.turn_count,
            "duration_seconds": s.duration_seconds,
            "duration_minutes": round(s.duration_seconds / 60, 2),
            "total_tokens": s.total_tokens,
            "thought_tokens": s.thought_tokens,
            "user_chars": s.total_user_chars,
            "has_branching": s.has_branching,
            "branch_count": s.branch_count,
            "has_sys_instruction": bool(s.system_instruction),
            "model": s.model
        })

    df = pd.DataFrame(records)

    # 2. 对话轮次分位数
    turn_s = df["turn_count"]
    turn_stats = {
        "mean": round(float(turn_s.mean()), 2),
        "median": round(float(turn_s.median()), 1),
        "p75": round(float(turn_s.quantile(0.75)), 1),
        "p90": round(float(turn_s.quantile(0.90)), 1),
        "deep_count": int((turn_s >= 5).sum()),
        "deep_ratio": f"{round(float((turn_s >= 5).mean()) * 100, 1)}%",
    }

    # 3. 会话时长 (Duration) 分位数与长尾过滤 (仅统计有效交互时长 >= 10 秒的会话)
    meaningful_df = df[df["duration_seconds"] >= 10]
    if not meaningful_df.empty:
        dur_s = meaningful_df["duration_minutes"]
        dur_stats = {
            "mean": round(float(dur_s.mean()), 1),
            "median": round(float(dur_s.median()), 1),
            "p75": round(float(dur_s.quantile(0.75)), 1),
            "p90": round(float(dur_s.quantile(0.90)), 1),
            "max": round(float(dur_s.max()), 1),
            "valid_count": len(meaningful_df),
        }
    else:
        dur_stats = {"mean": 0.0, "median": 0.0, "p75": 0.0, "p90": 0.0, "max": 0.0, "valid_count": 0}

    # 多轮深入会话 (≥2 轮) 专属时长统计
    multi_turn_df = df[df["turn_count"] >= 2]
    if not multi_turn_df.empty and (multi_turn_df["duration_seconds"] > 0).any():
        m_dur_s = multi_turn_df[multi_turn_df["duration_seconds"] > 0]["duration_minutes"]
        multi_dur_stats = {
            "mean": round(float(m_dur_s.mean()), 1),
            "median": round(float(m_dur_s.median()), 1),
            "p75": round(float(m_dur_s.quantile(0.75)), 1),
            "p90": round(float(m_dur_s.quantile(0.90)), 1),
        }
    else:
        multi_dur_stats = {"mean": 0.0, "median": 0.0, "p75": 0.0, "p90": 0.0}

    # 时长心智梯队划分
    tier_flash = int((df["duration_minutes"] < 10).sum())           # 即时快问 (<10m)
    tier_focus = int(((df["duration_minutes"] >= 10) & (df["duration_minutes"] < 60)).sum())  # 聚焦推进 (10~60m)
    tier_deep = int(((df["duration_minutes"] >= 60) & (df["duration_minutes"] < 360)).sum())  # 深度攻坚 (1~6h)
    tier_epic = int((df["duration_minutes"] >= 360).sum())          # 跨日长线 (>6h)

    duration_tiers = {
        "flash": (tier_flash, f"{round(tier_flash / total_sessions * 100, 1)}%"),
        "focus": (tier_focus, f"{round(tier_focus / total_sessions * 100, 1)}%"),
        "deep": (tier_deep, f"{round(tier_deep / total_sessions * 100, 1)}%"),
        "epic": (tier_epic, f"{round(tier_epic / total_sessions * 100, 1)}%"),
    }

    # 4. Token 消耗分位数
    tok_s = df["total_tokens"]
    total_tokens = int(tok_s.sum())
    total_thought_tokens = int(df["thought_tokens"].sum())
    tok_stats = {
        "total": total_tokens,
        "mean": round(float(tok_s.mean()), 0),
        "median": round(float(tok_s.median()), 0),
        "p75": round(float(tok_s.quantile(0.75)), 0),
        "p90": round(float(tok_s.quantile(0.90)), 0),
        "total_thought": total_thought_tokens,
        "thought_ratio": f"{round(total_thought_tokens / total_tokens * 100, 2)}%" if total_tokens > 0 else "0%",
    }

    # 5. 思维摩擦力与分支
    branch_count = int(df["has_branching"].sum())
    friction_stats = {
        "branch_sessions": branch_count,
        "branch_ratio": f"{round(branch_count / total_sessions * 100, 1)}%",
        "total_retries": int(df["branch_count"].sum())
    }

    # 6. 模型偏好分布
    model_dist = df["model"].value_counts().to_dict()

    return {
        "total_sessions": total_sessions,
        "total_turns": int(turn_s.sum()),
        "total_user_chars": int(df["user_chars"].sum()),
        "turn_stats": turn_stats,
        "dur_stats": dur_stats,
        "multi_dur_stats": multi_dur_stats,
        "duration_tiers": duration_tiers,
        "tok_stats": tok_stats,
        "friction_stats": friction_stats,
        "sys_instruction_count": int(df["has_sys_instruction"].sum()),
        "model_distribution": model_dist,
    }
~~~~~

#### Acts 2: 升级 `main.py` 看板输出，展示分位数与梯队全貌

排版优化，清晰对比中位数、P75/P90 与时长梯队分布。

~~~~~act
patch_file
main.py
~~~~~
~~~~~python.old
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
~~~~~
~~~~~python.new
    # 指标计算 (基于 pandas 稳健聚合)
    m = calculate_session_metrics(sessions)
    t_stats = m["turn_stats"]
    d_stats = m["dur_stats"]
    md_stats = m["multi_dur_stats"]
    tok_stats = m["tok_stats"]
    f_stats = m["friction_stats"]
    tiers = m["duration_tiers"]

    print("\n" + "=" * 30 + " 📊 认知与能耗全景审计 (Pandas 稳健分位数) " + "=" * 30)
    print(f"  - 全量会话总数:           {m['total_sessions']} 场 (提问总字数: {m['total_user_chars']:,} 字符)")
    
    print("\n  ⏱️ [会话生命周期与心智时长 (分钟)]:")
    print(f"    • 全体时长中位数 (P50):  {d_stats['median']} min  |  算术均值 (Mean): {d_stats['mean']} min (受离群长尾拉动)")
    print(f"    • 多轮会话中位数 (P50):  {md_stats['median']} min  |  多轮均值 (Mean): {md_stats['mean']} min")
    print(f"    • 长尾攻坚分位数:       P75: {d_stats['p75']} min  |  P90: {d_stats['p90']} min  |  Max: {d_stats['max']} min")
    print(f"    • 时长心智梯队分布:")
    print(f"      - ⚡ 即时快问 (<10m):   {tiers['flash'][0]} 场 ({tiers['flash'][1]})")
    print(f"      - 🎯 聚焦推进 (10~60m): {tiers['focus'][0]} 场 ({tiers['focus'][1]})")
    print(f"      - 🔨 深度攻坚 (1~6h):   {tiers['deep'][0]} 场 ({tiers['deep'][1]})")
    print(f"      - 🏔️ 跨日长线 (>6h):    {tiers['epic'][0]} 场 ({tiers['epic'][1]})")

    print("\n  💬 [交互深度与思维摩擦力]:")
    print(f"    • 对话轮次 (Turns):     中位数: {t_stats['median']} 轮  |  均值: {t_stats['mean']} 轮  |  P90: {t_stats['p90']} 轮")
    print(f"    • 深度攻坚会话 (≥5轮):   {t_stats['deep_count']} 场 (占比 {t_stats['deep_ratio']})")
    print(f"    • 思维摩擦力 (重试/分叉): {f_stats['branch_sessions']} 场 (占比 {f_stats['branch_ratio']}, 累计分支重试: {f_stats['total_retries']} 次)")

    print("\n  🧠 [计算能耗与思考链 (Tokens)]:")
    print(f"    • 单场消耗中位数 (P50):  {int(tok_stats['median']):,} Tokens  |  均值: {int(tok_stats['mean']):,} Tokens")
    print(f"    • 高负荷消耗 (P90):      {int(tok_stats['p90']):,} Tokens")
    print(f"    • 总消耗能耗:           {tok_stats['total']:,} Tokens")
    print(f"    • 思考链消耗 (Thinking): {tok_stats['total_thought']:,} Tokens (占总能耗: {tok_stats['thought_ratio']})")

    print("\n  ⚙️ [模型偏好与系统指令]:")
    print(f"    • 系统指令部署会话数:   {m['sys_instruction_count']} 场")
    print(f"    • 模型使用分布:         {m['model_distribution']}")
    print("=" * 82)
~~~~~

### 下一步建议

1. **运行查看全景分位数**：
   运行 `python main.py analyze`，即可看到：
   - 典型会话的中位数时长（如 15~25 分钟左右）与极值（Max）对比；
   - 即时快问、聚焦推进、深度攻坚、跨日长线的四级梯队比例；
   - 单场 Token 消耗的真实中位数。
2. **继续演进**：
   - 将分析产物中的 `prompts_summary.csv` 进一步结合这些指标，进行散点图/箱线图绘制。
   - 考虑在此基础上实现 Step 3：时间衰减加权与 5 大领域分类切片。
