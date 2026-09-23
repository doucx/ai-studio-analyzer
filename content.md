诊断结果完全锁定了根因：

- **结论**：在 Python 3.13 下，`googleapiclient` 底层绑定的 `httplib2` 的代理隧道逻辑存在底层死锁，无论怎么配置代理都会超时挂起。而基于现代 `requests` + `google-auth` 的直接 RESTful 请求在 **[测试 5]** 中以毫秒级速度成功获取了云端数据。
- **解法**：摆脱臃肿且有严重代理兼容 bug 的 `httplib2`，直接使用 `requests` 封装轻量可靠的 `DriveClient`。

我将生成计划，重构 `verify_drive.py`。

## [WIP] refactor: 将 verify_drive.py 网络引擎迁移至 requests

### 用户需求

彻底解决 `verify_drive.py` 因 `httplib2` 代理兼容缺陷导致的连接超时与卡死问题，使其能够稳定、迅速地查询 Google Drive 中的 AI Studio 对话文件。

### 评论

Google Drive v3 API 属于公开标准 RESTful 接口，使用项目已有的 `requests` 库配合 `google-auth` 进行 Bearer Token 鉴权，不仅代码结构更清晰、性能更高，而且天然具备现代代理支持和明确的超时控制机制，彻底杜绝无响应挂起。

### 目标

1. 将 `verify_drive.py` 重构为使用 `requests.Session` 驱动的 `DriveClient`。
2. 保留原有完整的 OAuth 登录、Token 自动刷新和本地 `token.json` 读写机制。
3. 保持原有的业务过滤逻辑（排除图片、无效前缀，校验 `chunkedPrompt` 并抽取抽样对话落盘）。

### 基本原理

1. `google.oauth2.credentials.Credentials` 原生提供对 `google.auth.transport.requests.Request` 的支持，能够通过 `requests.Session` 顺畅走代理刷新 Token。
2. Drive REST API 查询（`/files`）与媒体下载（`/files/{id}?alt=media`）只需附加 `Authorization: Bearer <token>` 请求头即可直接通信。

### 标签

#intent/refine #flow/ready #priority/high #comp/runtime #concept/executor #scope/core #ai/instruct #task/domain/cli #task/object/drive-api-client #task/action/refactor #task/state/continue #task/status/active

---

### Script

#### Acts 1: 重构 `verify_drive.py`，采用 requests 替代 httplib2

~~~~~act
write_file
verify_drive.py
~~~~~
~~~~~python
import io
import json
import os
import sys
import requests
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow

PROXY_PORT = 7890
PROXY_URL = f"http://127.0.0.1:{PROXY_PORT}"

# 仅申请只读权限，安全最小化
SCOPES = ['https://www.googleapis.com/auth/drive.readonly']


class DriveClient:
    """使用 requests 驱动的 Google Drive v3 客户端，彻底避开 Python 3.13 下 httplib2 的代理挂起缺陷"""

    def __init__(self, proxy_url=PROXY_URL):
        self.proxy_url = proxy_url
        self.session = requests.Session()
        if self.proxy_url:
            self.session.proxies = {
                'http': self.proxy_url,
                'https': self.proxy_url
            }
        self.creds = self._authenticate()

    def _authenticate(self):
        """处理 OAuth 鉴权，支持 token.json 自动复用与刷新"""
        creds = None
        if os.path.exists('token.json'):
            print("📄 发现本地已有 token.json，正在加载...")
            creds = Credentials.from_authorized_user_file('token.json', SCOPES)

        if not creds or not creds.valid:
            transport = Request(session=self.session)
            if creds and creds.expired and creds.refresh_token:
                print("🔄 Token 已过期，正在通过代理刷新...")
                creds.refresh(transport)
            else:
                print("🌐 启动本地授权服务器，等待浏览器授权...")
                flow = InstalledAppFlow.from_client_secrets_file('credentials.json', SCOPES)
                creds = flow.run_local_server(port=0)

            print("💾 正在写入 token.json 到本地...")
            with open('token.json', 'w') as token:
                token.write(creds.to_json())

        print("✅ Google 鉴权通过！")
        return creds

    def _request(self, method, url, **kwargs):
        """统一封装请求，自动注入 Bearer Token 并设定 15s 超时"""
        headers = kwargs.pop('headers', {})
        if self.creds.expired and self.creds.refresh_token:
            self.creds.refresh(Request(session=self.session))
        headers['Authorization'] = f"Bearer {self.creds.token}"
        kwargs['headers'] = headers
        kwargs.setdefault('timeout', 15)
        resp = self.session.request(method, url, **kwargs)
        resp.raise_for_status()
        return resp

    def find_ai_studio_folder(self):
        """查找 Google AI Studio 或 MakerSuite 所在文件夹 ID"""
        query = "mimeType = 'application/vnd.google-apps.folder' and (name = 'Google AI Studio' or name = 'MakerSuite') and trashed = false"
        url = "https://www.googleapis.com/drive/v3/files"
        resp = self._request("GET", url, params={"q": query, "fields": "files(id, name)"})
        folders = resp.json().get('files', [])
        if not folders:
            raise RuntimeError("❌ 未找到 Google AI Studio 文件夹，请确认账号是否正确。")
        folder = folders[0]
        print(f"📁 找到目录: 【{folder['name']}】 (ID: {folder['id']})")
        return folder['id']

    def list_files_in_folder(self, folder_id, page_size=1000):
        """列出指定文件夹内的所有文件"""
        url = "https://www.googleapis.com/drive/v3/files"
        params = {
            "q": f"'{folder_id}' in parents and trashed = false",
            "pageSize": page_size,
            "fields": "files(id, name, mimeType, createdTime)"
        }
        resp = self._request("GET", url, params=params)
        return resp.json().get('files', [])

    def download_json_file(self, file_id):
        """下载云端文件并解析为 JSON"""
        url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"
        resp = self._request("GET", url)
        try:
            return resp.json()
        except Exception:
            return None


