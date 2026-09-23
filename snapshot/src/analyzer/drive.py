import os
import requests
from typing import Optional, List, Dict, Any
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow

PROXY_PORT = 7890
PROXY_URL = f"http://127.0.0.1:{PROXY_PORT}"
SCOPES = ['https://www.googleapis.com/auth/drive.readonly']


class DriveClient:
    """Google Drive API 客户端（基于 requests，安全且支持代理）"""

    def __init__(self, proxy_url: str = PROXY_URL, token_path: str = 'token.json', creds_path: str = 'credentials.json'):
        self.proxy_url = proxy_url
        self.token_path = token_path
        self.creds_path = creds_path
        self.session = requests.Session()
        if self.proxy_url:
            self.session.proxies = {'http': self.proxy_url, 'https': self.proxy_url}
        self.creds = self._authenticate()

    def _authenticate(self) -> Credentials:
        creds = None
        if os.path.exists(self.token_path):
            creds = Credentials.from_authorized_user_file(self.token_path, SCOPES)
        if not creds or not creds.valid:
            transport = Request(session=self.session)
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(transport)
            else:
                flow = InstalledAppFlow.from_client_secrets_file(self.creds_path, SCOPES)
                creds = flow.run_local_server(port=0)
            with open(self.token_path, 'w') as token:
                token.write(creds.to_json())
        return creds

    def _request(self, method: str, url: str, **kwargs) -> requests.Response:
        headers = kwargs.pop('headers', {})
        if self.creds.expired and self.creds.refresh_token:
            self.creds.refresh(Request(session=self.session))
        headers['Authorization'] = f"Bearer {self.creds.token}"
        kwargs['headers'] = headers
        kwargs.setdefault('timeout', 15)
        resp = self.session.request(method, url, **kwargs)
        resp.raise_for_status()
        return resp

    def find_ai_studio_folder(self) -> Optional[str]:
        """查找 'Google AI Studio' 或 'MakerSuite' 文件夹 ID"""
        query = "mimeType = 'application/vnd.google-apps.folder' and (name = 'Google AI Studio' or name = 'MakerSuite') and trashed = false"
        url = "https://www.googleapis.com/drive/v3/files"
        resp = self._request("GET", url, params={"q": query, "fields": "files(id, name)"})
        folders = resp.json().get('files', [])
        return folders[0]['id'] if folders else None

    def list_files(self, folder_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """分页拉取文件夹内所有文件元数据"""
        files = []
        page_token = None
        url = "https://www.googleapis.com/drive/v3/files"
        query = f"'{folder_id}' in parents and trashed = false" if folder_id else "trashed = false and mimeType = 'application/json'"

        while True:
            params = {
                "q": query,
                "pageSize": 100,
                "fields": "nextPageToken, files(id, name, createdTime, modifiedTime)",
            }
            if page_token:
                params["pageToken"] = page_token
            data = self._request("GET", url, params=params).json()
            files.extend(data.get('files', []))
            page_token = data.get('nextPageToken')
            if not page_token:
                break
        return files

    def download_json(self, file_id: str) -> Optional[Dict[str, Any]]:
        """从云端下载文件并反序列化为 JSON 字典"""
        url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"
        try:
            return self._request("GET", url).json()
        except Exception:
            return None