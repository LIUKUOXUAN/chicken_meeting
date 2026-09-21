require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const db = require('./database/database');
const meetingsRouter = require('./routes/meetings');
const systemRouter = require('./routes/system');
const settingsRouter = require('./routes/settings');
const { setLoginCookie, clearLoginCookie, validateLogin, isAdmin } = require('./utils/auth');

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';

app.disable('x-powered-by');
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));

// Lightweight in-memory rate limit for the v1 public booking endpoint/login.
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const item = buckets.get(key);
  if (!item || now - item.windowStart >= windowMs) {
    buckets.set(key, { windowStart: now, count: 1 });
    return true;
  }
  item.count += 1;
  return item.count <= max;
}

app.use((req, res, next) => {
  if (req.path === '/api/meetings' && req.method === 'POST') {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!rateLimit(`booking:${ip}`, 20, 60_000)) return res.status(429).json({ success: false, data: null, message: '请求过于频繁，请稍后再试' });
  }
  next();
});

app.post('/api/auth/login', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!rateLimit(`login:${ip}`, 10, 60_000)) return res.status(429).json({ success: false, data: null, message: '登录尝试过于频繁，请稍后再试' });
  const username = String(req.body && req.body.username || '').trim();
  const password = String(req.body && req.body.password || '');
  if (!validateLogin(username, password)) return res.status(401).json({ success: false, data: null, message: '用户名或密码错误' });
  setLoginCookie(res, username);
  return res.json({ success: true, data: { username }, message: '登录成功' });
});

app.post('/api/auth/logout', (req, res) => {
  clearLoginCookie(res);
  res.json({ success: true, data: null, message: '已退出登录' });
});

app.get('/api/auth/me', (req, res) => {
  res.json({ success: true, data: { is_admin: isAdmin(req) }, message: '' });
});

app.use('/api/meetings', meetingsRouter);
app.use('/api/system', systemRouter);
app.use('/api/settings', settingsRouter);

const frontendDir = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendDir, { extensions: ['html'] }));

app.get('/admin/login', (req, res) => res.sendFile(path.join(frontendDir, 'login.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(frontendDir, 'admin.html')));
app.get('/history', (req, res) => res.sendFile(path.join(frontendDir, 'history.html')));
app.get('*', (req, res) => res.sendFile(path.join(frontendDir, 'index.html')));

app.use((err, req, res, next) => {
  console.error('[Server]', err);
  if (res.headersSent) return next(err);
  return res.status(500).json({ success: false, data: null, message: '服务器内部错误' });
});

app.listen(port, host, () => {
  console.log(`Tencent Meeting Booking running at http://${host}:${port}`);
  console.log(`Database: ${path.join(path.dirname(db.db.name || ''), path.basename(db.db.name || 'meetings.db'))}`);
});
