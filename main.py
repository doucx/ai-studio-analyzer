import json
import os
import requests
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow

PROXY_PORT = 7890
PROXY_URL = f"http://127.0.0.1:{PROXY_PORT}"

# 仅申请只读权限，安全最小化
SCOPES = ['https://www.googleapis.com/auth/drive.readonly']


class DriveClient:
    """基于 requests 的 Google Drive API 客户端"""

    def __init__(self, proxy_url=PROXY_URL):
        self.proxy_url = proxy_url
        self.session = requests.Session()
        if self.proxy_url:
            self.session.proxies = {
                'http': self.proxy_url,
                'https': self.proxy_url
            }
        self.creds = self._authenticate()

    def _authenticate(self):
        """处理 OAuth 认证，首次运行弹出浏览器授权，后续自动复用并刷新 token.json"""
        creds = None
        if os.path.exists('token.json'):
            creds = Credentials.from_authorized_user_file('token.json', SCOPES)

        if not creds or not creds.valid:
            transport = Request(session=self.session)
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(transport)
            else:
                flow = InstalledAppFlow.from_client_secrets_file('credentials.json', SCOPES)
                creds = flow.run_local_server(port=0)

            with open('token.json', 'w') as token:
                token.write(creds.to_json())

        return creds

    def _request(self, method, url, **kwargs):
        """发送经过 OAuth 授权的 HTTP 请求"""
        headers = kwargs.pop('headers', {})
        if self.creds.expired and self.creds.refresh_token:
            self.creds.refresh(Request(session=self.session))
        headers['Authorization'] = f"Bearer {self.creds.token}"
        kwargs['headers'] = headers
        kwargs.setdefault('timeout', 15)
        resp = self.session.request(method, url, **kwargs)
        resp.raise_for_status()
        return resp

    def find_ai_studio_folder(self):
        """查找 Google AI Studio 或 MakerSuite 所在的文件夹 ID"""
        query = "mimeType = 'application/vnd.google-apps.folder' and (name = 'Google AI Studio' or name = 'MakerSuite') and trashed = false"
        url = "https://www.googleapis.com/drive/v3/files"
        resp = self._request("GET", url, params={"q": query, "fields": "files(id, name)"})
        folders = resp.json().get('files', [])
        if not folders:
            print("未找到默认文件夹，可能保存在根目录或其他位置。")
            return None
        folder = folders[0]
        print(f"找到目录: {folder['name']} (ID: {folder['id']})")
        return folder['id']

    def list_all_prompt_files(self, folder_id=None):
        """列出所有 prompt 文件（支持分页完整拉取）"""
        files = []
        page_token = None
        url = "https://www.googleapis.com/drive/v3/files"

        if folder_id:
            query = f"'{folder_id}' in parents and trashed = false"
        else:
            query = "trashed = false and mimeType = 'application/json'"

        while True:
            params = {
                "q": query,
                "pageSize": 100,
                "fields": "nextPageToken, files(id, name, createdTime, modifiedTime)",
            }
            if page_token:
                params["pageToken"] = page_token

            resp = self._request("GET", url, params=params)
            data = resp.json()
            files.extend(data.get('files', []))

            page_token = data.get('nextPageToken')
            if not page_token:
                break

        print(f"共发现 {len(files)} 个文件。")
        return files

    def read_json_from_drive(self, file_id):
        """直接将云端文件下载到内存中并解析为 JSON"""
        url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"
        try:
            resp = self._request("GET", url)
            return resp.json()
        except Exception as e:
            print(f"下载/解析文件 ID {file_id} 失败: {e}")
            return None


def main():
    print("⏳ 初始化 Google Drive 客户端...")
    client = DriveClient(proxy_url=PROXY_URL)

    print("🔍 查找 AI Studio 文件夹...")
    folder_id = client.find_ai_studio_folder()

    print("📄 正在拉取文件列表...")
    files = client.list_all_prompt_files(folder_id=folder_id)
    print(f"✅ 文件统计完成，当前目录共计包含 {len(files)} 个文件。")


if __name__ == '__main__':
    main()