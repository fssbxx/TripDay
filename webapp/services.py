# webapp/services.py
"""业务逻辑层：把桌面版 main.py / core.py 中的纯逻辑搬到这里，供路由复用。

不依赖任何界面库，仅使用标准库 + core.py。
"""
import copy
from typing import Any, Dict, List, Optional

from core import Config, RegionManager, flatten_to_export_rows, sanitize_filename, validate_schedule_name

from . import config

# 常用类型 9 宫格（名称, 默认时长），与桌面版 main.py common_presets_3x3 一致
COMMON_PRESETS: List[Dict[str, Any]] = [
    {"name": "开班仪式", "duration": 30},
    {"name": "乘车前往", "duration": 30},
    {"name": "早餐", "duration": 30},
    {"name": "结班仪式", "duration": 30},
    {"name": "入住酒店", "duration": 20},
    {"name": "午餐", "duration": 30},
    {"name": "专题授课", "duration": 90},
    {"name": "休息", "duration": 60},
    {"name": "晚餐", "duration": 30},
]

MEAL_NAMES = {"早餐": "breakfast", "午餐": "lunch", "晚餐": "dinner"}

DEFAULT_ITEMS: List[Dict[str, Any]] = [{"type": "day_marker", "label": "DAY1"}]

# 默认筛选地区：陕西 / 榆林 / 榆阳区
DEFAULT_REGION = {"province": "陕西", "city": "榆林", "district": "榆阳区"}

_region_manager: Optional[RegionManager] = None


SHARE_BASE_URL_KEY = "share_base_url"


def get_setting(conn, key: str, default: str = "") -> str:
    row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(conn, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?, ?)"
        " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def effective_share_base(conn, origin: str) -> str:
    """分享链接前缀：优先界面配置，其次环境变量，最后退回当前访问地址。"""
    base = (get_setting(conn, SHARE_BASE_URL_KEY) or config.SHARE_BASE_URL or "").strip().rstrip("/")
    return base or origin.strip().rstrip("/")


def get_region_manager() -> RegionManager:
    global _region_manager
    if _region_manager is None:
        _region_manager = RegionManager()
    return _region_manager


def default_items() -> List[Dict[str, Any]]:
    return copy.deepcopy(DEFAULT_ITEMS)


# --------------------------------------------------------------------------- #
# 行程名称
# --------------------------------------------------------------------------- #
def clean_name(raw: str) -> str:
    return sanitize_filename((raw or "").strip())


def name_is_valid(raw: str) -> tuple[bool, str]:
    return validate_schedule_name((raw or "").strip())


# --------------------------------------------------------------------------- #
# 时间计算 / 展示数据
# --------------------------------------------------------------------------- #
def build_schedule_view(items: List[Dict[str, Any]], start_time: Optional[str] = None) -> List[Dict[str, Any]]:
    """按天分组并附带由 start_time（默认 07:00）起顺序推算的起止时间。

    展示行顺序与 items 原始顺序一致，因此 row["index"] 可直接作为 items 下标使用。
    """
    display = flatten_to_export_rows(items, return_type="display", start_time=start_time)
    days: List[Dict[str, Any]] = []
    for index, (item, start, end) in enumerate(display):
        if item.get("type") == "day_marker":
            days.append({"label": item.get("label", ""), "rows": []})
            continue
        if not days:
            days.append({"label": "", "rows": []})
        days[-1]["rows"].append({
            "index": index,
            "type": item.get("type", "task"),
            "name": item.get("name", ""),
            "duration": item.get("duration", 60),
            "note": item.get("note", ""),
            "meal_type": item.get("meal_type"),
            "location_id": item.get("location_id"),
            "original_name": item.get("original_name"),
            "start": start.strftime("%H:%M") if start else None,
            "end": end.strftime("%H:%M") if end else None,
        })
    return days


def day_count(items: List[Dict[str, Any]]) -> int:
    return sum(1 for it in items if it.get("type") == "day_marker")


def day_bounds(items: List[Dict[str, Any]]) -> List[tuple]:
    """每一天在 items 中的下标区间（半开区间），分天规则与 build_schedule_view 一致。"""
    bounds: List[tuple] = []
    start = None
    for i, it in enumerate(items):
        if it.get("type") != "day_marker":
            continue
        if start is None:
            if i > 0:                      # 第一个分隔项之前的内容自成一天
                bounds.append((0, i))
        else:
            bounds.append((start, i))
        start = i
    if start is None:
        if items:
            bounds.append((0, len(items)))
    else:
        bounds.append((start, len(items)))
    return bounds


def relabel_days(items: List[Dict[str, Any]]) -> None:
    """删除某天后，把剩余的 DAY 标签重排为 DAY1、DAY2 …"""
    n = 1 if (items and items[0].get("type") != "day_marker") else 0
    for it in items:
        if it.get("type") == "day_marker":
            n += 1
            it["label"] = f"DAY{n}"


def item_count(items: List[Dict[str, Any]]) -> int:
    return sum(1 for it in items if it.get("type") != "day_marker")


