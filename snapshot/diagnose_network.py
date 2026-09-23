import os
import socket
import sys
import urllib.request

PROXY_HOST = "127.0.0.1"
PROXY_PORT = 7890
PROXY_URL = f"http://{PROXY_HOST}:{PROXY_PORT}"

# 设置代理环境变量
for proto in ('http', 'https', 'all'):
    os.environ[f'{proto}_proxy'] = PROXY_URL
    os.environ[f'{proto.upper()}_PROXY'] = PROXY_URL

print("=" * 60)
print("🔍 Google Drive API 网络与代理连通性诊断工具")
print("=" * 60)

# -------------------------------------------------------------
# 1. 检测本地代理端口监听状态
# -------------------------------------------------------------
print(f"\n[步骤 1] 检测本地代理端口: {PROXY_HOST}:{PROXY_PORT}")
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.settimeout(2.0)
try:
    sock.connect((PROXY_HOST, PROXY_PORT))
    sock.close()
    print(f"  ✅ 本地代理端口 {PROXY_PORT} 已开放且可建立 TCP 连接。")
except Exception as e:
    print(f"  ❌ 无法连接到本地代理端口 {PROXY_PORT}: {e}")
    print("  👉 诊断建议: 检查 Clash / Verge / V2Ray 是否正在运行，并确认本地 HTTP/Mixed 端口是否确实为 7890。")
    sys.exit(1)

# -------------------------------------------------------------
# 2. 检测通用 HTTP 请求通过代理访问 Google
# -------------------------------------------------------------
print("\n[步骤 2] 使用 urllib 经由代理请求 Google (超时限制 5 秒)")
try:
    proxy_handler = urllib.request.ProxyHandler({
        'http': PROXY_URL,
        'https': PROXY_URL,
    })
    opener = urllib.request.build_opener(proxy_handler)
    req = urllib.request.Request("https://www.googleapis.com/generate_204", headers={'User-Agent': 'Mozilla/5.0'})
    with opener.open(req, timeout=5.0) as resp:
        print(f"  ✅ 成功通过代理访问 Google API 服务器！HTTP 状态码: {resp.status}")
except Exception as e:
    print(f"  ❌ 通用代理请求失败: {e}")
    print("  👉 诊断建议: 代理客户端未能将 Google 域名路由出去，请检查代理节点的网络状态或规则模式（建议切为全局/Global 测试）。")

# -------------------------------------------------------------
# 3. 检测 httplib2 默认行为（无显式 Proxy 注入）
# -------------------------------------------------------------
print("\n[步骤 3] 检测 httplib2 默认实例 (httplib2.Http(timeout=5))")
try:
    import httplib2
    h_default = httplib2.Http(timeout=5.0)
    resp, _ = h_default.request("https://www.googleapis.com/generate_204", "GET")
    print(f"  ✅ httplib2 默认实例能够走通代理并访问 Google (HTTP {resp.status})。")
except Exception as e:
    print(f"  ⚠️ httplib2 默认实例请求失败: {e}")
    print("  💡 确认现象: httplib2 默认并未自动识别环境变量代理，导致直连 Google 超时！")

# -------------------------------------------------------------
# 4. 检测 httplib2 显式 Proxy 注入
# -------------------------------------------------------------
print("\n[步骤 4] 检测 httplib2 显式注入 ProxyInfo (httplib2.proxy_info_from_url)")
try:
    import httplib2
    proxy_info = httplib2.proxy_info_from_url(PROXY_URL)
    h_proxy = httplib2.Http(proxy_info=proxy_info, timeout=5.0)
    resp, _ = h_proxy.request("https://www.googleapis.com/generate_204", "GET")
    print(f"  ✅ 显式配置 proxy_info 后，httplib2 通信完全正常！HTTP 状态码: {resp.status}")
except Exception as e:
    print(f"  ❌ 显式配置 proxy_info 仍然失败: {e}")

# -------------------------------------------------------------
# 5. 检测 token.json 和 Drive API 调用
# -------------------------------------------------------------
print("\n[步骤 5] 检测通过显式代理实例执行 Drive API 查询")
if not os.path.exists("token.json"):
    print("  ⚠️ 本地不存在 token.json，跳过此步测试。")
else:
    try:
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
        import google_auth_httplib2

        SCOPES = ['https://www.googleapis.com/auth/drive.readonly']
        creds = Credentials.from_authorized_user_file('token.json', SCOPES)

        proxy_info = httplib2.proxy_info_from_url(PROXY_URL)
        http_client = httplib2.Http(proxy_info=proxy_info, timeout=10.0)
        authed_http = google_auth_httplib2.AuthorizedHttp(creds, http=http_client)

        service = build('drive', 'v3', requestBuilder=None, http=authed_http, static_discovery=True)
        res = service.files().list(pageSize=1, fields="files(id, name)").execute()
        files = res.get('files', [])
        print(f"  🎉 Drive API 调用彻底成功！获取到 {len(files)} 条记录。")
    except Exception as e:
        print(f"  ❌ Drive API 执行异常: {e}")

print("\n" + "=" * 60)
print("🏁 诊断结束")
print("=" * 60)