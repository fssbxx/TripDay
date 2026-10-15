# webapp/routers/auth.py
"""账号：登录 / 登出 / 当前用户 + 管理员增删账号。"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request

from ..db import db
from ..schemas import LoginIn, UserCreate
from ..security import get_current_user, hash_password, require_admin, verify_password

router = APIRouter(prefix="/api", tags=["auth"])


def _public_user(user: dict) -> dict:
    return {"id": user["id"], "username": user["username"], "is_admin": bool(user["is_admin"])}


@router.post("/auth/login")
def login(payload: LoginIn, request: Request):
    with db() as conn:
        row = conn.execute("SELECT * FROM users WHERE username = ?", (payload.username.strip(),)).fetchone()
    if not row or not verify_password(payload.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    request.session["user_id"] = row["id"]
    return {"user": _public_user(dict(row))}


@router.post("/auth/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@router.get("/auth/me")
def me(user: dict = Depends(get_current_user)):
    return {"user": _public_user(user)}


@router.get("/users")
def list_users(_: dict = Depends(require_admin)):
    with db() as conn:
        rows = conn.execute("SELECT * FROM users ORDER BY id").fetchall()
    return {"users": [_public_user(dict(r)) for r in rows]}


@router.post("/users")
def create_user(payload: UserCreate, _: dict = Depends(require_admin)):
    username = payload.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="用户名不能为空")
    if len(payload.password) < 4:
        raise HTTPException(status_code=400, detail="密码至少 4 位")
    with db() as conn:
        exists = conn.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone()
        if exists:
            raise HTTPException(status_code=400, detail="用户名已存在")
        conn.execute(
            "INSERT INTO users (username, password_hash, is_admin, last_schedule, created_at)"
            " VALUES (?, ?, ?, '', ?)",
            (username, hash_password(payload.password), 1 if payload.is_admin else 0,
             datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
        )
    return {"ok": True}


@router.delete("/users/{user_id}")
def delete_user(user_id: int, admin: dict = Depends(require_admin)):
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="不能删除当前登录账号")
    with db() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="用户不存在")
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    return {"ok": True}