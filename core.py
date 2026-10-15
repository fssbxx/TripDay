# core.py
import sys
import os
import json
import re
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

# 目录解析辅助函数
def _get_app_dir() -> str:
    """程序/镜像所在目录（只读资源所在处）"""
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))

def _get_data_dir() -> str:
    """可写数据目录：优先环境变量 SCHEDULE_DATA_DIR（容器挂载卷），否则回退到程序目录"""
    env = os.environ.get("SCHEDULE_DATA_DIR")
    if env:
        return os.path.abspath(env)
    return _get_app_dir()

def _get_resource_dir() -> str:
    """只读资源目录：行政区划树、教学点种子库；可用 SCHEDULE_RESOURCE_DIR 覆盖"""
    env = os.environ.get("SCHEDULE_RESOURCE_DIR")
    if env:
        return os.path.abspath(env)
    return _get_app_dir()

# 配置类
class Config:
    @staticmethod
    def get_base_dir():
        return Config.BASE_DIR

    BASE_DIR = _get_data_dir()          # 可写数据目录
    APP_DIR = _get_app_dir()            # 程序目录
    RESOURCE_DIR = _get_resource_dir()  # 只读资源目录
    SCHEDULES_DIR = os.path.join(BASE_DIR, "schedules")
    LOCATIONS_DB = os.path.join(RESOURCE_DIR, "locations.json")
    CHINA_REGIONS_FILE = os.path.join(RESOURCE_DIR, "china_regions.json")
    CONFIG_FILE = os.path.join(BASE_DIR, "config.json")
    DEFAULT_SCHEDULE_NAME = "默认行程"
    DEFAULT_START_TIME = "07:00"
    MIN_DURATION = 10
    MAX_DURATION = 1440

# 行政区划数据管理
class RegionManager:
    def __init__(self):
        self.region_tree = []
        self.aid_to_region = {}
        self.load_regions()
    
    def load_regions(self) -> None:
        try:
            with open(Config.CHINA_REGIONS_FILE, 'r', encoding='utf-8') as f:
                self.region_tree = json.load(f)
            self.aid_to_region = self.build_aid_map(self.region_tree)
        except Exception as e:
            print(f"警告：无法加载 china_regions.json，错误：{e}")
            self.region_tree = []
            self.aid_to_region = {}
    
    def build_aid_map(self, data: List[Dict]) -> Dict:
        aid_map = {}
        for province in data:
            p_name = province["name"]
            for city in province.get("children", []):
                c_name = city["name"]
                for district in city.get("children", []):
                    aid = district["aid"]
                    d_name = district["name"]
                    path = f"{p_name}/{c_name}/{d_name}"
                    aid_map[aid] = {
                        "name": d_name,
                        "fullname": district["fullname"],
                        "path": path,
                        "province": p_name,
                        "city": c_name,
                        "aid": aid
                    }
        return aid_map

# 初始化目录
try:
    os.makedirs(Config.SCHEDULES_DIR, exist_ok=True)
except OSError as e:
    print(f"警告：无法创建行程目录 {Config.SCHEDULES_DIR}: {e}")

# 初始化空地点库（资源目录只读时忽略写入失败）
if not os.path.exists(Config.LOCATIONS_DB):
    try:
        with open(Config.LOCATIONS_DB, 'w', encoding='utf-8') as f:
            json.dump([], f, ensure_ascii=False, indent=2)
    except OSError as e:
        print(f"警告：无法初始化地点库 {Config.LOCATIONS_DB}: {e}")

# 工具函数
def sanitize_filename(name: str) -> str:
    return re.sub(r'[<>:"/\|?*\x00-\x1f]', '_', name.strip()) or Config.DEFAULT_SCHEDULE_NAME

def validate_schedule_name(name: str) -> tuple[bool, str]:
    """验证行程名称是否合法
    
    Args:
        name: 行程名称
        
    Returns:
        tuple[bool, str]: (是否合法, 错误信息)
    """
    if not name or not name.strip():
        return False, "请输入有效的行程名称"
    
    # 只允许中文、英文、数字和空格
    import re
    if not re.match(r'^[a-zA-Z0-9\u4e00-\u9fa5\s]+$', name):
        return False, "行程名称只能包含中文、英文、数字和空格"
    
    return True, ""

def get_schedule_path(name: str) -> str:
    return os.path.join(Config.SCHEDULES_DIR, f"{sanitize_filename(name)}.json")

def get_unique_schedule_name(base_name: str) -> str:
    clean = sanitize_filename(base_name)
    if not os.path.exists(get_schedule_path(clean)):
        return clean
    counter = 1
    while True:
        candidate = f"{clean}_{counter}"
        if not os.path.exists(get_schedule_path(candidate)):
            return candidate
        counter += 1

