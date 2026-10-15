# webapp/routers/locations.py
"""现场教学地点库（全局共享）：查询 / 增删改 / JSON 导入。"""
import json

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from ..db import db
from ..schemas import LocationIn
from ..security import get_current_user
from .. import services as svc

router = APIRouter(prefix="/api", tags=["locations"])

_COLUMNS = ("name", "region_id", "address", "description", "ticket",
            "opening_hours", "duration", "contact", "note")


def _row_to_dict(row) -> dict:
    return {key: row[key] for key in ("id",) + _COLUMNS}


def _all_locations(conn):
    return [_row_to_dict(r) for r in conn.execute("SELECT * FROM locations").fetchall()]


@router.get("/locations")
def list_locations(province: str = None, city: str = None, district: str = None,
                   _: dict = Depends(get_current_user)):
    with db() as conn:
        locations = _all_locations(conn)
    filtered = svc.filter_locations(locations, province, city, district)
    return {"locations": filtered, "total": len(filtered)}


@router.post("/locations")
def create_location(payload: LocationIn, _: dict = Depends(get_current_user)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="请输入地点名称")
    with db() as conn:
        if conn.execute("SELECT 1 FROM locations WHERE name = ?", (name,)).fetchone():
            raise HTTPException(status_code=400, detail=f"地点名称「{name}」已存在，请使用其他名称")
        conn.execute(
            f"INSERT INTO locations ({', '.join(_COLUMNS)})"
            f" VALUES ({', '.join('?' * len(_COLUMNS))})",
            tuple(getattr(payload, c) for c in _COLUMNS),
        )
    return {"ok": True}


@router.put("/locations/{location_id}")
def update_location(location_id: int, payload: LocationIn, _: dict = Depends(get_current_user)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="请输入地点名称")
    with db() as conn:
        row = conn.execute("SELECT * FROM locations WHERE id = ?", (location_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="地点不存在")
        dup = conn.execute(
            "SELECT 1 FROM locations WHERE name = ? AND id != ?", (name, location_id)
        ).fetchone()
        if dup:
            raise HTTPException(status_code=400, detail=f"地点名称「{name}」已存在，请使用其他名称")
        assignments = ", ".join(f"{c} = ?" for c in _COLUMNS)
        conn.execute(
            f"UPDATE locations SET {assignments} WHERE id = ?",
            tuple(getattr(payload, c) for c in _COLUMNS) + (location_id,),
        )
    return {"ok": True}


@router.delete("/locations/{location_id}")
def delete_location(location_id: int, _: dict = Depends(get_current_user)):
    with db() as conn:
        row = conn.execute("SELECT * FROM locations WHERE id = ?", (location_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="地点不存在")
        conn.execute("DELETE FROM locations WHERE id = ?", (location_id,))
    return {"ok": True}


@router.post("/locations/import")
async def import_locations(file: UploadFile = File(...), _: dict = Depends(get_current_user)):
    raw = await file.read()
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="文件格式不正确，应为 UTF-8 编码的 JSON 数组")
    if not isinstance(data, list):
        raise HTTPException(status_code=400, detail="导入的文件格式不正确，应该是一个地点数组")

    added = renamed = skipped = 0
    with db() as conn:
        existing = {r["name"] for r in conn.execute("SELECT name FROM locations").fetchall()}
        for loc in data:
            if not isinstance(loc, dict):
                skipped += 1
                continue
            name = str(loc.get("name", "")).strip()
            if not name:
                skipped += 1
                continue
            if name in existing:
                counter = 1
                new_name = f"{name}-new"
                while new_name in existing:
                    counter += 1
                    new_name = f"{name}-new{counter}"
                name = new_name
                renamed += 1
            else:
                added += 1
            existing.add(name)
            conn.execute(
                f"INSERT INTO locations ({', '.join(_COLUMNS)})"
                f" VALUES ({', '.join('?' * len(_COLUMNS))})",
                (
                    name,
                    loc.get("region_id", ""),
                    loc.get("address", ""),
                    loc.get("description", ""),
                    loc.get("ticket", ""),
                    loc.get("opening_hours", ""),
                    int(loc.get("duration") or 60),
                    loc.get("contact", ""),
                    loc.get("note", ""),
                ),
            )
    return {"total": len(data), "added": added, "renamed": renamed, "skipped": skipped}