(function () {
const api = window.api;

const $ = (sel) => document.querySelector(sel);

const statusText = $('#statusText');
const statusPill = $('#statusPill');
const bigStatus = $('#bigStatus');
const metaInfo = $('#metaInfo');
const startBtn = $('#startBtn');
const stopBtn = $('#stopBtn');
const openWebBtn = $('#openWebBtn');
const logPreview = $('#logPreview');
const logView = $('#logView');
const followLog = $('#followLog');
const clearLogBtn = $('#clearLog');
const resultsBody = $('#resultsBody');
const resultsHome = $('#resultsHome');
const harnessDirEl = $('#harnessDir');
const apiKey = $('#apiKey');
const sbStatus = $('#sbStatus');
const sbDot = $('#sbDot');
const sbTime = $('#sbTime');

let state = 'stopped';
let runStartTime = null;
let tPlusTimer = null;
const maxLogLines = 2000;
let logLines = [];

function fmtTime(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtDate(ms) {
  const d = new Date(ms);
  return d.toLocaleString('zh-CN', { hour12: false });
}

function fmtTPlus() {
  if (!runStartTime) return 'T+ --:--:--';
  const ms = Math.max(0, Date.now() - runStartTime);
  const s = Math.floor(ms / 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `T+ ${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

function startTPlusClock() {
  if (tPlusTimer) clearInterval(tPlusTimer);
  tPlusTimer = setInterval(() => { sbTime.textContent = fmtTPlus(); }, 1000);
}

function setState(s) {
  state = s;
  const running = s === 'running';
  statusPill.className = 'status-pill ' + s;
  statusText.textContent =
    s === 'running' ? '通讯已建立' : s === 'starting' ? '建立通讯中…' : s === 'stopping' ? '中断通讯中…' : '系统待命';
  bigStatus.textContent = s === 'running' ? '通讯已建立' : s === 'starting' ? '建立通讯中…' : '系统待命';
  bigStatus.className = 'big-status ' + (running ? 'running' : s === 'starting' ? 'starting' : 'stopped');
  sbDot.className = 'sb-dot ' + (running ? 'running' : s === 'starting' ? 'starting' : 'stopped');
  sbStatus.textContent =
    s === 'running' ? '与 Harness 通讯正常' : s === 'starting' ? '正在建立通讯…' : s === 'stopping' ? '正在中断通讯…' : '系统待命 · 等待指令';
  startBtn.disabled = running || s === 'starting';
  stopBtn.disabled = !running;
  openWebBtn.disabled = !running;
  if (running) {
    runStartTime = Date.now();
    startTPlusClock();
  } else {
    runStartTime = null;
    if (tPlusTimer) { clearInterval(tPlusTimer); tPlusTimer = null; }
    sbTime.textContent = 'T+ --:--:--';
  }
}

function appendLogs(lines) {
  for (const { t, stream, line } of lines) {
    logLines.push({ t, stream, line });
  }
  if (logLines.length > maxLogLines) logLines = logLines.slice(-maxLogLines);

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const frag = document.createDocumentFragment();
  for (const { t, stream, line } of lines) {
    const div = document.createElement('div');
    div.className = 'l-' + stream;
    div.innerHTML = `<span class="l-time">${fmtTime(t)}</span>${esc(line)}`;
    frag.appendChild(div);
  }
  logView.appendChild(frag);

  const previewText = logLines.slice(-12).map(({ line }) => line).join('\n');
  if (logPreview) logPreview.textContent = previewText || '（暂无信号）';

  if (followLog.checked) logView.scrollTop = logView.scrollHeight;
}

async function refreshStatus() {
  const st = await api.getStatus();
  harnessDirEl.textContent = st.harnessDir;
  if (st.state === 'running' || st.webUp) setState('running');
  else setState(st.state);
  metaInfo.textContent = `信道 ${st.port} · ${st.harnessDir}`;
  $('#sbPort').textContent = `端口 :${st.port}`;
}

async function loadResults() {
  const res = await api.listResults();
  resultsHome.textContent = res.home;
  if (res.dirs.length === 0) {
    resultsBody.innerHTML = '<tr><td colspan="4" class="empty">星域尚未产生数据，启动 Harness 后观测记录将出现在这里</td></tr>';
    return;
  }
  resultsBody.innerHTML = res.dirs
    .map(
      (d) => `<tr>
        <td>${d.name}</td>
        <td><span class="badge ${d.isDir ? 'dir' : 'file'}">${d.isDir ? '目录' : '文件'}</span></td>
        <td>${fmtDate(d.mtime)}</td>
        <td>${d.path}</td>
      </tr>`
    )
    .join('');
}

const THEME_KEY = 'dsh-theme';
const customColors = JSON.parse(localStorage.getItem('dsh-custom') || '{"accent":"#00D4AA","bg":"#0A0E1A"}');
const themeSelect = $('#themeSelect');
const customColorRow = $('#customColorRow');

function applyCustom() {
  const root = document.documentElement;
  root.style.setProperty('--accent', customColors.accent);
  root.style.setProperty('--cyan', customColors.accent);
  root.style.setProperty('--bg', customColors.bg);
  root.style.setProperty('--void', customColors.bg);
  root.style.setProperty('--nebula-navy', customColors.bg);
  $('#accentColor').value = customColors.accent;
  $('#bgColor').value = customColors.bg;
}

function setTheme(name) {
  const root = document.documentElement;
  root.setAttribute('data-theme', name);
  localStorage.setItem(THEME_KEY, name);
  if (themeSelect) themeSelect.value = name;
  if (customColorRow) customColorRow.hidden = name !== 'custom';
  // 紫月主题：启用双视频无缝循环背景层；其余主题暂停并隐藏该层
  // （init() 恢复本地保存主题时同样走此分支）
  if (window.__bgMoon) window.__bgMoon.setThemeActive(name === 'moon');
  if (name !== 'custom') {
    ['--accent', '--cyan', '--bg', '--void', '--nebula-navy'].forEach((p) => root.style.removeProperty(p));
  } else {
    applyCustom();
  }
}

// ---------- 事件 ----------
startBtn.addEventListener('click', async () => {
  const r = await api.startHarness();
  if (window.__starfield) window.__starfield.triggerMeteor();
  if (!r.ok) (window.__modal ? window.__modal.alert('启动失败：' + r.error, '星际通讯中断') : alert('启动失败: ' + r.error));
  setState('starting');
  refreshStatus();
});

stopBtn.addEventListener('click', async () => {
  await api.stopHarness();
  setState('stopping');
  setTimeout(refreshStatus, 1500);
});

openWebBtn.addEventListener('click', () => api.openWeb());
clearLogBtn.addEventListener('click', () => {
  logLines = [];
  logView.textContent = '';
  if (logPreview) logPreview.textContent = '（暂无信号）';
});

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!btn.dataset.page) return; // dock 按钮（GitHub/MCP/技能）不走页面切换
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
    $('#page-' + btn.dataset.page).classList.add('active');
    if (btn.dataset.page === 'results') loadResults();
  });
});

$('#themeSelect').addEventListener('change', (e) => setTheme(e.target.value));

$('#applyCustom').addEventListener('click', () => {
  customColors.accent = $('#accentColor').value;
  customColors.bg = $('#bgColor').value;
  localStorage.setItem('dsh-custom', JSON.stringify(customColors));
  setTheme('custom');
});

apiKey.addEventListener('change', async () => {
  const key = apiKey.value.trim();
  const status = $('#apiKeyStatus');
  if (!key) return;
  status.textContent = '正在保存…';
  const r = await api.setApiKey(key);
  if (r.ok) {
    status.textContent =
      r.live === 'ok'
        ? '已保存到 ~/.dsh/.env，并同步到运行中的 Harness 凭据服务 ✓'
        : r.live
          ? `已写入 ~/.dsh/.env（运行中的 Harness 同步失败：${r.live}）`
          : '已保存到 ~/.dsh/.env，下次启动 Harness 时生效';
    apiKey.value = '';
  } else {
    status.textContent = '保存失败: ' + r.error;
  }
});

(async function loadApiKeyStatus() {
  const r = await api.getApiKey();
  const status = $('#apiKeyStatus');
  if (r.ok) {
    status.textContent = r.configured
      ? '已配置 DEEPSEEK_API_KEY ✓（粘贴新密钥可直接覆盖）'
      : '尚未配置 DEEPSEEK_API_KEY，输入密钥后自动保存';
  }
})();

// ---------- 初始化 ----------
(async function init() {
  if (window.__starfield) window.__starfield.start();
  const saved = localStorage.getItem(THEME_KEY) || 'dark';
  if (saved === 'custom') setTheme('custom');
  else setTheme(saved);
  setState('stopped');
  sbTime.textContent = 'T+ --:--:--';
  await refreshStatus();
  const logs = await api.getLogs();
  if (logs.length) appendLogs(logs);
  logView.scrollTop = logView.scrollHeight;
  // 默认定位到最近对话内容（而非仪表盘）
  document.querySelector('.nav-btn[data-page="chat"]')?.click();
})();

api.onState((s) => {
  setState(s);
  if (s === 'running') setTimeout(refreshStatus, 500);
});
api.onLog((lines) => appendLogs(lines));

setInterval(refreshStatus, 5000);
})();
