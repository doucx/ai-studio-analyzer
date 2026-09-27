好的，这两个需求非常关键且紧密关联：

1. **图表风格统一**：将“累计推理 API 消耗”从虚线改换为与其他维度统一的平滑曲线面积图（配置 Amber 琥珀色调、贝塞尔平滑度 0.3 与半透明渐变底色）。
2. **纳入系统提示词（System Instruction）算力**：
   - 在大模型无状态调用中，如果会话配置了系统提示词，**每一次向模型发送请求时，系统提示词都会作为不可或缺的 Prefix 完整发送一次**。
   - 我们将自动提取/估算系统指令的 Token，将其静态计入总资产规模，并在每次模型响应的 Input Tokens 中完整计入，精准反映带大设定/长协议会话的真实 API 算力放大效应。

## [WIP] feat: 纳入系统提示词算力消耗并将累计 API 消耗图表统一样式

### 用户需求
1. 将时序趋势图中“累计推理 API 消耗”从虚线改为平滑折线面积图，使其视觉形态与其他折线完全统一。
2. 在算力消耗模型中补全系统提示词（System Instruction）的 Token 计算：无论是静态上下文资产规模，还是每一次调用 API 时重复发送的累计算力，都必须完整考虑系统指令。

### 评论
系统提示词通常包含角色设定、工程规范或长上下文协议，很多开发场景下系统提示词往往长达数百甚至数千 Token。由于 Gemini API 在多轮交互中不会在服务端持久保存 System Prompt，每次发起新轮次均需连同 System Instruction 全量上传。将其纳入算力模型后，多轮交互的实际消耗计算将达到与 Google 计费账单完全一致的物理精度。

### 目标
1. **模型与解析层**：
   - 在 `parser.py` 中解析 `systemInstruction` 的原生 `tokenCount` 或多语言分词估算值。
   - 在 `PromptSession` 中增加 `system_instruction_tokens` 字段，并在 `total_tokens` 和 `cumulative_api_tokens` 中予以全量计入。
2. **图表视觉层**：
   - 在 `TokenTrendChart.tsx` 中移除“累计推理 API 消耗”的 `borderDash` 虚线，增加 `tension: 0.3`、`fill: true`、半透明背景与高亮悬浮点，与主折线视觉规范严格对齐。

### 基本原理
1. **API 真实 Payload 模拟**：
   在单次 API 请求中，输入端 Payload = $\text{System Instruction Tokens} + \text{历史上下文前缀 Tokens}$。若会话推进了 $K$ 轮模型回复，系统提示词将被完整计费 $K$ 次。
2. **Chart.js 统一分层渲染**：
   使用 Amber 琥珀色调作为算力警示线，开启平滑填充以直观展现“累积消耗”高出“静态规模”的剪刀差面积。

### 标签
#intent/build #flow/ready #priority/high #comp/engine #comp/ui #concept/state #scope/core #scope/ux #ai/instruct #task/domain/metrics #task/object/system-instruction-and-chart-style #task/action/implementation #task/state/continue #task/status/active

---

### Script

#### Acts 1: 在 `parser.py` 中提取系统提示词 Token

解析 `systemInstruction` 对象中的 `tokenCount`，若无显式数值则基于内容长度自动换算。

~~~~~act
patch_file
src/analyzer/parser.py
~~~~~
~~~~~python.old
    model = raw_data.get("runSettings", {}).get("model", "unknown")
    sys_instruction = raw_data.get("systemInstruction", {}).get("text", "")
    turns = []
~~~~~
~~~~~python.new
    model = raw_data.get("runSettings", {}).get("model", "unknown")
    sys_inst_obj = raw_data.get("systemInstruction", {})
    sys_instruction = ""
    sys_inst_tokens = 0

    if isinstance(sys_inst_obj, dict):
        sys_instruction = sys_inst_obj.get("text", "")
        if "tokenCount" in sys_inst_obj:
            sys_inst_tokens = int(sys_inst_obj.get("tokenCount") or 0)
        elif not sys_instruction and "parts" in sys_inst_obj:
            parts = sys_inst_obj.get("parts", [])
            sys_instruction = "\n".join(p.get("text", "") for p in parts if "text" in p)
    elif isinstance(sys_inst_obj, str):
        sys_instruction = sys_inst_obj

    # 若无显式标注的 tokenCount，按多语言通用分词基线保守估算 (约 1 token / 3.0 字符)
    if sys_instruction and sys_inst_tokens <= 0:
        sys_inst_tokens = max(1, int(len(sys_instruction) / 3.0))

    turns = []
~~~~~

~~~~~act
patch_file
src/analyzer/parser.py
~~~~~
~~~~~python.old
    return PromptSession(
        file_id=file_meta.get("id", ""),
        name=name,
        model=model,
        created_time=created_time,
        modified_time=modified_time,
        turns=turns,
        system_instruction=sys_instruction,
    )
~~~~~
~~~~~python.new
    return PromptSession(
        file_id=file_meta.get("id", ""),
        name=name,
        model=model,
        created_time=created_time,
        modified_time=modified_time,
        turns=turns,
        system_instruction=sys_instruction,
        system_instruction_tokens=sys_inst_tokens,
    )
~~~~~

#### Acts 2: 在 `models.py` 中将系统提示词完整计入静态与累计算力

在 `PromptSession` 中加入 `system_instruction_tokens`，并在每次 API 请求边界时加上系统提示词输入。

