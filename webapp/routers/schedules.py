# webapp/routers/schedules.py
"""行程 CRUD、日程项编辑、排序、导出、分享。全部按用户隔离。"""
import json
import re
from datetime import datetime
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse

from ..db import db
from ..schemas import CopyIn, ItemIn, ItemPatch, OrderIn, RenameIn, ScheduleCreate, SharePatch, StartTimeIn
from ..security import get_current_user
from .. import services as svc

router = APIRouter(prefix="/api", tags=["schedules"])


# --------------------------------------------------------------------------- #
# 内部工具
# --------------------------------------------------------------------------- #
def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _get_row(conn, user_id: int, name: str):
    row = conn.execute(
        "SELECT * FROM schedules WHERE user_id = ? AND name = ?", (user_id, name)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="行程不存在")
    return row


def _load_items(row) -> List[Dict[str, Any]]:
    try:
        data = json.loads(row["items"])
    except (json.JSONDecodeError, TypeError):
        data = svc.default_items()
    if not isinstance(data, list) or not data:
        data = svc.default_items()
    return data


def _save_items(conn, schedule_id: int, items: List[Dict[str, Any]]) -> None:
    conn.execute(
        "UPDATE schedules SET items = ?, updated_at = ? WHERE id = ?",
        (json.dumps(items, ensure_ascii=False), _now(), schedule_id),
    )


def _unique_name(conn, user_id: int, base: str) -> str:
    name = svc.clean_name(base)
    existing = {r["name"] for r in conn.execute(
        "SELECT name FROM schedules WHERE user_id = ?", (user_id,)
    ).fetchall()}
    if name not in existing:
        return name
    counter = 1
    while f"{name}_{counter}" in existing:
        counter += 1
    return f"{name}_{counter}"


def _auto_copy_name(conn, user_id: int, source_name: str) -> str:
    """按「原名（去掉结尾数字）+ 数字」生成唯一副本名，如 南京上海 → 南京上海2。"""
    base = svc.clean_name(source_name)
    root = re.sub(r"\s*\d+$", "", base).strip() or base
    existing = {r["name"] for r in conn.execute(
        "SELECT name FROM schedules WHERE user_id = ?", (user_id,)
    ).fetchall()}
    counter = 2
    while f"{root}{counter}" in existing:
        counter += 1
    return f"{root}{counter}"


def _set_last(conn, user_id: int, name: str) -> None:
    conn.execute("UPDATE users SET last_schedule = ? WHERE id = ?", (name, user_id))


_START_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _clean_start_time(raw: str) -> str:
    """校验每日起始时间（HH:MM），非法则抛 400。"""
    value = (raw or "").strip()
    if not _START_TIME_RE.match(value):
        raise HTTPException(status_code=400, detail="起始时间格式应为 HH:MM（00:00–23:59）")
    return value


def _share_info(conn, schedule_id: int, request: Request) -> Optional[Dict[str, Any]]:
    row = conn.execute(
        "SELECT * FROM share_tokens WHERE schedule_id = ?", (schedule_id,)
    ).fetchone()
    if not row:
        return None
    base = svc.effective_share_base(conn, str(request.base_url))
    return {
        "token": row["token"],
        "url": f"{base}/s/{row['token']}",
        "allow_copy": bool(row["allow_copy"]),
    }


def _schedule_payload(conn, row, request: Request) -> Dict[str, Any]:
    items = _load_items(row)
    start_time = row["start_time"] or svc.default_start_time()
    return {
        "name": row["name"],
        "items": items,
        "start_time": start_time,
        "days": svc.build_schedule_view(items, start_time),
        "day_count": svc.day_count(items),
        "item_count": svc.item_count(items),
        "updated_at": row["updated_at"],
        "share": _share_info(conn, row["id"], request),
    }


# --------------------------------------------------------------------------- #
# 行程列表 / 新建 / 复制 / 删除
# --------------------------------------------------------------------------- #
@router.get("/schedules")
def list_schedules(user: dict = Depends(get_current_user)):
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM schedules WHERE user_id = ? ORDER BY updated_at DESC", (user["id"],)
        ).fetchall()
        names = [r["name"] for r in rows]
        infos = []
        for r in rows:
            items = _load_items(r)
            infos.append({
                "name": r["name"],
                "day_count": svc.day_count(items),
                "item_count": svc.item_count(items),
                "updated_at": r["updated_at"],
                "created_at": r["created_at"],
            })
        last = user.get("last_schedule") or ""
        if last not in names:
            last = names[0] if names else ""
    return {"schedules": infos, "last_schedule": last}


@router.post("/schedules")
def create_schedule(payload: ScheduleCreate, user: dict = Depends(get_current_user)):
    ok, msg = svc.name_is_valid(payload.name)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    with db() as conn:
        name = _unique_name(conn, user["id"], payload.name)
        conn.execute(
            "INSERT INTO schedules (user_id, name, items, updated_at, created_at) VALUES (?, ?, ?, ?, ?)",
            (user["id"], name, json.dumps(svc.default_items(), ensure_ascii=False), _now(), _now()),
        )
        _set_last(conn, user["id"], name)
    return {"name": name}


