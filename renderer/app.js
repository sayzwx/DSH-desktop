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
const winIndicator = $('#winIndicator');
const winIndicatorText = $('#winIndicatorText');

// ---------- 窗口自动检测指示器（需求#3） ----------
// 主进程会广播本应用创建的所有 BrowserWindow（含辅助/弹窗）。这里实时显示数量与标题，
// 任何“开了个窗口却看不到”的情况都能在侧边栏立刻发现。
function renderWindows(list) {
  if (!winIndicator || !winIndicatorText) return;
  const wins = Array.isArray(list) ? list : [];
  const visible = wins.filter((w) => w.visible);
  if (wins.length === 0) {
    winIndicator.hidden = true;
    return;
  }
  winIndicator.hidden = false;
  const shown = visible.length > 0 ? `${visible.length} 可见` : '';
  const total = wins.length;
  winIndicatorText.textContent = `${total} 窗口${shown ? ` · ${shown}` : ''}`;
  const lines = wins.map((w) => `  · [${w.kind === 'main' ? '主' : '辅'}] ${w.title || w.label}${w.visible ? '（可见）' : '（窗口已隐藏，服务后台运行中）'}`);
  winIndicator.title = `当前应用窗口（${total}）：\n${lines.join('\n')}\n\n点击打开主窗口`;
}

// 首次加载 + 实时更新
api.listWindows().then((r) => { if (r && r.ok) renderWindows(r.windows); }).catch(() => {});
api.onWindowsChanged((list) => renderWindows(list));
if (winIndicator) {
  winIndicator.addEventListener('click', () => { api.showWindow(); });
}

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
  const busy = s === 'starting' || s === 'installing'; // 安装引擎与建立通讯共用"进行中"视觉
  statusPill.className = 'status-pill ' + (busy ? 'starting' : s);
  statusText.textContent =
    s === 'running' ? '通讯已建立' : s === 'starting' ? '建立通讯中…' : s === 'installing' ? '正在获取引擎…' : s === 'stopping' ? '中断通讯中…' : '系统待命';
  bigStatus.textContent = s === 'running' ? '通讯已建立' : s === 'starting' ? '建立通讯中…' : s === 'installing' ? '正在获取引擎…' : '系统待命';
  bigStatus.className = 'big-status ' + (running ? 'running' : busy ? 'starting' : 'stopped');
  sbDot.className = 'sb-dot ' + (running ? 'running' : busy ? 'starting' : 'stopped');
  sbStatus.textContent =
    s === 'running' ? '与 Harness 通讯正常' : s === 'starting' ? '正在建立通讯…' : s === 'installing' ? '正在获取 Harness 引擎…' : s === 'stopping' ? '正在中断通讯…' : '系统待命 · 等待指令';
  startBtn.disabled = running || busy;
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
    resultsBody.innerHTML = '<tr><td colspan="5" class="empty">星域尚未产生数据，启动 Harness 后观测记录将出现在这里</td></tr>';
    return;
  }
  resultsBody.innerHTML = res.dirs
    .map(
      (d) => `<tr title="${escAttr(d.path)}">
        <td class="cell-name"><span class="name-text">${escHtml(d.name)}</span>${copyBtn(d.path)}</td>
        <td><span class="badge ${d.isDir ? 'dir' : 'file'}">${d.isDir ? '目录' : '文件'}</span></td>
        <td class="cell-desc">${describeEntry(d)}</td>
        <td>${fmtDate(d.mtime)}</td>
        <td class="cell-path" title="${escAttr(d.path)}">${escHtml(d.path)}</td>
      </tr>`
    )
    .join('');
  // 行点击复制路径（除按钮外）——给星图档案一个额外便利：双击行也能复制
  resultsBody.querySelectorAll('tr').forEach((tr) => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('.copy-btn')) return;
      const path = tr.getAttribute('title');
      if (path) navigator.clipboard?.writeText(path).catch(() => {});
    });
  });
  // 复制按钮：单独处理 + 给视觉反馈
  resultsBody.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const text = btn.getAttribute('data-copy');
      if (!text) return;
      try { await navigator.clipboard.writeText(text); btn.classList.add('copied'); btn.textContent = '✓'; }
      catch { btn.textContent = '✗'; }
      setTimeout(() => { btn.classList.remove('copied'); btn.textContent = '📋'; }, 1200);
    });
  });
}

