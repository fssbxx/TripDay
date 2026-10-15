# webapp/routers/share.py
"""免登录分享：只读查看某一份行程，以及分享链接前缀配置。"""
import json
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request

from ..db import db
from ..schemas import ShareBaseUrl
from ..security import get_current_user
from .. import services as svc

router = APIRouter(prefix="/api", tags=["share"])


def _effective_base(conn, request: Request) -> str:
    return svc.effective_share_base(conn, str(request.base_url))


@router.get("/settings/share-base-url")
def get_share_base_url(request: Request, user: dict = Depends(get_current_user)):
    """返回界面配置值与实际生效值（留空时生效值即当前访问地址或环境变量）。"""
    with db() as conn:
        stored = svc.get_setting(conn, svc.SHARE_BASE_URL_KEY, "")
        effective = _effective_base(conn, request)
    return {"base_url": stored, "effective": effective}


@router.put("/settings/share-base-url")
def set_share_base_url(payload: ShareBaseUrl, request: Request,
                       user: dict = Depends(get_current_user)):
    value = (payload.base_url or "").strip().rstrip("/")
    if value and not re.match(r"^https?://[^\s/]+$", value):
        raise HTTPException(status_code=400, detail="请填写以 http:// 或 https:// 开头的地址，如 https://example.com")
    with db() as conn:
        svc.set_setting(conn, svc.SHARE_BASE_URL_KEY, value)
        effective = _effective_base(conn, request)
    return {"base_url": value, "effective": effective}


def _find_shared(conn, token: str):
    return conn.execute(
        "SELECT s.name AS name, s.items AS items, s.start_time AS start_time, t.allow_copy AS allow_copy"
        " FROM share_tokens t JOIN schedules s ON s.id = t.schedule_id"
        " WHERE t.token = ?",
        (token,),
    ).fetchone()


@router.get("/share/{token}")
def view_shared(token: str):
    with db() as conn:
        row = _find_shared(conn, token)
    if not row:
        raise HTTPException(status_code=404, detail="分享链接无效或已取消")
    try:
        items = json.loads(row["items"])
    except (json.JSONDecodeError, TypeError):
        items = svc.default_items()
    return {
        "name": row["name"],
        "days": svc.build_schedule_view(items, row["start_time"]),
        "day_count": svc.day_count(items),
        "item_count": svc.item_count(items),
        "allow_copy": bool(row["allow_copy"]),
    }


@router.post("/share/{token}/copy")
def copy_shared(token: str, user: dict = Depends(get_current_user)):
    with db() as conn:
        row = _find_shared(conn, token)
        if not row:
            raise HTTPException(status_code=404, detail="分享链接无效或已取消")
        if not row["allow_copy"]:
            raise HTTPException(status_code=403, detail="该分享不允许复制")
        name = row["name"]
        existing = {r["name"] for r in conn.execute(
            "SELECT name FROM schedules WHERE user_id = ?", (user["id"],)
        ).fetchall()}
        new_name = name
        counter = 1
        while new_name in existing:
            new_name = f"{name}_{counter}"
            counter += 1
        conn.execute(
            "INSERT INTO schedules (user_id, name, items, start_time, updated_at, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (user["id"], new_name, row["items"], row["start_time"],
             datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
             datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
        )
        conn.execute("UPDATE users SET last_schedule = ? WHERE id = ?", (new_name, user["id"]))
    return {"name": new_name}