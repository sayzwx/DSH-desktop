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
const consoleOpenWebBtn = $('#consoleOpenWebBtn');
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
  // 侧栏仅 64px：正文只放数字，细节全在 title（含"几可见 / 哪些是辅助窗口"）
  winIndicatorText.textContent = `${total}${shown && visible.length !== total ? '·' + visible.length : ''}`;
  const total = wins.length;
  winIndicatorText.textContent = `${total}`;
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
  // 侧栏里的状态胶囊放不下整句（64px 宽），CSS 里只留指示灯；完整文案进 title
  if (statusPill) statusPill.title = statusText.textContent;
  startBtn.disabled = running || busy;
  stopBtn.disabled = !running;
  openWebBtn.disabled = !running;
  if (consoleOpenWebBtn) consoleOpenWebBtn.disabled = !running;
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
// 主题清单：新增或删除**内置**主题时改这里（index.html 的下拉是兜底静态项，运行时会重建）。
// light / graphite 是两套基础主题（配色对齐官方 webUI），dark 是产品默认皮肤。
const THEMES = ['light', 'graphite', 'dark', 'custom'];
const DEFAULT_THEME = 'graphite';
// 迁移自插件市场的 WebUI 主题（主题工作室产出）也是可选主题，但它们不在上面的常量里：
// 清单来自 ~/.dsh/desktop-themes.json（主进程读），运行时装到 webThemes。
// 它们的 data-theme 一律是 'webtheme'（承接层所在），具体配色靠 <html> 上的内联变量区分。
const WEB_SLOT = 'webtheme';
const customColors = JSON.parse(localStorage.getItem('dsh-custom') || '{"accent":"#00D4AA","bg":"#0A0E1A"}');
const themeSelect = $('#themeSelect');
const customColorRow = $('#customColorRow');

/** 已迁移的 WebUI 主题列表（每项：{id,label,tokens,css,notes,origin}）。 */
let webThemes = [];
/** 当前注入到 <html> 上的 token 属性名，切换主题时要先清干净，否则会残留上一个主题的色。 */
let webThemeApplied = [];

// 本地保存的主题名可能指向一个已被删除的主题（例如旧版的紫月 / 极光 / 彗星金，
// 或已被卸载的 WebUI 迁移主题）：那时 data-theme 谁都匹配不上，整页只剩基础 :root
// 的深空配色，表现就像「主题坏了」。统一在这里回落到默认主题。
function isWebTheme(name) {
  // 迁移主题的 id 形如 `dsh-neo-skin:blue:light`，一定带冒号；内置主题名不带。
  return typeof name === 'string' && name.includes(':') && webThemes.some((t) => t.id === name);
}
function normalizeTheme(name) {
  if (THEMES.includes(name)) return name;
  return DEFAULT_THEME;
}

/** 注入迁移主题的 CSS 用的 <style>（只建一次，切换时改 textContent）。 */
function webStyleEl() {
  let el = document.getElementById('webThemeStyle');
  if (!el) {
    el = document.createElement('style');
    el.id = 'webThemeStyle';
    document.head.appendChild(el);
  }
  return el;
}

/** 清掉上一次迁移主题留下的一切（内联变量 + 注入的 CSS）。 */
function clearWebTheme() {
  const root = document.documentElement;
  for (const p of webThemeApplied) root.style.removeProperty(p);
  webThemeApplied = [];
  const el = document.getElementById('webThemeStyle');
  if (el) el.textContent = '';
}

/**
 * 应用一个迁移主题。
 *
 * 关键点：变量必须写在 `<html>` 的**内联 style** 上。承接层
 * `:root[data-theme="webtheme"]` 里的 89 条是"官方浅色档默认值"，
 * 只有内联声明才盖得过它（内联 style 优先级高于任何选择器）。
 * 主题包没声明的变量会自然回落到承接层的默认值，不会变空串。
 */
