-- 会议数据表
CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    meeting_id TEXT,
    subject TEXT,
    start_time INTEGER,
    end_time INTEGER,
    status TEXT,
    created_at INTEGER
);

-- 系统设置与配置表
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);