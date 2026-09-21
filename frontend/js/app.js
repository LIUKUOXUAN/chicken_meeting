const $ = (s) => document.querySelector(s);
const form = $('#bookingForm');
const startEl = $('#startTime');
const endEl = $('#endTime');
const modeEls = Array.from(document.querySelectorAll('input[name="timeMode"]'));
const durationSelect = $('#durationSelect');
const customDuration = $('#customDuration');
const durationDisplay = $('#durationDisplay');
const timeError = $('#timeError');
const submitError = $('#submitError');
const createBtn = $('#createBtn');
const resultSection = $('#resultSection');
const TIMEZONE = 'Asia/Shanghai';


/* =========================
   基础工具
========================= */

function pad(n) {
  return String(n).padStart(2, '0');
}


/* =========================
   UUID 兼容生成
   解决旧浏览器 crypto.randomUUID 不支持问题
========================= */

function generateUUID() {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }

  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.getRandomValues === 'function'
  ) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);

    // RFC 4122 UUID v4
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes).map(function (b) {
      return b.toString(16).padStart(2, '0');
    }).join('');

    return (
      hex.substring(0, 8) + '-' +
      hex.substring(8, 12) + '-' +
      hex.substring(12, 16) + '-' +
      hex.substring(16, 20) + '-' +
      hex.substring(20, 32)
    );
  }

  // 最后的兼容方案
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
    /[xy]/g,
    function (c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    }
  );
}


/* =========================
   时间处理
========================= */

function wallClockToMinutes(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value || '')) {
    return null;
  }

  const parts = value.split('T');
  const date = parts[0];
  const time = parts[1];

  const dateParts = date.split('-').map(Number);
  const timeParts = time.split(':').map(Number);

  const y = dateParts[0];
  const mo = dateParts[1];
  const d = dateParts[2];
  const h = timeParts[0];
  const mi = timeParts[1];

  if (![y, mo, d, h, mi].every(Number.isFinite)) {
    return null;
  }

  // 使用 UTC 作为纯粹的墙上时间计算容器，
  // 不受浏览器本地时区影响
  const ms = Date.UTC(y, mo - 1, d, h, mi);

  return {
    ms: ms,
    y: y,
    mo: mo,
    d: d,
    h: h,
    mi: mi
  };
}


function minutesToWallClock(ms) {
  const d = new Date(ms);

  return (
    d.getUTCFullYear() +
    '-' +
    pad(d.getUTCMonth() + 1) +
    '-' +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    ':' +
    pad(d.getUTCMinutes())
  );
}


function durationText(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;

  if (h && m) {
    return h + '小时' + m + '分钟';
  }

  if (h) {
    return h + '小时';
  }

  return m + '分钟';
}


function selectedMode() {
  const found = modeEls.find(function (e) {
    return e.checked;
  });

  return found ? found.value : 'end';
}


function chinaNowInput() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date());

  const map = {};

  parts.forEach(function (p) {
    map[p.type] = p.value;
  });

  return (
    map.year +
    '-' +
    map.month +
    '-' +
    map.day +
    'T' +
    map.hour +
    ':' +
    map.minute
  );
}


function addWallMinutes(value, minutes) {
  const parsed = wallClockToMinutes(value);

  if (!parsed || !Number.isFinite(minutes)) {
    return '';
  }

  return minutesToWallClock(
    parsed.ms + minutes * 60000
  );
}


/* =========================
   时长处理
========================= */

function applyDuration() {
  const minutes =
    durationSelect.value === 'custom'
      ? Number(customDuration.value)
      : Number(durationSelect.value);

  if (
    !Number.isFinite(minutes) ||
    minutes <= 0 ||
    !wallClockToMinutes(startEl.value)
  ) {
    return;
  }

  const end = addWallMinutes(startEl.value, minutes);

  if (end) {
    endEl.value = end;
    calculateDuration();
  }
}


function updateTimeUI() {
  const mode = selectedMode();

  $('#endField').classList.toggle(
    'hidden',
    mode !== 'end'
  );

  $('#durationField').classList.toggle(
    'hidden',
    mode !== 'duration'
  );

  $('#customDurationField').classList.toggle(
    'hidden',
    mode !== 'duration' ||
    durationSelect.value !== 'custom'
  );

  endEl.required = mode === 'end';

  if (mode === 'duration') {
    applyDuration();
  }

  calculateDuration();
}