@router.post("/schedules/{name}/copy")
def copy_schedule(name: str, payload: CopyIn, user: dict = Depends(get_current_user)):
    with db() as conn:
        src = _get_row(conn, user["id"], name)
        wanted = (payload.new_name or "").strip()
        if wanted:
            ok, msg = svc.name_is_valid(wanted)
            if not ok:
                raise HTTPException(status_code=400, detail=msg)
            if wanted == name:
                raise HTTPException(status_code=400, detail="新行程名称不能与当前行程相同")
            new_name = _unique_name(conn, user["id"], wanted)
        else:
            new_name = _auto_copy_name(conn, user["id"], name)
        conn.execute(
            "INSERT INTO schedules (user_id, name, items, start_time, updated_at, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (user["id"], new_name, src["items"], src["start_time"], _now(), _now()),
        )
        _set_last(conn, user["id"], new_name)
    return {"name": new_name}


@router.post("/schedules/{name}/rename")
def rename_schedule(name: str, payload: RenameIn, user: dict = Depends(get_current_user)):
    ok, msg = svc.name_is_valid(payload.new_name)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    new_name = svc.clean_name(payload.new_name)
    with db() as conn:
        row = _get_row(conn, user["id"], name)
        if new_name == row["name"]:
            return {"name": new_name}
        dup = conn.execute(
            "SELECT 1 FROM schedules WHERE user_id = ? AND name = ? AND id <> ?",
            (user["id"], new_name, row["id"]),
        ).fetchone()
        if dup:
            raise HTTPException(status_code=400, detail="已存在同名行程")
        conn.execute(
            "UPDATE schedules SET name = ?, updated_at = ? WHERE id = ?",
            (new_name, _now(), row["id"]),
        )
        if (user.get("last_schedule") or "") == name:
            _set_last(conn, user["id"], new_name)
    return {"name": new_name}


@router.delete("/schedules/{name}")
def delete_schedule(name: str, user: dict = Depends(get_current_user)):
    with db() as conn:
        row = _get_row(conn, user["id"], name)
        conn.execute("DELETE FROM schedules WHERE id = ?", (row["id"],))
        remaining = conn.execute(
            "SELECT name FROM schedules WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1",
            (user["id"],),
        ).fetchone()
        _set_last(conn, user["id"], remaining["name"] if remaining else "")
    return {"ok": True}


# --------------------------------------------------------------------------- #
# 单个行程
# --------------------------------------------------------------------------- #
@router.get("/schedules/{name}")
def get_schedule(name: str, request: Request, user: dict = Depends(get_current_user)):
    with db() as conn:
        row = _get_row(conn, user["id"], name)
        _set_last(conn, user["id"], name)
        return _schedule_payload(conn, row, request)


@router.get("/schedules/{name}/export")
def export_schedule(name: str, user: dict = Depends(get_current_user)):
    with db() as conn:
        row = _get_row(conn, user["id"], name)
        items = _load_items(row)
    text = svc.export_text(items, row["start_time"])
    if not text:
        raise HTTPException(status_code=400, detail="暂无有效行程可导出")
    filename = quote(f"{svc.clean_name(name)}_行程安排.txt")
    return PlainTextResponse(
        content=text,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )


@router.patch("/schedules/{name}/start-time")
def set_start_time(name: str, payload: StartTimeIn, user: dict = Depends(get_current_user)):
    """设置该行程每天第一项日程的起始时刻，随后重算所有起止时间。"""
    start_time = _clean_start_time(payload.start_time)
    with db() as conn:
        row = _get_row(conn, user["id"], name)
        conn.execute(
            "UPDATE schedules SET start_time = ?, updated_at = ? WHERE id = ?",
            (start_time, _now(), row["id"]),
        )
        items = _load_items(row)
        return {"start_time": start_time, "days": svc.build_schedule_view(items, start_time), "items": items}


# --------------------------------------------------------------------------- #
# 日程项：追加 / 编辑 / 删除 / 插入一天 / 排序
# --------------------------------------------------------------------------- #
@router.post("/schedules/{name}/items")
def add_item(name: str, payload: ItemIn, index: Optional[int] = None,
             user: dict = Depends(get_current_user)):
    with db() as conn:
        row = _get_row(conn, user["id"], name)
        items = _load_items(row)
        item = svc.make_item(payload.model_dump())
        if index is None or index < 0 or index > len(items):
            items.append(item)
        else:
            items.insert(index, item)
        svc.normalize_items(items)
        _save_items(conn, row["id"], items)
        _set_last(conn, user["id"], name)
        return {"days": svc.build_schedule_view(items, row["start_time"]), "items": items}


