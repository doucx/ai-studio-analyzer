"""
AI Studio 远程增量同步模块 (类 git fetch/pull 网络层)
"""

from typing import Callable, List, Optional, Tuple
from tqdm import tqdm
from .drive import DriveClient
from .cache import SQLiteCache
from .models import PromptSession
from .parser import is_valid_prompt_file, parse_prompt_json


def fetch_remote_files(
    client: DriveClient,
    cache: SQLiteCache,
    limit: Optional[int] = 50,
    all_files: bool = False,
    progress_callback: Optional[Callable[[int, int, int, int], None]] = None,
) -> Tuple[int, int, List[PromptSession]]:
    """
    增量拉取云盘最近修改的文件并写入 SQLite 缓存。

    :param client: Google Drive 客户端
    :param cache: 本地 SQLite 缓存
    :param limit: 拉取文件上限（若 all_files=True 则忽略）
    :param all_files: 是否全量扫描
    :return: (检索有效文件总数, 缓存命中跳过数, 实际拉取写入数)
    """
    max_results = None if (all_files or limit is None or limit <= 0) else limit

    folder_id = client.find_ai_studio_folder()
    if not folder_id:
        raise RuntimeError("未能找到 Google AI Studio 目录，请检查云盘权限。")

    print(
        f"📥 正在扫描云端文件元数据 (按最近修改降序, 目标拉取: {max_results if max_results else '全量'})..."
    )
    files = client.list_files(
        folder_id=folder_id, max_results=max_results, order_by="modifiedTime desc"
    )
    valid_files = [f for f in files if is_valid_prompt_file(f.get("name", ""))]

    download_count = 0
    cache_hit_count = 0
    updated_sessions: List[PromptSession] = []
    total_valid = len(valid_files)

    with tqdm(valid_files, desc="云盘增量同步", unit="file") as pbar:
        for idx, fmeta in enumerate(pbar, start=1):
            fid = fmeta["id"]
            mtime = fmeta.get("modifiedTime", "")

            if cache.is_cached(fid, mtime):
                cache_hit_count += 1
            else:
                raw_data = client.download_json(fid)
                if raw_data:
                    # 保留云端元数据中的 name 与 createdTime 补充到原始数据中（若原 JSON 缺失）
                    if "name" not in raw_data and "name" in fmeta:
                        raw_data["name"] = fmeta["name"]
                    if "createdTime" not in raw_data and "createdTime" in fmeta:
                        raw_data["createdTime"] = fmeta["createdTime"]

                    cache.put(fid, mtime, raw_data)
                    download_count += 1

                    # 仅解析这一个更新的文件对象，避免全库重新扫描
                    session = parse_prompt_json(fmeta, raw_data)
                    if session:
                        updated_sessions.append(session)

            pbar.set_postfix(
                {"命中(跳过)": cache_hit_count, "云端拉取": download_count}
            )
            if progress_callback:
                progress_callback(idx, total_valid, cache_hit_count, download_count)

    return total_valid, cache_hit_count, updated_sessions