// 文件/目录用途推断——给星图档案加可读性
function describeEntry(d) {
  if (d.isDir) {
    const map = {
      'storages': '持久化键值存储（会话索引 / 工作区元数据）',
      'sessions': '会话数据：按会话 ID 分目录存放',
      'plugins': '已装插件扩展目录',
      'logs': '运行日志（按日轮转）',
    };
    return map[d.name] || '数据子目录';
  }
  const n = d.name.toLowerCase();
  if (n === 'settings.yaml') return 'Harness 配置（提供商/凭据引用/默认 agent 等）';
  if (n === '.credentials.yaml') return '凭据存储（API Key 明文，本机安全）';
  if (n === '.github-ssh.json') return 'GitHub SSH 密钥配置（自管）';
  if (n === 'session_projcache.json') return '会话项目缓存（最近打开的工作区）';
  if (n === 'workspace.json') return '当前激活工作区记录';
  if (n === 'zen-ua-proxy.mjs') return 'OpenCode Zen UA 改写代理（解决免费模型 429）';
  if (n === 'zen-ua-proxy.log') return 'zen-ua 代理运行日志';
  if (n.endsWith('.log')) return '运行日志';
  if (n.endsWith('.json')) return 'JSON 数据';
  if (n.endsWith('.yaml') || n.endsWith('.yml')) return 'YAML 配置';
  return '文件';
}
function escHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function escAttr(s) { return escHtml(s); }
function copyBtn(text) {
  return `<button class="copy-btn" title="复制路径" data-copy="${escAttr(text)}">📋</button>`;
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
  else if (r.installing) setState('installing');
  else setState('starting');
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
        : (typeof r.live === 'string' && r.live.includes('read-only by the launching environment'))
          ? '已保存到 ~/.dsh/.env；当前 Harness 以「启动环境只读」提供该密钥（多为 Windows 环境变量 DEEPSEEK_API_KEY）。重启桌面端后即由凭据服务接管并实时同步 ✓（建议顺带从系统/用户环境变量里移除该条目）'
          : r.live
            ? `已写入 ~/.dsh/.env（运行中的 Harness 同步失败：${r.live}；重启桌面端后生效）`
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

// ---------- 后台与退出（需求#4） ----------
$('#bgHideBtn')?.addEventListener('click', async () => {
  await api.hideToTray();
  (window.__modal ? window.__modal.alert('已隐藏到托盘，Harness 服务继续在后台运行。\n点击任务栏托盘的 DSH 图标可随时唤回主窗口。', '后台运行中') : alert('已隐藏到托盘，服务继续运行'));
});
$('#bgQuitServiceBtn')?.addEventListener('click', () => {
  if (window.__modal) {
    window.__modal.confirm('确认停止 Harness 服务并退出 DSH 桌面端？', '停止服务并退出', { okText: '确认停止并退出' }).then((ok) => { if (ok) api.quitWithService(); });
  } else if (window.confirm('确认停止 Harness 服务并退出 DSH 桌面端？')) {
    api.quitWithService();
  }
});
$('#bgQuitOnlyBtn')?.addEventListener('click', () => {
  if (window.__modal) {
    window.__modal.confirm('仅退出应用（保留后台 Harness 服务）？\n下次启动将自动接管 :3080，会话不中断。', '仅退出应用', { okText: '仅退出' }).then((ok) => { if (ok) api.quitBackgroundOnly(); });
  } else if (window.confirm('仅退出应用（保留后台 Harness 服务）？\n下次启动将自动接管 :3080，会话不中断。')) {
    api.quitBackgroundOnly();
  }
});

setInterval(refreshStatus, 5000);
})();
