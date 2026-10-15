# webapp/db.py
"""SQLite 存储层：建表、连接、首启种子数据导入。"""
import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime

from core import Config

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  last_schedule TEXT DEFAULT '',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  items      TEXT NOT NULL,
  start_time TEXT NOT NULL DEFAULT '07:00',
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT '',
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS locations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT UNIQUE NOT NULL,
  region_id     TEXT,
  address       TEXT,
  description   TEXT,
  ticket        TEXT,
  opening_hours TEXT,
  duration      INTEGER,
  contact       TEXT,
  note          TEXT
);

CREATE TABLE IF NOT EXISTS share_tokens (
  token       TEXT PRIMARY KEY,
  schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  allow_copy  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
"""


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def db():
    """事务化连接：正常提交，异常回滚，始终关闭。"""
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def init_db() -> None:
    """应用启动时执行一次：建表 + 种子管理员 + 种子教学点库。"""
    from .security import hash_password

    with db() as conn:
        conn.executescript(SCHEMA)

        # 兼容旧库：补齐 schedules.created_at（用 updated_at 兜底回填）
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(schedules)").fetchall()}
        if "created_at" not in cols:
            conn.execute("ALTER TABLE schedules ADD COLUMN created_at TEXT NOT NULL DEFAULT ''")
        conn.execute("UPDATE schedules SET created_at = updated_at WHERE created_at = ''")

        # 兼容旧库：补齐 schedules.start_time（默认每天 07:00 开始）
        if "start_time" not in cols:
            conn.execute("ALTER TABLE schedules ADD COLUMN start_time TEXT NOT NULL DEFAULT '07:00'")

        # 1. 无用户时按环境变量创建管理员
        count = conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
        if count == 0:
            conn.execute(
                "INSERT INTO users (username, password_hash, is_admin, last_schedule, created_at)"
                " VALUES (?, ?, 1, '', ?)",
                (config.ADMIN_USERNAME, hash_password(config.ADMIN_PASSWORD), _now()),
            )
            print(f"[init] 已创建管理员账号：{config.ADMIN_USERNAME}")

        # 2. 教学点库为空时，从随镜像打包的 locations.json 导入种子数据
        loc_count = conn.execute("SELECT COUNT(*) AS c FROM locations").fetchone()["c"]
        if loc_count == 0:
            _seed_locations(conn)


def _seed_locations(conn: sqlite3.Connection) -> None:
    path = Config.LOCATIONS_DB
    if not os.path.exists(path):
        print(f"[init] 未找到教学点种子文件：{path}")
        return
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:  # noqa: BLE001
        print(f"[init] 读取教学点种子文件失败：{e}")
        return

    rows = []
    for loc in data:
        rows.append((
            loc.get("name", "").strip(),
            loc.get("region_id", ""),
            loc.get("address", ""),
            loc.get("description", ""),
            loc.get("ticket", ""),
            loc.get("opening_hours", ""),
            int(loc.get("duration") or 60),
            loc.get("contact", ""),
            loc.get("note", ""),
        ))
    rows = [r for r in rows if r[0]]
    conn.executemany(
        "INSERT OR IGNORE INTO locations"
        " (name, region_id, address, description, ticket, opening_hours, duration, contact, note)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rows,
    )
    print(f"[init] 已导入教学点种子数据 {len(rows)} 条")