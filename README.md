# 行程安排工具（TripDay）

培训行程安排工具的手机版：**FastAPI + 响应式网页**，打包为 Docker 镜像，手机浏览器访问即可使用，支持多用户账号与免登录分享。

## 功能特性

- 📅 **行程管理**：多行程创建 / 复制 / 删除 / 切换，按天组织内容
- ⏱ **时间模型**：每个日程只存时长，每天从起始时刻（默认 `07:00`，可按行程自定义）起按顺序累加，起止时间自动推算；编辑页起止为只读值，仅时长可改
- 📋 **任务管理**：常用类型预设（开班仪式、专题授课、午餐、休息等）、通用任务、现场教学任务
- 📍 **现场教学地点**：内置省市县三级行政区划 + 539 条教学点种子数据，按地区筛选，支持增 / 删 / 改与批量导入
- 📤 **导出**：行程序列导出为 **TXT**
- 🔗 **免登录分享**：生成不可猜测的 `/s/<token>` 只读链接，任何人无需登录即可查看；可随时取消，可开关「允许查看者复制到自己的行程」，分享链接的访问地址前缀可配置（公网域名 / 局域网地址）
- 👥 **多用户**：账号密码登录，各用户行程互相隔离；管理员可新建 / 删除账号

## 技术栈

- **后端**：Python 3.12 · FastAPI · Uvicorn · Starlette SessionMiddleware
- **前端**：原生响应式 HTML / CSS / JS（无前端框架，移动优先）
- **存储**：SQLite 单文件数据库（挂载卷持久化）
- **部署**：Docker / Docker Compose

## 目录结构

```
TripDay/
├── webapp/                  # Web 应用
│   ├── main.py              # FastAPI 装配入口
│   ├── config.py            # 运行时配置（环境变量）
│   ├── db.py                # SQLite 建表 + 种子导入
│   ├── security.py          # 密码哈希 / 会话依赖
│   ├── services.py          # 业务逻辑（复用 core.py）
│   ├── schemas.py           # 请求模型
│   ├── routers/             # auth / schedules / locations / regions / share
│   └── static/              # index.html / styles.css / app.js
├── core.py                  # 复用的核心逻辑（行政区划、时间计算、导出排版、校验）
├── locations.json           # 教学点种子数据（随镜像打包）
├── china_regions.json       # 中国行政区划数据（随镜像打包）
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
└── .dockerignore
```

## 快速开始

**环境要求**：已安装 Docker（含 Compose）。

```bash
cd "TripDay"
docker compose up --build -d
```

启动后（默认映射到宿主机 `3066` 端口，可在 `docker-compose.yml` 的 `ports` 中修改左侧端口）：

- 电脑访问 <http://localhost:3066>
- 手机（与电脑同一 WiFi）访问 `http://<电脑局域网IP>:3066`（Windows 用 `ipconfig` 查看 IP）

首次启动自动完成：建表 → 用环境变量创建管理员账号 → 从 `locations.json` 导入 539 条教学点。

## 默认账号

- 默认管理员：`admin` / `admin`

> 建议首次部署后立即在 `docker-compose.yml` 中修改 `ADMIN_USERNAME` / `ADMIN_PASSWORD`（**仅首次启动生效**）。
> 登录后，管理员可在「行程管理」右上角账号入口新建 / 删除普通账号。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SCHEDULE_DATA_DIR` | `/data` | 数据目录（SQLite 数据库存放位置） |
| `ADMIN_USERNAME` | `admin` | 初始管理员用户名（仅首次启动生效） |
| `ADMIN_PASSWORD` | `admin` | 初始管理员密码（仅首次启动生效） |
| `SESSION_SECRET` | `dev-secret-change-me` | 会话签名密钥（compose 示例值为 `change-me-please`），公网部署务必改为随机长串 |
| `SESSION_MAX_AGE` | `1209600` | 会话有效秒数（默认 14 天） |
| `SESSION_SECURE` | `0` | 置 `1` 时 Cookie 仅走 HTTPS（公网 HTTPS 时开启） |
| `SHARE_BASE_URL` | 空 | 分享链接前缀，如 `https://example.com` 或 `http://192.168.1.10:3066`；留空可稍后在「导出与分享」页设置 |

构建时还可用 `--build-arg PIP_INDEX_URL=` 指定 pip 源（默认清华镜像；传空值走官方源）。

## 数据持久化

SQLite 数据库保存在宿主机 `./data/tripday.db`，随容器卷持久化。`docker compose down` 后再 `up`，账号、行程、教学点数据均保留。

> 修改管理员密码：删除 `./data/tripday.db` 后重启会重新种子（**会清空全部数据**，请谨慎）。

## 免登录分享

在行程页点「导出与分享」→「生成分享链接」，得到一个 `/s/<token>` 形式的只读链接，任何人在未登录状态下打开即可查看（无编辑入口）。可随时「取消分享」使链接失效，也可开关「允许查看者复制到自己的行程」。

分享链接的前缀（访问地址）可在同一页的「访问地址（分享链接前缀）」一行配置：公网填 `https://你的域名`，局域网填 `http://192.168.x.x:3066`，保存即生效。留空则自动使用当前浏览器地址（也可用环境变量 `SHARE_BASE_URL` 预设）。

## 常用命令

```bash
docker compose logs -f          # 查看日志
docker compose down             # 停止并移除容器（数据保留）
docker compose up --build -d    # 重新构建并启动
```

## 不使用 Docker 直接运行（开发调试）

```bash
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
set SCHEDULE_DATA_DIR=%cd%\data
.venv\Scripts\python -m uvicorn webapp.main:app --host 0.0.0.0 --port 3066
```

## 公网部署（可选）

如需公网 HTTPS 访问，可在 `docker-compose.yml` 中增加 Caddy 反向代理到 `tripday:3066`，并将 `SESSION_SECURE` 设为 `1`、`SESSION_SECRET` 改为随机长串。仅局域网自用则无需此步。

## 许可证

本项目仅供学习和个人使用。

## 作者

fsbx