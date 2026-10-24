import json
import logging
import os
import time

# Python 3.11+ 标准库原生自带 tomllib
import tomllib  # 兼容 Python < 3.11 环境
from pathlib import Path
from typing import Any

import requests

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOML_CONFIG_PATH = PROJECT_ROOT / "config.toml"
CACHE_DIR = ".cache"
CONFIG_FILE_PATH = os.path.join(CACHE_DIR, "config.json")
LEGACY_CONFIG_FILE_PATH = "config.json"

DEFAULT_CONFIG: dict[str, Any] = {
    "proxy_url": "http://127.0.0.1:7890",
    "token_path": os.path.join(CACHE_DIR, "token.json"),
    "creds_path": os.path.join(CACHE_DIR, "credentials.json"),
    "target_folder_name": "Google AI Studio",
    "auto_sync_enabled": True,
    "auto_sync_interval": 90,
    "auto_sync_limit": 20,
    "idle_timeout_minutes": 30,
    "typing_chars_per_sec": 5.0,
    "reading_tokens_per_sec": 8.0,
    "base_chunk_seconds": 15.0,
    "deep_threshold_turns": 7,
    "search_debounce_ms": 300,
    "default_time_range": "all",
    "default_show_metadata": True,
    "default_render_markdown": True,
}


def load_toml_config() -> dict[str, Any]:
    """读取用户本地根目录的 config.toml（若存在）"""
    if not TOML_CONFIG_PATH.exists():
        return {}
    try:
        with open(TOML_CONFIG_PATH, "rb") as f:
            return tomllib.load(f)
    except Exception as exc:
        logger.warning("读取 config.toml 失败，忽略该配置: %s", exc)
        return {}


def _write_config_to_disk(cfg: dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(CONFIG_FILE_PATH), exist_ok=True)
    with open(CONFIG_FILE_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)


def load_config() -> dict[str, Any]:
    """
    分层读取配置：
    优先级：config.toml (最高, 本地静态配置) > .cache/config.json (UI 交互持久化) > DEFAULT_CONFIG
    """
    merged = dict(DEFAULT_CONFIG)

    # 1. 兼容旧位置配置迁移
    if not os.path.exists(CONFIG_FILE_PATH) and os.path.exists(LEGACY_CONFIG_FILE_PATH):
        try:
            with open(LEGACY_CONFIG_FILE_PATH, "r", encoding="utf-8") as f:
                legacy_cfg = json.load(f)
                merged.update(legacy_cfg)
                _write_config_to_disk(merged)
        except (json.JSONDecodeError, OSError) as err:
            logger.debug("读取兼容配置失败: %s", err)
    elif os.path.exists(CONFIG_FILE_PATH):
        try:
            with open(CONFIG_FILE_PATH, "r", encoding="utf-8") as f:
                user_config = json.load(f)
                merged.update(user_config)
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("读取配置文件异常，回退至默认配置: %s", exc)

    # 2. config.toml 静态层覆盖系统和源配置
    toml_cfg = load_toml_config()
    if toml_cfg:
        sys_section = toml_cfg.get("system", {})
        if "proxy_url" in sys_section:
            merged["proxy_url"] = sys_section["proxy_url"]

        aistudio_section = toml_cfg.get("sources", {}).get("aistudio", {})
        if "target_folder" in aistudio_section:
            merged["target_folder_name"] = aistudio_section["target_folder"]
        if "creds_path" in aistudio_section:
            merged["creds_path"] = aistudio_section["creds_path"]
        if "token_path" in aistudio_section:
            merged["token_path"] = aistudio_section["token_path"]

    return merged


def get_configured_sources() -> list[dict[str, Any]]:
    """
    从 config.toml 中提取所有已启用的多数据源配置，
    并将相对路径基于项目根目录安全归一化为绝对路径。
    """
    toml_data = load_toml_config()
    sources_data = toml_data.get("sources", {})
    sources: list[dict[str, Any]] = []

    # 1. Plain 数据源阵列
    for item in sources_data.get("plain", []):
        if not isinstance(item, dict) or not item.get("enabled", True):
            continue
        raw_path_str = item.get("path", "")
        if not raw_path_str:
            continue
        raw_path = Path(raw_path_str).expanduser()
        abs_path = (
            raw_path if raw_path.is_absolute() else (PROJECT_ROOT / raw_path).resolve()
        )
        sources.append(
            {
                "type": "plain",
                "name": item.get("name", "Plain"),
                "path": abs_path,
                "web_url": item.get("web_url", "http://localhost:5173"),
            }
        )

    # 2. 通用第三方数据源预留 (DeepSeek / ChatGPT 等)
    for item in sources_data.get("generic", []):
        if not isinstance(item, dict) or not item.get("enabled", False):
            continue
        raw_path_str = item.get("path", "")
        if not raw_path_str:
            continue
        raw_path = Path(raw_path_str).expanduser()
        abs_path = (
            raw_path if raw_path.is_absolute() else (PROJECT_ROOT / raw_path).resolve()
        )
        sources.append(
            {
                "type": item.get("type", "generic"),
                "name": item.get("name", "Generic Source"),
                "path": abs_path,
                "web_url": item.get("web_url"),
            }
        )

    return sources


def save_config(new_config: dict[str, Any]) -> dict[str, Any]:
    """持久化保存动态配置到 .cache/config.json"""
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
