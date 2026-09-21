const express = require('express');
const { DateTime } = require('luxon');
const db = require('../database/database');
const {
  createMeeting,
  recoverCreatedMeeting,
  updateMeeting: remoteUpdate,
  cancelMeeting: remoteCancel
} = require('../services/tencentMeeting');
const { requireAdmin } = require('../utils/auth');
const { publicMeeting, conflictList } = require('../utils/meetingView');

const router = express.Router();

function responseOk(res, data, message = '') {
  return res.json({ success: true, data, message });
}

function responseFail(res, status, message, data = null) {
  return res.status(status).json({ success: false, data, message });
}

function cleanText(value, max = 500) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function parseRequest(input) {

  const timezone = process.env.TIMEZONE || 'Asia/Shanghai';

  const subject = cleanText(input.subject, 120) || '腾讯会议预约';

  const organizer = cleanText(input.organizer, 80);

  const description = cleanText(input.description, 2000);

  const startLocal = cleanText(input.start_time, 19);

  const endLocal = cleanText(input.end_time, 19);

  if (!organizer) {
    throw new Error('预约人不能为空');
  }

  if (!startLocal || !endLocal) {
    throw new Error('开始时间和结束时间不能为空');
  }

  const start = DateTime.fromFormat(
    startLocal,
    "yyyy-MM-dd'T'HH:mm",
    { zone: timezone, setZone: true }
  );

  const end = DateTime.fromFormat(
    endLocal,
    "yyyy-MM-dd'T'HH:mm",
    { zone: timezone, setZone: true }
  );

  if (!start.isValid || !end.isValid) {
    throw new Error('日期或时间格式无效，请检查输入');
  }

  if (end.toMillis() <= start.toMillis()) {
    throw new Error('结束时间必须晚于开始时间');
  }

  const startTs = Math.floor(start.toSeconds());
  const endTs = Math.floor(end.toSeconds());
  const duration = endTs - startTs;

  const password = input.password == null ? '' : String(input.password).trim();
  if (password && !/^\d{4,6}$/.test(password)) throw new Error('会议密码必须为4-6位数字');

  const onlyUserJoinType = input.only_user_join_type == null || input.only_user_join_type === ''
    ? null
    : Number(input.only_user_join_type);
  if (onlyUserJoinType != null && ![1, 2, 3].includes(onlyUserJoinType)) {
    throw new Error('入会限制参数无效');
  }

  let autoWaiting = null;
  if (input.auto_in_waiting_room != null && input.auto_in_waiting_room !== '') {
    if (typeof input.auto_in_waiting_room === 'boolean') autoWaiting = input.auto_in_waiting_room;
    else autoWaiting = ['1', 'true', 'on', 'yes'].includes(String(input.auto_in_waiting_room).toLowerCase());
  }

  return {
    subject,
    organizer,
    description,
    start_time: start.toFormat("yyyy-MM-dd'T'HH:mm"),
    end_time: end.toFormat("yyyy-MM-dd'T'HH:mm"),
    start_display: start.toFormat('yyyy-MM-dd HH:mm'),
    end_display: end.toFormat('yyyy-MM-dd HH:mm'),
    start_ts: startTs,
    end_ts: endTs,
    duration,
    password,
    only_user_join_type: onlyUserJoinType,
    auto_in_waiting_room: autoWaiting,
    time_zone: timezone
  };
}

function friendlyError(error) {
  if (error && error.message === 'TIME_CONFLICT') return 'TIME_CONFLICT';
  const code = error && error.details && error.details.code != null ? error.details.code : (error && error.code);
  if ([401, 403].includes(Number(code))) return '腾讯会议授权无效或已失效，请联系管理员';
  if (Number(code) === 429) return '腾讯会议请求过于频繁，请稍后再试';
  if (code === 'TIMEOUT') return '腾讯会议服务响应超时，请稍后检查会议记录后再重试';
  return '腾讯会议服务暂时无法响应，请稍后重试';
}

router.get('/', (req, res) => {
  const status = req.query.status || 'all';
  const meetings = db.listMeetings({
    status,
    limit: req.query.limit,
    offset: req.query.offset
  });
  return responseOk(res, meetings.map(publicMeeting));
});

router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return responseFail(res, 400, '会议 ID 无效');
  const meeting = db.getMeeting(id);
  if (!meeting) return responseFail(res, 404, '会议记录不存在');
  return responseOk(res, publicMeeting(meeting));
});

