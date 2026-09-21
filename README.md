# 腾讯会议多人预约网站（Cloudflare Worker + D1）

一个"普通用户无需腾讯会议账号，由统一的腾讯会议个人专业版账号创建会议"的完整 Web 项目。

**云端架构**：后端与前端静态页面全部托管在单个 Cloudflare Worker 上，数据存储在 Cloudflare D1（SQLite）。无需自建服务器，本地不保存任何运行数据。

```
浏览器 → Cloudflare Worker（前端静态页面 + /api 接口）→ 腾讯会议 Remote MCP
                                              ↘ Cloudflare D1（预约记录）
```

## 1. 已实现功能

- 普通用户免腾讯会议登录直接预约
- 主题、预约人、开始/结束时间、会议说明
- "设置结束时间 / 设置会议时长"双模式
- 实时计算时长、跨天会议与非法时间校验
- Asia/Shanghai 时间统一处理
- 后端二次冲突检测
- D1 预约记录 + 请求幂等键 + provisioning 状态，降低重复创建风险
- 腾讯会议 `schedule_meeting` 真正调用
- 创建后自动补查 `get_meeting` / `get_meeting_by_code` 获取会议号、链接
- 自动生成邀请文字、复制邀请/链接/会议号
- 历史会议、管理员登录、修改/取消/删除失败记录
- 邀请模板管理、腾讯会议连接测试
- Token 永不返回前端

## 2. 云端部署（一次性）

```bash
npm install

# 1. 初始化 D1 表结构（远程）
npx wrangler d1 execute chicken_meeting_db --remote --file=schema.sql

# 2. 设置机密（需要腾讯会议 Token 与管理员密码）
npx wrangler secret put TENCENT_MEETING_TOKEN
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put ADMIN_SESSION_SECRET   # 至少 32 位随机字符串，可临时生成：node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"

# 3. 部署
npm run deploy
```

部署完成后访问 `https://chicken-meeting-backend.<你的账户>.workers.dev`，管理员入口 `/admin/login`。

非机密配置（MCP 地址、Skill 版本、时区、管理员用户名）已写在 `wrangler.json` 的 `vars` 中。

## 3. 本地开发

```bash
npm install
npx wrangler d1 execute chicken_meeting_db --local --file=schema.sql
# 创建 .dev.vars 填入本地测试值（见 .gitignore，不会提交）：
#   TENCENT_MEETING_TOKEN=...  ADMIN_PASSWORD=...  ADMIN_SESSION_SECRET=...
npm run dev   # http://127.0.0.1:8787
```

## 4. API

```text
POST   /api/meetings
GET    /api/meetings
GET    /api/meetings/:id
PUT    /api/meetings/:id            (admin)
DELETE /api/meetings/:id            (admin，仅失败/取消记录)
POST   /api/meetings/:id/cancel     (admin)
GET    /api/system/status
GET    /api/system/stats            (admin)
POST   /api/system/test-tencent     (admin)
GET    /api/settings/invite-template
PUT    /api/settings/invite-template (admin)
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me
```

统一格式：`{"success":true,"data":{},"message":""}`

## 5. 目录结构

```text
├── backend/
│   ├── server.js                  # Worker 入口：API 分发 + 静态页面
│   ├── routes/                    # auth / meetings / system / settings 路由
│   ├── services/tencentMeeting.js # 腾讯会议 Remote MCP 客户端（fetch 版）
│   ├── database/database.js       # D1 适配器
│   └── utils/                     # auth(HMAC会话) / env / http / rateLimit / meetingView
├── frontend/                      # 静态页面（由 Worker ASSETS 托管）
├── schema.sql                     # D1 表结构 + 默认邀请模板
└── wrangler.json                  # Worker + D1 绑定 + vars 配置
```

## 6. Token 安全

- Token 只从 Worker 环境变量（`wrangler secret put`）读取
- 浏览器从不会收到完整 Token，localStorage 不保存 Token
- 日志中对 Token 做脱敏
- 管理后台只显示"Token 已配置/未配置"

## 7. 腾讯会议 MCP 说明

腾讯会议 MCP 是云端服务，官方 Skill 代理把 JSON-RPC 请求 POST 到 `mcp.meeting.tencent.com`，并在 Header 中注入 `X-Tencent-Meeting-Token` 和 `X-Skill-Version`。本项目在 Worker 中直接实现 MCP JSON-RPC 客户端。

MCP URL、Skill 版本、协议版本全部做成 `wrangler.json` 的可配置项。若腾讯后续更新 Skill 版本，优先以腾讯官方 Skill 包中的 `config.json` 和 `api_references.md` 为准，更新 `wrangler.json` 中对应变量。

## 8. 历史版本

- `README-WINDOWS-SERVER-2008-R2.md` / `README-WINDOWS-SERVER-2008-R2-NODE12-V2.md`：旧版 Windows 服务器 + Express + SQLite 的部署说明（已由云端版取代，仅存档）。
- `deploy/`、`*.cmd`：旧版 PM2 / Nginx 部署脚本（云端版不再需要）。
