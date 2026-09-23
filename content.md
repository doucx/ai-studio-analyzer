好的，诊断结果非常清晰地揭示了问题的根源：

1. **代理与网络完全正常**：步骤 1 和步骤 2 顺利通过（返回 HTTP 204），证明本地 7890 端口和代理节点的 Google 路由是完全畅通的。
2. **`httplib2` 存在致命缺陷**：步骤 3 和步骤 4 中，无论是环境变量还是显式注入 `proxy_info`，`httplib2` 在 Python 3.13 下连接 HTTPS 均直接超时。这是因为 `httplib2` 内部陈旧的 HTTP CONNECT 隧道与 SSL 包装逻辑在 Python 3.13 的新 SSL 机制下存在严重的握手阻塞 bug。
3. **步骤 5 调用报错**：诊断脚本中误传了 `requestBuilder=None` 参数。

我将更新 `diagnose_network.py`：修复步骤 5 的参数传递，同时加入 SOCKS5 代理测试以及基于现代 `requests` + OAuth Token 的轻量直接调用对比测试。

## [WIP] fix: 修复诊断脚本中的 API 构建参数并排查 httplib2 代理根因

### 错误分析

1. **`httplib2` HTTPS 代理超时**：`httplib2` 的旧版 socket 代理隧道实现在 Python 3.13 的 SSL 变更中无法正常完成 CONNECT 握手，导致哪怕配置了 `proxy_info` 依然 timed out。
2. **`NoneType` 调用异常**：在 `build()` 时显式传了 `requestBuilder=None`，覆盖了默认的 `HttpRequest` 构造器，引发 `'NoneType' object is not callable`。

### 用户需求

定位 `httplib2` 无法通过代理完成 TLS 握手的具体原因，并验证 SOCKS5 协议以及现代 HTTP 客户端（`requests`）携带 OAuth Token 访问 Drive API 的可行性。

### 评论

`google-api-python-client` 强绑定的 `httplib2` 是 Python 早期历史遗留产物。而在现代 Python 3.13 环境下，Google OAuth 认证模块本身推荐使用 `google.auth.transport.requests`。如果能证实 `requests` 畅通无阻，我们即可通过注入兼容的 Transport 或直接使用精简 REST 请求彻底摆脱 `httplib2` 的挂起缺陷。

### 目标

1. 修复 `diagnose_network.py` 步骤 5 的 `build` 参数。
2. 增加测试：使用 `socks5://127.0.0.1:7890` 测试 `httplib2` 是否能绕过 HTTP CONNECT 缺陷。
3. 增加测试：使用 `requests` 结合 `token.json` 中的 Access Token 直接发起 Drive v3 API 请求（列出文件），验证替代方案的稳定性。

### 基本原理

1. 移除 `requestBuilder=None`，使 `build()` 能够正确回退到默认的 `HttpRequest`。
2. Google Drive v3 规范是公开标准的 RESTful JSON 接口，`token.json` 包含标准的 Bearer Token，利用已经验证通畅的 HTTP 栈可以直接完成一切查询与下载，不受 `httplib2` 的 SSL 挂起影响。

### 标签

#intent/fix #flow/ready #priority/high #comp/runtime #concept/config #scope/dx #ai/instruct #task/domain/testing #task/object/network-diagnostics #task/action/bug-fix #task/state/continue #task/status/active

---

### Script

#### Acts 1: 更新 `diagnose_network.py` 进行深度排查

~~~~~act
write_file
diagnose_network.py
~~~~~
~~~~~python
import os
import socket
import sys
import urllib.request
import requests

PROXY_HOST = "127.0.0.1"
PROXY_PORT = 7890
HTTP_PROXY_URL = f"http://{PROXY_HOST}:{PROXY_PORT}"
SOCKS5_PROXY_URL = f"socks5://{PROXY_HOST}:{PROXY_PORT}"

for proto in ('http', 'https', 'all'):
    os.environ[f'{proto}_proxy'] = HTTP_PROXY_URL
    os.environ[f'{proto.upper()}_PROXY'] = HTTP_PROXY_URL

print("=" * 60)
print("🔍 Google Drive API 深度诊断工具 (针对 Python 3.13)")
print("=" * 60)

# 1. 基础端口
print(f"\n[测试 1] 代理端口连通性: {PROXY_HOST}:{PROXY_PORT}")
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.settimeout(2.0)
try:
    sock.connect((PROXY_HOST, PROXY_PORT))
    sock.close()
    print("  ✅ 端口连通正常")
except Exception as e:
    print(f"  ❌ 端口异常: {e}")
    sys.exit(1)

# 2. requests 库经由 HTTP 代理连通性
print("\n[测试 2] requests 经由 HTTP 代理访问 Google")
try:
    proxies = {'http': HTTP_PROXY_URL, 'https': HTTP_PROXY_URL}
    r = requests.get("https://www.googleapis.com/generate_204", proxies=proxies, timeout=5)
    print(f"  ✅ requests (HTTP 代理) 成功，状态码: {r.status_code}")