function calculateDuration() {
  timeError.textContent = '';

  const start = wallClockToMinutes(startEl.value);
  const end = wallClockToMinutes(endEl.value);

  if (!start || !end) {
    durationDisplay.textContent = '会议时长：—';
    return null;
  }

  const minutes = Math.round(
    (end.ms - start.ms) / 60000
  );

  if (minutes <= 0) {
    timeError.textContent = '结束时间必须晚于开始时间';
    durationDisplay.textContent = '会议时长：—';
    return null;
  }

  durationDisplay.textContent =
    '会议时长：' + durationText(minutes);

  return minutes;
}


/* =========================
   默认时间
========================= */

function setDefaultTimes() {
  let start = chinaNowInput();

  const parsed = wallClockToMinutes(start);

  if (!parsed) {
    return;
  }

  const rounded =
    Math.ceil(parsed.mi / 30) * 30;

  start = minutesToWallClock(
    parsed.ms -
    parsed.mi * 60000 +
    rounded * 60000 +
    30 * 60000
  );

  const end = addWallMinutes(start, 60);

  startEl.value = start;
  endEl.value = end;

  calculateDuration();
}


/* =========================
   文本处理
========================= */

function formatDateTime(value) {
  return value
    ? value.replace('T', ' ')
    : '';
}


function escapeHtml(s) {
  return String(s == null ? '' : s).replace(
    /[&<>'"]/g,
    function (c) {
      const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      };

      return map[c];
    }
  );
}


/* =========================
   邀请文字
========================= */

function buildInvite(template, m) {
  const values = {
    subject: m.subject,
    organizer: m.organizer,
    start_time: formatDateTime(m.start_time),
    end_time: formatDateTime(m.end_time),
    duration:
      m.duration_text ||
      durationText(Math.round(m.duration / 60)),
    meeting_code: m.meeting_code || '',
    meeting_url: m.meeting_url || '',
    description: m.description || ''
  };

  return String(template || '').replace(
    /{{\s*([a-zA-Z_]+)\s*}}/g,
    function (_, key) {
      return values[key] == null
        ? ''
        : values[key];
    }
  );
}


async function getInviteTemplate() {
  const response = await fetch(
    '/api/settings/invite-template'
  );

  const json = await response.json();

  if (!response.ok || !json.success) {
    throw new Error(
      json.message || '邀请模板加载失败'
    );
  }

  return json.data.template || '';
}


/* =========================
   POST 请求
========================= */

async function postJSON(url, options) {
  options = options || {};

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const json = await response.json().catch(function () {
    return {
      success: false,
      message: '服务器返回格式异常'
    };
  });

  if (!response.ok || !json.success) {
    throw Object.assign(
      new Error(
        json.message || '请求失败'
      ),
      {
        status: response.status,
        data: json.data
      }
    );
  }

  return json;
}


/* =========================
   复制
========================= */

async function copyText(text, btn) {
  const value = String(text == null ? '' : text);

  try {
    if (
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      await navigator.clipboard.writeText(value);
    } else {
      const textarea =
        document.createElement('textarea');

      textarea.value = value;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';

      document.body.appendChild(textarea);

      textarea.focus();
      textarea.select();

      document.execCommand('copy');

      textarea.remove();
    }

    const old = btn.textContent;

    btn.textContent = '✓ 已复制，可直接粘贴';

    setTimeout(function () {
      btn.textContent = old;
    }, 1600);

  } catch (error) {
    submitError.textContent =
      '浏览器拒绝了复制操作，请手动复制内容';
  }
}


/* =========================
   创建成功结果
========================= */

