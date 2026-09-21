# 腾讯会议预约网站 - Windows Server 2008 R2 + Node.js 12 兼容版

## 为什么不能用 Node.js 14 MSI
Windows Server 2008 R2 会被较新的 Node.js MSI 安装程序判定为不受支持。因此本项目使用 **Node.js v12.22.12 x64 ZIP 便携版**。Node 12 已经 EOL，仅建议用于这台旧服务器的测试/短期使用。

## Node.js 安装
1. 在 Windows 11 下载官方 ZIP：
   https://nodejs.org/download/release/v12.22.12/
2. 下载 `node-v12.22.12-win-x64.zip`。
3. 在服务器创建：`C:\nodejs`。
4. 将 ZIP 内的内容全部解压到 `C:\nodejs`。
5. 确认存在：`C:\nodejs\node.exe` 和 `C:\nodejs\npm.cmd`。

不需要运行 MSI。

## 项目部署
把项目解压到例如：
`D:\tencent-meeting-booking`

在 CMD 中：
```cmd
D:\tencent-meeting-booking
setup-windows-server-2008-r2.cmd
```

初始化脚本会自动加入 `C:\nodejs` 到本次进程 PATH，并安装兼容 Node 12 的依赖：
- better-sqlite3 7.6.2
- helmet 5.1.0
- luxon 2.5.2
- express 4.22.1

## 配置
编辑 `.env`：
```env
PORT=3000
HOST=0.0.0.0
TIMEZONE=Asia/Shanghai
NODE_ENV=production
TENCENT_MEETING_TOKEN=你的Token
TENCENT_MCP_URL=https://mcp.meeting.tencent.com/mcp/wemeet-open/v1
TENCENT_MCP_SKILL_VERSION=v1.0.15
TENCENT_MCP_PROTOCOL_VERSION=2025-06-18
TENCENT_MCP_TIMEOUT_MS=20000
ADMIN_USERNAME=admin
ADMIN_PASSWORD=你的管理员密码
ADMIN_SESSION_SECRET=至少16位随机字符串
```

## 启动
双击 `start-server.cmd` 或在 CMD 执行：
```cmd
start-server.cmd
```

## 公网测试
在 Windows 防火墙允许 TCP 3000 后，从外部浏览器访问：
`http://你的服务器公网IP:3000`

## 自动启动
确认网站功能全部正常后，右键以管理员身份运行：
`install-autostart.cmd`

它会创建 Windows 计划任务 `TencentMeetingBooking`，服务器启动后自动运行网站。

## 安全提示
- 不要公开 `.env`。
- Token 不要上传到 GitHub/网盘。
- Windows Server 2008 R2 与 Node 12 均已 EOL，正式长期公网使用建议迁移到受支持的 Windows/Linux 系统并启用 HTTPS。
