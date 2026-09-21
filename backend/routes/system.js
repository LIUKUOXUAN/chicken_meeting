// backend/routes/system.js

// 系统状态路由（Cloudflare Worker 版）

import { DateTime } from 'luxon';
import { isAdmin } from '../utils/auth.js';
import { testConnection } from '../services/tencentMeeting.js';
import { responseOk, responseFail } from '../utils/http.js';
import { getEnv } from '../utils/env.js';

/**
 * @param {{ method: string, request: Request, env: any, db: object, url: URL, path: string }} ctx
 * @returns {Promise<Response|null>}
 */
export async function routeSystem(ctx) {
  const { method, request, db, path } = ctx;
  const rest = path.slice('/api/system'.length).replace(/^\/+|\/+$/g, '');

  // GET /api/system/status
  if (method === 'GET' && rest === 'status') {
    return responseOk({
      token_configured: Boolean(getEnv('TENCENT_MEETING_TOKEN', '')),
      mcp_url: getEnv('TENCENT_MCP_URL', 'https://mcp.meeting.tencent.com/mcp/wemeet-open/v1'),
      time_zone: getEnv('TIMEZONE', 'Asia/Shanghai'),
      admin_logged_in: await isAdmin(request),
      database: db ? 'ok' : 'unavailable'
    });
  }

  // GET /api/system/stats（管理员）
  if (method === 'GET' && rest === 'stats') {
    if (!(await isAdmin(request))) return responseFail(401, '需要管理员登录');
    const zone = getEnv('TIMEZONE', 'Asia/Shanghai');
    const now = DateTime.now().setZone(zone);
    const dayStart = now.startOf('day').toSeconds();
    const dayEnd = now.endOf('day').toSeconds();
    const weekStart = now.startOf('week').toSeconds();
    const all = await db.listMeetings({ status: 'all', limit: 500, offset: 0 });
    const active = all.filter((m) => !['canceled', 'failed'].includes(m.status));

    return responseOk({
      today: active.filter((m) => m.start_ts >= dayStart && m.start_ts <= dayEnd).length,
      week: active.filter((m) => m.start_ts >= weekStart).length,
      upcoming: active.filter((m) => m.status === 'upcoming').length,
      ended: active.filter((m) => m.status === 'ended').length,
      time_zone: zone
    });
  }

  // POST /api/system/test-tencent（管理员）
  if (method === 'POST' && rest === 'test-tencent') {
    if (!(await isAdmin(request))) return responseFail(401, '需要管理员登录');
    try {
      const result = await testConnection();
      return responseOk(result, '腾讯会议连接正常');
    } catch (error) {
      console.error('[Tencent MCP] connection test failed:', error.message, error.details);
      return responseFail(502, error.code === 'TIMEOUT' ? '腾讯会议服务响应超时' : '腾讯会议连接失败');
    }
  }

  return null;
}