router.post('/', async (req, res) => {
  console.log('[DEBUG] req.body =', JSON.stringify(req.body));
  const idempotencyKey = cleanText(req.get('X-Idempotency-Key') || (req.body && req.body.idempotency_key), 80);
  if (!idempotencyKey) return responseFail(res, 400, '缺少请求 ID，请刷新页面后重试');

  let parsed;
  try {
    parsed = parseRequest(req.body || {});
  } catch (error) {
    return responseFail(res, 400, error.message);
  }

  let reservation;
  try {
    reservation = db.createReservation({ ...parsed, idempotency_key: idempotencyKey });
  } catch (error) {
    console.error('[DB] reservation failed:', error);
    return responseFail(res, 500, '创建预约失败：' + error.message);
  }

  // Same idempotency key: return the already persisted record rather than creating again.
  if (reservation.status !== 'provisioning') {
    return responseOk(res, publicMeeting(reservation), '该请求已处理过');
  }

  try {
    const remote = await createMeeting(parsed);
    const remoteStartTs = Number(remote.start_ts) || parsed.start_ts;
    const remoteEndTs = Number(remote.end_ts) || parsed.end_ts;
    const startDate = DateTime.fromSeconds(remoteStartTs, { zone: parsed.time_zone });
    const endDate = DateTime.fromSeconds(remoteEndTs, { zone: parsed.time_zone });

    const saved = db.updateMeetingFromRemote(reservation.id, {
      ...remote,
      subject: remote.subject || parsed.subject,
      start_time: startDate.toFormat("yyyy-MM-dd'T'HH:mm"),
      end_time: endDate.toFormat("yyyy-MM-dd'T'HH:mm"),
      start_ts: remoteStartTs,
      end_ts: remoteEndTs,
      duration: remoteEndTs - remoteStartTs
    });

    return responseOk(res, publicMeeting(saved), '腾讯会议创建成功');
  } catch (error) {
    console.error('[Tencent MCP] createMeeting failed:', {
      message: error.message,
      code: error.code,
      details: error.details,
      trace: error.trace
    });

    // A network timeout can happen after Tencent already created the meeting.
    // Reconcile with the host's meeting list before marking the reservation failed.
    if (error.code === 'TIMEOUT' || error.code == null) {
      try {
        const recovered = await recoverCreatedMeeting(parsed);
        if (recovered && (recovered.meeting_id || recovered.meeting_code)) {
          const saved = db.updateMeetingFromRemote(reservation.id, {
            meeting_id: recovered.meeting_id,
            meeting_code: recovered.meeting_code,
            meeting_url: recovered.meeting_url,
            subject: parsed.subject,
            start_time: parsed.start_time,
            end_time: parsed.end_time,
            start_ts: parsed.start_ts,
            end_ts: parsed.end_ts,
            duration: parsed.duration,
            trace: recovered.trace
          });
          return responseOk(res, publicMeeting(saved), '腾讯会议创建成功');
        }
      } catch (recoveryError) {
        console.warn('[Tencent MCP] creation recovery failed:', recoveryError.message);
      }
    }

    db.markFailed(reservation.id, friendlyError(error), error.trace);
    return responseFail(res, 502, friendlyError(error));
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return responseFail(res, 400, '会议 ID 无效');

  const existing = db.getMeeting(id);
  if (!existing) return responseFail(res, 404, '会议记录不存在');
  if (!existing.meeting_id) return responseFail(res, 400, '该会议尚未获得腾讯会议 meeting_id，无法修改');
  if (existing.status === 'canceled' || existing.status === 'ended') {
    return responseFail(res, 400, '已取消或已结束的会议不能修改');
  }

  let parsed;
  try {
    parsed = parseRequest(req.body || {});
  } catch (error) {
    return responseFail(res, 400, error.message);
  }

  const conflicts = db.findConflict(parsed.start_ts, parsed.end_ts, id);
  if (conflicts.length) {
    return responseFail(res, 409, '修改后的时间与已有会议冲突', {
      conflicts: conflictList(conflicts)
    });
  }

  try {
    const remote = await remoteUpdate({ meeting_id: existing.meeting_id, ...parsed });
    db.applyLocalUpdate(id, parsed);
    db.updateMeetingFromRemote(id, {
      ...remote,
      subject: parsed.subject,
      start_time: parsed.start_time,
      end_time: parsed.end_time,
      start_ts: parsed.start_ts,
      end_ts: parsed.end_ts,
      duration: parsed.duration,
      meeting_id: remote.meeting_id || existing.meeting_id,
      meeting_code: remote.meeting_code || existing.meeting_code,
      meeting_url: remote.meeting_url || existing.meeting_url,
      trace: remote.trace
    });
    return responseOk(res, publicMeeting(db.getMeeting(id)), '会议修改成功');
  } catch (error) {
    console.error('[Tencent MCP] updateMeeting failed:', error.message, error.details);
    return responseFail(res, 502, friendlyError(error));
  }
});

router.post('/:id/cancel', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return responseFail(res, 400, '会议 ID 无效');

  const existing = db.getMeeting(id);
  if (!existing) return responseFail(res, 404, '会议记录不存在');
  if (!existing.meeting_id) return responseFail(res, 400, '该会议没有有效的腾讯会议 meeting_id');
  if (existing.status === 'canceled') return responseOk(res, publicMeeting(existing), '会议已经取消');

  try {
    const remote = await remoteCancel({ meeting_id: existing.meeting_id });
    const saved = db.markCanceled(id, remote.trace || null);
    return responseOk(res, publicMeeting(saved), '会议已取消');
  } catch (error) {
    console.error('[Tencent MCP] cancelMeeting failed:', error.message, error.details);
    return responseFail(res, 502, friendlyError(error));
  }
});

router.delete('/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return responseFail(res, 400, '会议 ID 无效');

  const existing = db.getMeeting(id);
  if (!existing) return responseFail(res, 404, '会议记录不存在');
  if (existing.status !== 'canceled' && existing.status !== 'failed') {
    return responseFail(res, 400, '只有已取消或失败记录可以直接删除');
  }
  db.deleteMeeting(id);
  return responseOk(res, null, '记录已删除');
});

module.exports = router;
