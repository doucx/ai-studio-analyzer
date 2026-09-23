我为你设计了一套清晰、模块化且支持后续增量缓存与 LLM 深度分析的项目架构，并将为你创建模块骨架文件与详细的项目说明 `README.md`。

## [WIP] feat: 初始化项目模块架构、骨架文件与项目说明文档

### 用户需求

根据 Google AI Studio 交互分析的全流程（Drive 拉取 -> 对话与提问提取 -> 时间/精力消耗量化 -> SOP 提炼与增量缓存），建立一套结构清晰、职责分离的工程目录骨架，并提供核心模块的占位文件及完整的项目 `README.md`。

### 评论

这是一个典型的“数据抽取（ETL）+ 元工作流挖掘”架构。将数据获取（Drive/Network）、数据清洗（Parser/Models）、状态持久化（Cache/Storage）和分析洞察（Metrics/Exporter）解耦，不仅能彻底隔离先前遇到的网络/驱动层变化，还能为后续的增量分析、词云可视化与 LLM 批量提炼 SOP 打下坚实基础。

### 目标

1. 规划清晰的 `src/analyzer/` 包结构，涵盖 Drive 客户端、数据模型、解析器、增量缓存器、指标计算器与导出器。
2. 创建各模块的空壳骨架文件（包含类型定义与核心接口签名）。
3. 编写内容翔实、包含系统架构图与数据流转说明的 `README.md`。
4. 将 `main.py` 升级为面向模块化调用的统一运行入口。

### 基本原理

1. **分层设计（Layered Design）**：
   - `drive.py`：负责云端通信与鉴权（已迁移至 requests 引擎）。
   - `models.py`：定义强类型的对话与提问实体（如 `PromptItem`, `ConversationTurn`），确保下游清洗逻辑稳定。
   - `parser.py`：抹平 AI Studio 结构演变（`chunkedPrompt`、`contents` 等），专门提炼用户发言。
   - `cache.py`：通过比较云端 `modifiedTime` 实现秒级增量拉取与本地缓存。
   - `metrics.py` & `exporter.py`：计算精力深度指标并输出适合喂给 LLM 的聚类清洗集。
2. **渐进式实施**：先落地骨架与数据接口规范，保证后续可以按模块单点切入。

### 标签

#intent/architect #flow/ready #priority/high #comp/build #concept/history #scope/core #ai/brainstorm #task/domain/architecture #task/object/project-scaffolding #task/action/design #task/state/begin #task/status/active

---

### Script

#### Acts 1: 创建 `src/analyzer` 核心模块占位骨架

~~~~~act
write_file
src/analyzer/__init__.py
~~~~~
~~~~~python
"""AI Studio Analyzer - 核心分析库"""

__version__ = "0.1.0"
~~~~~

~~~~~act
write_file
src/analyzer/models.py
~~~~~
~~~~~python
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional, Dict, Any


@dataclass
class ConversationTurn:
    """单轮对话数据"""
    role: str                       # 'user' | 'model' | 'system'
    text: str                       # 文本内容
    timestamp: Optional[datetime] = None
    extra_metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PromptSession:
    """单个 AI Studio 对话会话"""
    file_id: str                    # Google Drive 文件 ID
    name: str                       # 对话/文件名称
    model: str                      # 绑定的模型标识 (如 gemini-1.5-pro)
    created_time: Optional[datetime]# 云端创建时间
    modified_time: Optional[datetime]# 最后修改时间
    turns: List[ConversationTurn]   # 会话的所有轮次
    
    @property
    def user_prompts(self) -> List[str]:
        """提取所有属于用户的发言"""
        return [turn.text for turn in self.turns if turn.role == 'user']

    @property
    def turn_count(self) -> int:
        """对话轮次总数"""
        return len(self.turns)

    @property
    def total_user_chars(self) -> int:
        """用户提问的总字符量（精力消耗代理指标之一）"""
        return sum(len(text) for text in self.user_prompts)
~~~~~

~~~~~act
write_file
src/analyzer/drive.py
~~~~~
~~~~~python
import os
import requests
from typing import Optional, List, Dict, Any
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow

