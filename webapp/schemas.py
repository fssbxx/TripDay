# webapp/schemas.py
"""请求体模型（响应统一用 dict，避免过度建模）。"""
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class LoginIn(BaseModel):
    username: str
    password: str


class UserCreate(BaseModel):
    username: str
    password: str
    is_admin: bool = False


class ScheduleCreate(BaseModel):
    name: str


class CopyIn(BaseModel):
    # 留空表示由后端按「原名 + 数字」自动命名
    new_name: str = ""


class RenameIn(BaseModel):
    new_name: str


class StartTimeIn(BaseModel):
    """行程每天第一项日程的起始时刻，格式 HH:MM。"""
    start_time: str


class ItemIn(BaseModel):
    """新增日程项。结构与桌面版 items 元素保持一致，不引入起止时间字段。"""
    type: str
    name: str = ""
    duration: int = 60
    note: str = ""
    meal_type: Optional[str] = None
    location_id: Optional[int] = None
    location_data: Optional[Dict[str, Any]] = None
    original_name: Optional[str] = None


class ItemPatch(BaseModel):
    type: Optional[str] = None
    name: Optional[str] = None
    duration: Optional[int] = None
    note: Optional[str] = None
    meal_type: Optional[str] = None
    location_id: Optional[int] = None
    location_data: Optional[Dict[str, Any]] = None


class OrderIn(BaseModel):
    order: List[int] = Field(default_factory=list)


class LocationIn(BaseModel):
    name: str
    region_id: str = ""
    address: str = ""
    description: str = ""
    ticket: str = ""
    opening_hours: str = ""
    duration: int = 60
    contact: str = ""
    note: str = ""


class SharePatch(BaseModel):
    allow_copy: bool = True


class ShareBaseUrl(BaseModel):
    """分享链接前缀，如 https://example.com；留空表示自动使用当前访问地址。"""
    base_url: str = ""