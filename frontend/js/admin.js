const toast = document.querySelector('#toast');
const body = document.querySelector('#adminBody');
const empty = document.querySelector('#adminEmpty');
let meetings = [];

function showToast(t) {
  toast.textContent = t;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 1400);
}
function fmt(s) { return (s || '').replace('T', ' '); }
function statusInfo(s) {
  return ({
    upcoming: ['待开始', 'status-upcoming'],
    ongoing: ['进行中', 'status-ongoing'],
    ended: ['已结束', 'status-ended'],
    canceled: ['已取消', 'status-canceled'],
    failed: ['创建失败', 'status-failed'],
    provisioning: ['创建中', 'status-provisioning']
  })[s] || ['未知', 'status-ended'];
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
}
async function api(url, opts = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts
  });
  const json = await response.json().catch(() => ({ success: false, message: '响应异常' }));
  if (!response.ok || !json.success) {
    throw Object.assign(new Error(json.message || '请求失败'), { status: response.status, data: json.data });
  }
  return json;
}
async function ensureLogin() {
  const json = await api('/api/auth/me');
  if (!json.data.is_admin) {
    location.href = '/admin/login';
    throw new Error('未登录');
  }
}
async function loadStats() {
  const json = await api('/api/system/stats');
  document.querySelector('#todayCount').textContent = json.data.today;
  document.querySelector('#weekCount').textContent = json.data.week;
  document.querySelector('#upcomingCount').textContent = json.data.upcoming;
  document.querySelector('#endedCount').textContent = json.data.ended;
}
async function loadStatus() {
  const json = await api('/api/system/status');
  document.querySelector('#tencentStatus').textContent = json.data.token_configured ? 'Token 已配置，等待连接测试' : '未配置 Token';
  document.querySelector('#tokenMeta').textContent = `MCP：${json.data.mcp_url} · 时区：${json.data.time_zone}`;
}
async function testTencent() {
  const btn = document.querySelector('#testTencentBtn');
  btn.disabled = true; btn.textContent = '测试中…';
  try {
    const json = await api('/api/system/test-tencent', { method: 'POST' });
    document.querySelector('#tencentStatus').textContent = `✓ ${json.message} · 工具数：${json.data.toolNames?.length ?? 0}`;
    showToast('腾讯会议连接正常');
  } catch (error) {
    document.querySelector('#tencentStatus').textContent = `✕ ${error.message}`;
    showToast('连接测试失败');
  } finally {
    btn.disabled = false; btn.textContent = '测试腾讯会议连接';
  }
}
async function loadTemplate() {
  const json = await api('/api/settings/invite-template');
  document.querySelector('#templateEditor').value = json.data.template;
}
function render() {
  body.innerHTML = '';
  empty.classList.toggle('hidden', meetings.length !== 0);
  for (const m of meetings) {
    const [label, cls] = statusInfo(m.status);
    const tr = document.createElement('tr');
    let actions = '';
    if (m.status === 'upcoming' || m.status === 'ongoing') {
      actions += '<button class="link-btn edit-btn">修改</button><button class="link-btn cancel-btn">取消</button>';
    }
    if (m.status === 'canceled' || m.status === 'failed') actions += '<button class="link-btn delete-btn">删除记录</button>';
    tr.innerHTML = `<td><strong>${escapeHtml(m.subject)}</strong></td><td>${escapeHtml(m.organizer)}</td><td>${fmt(m.start_time)} - ${fmt(m.end_time)}</td><td>${escapeHtml(m.meeting_code || '—')}</td><td><span class="status-pill ${cls}">${label}</span></td><td><div class="row-actions">${actions}</div></td>`;
    tr.querySelector('.edit-btn')?.addEventListener('click', () => openEdit(m));
    tr.querySelector('.cancel-btn')?.addEventListener('click', () => cancelMeeting(m));
    tr.querySelector('.delete-btn')?.addEventListener('click', () => deleteMeeting(m));
    body.appendChild(tr);
  }
}
async function loadMeetings() {
  meetings = (await api('/api/meetings?status=all&limit=500')).data;
  render();
}
function openEdit(m) {
  document.querySelector('#editId').value = m.id;
  document.querySelector('#editSubject').value = m.subject;
  document.querySelector('#editOrganizer').value = m.organizer;
  document.querySelector('#editStart').value = m.start_time;
  document.querySelector('#editEnd').value = m.end_time;
  document.querySelector('#editDescription').value = m.description || '';
  document.querySelector('#editError').textContent = '';
  document.querySelector('#editModal').classList.remove('hidden');
}
async function cancelMeeting(m) {
  if (!confirm(`确定取消会议“${m.subject}”吗？`)) return;
  try {
    await api(`/api/meetings/${m.id}/cancel`, { method: 'POST' });
    showToast('会议已取消');
    await Promise.all([loadMeetings(), loadStats()]);
  } catch (error) { showToast(error.message); }
}
async function deleteMeeting(m) {
  if (!confirm('只删除本地记录，不会恢复腾讯会议。确定删除吗？')) return;
  try {
    await api(`/api/meetings/${m.id}`, { method: 'DELETE' });
    showToast('记录已删除');
    await Promise.all([loadMeetings(), loadStats()]);
  } catch (error) { showToast(error.message); }
}

document.querySelector('#saveTemplateBtn').onclick = async () => {
  const err = document.querySelector('#templateError'); err.textContent = '';
  try {
    await api('/api/settings/invite-template', {
      method: 'PUT', body: JSON.stringify({ template: document.querySelector('#templateEditor').value })
    });
    showToast('模板已保存');
  } catch (error) { err.textContent = error.message; }
};
document.querySelector('#testTencentBtn').onclick = testTencent;
document.querySelector('#logoutBtn').onclick = async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.href = '/admin/login';
};
document.querySelector('#closeModal').onclick = () => document.querySelector('#editModal').classList.add('hidden');
document.querySelector('#editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.querySelector('#editError'); err.textContent = '';
  const id = document.querySelector('#editId').value;
  try {
    await api(`/api/meetings/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        subject: document.querySelector('#editSubject').value,
        organizer: document.querySelector('#editOrganizer').value,
        start_time: document.querySelector('#editStart').value,
        end_time: document.querySelector('#editEnd').value,
        description: document.querySelector('#editDescription').value
      })
    });
    document.querySelector('#editModal').classList.add('hidden');
    showToast('会议已修改');
    await Promise.all([loadMeetings(), loadStats()]);
  } catch (error) { err.textContent = error.message; }
});

(async () => {
  try {
    await ensureLogin();
    await Promise.all([loadStats(), loadStatus(), loadTemplate(), loadMeetings()]);
  } catch (error) {
    if (error.message !== '未登录') showToast(error.message);
  }
})();