PROXY_PORT = 7890
PROXY_URL = f"http://127.0.0.1:{PROXY_PORT}"
SCOPES = ['https://www.googleapis.com/auth/drive.readonly']


class DriveClient:
    """Google Drive API 客户端（基于 requests，安全且支持代理）"""

    def __init__(self, proxy_url: str = PROXY_URL, token_path: str = 'token.json', creds_path: str = 'credentials.json'):
        self.proxy_url = proxy_url
        self.token_path = token_path
        self.creds_path = creds_path
        self.session = requests.Session()
        if self.proxy_url:
            self.session.proxies = {'http': self.proxy_url, 'https': self.proxy_url}
        self.creds = self._authenticate()

    def _authenticate(self) -> Credentials:
        creds = None
        if os.path.exists(self.token_path):
            creds = Credentials.from_authorized_user_file(self.token_path, SCOPES)
        if not creds or not creds.valid:
            transport = Request(session=self.session)
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(transport)
            else:
                flow = InstalledAppFlow.from_client_secrets_file(self.creds_path, SCOPES)
                creds = flow.run_local_server(port=0)
            with open(self.token_path, 'w') as token:
                token.write(creds.to_json())
        return creds

    def _request(self, method: str, url: str, **kwargs) -> requests.Response:
        headers = kwargs.pop('headers', {})
        if self.creds.expired and self.creds.refresh_token:
            self.creds.refresh(Request(session=self.session))
        headers['Authorization'] = f"Bearer {self.creds.token}"
        kwargs['headers'] = headers
        kwargs.setdefault('timeout', 15)
        resp = self.session.request(method, url, **kwargs)
        resp.raise_for_status()
        return resp

    def find_ai_studio_folder(self) -> Optional[str]:
        """查找 'Google AI Studio' 或 'MakerSuite' 文件夹 ID"""
        query = "mimeType = 'application/vnd.google-apps.folder' and (name = 'Google AI Studio' or name = 'MakerSuite') and trashed = false"
        url = "https://www.googleapis.com/drive/v3/files"
        resp = self._request("GET", url, params={"q": query, "fields": "files(id, name)"})
        folders = resp.json().get('files', [])
        return folders[0]['id'] if folders else None

    def list_files(self, folder_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """分页拉取文件夹内所有文件元数据"""
        files = []
        page_token = None
        url = "https://www.googleapis.com/drive/v3/files"
        query = f"'{folder_id}' in parents and trashed = false" if folder_id else "trashed = false and mimeType = 'application/json'"

        while True:
            params = {
                "q": query,
                "pageSize": 100,
                "fields": "nextPageToken, files(id, name, createdTime, modifiedTime)",
            }
            if page_token:
                params["pageToken"] = page_token
            data = self._request("GET", url, params=params).json()
            files.extend(data.get('files', []))
            page_token = data.get('nextPageToken')
            if not page_token:
                break
        return files

    def download_json(self, file_id: str) -> Optional[Dict[str, Any]]:
        """从云端下载文件并反序列化为 JSON 字典"""
        url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"
        try:
            return self._request("GET", url).json()
        except Exception:
            return None
~~~~~

~~~~~act
write_file
src/analyzer/parser.py
~~~~~
~~~~~python
from typing import Optional, Dict, Any
from datetime import datetime
from .models import PromptSession, ConversationTurn


def is_valid_prompt_file(name: str) -> bool:
    """过滤粘贴板缓存与非文本文件"""
    if name.startswith("Paste "):
        return False
    lower = name.lower()
    if lower.endswith(('.png', '.jpg', '.jpeg', '.webp', '.gif')):
        return False
    return True


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

~~~~~act
write_file
src/analyzer/cache.py
~~~~~
~~~~~python
import json
import os
from typing import Dict, Any, Optional


class LocalCache:
    """本地增量缓存器：基于文件元数据与 modifiedTime 避免重复下载"""

    def __init__(self, cache_dir: str = ".cache"):
        self.cache_dir = cache_dir
        self.meta_index_file = os.path.join(cache_dir, "index.json")
        os.makedirs(cache_dir, exist_ok=True)
        self.index: Dict[str, str] = self._load_index()

    def _load_index(self) -> Dict[str, str]:
        if os.path.exists(self.meta_index_file):
            try:
                with open(self.meta_index_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return {}
        return {}

    def _save_index(self):
        with open(self.meta_index_file, "w", encoding="utf-8") as f:
            json.dump(self.index, f, ensure_ascii=False, indent=2)

    def is_cached(self, file_id: str, modified_time: str) -> bool:
        """检查文件是否已缓存且未被云端修改"""
        cached_mtime = self.index.get(file_id)
        if cached_mtime == modified_time:
            file_path = os.path.join(self.cache_dir, f"{file_id}.json")
            return os.path.exists(file_path)
        return False

    def get(self, file_id: str) -> Optional[Dict[str, Any]]:
        """从本地缓存加载文件内容"""
        file_path = os.path.join(self.cache_dir, f"{file_id}.json")
        if os.path.exists(file_path):
            with open(file_path, "r", encoding="utf-8") as f:
                return json.load(f)
        return None

    def put(self, file_id: str, modified_time: str, data: Dict[str, Any]):
        """写入缓存文件并更新修改时间索引"""
        file_path = os.path.join(self.cache_dir, f"{file_id}.json")
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        self.index[file_id] = modified_time
        self._save_index()
~~~~~

~~~~~act
write_file
src/analyzer/metrics.py
~~~~~
~~~~~python
from typing import List, Dict, Any
from .models import PromptSession


def calculate_session_metrics(sessions: List[PromptSession]) -> Dict[str, Any]:
    """
    计算关键消耗指标：
    1. 会话总数与总提问轮次
    2. 深度会长会话（轮次 > 5）占比
    3. 模型使用分布
    4. 用户提问字数统计与生命周期概况
    """
    if not sessions:
        return {"total_sessions": 0}

    total_sessions = len(sessions)
    total_turns = sum(s.turn_count for s in sessions)
    total_user_chars = sum(s.total_user_chars for s in sessions)
    deep_sessions = [s for s in sessions if s.turn_count >= 5]

    model_distribution: Dict[str, int] = {}
    for s in sessions:
        model_distribution[s.model] = model_distribution.get(s.model, 0) + 1

    return {
        "total_sessions": total_sessions,
        "total_turns": total_turns,
        "avg_turns_per_session": round(total_turns / total_sessions, 2),
        "total_user_chars": total_user_chars,
        "deep_session_count": len(deep_sessions),
        "deep_session_ratio": f"{round(len(deep_sessions) / total_sessions * 100, 1)}%",
        "model_distribution": model_distribution,
    }
~~~~~

~~~~~act
write_file
src/analyzer/exporter.py
~~~~~
~~~~~python
import csv
import json
from typing import List
from .models import PromptSession


def export_first_prompts_to_jsonl(sessions: List[PromptSession], output_path: str):
    """
    将所有会话的「首轮提问」导出为 JSONL 文件，
    最适宜直接喂给 LLM 进行意图聚类与高频主题分析。
    """
    with open(output_path, "w", encoding="utf-8") as f:
        for s in sessions:
            if s.user_prompts:
                record = {
                    "file_id": s.file_id,
                    "title": s.name,
                    "first_prompt": s.user_prompts[0],
                    "total_turns": s.turn_count,
                    "model": s.model,
                    "created_time": s.created_time.isoformat() if s.created_time else None
                }
                f.write(json.dumps(record, ensure_ascii=False) + "\n")


def export_prompts_summary_csv(sessions: List[PromptSession], output_path: str):
    """导出所有会话的概览统计报表 CSV"""
    fieldnames = ["file_id", "title", "model", "turn_count", "user_char_count", "first_prompt_preview"]
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
                "user_char_count": s.total_user_chars,
                "first_prompt_preview": preview
            })
