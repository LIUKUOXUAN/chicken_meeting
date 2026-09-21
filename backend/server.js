// backend/server.js

// 腾讯会议预约网站 —— Cloudflare Worker 入口
// 同时提供 REST API（/api/*）与前端静态页面（frontend/ 目录，经 ASSETS 绑定托管）。

import { createDbAdapter } from './database/database.js';
import { routeAuth } from './routes/auth.js';
import { routeMeetings } from './routes/meetings.js';
import { routeSystem } from './routes/system.js';
import { routeSettings } from './routes/settings.js';
import { rateLimit } from './utils/rateLimit.js';
import { setWorkerEnv } from './utils/env.js';

// 特殊页面直接打包进 Worker（ASSETS 会把 *.html 请求 307 重定向为无扩展名路径，无法用于页面别名映射）。
// / 首页与 css/js 等静态资源仍由 ASSETS 自动托管。
import adminHtml from '../frontend/admin.html';
import loginHtml from '../frontend/login.html';
import historyHtml from '../frontend/history.html';

const PAGE_HTML = {
  '/admin': adminHtml,
  '/admin/': adminHtml,
  '/admin/login': loginHtml,
  '/history': historyHtml
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer'
};

export default {
  async fetch(request, env) {
    setWorkerEnv(env);
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // 预检 OPTIONS 请求
    if (method === 'OPTIONS') {
      return new Response(null, { headers: { ...CORS_HEADERS, ...SECURITY_HEADERS } });
    }

    try {
      // 公开预约接口的轻量限流（与旧版一致：每 IP 每分钟 20 次）
      if (path === '/api/meetings' && method === 'POST') {
        const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
        if (!rateLimit(`booking:${ip}`, 20, 60_000)) {
          return new Response(JSON.stringify({ success: false, data: null, message: '请求过于频繁，请稍后再试' }), {
            status: 429,
            headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...SECURITY_HEADERS }
          });
        }
      }

      // API 路由分发
      if (path.startsWith('/api/')) {
        const db = createDbAdapter(env);
        const ctx = { method, request, env, db, url, path };

        let response = null;
        if (path.startsWith('/api/auth')) response = await routeAuth(ctx);
        else if (path.startsWith('/api/meetings')) response = await routeMeetings(ctx);
        else if (path.startsWith('/api/system')) response = await routeSystem(ctx);
        else if (path.startsWith('/api/settings')) response = await routeSettings(ctx);

        if (!response) {
          response = new Response(JSON.stringify({ error: 'Not Found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          });
        }

        // 统一附加 CORS 与安全头（保留业务层设置的 Set-Cookie 等头）
        const headers = new Headers(response.headers);
        Object.entries(CORS_HEADERS).forEach(([k, v]) => { if (!headers.has(k)) headers.set(k, v); });
        Object.entries(SECURITY_HEADERS).forEach(([k, v]) => { if (!headers.has(k)) headers.set(k, v); });
        return new Response(response.body, { status: response.status, headers });
      }

      // 静态页面：run_worker_first 模式下所有非 API 请求都经过这里
      const pageHtml = PAGE_HTML[path];
      if (pageHtml) {
        return new Response(pageHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS } });
      }
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error('[Server]', err);
      return new Response(JSON.stringify({ success: false, data: null, message: '服务器内部错误' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...SECURITY_HEADERS }
      });
    }
  }
};
