"""
AI Studio Analyzer - 本地服务启动入口

使用方式:
  python main.py
"""

import uvicorn


def main():
    port = 8000
    print("=" * 60)
    print(f"🚀 AI Studio Analyzer 看板服务正在启动: http://127.0.0.1:{port}")
    print(f"📖 Swagger 接口调试文档:             http://127.0.0.1:{port}/docs")
    print("=" * 60)
    uvicorn.run("src.server.app:app", host="127.0.0.1", port=port, reload=True)


if __name__ == "__main__":
    main()