~~~~~

#### Acts 2: 更新统一主入口 `main.py`

~~~~~act
write_file
main.py
~~~~~
~~~~~python
"""
AI Studio Analyzer 统一调度入口
"""
import sys
from src.analyzer.drive import DriveClient, PROXY_URL
from src.analyzer.cache import LocalCache
from src.analyzer.parser import is_valid_prompt_file, parse_prompt_json
from src.analyzer.metrics import calculate_session_metrics
from src.analyzer.exporter import export_first_prompts_to_jsonl, export_prompts_summary_csv


def main():
    print("=" * 60)
    print("🚀 启动 Google AI Studio 历史提问分析器")
    print("=" * 60)

    # 1. 初始化客户端与本地缓存
    client = DriveClient(proxy_url=PROXY_URL)
    cache = LocalCache(cache_dir=".cache")

    # 2. 定位 AI Studio 目录
    folder_id = client.find_ai_studio_folder()
    if not folder_id:
        print("❌ 未能找到 Google AI Studio 目录，请检查云盘授权。")
        sys.exit(1)

    # 3. 拉取文件元数据列表
    print("📥 正在扫描云盘中的对话文件元数据...")
    files = client.list_files(folder_id)
    print(f"📊 云盘总计包含 {len(files)} 个文件。")

    # 4. 增量拉取与解析
    sessions = []
    download_count = 0
    cache_hit_count = 0

    print("⚡ 正在解析对话内容（支持本地增量缓存）...")
    for idx, fmeta in enumerate(files, 1):
        fid = fmeta["id"]
        fname = fmeta.get("name", "")
        mtime = fmeta.get("modifiedTime", "")

        if not is_valid_prompt_file(fname):
            continue

        # 缓存命中检测
        if cache.is_cached(fid, mtime):
            raw_data = cache.get(fid)
            cache_hit_count += 1
        else:
            raw_data = client.download_json(fid)
            if raw_data:
                cache.put(fid, mtime, raw_data)
                download_count += 1

        session = parse_prompt_json(fmeta, raw_data)
        if session:
            sessions.append(session)

    print(f"\n✅ 数据载入完成：有效会话 {len(sessions)} 个 (本地缓存命中: {cache_hit_count}, 新拉取: {download_count})")

    # 5. 指标概览
    metrics = calculate_session_metrics(sessions)
    print("\n" + "=" * 30 + " 📊 核心指标概览 " + "=" * 30)
    print(f"  - 总有效会话数:       {metrics['total_sessions']}")
    print(f"  - 总对话轮次 (Turns): {metrics['total_turns']} (平均每会话: {metrics['avg_turns_per_session']} 轮)")
    print(f"  - 深度攻坚会话 (≥5轮): {metrics['deep_session_count']} 场 (占比 {metrics['deep_session_ratio']})")
    print(f"  - 用户提问总字数:     {metrics['total_user_chars']} 字符")
    print(f"  - 模型使用分布:       {metrics['model_distribution']}")
    print("=" * 76)

    # 6. 导出产物
    jsonl_output = "first_prompts_for_clustering.jsonl"
    csv_output = "prompts_summary.csv"
    export_first_prompts_to_jsonl(sessions, jsonl_output)
    export_prompts_summary_csv(sessions, csv_output)

    print(f"\n📁 分析产物已生成：")
    print(f"  1. 首轮提问清洗集 (可直接供 LLM 聚类分类): ./{jsonl_output}")
    print(f"  2. 对话概览指标明细 (CSV 报表):             ./{csv_output}")


