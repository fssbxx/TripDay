# webapp/config.py
"""Web 应用运行时配置（从环境变量读取，带安全默认值）。"""
import os

from core import Config

# 可写数据目录（容器内为挂载卷 /data），SQLite 落在此处
DATA_DIR = Config.BASE_DIR
os.makedirs(DATA_DIR, exist_ok=True)

DB_PATH = os.path.join(DATA_DIR, "tripday.db")

# 首次启动时用于种子生成管理员账号
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin")

# 会话签名密钥（公网部署务必覆盖）
SESSION_SECRET = os.environ.get("SESSION_SECRET", "dev-secret-change-me")

# 会话有效期：默认 14 天
SESSION_MAX_AGE = int(os.environ.get("SESSION_MAX_AGE", str(60 * 60 * 24 * 14)))

# 公网 HTTPS 场景设为 1，使 Cookie 带 Secure 标记
SESSION_SECURE = os.environ.get("SESSION_SECURE", "0") == "1"

# 分享链接前缀（如 https://example.com 或 http://192.168.1.10:3066）。
# 留空则由前端在「导出与分享」页配置，或退回当前浏览器访问地址。
SHARE_BASE_URL = os.environ.get("SHARE_BASE_URL", "").strip().rstrip("/")