except Exception as e:
    print(f"  ❌ requests (HTTP 代理) 失败: {e}")

# 3. requests 库经由 SOCKS5 代理连通性
print("\n[测试 3] requests 经由 SOCKS5 代理访问 Google")
try:
    proxies_socks = {'http': SOCKS5_PROXY_URL, 'https': SOCKS5_PROXY_URL}
    r = requests.get("https://www.googleapis.com/generate_204", proxies=proxies_socks, timeout=5)
    print(f"  ✅ requests (SOCKS5 代理) 成功，状态码: {r.status_code}")
except Exception as e:
    print(f"  ⚠️ requests (SOCKS5 代理) 异常（可能未安装 requests[socks]）: {e}")

# 4. httplib2 尝试 SOCKS5
print("\n[测试 4] httplib2 尝试通过 SOCKS5 代理访问")
try:
    import httplib2
    proxy_info = httplib2.proxy_info_from_url(SOCKS5_PROXY_URL)
    h_socks = httplib2.Http(proxy_info=proxy_info, timeout=5.0)
    resp, _ = h_socks.request("https://www.googleapis.com/generate_204", "GET")
    print(f"  ✅ httplib2 (SOCKS5) 成功，状态码: {resp.status}")
except Exception as e:
    print(f"  ❌ httplib2 (SOCKS5) 失败: {e}")

# 5. 校验 token.json 并使用 requests 直接调用 Drive API
print("\n[测试 5] 使用 google.oauth2 + requests 直接调用 Google Drive API (避开 httplib2)")
if not os.path.exists("token.json"):
    print("  ⚠️ 本地不存在 token.json，跳过此步测试。")
else:
    try:
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request

        SCOPES = ['https://www.googleapis.com/auth/drive.readonly']
        creds = Credentials.from_authorized_user_file('token.json', SCOPES)

        # 检查/刷新 token
        session = requests.Session()
        session.proxies = {'http': HTTP_PROXY_URL, 'https': HTTP_PROXY_URL}
        
        if not creds.valid:
            if creds.expired and creds.refresh_token:
                print("  🔄 Token 已过期，使用 requests 刷新...")
                req_transport = Request(session=session)
                creds.refresh(req_transport)
                print("  ✅ Token 刷新成功！")

        headers = {
            "Authorization": f"Bearer {creds.token}",
            "Accept": "application/json"
        }
        api_url = "https://www.googleapis.com/drive/v3/files?pageSize=5&fields=files(id,name,mimeType)"
        res = session.get(api_url, headers=headers, timeout=8)
        if res.status_code == 200:
            data = res.json()
            items = data.get("files", [])
            print(f"  🎉 直连 Drive REST API 成功！成功拉取到 {len(items)} 个文件：")
            for item in items[:3]:
                print(f"     - [{item.get('name')}] (ID: {item.get('id')})")
        else:
            print(f"  ❌ Drive API 返回非 200: {res.status_code} -> {res.text}")
    except Exception as e:
        print(f"  ❌ 测试 5 执行异常: {e}")

# 6. 修复参数后的 httplib2 + googleapiclient build 测试
print("\n[测试 6] 修复参数后的 googleapiclient.discovery.build 测试 (超时 5 秒)")
if os.path.exists("token.json"):
    try:
        import httplib2
        import google_auth_httplib2
        from googleapiclient.discovery import build

        creds = Credentials.from_authorized_user_file('token.json', SCOPES)
        proxy_info = httplib2.proxy_info_from_url(HTTP_PROXY_URL)
        http_client = httplib2.Http(proxy_info=proxy_info, timeout=5.0)
        authed_http = google_auth_httplib2.AuthorizedHttp(creds, http=http_client)

        # 修复参数：去掉 requestBuilder=None
        service = build('drive', 'v3', http=authed_http, static_discovery=True)
        res = service.files().list(pageSize=1, fields="files(id, name)").execute()
        print(f"  ✅ googleapiclient 调用成功: {res.get('files', [])}")
    except Exception as e:
        print(f"  ❌ googleapiclient 调用仍然失败: {e}")

print("\n" + "=" * 60)
print("🏁 诊断完成")
print("=" * 60)
~~~~~

### 下一步建议

1. 运行更新后的诊断脚本：
   ```bash
   uv run python diagnose_network.py
   ```
2. 重点关注 **[测试 5]** 的结果。如果 [测试 5] 成功直接打印出云端文件列表，说明用现代 `requests` Session 作为 HTTP Client 能够 100% 稳定运行，我们将立刻把 `verify_drive.py` 和 `main.py` 的数据调用层迁移至该稳定方案，彻底解决卡死问题。
