# webapp/routers/regions.py
"""行政区划树（来自随镜像打包的 china_regions.json，进程内缓存）。"""
from fastapi import APIRouter, Depends

from ..security import get_current_user
from ..services import DEFAULT_REGION, region_tree

router = APIRouter(prefix="/api", tags=["regions"])


@router.get("/regions")
def get_regions(_: dict = Depends(get_current_user)):
    return {"tree": region_tree(), "default": DEFAULT_REGION}