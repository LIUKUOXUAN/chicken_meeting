// backend/routes/settings.js

// 邀请模板设置路由（Cloudflare Worker 版）

import { isAdmin } from '../utils/auth.js';
import { responseOk, responseFail, readJsonBody } from '../utils/http.js';

/**
 * @param {{ method: string, request: Request, env: any, db: object, url: URL, path: string }} ctx
 * @returns {Promise<Response|null>}
 */
export async function routeSettings(ctx) {
  const { method, request, db, path } = ctx;
  const rest = path.slice('/api/settings'.length).replace(/^\/+|\/+$/g, '');

  // GET /api/settings/invite-template
  if (method === 'GET' && rest === 'invite-template') {
    return responseOk({ template: (await db.getSetting('invite_template')) || '' });
  }

  // PUT /api/settings/invite-template（管理员）
  if (method === 'PUT' && rest === 'invite-template') {
    if (!(await isAdmin(request))) return responseFail(401, '需要管理员登录');
    const body = await readJsonBody(request);
    const template = String(body && body.template || '').trim();
    if (!template) return responseFail(400, '邀请模板不能为空');
    if (template.length > 5000) return responseFail(400, '邀请模板不能超过5000字');
    const saved = await db.setSetting('invite_template', template);
    return responseOk({ template: saved }, '邀请模板已保存');
  }

  return null;
}
