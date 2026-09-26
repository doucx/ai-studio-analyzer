我们将代理探测目标端点更换为稳定返回 `HTTP 200 OK` 的轻量端点（`https://www.google.com/robots.txt`），以消除不美观的 404 状态码，提供明确优雅的连通性反馈。

## [WIP] fix(config): 优化代理连通性探测端点以稳定返回 HTTP 200

### 错误分析
之前采用 `https://www.googleapis.com/discovery/v1/apis` 发送 `HEAD` 请求进行探测。Google API 网关对部分未鉴权且不带查询参数的 Discovery 端点 `HEAD` 方法会直接响应 HTTP 404。虽然从网络层面证明了代理确实能够打通与 Google 边缘服务器的 TLS 握手，但在 UI 界面展示 `HTTP 404` 会给使用者带来困惑与不适。

### 用户需求
替换为一个稳定返回标准 `HTTP 200 OK` 的 Google 探测目标，使测试结果呈现纯正美观的 200 状态。

### 评论
良好的用户体验要求状态反馈不仅技术上正确，也应在语义认知上消除疑虑。选用全球边缘 CDN 均提供强缓存且绝对开放的 `robots.txt` 进行流式（stream）请求，既保留了极低的握手与传输开销，又能稳定产出 `HTTP 200 OK`。

### 目标
1. 在 `src/analyzer/config.py` 中将探测端点更新为 `https://www.google.com/robots.txt`。
2. 采用 `requests.get(..., stream=True)` 方式发起轻量请求，获取响应头即断开连接，无需拉取完整数据流。
3. 当状态码为 200 时，文案清晰展示 `连接成功 (HTTP 200 OK, 延迟: xxxms)`。

### 基本原理
`https://www.google.com/robots.txt` 是公共可访问的权威端点，在通过代理建立隧道后，Google Edge 服务器会以 `200 OK` 响应。使用 `stream=True` 可以使请求在读取到 HTTP 状态行和响应头后立即停止，网络带宽开销与 `HEAD` 请求相当，但避免了部分网关对 `HEAD` 方法的不标准响应。

### 标签
#intent/fix #flow/ready #priority/medium #comp/build #concept/config #scope/ux #ai/instruct #task/domain/config #task/object/proxy-probe-endpoint #task/action/bug-fix #task/state/begin #task/status/active

---

### Script

#### Acts 1: 更新代理连通性测试端点与响应判断逻辑

修改 `src/analyzer/config.py` 中的 `test_proxy_connection` 函数。

~~~~~act
patch_file
src/analyzer/config.py
~~~~~
~~~~~python.old
def test_proxy_connection(proxy_url: str) -> Dict[str, Any]:
    """测试指定代理访问 Google API 的连通性与往返延迟"""
    target_url = "https://www.googleapis.com/discovery/v1/apis"
    proxies = {"http": proxy_url, "https": proxy_url} if proxy_url else None
    t0 = time.time()
    try:
        resp = requests.head(target_url, proxies=proxies, timeout=10)
        elapsed_ms = round((time.time() - t0) * 1000)
        if resp.status_code < 400 or resp.status_code == 404:
            return {
                "ok": True,
                "latency_ms": elapsed_ms,
                "message": f"连接成功 (HTTP {resp.status_code}, 延迟: {elapsed_ms}ms)",
            }
        return {
            "ok": False,
            "latency_ms": elapsed_ms,
            "message": f"返回异常状态码: HTTP {resp.status_code}",
        }
    except Exception as exc:
        elapsed_ms = round((time.time() - t0) * 1000)
        return {
            "ok": False,
            "latency_ms": elapsed_ms,
            "message": f"连接失败: {str(exc)}",
        }
~~~~~
~~~~~python.new
def test_proxy_connection(proxy_url: str) -> Dict[str, Any]:
    """测试指定代理访问 Google 服务的连通性与往返延迟 (稳定返回 HTTP 200)"""
    target_url = "https://www.google.com/robots.txt"
    proxies = {"http": proxy_url, "https": proxy_url} if proxy_url else None
    t0 = time.time()
    try:
        with requests.get(target_url, proxies=proxies, timeout=10, stream=True) as resp:
            elapsed_ms = round((time.time() - t0) * 1000)
            if resp.status_code == 200:
                return {
                    "ok": True,
                    "latency_ms": elapsed_ms,
                    "message": f"连接成功 (HTTP 200 OK, 延迟: {elapsed_ms}ms)",
                }
            if resp.status_code < 400:
                return {
                    "ok": True,
                    "latency_ms": elapsed_ms,
                    "message": f"连接成功 (HTTP {resp.status_code}, 延迟: {elapsed_ms}ms)",
                }
            return {
                "ok": False,
                "latency_ms": elapsed_ms,
                "message": f"返回非预期状态码: HTTP {resp.status_code}",
            }
    except Exception as exc:
        elapsed_ms = round((time.time() - t0) * 1000)
        return {
            "ok": False,
            "latency_ms": elapsed_ms,
            "message": f"连接失败: {str(exc)}",
        }
~~~~~

### 下一步建议
1. **即时验证**: 在前端设置页面再次点击“测试代理连通性”按钮，确认此时返回绿色高亮的 `连接成功 (HTTP 200 OK, 延迟: ...ms)`。
2. **后续扩展**: 如果代理探测通过，后续即可按计划将真正的“全量拉取”与“索引重建”等核心维护操作填入预留好的骨架卡片中。
