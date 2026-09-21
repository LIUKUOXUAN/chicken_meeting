const body = document.querySelector('#historyBody');
const empty = document.querySelector('#emptyState');
const filter = document.querySelector('#statusFilter');
const toast = document.querySelector('#toast');
const viewModal = document.querySelector('#viewModal');
const viewContent = document.querySelector('#viewContent');

function fmt(s) { return (s || '').replace('T', ' '); }
function durationText(sec) {
  const m = Math.round(Number(sec || 0) / 60), h = Math.floor(m / 60), r = m % 60;
  return h && r ? `${h}小时${r}分钟` : h ? `${h}小时` : `${r}分钟`;
}
function statusInfo(s) {
  return ({ upcoming: ['待开始', 'status-upcoming'], ongoing: ['进行中', 'status-ongoing'], ended: ['已结束', 'status-ended'], canceled: ['已取消', 'status-canceled'], failed: ['创建失败', 'status-failed'], provisioning: ['创建中', 'status-provisioning'] })[s] || ['未知', 'status-ended'];
}
function showToast(t) {
  toast.textContent = t;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 1300);
}
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(String(text ?? ''));
    } else {
      const area = document.createElement('textarea');
      area.value = String(text ?? ''); area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
    }
    showToast('已复制');
  } catch {
    showToast('复制失败，请手动复制');
  }
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
}
function makeInvite(m) {
  return `【腾讯会议邀请】\n\n会议主题：${m.subject}\n\n会议时间：${fmt(m.start_time)} - ${fmt(m.end_time)}\n\n会议时长：${durationText(m.duration)}\n\n会议号：${m.meeting_code || ''}\n\n入会链接：\n${m.meeting_url || ''}\n\n会议说明：\n${m.description || ''}\n\n预约人：${m.organizer}`;
}
function showDetail(m) {
  const [label, cls] = statusInfo(m.status);
  viewContent.innerHTML = `<div class="detail-grid">
    <div class="detail-item"><div class="label">会议主题</div><div class="value">${escapeHtml(m.subject)}</div></div>
    <div class="detail-item"><div class="label">预约人</div><div class="value">${escapeHtml(m.organizer)}</div></div>
    <div class="detail-item"><div class="label">开始时间</div><div class="value">${escapeHtml(fmt(m.start_time))}</div></div>
    <div class="detail-item"><div class="label">结束时间</div><div class="value">${escapeHtml(fmt(m.end_time))}</div></div>
    <div class="detail-item"><div class="label">会议时长</div><div class="value">${escapeHtml(durationText(m.duration))}</div></div>
    <div class="detail-item"><div class="label">会议号</div><div class="value">${escapeHtml(m.meeting_code || '—')}</div></div>
    <div class="detail-item"><div class="label">状态</div><div class="value"><span class="status-pill ${cls}">${label}</span></div></div>
    <div class="detail-item"><div class="label">入会链接</div><div class="value">${m.meeting_url ? `<a href="${escapeHtml(m.meeting_url)}" target="_blank" rel="noopener">${escapeHtml(m.meeting_url)}</a>` : '—'}</div></div>
  </div><div class="detail-item"><div class="label">会议说明</div><div class="value long-value">${escapeHtml(m.description || '—')}</div></div>`;
  viewModal.classList.remove('hidden');
}

async function load() {
  const response = await fetch('/api/meetings?status=' + encodeURIComponent(filter.value));
  const json = await response.json().catch(() => ({ success: false, message: '加载失败' }));
  if (!response.ok || !json.success) { showToast(json.message || '加载失败'); return; }
  body.innerHTML = '';
  empty.classList.toggle('hidden', json.data.length !== 0);

  for (const m of json.data) {
    const [label, cls] = statusInfo(m.status);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><strong>${escapeHtml(m.subject)}</strong></td><td>${escapeHtml(m.organizer)}</td><td>${fmt(m.start_time)}</td><td>${fmt(m.end_time)}</td><td>${escapeHtml(m.meeting_code || '—')}</td><td><span class="status-pill ${cls}">${label}</span></td><td><div class="row-actions"><button class="link-btn view-btn">查看</button><button class="link-btn copy-invite">复制邀请</button>${m.meeting_url ? '<button class="link-btn copy-link">复制链接</button>' : ''}</div></td>`;
    tr.querySelector('.view-btn').onclick = () => showDetail(m);
    tr.querySelector('.copy-invite').onclick = () => copyText(makeInvite(m));
    tr.querySelector('.copy-link')?.addEventListener('click', () => copyText(m.meeting_url));
    body.appendChild(tr);
  }
}

filter.onchange = load;
document.querySelector('#refreshBtn').onclick = load;
document.querySelector('#closeViewModal').onclick = () => viewModal.classList.add('hidden');
viewModal.addEventListener('click', (event) => { if (event.target === viewModal) viewModal.classList.add('hidden'); });
load();