if __name__ == "__main__":
    main()
~~~~~

#### Acts 3: 编写项目 `README.md`

~~~~~act
write_file
README.md
~~~~~
~~~~~markdown
# AI Studio Analyzer (Google AI Studio 交互分析与元工作流沉淀)

> **从历史交互中洞察个人思维瓶颈与认知精力分布，沉淀个人定制化的 Prompting SOP。**

---

## 🌟 核心理念与解决的问题

在使用 Google AI Studio 进行日常攻坚与探索时，我们积累了海量的 Prompts 与多轮对话记录。
本项目旨在通过 **Google Drive API** 自动化拉取云端对话数据，完成以下目标：

1. **提取纯粹的提问语料**：剥离模型回复与系统前置指令，只看“我向 AI 输入了什么”。
2. **量化精力与时间消耗**：
   - **交互轮次（Turns）**：区分“一次性解决的简单任务”与“反复追问攻坚的深度长会话（≥5轮）”。
   - **输入字数与会话生命周期**：度量认知精力与探索时间。
3. **沉淀标准提问 SOP**：
   - 提取所有会话的「第一问」，利用 LLM 进行主题分类与意图聚类（如：代码 Debug、架构设计、API 检索、文案润色）。
   - 分析反复追问的长会话，将追问要素前置到初始提问模板中。
