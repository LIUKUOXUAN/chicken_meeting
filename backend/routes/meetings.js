// backend/routes/meetings.js

// 会议预约路由（Cloudflare Worker 版）。业务逻辑与旧 Express 版一致。

import { DateTime } from 'luxon';
import {
  createMeeting,
  recoverCreatedMeeting,
  updateMeeting as remoteUpdate,
  cancelMeeting as remoteCancel
} from '../services/tencentMeeting.js';
import { isAdmin } from '../utils/auth.js';
import { publicMeeting, conflictList } from '../utils/meetingView.js';
import { responseOk, responseFail, readJsonBody } from '../utils/http.js';
import { getEnv } from '../utils/env.js';

function cleanText(value, max = 500) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function parseRequest(input) {

  const timezone = getEnv('TIMEZONE', 'Asia/Shanghai');

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

/** 解析 /api/meetings 之后的路径，如 ''、'/123'、'/123/cancel' */
function parseIdAndAction(rest) {
  const segments = String(rest || '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  const id = segments.length ? Number(segments[0]) : null;
  const action = segments.length > 1 ? segments[1] : null;
  return { id, action };
}

function invalidId() {
  return responseFail(400, '会议 ID 无效');
}

/**
 * 会议路由入口。
 * @param {{ method: string, request: Request, env: any, db: object, url: URL, path: string }} ctx
 * @returns {Promise<Response|null>} null 表示路径不匹配
 */
export async function routeMeetings(ctx) {
  const { method, request, db, url, path } = ctx;
  const rest = path.slice('/api/meetings'.length);
  const { id, action } = parseIdAndAction(rest);

  // GET /api/meetings
  if (method === 'GET' && !rest.replace(/^\/+|\/+$/g, '')) {
    const status = url.searchParams.get('status') || 'all';
    const meetings = await db.listMeetings({
      status,
      limit: url.searchParams.get('limit'),
      offset: url.searchParams.get('offset')
    });
    return responseOk(meetings.map(publicMeeting));
  }

  // GET /api/meetings/:id
  if (method === 'GET' && id != null && !action) {
    if (!Number.isInteger(id) || id <= 0) return invalidId();
    const meeting = await db.getMeeting(id);
    if (!meeting) return responseFail(404, '会议记录不存在');
    return responseOk(publicMeeting(meeting));
  }

  // POST /api/meetings
  if (method === 'POST' && !rest.replace(/^\/+|\/+$/g, '')) {
    const body = await readJsonBody(request);
    console.log('[DEBUG] body =', JSON.stringify(body));
    const idempotencyKey = cleanText(request.headers.get('X-Idempotency-Key') || (body && body.idempotency_key), 80);
    if (!idempotencyKey) return responseFail(400, '缺少请求 ID，请刷新页面后重试');

    let parsed;
    try {
      parsed = parseRequest(body || {});
    } catch (error) {
      return responseFail(400, error.message);
    }

    let reservation;
    try {
      reservation = await db.createReservation({ ...parsed, idempotency_key: idempotencyKey });
    } catch (error) {
      console.error('[DB] reservation failed:', error);
      return responseFail(500, '创建预约失败：' + error.message);
    }

    // 相同幂等键：直接返回已持久化的记录，避免重复创建
    if (reservation.status !== 'provisioning') {
      return responseOk(publicMeeting(reservation), '该请求已处理过');
    }

    try {
      const remote = await createMeeting(parsed);
      const remoteStartTs = Number(remote.start_ts) || parsed.start_ts;
      const remoteEndTs = Number(remote.end_ts) || parsed.end_ts;
      const startDate = DateTime.fromSeconds(remoteStartTs, { zone: parsed.time_zone });
      const endDate = DateTime.fromSeconds(remoteEndTs, { zone: parsed.time_zone });

      const saved = await db.updateMeetingFromRemote(reservation.id, {
        ...remote,
        subject: remote.subject || parsed.subject,
        start_time: startDate.toFormat("yyyy-MM-dd'T'HH:mm"),
        end_time: endDate.toFormat("yyyy-MM-dd'T'HH:mm"),
        start_ts: remoteStartTs,
        end_ts: remoteEndTs,
        duration: remoteEndTs - remoteStartTs
      });

      return responseOk(publicMeeting(saved), '腾讯会议创建成功');
    } catch (error) {
      console.error('[Tencent MCP] createMeeting failed:', {
        message: error.message,
        code: error.code,
        details: error.details,
        trace: error.trace
      });

      // 网络超时可能发生在腾讯已经创建会议之后，先向会议列表对账再标记失败
      if (error.code === 'TIMEOUT' || error.code == null) {
        try {
          const recovered = await recoverCreatedMeeting(parsed);
          if (recovered && (recovered.meeting_id || recovered.meeting_code)) {
            const saved = await db.updateMeetingFromRemote(reservation.id, {
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
            return responseOk(publicMeeting(saved), '腾讯会议创建成功');
          }
        } catch (recoveryError) {
          console.warn('[Tencent MCP] creation recovery failed:', recoveryError.message);
        }
      }

      await db.markFailed(reservation.id, friendlyError(error), error.trace);
      return responseFail(502, friendlyError(error));
    }
  }

  // PUT /api/meetings/:id（管理员）
  if (method === 'PUT' && id != null && !action) {
    if (!(await isAdmin(request))) return responseFail(401, '需要管理员登录');
    if (!Number.isInteger(id) || id <= 0) return invalidId();

    const existing = await db.getMeeting(id);
    if (!existing) return responseFail(404, '会议记录不存在');
    if (!existing.meeting_id) return responseFail(400, '该会议尚未获得腾讯会议 meeting_id，无法修改');
    if (existing.status === 'canceled' || existing.status === 'ended') {
      return responseFail(400, '已取消或已结束的会议不能修改');
    }

    let parsed;
    try {
      parsed = parseRequest(await readJsonBody(request));
    } catch (error) {
      return responseFail(400, error.message);
    }

    const conflicts = await db.findConflict(parsed.start_ts, parsed.end_ts, id);
    if (conflicts.length) {
      return responseFail(409, '修改后的时间与已有会议冲突', {
        conflicts: conflictList(conflicts)
      });
    }

    try {
      const remote = await remoteUpdate({ meeting_id: existing.meeting_id, ...parsed });
      await db.applyLocalUpdate(id, parsed);
      await db.updateMeetingFromRemote(id, {
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
      return responseOk(publicMeeting(await db.getMeeting(id)), '会议修改成功');
    } catch (error) {
      console.error('[Tencent MCP] updateMeeting failed:', error.message, error.details);
      return responseFail(502, friendlyError(error));
    }
  }

  // POST /api/meetings/:id/cancel（管理员）
  if (method === 'POST' && id != null && action === 'cancel') {
    if (!(await isAdmin(request))) return responseFail(401, '需要管理员登录');
    if (!Number.isInteger(id) || id <= 0) return invalidId();

    const existing = await db.getMeeting(id);
    if (!existing) return responseFail(404, '会议记录不存在');
    if (!existing.meeting_id) return responseFail(400, '该会议没有有效的腾讯会议 meeting_id');
    if (existing.status === 'canceled') return responseOk(publicMeeting(existing), '会议已经取消');

    try {
      const remote = await remoteCancel({ meeting_id: existing.meeting_id });
      const saved = await db.markCanceled(id, remote.trace || null);
      return responseOk(publicMeeting(saved), '会议已取消');
    } catch (error) {
      console.error('[Tencent MCP] cancelMeeting failed:', error.message, error.details);
      return responseFail(502, friendlyError(error));
    }
  }

  // DELETE /api/meetings/:id（管理员，仅失败/取消记录）
  if (method === 'DELETE' && id != null && !action) {
    if (!(await isAdmin(request))) return responseFail(401, '需要管理员登录');
    if (!Number.isInteger(id) || id <= 0) return invalidId();

    const existing = await db.getMeeting(id);
    if (!existing) return responseFail(404, '会议记录不存在');
    if (existing.status !== 'canceled' && existing.status !== 'failed') {
      return responseFail(400, '只有已取消或失败记录可以直接删除');
    }
    await db.deleteMeeting(id);
    return responseOk(null, '记录已删除');
  }

  return null;
}
