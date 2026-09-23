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