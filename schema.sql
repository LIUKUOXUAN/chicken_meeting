-- Cloudflare D1 数据库结构（与旧版 SQLite 结构对齐）
-- 建表：npx wrangler d1 execute chicken_meeting_db --remote --file=schema.sql

-- 会议预约表
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
    idempotency_key TEXT UNIQUE,
    remote_trace TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK(end_ts > start_ts),
    CHECK(duration > 0)
);

-- 系统设置表（邀请模板等）
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_meetings_time ON meetings(start_ts, end_ts);
CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);

-- 默认邀请模板
INSERT OR IGNORE INTO settings (key, value) VALUES (
    'invite_template',
    '【腾讯会议邀请】

会议主题：{{subject}}

会议时间：{{start_time}} - {{end_time}}

会议时长：{{duration}}

会议号：{{meeting_code}}

入会链接：
{{meeting_url}}

会议说明：
{{description}}

预约人：{{organizer}}'
);