function applyWebTheme(theme) {
  clearWebTheme();
  if (!theme) return;
  const root = document.documentElement;
  const rootVars = getComputedStyle(root);
  let n = 0;
  for (const [k, v] of Object.entries(theme.tokens || {})) {
    if (typeof v !== 'string' || !v.trim()) continue;
    const isDsw = /^--dsw-[a-z0-9-]+$/.test(k);
    // 桌面端自己的变量同样要应用：模型在做承接时经常给出 --panel / --text / --accent 这类
    // （没有官方 --dsw-* 对应物的观感，只能这么表达）。但要**确认它真的存在** ——
    // 凭空造的变量名应用了也没有任何效果，只会让用户以为"精修成功了"。
    const isDesktop = !isDsw && /^--[a-z0-9-]+$/.test(k) && rootVars.getPropertyValue(k).trim() !== '';
    if (!isDsw && !isDesktop) continue;
    root.style.setProperty(k, v.trim());
    webThemeApplied.push(k);
    n++;
  }
  webStyleEl().textContent = theme.css || '';
  return n;
}

/** 重建主题下拉：内置四项 + （有迁移主题时）一个 WebUI 主题分组。 */
function rebuildThemeOptions() {
  if (!themeSelect) return;
  const builtin = [['light', '浅色'], ['graphite', '深色'], ['dark', '深空'], ['custom', '自定义']];
  let html = builtin.map(([v, l]) => `<option value="${v}">${escHtml(l)}</option>`).join('');
  if (webThemes.length) {
    html += '<optgroup label="WebUI 主题（来自插件市场）">'
      + webThemes.map((t) => `<option value="${escAttr(t.id)}">${escHtml(t.label || t.id)}</option>`).join('')
      + '</optgroup>';
  }
  themeSelect.innerHTML = html;
}

/** 从主进程拉一次迁移主题清单（主题工作室安装完也要调它刷新）。 */
async function refreshWebThemes() {
  if (!api.themeList) return webThemes;
  try {
    const r = await api.themeList();
    webThemes = (r && r.ok && Array.isArray(r.themes)) ? r.themes : [];
  } catch {
    webThemes = [];
  }
  rebuildThemeOptions();
  // 当前生效的迁移主题被移除时不能停在 webtheme 空壳上（那会只剩承接层的官方浅色档
  // 默认值，看起来像"主题坏了"）——直接回落到默认主题。
  const saved = localStorage.getItem(THEME_KEY);
  if (saved && saved.includes(':') && !webThemes.some((t) => t.id === saved)) {
    setTheme(DEFAULT_THEME);
  }
  return webThemes;
}

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

/**
 * 让系统级窗口边框（Windows 标题栏）跟随应用主题。
 * 之前标题栏只跟系统设置走：应用切浅色它还是白的、切深色还是黑的，看起来"顶框独立于主题"。
 * Electron 的 nativeTheme.themeSource 正是按应用（而非系统）声明配色倾向的开关。
 */
function syncNativeTheme(theme, web) {
  if (!api.setNativeTheme) return;
  let tone = 'dark';
  if (theme === 'light') tone = 'light';
  else if (theme === 'webtheme') tone = (web && web.origin && web.origin.tone === 'light') ? 'light' : 'dark';
  // graphite / dark / custom 都是深底
  try { api.setNativeTheme(tone); } catch { /* 主进程不可达时静默：只是标题栏颜色不对，不影响功能 */ }
}

function setTheme(name) {
  const root = document.documentElement;
  const web = isWebTheme(name) ? webThemes.find((t) => t.id === name) : null;
  const theme = web ? WEB_SLOT : normalizeTheme(name);
  root.setAttribute('data-theme', theme);
  // 本地存的是「有效的主题标识」：内置主题名，或迁移主题的完整 id
  localStorage.setItem(THEME_KEY, web ? web.id : theme);
  if (themeSelect) themeSelect.value = web ? web.id : theme;
  if (customColorRow) customColorRow.hidden = theme !== 'custom';
  // 浅色 / 深色 / 深空之外的迁移主题都不带动态壁纸，切换时需要停掉视频与星域画布
  // （init() 恢复本地保存主题时同样走此分支）
  if (window.__starfield) window.__starfield.setTheme();
  // 先清掉上一次的注入（自定义主题用的是内联变量，同样要清）
  if (theme !== 'custom') {
    ['--accent', '--cyan', '--bg', '--void', '--nebula-navy'].forEach((p) => root.style.removeProperty(p));
  }
  if (theme === 'custom') {
    clearWebTheme();
    applyCustom();
  } else {
    applyWebTheme(web); // web 为空时只做 clearWebTheme
  }
  // 让窗口边框（Windows 标题栏）跟着主题走：深色主题配深色标题栏，浅色配浅色。
  // 之前标题栏跟系统走 —— 应用里切到浅色它还是白的、切到深色还是黑的，看起来"顶框独立"。
  syncNativeTheme(theme, web);
  // canvas 画的图（仪表盘用量图）颜色不会随 CSS 变量变，必须重绘一次
  window.dispatchEvent(new CustomEvent('dsh:theme-changed', { detail: { theme, id: name } }));
  return theme;
}

