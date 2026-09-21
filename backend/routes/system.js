const express = require('express');
const { DateTime } = require('luxon');
const { isAdmin, requireAdmin } = require('../utils/auth');
const { testConnection } = require('../services/tencentMeeting');
const db = require('../database/database');

const router = express.Router();

router.get('/status', (req, res) => {
  res.json({
    success: true,
    data: {
      token_configured: Boolean(process.env.TENCENT_MEETING_TOKEN),
      mcp_url: process.env.TENCENT_MCP_URL || 'https://mcp.meeting.tencent.com/mcp/wemeet-open/v1',
      time_zone: process.env.TIMEZONE || 'Asia/Shanghai',
      admin_logged_in: isAdmin(req),
      database: db.db.open ? 'ok' : 'unavailable'
    },
    message: ''
  });
});

router.get('/stats', requireAdmin, (req, res) => {
  const zone = process.env.TIMEZONE || 'Asia/Shanghai';
  const now = DateTime.now().setZone(zone);
  const dayStart = now.startOf('day').toSeconds();
  const dayEnd = now.endOf('day').toSeconds();
  const weekStart = now.startOf('week').toSeconds();
  const all = db.listMeetings({ status: 'all', limit: 500, offset: 0 });
  const active = all.filter((m) => !['canceled', 'failed'].includes(m.status));

  res.json({
    success: true,
    data: {
      today: active.filter((m) => m.start_ts >= dayStart && m.start_ts <= dayEnd).length,
      week: active.filter((m) => m.start_ts >= weekStart).length,
      upcoming: active.filter((m) => m.status === 'upcoming').length,
      ended: active.filter((m) => m.status === 'ended').length,
      time_zone: zone
    },
    message: ''
  });
});

router.post('/test-tencent', requireAdmin, async (req, res) => {
  try {
    const result = await testConnection();
    return res.json({ success: true, data: result, message: '腾讯会议连接正常' });
  } catch (error) {
    console.error('[Tencent MCP] connection test failed:', error.message, error.details);
    return res.status(502).json({
      success: false,
      data: null,
      message: error.code === 'TIMEOUT' ? '腾讯会议服务响应超时' : '腾讯会议连接失败'
    });
  }
});

module.exports = router;
