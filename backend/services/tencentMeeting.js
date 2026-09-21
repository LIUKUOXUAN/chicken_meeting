// backend/services/tencentMeeting.js

// 腾讯会议 Remote MCP 客户端（Cloudflare Worker 版）
// 使用 Worker 原生 fetch 替代 Node http/https 模块，其余 MCP/SSE 解析逻辑与原版一致。

import { DateTime } from 'luxon';
import { getEnv } from '../utils/env.js';

function randomUUIDCompat() {
  return crypto.randomUUID();
}

export class TencentMcpError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'TencentMcpError';
    this.details = details || {};
    this.code = this.details.code != null ? this.details.code : null;
    this.trace = this.details.trace != null ? this.details.trace : null;
  }
}

function env(name, fallback) {
  return getEnv(name, fallback);
}

function toMcpIsoTime(timestamp, timezone) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) throw new TencentMcpError('会议时间无效');
  return DateTime.fromSeconds(ts, { zone: timezone || 'Asia/Shanghai' }).toFormat("yyyy-MM-dd'T'HH:mm:ssZZ");
}

function sanitizeForLog(value) {
  if (value == null) return value;
  let text;
  try { text = typeof value === 'string' ? value : JSON.stringify(value); }
  catch (e) { text = String(value); }
  const token = env('TENCENT_MEETING_TOKEN', '');
  return token ? text.split(token).join('[REDACTED]') : text;
}

function findFirstSafe(obj, keys) {
  const keySet = new Set(keys.map(function (k) { return k.toLowerCase(); }));
  const queue = [obj];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    const ks = Object.keys(current);
    for (let i = 0; i < ks.length; i += 1) {
      const key = ks[i];
      const value = current[key];
      if (keySet.has(key.toLowerCase()) && value !== undefined && value !== null && value !== '') return value;
      if (value && typeof value === 'object') queue.push(value);
    }
  }
  return null;
}

function deepObjects(obj) {
  const out = [];
  const queue = [obj];
  const seenObjects = new Set();
  const seenStrings = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (current == null) continue;
    if (typeof current === 'string') {
      if (seenStrings.has(current)) continue;
      seenStrings.add(current);
      const parsed = parsePossibleJsonText(current);
      if (parsed !== current && parsed && typeof parsed === 'object') queue.push(parsed);
      continue;
    }
    if (typeof current !== 'object' || seenObjects.has(current)) continue;
    seenObjects.add(current);
    out.push(current);
    Object.keys(current).forEach(function (key) {
      const value = current[key];
      if (value && typeof value === 'object') queue.push(value);
      else if (typeof value === 'string') {
        const parsed = parsePossibleJsonText(value);
        if (parsed !== value && parsed && typeof parsed === 'object') queue.push(parsed);
      }
    });
  }
  return out;
}

function parsePossibleJsonText(text) {
  if (typeof text !== 'string') return text;
  const trimmed = text.trim();
  if (!trimmed) return text;
  try { return JSON.parse(trimmed); } catch (e) { return text; }
}

function unwrapToolResult(result) {
  const candidates = [];
  if (result && result.structuredContent) candidates.push(result.structuredContent);
  if (result && Array.isArray(result.content)) {
    for (let i = 0; i < result.content.length; i += 1) {
      const item = result.content[i];
      if (item && typeof item.text === 'string') candidates.push(parsePossibleJsonText(item.text));
      else if (item && item.data) candidates.push(item.data);
    }
  }
  candidates.push(result);
  return candidates.filter(Boolean);
}

function extractTrace(payload) {
  return findFirstSafe(payload, ['X-Tc-Trace', 'x-tc-trace', 'rpcUuid', 'rpc_uuid', 'trace_id']);
}

