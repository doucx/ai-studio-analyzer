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