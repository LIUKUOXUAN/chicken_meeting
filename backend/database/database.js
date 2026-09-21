// backend/database/database.js

/**
 * 封装 Cloudflare D1 数据库操作，提供与旧版 better-sqlite3 层相同的接口。
 * 所有方法均为异步。表结构见项目根目录 schema.sql。
 */

export function createDbAdapter(env) {
    const db = env.DB; // 对应 wrangler.json 中绑定的 "DB"

    async function all(query, params = []) {
        const stmt = db.prepare(query).bind(...params);
        const { results } = await stmt.all();
        return results || [];
    }

    async function first(query, params = []) {
        const stmt = db.prepare(query).bind(...params);
        return await stmt.first();
    }

    async function run(query, params = []) {
        const stmt = db.prepare(query).bind(...params);
        return await stmt.run();
    }

    /** 动态计算会议状态（upcoming/ongoing/ended），取消与失败记录保持原状 */
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

    async function findConflict(startTs, endTs, excludeId = null) {
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
        const rows = await all(sql, params);
        return rows.map(enrichMeeting);
    }

    async function listMeetings({ limit = 100, offset = 0, status = 'all' } = {}) {
        const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
        const safeOffset = Math.max(Number(offset) || 0, 0);
        let sql = 'SELECT * FROM meetings';
        const params = [];
        if (status && status !== 'all' && ['upcoming', 'ongoing', 'ended', 'canceled', 'failed', 'provisioning'].includes(status)) {
            if (status === 'upcoming' || status === 'ongoing' || status === 'ended') {
                // 动态状态在取出后计算，因为当前时间并不存储在表中
                sql += ' WHERE status NOT IN (\'canceled\', \'failed\')';
            } else {
                sql += ' WHERE status = ?';
                params.push(status);
            }
        }
        sql += ' ORDER BY start_ts DESC LIMIT ? OFFSET ?';
        params.push(safeLimit, safeOffset);
        const rows = (await all(sql, params)).map(enrichMeeting);
        return status === 'all' || status === 'canceled' || status === 'failed' || status === 'provisioning'
            ? rows
            : rows.filter(r => r.status === status);
    }

    async function getMeeting(id) {
        const row = await first('SELECT * FROM meetings WHERE id = ?', [id]);
        return enrichMeeting(row);
    }

    async function getByIdempotencyKey(key) {
        const row = await first('SELECT * FROM meetings WHERE idempotency_key = ?', [key]);
        return enrichMeeting(row);
    }

    async function createReservation(row) {
        const existingRow = await getByIdempotencyKey(row.idempotency_key);
        if (existingRow) return existingRow;
        try {
            const info = await run(`
        INSERT INTO meetings (
          subject, organizer, start_time, end_time, start_ts, end_ts, duration,
          description, password, status, only_user_join_type, auto_in_waiting_room,
          time_zone, idempotency_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'provisioning', ?, ?, ?, ?)
      `, [
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
                row.idempotency_key
            ]);
            return getMeeting(Number(info.meta.last_row_id));
        } catch (error) {
            // 并发下幂等键唯一约束冲突：返回已存在的那条记录
            const existing = await getByIdempotencyKey(row.idempotency_key);
            if (existing) return existing;
            throw error;
        }
    }

    async function updateMeetingFromRemote(id, remote) {
        await run(`
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
    `, [
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
        ]);
        return getMeeting(id);
    }

    async function markFailed(id, message, trace = null) {
        await run(`
      UPDATE meetings
      SET status = 'failed', last_error = ?, remote_trace = COALESCE(?, remote_trace), updated_at = datetime('now')
      WHERE id = ?
    `, [message, trace, id]);
        return getMeeting(id);
    }

    async function markCanceled(id, trace = null) {
        await run(`
      UPDATE meetings SET status = 'canceled', remote_trace = COALESCE(?, remote_trace), updated_at = datetime('now')
      WHERE id = ?
    `, [trace, id]);
        return getMeeting(id);
    }

    async function applyLocalUpdate(id, values) {
        await run(`
      UPDATE meetings SET
        subject = ?, organizer = ?, start_time = ?, end_time = ?, start_ts = ?, end_ts = ?, duration = ?,
        description = ?, updated_at = datetime('now')
      WHERE id = ?
    `, [values.subject, values.organizer, values.start_time, values.end_time, values.start_ts, values.end_ts, values.duration, values.description || '', id]);
        return getMeeting(id);
    }

    async function deleteMeeting(id) {
        const info = await run('DELETE FROM meetings WHERE id = ?', [id]);
        return (info.meta.changes || 0) > 0;
    }

    async function getSetting(key) {
        const row = await first('SELECT value FROM settings WHERE key = ?', [key]);
        return row && row.value != null ? row.value : null;
    }

    async function setSetting(key, value) {
        await run(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
    `, [key, value]);
        return getSetting(key);
    }

    return {
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
}
