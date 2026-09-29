"""
AI Studio Analyzer API 汇聚总路由模块
各业务域子路由已解耦拆分至 src.server.routers.* 中。
"""

from fastapi import APIRouter

from src.server.routers.common import cache
from src.server.routers.metrics import router as metrics_router
from src.server.routers.ops import router as ops_router
from src.server.routers.sessions import router as sessions_router
from src.server.routers.settings import router as settings_router

# 创建主 API 路由器并挂载所有领域子路由
router = APIRouter(prefix="/api")

router.include_router(metrics_router)
router.include_router(sessions_router)
router.include_router(settings_router)
router.include_router(ops_router)

__all__ = ["cache", "router"]
