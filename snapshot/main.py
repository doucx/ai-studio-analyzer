import io
import json
import os.path
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

# 仅申请只读权限，安全最小化
SCOPES = ['https://www.googleapis.com/auth/drive.readonly']

def get_drive_service():
    """处理 OAuth 认证，首次运行会弹出浏览器登录授权，后续自动复用 token.json"""
    creds = None
    if os.path.exists('token.json'):
        creds = Credentials.from_authorized_user_file('token.json', SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file('credentials.json', SCOPES)
            creds = flow.run_local_server(port=0)
        with open('token.json', 'w') as token:
            token.write(creds.to_json())
    return build('drive', 'v3', credentials=creds)

def find_ai_studio_folder(service):
    """查找 Google AI Studio 所在的文件夹 ID"""
    query = "mimeType = 'application/vnd.google-apps.folder' and (name = 'Google AI Studio' or name = 'MakerSuite') and trashed = false"
    res = service.files().list(q=query, fields="files(id, name)").execute()
    folders = res.get('files', [])
    if not folders:
        print("未找到默认文件夹，可能保存在根目录或其他位置。")
        return None
    print(f"找到目录: {folders[0]['name']} (ID: {folders[0]['id']})")
    return folders[0]['id']

def list_all_prompt_files(service, folder_id=None):
    """列出所有 prompt 文件（带分页处理）"""
    files = []
    page_token = None
    
    # 构建查询语句：过滤垃圾箱，并只拉取该目录下的文件
    if folder_id:
        query = f"'{folder_id}' in parents and trashed = false"
    else:
        query = "trashed = false and mimeType = 'application/json'"

    while True:
        results = service.files().list(
            q=query,
            pageSize=100,
            fields="nextPageToken, files(id, name, createdTime, modifiedTime)",
            pageToken=page_token
        ).execute()
        
        files.extend(results.get('files', []))
        page_token = results.get('nextPageToken')
        if not page_token:
            break
            
    print(f"共发现 {len(files)} 个文件。")
    return files

def read_json_from_drive(service, file_id):
    """直接将云端文件下载到内存中解析为 JSON"""
    request = service.files().get_media(fileId=file_id)
    fh = io.BytesIO()
    downloader = MediaIoBaseDownload(fh, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    
    fh.seek(0)
    try:
        return json.loads(fh.read().decode('utf-8'))
    except Exception as e:
        return None
