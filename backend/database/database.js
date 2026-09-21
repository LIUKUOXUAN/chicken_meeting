const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const root = path.resolve(__dirname, '..', '..');
const dataDir = path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DATABASE_PATH || path.join(dataDir, 'meetings.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'user',
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id TEXT,
  meeting_code TEXT,
  meeting_url TEXT,
  subject TEXT NOT NULL,
  organizer TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  start_ts INTEGER NOT NULL,
  end_ts INTEGER NOT NULL,
  duration INTEGER NOT NULL,
  description TEXT,
  password TEXT,
  status TEXT NOT NULL DEFAULT 'provisioning',
  only_user_join_type INTEGER,
  auto_in_waiting_room INTEGER,
  time_zone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  created_by_user_id INTEGER,
  idempotency_key TEXT UNIQUE,
  remote_trace TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CHECK(end_ts > start_ts),
  CHECK(duration > 0)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_meetings_time ON meetings(start_ts, end_ts);
CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);
`);

const defaultTemplate = `【腾讯会议邀请】

会议主题：{{subject}}

会议时间：{{start_time}} - {{end_time}}

会议时长：{{duration}}

会议号：{{meeting_code}}

入会链接：
{{meeting_url}}

会议说明：
{{description}}

预约人：{{organizer}}`;

const existing = db.prepare('SELECT value FROM settings WHERE key = ?').get('invite_template');
if (!existing) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('invite_template', defaultTemplate);
}

function meetingStatus(startTs, endTs, storedStatus) {
  if (storedStatus === 'canceled' || storedStatus === 'failed') return storedStatus;
  if (storedStatus === 'provisioning') return 'provisioning';
  const now = Math.floor(Date.now() / 1000);
  if (now < startTs) return 'upcoming';
  if (now < endTs) return 'ongoing';
  return 'ended';
}

function enrichMeeting(row) {
  if (!row) return null;
  return { ...row, status: meetingStatus(row.start_ts, row.end_ts, row.status) };
}

function findConflict(startTs, endTs, excludeId = null) {
  let sql = `
    SELECT * FROM meetings
    WHERE status NOT IN ('canceled', 'failed')
      AND start_ts < ?
      AND end_ts > ?`;
  const params = [endTs, startTs];
  if (excludeId !== null) {
    sql += ' AND id <> ?';
    params.push(excludeId);
  }
  sql += ' ORDER BY start_ts ASC LIMIT 10';
  return db.prepare(sql).all(...params).map(enrichMeeting);
}

function listMeetings({ limit = 100, offset = 0, status = 'all' } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  let sql = 'SELECT * FROM meetings';
  const params = [];
  if (status && status !== 'all' && ['upcoming', 'ongoing', 'ended', 'canceled', 'failed', 'provisioning'].includes(status)) {
    if (status === 'upcoming' || status === 'ongoing' || status === 'ended') {
      // Dynamic status is calculated after retrieval because current time is not stored.
      sql += ' WHERE status NOT IN (\'canceled\', \'failed\')';
    } else {
      sql += ' WHERE status = ?';
      params.push(status);
    }
  }
  sql += ' ORDER BY start_ts DESC LIMIT ? OFFSET ?';
  params.push(safeLimit, safeOffset);
  const rows = db.prepare(sql).all(...params).map(enrichMeeting);
  return status === 'all' || status === 'canceled' || status === 'failed' || status === 'provisioning'
    ? rows
    : rows.filter(r => r.status === status);
}

function getMeeting(id) {
  return enrichMeeting(db.prepare('SELECT * FROM meetings WHERE id = ?').get(id));
}

function getByIdempotencyKey(key) {
  return enrichMeeting(db.prepare('SELECT * FROM meetings WHERE idempotency_key = ?').get(key));
}

function createReservation(row) {
  const tx = db.transaction(() => {
    const existingRow = getByIdempotencyKey(row.idempotency_key);
    if (existingRow) return existingRow;
    const info = db.prepare(`
      INSERT INTO meetings (
        subject, organizer, start_time, end_time, start_ts, end_ts, duration,
        description, password, status, only_user_join_type, auto_in_waiting_room,
        time_zone, created_by_user_id, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'provisioning', ?, ?, ?, ?, ?)
    `).run(
      row.subject,
      row.organizer,
      row.start_time,
      row.end_time,
      row.start_ts,
      row.end_ts,
      row.duration,
      row.description || '',
      row.password || null,
      row.only_user_join_type == null ? null : row.only_user_join_type,
      row.auto_in_waiting_room == null ? null : Number(row.auto_in_waiting_room),
      row.time_zone,
      row.created_by_user_id || null,
      row.idempotency_key
    );
    return getMeeting(info.lastInsertRowid);
  });
  return tx();
}

function updateMeetingFromRemote(id, remote) {
  db.prepare(`
    UPDATE meetings SET
      meeting_id = ?,
      meeting_code = ?,
      meeting_url = ?,
      subject = ?,
      start_time = ?,
      end_time = ?,
      start_ts = ?,
      end_ts = ?,
      duration = ?,
      status = 'active',
      remote_trace = ?,
      last_error = NULL,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    remote.meeting_id || null,
    remote.meeting_code || null,
    remote.meeting_url || null,
    remote.subject,
    remote.start_time,
    remote.end_time,
    remote.start_ts,
    remote.end_ts,
    remote.duration,
    remote.trace || null,
    id
  );
  return getMeeting(id);
}

function markFailed(id, message, trace = null) {
  db.prepare(`
    UPDATE meetings
    SET status = 'failed', last_error = ?, remote_trace = COALESCE(?, remote_trace), updated_at = datetime('now')
    WHERE id = ?
  `).run(message, trace, id);
  return getMeeting(id);
}

function markCanceled(id, trace = null) {
  db.prepare(`
    UPDATE meetings SET status = 'canceled', remote_trace = COALESCE(?, remote_trace), updated_at = datetime('now')
    WHERE id = ?
  `).run(trace, id);
  return getMeeting(id);
}

function applyLocalUpdate(id, values) {
  db.prepare(`
    UPDATE meetings SET
      subject = ?, organizer = ?, start_time = ?, end_time = ?, start_ts = ?, end_ts = ?, duration = ?,
      description = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(values.subject, values.organizer, values.start_time, values.end_time, values.start_ts, values.end_ts, values.duration, values.description || '', id);
  return getMeeting(id);
}

function deleteMeeting(id) {
  const info = db.prepare('DELETE FROM meetings WHERE id = ?').run(id);
  return info.changes > 0;
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key); return row && row.value != null ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
  `).run(key, value);
  return getSetting(key);
}

module.exports = {
  db,
  findConflict,
  listMeetings,
  getMeeting,
  getByIdempotencyKey,
  createReservation,
  updateMeetingFromRemote,
  markFailed,
  markCanceled,
  applyLocalUpdate,
  deleteMeeting,
  getSetting,
  setSetting
};