4. **增量缓存支持**：基于 Google Drive 文件的 `modifiedTime` 进行本地增量同步，二次运行毫秒级出结果。

---

## 🏗️ 项目架构

```text
ai-studio-analyzer/
├── src/
│   └── analyzer/
│       ├── __init__.py
│       ├── drive.py        # 基于 requests 的 Google Drive API 客户端（内置代理与超时控制）
│       ├── models.py       # 强类型数据模型 (PromptSession, ConversationTurn)
│       ├── parser.py       # 格式清洗器（兼容 chunkedPrompt 与新版 contents）
│       ├── cache.py        # 本地增量文件缓存机制 (.cache/)
│       ├── metrics.py      # 时间/轮次/字数/深度会话等精力消耗计算
│       └── exporter.py     # 导出格式化报表 (CSV) 与 LLM 聚类集 (JSONL)
├── .cache/                 # 本地缓存目录（存储已下载的云端 JSON 与索引）
├── main.py                 # 统一执行入口
├── verify_drive.py         # 极简连接验证脚本
└── credentials.json        # Google Cloud OAuth 客户端桌面凭据 (需自行配置)
```

---

## 🚀 快速上手

### 1. 准备 OAuth 凭据
1. 访问 [Google Cloud Console](https://console.cloud.google.com/)，启用 **Google Drive API**。
2. 配置 OAuth 同意屏幕为「外部」，添加你的 Google 账号为测试用户。
3. 创建「OAuth 客户端 ID」（应用类型选 **桌面应用 Desktop App**）。
4. 下载凭据 JSON，重命名为 **`credentials.json`** 放置于项目根目录。

### 2. 运行与分析
使用 `uv` 或原生 Python 运行：

```bash
uv run python main.py
```

*首次运行会唤起本地浏览器完成 Google 登录授权，并在本地生成 `token.json` 供后续自动续期复用。*

---

## 📊 输出产物说明

运行完成后，项目会在根目录生成两个关键文件：

1. **`first_prompts_for_clustering.jsonl`**：
   - 每行一条 JSON，包含每个会话的标题、首轮提问文本、对话轮数及模型标识。
   - **推荐用法**：直接把该文件内容或样本喂给 Gemini / Claude，让其为你进行主题聚类与 SOP 归纳。
2. **`prompts_summary.csv`**：
   - 会话概览表格，包含会话名称、模型、轮数、提问字数与内容预览，可直接在 Excel/Numbers 中筛选出高轮次的复杂攻坚任务。

---

## 🛣️ 后续演进规划

- [x] 迁移至稳健的 requests 驱动层，解除 Python 3.13 下 httplib2 代理阻塞
- [x] 完整的分页拉取与本地增量缓存 (`.cache/`)
- [x] 导出供 LLM 聚类的 JSONL 与统计报表
- [ ] 内置本地轻量词云与提问高频词统计
- [ ] 接入 Gemini API 实现一键式自动化意图分类与提问质量评分
~~~~~

### 下一步建议

1. 运行 `uv run python main.py`，全量执行数据拉取、增量缓存建立与指标报表输出。
2. 观察生成的 `first_prompts_for_clustering.jsonl` 与 `prompts_summary.csv`。
3. 后续若需要直接让 LLM 自动完成意图聚类与 SOP 提取，我们可以继续在 `src/analyzer/` 中添加自动化调用 Gemini 的分类管道。
