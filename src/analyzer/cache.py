import json
import os
from typing import Dict, Any, Optional


class LocalCache:
    """本地增量缓存器：基于文件元数据与 modifiedTime 避免重复下载"""

    def __init__(self, cache_dir: str = ".cache"):
        self.cache_dir = cache_dir
        self.meta_index_file = os.path.join(cache_dir, "index.json")
        os.makedirs(cache_dir, exist_ok=True)
        self.index: Dict[str, str] = self._load_index()

    def _load_index(self) -> Dict[str, str]:
        if os.path.exists(self.meta_index_file):
            try:
                with open(self.meta_index_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return {}
        return {}

    def _save_index(self):
        with open(self.meta_index_file, "w", encoding="utf-8") as f:
            json.dump(self.index, f, ensure_ascii=False, indent=2)

    def is_cached(self, file_id: str, modified_time: str) -> bool:
        """检查文件是否已缓存且未被云端修改"""
        cached_mtime = self.index.get(file_id)
        if cached_mtime == modified_time:
            file_path = os.path.join(self.cache_dir, f"{file_id}.json")
            return os.path.exists(file_path)
        return False

    def get(self, file_id: str) -> Optional[Dict[str, Any]]:
        """从本地缓存加载文件内容"""
        file_path = os.path.join(self.cache_dir, f"{file_id}.json")
        if os.path.exists(file_path):
            with open(file_path, "r", encoding="utf-8") as f:
                return json.load(f)
        return None

    def put(self, file_id: str, modified_time: str, data: Dict[str, Any]):
        """写入缓存文件并更新修改时间索引"""
        file_path = os.path.join(self.cache_dir, f"{file_id}.json")
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        self.index[file_id] = modified_time
        self._save_index()