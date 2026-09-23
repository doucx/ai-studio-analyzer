import io
import json
import os

# 常见代理端口：Clash/Verge 一般是 7890，v2ray 一般是 10809，依你自己的代理软件为准
PROXY_PORT = 7890  
for proto in ('http', 'https', 'all'):
    os.environ[f'{proto}_proxy'] = f'http://127.0.0.1:{PROXY_PORT}'
    os.environ[f'{proto.upper()}_PROXY'] = f'http://127.0.0.1:{PROXY_PORT}'

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

SCOPES = ['https://www.googleapis.com/auth/drive.readonly']

def get_drive_service():
    """带进度打印与抗卡死优化的鉴权逻辑"""
    creds = None
    if os.path.exists('token.json'):
        print("📄 发现本地已有 token.json，正在加载...")
        creds = Credentials.from_authorized_user_file('token.json', SCOPES)
        
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            print("🔄 Token 已过期，正在刷新...")
            creds.refresh(Request())
        else:
            print("🌐 启动本地授权服务器，等待浏览器授权...")
            flow = InstalledAppFlow.from_client_secrets_file('credentials.json', SCOPES)
            creds = flow.run_local_server(port=0)
            
        print("💾 正在写入 token.json 到本地...")
        with open('token.json', 'w') as token:
            token.write(creds.to_json())
            
    print("🔌 正在连接 Google Drive API...")
    # 使用本地静态 Discovery 文档，避免在初始化时向远端拉取 schema 导致网络挂起
    service = build('drive', 'v3', credentials=creds, static_discovery=True)
    print("✅ Google Drive API 初始化成功！")
    return service

def find_ai_studio_folder(service):
    """查找 AI Studio 文件夹"""
    query = "mimeType = 'application/vnd.google-apps.folder' and (name = 'Google AI Studio' or name = 'MakerSuite') and trashed = false"
    res = service.files().list(q=query, fields="files(id, name)").execute()
    folders = res.get('files', [])
    if not folders:
        raise RuntimeError("❌ 未找到 Google AI Studio 文件夹，请确认账号是否正确。")
    folder = folders[0]
    print(f"📁 找到目录: 【{folder['name']}】 (ID: {folder['id']})")
    return folder['id']

def download_and_parse_json(service, file_id):
    """尝试将云端文件下载并解析为 JSON"""
    request = service.files().get_media(fileId=file_id)
    fh = io.BytesIO()
    downloader = MediaIoBaseDownload(fh, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    fh.seek(0)
    try:
        return json.loads(fh.read().decode('utf-8'))
    except Exception:
        # 非 JSON（例如图片或乱码）直接返回 None
        return None

def is_valid_prompt_name(name):
    """按文件名规则过滤非对话文件"""
    # 过滤 Paste 开头的文件
    if name.startswith("Paste "):
        return False
    # 过滤常见图片格式
    lower_name = name.lower()
    if lower_name.endswith(('.png', '.jpg', '.jpeg', '.webp', '.gif')):
        return False
    return True

def main():
    print("⏳ 正在登陆...")
    service = get_drive_service()
    print("⏳ 正在寻找文件夹...")
    folder_id = find_ai_studio_folder(service)

    # 1. 查询文件夹内所有文件
    print("⏳ 正在拉取文件列表...")
    results = service.files().list(
        q=f"'{folder_id}' in parents and trashed = false",
        pageSize=1000,
        fields="files(id, name, mimeType, createdTime)"
    ).execute()
    
    all_files = results.get('files', [])
    print(f"📊 该目录下共有文件: {len(all_files)} 个")

    # 2. 抽样验证 2 个有效对话
    valid_samples = []
    print("\n🔍 正在寻找并验证前 2 个主对话文件...\n" + "="*50)

    for item in all_files:
        name = item['name']
        file_id = item['id']

        # 规则 1：文件名过滤
        if not is_valid_prompt_name(name):
            continue

        # 规则 2：内容校验（必须包含 chunkedPrompt 字段）
        data = download_and_parse_json(service, file_id)
        if not data or "chunkedPrompt" not in data:
            continue

        # 命中有效文件
        valid_samples.append((item, data))
        idx = len(valid_samples)
        
        # 提取对话关键信息
        model = data.get("runSettings", {}).get("model", "未知模型")
        chunks = data.get("chunkedPrompt", {}).get("chunks", [])
        total_turns = len(chunks)
        
        # 提取第一条用户消息作为预览
        first_user_msg = "无内容"
        for c in chunks:
            if c.get("role") == "user":
                first_user_msg = c.get("text", "")[:40].replace("\n", " ") + "..."
                break

        print(f"✅ [成功拉取 {idx}/2]")
        print(f"   - 文件名称: {name}")
        print(f"   - 文件 ID:   {file_id}")
        print(f"   - 绑定模型: {model}")
        print(f"   - 对话轮数: {total_turns} 块 (Chunks)")
        print(f"   - 内容预览: \"{first_user_msg}\"")
        
        # 本地落盘一份用于人工检查
        local_filename = f"test_prompt_{idx}.json"
        with open(local_filename, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"   - 已将完整 JSON 保存到本地: ./{local_filename}\n")

        if len(valid_samples) >= 2:
            break

    print("="*50)
    if len(valid_samples) == 2:
        print("🎉 验证全部通过！API 连接正常，权限有效，且能精确排除杂质文件。")
    else:
        print(f"⚠️ 仅找到了 {len(valid_samples)} 个符合规范的对话文件。")

if __name__ == '__main__':
    main()
