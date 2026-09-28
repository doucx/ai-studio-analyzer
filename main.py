"""
AI Studio Analyzer - 本地服务启动入口

使用方式:
  python main.py
  python main.py --host 0.0.0.0 --port 8080
"""

import argparse
import uvicorn


def main():
    # 创建命令行参数解析器
    parser = argparse.ArgumentParser(description="AI Studio Analyzer 看板服务")
    parser.add_argument(
        "--host", 
        type=str, 
        default="127.0.0.1", 
        help="绑定主机地址 (默认: 127.0.0.1)"
    )
    parser.add_argument(
        "--port", 
        type=int, 
        default=8000, 
        help="绑定端口号 (默认: 8000)"
    )
    
    args = parser.parse_args()

    print("=" * 60)
    print(f"🚀 AI Studio Analyzer 看板服务正在启动: http://{args.host}:{args.port}")
    print(f"📖 Swagger 接口调试文档:             http://{args.host}:{args.port}/docs")
    print("=" * 60)
    
    uvicorn.run("src.server.app:app", host=args.host, port=args.port, reload=True)


if __name__ == "__main__":
    main()