~~~~~act
patch_file
src/analyzer/models.py
~~~~~
~~~~~python.old
    turns: List[ConversationTurn]  # 会话的所有轮次
    system_instruction: str = ""  # 系统指令 / 前置协议

    @property
    def start_time(self) -> Optional[datetime]:
~~~~~
~~~~~python.new
    turns: List[ConversationTurn]  # 会话的所有轮次
    system_instruction: str = ""  # 系统指令 / 前置协议
    system_instruction_tokens: int = 0  # 系统指令自身占用的 Token 数量

    @property
    def start_time(self) -> Optional[datetime]:
~~~~~

~~~~~act
patch_file
src/analyzer/models.py
~~~~~
~~~~~python.old
    @property
    def total_tokens(self) -> int:
        """该会话消耗的 Token 总量 (静态上下文资产规模)"""
        return sum(t.token_count for t in self.turns)

    @property
    def cumulative_api_tokens(self) -> int:
        """
        推导实际与 API 交互时的累计算力/计费 Token 消耗量 (Cumulative API Usage):
        每一次模型回复，都会将此前沉淀的历史上下文全量作为输入发送给 API。
        对于单轮会话，累计消耗 == 上下文净规模 (total_tokens)；
        对于多轮会话，累计消耗会随上下文滚动呈二次方累积增长。
        """
        if not self.turns:
            return 0

        total_api_tokens = 0
        prefix_tokens = 0
        in_model_response = False

        for t in self.turns:
            if t.role == "model":
                if not in_model_response:
                    # 刚进入模型回复阶段，历史的所有前置上下文作为本次调用的 Prompt 输入
                    total_api_tokens += prefix_tokens
                    in_model_response = True
                # 输出生成的 tokens
                total_api_tokens += t.token_count
                prefix_tokens += t.token_count
            else:
                # user 或 system 等输入
                in_model_response = False
                prefix_tokens += t.token_count

        return max(total_api_tokens, self.total_tokens)
~~~~~
~~~~~python.new
    @property
    def total_tokens(self) -> int:
        """该会话消耗的 Token 总量 (静态上下文资产规模，包含系统指令)"""
        return sum(t.token_count for t in self.turns) + self.system_instruction_tokens

    @property
    def cumulative_api_tokens(self) -> int:
        """
        推导实际与 API 交互时的累计算力/计费 Token 消耗量 (Cumulative API Usage):
        每一次模型回复，都会将 [系统提示词 + 此前沉淀的历史上下文] 全量作为输入发送给 API。
        对于单轮会话，累计消耗 == 上下文净规模 (total_tokens)；
        对于多轮会话，累计消耗随多轮请求呈二次方累积增长。
        """
        if not self.turns:
            return self.system_instruction_tokens

        total_api_tokens = 0
        prefix_tokens = 0
        in_model_response = False

        for t in self.turns:
            if t.role == "model":
                if not in_model_response:
                    # 刚进入模型回复阶段，[系统指令 + 所有前置上下文] 作为本次调用的 Prompt 输入
                    total_api_tokens += (self.system_instruction_tokens + prefix_tokens)
                    in_model_response = True
                # 输出生成的 tokens
                total_api_tokens += t.token_count
                prefix_tokens += t.token_count
            else:
                # user 或 system 等输入
                in_model_response = False
                prefix_tokens += t.token_count

        return max(total_api_tokens, self.total_tokens)
~~~~~

#### Acts 3: 在 `TokenTrendChart.tsx` 中将累计 API 消耗改为平滑折线图

移除虚线设定，使用与其它曲线一致的贝塞尔曲线、半透明琥珀色底衬和点悬浮效果。

~~~~~act
patch_file
frontend/src/components/charts/TokenTrendChart.tsx
~~~~~
~~~~~typescript.old
            {
              label: '累计推理 API 消耗',
              data: cumulativeTokens,
              borderColor: '#f59e0b', // amber-500
              backgroundColor: 'transparent',
              borderDash: [4, 4],
              borderWidth: 1.8,
              pointRadius: 0,
              pointHoverRadius: 4,
            },
            {
              label: '思考链 (Thinking) 规模',
              data: thoughtTokens,
              borderColor: CHART_PALETTE.emerald,
              backgroundColor: CHART_PALETTE.emeraldBg,
              fill: false,
              tension: 0.3,
              borderWidth: 1.5,
              pointRadius: labels.length > 40 ? 0 : 2,
              pointHoverRadius: 4,
            },
~~~~~
~~~~~typescript.new
            {
              label: '累计推理 API 消耗',
              data: cumulativeTokens,
              borderColor: '#fbbf24', // amber-400
              backgroundColor: 'rgba(251, 191, 36, 0.08)',
              fill: true,
              tension: 0.3,
              borderWidth: 2,
              pointRadius: labels.length > 40 ? 0 : 2.5,
              pointHoverRadius: 5,
            },
            {
              label: '思考链 (Thinking) 规模',
              data: thoughtTokens,
              borderColor: CHART_PALETTE.emerald,
              backgroundColor: CHART_PALETTE.emeraldBg,
              fill: true,
              tension: 0.3,
              borderWidth: 1.8,
              pointRadius: labels.length > 40 ? 0 : 2,
              pointHoverRadius: 4,
            },
~~~~~

### 下一步建议
1. **执行重整索引**：运行 `python reindex_cli.py` 重新跑一遍本地缓存数据库，使系统提示词的 Token 与新版累计 API 消耗全面刷新入库。
2. **刷新前端看板**：进入前端查看时序趋势图，观察带系统提示词加权后的“累计推理 API 消耗”平滑折线效果与膨胀倍率。
