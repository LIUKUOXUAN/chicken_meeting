function publicMeeting(row) {
  if (!row) return null;
  return {
    id: row.id,
    meeting_id: row.meeting_id,
    meeting_code: row.meeting_code,
    meeting_url: row.meeting_url,
    subject: row.subject,
    organizer: row.organizer,
    start_time: row.start_time,
    end_time: row.end_time,
    start_ts: row.start_ts,
    end_ts: row.end_ts,
    duration: row.duration,
    duration_text: formatDuration(row.duration),
    description: row.description || '',
    status: row.status,
    time_zone: row.time_zone,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function adminMeeting(row) {
  return publicMeeting(row);
}

function conflictList(rows) {
  return Array.isArray(rows) ? rows.map(publicMeeting) : [];
}

function formatDuration(seconds) {
  const totalMinutes = Math.max(0, Math.round(Number(seconds || 0) / 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h && m) return `${h}小时${m}分钟`;
  if (h) return `${h}小时`;
  return `${m}分钟`;
}

module.exports = { publicMeeting, adminMeeting, conflictList, formatDuration };
