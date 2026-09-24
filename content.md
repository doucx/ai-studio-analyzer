收到，迁移完成后，我们需要对项目进行收敛，移除过渡性的迁移脚本、迁移接口以及冗余的平铺文件兼容回退逻辑，并彻底清理磁盘上的旧 JSON 缓存。

## [WIP] refactor(cache): 清理一次性迁移脚本、过渡接口与旧平铺缓存

### 用户需求
1. 迁移已执行完毕，删除一次性的迁移脚本 `migrate_cache.py`。
2. 清理 `src/analyzer/cache.py` 中用于数据过渡的 `migrate_from_directory` 接口，使缓存模块职责单一纯粹。
3. 精简 `inspect_schema.py`，移除针对平铺 JSON 文件的冗余扫描逻辑，完全基于 SQLite 运行。
4. 清理磁盘 `.cache/` 目录下残留的旧版平铺 `*.json` 文件与 `index.json`，释放磁盘空间。

### 评论
在数据架构迁移完成后，及时剔除过渡性代码（Scaffolding Code）与临时脚本，是保持代码库整洁与降低维护心智负担的关键动作。使各模块直接绑定单一数据源（SQLite），消除了多路径分支带来的潜在不一致风险。

### 目标
1. 删除已完成使命的 `migrate_cache.py`。
2. 剥离 `src/analyzer/cache.py` 中的 `migrate_from_directory` 方法，保留纯净的高性能缓存读写、统计与迭代 API。
3. 重构 `inspect_schema.py`，直接通过 `SQLiteCache` 提取采样数据。
4. 清除 `.cache` 目录中除 `cache.db` 系列文件以外的所有遗留 `.json` 文件。

### 基本原理
1. **单一数据源原则**：既然全部 3k+ 数据已成功入库 SQLite，后续所有读取、统计、探针操作均应严格收敛至单一的数据驱动层，不再维护向下兼容的 fallback 分支。
2. **零残留清理**：利用 `rm` 安全清除旧平铺文件，保留 `cache.db`, `cache.db-wal`, `cache.db-shm`。

### 标签
#intent/refine #flow/ready #priority/medium #comp/runtime #concept/state #scope/core #scope/dx #ai/instruct #task/domain/storage #task/object/sqlite-cache #task/action/refactor #task/state/continue

---

### Script

#### Acts 1: 移除一次性迁移脚本 `migrate_cache.py`

迁移已完成，删除该独立工具文件。

~~~~~act
delete_file
migrate_cache.py
~~~~~

#### Acts 2: 精简 `src/analyzer/cache.py`，剥离过渡迁移接口

精简缓存模块代码，删除 `migrate_from_directory`，使代码保持干净高内聚。

~~~~~act
write_file
src/analyzer/cache.py
~~~~~
~~~~~python
import json
import os
import sqlite3
from typing import Dict, Any, Optional, Iterator, Tuple
from contextlib import contextmanager