// 供主题工作室调用：安装完迁移主题后刷新下拉并立刻切过去
window.__dshThemes = {
  refresh: refreshWebThemes,
  list: () => webThemes,
  apply: (id) => setTheme(id),
};

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
// 控制台「发射控制」卡里的「打开 Web 端」：与侧栏底部那颗等价，只是更顺手（2026-09-29 用户要求）
if (consoleOpenWebBtn) consoleOpenWebBtn.addEventListener('click', () => api.openWeb());
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
  // 先取迁移主题清单再恢复主题：否则本地保存的是一个迁移主题 id 时，
  // isWebTheme 还看不到它，会被 normalizeTheme 静默回落成深色。
  await refreshWebThemes();
  const saved = localStorage.getItem(THEME_KEY) || DEFAULT_THEME;
  setTheme(saved);
  setState('stopped');
  sbTime.textContent = 'T+ --:--:--';
  await refreshStatus();
  const logs = await api.getLogs();
  if (logs.length) appendLogs(logs);
  logView.scrollTop = logView.scrollHeight;
  // 启动后停在「控制台」（2026-09-29 用户要求：不要一打开就跳到对话/网页端）。
  // 引擎由主进程在应用启动时自动拉起，状态与日志都会实时出现在本页；
  // 需要网页版 Harness 时用本页「发射控制」里的「打开 Web 端」按钮。
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

// ---------------- 应用菜单 / 快捷键动作 ----------------
// 菜单与 accelerator 在主进程（见 main.js 的 buildApplicationMenu），动作转发到这里执行。
// 一律复用页面上既有的控件与逻辑，不在菜单路径上重写一遍启停与确认对话框——
// 两条入口各写一份，行为迟早分叉。
api.onMenuAction((a) => {
  if (!a || !a.action) return;
  const click = (sel) => document.querySelector(sel)?.click();
  switch (a.action) {
    case 'navigate':
      click(`.nav-btn[data-page="${a.page}"]`);
      break;
    case 'newSession':
      // 新会话按钮在对话页，先切过去再点，否则用户看不到结果
      click('.nav-btn[data-page="chat"]');
      click('#chatNewSession');
      break;
    case 'focusSearch':
      // 搜索框归对话页管，用事件解耦，这里不需要知道它的存在
      click('.nav-btn[data-page="chat"]');
      window.dispatchEvent(new CustomEvent('dsh:focus-session-search'));
      break;
    case 'hideToTray':
      api.hideToTray();
      break;
    case 'quitWithService':
      click('#bgQuitServiceBtn'); // 走设置页那颗按钮，保留它的二次确认
      break;
    case 'startHarness':
      click('#startBtn');
      break;
    case 'stopHarness':
      click('#stopBtn');
      break;
    case 'restartHarness':
      api.stopHarness().then(() => api.startHarness());
      break;
    case 'openWeb':
      click('#openWebBtn');
      break;
    case 'about':
      if (window.__modal) {
        window.__modal.alert(
          `DSH Desktop v${a.version || ''}\n引擎目录：${a.engine || '（未探测到）'}\n\nDeepSeek Harness 的社区桌面封装。`,
          '关于 DSH Desktop',
        );
      }
      break;
    default:
      break;
  }
});

setInterval(refreshStatus, 5000);
})();
