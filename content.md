这个问题定位清晰且容易解决。

首先回答你的两个问题：
1. **当前 config 储存在哪里？**：此前硬编码在项目根目录下的 `config.json`（`CONFIG_FILE_PATH = "config.json"`）。将配置文件统一收纳进 `.cache/` 目录（即 `.cache/config.json`）非常合理，不仅能让根目录保持整洁，也能让缓存与本地持久化配置一同受 `.gitignore` 保护。
2. **这个问题怎么解决？**：
   - **根本原因**：`load_config()` 检测到文件不存在时调用了 `save_config(DEFAULT_CONFIG)`；而 `save_config()` 开头第一行又调用了 `current = load_config()`。在文件尚未落盘前，两者形成了无终止条件的相互递归调用，瞬间打满调用栈触发了 `RecursionError`。
   - **解决方案**：解耦底层落盘逻辑 `_write_config_to_disk`。`load_config` 在文件不存在时直接落盘并返回默认值；`save_config` 则直接读取已有文件或以 `DEFAULT_CONFIG` 为基底进行合并落盘，切断两者的环形调用链，同时将路径迁移至 `.cache/config.json` 并兼容已有配置的平滑过渡。

## [WIP] fix(config): 修复 load_config 与 save_config 循环递归并将配置迁移至 .cache

### 错误分析

当首次启动或配置文件不存在时：
1. `load_config()` 检查 `if not os.path.exists(CONFIG_FILE_PATH)` 为真，触发 `save_config(DEFAULT_CONFIG)`。
2. `save_config()` 尚未写入文件，其首行执行 `current = load_config()`。
3. `load_config()` 再次判断文件不存在，再次调用 `save_config()`，形成无限递归死循环，抛出 `RecursionError: maximum recursion depth exceeded`。

### 用户需求

1. 确认配置当前存放位置，并赞同迁移至 `.cache/` 目录下。
2. 分析并彻底消除该 `RecursionError` 递归死锁问题。

### 评论

配置模块的初始化死锁是常见的“未初始状态自引”问题。将配置存放路径移入 `.cache/config.json` 能够有效保持工程根目录的纯粹性，同时通过拆分落盘函数与断开互调链路，可一次性稳固解决该隐患。

### 目标

1. 在 `src/analyzer/config.py` 中将目标配置路径调整为 `.cache/config.json`，并支持如果根目录已有 `config.json` 时自动读取迁移。
2. 提取原子化的内部写盘函数 `_write_config_to_disk`，确保目录存在并执行 JSON 序列化。
3. 重构 `load_config` 和 `save_config`，打破循环依赖。

### 基本原理

通过单向依赖设计替代双向循环依赖：
- 读操作与写操作共享底层的默认参数字典与原子写盘能力，而非互相调用对方的对外业务函数。
- `save_config` 在文件缺失时直接以 `DEFAULT_CONFIG` 为基础副本做 `update`，不调用 `load_config`。
- `load_config` 发现文件缺失时直接使用底层写盘写入 `DEFAULT_CONFIG`，不再跳转进 `save_config`。

### 标签

#intent/fix #flow/ready #priority/high #comp/engine #concept/config #scope/core #ai/instruct #task/domain/storage #task/object/configuration #task/action/bug-fix #task/state/begin #task/status/active

---

### Script

#### Acts 1: 重构 `src/analyzer/config.py` 修复递归并迁移路径

我们将重构 `src/analyzer/config.py` 中的路径定义与配置存取函数。

~~~~~act
patch_file
src/analyzer/config.py
~~~~~
~~~~~python.old
CONFIG_FILE_PATH = "config.json"

DEFAULT_CONFIG: Dict[str, Any] = {
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


def load_config() -> Dict[str, Any]:
    """读取本地配置，若不存在则使用默认配置初始化"""
    if not os.path.exists(CONFIG_FILE_PATH):
        save_config(DEFAULT_CONFIG)
        return dict(DEFAULT_CONFIG)

    try:
        with open(CONFIG_FILE_PATH, "r", encoding="utf-8") as f:
            user_config = json.load(f)
            merged = dict(DEFAULT_CONFIG)
            merged.update(user_config)
            return merged
    except Exception as exc:
        print(f"⚠️ 读取配置文件异常，回退至默认配置: {exc}")
        return dict(DEFAULT_CONFIG)


def save_config(new_config: Dict[str, Any]) -> Dict[str, Any]:
    """持久化保存配置到 config.json"""
    current = load_config()
    current.update(new_config)
    with open(CONFIG_FILE_PATH, "w", encoding="utf-8") as f:
        json.dump(current, f, indent=2, ensure_ascii=False)
    return current
~~~~~
~~~~~python.new
CACHE_DIR = ".cache"
CONFIG_FILE_PATH = os.path.join(CACHE_DIR, "config.json")
LEGACY_CONFIG_FILE_PATH = "config.json"

DEFAULT_CONFIG: Dict[str, Any] = {
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


def _write_config_to_disk(cfg: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(CONFIG_FILE_PATH), exist_ok=True)
    with open(CONFIG_FILE_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)


def load_config() -> Dict[str, Any]:
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
        except Exception:
            pass

    if not os.path.exists(CONFIG_FILE_PATH):
        _write_config_to_disk(DEFAULT_CONFIG)
        return dict(DEFAULT_CONFIG)

    try:
        with open(CONFIG_FILE_PATH, "r", encoding="utf-8") as f:
            user_config = json.load(f)
            merged = dict(DEFAULT_CONFIG)
            merged.update(user_config)
            return merged
    except Exception as exc:
        print(f"⚠️ 读取配置文件异常，回退至默认配置: {exc}")
        return dict(DEFAULT_CONFIG)


def save_config(new_config: Dict[str, Any]) -> Dict[str, Any]:
    """持久化保存配置到 .cache/config.json"""
    current = dict(DEFAULT_CONFIG)
    target_path = (
        CONFIG_FILE_PATH
        if os.path.exists(CONFIG_FILE_PATH)
        else (
            LEGACY_CONFIG_FILE_PATH
            if os.path.exists(LEGACY_CONFIG_FILE_PATH)
            else None
        )
    )

    if target_path:
        try:
            with open(target_path, "r", encoding="utf-8") as f:
                current.update(json.load(f))
        except Exception:
            pass

    current.update(new_config)
    _write_config_to_disk(current)
    return current
~~~~~

### 下一步建议

1. 执行本计划修复 `src/analyzer/config.py`。
2. 运行 `python main.py` 验证服务是否能够正常初始化并成功生成 `.cache/config.json`。
3. 验证无误后，如需提交版本控制，可生成独立的 `[COMMIT]` 计划。