function extractMeetingInfo(payload) {
  const base = unwrapToolResult(payload);
  let candidates = [];
  base.forEach(function (v) { candidates = candidates.concat(deepObjects(v)); });
  function first(keys, predicate) {
    for (let i = 0; i < candidates.length; i += 1) {
      const v = findFirstSafe(candidates[i], keys);
      if (predicate ? predicate(v) : Boolean(v)) return v;
    }
    return null;
  }
  const startTs = first(['start_time', 'begin_time', 'startTime', 'beginTime'], function (v) { return v !== null && v !== undefined; });
  const endTs = first(['end_time', 'endTime'], function (v) { return v !== null && v !== undefined; });
  return {
    meetingId: first(['meeting_id', 'meetingId']),
    meetingCode: first(['meeting_code', 'meetingCode']),
    meetingUrl: first(['meeting_url', 'meetingUrl', 'join_url', 'joinUrl', 'invite_url']),
    subject: first(['subject', 'meeting_title', 'meetingTitle']),
    startTs: startTs,
    endTs: endTs,
    password: first(['password', 'meeting_password', 'meetingPassword'])
  };
}

function parseResponse(text, contentType, wantedId) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) {}
  const blocks = text.split(/\n\n+/);
  let fallback = null;
  for (let i = 0; i < blocks.length; i += 1) {
    const lines = blocks[i].split(/\r?\n/).filter(function (line) { return line.indexOf('data:') === 0; }).map(function (line) { return line.slice(5).trim(); });
    if (!lines.length) continue;
    try {
      const parsed = JSON.parse(lines.join('\n'));
      if (parsed && parsed.id === wantedId) return parsed;
      fallback = parsed;
    } catch (e) {}
  }
  if ((contentType || '').indexOf('application/json') >= 0) {
    throw new TencentMcpError('腾讯会议 MCP 返回了无法解析的 JSON', { raw: sanitizeForLog(text.slice(0, 2000)) });
  }
  return fallback;
}

class TencentMeetingClient {
  constructor() {
    // 注意：模块加载时 Worker env 尚未注入，配置项必须在每次请求时动态读取，
    // 不要在这里固化 url / skillVersion / timeout 等值。
    this.sessionId = null;
    this.initialized = false;
    this.sequence = 0;
  }

