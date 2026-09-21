// backend/routes/auth.js

// 管理员登录路由（Cloudflare Worker 版），会话通过 HttpOnly Cookie 维护

import { rateLimit } from '../utils/rateLimit.js';
import { isAdmin, issueSession, loginCookieValue, clearCookieValue, validateLogin } from '../utils/auth.js';
import { responseOk, responseFail, readJsonBody } from '../utils/http.js';

/**
 * @param {{ method: string, request: Request, env: any, db: object, url: URL, path: string }} ctx
 * @returns {Promise<Response|null>}
 */
export async function routeAuth(ctx) {
  const { method, request, path } = ctx;
  const rest = path.slice('/api/auth'.length).replace(/^\/+|\/+$/g, '');

  // POST /api/auth/login
  if (method === 'POST' && rest === 'login') {
    const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
    if (!rateLimit(`login:${ip}`, 10, 60_000)) return responseFail(429, '登录尝试过于频繁，请稍后再试');
    const body = await readJsonBody(request);
    const username = String(body && body.username || '').trim();
    const password = String(body && body.password || '');
    if (!(await validateLogin(username, password))) return responseFail(401, '用户名或密码错误');
    const token = await issueSession(username);
    // 非本地开发地址才加 Secure 标记（生产环境走 https）
    const hostname = new URL(request.url).hostname;
    const secure = !['127.0.0.1', 'localhost'].includes(hostname);
    return responseOk({ username }, '登录成功', { 'Set-Cookie': loginCookieValue(token, secure) });
  }

  // POST /api/auth/logout
  if (method === 'POST' && rest === 'logout') {
    return responseOk(null, '已退出登录', { 'Set-Cookie': clearCookieValue() });
  }

  // GET /api/auth/me
  if (method === 'GET' && rest === 'me') {
    return responseOk({ is_admin: await isAdmin(request) });
  }

  return null;
}
