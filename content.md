好的，我将生成修复 `verify_drive.py` 中代理配置与 Discovery 文档加载逻辑的计划。

## [WIP] fix: 修复 Drive API 客户端卡死与代理配置问题

### 错误分析

运行 `verify_drive.py` 时程序阻塞在 `build('drive', 'v3', credentials=creds, static_discovery=False)` 中的 TCP 握手阶段，原因如下：
1. **参数语义反转**：`static_discovery=False` 禁用了 SDK 内置的本地 Discovery 文档缓存，强制向 Google 远端发起 HTTP 请求拉取 schema。
2. **环境变量未被底层库完整识别**：底层 `httplib2` 对大写 `HTTP_PROXY` / `HTTPS_PROXY` 的识别存在局限，在缺乏小写形式时直连 Google 域名触发 GFW 丢包挂起。

### 用户需求

修复 `verify_drive.py` 的 API 客户端初始化阻塞问题，使程序能顺利连接 Google Drive API 并通过代理拉取验证文件。

### 评论

这是一个网络与第三方客户端配置的典型缺陷。通过补全大小写环境变量并显式启用 `static_discovery=True`，可以在避免不必要网络往返的同时确保后续 API 调用能可靠走本地代理。

### 目标

1. 将 `verify_drive.py` 中的环境变量设置为同时支持大小写的 `http_proxy`、`https_proxy` 和 `all_proxy`。
2. 将 `static_discovery=False` 修改为 `static_discovery=True`，复用本地内置 schema 避免初始化阻塞。

### 基本原理

1. `httplib2.proxy_info_from_environment` 会优先检索小写的环境变量，双写大小写可确保兼容性。
2. `google-api-python-client` 内置了 Drive v3 的静态 discovery artifacts，开启 `static_discovery=True` 可以彻底省去远端 schema 下载步骤。

### 标签

#intent/fix #flow/ready #priority/high #comp/runtime #concept/config #scope/dx #ai/instruct #task/domain/cli #task/object/drive-api-client #task/action/bug-fix #task/state/begin #task/status/active

---

### Script

#### Acts 1: 修正 `verify_drive.py` 的代理与 static_discovery 配置

~~~~~act
patch_file
verify_drive.py
~~~~~
~~~~~python.old
# 常见代理端口：Clash/Verge 一般是 7890，v2ray 一般是 10809，依你自己的代理软件为准
PROXY_PORT = 7890  
os.environ['HTTP_PROXY'] = f'http://127.0.0.1:{PROXY_PORT}'
os.environ['HTTPS_PROXY'] = f'http://127.0.0.1:{PROXY_PORT}'
~~~~~
~~~~~python.new
# 常见代理端口：Clash/Verge 一般是 7890，v2ray 一般是 10809，依你自己的代理软件为准
PROXY_PORT = 7890  
for proto in ('http', 'https', 'all'):
    os.environ[f'{proto}_proxy'] = f'http://127.0.0.1:{PROXY_PORT}'
    os.environ[f'{proto.upper()}_PROXY'] = f'http://127.0.0.1:{PROXY_PORT}'
~~~~~

~~~~~act
patch_file
verify_drive.py
~~~~~
~~~~~python.old
    print("🔌 正在连接 Google Drive API...")
    # 注意：加上 static_discovery=False，防止它卡在远端下载 discovery document
    service = build('drive', 'v3', credentials=creds, static_discovery=False)
    print("✅ Google Drive API 初始化成功！")
~~~~~
~~~~~python.new
    print("🔌 正在连接 Google Drive API...")
    # 使用本地静态 Discovery 文档，避免在初始化时向远端拉取 schema 导致网络挂起
    service = build('drive', 'v3', credentials=creds, static_discovery=True)
    print("✅ Google Drive API 初始化成功！")
~~~~~

### 下一步建议

1. 确认本地代理端口（默认 7890）正在运行并开启了本机代理监听。
2. 重新运行 `uv run python verify_drive.py`，验证是否能顺利打印目录与抽样对话。
3. 验证通过后，将相同的初始化配置与代理逻辑同步更新至 `main.py`。
