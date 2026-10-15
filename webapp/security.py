# webapp/security.py
"""密码哈希与会话依赖。"""
from fastapi import Depends, HTTPException, Request
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return pwd_context.verify(password, password_hash)
    except ValueError:
        return False


def _load_user(user_id: int):
    from .db import get_conn

    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    finally:
        conn.close()
    return dict(row) if row else None


def get_current_user(request: Request) -> dict:
    """依赖项：要求已登录，返回当前用户字典。"""
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录")
    user = _load_user(user_id)
    if not user:
        request.session.clear()
        raise HTTPException(status_code=401, detail="未登录")
    return user


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """依赖项：要求管理员权限。"""
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user