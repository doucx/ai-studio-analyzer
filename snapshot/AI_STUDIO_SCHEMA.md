# Google AI Studio Prompt 会话数据结构规范 (Schema Specification)

本文档基于对 Google AI Studio 自动持久化至 Google Drive 的会话 JSON 文件的逆向工程分析。

---

## 1. 顶层根结构 (Root Structure)

在 99.8% 的正常会话文件中，根对象包含以下 3 个标准键：

| 字段名 | 类型 | 必填 | 说明 |
| :--- | :--- | :---: | :--- |
| `chunkedPrompt` | `object` | 是 | 会话正文核心载荷，按时序存储多轮交互与输入块 |
| `runSettings` | `object` | 是 | 模型调用超参数与功能开关配置 |
| `systemInstruction` | `object` | 是 | 系统级前置提示词（角色设定/协议定义） |
| `applets` | `array` | 否 | **边缘异常项** (占比 0.2%)，通常为工具插件配置或损坏记录，解析时建议直接忽略跳过 |

---

## 2. 核心载荷：`chunkedPrompt`

会话内容的主体，包含所有的历史交互序列与待触发输入。

```json
{
  "chunkedPrompt": {
    "chunks": [ /* List of Chunk Object */ ],
    "pendingInputs": [ /* List of Pending Inputs */ ]
  }
}
```

- **`pendingInputs`** (`list`): 当前在网页前端已输入但尚未点击发送/尚未完成生成的草稿项。
- **`chunks`** (`list`): 已提交并固化的对话历史块，**是分析“用户说了什么”和“模型回复了什么”的核心来源**。

---

## 3. 对话单元块：`chunks` 结构透析

每个 `chunk` 代表一次输入或输出片段。所有 chunk 都具备以下**元数据共有字段**：

| 基础字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `role` | `string` | 说话者角色：`"user"` 或 `"model"` |
| `createTime` | `string` (ISO 8601) | 该 chunk 创建的时间戳 (UTC) |
| `tokenCount` | `int` | 该块消耗的 Token 计数（精确定量精力/计算消耗的核心指标） |

### 3.1 载荷形态分类 (Payload Types)

根据分析，`chunks` 呈现出高度的多模态与多分支特征，主要分为以下几种载荷模式：

#### ① 纯文本交互块 (Text Payload - 最常见)
```json
{
  "role": "user",
  "text": "抑郁症会影响到小脑的功能吗",
  "tokenCount": 11,
  "createTime": "2026-08-19T10:57:26.680Z"
}
```

#### ② 模型推理思考块 (Gemini 2.0 Thinking Payload)
当使用具备思考能力的模型（如 `gemini-2.0-flash-thinking`）时出现：
```json
{
  "role": "model",
  "isThought": true,
  "thinkingBudget": 2048,
  "text": "用户正在询问荣格心理学中的核心概念...",
  "parts": [{ "text": "用户正在询问..." }],
  "tokenCount": 240,
  "createTime": "2026-09-21T14:48:05.120Z"
}
```
> **解析提示**：在分析“AI 实际给出的答案”时，应过滤掉 `isThought: true` 的块，只保留常规回复。

#### ③ 模型完成回复块 (Model Response Payload)
```json
{
  "role": "model",
  "text": "在荣格的《红书》中，“深度精神”与“时代精神”构成了一对核心对立...",
  "parts": [{ "text": "..." }],
  "finishReason": "STOP",
  "citations": [],
  "grounding": {},
  "tokenCount": 856,
  "createTime": "2026-09-21T14:48:15.800Z"
}
```

#### ④ 云盘引用大文档块 (Drive Document Payload)
当在 AI Studio 中点击 **"Insert from Drive"** 挂载代码库、长论文（常见消耗 50,000 ~ 180,000 tokens）时生成：
```json
{
  "role": "user",
  "driveDocument": {
    "id": "1CMkU3CgA8y1h61Vwgz7jnoMWjlSwvjkv"
  },
  "tokenCount": 118001,
  "createTime": "2026-08-23T15:15:27.580Z"
}
```
> **解析提示**：该块通常**不包含文本内联**，需通过 Drive API 获取对应 ID 文件的内容，或作为大上下文标记处理。