function renderResult(m, invite) {
  resultSection.classList.remove('hidden');

  const meetingCode =
    m.meeting_code || '—';

  const url =
    m.meeting_url || '';

  resultSection.innerHTML = `
    <div class="success-card">
      <div class="success-title">
        <span class="success-icon">✓</span>
        腾讯会议创建成功
      </div>

      <div class="detail-grid">

        <div class="detail-item">
          <div class="label">会议主题</div>
          <div class="value">
            ${escapeHtml(m.subject)}
          </div>
        </div>

        <div class="detail-item">
          <div class="label">预约人</div>
          <div class="value">
            ${escapeHtml(m.organizer)}
          </div>
        </div>

        <div class="detail-item">
          <div class="label">开始时间</div>
          <div class="value">
            ${escapeHtml(
              formatDateTime(m.start_time)
            )}
          </div>
        </div>

        <div class="detail-item">
          <div class="label">结束时间</div>
          <div class="value">
            ${escapeHtml(
              formatDateTime(m.end_time)
            )}
          </div>
        </div>

        <div class="detail-item">
          <div class="label">会议时长</div>
          <div class="value">
            ${escapeHtml(
              m.duration_text ||
              durationText(
                Math.round(m.duration / 60)
              )
            )}
          </div>
        </div>

        <div class="detail-item">
          <div class="label">会议号</div>
          <div class="value">
            ${escapeHtml(meetingCode)}
          </div>
        </div>

      </div>

      <div class="invite-box">

        <div class="section-title">
          自动生成邀请文字
        </div>

        <textarea
          id="inviteText"
          readonly
        ></textarea>

        <div class="copy-actions">

          <button
            class="secondary-btn"
            id="copyInvite"
          >
            复制完整邀请
          </button>

          <button
            class="secondary-btn"
            id="copyLink"
          >
            复制会议链接
          </button>

          <button
            class="secondary-btn"
            id="copyCode"
          >
            复制会议号
          </button>

        </div>

      </div>

      <div class="result-actions">

        <a
          class="secondary-btn"
          href="/history"
        >
          查看历史会议
        </a>

        ${
          url
            ? `
              <a
                class="primary-btn compact"
                target="_blank"
                rel="noopener"
                href="${escapeHtml(url)}"
              >
                打开入会链接
              </a>
            `
            : ''
        }

      </div>

    </div>
  `;

  $('#inviteText').value = invite;

  $('#copyInvite').onclick =
    function () {
      copyText(
        invite,
        $('#copyInvite')
      );
    };

  $('#copyLink').onclick =
    function () {
      copyText(
        url,
        $('#copyLink')
      );
    };

  $('#copyCode').onclick =
    function () {
      copyText(
        meetingCode,
        $('#copyCode')
      );
    };

  resultSection.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
}


/* =========================
   页面事件
========================= */

modeEls.forEach(function (e) {
  e.addEventListener(
    'change',
    updateTimeUI
  );
});


startEl.addEventListener(
  'input',
  function () {
    if (selectedMode() === 'duration') {
      applyDuration();
    }

    calculateDuration();
  }
);


endEl.addEventListener(
  'input',
  calculateDuration
);


durationSelect.addEventListener(
  'change',
  updateTimeUI
);


customDuration.addEventListener(
  'input',
  applyDuration
);


$('#advancedToggle').onclick =
  function () {
    $('#advancedPanel').classList.toggle(
      'hidden'
    );

    $('#advancedToggle span').textContent =
      $('#advancedPanel').classList.contains('hidden')
        ? '▼'
        : '▲';
  };


/* =========================
   创建会议
========================= */

form.addEventListener(
  'submit',
  async function (e) {
    e.preventDefault();

    submitError.textContent = '';

    const minutes =
      calculateDuration();

    if (!minutes) {
      return;
    }

    if (!startEl.value || !endEl.value) {
      timeError.textContent =
        '请完整填写会议时间';

      return;
    }

    /*
     * 使用兼容版 UUID，
     * 不再直接调用 crypto.randomUUID()
     */
    const idempotencyKey =
      generateUUID();

    createBtn.disabled = true;
    createBtn.textContent =
      '正在创建会议…';

    const body = {
      subject: form.subject.value,
      organizer: form.organizer.value,
      start_time: startEl.value,
      end_time: endEl.value,
      description: $('#description').value,
      idempotency_key: idempotencyKey,
      password:
        $('#meetingPassword').value ||
        undefined,
      only_user_join_type:
        $('#joinType').value ||
        undefined,
      auto_in_waiting_room:
        $('#waitingRoom').checked
    };

    try {
      const json = await postJSON(
        '/api/meetings',
        {
          method: 'POST',

          headers: {
            'X-Idempotency-Key':
              idempotencyKey
          },

          body: JSON.stringify(body)
        }
      );

      const template =
        await getInviteTemplate();

      const invite =
        buildInvite(
          template,
          json.data
        );

      renderResult(
        json.data,
        invite
      );

    } catch (error) {

      if (
        error.status === 409 &&
        error.data &&
        error.data.conflicts &&
        error.data.conflicts.length
      ) {
        const c =
          error.data.conflicts[0];

        submitError.textContent =
          '该时间段已有会议：' +
          c.subject +
          '（' +
          formatDateTime(
            c.start_time
          ) +
          ' - ' +
          formatDateTime(
            c.end_time
          ) +
          '）';

      } else {

        submitError.textContent =
          error.message ||
          '会议创建失败，请稍后重试';

      }

    } finally {

      createBtn.disabled = false;

      createBtn.textContent =
        '创建腾讯会议';
    }
  }
);


/* =========================
   初始化
========================= */

setDefaultTimes();
updateTimeUI();