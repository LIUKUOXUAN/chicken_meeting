// backend/utils/auth.js

// 管理员会话：HMAC-SHA256 签名 token，放在 HttpOnly Cookie 中。
// Worker 环境使用 Web Crypto 替代 Node crypto。

import { getEnv } from './env.js';

export const COOKIE_NAME = 'tm_admin';
export const SESSION_MAX_AGE = 8 * 60 * 60;

let hmacKeyPromise = null;

function secret() {
  const value = getEnv('ADMIN_SESSION_SECRET', '');
  if (!value || value.length < 16) {
    throw new Error('ADMIN_SESSION_SECRET 未配置或过短');
  }
  return value;
}

function getHmacKey() {
  if (!hmacKeyPromise) {
    const raw = new TextEncoder().encode(secret());
    hmacKeyPromise = crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  }
  return hmacKeyPromise;
}

function base64UrlEncode(bytes) {
  const bin = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < bin.length; i += 1) s += String.fromCharCode(bin[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  let s = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** 固定时间比较，防止时序侧信道 */
function timingSafeEqualBytes(a, b) {
  const ua = a instanceof Uint8Array ? a : new Uint8Array(a);
  const ub = b instanceof Uint8Array ? b : new Uint8Array(b);
  if (ua.length !== ub.length) return false;
  let diff = 0;
  for (let i = 0; i < ua.length; i += 1) diff |= ua[i] ^ ub[i];
  return diff === 0;
}

async function sign(payload) {
  const key = await getHmacKey();
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return base64UrlEncode(new Uint8Array(sig));
}

export async function issueSession(username) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const payload = `${username}.${exp}`;
  return `${base64UrlEncode(new TextEncoder().encode(payload))}.${await sign(payload)}`;
}

async function verifySession(value) {
  try {
    if (!value) return false;
    const [encoded, sig] = String(value).split('.');
    if (!encoded || !sig) return false;
    const payload = new TextDecoder().decode(base64UrlDecode(encoded));
    const expected = await sign(payload);
    if (!timingSafeEqualBytes(base64UrlDecode(sig), base64UrlDecode(expected))) return false;
    const lastDot = payload.lastIndexOf('.');
    const username = payload.slice(0, lastDot);
    const exp = Number(payload.slice(lastDot + 1));
    return Boolean(username) && Number.isFinite(exp) && exp > Math.floor(Date.now() / 1000) && username === (getEnv('ADMIN_USERNAME', 'admin'));
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

export async function isAdmin(request) {
  const cookies = parseCookies(request.headers.get('cookie') || '');
  return verifySession(cookies[COOKIE_NAME]);
}

export function loginCookieValue(token, secureFlag = false) {
  // 本地 wrangler dev 走 http://127.0.0.1，不能带 Secure，否则浏览器拒绝存储
  const secure = secureFlag ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE}${secure}`;
}

export function clearCookieValue() {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

export async function validateLogin(username, password) {
  const expectedUser = getEnv('ADMIN_USERNAME', 'admin');
  const expectedPassword = getEnv('ADMIN_PASSWORD', '');
  if (!expectedPassword) return false;
  const userOk = username === expectedUser;
  const a = new TextEncoder().encode(String(password || ''));
  const b = new TextEncoder().encode(expectedPassword);
  const passOk = timingSafeEqualBytes(a, b);
  return userOk && passOk;
}
