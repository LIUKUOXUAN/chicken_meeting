# 腾讯会议预约中心：Windows Server 2008 R2 + Node.js 12 兼容版

此版本用于旧版 Windows Server 2008 R2。服务器端代码已移除 Node.js 14+ 才支持的可选链/空值合并，并将 Node12 不支持的 `crypto.randomUUID()`、`Buffer` 的 base64url 以及 Node18+ `fetch` 改为兼容实现。

## 运行环境
- Windows Server 2008 R2 x64
- Node.js 12.22.12 x64 portable
- npm 6.x
- Express 4.x
- better-sqlite3 7.6.2

## 安装
1. 将 Node.js 12.22.12 x64 解压到 `D:\nodejs`，确保存在 `D:\nodejs\node.exe`。
2. 将本项目解压到 `D:\tencent-meeting-booking`。
3. 在 CMD 中执行：

```cmd
set PATH=D:\nodejs;%PATH%
cd /d D:\tencent-meeting-booking
setup-windows-server-2008-r2.cmd
```

4. 编辑 `.env`，至少设置：

```env
PORT=3000
HOST=0.0.0.0
TIMEZONE=Asia/Shanghai
NODE_ENV=production
TENCENT_MEETING_TOKEN=你的Token
TENCENT_MCP_URL=https://mcp.meeting.tencent.com/mcp/wemeet-open/v1
TENCENT_MCP_SKILL_VERSION=v1.0.15
TENCENT_MCP_PROTOCOL_VERSION=2025-06-18
ADMIN_USERNAME=admin
ADMIN_PASSWORD=你的管理员密码
ADMIN_SESSION_SECRET=随机长字符串
```

5. 启动：

```cmd
start-server.cmd
```

6. 公网访问测试：

`http://你的服务器公网IP:3000`

## 注意
- 不要上传或提交 `.env`。
- 前端代码仍按现代浏览器运行；`npm run check` 只检查 Node.js 服务端代码，不再用 Node12 检查浏览器脚本。
- Windows Server 2008 R2 和 Node.js 12 均已结束官方支持，建议仅用于短期测试/过渡。
