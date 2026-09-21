const crypto = require('crypto');

function base64UrlEncode(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  let s = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

const COOKIE_NAME = 'tm_admin';
const SESSION_MAX_AGE = 8 * 60 * 60;

function secret() {
  const value = process.env.ADMIN_SESSION_SECRET;
  if (!value || value.length < 16) {
    throw new Error('ADMIN_SESSION_SECRET 未配置或过短');
  }
  return value;
}

function digestBase64Url(hmac) {
  return base64UrlEncode(hmac.digest());
}

function sign(payload) {
  return digestBase64Url(crypto.createHmac('sha256', secret()).update(payload));
}

function issueSession(username) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const payload = `${username}.${exp}`;
  return `${base64UrlEncode(Buffer.from(payload, 'utf8'))}.${sign(payload)}`;
}

function verifySession(value) {
  try {
    if (!value) return false;
    const [encoded, sig] = String(value).split('.');
    if (!encoded || !sig) return false;
    const payload = base64UrlDecode(encoded).toString('utf8');
    const expected = sign(payload);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    const lastDot = payload.lastIndexOf('.');
    const username = payload.slice(0, lastDot);
    const exp = Number(payload.slice(lastDot + 1));
    return Boolean(username) && Number.isFinite(exp) && exp > Math.floor(Date.now() / 1000) && username === (process.env.ADMIN_USERNAME || 'admin');
  } catch {
    return false;
  }
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(p => p.trim()).filter(Boolean).map(pair => {
    const index = pair.indexOf('=');
    return index === -1 ? [pair, ''] : [pair.slice(0, index), decodeURIComponent(pair.slice(index + 1))];
  }));
}

function isAdmin(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return verifySession(cookies[COOKIE_NAME]);
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) {
    return res.status(401).json({ success: false, data: null, message: '需要管理员登录' });
  }
  next();
}

function setLoginCookie(res, username) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(issueSession(username))}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE}${secure}`);
}

function clearLoginCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

function validateLogin(username, password) {
  const expectedUser = process.env.ADMIN_USERNAME || 'admin';
  const expectedPassword = process.env.ADMIN_PASSWORD || '';
  if (!expectedPassword) return false;
  const userOk = username === expectedUser;
  const a = Buffer.from(String(password || ''));
  const b = Buffer.from(expectedPassword);
  const passOk = a.length === b.length && crypto.timingSafeEqual(a, b);
  return userOk && passOk;
}

module.exports = { requireAdmin, isAdmin, setLoginCookie, clearLoginCookie, validateLogin };
