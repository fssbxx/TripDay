# webapp/main.py
"""FastAPI 装配入口：会话中间件、路由、启动钩子、静态资源。"""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from . import config
from .db import init_db
from .routers import auth, locations, regions, schedules, share

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
INDEX_FILE = os.path.join(STATIC_DIR, "index.html")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="行程安排工具", lifespan=lifespan)

app.add_middleware(
    SessionMiddleware,
    secret_key=config.SESSION_SECRET,
    session_cookie="schedule_session",
    max_age=config.SESSION_MAX_AGE,
    same_site="lax",
    https_only=config.SESSION_SECURE,
)

app.include_router(auth.router)
app.include_router(regions.router)
app.include_router(schedules.router)
app.include_router(locations.router)
app.include_router(share.router)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.middleware("http")
async def no_cache_assets(request, call_next):
    """页面与静态资源每次都回源校验，避免浏览器长期缓存旧界面。"""
    resp = await call_next(request)
    path = request.url.path
    if path == "/" or path.startswith("/s/") or path.startswith("/static/"):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(INDEX_FILE)


@app.get("/s/{token}", include_in_schema=False)
def shared_page(token: str):
    """分享公开页：返回同一个单页应用，由前端按路径渲染只读视图。"""
    return FileResponse(INDEX_FILE)