def list_schedule_names() -> List[str]:
    files = [f for f in os.listdir(Config.SCHEDULES_DIR) if f.endswith(".json")]
    names = [os.path.splitext(f)[0] for f in files]
    return sorted(names) if names else [Config.DEFAULT_SCHEDULE_NAME]

def load_schedule(name: str) -> Dict:
    path = get_schedule_path(name)
    if not os.path.exists(path):
        default_data = {"items": [{"type": "day_marker", "label": "DAY1"}]}
        save_schedule(name, default_data)
        return default_data
    
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        print(f"警告：行程文件 {name}.json 格式错误，使用默认数据: {e}")
    except Exception as e:
        print(f"警告：加载行程 {name} 失败: {e}")
    return {"items": [{"type": "day_marker", "label": "DAY1"}]}

def save_schedule(name: str, data: Dict) -> None:
    path = get_schedule_path(name)
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"错误：保存行程 {name} 失败: {e}")

def load_locations() -> List[Dict]:
    try:
        with open(Config.LOCATIONS_DB, 'r', encoding='utf-8') as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        print(f"警告：地点数据库文件格式错误: {e}")
    except Exception as e:
        print(f"警告：加载地点数据库失败: {e}")
    return []

def save_locations(locations: List[Dict]) -> None:
    try:
        with open(Config.LOCATIONS_DB, 'w', encoding='utf-8') as f:
            json.dump(locations, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"错误：保存地点数据库失败: {e}")

def flatten_to_export_rows(items: List[Dict], return_type: str = "export",
                           start_time: Optional[str] = None) -> Any:
    """
    处理行程项目，支持两种返回格式：
    - "export": 返回导出用的行数据
    - "display": 返回显示用的带时间的数据（原calculate_schedule_times的功能）

    start_time 为每天第一项日程的起始时刻（"HH:MM"），留空则用 Config.DEFAULT_START_TIME。
    """
    if return_type not in ["export", "display"]:
        return_type = "export"
    
    export_rows = [] if return_type == "export" else []
    display_items = [] if return_type == "display" else []
    
    days = []
    current_day = []
    
    # 按天分组
    for item in items:
        if item["type"] == "day_marker":
            if current_day:
                days.append(current_day)
            current_day = [item]
        else:
            current_day.append(item)
    
    if current_day:
        days.append(current_day)
    
    for day in days:
        current_time = datetime.strptime(start_time or Config.DEFAULT_START_TIME, "%H:%M")
        current_day_label = None
        
        for item in day:
            if item["type"] == "day_marker":
                current_day_label = item["label"]
                if return_type == "display":
                    display_items.append((item, None, None))
            else:
                item_start = current_time
                duration = item.get("duration", 60)
                item_end = item_start + timedelta(minutes=duration)
                
                start_str = item_start.strftime("%H:%M")
                end_str = item_end.strftime("%H:%M")
                
                if return_type == "export":
                    # 导出格式
                    display_name = item["name"]
                    
                    if item["type"] == "onsite_teaching":
                        description = item.get("note", "").replace('\n', ' ').replace('\r', ' ').strip()
                        if not description:
                            description = "现场教学"
                        content_with_duration = f"{display_name}（{duration}分钟）——{description}"
                    elif item["type"] == "meal":
                        content_with_duration = f"{display_name}（{duration}分钟）"
                    else:
                        content_with_duration = f"{display_name}（{duration}分钟）"
                    
                    export_rows.append({
                        "日期标签": current_day_label,
                        "时间段": f"{start_str}–{end_str}",
                        "具体内容": content_with_duration,
                        "备注": item.get("note", "")
                    })
                else:
                    # 显示格式
                    display_items.append((item, item_start, item_end))
                
                current_time = item_end
    
    if return_type == "export":
        return export_rows
    else:
        return display_items

def load_config() -> dict:
    """加载应用程序配置"""
    try:
        if os.path.exists(Config.CONFIG_FILE):
            with open(Config.CONFIG_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception:
        pass
    return {"last_schedule": ""}

def save_config(config: dict) -> None:
    """保存应用程序配置"""
    try:
        with open(Config.CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

def get_last_schedule_name() -> str:
    """获取上次编辑的行程名称"""
    config = load_config()
    last_schedule = config.get("last_schedule", "")
    
    # 验证行程文件是否存在
    if last_schedule and os.path.exists(get_schedule_path(last_schedule)):
        return last_schedule
    
    # 如果上次行程不存在，返回默认的第一个行程
    names = list_schedule_names()
    return names[0] if names else Config.DEFAULT_SCHEDULE_NAME

def set_last_schedule_name(schedule_name: str) -> None:
    """设置上次编辑的行程名称"""
    config = load_config()
    config["last_schedule"] = schedule_name
    save_config(config)