@router.patch("/schedules/{name}/items/{index}")
def update_item(name: str, index: int, payload: ItemPatch,
                user: dict = Depends(get_current_user)):
    with db() as conn:
        row = _get_row(conn, user["id"], name)
        items = _load_items(row)
        if index < 0 or index >= len(items):
            raise HTTPException(status_code=400, detail="日程项不存在")
        item = items[index]
        if item.get("type") == "day_marker":
            raise HTTPException(status_code=400, detail="日期分隔项不可编辑")

        data = payload.model_dump(exclude_unset=True)
        original_name = item.get("original_name")
        for key, value in data.items():
            if value is not None:
                item[key] = value
        # 用户手动改写了名称 → 解除「乘车前往」自动命名标记（与桌面版对话框一致）
        if "name" in data and data["name"] and original_name == "乘车前往" \
                and data["name"] != item.get("name"):
            item.pop("original_name", None)

        svc.normalize_items(items)
        _save_items(conn, row["id"], items)
        _set_last(conn, user["id"], name)
        return {"days": svc.build_schedule_view(items, row["start_time"]), "items": items}


@router.delete("/schedules/{name}/items/{index}")
def delete_item(name: str, index: int, user: dict = Depends(get_current_user)):
    with db() as conn:
        row = _get_row(conn, user["id"], name)
        items = _load_items(row)
        if index < 0 or index >= len(items):
            raise HTTPException(status_code=400, detail="日程项不存在")
        items.pop(index)
        if not any(it.get("type") == "day_marker" for it in items):
            items = svc.default_items()
        svc.normalize_items(items)
        _save_items(conn, row["id"], items)
        _set_last(conn, user["id"], name)
        return {"days": svc.build_schedule_view(items, row["start_time"]), "items": items}


@router.post("/schedules/{name}/days")
def add_day(name: str, user: dict = Depends(get_current_user)):
    with db() as conn:
        row = _get_row(conn, user["id"], name)
        items = _load_items(row)
        items.append({"type": "day_marker", "label": f"DAY{svc.day_count(items) + 1}"})
        svc.normalize_items(items)
        _save_items(conn, row["id"], items)
        _set_last(conn, user["id"], name)
        return {"days": svc.build_schedule_view(items, row["start_time"]), "items": items}


@router.delete("/schedules/{name}/days/{day_index}")
def delete_day(name: str, day_index: int, user: dict = Depends(get_current_user)):
    with db() as conn:
        row = _get_row(conn, user["id"], name)
        items = _load_items(row)
        bounds = svc.day_bounds(items)
        if day_index < 0 or day_index >= len(bounds):
            raise HTTPException(status_code=400, detail="这一天不存在")
        start, end = bounds[day_index]
        del items[start:end]
        if not items:
            items = svc.default_items()
        svc.relabel_days(items)
        svc.normalize_items(items)
        _save_items(conn, row["id"], items)
        _set_last(conn, user["id"], name)
        return {"days": svc.build_schedule_view(items, row["start_time"]), "items": items}


@router.put("/schedules/{name}/order")
def reorder(name: str, payload: OrderIn, user: dict = Depends(get_current_user)):
    with db() as conn:
        row = _get_row(conn, user["id"], name)
        items = _load_items(row)
        order = payload.order
        if sorted(order) != list(range(len(items))):
            raise HTTPException(status_code=400, detail="排序参数与日程项不匹配")
        items = [items[i] for i in order]
        svc.normalize_items(items)
        _save_items(conn, row["id"], items)
        return {"days": svc.build_schedule_view(items, row["start_time"]), "items": items}


# --------------------------------------------------------------------------- #
# 分享（需登录，本人行程）
# --------------------------------------------------------------------------- #
@router.post("/schedules/{name}/share")
def create_share(name: str, request: Request, user: dict = Depends(get_current_user)):
    import secrets

    with db() as conn:
        row = _get_row(conn, user["id"], name)
        existing = conn.execute(
            "SELECT * FROM share_tokens WHERE schedule_id = ?", (row["id"],)
        ).fetchone()
        if not existing:
            token = secrets.token_urlsafe(8)
            conn.execute(
                "INSERT INTO share_tokens (token, schedule_id, created_at, allow_copy)"
                " VALUES (?, ?, ?, 1)",
                (token, row["id"], _now()),
            )
        return {"share": _share_info(conn, row["id"], request)}


@router.patch("/schedules/{name}/share")
def update_share(name: str, payload: SharePatch, request: Request,
                 user: dict = Depends(get_current_user)):
    with db() as conn:
        row = _get_row(conn, user["id"], name)
        conn.execute(
            "UPDATE share_tokens SET allow_copy = ? WHERE schedule_id = ?",
            (1 if payload.allow_copy else 0, row["id"]),
        )
        return {"share": _share_info(conn, row["id"], request)}


@router.delete("/schedules/{name}/share")
def delete_share(name: str, user: dict = Depends(get_current_user)):
    with db() as conn:
        row = _get_row(conn, user["id"], name)
        conn.execute("DELETE FROM share_tokens WHERE schedule_id = ?", (row["id"],))
    return {"ok": True}