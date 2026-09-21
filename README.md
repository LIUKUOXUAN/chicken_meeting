
## Windows 11 最简单启动方式

本项目已针对 Node.js 24 的 Windows 安装场景调整为 `better-sqlite3` 13.x。当前 npm 官方最新版本为 13.0.3，可避免旧版 11.x 在 Node 24 下容易触发本地 C++ 编译的问题。

1. 确保 `node -v` 和 `npm -v` 能显示版本。
2. 在本项目目录双击 `setup-windows.cmd`。
3. 脚本会自动清理旧的 `node_modules` / `package-lock.json`、安装依赖并生成 `.env`。
4. 用记事本打开 `.env`，仅填写你自己的 `TENCENT_MEETING_TOKEN`，并修改管理员密码。
5. 执行 `npm start`，然后访问 `http://localhost:3000`。

# 腾讯会议多人预约网站

一个“普通用户无需腾讯会议账号，由统一的腾讯会议个人专业版账号创建会议”的完整 Web 项目。

## 1. 腾讯会议 MCP 接入说明

当前腾讯会议官方文档确认：腾讯会议 MCP 是云端服务，官方 Skill 代理会把 JSON-RPC 请求通过 POST 转发到 `mcp.meeting.tencent.com`，并在 Header 中注入 `X-Tencent-Meeting-Token` 和 `X-Skill-Version`。官方当前文档还明确：个人版、专业版均已开放；会议管理包含 `schedule_meeting`、`update_meeting`、`cancel_meeting`、`get_meeting`、`get_meeting_by_code` 等工具。

本项目直接在 Node.js 后端实现 MCP JSON-RPC 客户端，不让浏览器直接接触腾讯 Token。

默认 Remote MCP URL：

```text
https://mcp.meeting.tencent.com/mcp/wemeet-open/v1
```

该具体路径来自当前公开的腾讯会议 MCP 接入示例；官方帮助中心页面本身明确了远程主机和 Header，但把完整参数 Schema 放在 Skill 包的 `api_references.md` 中。因此项目把 URL、Skill 版本、MCP 协议版本全部做成环境变量，避免把未来升级写死。

## 2. 已实现功能

- 普通用户免腾讯会议登录直接预约
- 主题、预约人、开始/结束时间、会议说明
- “设置结束时间 / 设置会议时长”双模式
- 实时计算时长
- 跨天会议与非法时间校验
- Asia/Shanghai 时间统一处理
- 后端二次冲突检测
- SQLite 预约记录
- 请求幂等键 + provisioning 状态，降低重复创建风险
- 腾讯会议 `schedule_meeting` 真正调用
- 创建后自动补查 `get_meeting` / `get_meeting_by_code` 获取会议号、链接等信息
- 自动生成邀请文字
- 复制邀请、链接、会议号
- 历史会议
- 管理员登录
- 管理员修改/取消/删除本地失败记录
- 邀请模板管理
- 腾讯会议连接测试
- Nginx / PM2 部署配置
- Token 永不返回前端

### 当前高级设置

根据当前公开 Skill 文档，项目只实现已核实的字段：

- 会议密码：4-6 位数字
- 成员入会限制：1 所有成员 / 2 仅受邀 / 3 仅企业内部
- 等候室：`auto_in_waiting_room`

未在当前 `schedule_meeting` 文档中确认的自动录制、自动静音、自动关摄像头、提前入会等，不会作为假功能提交给腾讯 MCP。

## 3. 安装

需要 Node.js 20+。