class SQLiteCache:
    """
    基于 SQLite 的高性能单文件缓存器 (开启 WAL 模式)
    支持高频增量命中检测、按需反序列化与全量流式迭代。
    """

    def __init__(self, cache_dir: str = ".cache", db_name: str = "cache.db"):
        self.cache_dir = cache_dir
        self.db_path = os.path.join(cache_dir, db_name)
        os.makedirs(cache_dir, exist_ok=True)
        self._init_db()

    @contextmanager
    def _get_connection(self):
        conn = sqlite3.connect(self.db_path, timeout=30.0)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    def _init_db(self):
        """初始化表结构并配置 WAL 高性能模式"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("PRAGMA journal_mode=WAL;")
            cursor.execute("PRAGMA synchronous=NORMAL;")
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS file_cache (
                    file_id TEXT PRIMARY KEY,
                    modified_time TEXT NOT NULL,
                    data TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_file_mtime 
                ON file_cache(file_id, modified_time);
            """)
            conn.commit()

    def is_cached(self, file_id: str, modified_time: str) -> bool:
        """检查文件是否已缓存且未被云端修改 (索引级查询)"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT 1 FROM file_cache WHERE file_id = ? AND modified_time = ? LIMIT 1;",
                (file_id, modified_time)
            )
            return cursor.fetchone() is not None

    def get(self, file_id: str) -> Optional[Dict[str, Any]]:
        """从 SQLite 读取缓存内容并反序列化"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT data FROM file_cache WHERE file_id = ? LIMIT 1;", (file_id,))
            row = cursor.fetchone()
            if row:
                try:
                    return json.loads(row["data"])
                except Exception:
                    return None
        return None

    def put(self, file_id: str, modified_time: str, data: Dict[str, Any]):
        """写入或更新单个文件缓存"""
        payload_str = json.dumps(data, ensure_ascii=False)
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO file_cache (file_id, modified_time, data, updated_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(file_id) DO UPDATE SET
                    modified_time = excluded.modified_time,
                    data = excluded.data,
                    updated_at = CURRENT_TIMESTAMP;
            """, (file_id, modified_time, payload_str))
            conn.commit()

    def count(self) -> int:
        """获取当前缓存记录总条目数"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) AS total FROM file_cache;")
            row = cursor.fetchone()
            return row["total"] if row else 0

    def iter_all_data(self) -> Iterator[Tuple[str, str, Dict[str, Any]]]:
        """流式迭代全量缓存记录，避免一次性消耗过多内存"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT file_id, modified_time, data FROM file_cache;")
            while True:
                rows = cursor.fetchmany(200)
                if not rows:
                    break
                for row in rows:
                    try:
                        parsed = json.loads(row["data"])
                        yield row["file_id"], row["modified_time"], parsed
                    except Exception:
                        continue


# 保持别名映射，保证上层调用无缝兼容
LocalCache = SQLiteCache
~~~~~

#### Acts 3: 精简 `inspect_schema.py` 为纯 SQLite 探针

移除针对平铺 JSON 文件的目录回退逻辑，直接面向 SQLite 数据库探针。

~~~~~act
write_file
inspect_schema.py
~~~~~
~~~~~python
"""
AI Studio 缓存数据 Schema 探针脚本 (直接基于 SQLite WAL 数据库，支持长文本与 Base64 压缩展示)
"""
import json
import os
from collections import Counter, defaultdict
from typing import Any
from src.analyzer.cache import SQLiteCache


def truncate_large_content(obj: Any, max_str_len: int = 80) -> Any:
    """递归截断并压缩过长的字段值（特别是 inlineFile.data、超长 text 等）"""
    if isinstance(obj, str):
        if len(obj) > max_str_len:
            head = obj[: max_str_len // 2]
            tail = obj[-max_str_len // 4 :]
            return f"{head}...[已折叠 {len(obj)} 字符]...{tail}"
        return obj
    elif isinstance(obj, dict):
        return {k: truncate_large_content(v, max_str_len) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [truncate_large_content(item, max_str_len) for item in obj]
    return obj


def get_shape_summary(obj: Any, depth: int = 0, max_depth: int = 2) -> Any:
    """递归提取 JSON 的数据结构拓扑骨架"""
    if depth >= max_depth:
        return type(obj).__name__

    if isinstance(obj, dict):
        return {k: get_shape_summary(v, depth + 1, max_depth) for k, v in obj.items()}
    elif isinstance(obj, list):
        if not obj:
            return "[] (empty)"
        return [get_shape_summary(obj[0], depth + 1, max_depth)]
    else:
        return type(obj).__name__


def inspect_cache_database(cache_dir: str = ".cache", str_truncate_limit: int = 80):
    cache = SQLiteCache(cache_dir=cache_dir)
    total_records = cache.count()

    if total_records == 0:
        print(f"❌ 在 {cache.db_path} 中未发现任何已缓存的会话记录。")
        return

    print(f"🔍 正在从 SQLite 数据库 ({cache.db_path}) 分析 {total_records} 条缓存记录...\n")

    top_level_keys_counter = Counter()
    schema_signatures = defaultdict(list)
    chunk_types_counter = Counter()

    for file_id, _, data in cache.iter_all_data():
        if not isinstance(data, dict):
            continue

        # 1. 统计顶层键名
        keys_tuple = tuple(sorted(data.keys()))
        top_level_keys_counter.update(keys_tuple)

        # 2. 统计 chunks 内部载荷形态 (text, driveDocument, inlineFile 等)
        chunks = data.get("chunkedPrompt", {}).get("chunks", [])
        for chunk in chunks:
            payload_types = [k for k in chunk.keys() if k not in ("role", "tokenCount", "createTime")]
            chunk_types_counter[", ".join(sorted(payload_types))] += 1

        # 3. 记录不同结构签名的代表样本
        sig_str = json.dumps(get_shape_summary(data, max_depth=2), ensure_ascii=False, sort_keys=True)
        if len(schema_signatures[sig_str]) < 2:
            schema_signatures[sig_str].append((file_id, data))

    # --- 打印分析结果 ---

    print("=" * 30 + " 1. 顶层 Key 出现频率 " + "=" * 30)
    for key, count in top_level_keys_counter.most_common():
        percentage = round((count / total_records) * 100, 1)
        print(f"  - {key:<25} : 出现 {count} 次 ({percentage}%)")

    print("\n" + "=" * 30 + " 2. 对话载荷类型分布 (Chunk Payloads) " + "=" * 30)
    for p_type, count in chunk_types_counter.most_common():
        label = p_type if p_type else "(仅元数据/空)"
        print(f"  - 载荷形态 [{label}]: 出现 {count} 次")

    print("\n" + "=" * 30 + " 3. 典型数据骨架 (已开启长文本折叠) " + "=" * 30)
    for idx, (sig, samples) in enumerate(schema_signatures.items(), start=1):
        sample_ids = [s[0] for s in samples]
        raw_sample = samples[0][1]
        print(f"\n▶ 格式形态 #{idx} (命中样本 File ID: {sample_ids}):")
        print(json.dumps(json.loads(sig), indent=2, ensure_ascii=False))

        print("  💡 核心对话字段探测 (采样首个 Chunk):")
        chunks = raw_sample.get("chunkedPrompt", {}).get("chunks", [])
        if chunks:
            sample_chunk = chunks[0]
            compressed_chunk = truncate_large_content(sample_chunk, max_str_len=str_truncate_limit)
            print(f"    - Chunk 结构示例:")
            print("      " + json.dumps(compressed_chunk, ensure_ascii=False))

        sys_inst = raw_sample.get("systemInstruction", {})
        if sys_inst:
            compressed_sys = truncate_large_content(sys_inst, max_str_len=str_truncate_limit)
            print(f"    - 系统指令: {json.dumps(compressed_sys, ensure_ascii=False)}")


if __name__ == "__main__":
    inspect_cache_database(".cache", str_truncate_limit=80)
~~~~~

#### Acts 4: 清理 `.cache/` 目录中的平铺 JSON 文件与 `index.json`

仅保留 SQLite 数据库核心文件 (`cache.db`, `cache.db-wal`, `cache.db-shm`)，彻底清除旧的小 JSON 文件。

~~~~~act
run_command
~~~~~
~~~~~
rm -f .cache/*.json
ls -lh .cache/
~~~~~

### 下一步建议

1. **测试主链路运行**：运行 `python main.py -n 5`，确认增量同步命中检测与反序列化表现正常，观察终端响应速度与内存占用。
2. **Schema 深度审计**：运行 `python inspect_schema.py` 验证 SQLite 探针输出。
3. **迈向下一阶段**：根据你的宏观路线图，底层 SQLite 已经就绪，下一步可以：
   - 升级 `models.py` 与 `parser.py`：解析更多维度字段（如思考块 `isThought`、真实 Token 消耗、分叉 `branchParent` 与时长 `duration`）。
   - 或者引入 SQLite FTS5 全文检索引擎，实现毫秒级关键词/主题语义切片。
