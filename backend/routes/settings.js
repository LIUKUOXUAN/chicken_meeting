const express = require('express');
const db = require('../database/database');
const { requireAdmin } = require('../utils/auth');

const router = express.Router();

router.get('/invite-template', (req, res) => {
  return res.json({ success: true, data: { template: db.getSetting('invite_template') || '' }, message: '' });
});

router.put('/invite-template', requireAdmin, (req, res) => {
  const template = String(req.body && req.body.template || '').trim();
  if (!template) return res.status(400).json({ success: false, data: null, message: '邀请模板不能为空' });
  if (template.length > 5000) return res.status(400).json({ success: false, data: null, message: '邀请模板不能超过5000字' });
  const saved = db.setSetting('invite_template', template);
  return res.json({ success: true, data: { template: saved }, message: '邀请模板已保存' });
});

module.exports = router;