```bash
npm install
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

然后编辑 `.env`：

```env
PORT=3000
HOST=0.0.0.0
TIMEZONE=Asia/Shanghai
TENCENT_MEETING_TOKEN=你的真实Token
TENCENT_MCP_URL=https://mcp.meeting.tencent.com/mcp/wemeet-open/v1
TENCENT_MCP_SKILL_VERSION=v1.0.11
TENCENT_MCP_PROTOCOL_VERSION=2025-06-18
TENCENT_MCP_TIMEOUT_MS=20000
ADMIN_USERNAME=admin
ADMIN_PASSWORD=请改成强密码
ADMIN_SESSION_SECRET=请生成至少32位随机字符串
```

启动：

```bash
npm start
```

浏览器：

```text
http://localhost:3000
```

管理员：

```text
http://localhost:3000/admin/login
```

## 4. 先测试 MCP

进入管理员后台，点击“测试腾讯会议连接”。成功后再在首页创建一场测试会议。

还可以直接检查 Node 语法：

```bash
npm run check
```

## 5. Windows 本地运行

PowerShell：

```powershell
cd C:\path\to\tencent-meeting-booking
npm install
Copy-Item .env.example .env
notepad .env
npm start
```

建议不要把真实 Token 粘到聊天工具、代码仓库或前端代码中。

## 6. Linux + PM2

```bash
sudo apt update
sudo apt install -y nginx
cd /opt
sudo mkdir -p tencent-meeting-booking
sudo chown $USER:$USER tencent-meeting-booking
cd tencent-meeting-booking
# 上传项目文件
npm install --omit=dev
cp .env.example .env
nano .env
npm install -g pm2
pm2 start backend/server.js --name tencent-meeting-booking
pm2 save
pm2 startup
```

## 7. Nginx

编辑 `/etc/nginx/sites-available/tencent-meeting-booking`：

```nginx
server {
    listen 80;
    server_name meeting.example.com;

    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

启用：

```bash
sudo ln -s /etc/nginx/sites-available/tencent-meeting-booking /etc/nginx/sites-enabled/tencent-meeting-booking
sudo nginx -t
sudo systemctl reload nginx
```

建议再配 HTTPS，例如使用 Certbot。

## 8. 目录

```text
tencent-meeting-booking/
├── backend/
│   ├── server.js
│   ├── routes/
│   │   ├── meetings.js
│   │   ├── system.js
│   │   └── settings.js
│   ├── services/
│   │   └── tencentMeeting.js
│   ├── database/
│   │   └── database.js
│   └── utils/
│       └── auth.js
├── frontend/
│   ├── index.html
│   ├── history.html
│   ├── login.html
│   ├── admin.html
│   ├── css/style.css
│   └── js/
│       ├── app.js
│       ├── history.js
│       ├── login.js
│       └── admin.js
├── data/
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## 9. API

```text
POST   /api/meetings
GET    /api/meetings
GET    /api/meetings/:id
PUT    /api/meetings/:id            (admin)
DELETE /api/meetings/:id            (admin，仅失败/取消记录)
POST   /api/meetings/:id/cancel     (admin)
GET    /api/system/status
POST   /api/system/test-tencent     (admin)
GET    /api/settings/invite-template
PUT    /api/settings/invite-template (admin)
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me
```

统一格式：

```json
{"success":true,"data":{},"message":""}
```

## 10. Token 安全

- Token 只从 `process.env.TENCENT_MEETING_TOKEN` 读取。
- 浏览器从不会收到完整 Token。
- 浏览器 localStorage 不保存 Token。
- Git 忽略 `.env`。
- 日志中对 Token 做脱敏。
- 管理后台只显示“Token 已配置/未配置”。

## 11. 一个重要限制

本项目没有把“远程 MCP”误当成普通 REST API。腾讯当前文档说明 MCP 完整的工具 Schema 位于 Skill 包的 `api_references.md`。因此代码只使用已经公开确认的工具名与参数，并把 MCP URL / Skill 版本做成可配置项。

若腾讯后续更新 Skill 版本，优先以腾讯官方 MCP 文档/Skill 包中的 `config.json` 和 `api_references.md` 为准，更新 `.env` 中的 `TENCENT_MCP_SKILL_VERSION`，不要在前端改任何 Token 逻辑。

## Windows note

`setup-windows.cmd` intentionally contains ASCII-only text so that Windows CMD code pages do not garble the setup script. Do not run an older `setup-windows.bat` from a previous ZIP.


### Windows setup note
The Windows setup script uses `call npm ...` because `npm` is itself a `.cmd` launcher on Windows and a batch script must use `call` to return to the parent script.