#### ⑤ 内联文件附件块 (Inline File Payload - Base64 编码)
当直接从本地拖拽上传 XML/TXT/PDF 等文本文件时生成：
```json
{
  "role": "user",
  "inlineFile": {
    "mimeType": "text/plain",
    "data": "PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4K..."
  },
  "tokenCount": 47199,
  "createTime": "2026-09-20T13:20:37.617Z"
}
```
> **解析提示**：可通过标准 Base64 解码提取原始内容：
> `base64.b64decode(chunk["inlineFile"]["data"]).decode("utf-8", errors="ignore")`

#### ⑥ 多分支分支树结构 (Branching Payloads)
当在 UI 上点击了多次“重新生成”（Regenerate）或编辑历史消息时，形成的分叉结构：
- **`branchParent`** (`string`/`int`): 指向父节点的索引/标识。
- **`branchChildren`** (`list`): 该节点派生出的子分支列表。
- **`isEdited`** (`bool`): 标记该轮提问是否被用户手动修改过。

---

## 4. 模型超参数：`runSettings`

记录会话关联的模型与推理配置，用于统计模型偏好与实验配置：

| 字段名 | 类型 | 示例值 | 业务含义 |
| :--- | :--- | :--- | :--- |
| `model` | `string` | `"models/gemini-1.5-pro"` | 调用的模型版本 |
| `temperature` | `float` | `0.7` | 采样温度 |
| `topP` | `float` | `0.95` | 核采样截断阈值 |
| `topK` | `int` | `40` | 候选词采样截断 |
| `maxOutputTokens`| `int` | `8192` | 最大生成长度 |
| `thinkingBudget` | `int` | `4096` | 思考模式的 Token 预算（Thinking 专属） |
| `thinkingLevel`  | `string` | `"THINKING_LEVEL_UNSPECIFIED"` | 思考等级模式 |
| `googleSearch`   | `object` | `{}` | 是否开启 Grounding (联网实时检索) |
| `enableCodeExecution` | `bool` | `true` | 是否启用沙盒代码执行 |
| `environmentMode`| `string` | `"PRODUCTION"` | 环境运行模式 |

---

## 5. 系统提示词：`systemInstruction`

```json
{
  "systemInstruction": {
    "text": "你是一个深度心理分析与象征体系解构专家..."
  }
}
```
- 若未配置角色指令，则为空字典 `{}`。
- 若已配置，内容存储在 `text` 字段中（经常包含数千甚至数万字符的 SOP/协议定义，如分析结果中命中的 29,711 字符的大型 Prompt 框架）。

---

## 6. 解析器（Parser）提取规范与伪代码

根据此 Schema，提取“用户最常问的问题”和“时间精力消耗”时的标准清洗规则如下：

```python
import base64

def extract_prompts_and_costs(raw_json: dict):
    # 1. 过滤非标准/损坏文件
    if "chunkedPrompt" not in raw_json:
        return None

    model = raw_json.get("runSettings", {}).get("model", "unknown")
    sys_instruction = raw_json.get("systemInstruction", {}).get("text", "")
    
    user_prompts = []
    total_tokens = 0
    
    for chunk in raw_json.get("chunkedPrompt", {}).get("chunks", []):
        role = chunk.get("role")
        total_tokens += chunk.get("tokenCount", 0)
        
        # 仅关注用户提问
        if role == "user":
            # 场景 A: 纯文本输入
            if "text" in chunk:
                user_prompts.append(chunk["text"].strip())
            
            # 场景 B: Base64 附件文件
            elif "inlineFile" in chunk:
                file_info = chunk["inlineFile"]
                if "text" in file_info.get("mimeType", ""):
                    try:
                        decoded_text = base64.b64decode(file_info["data"]).decode("utf-8", errors="ignore")
                        user_prompts.append(decoded_text[:200] + "... [附件文本]")
                    except Exception:
                        user_prompts.append("[无法解码的附件]")
                        
            # 场景 C: 云盘文件引用
            elif "driveDocument" in chunk:
                doc_id = chunk["driveDocument"].get("id")
                user_prompts.append(f"[挂载云盘文档 ID: {doc_id}]")

    return {
        "model": model,
        "system_instruction_len": len(sys_instruction),
        "total_tokens": total_tokens,
        "first_prompt": user_prompts[0] if user_prompts else "",
        "all_user_prompts": user_prompts
    }
```
