import json
import logging
import os
import time
from typing import Any

import requests

logger = logging.getLogger(__name__)

CACHE_DIR = ".cache"
CONFIG_FILE_PATH = os.path.join(CACHE_DIR, "config.json")
LEGACY_CONFIG_FILE_PATH = "config.json"

DEFAULT_CONFIG: dict[str, Any] = {
    "proxy_url": "http://127.0.0.1:7890",
    "token_path": "token.json",
    "creds_path": "credentials.json",
    "target_folder_name": "Google AI Studio",
    "auto_sync_enabled": True,
    "auto_sync_interval": 90,
    "auto_sync_limit": 20,
    "idle_timeout_minutes": 30,
    "typing_chars_per_sec": 5.0,
    "reading_tokens_per_sec": 8.0,
    "base_chunk_seconds": 15.0,
}


def _write_config_to_disk(cfg: dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(CONFIG_FILE_PATH), exist_ok=True)
    with open(CONFIG_FILE_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)


def load_config() -> dict[str, Any]:
    """读取本地配置，若不存在则使用默认配置初始化，并迁移根目录旧配置"""
    # 优先平滑兼容旧位置配置
    if not os.path.exists(CONFIG_FILE_PATH) and os.path.exists(LEGACY_CONFIG_FILE_PATH):
        try:
            with open(LEGACY_CONFIG_FILE_PATH, "r", encoding="utf-8") as f:
                legacy_cfg = json.load(f)
                merged = dict(DEFAULT_CONFIG)
                merged.update(legacy_cfg)
                _write_config_to_disk(merged)
                return merged
        except (json.JSONDecodeError, OSError) as err:
            logger.debug("读取兼容配置失败: %s", err)

    if not os.path.exists(CONFIG_FILE_PATH):
        _write_config_to_disk(DEFAULT_CONFIG)
        return dict(DEFAULT_CONFIG)

    try:
        with open(CONFIG_FILE_PATH, "r", encoding="utf-8") as f:
            user_config = json.load(f)
            merged = dict(DEFAULT_CONFIG)
            merged.update(user_config)
            return merged
    except (json.JSONDecodeError, OSError) as exc:
        print(f"⚠️ 读取配置文件异常，回退至默认配置: {exc}")
        return dict(DEFAULT_CONFIG)


def save_config(new_config: dict[str, Any]) -> dict[str, Any]:
    """持久化保存配置到 .cache/config.json"""
    current = dict(DEFAULT_CONFIG)
    target_path = (
        CONFIG_FILE_PATH
        if os.path.exists(CONFIG_FILE_PATH)
        else (
            LEGACY_CONFIG_FILE_PATH if os.path.exists(LEGACY_CONFIG_FILE_PATH) else None
        )
    )

    if target_path:
        try:
            with open(target_path, "r", encoding="utf-8") as f:
                current.update(json.load(f))
        except (json.JSONDecodeError, OSError) as err:
            logger.debug("读取旧配置进行合并失败: %s", err)

    current.update(new_config)
    _write_config_to_disk(current)
    return current


def test_proxy_connection(proxy_url: str) -> dict[str, Any]:
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
    except requests.RequestException as exc:
        elapsed_ms = round((time.time() - t0) * 1000)
        return {
            "ok": False,
            "latency_ms": elapsed_ms,
            "message": f"连接失败: {exc!s}",
        }
