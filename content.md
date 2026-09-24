我已为你编写好全量标题元数据修复与快照刷新脚本，将通过拉取云端文件元数据批量补齐 SQLite 中历史缓存的 `name` 字段，并同步刷新前端快照。

## [WIP] feat(maintenance): 创建并执行历史会话标题元数据补齐脚本

### 用户需求
编写并执行一个轻量脚本，一次性调用 Google Drive API 拉取全量文件的真实名称与 ID 映射，批量更新本地 SQLite 数据库中历史会话 JSON 缺失的 `name` 字段，随后立即刷新仪表盘快照。

### 评论
由于 Google Drive 的元数据查询（`list_files`）不包含对话内容本身，因此网络传输仅几百 KB，数秒即可拉取完毕；直接对本地 SQLite 进行批量内存更新并触发快照重算，能够以极低成本无缝修复全部老会话的标题展示。

### 目标
1. 编写独立的维护脚本 `repair_titles.py`，从 Google Drive 获取所有会话文件的 `(id, name)` 映射。
2. 遍历本地 SQLite `file_cache`，将缺失或陈旧的 `name` 字段批量更新为云端真实标题。
3. 调用 `_recalculate_and_snapshot()` 重新生成 `.cache/dashboard_snapshot.json` 快照。
4. 执行该脚本，完成数据自愈。

### 基本原理
直接对本地 `file_cache` 的 JSON 载荷做针对性注入：保留原有完整的 `chunkedPrompt`、Token 与分支信息，仅补充顶层 `"name"` 字段。完成后原子化替换全局快照，浏览器即可在不触发全量重算的情况下秒级读取带有真实标题的会话列表。

### 标签
#intent/tooling #flow/ready #priority/high #comp/runtime #concept/state #scope/dx #ai/instruct #task/domain/storage #task/object/title-repair #task/action/maintenance #task/state/begin

---

### Script

#### Acts 1: 创建元数据修复与快照刷新脚本

创建 `repair_titles.py` 脚本，负责拉取云盘元数据映射、更新 SQLite JSON 字段并触发快照刷新。

~~~~~act
write_file
repair_titles.py
~~~~~
~~~~~python
"""
AI Studio 会话真实标题补齐与快照刷新脚本
"""

import json
import sqlite3
from src.analyzer.drive import DriveClient, PROXY_URL
from src.server.api import _recalculate_and_snapshot


def repair_titles():
    print("🔍 正在连接 Google Drive 拉取全量文件元数据...")
    client = DriveClient(proxy_url=PROXY_URL)
    folder_id = client.find_ai_studio_folder()
    if not folder_id:
        print("❌ 未能找到 Google AI Studio 文件夹，请检查云盘权限与网络代理。")
        return

    files = client.list_files(folder_id=folder_id, max_results=None)
    name_map = {f["id"]: f["name"] for f in files if "name" in f}
    print(f"📦 云端已获取到 {len(name_map)} 个文件的真实名称映射。")

    conn = sqlite3.connect(".cache/cache.db")
    cursor = conn.cursor()
    cursor.execute("SELECT file_id, data FROM file_cache;")
    rows = cursor.fetchall()

    updated = 0
    for fid, raw_json in rows:
        if fid in name_map and name_map[fid]:
            real_name = name_map[fid]
            try:
                data = json.loads(raw_json)
                if data.get("name") != real_name:
                    data["name"] = real_name
                    cursor.execute(
                        "UPDATE file_cache SET data = ? WHERE file_id = ?;",
                        (json.dumps(data, ensure_ascii=False), fid),
                    )
                    updated += 1
            except Exception:
                continue

    conn.commit()
    conn.close()
    print(f"✅ 成功补齐/更新了 {updated} 条本地历史会话的标题！")

    print("🔄 正在重新生成仪表盘快照...")
    _recalculate_and_snapshot()
    print("🎉 仪表盘快照已成功刷新！刷新网页即可查看所有会话的真实标题。")


if __name__ == "__main__":
    repair_titles()
~~~~~


### 下一步建议
1. **浏览器验证**：刷新网页前端，查看“最近交互会话预览”表格，确认原本大量显示为 `Untitled` 的历史会话是否已恢复为真实标题。
2. **后续防范**：由于当前 `sync.py` 已具备增量写入 `name` 的补全逻辑，后续所有新同步的会话都将自动携带真实标题，无需再次执行此脚本。
3. **清理或归档**：确认修复完成后，可将 `repair_titles.py` 移动至 `scripts/` 目录或直接删除，保持根目录清爽。

执行 `repair_titles.py` 完成元数据补齐与快照重构。

~~~~~
python repair_titles.py
~~~~~