  buildHeaders() {
    const token = env('TENCENT_MEETING_TOKEN', '');
    if (!token) throw new TencentMcpError('腾讯会议 Token 未配置');
    const skillVersion = env('TENCENT_MCP_SKILL_VERSION', '');
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'X-Tencent-Meeting-Token': token
    };
    if (skillVersion) headers['X-Skill-Version'] = skillVersion;
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    return headers;
  }

  /** Worker 版 HTTP POST：fetch + AbortController 超时，不自动跟随重定向（与旧 http.request 行为一致） */
  async httpPost(body, options) {
    const includeSession = !options || options.includeSession !== false;
    const mcpUrl = env('TENCENT_MCP_URL', 'https://mcp.meeting.tencent.com/mcp/wemeet-open/v1');
    const timeoutMs = Number(env('TENCENT_MCP_TIMEOUT_MS', '20000')) || 20000;
    let url;
    try { url = new URL(mcpUrl); } catch (e) { throw new TencentMcpError('腾讯会议 MCP 地址无效', { code: 'BAD_URL' }); }
    const headers = this.buildHeaders();
    if (!includeSession) delete headers['Mcp-Session-Id'];

    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, timeoutMs);
    try {
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
        redirect: 'manual',
        signal: controller.signal
      });
      const text = await res.text();
      const newSession = res.headers.get('mcp-session-id');
      if (newSession) this.sessionId = newSession;
      const parsed = parseResponse(text, res.headers.get('content-type') || '', body.id);
      if (res.status < 200 || res.status >= 300) {
        throw new TencentMcpError('腾讯会议 MCP 请求失败', { code: res.status, trace: extractTrace(parsed), raw: sanitizeForLog(text.slice(0, 2000)) });
      }
      if (parsed && parsed.error) {
        throw new TencentMcpError(parsed.error.message || '腾讯会议 MCP 返回错误', { code: parsed.error.code, data: parsed.error.data, trace: extractTrace(parsed) });
      }
      return parsed;
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new TencentMcpError('腾讯会议 MCP 响应超时', { code: 'TIMEOUT' });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async initialize() {
    if (this.initialized) return;
    const configured = env('TENCENT_MCP_PROTOCOL_VERSION', '2025-06-18');
    const versions = [configured, '2025-03-26', '2024-11-05'].filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    let lastError = null;
    for (let i = 0; i < versions.length; i += 1) {
      const version = versions[i];
      try {
        const id = 'init-' + (++this.sequence) + '-' + randomUUIDCompat();
        const response = await this.httpPost({ jsonrpc: '2.0', id: id, method: 'initialize', params: { protocolVersion: version, capabilities: {}, clientInfo: { name: 'tencent-meeting-booking', version: '2.0.0' } } }, { includeSession: false });
        if (!response || !response.result) throw new TencentMcpError('腾讯会议 MCP initialize 返回异常', { raw: sanitizeForLog(response) });
        await this.httpPost({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
        this.initialized = true;
        return;
      } catch (e) {
        lastError = e;
        this.sessionId = null;
        this.initialized = false;
      }
    }
    throw lastError || new TencentMcpError('腾讯会议 MCP 初始化失败');
  }

  reset() { this.sessionId = null; this.initialized = false; }

  async callRaw(method, params) {
    await this.initialize();
    const id = 'raw-' + (++this.sequence) + '-' + randomUUIDCompat();
    return this.httpPost({ jsonrpc: '2.0', id: id, method: method, params: params || {} });
  }

  async callTool(name, args) {
    await this.initialize();
    const id = 'call-' + (++this.sequence) + '-' + randomUUIDCompat();
    try {
      const response = await this.httpPost({ jsonrpc: '2.0', id: id, method: 'tools/call', params: { name: name, arguments: args || {} } });
      if (!response || !response.result) throw new TencentMcpError('工具 ' + name + ' 返回异常', { raw: sanitizeForLog(response), trace: extractTrace(response) });
      if (response.result.isError === true) throw new TencentMcpError('腾讯会议工具 ' + name + ' 执行失败', { code: findFirstSafe(response.result, ['code', 'error_code', 'errorCode']) || null, raw: sanitizeForLog(unwrapToolResult(response.result)), trace: extractTrace(response) });
      return { result: response.result, data: extractMeetingInfo(response.result), trace: extractTrace(response.result) || extractTrace(response) };
    } catch (e) {
      if (e && [400, 401, 404, 405].indexOf(Number(e.code)) >= 0) this.reset();
      throw e;
    }
  }

  async healthCheck() {
    const response = await this.callRaw('tools/list', {});
    const root = response && response.result ? response.result : response;
    const tools = root && Array.isArray(root.tools) ? root.tools : [];
    return { ok: true, toolNames: tools.map(function (t) { return t && t.name; }).filter(Boolean), trace: extractTrace(response) };
  }

  scheduleMeeting(args) { return this.callTool('schedule_meeting', args); }
  getMeeting(meetingId) { return this.callTool('get_meeting', { meeting_id: meetingId }); }
  getMeetingByCode(code) { return this.callTool('get_meeting_by_code', { meeting_code: code }); }
  getUserMeetings() { return this.callTool('get_user_meetings', {}); }
  updateMeeting(args) { return this.callTool('update_meeting', args); }
  cancelMeeting(args) { return this.callTool('cancel_meeting', args); }
}

const client = new TencentMeetingClient();

function normalizeTimestamp(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

function toMeetingSummary(rawResult, fallback) {
  const data = rawResult && rawResult.data ? rawResult.data : extractMeetingInfo(rawResult && rawResult.result);
  const fb = fallback || {};
  return {
    meeting_id: data.meetingId || fb.meeting_id || fb.meetingId || null,
    meeting_code: data.meetingCode || fb.meeting_code || fb.meetingCode || null,
    meeting_url: data.meetingUrl || fb.meeting_url || fb.meetingUrl || null,
    subject: data.subject || fb.subject || null,
    start_ts: normalizeTimestamp(data.startTs != null ? data.startTs : fb.start_ts),
    end_ts: normalizeTimestamp(data.endTs != null ? data.endTs : fb.end_ts),
    password: data.password || fb.password || null,
    trace: rawResult && rawResult.trace ? rawResult.trace : null,
    raw_result: rawResult ? rawResult.result : null
  };
}

export async function createMeeting(payload) {
  const timezone = payload.time_zone || 'Asia/Shanghai';
  const args = {
    subject: payload.subject,
    start_time: toMcpIsoTime(payload.start_ts, timezone),
    end_time: toMcpIsoTime(payload.end_ts, timezone),
    time_zone: timezone,
    meeting_type: 0
  };
  if (payload.password) args.password = payload.password;
  if (payload.only_user_join_type != null) args.only_user_join_type = Number(payload.only_user_join_type);
  if (payload.auto_in_waiting_room != null) args.auto_in_waiting_room = Boolean(payload.auto_in_waiting_room);

  const raw = await client.scheduleMeeting(args);
  let summary = toMeetingSummary(raw, payload);

  if (summary.meeting_id && (!summary.meeting_code || !summary.meeting_url)) {
    try {
      const details = await client.getMeeting(summary.meeting_id);
      const merged = toMeetingSummary(details, Object.assign({}, payload, summary));
      Object.keys(merged).forEach(function (k) { if (merged[k] != null) summary[k] = merged[k]; });
    } catch (e) { console.warn('[Tencent MCP] get_meeting after creation failed:', e.message); }
  }

  if (!summary.meeting_id && summary.meeting_code) {
    try {
      const details = await client.getMeetingByCode(summary.meeting_code);
      const merged = toMeetingSummary(details, Object.assign({}, payload, summary));
      Object.keys(merged).forEach(function (k) { if (merged[k] != null) summary[k] = merged[k]; });
    } catch (e) { console.warn('[Tencent MCP] get_meeting_by_code after creation failed:', e.message); }
  }

  if (!summary.meeting_id && !summary.meeting_code) throw new TencentMcpError('腾讯会议已返回成功响应，但未返回 meeting_id/meeting_code，无法保存可追踪会议记录', { trace: raw && raw.trace, raw: sanitizeForLog(raw && raw.result) });
  return summary;
}

export async function recoverCreatedMeeting(payload) {
  const raw = await client.getUserMeetings();
  let candidates = [];
  unwrapToolResult(raw.result).forEach(function (v) { candidates = candidates.concat(deepObjects(v)); });
  const meetings = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const item = candidates[i];
    const id = findFirstSafe(item, ['meeting_id', 'meetingId']);
    const code = findFirstSafe(item, ['meeting_code', 'meetingCode']);
    const url = findFirstSafe(item, ['meeting_url', 'meetingUrl', 'join_url', 'joinUrl', 'invite_url']);
    const subject = findFirstSafe(item, ['subject', 'meeting_title', 'meetingTitle']);
    const start = normalizeTimestamp(findFirstSafe(item, ['start_time', 'begin_time', 'startTime', 'beginTime']));
    const end = normalizeTimestamp(findFirstSafe(item, ['end_time', 'endTime']));
    if (id || code || url) meetings.push({ meeting_id: id, meeting_code: code, meeting_url: url, subject: subject, start_ts: start, end_ts: end });
  }
  const matched = meetings.find(function (m) {
    const sameSubject = !m.subject || m.subject === payload.subject;
    const sameStart = m.start_ts == null || Math.abs(m.start_ts - payload.start_ts) <= 60;
    const sameEnd = m.end_ts == null || Math.abs(m.end_ts - payload.end_ts) <= 60;
    return sameSubject && sameStart && sameEnd;
  });
  return matched ? Object.assign({}, matched, { trace: raw && raw.trace ? raw.trace : null }) : null;
}

export async function getMeeting(id) {
  const raw = await client.getMeeting(id);
  return Object.assign({}, toMeetingSummary(raw, {}), { raw_result: raw && raw.result, trace: raw && raw.trace });
}

export async function updateMeeting(payload) {
  const timezone = payload.time_zone || 'Asia/Shanghai';
  const args = {
    meeting_id: payload.meeting_id,
    subject: payload.subject,
    start_time: toMcpIsoTime(payload.start_ts, timezone),
    end_time: toMcpIsoTime(payload.end_ts, timezone),
    time_zone: timezone
  };
  const raw = await client.updateMeeting(args);
  return Object.assign({}, toMeetingSummary(raw, payload), { raw_result: raw && raw.result, trace: raw && raw.trace });
}

export async function cancelMeeting(payload) {
  const args = { meeting_id: payload.meeting_id };
  if (payload.sub_meeting_id) args.sub_meeting_id = payload.sub_meeting_id;
  if (payload.meeting_type != null) args.meeting_type = Number(payload.meeting_type);
  const raw = await client.cancelMeeting(args);
  return { raw_result: raw && raw.result, trace: raw && raw.trace };
}

export function testConnection() { return client.healthCheck(); }