def is_valid_prompt_name(name):
    """按文件名规则过滤非对话文件"""
    if name.startswith("Paste "):
        return False
    lower_name = name.lower()
    if lower_name.endswith(('.png', '.jpg', '.jpeg', '.webp', '.gif')):
        return False
    return True


def main():
    print("⏳ 正在初始化客户端...")
    client = DriveClient(proxy_url=PROXY_URL)

    print("⏳ 正在寻找文件夹...")
    folder_id = client.find_ai_studio_folder()

    print("⏳ 正在拉取文件列表...")
    all_files = client.list_files_in_folder(folder_id)
    print(f"📊 该目录下共有文件: {len(all_files)} 个")

    valid_samples = []
    print("\n🔍 正在寻找并验证前 2 个主对话文件...\n" + "=" * 50)

    for item in all_files:
        name = item['name']
        file_id = item['id']

        # 规则 1：文件名过滤
        if not is_valid_prompt_name(name):
            continue

        # 规则 2：内容校验（必须包含 chunkedPrompt 字段）
        data = client.download_json_file(file_id)
        if not data or "chunkedPrompt" not in data:
            continue

        valid_samples.append((item, data))
        idx = len(valid_samples)

        # 提取关键信息
        model = data.get("runSettings", {}).get("model", "未知模型")
        chunks = data.get("chunkedPrompt", {}).get("chunks", [])
        total_turns = len(chunks)

        first_user_msg = "无内容"
        for c in chunks:
            if c.get("role") == "user":
                first_user_msg = c.get("text", "")[:40].replace("\n", " ") + "..."
                break

        print(f"✅ [成功拉取 {idx}/2]")
        print(f"   - 文件名称: {name}")
        print(f"   - 文件 ID:   {file_id}")
        print(f"   - 绑定模型: {model}")
        print(f"   - 对话轮数: {total_turns} 块 (Chunks)")
        print(f"   - 内容预览: \"{first_user_msg}\"")

        local_filename = f"test_prompt_{idx}.json"
        with open(local_filename, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"   - 已将完整 JSON 保存到本地: ./{local_filename}\n")

        if len(valid_samples) >= 2:
            break

    print("=" * 50)
    if len(valid_samples) == 2:
        print("🎉 验证全部通过！API 连接正常，权限有效，且能精确排除杂质文件。")
    else:
        print(f"⚠️ 找到了 {len(valid_samples)} 个符合规范的对话文件。")


if __name__ == '__main__':
    main()
~~~~~

### 下一步建议

1. 运行重构后的验证脚本：
   ```bash
   uv run python verify_drive.py
   ```
2. 确认其秒级输出目录和抽样 2 个 JSON 对话文件。
3. 验证成功后，将相同的 `DriveClient` 架构同步更新到 `main.py`，并将临时的 `diagnose_network.py` 文件清理。
