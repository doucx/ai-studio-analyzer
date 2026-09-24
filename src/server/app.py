from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from src.server.api import router

app = FastAPI(
    title="AI Studio Analyzer API",
    version="0.1.0",
    description="个人认知与交互审计系统 - 后端数据与计算引擎"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/")
def root():
    return {
        "status": "online",
        "service": "AI Studio Analyzer API",
        "docs_url": "/docs"
    }