# --------------------------------------------------------------------------- #
# 「乘车前往」智能命名（移植 main.py get_transportation_name + save_current）
# --------------------------------------------------------------------------- #
def transportation_name(transport_item: Dict[str, Any], next_item: Dict[str, Any]) -> str:
    if not next_item:
        return "乘车前往"

    next_type = next_item.get("type", "")
    next_name = next_item.get("name", "")

    if next_type == "onsite_teaching":
        if "：" in next_name:
            location_name = next_name.split("：")[1]
        elif ":" in next_name:
            location_name = next_name.split(":")[1]
        else:
            location_name = next_name
        return f"乘车前往{location_name}"

    if next_type == "meal":
        return "乘车前往餐厅"

    if next_type == "task":
        task_mappings = {
            "入住酒店": "乘车前往酒店",
            "专题授课": "乘车前往教室",
            "结班仪式": "乘车前往会场",
            "开班仪式": "乘车前往会场",
        }
        for key, value in task_mappings.items():
            if key in next_name:
                return value

    return "乘车前往"


def apply_smart_naming(items: List[Dict[str, Any]]) -> None:
    """就地重写所有「乘车前往」项的名称（依据其后第一个非日期项）。"""
    for i in range(len(items)):
        item = items[i]
        if item.get("type") == "task" and (
            item.get("name") == "乘车前往" or item.get("original_name") == "乘车前往"
        ):
            next_item = None
            for j in range(i + 1, len(items)):
                if items[j].get("type") != "day_marker":
                    next_item = items[j]
                    break
            if next_item:
                item["name"] = transportation_name(item, next_item)
                item.setdefault("original_name", "乘车前往")


def clean_onsite_note(item: Dict[str, Any]) -> None:
    """现场教学备注若以名称开头，去掉重复的名称前缀。"""
    note = item.get("note", "")
    name = item.get("name", "")
    if note and name and note.startswith(name):
        item["note"] = note[len(name):].lstrip("：: ")


def normalize_items(items: List[Dict[str, Any]]) -> None:
    """落库前统一执行：备注去重 + 智能命名。"""
    for item in items:
        if item.get("type") == "onsite_teaching":
            clean_onsite_note(item)
    apply_smart_naming(items)


def make_item(data: Dict[str, Any]) -> Dict[str, Any]:
    """把请求体规范化成桌面版 items 元素结构。"""
    item_type = data.get("type") or "task"
    name = (data.get("name") or "").strip()
    duration = int(data.get("duration") or 60)

    if item_type == "meal":
        meal_type = data.get("meal_type") or MEAL_NAMES.get(name, "lunch")
        return {"type": "meal", "name": name or "午餐", "duration": duration,
                "meal_type": meal_type, "note": data.get("note", "")}

    if item_type == "onsite_teaching":
        return {
            "type": "onsite_teaching",
            "name": name or "现场教学",
            "duration": duration,
            "note": data.get("note", ""),
            "location_id": data.get("location_id"),
            "location_data": data.get("location_data") or {},
        }

    item = {"type": "task", "name": name or "未命名", "duration": duration,
            "note": data.get("note", "")}
    if data.get("original_name"):
        item["original_name"] = data["original_name"]
    return item


# --------------------------------------------------------------------------- #
# 导出 TXT（移植 main.py export_schedule 排版）
# --------------------------------------------------------------------------- #
def export_text(items: List[Dict[str, Any]], start_time: Optional[str] = None) -> str:
    rows = flatten_to_export_rows(items, return_type="export", start_time=start_time)
    if not rows:
        return ""
    lines: List[str] = []
    current_day = None
    for row in rows:
        if row["日期标签"] != current_day:
            current_day = row["日期标签"]
            lines.append("")
            lines.append(str(current_day))
            lines.append("-" * 30)
        lines.append(f"{row['时间段']}  {row['具体内容']}")
        note = row["备注"].strip()
        # 现场教学类内容已按单行拼接备注（换行替换为空格），比对前做同样归一化以避免重复追加
        norm = " ".join(note.split())
        if note and not row["具体内容"].rstrip().endswith(norm):
            lines.append(f"    备注: {note}")
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- #
# 行政区划 / 教学点过滤（移植 get_district_ids_for_region + refresh 筛选逻辑）
# --------------------------------------------------------------------------- #
def resolve_district_ids(province: Optional[str] = None,
                         city: Optional[str] = None,
                         district_aid: Optional[str] = None) -> List[str]:
    if district_aid:
        return [district_aid]
    ids: List[str] = []
    for p in get_region_manager().region_tree:
        if province and p.get("name") != province:
            continue
        for c in p.get("children", []):
            if city and c.get("name") != city:
                continue
            for d in c.get("children", []):
                ids.append(d["aid"])
    return ids


def filter_locations(locations: List[Dict[str, Any]], province: Optional[str] = None,
                     city: Optional[str] = None, district_aid: Optional[str] = None) -> List[Dict[str, Any]]:
    if not (province or city or district_aid):
        result = list(locations)
    else:
        target_ids = set(resolve_district_ids(province, city, district_aid))
        result = [loc for loc in locations if loc.get("region_id", "") in target_ids]
    result.sort(key=lambda x: x.get("name", ""))
    return result


def region_tree() -> List[Dict[str, Any]]:
    return get_region_manager().region_tree


def default_start_time() -> str:
    return Config.DEFAULT_START_TIME