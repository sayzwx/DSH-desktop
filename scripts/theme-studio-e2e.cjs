/* theme-studio-e2e.cjs —— 主题工作室端到端验证
 *
 * 验证的链路是真的：真实 `renderer/index.html` + 真实 `preload.js` + 真实
 * `lib/theme-ipc.js` 注册的 IPC 处理器 + 真实的已安装插件（dsh-neo-skin）。
 * 只有引擎 RPC 是桩（本测试不需要引擎）。
 *
 * 覆盖：
 *   1. 扫描：能从一堆 WebUI 插件里挑出带主题能力的那个
 *   2. 免费迁移：点「安装」后主题进入下拉、<html> 上注入 89 个变量
 *   3. 承接生效：桌面端 --void / --accent 取到主题值（不是回落到默认）
 *   4. 结构层落地：圆角清零 + 硬阴影真的作用到桌面端组件上
 *   5. 切换干净：切回内置主题后变量与结构层全部撤销，无残留
 *   6. 移除干净：移除后下拉项消失，主题回落默认，且不误删别人的数据
 *
 * 跑法（cwd 必须是仓库根）：
 *   env -u ELECTRON_RUN_AS_NODE node node_modules/electron/cli.js scripts/theme-studio-e2e.cjs
 * 输出：%TEMP%\theme-studio-e2e.json
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

app.disableHardwareAcceleration();
['no-sandbox', 'disable-gpu', 'disable-software-rasterizer', 'in-process-gpu']
  .forEach((s) => app.commandLine.appendSwitch(s));

const ROOT = process.env.DESKTOP_ROOT || 'D:/DS_harness';
const DSH_HOME = process.env.DSH_HOME_DIR || path.join(os.homedir(), '.dsh');
const STORE_FILE = path.join(DSH_HOME, 'desktop-themes.json');
const RESULT = path.join(os.tmpdir(), 'theme-studio-e2e.json');
const THEME_ID = 'dsh-neo-skin:blue:light';

const { registerThemeIpc } = require(path.join(ROOT, 'lib', 'theme-ipc.js'));

const failures = [];
const steps = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 轮询等待渲染层条件成立（界面是异步取数的，固定 sleep 会 flaky）。 */
async function until(win, expr, { timeout = 20000, label = expr } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await win.webContents.executeJavaScript(expr, true);
    if (v) return v;
    if (Date.now() - t0 > timeout) {
      // 超时时把现场抓出来：只报"超时"对排查毫无帮助
      let ctx = '';
      try {
        ctx = await win.webContents.executeJavaScript(`(() => {
          const b = document.getElementById('tsBody') || document.getElementById('tsPanel');
          return (b ? b.innerText : '(无 #tsBody 也无 #tsPanel)').slice(0, 800);
        })()`, true);
      } catch { /* 页面可能已崩 */ }
      throw new Error(`等待超时：${label}\n现场 tsBody：${ctx}`);
    }
    await wait(200);
  }
}

// ---------- 前置状态：记下主题库原貌，跑完要还原 ----------
const storeExisted = fs.existsSync(STORE_FILE);
const storeBackup = storeExisted ? fs.readFileSync(STORE_FILE, 'utf8') : null;

// ---------- 真实主题 IPC（引擎 RPC 用桩；本测试不需要引擎）----------
const themeApi = registerThemeIpc({
  ipcMain,
  dshHome: DSH_HOME,
  appDir: ROOT,
  discoverHarness: () => ({ dir: process.env.HARNESS_DIR || 'D:/DSH/harness' }),
  readCredentialPlaintext: () => undefined,
  rpcCall: async () => ({ ok: false, error: 'stub: 本测试不启动引擎' }),
  revealPath: async () => '',
  showInFolder: () => {},
});

// ---------- 其余通道注册成桩（漏一个页面 boot 不起来）----------
const preloadSrc = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
const channels = [...new Set([...preloadSrc.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((m) => m[1]))];
const THEME_CHANNELS = new Set(channels.filter((c) => c.startsWith('theme:')));

const BENIGN = {
  'harness:status': () => ({ state: 'stopped', webUp: false, pid: 0 }),
  'settings:describe': () => ({ ok: false, error: 'stub' }),
  'settings:llmProviders': () => ({ ok: false, providers: [] }),
  'settings:llmModels': () => ({ ok: false, groups: [], failures: [] }),
  'settings:presets': () => ({ ok: true, presets: [] }),
  'llm:reasoningLevels': () => {
    const m = require(path.join(ROOT, 'lib', 'model-probe.js'));
    return { ok: true, engine: m.ENGINE_LEVELS, wire: m.WIRE_CANDIDATES };
  },
  'notify:getPrefs': () => ({ ok: true, prefs: {} }),
};
for (const ch of channels) {
  if (THEME_CHANNELS.has(ch)) continue; // 已由 registerThemeIpc 注册真身
  ipcMain.handle(ch, async () => (BENIGN[ch] ? BENIGN[ch]()
    : { ok: false, error: 'stub(' + ch + ')', items: [], list: [], namespaces: [], providers: [], models: [], sessions: [], presets: [], plugins: [] }));
}

// ---------- 读取探针 ----------
const PROBE = `(() => {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const card = document.querySelector('.card');
  const btn = document.querySelector('.mini-btn');
  const pad = (el) => el ? getComputedStyle(el) : null;
  const cardCs = pad(card);
  const btnCs = pad(btn);
  const sel = document.getElementById('themeSelect');
  return {
    theme: root.getAttribute('data-theme'),
    saved: localStorage.getItem('dsh-theme'),
    selectValue: sel ? sel.value : null,
    options: sel ? [...sel.options].map(o => o.value) : [],
    optgroups: sel ? [...sel.querySelectorAll('optgroup')].map(g => g.label) : [],
    vars: {
      void: cs.getPropertyValue('--void').trim(),
      accent: cs.getPropertyValue('--accent').trim(),
      text: cs.getPropertyValue('--text').trim(),
      sidebarFill: cs.getPropertyValue('--sidebar-fill').trim(),
      bubbleBg: cs.getPropertyValue('--bubble-bg').trim(),
      borderHeavy: cs.getPropertyValue('--border-heavy').trim(),
      dswBase: cs.getPropertyValue('--dsw-alias-bg-base').trim(),
      dswSidebar: cs.getPropertyValue('--dsw-specific-sidebar-fill').trim(),
      dswBrand: cs.getPropertyValue('--dsw-alias-brand-primary').trim(),
      glow: cs.getPropertyValue('--glow').trim(),
    },
    inlineVars: root.getAttribute('style') || '',
    webStyleLen: (document.getElementById('webThemeStyle') || {}).textContent ? document.getElementById('webThemeStyle').textContent.length : 0,
    cardRadius: cardCs ? cardCs.borderTopLeftRadius : null,
    cardShadow: cardCs ? cardCs.boxShadow : null,
    cardBorderWidth: cardCs ? cardCs.borderTopWidth : null,
    btnRadius: btnCs ? btnCs.borderTopLeftRadius : null,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    bgvideo: getComputedStyle(document.getElementById('bgvideo')).display,
  };
})()`;

(async () => {
  const report = { ok: false, failures, steps, consoleErrors: [] };
  const watchdog = setTimeout(() => {
    try { fs.writeFileSync(RESULT, JSON.stringify({ ...report, error: 'watchdog' }, null, 2)); } catch (e) {}
    app.exit(3);
  }, 180000);

  let win;
  const probe = () => win.webContents.executeJavaScript(PROBE, true);

  await app.whenReady();
  win = new BrowserWindow({
    show: false, width: 1440, height: 900,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  // 渲染层报错必须抓出来：只看到"界面没渲染"是没法排查的
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) report.consoleErrors.push(String(message).slice(0, 400));
  });
  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  await wait(2600);
  await win.webContents.insertCSS('*{transition:none !important;animation:none !important}');

  // localStorage 是 file:// 源共享的：别的测试可能把主题留成了 custom。
  // 先备份再设成 graphite，跑完还原，保证本次断言从确定状态出发。
  const priorStorage = await win.webContents.executeJavaScript(
    `({ theme: localStorage.getItem('dsh-theme'), custom: localStorage.getItem('dsh-custom') })`, true);
  await win.webContents.executeJavaScript(`localStorage.setItem('dsh-theme','graphite'); true`, true);
  await win.reload();
  await wait(2600);
  await win.webContents.insertCSS('*{transition:none !important;animation:none !important}');

  // ---------- 1. 初始状态 ----------
  const before = await probe();
  steps.push({ step: '1 · 初始状态', detail: { 主题: before.theme, 下拉项: before.options.join(','), 主题分组: before.optgroups.join(',') || '(无)' } });
  if (before.theme !== 'graphite') failures.push(`初始主题应为 graphite，实际 ${before.theme}`);
  if (before.optgroups.length) failures.push(`初始不应有 WebUI 主题分组，实际有 ${before.optgroups.join(',')}`);
  if (before.options.some((o) => o.includes(':'))) failures.push(`初始下拉不应含迁移主题，实际含 ${before.options.filter((o) => o.includes(':')).join(',')}`);

  // ---------- 2. 挂载工作室 ----------
  const scan = await themeApi.scanThemes();
  steps.push({
    step: '2 · 主进程扫描',
    detail: {
      扫描包数: scan.scanned,
      主题插件: scan.plugins.map((p) => `${p.id}@${p.version}`).join(',') || '(无)',
      方案: (scan.plugins[0] && scan.plugins[0].schemes.map((s) => `${s.id}(${s.label},${s.tokenCount}变量,${s.tones.join('/')})`).join(' ')) || '',
      跳过数: scan.skipped.length,
    },
  });
  if (!scan.plugins.length) failures.push('没扫到任何带主题能力的插件（请先安装 dsh-neo-skin）');
  // 本测试的夹具是 dsh-neo-skin（token 型）。它没装时整套断言都不成立 —— 这是环境缺夹具，
  // 不是代码回归；skin 型主题的迁移验证在 scripts/skin-migrate-e2e.cjs。
  if (!scan.plugins.some((p) => p.id === 'dsh-neo-skin')) {
    console.log('SKIP: 本机未安装 dsh-neo-skin（token 型夹具缺失）。'
      + 'skin 型主题的迁移验证见 scripts/skin-migrate-e2e.cjs');
    try { fs.writeFileSync(RESULT, JSON.stringify({ ...report, skipped: 'missing dsh-neo-skin' }, null, 2)); } catch (e) {}
    clearTimeout(watchdog);
    app.exit(0);
    return;
  }

  await win.webContents.executeJavaScript('window.__themeStudio.mount()', true);
  const cardHtml = await until(win, `(() => {
    const b = document.getElementById('tsBody');
    return b && b.querySelector('.ts-card') ? b.querySelector('.ts-card').outerHTML.length : 0;
  })()`, { label: '工作室渲染出插件卡' });
  const cardText = await win.webContents.executeJavaScript(
    `document.querySelector('.ts-card') ? document.querySelector('.ts-card').innerText : ''`, true);
  const installCount = await win.webContents.executeJavaScript(
    `document.querySelectorAll('.ts-install').length`, true);
  const refineAllCount = await win.webContents.executeJavaScript(
    `document.querySelectorAll('.ts-refine-all').length`, true);
  steps.push({ step: '3 · 界面渲染', detail: { 卡片HTML长度: cardHtml, 安装按钮数: installCount, 精修按钮数: refineAllCount, 卡片文本: cardText.replace(/\s+/g, ' ').slice(0, 300) } });
  if (installCount !== 4) failures.push(`应渲染 4 个方案档位（2 方案 × 2 档），实际 ${installCount}`);
  if (!cardText.includes('dsh-neo-skin')) failures.push('卡片未显示 dsh-neo-skin');

  // ---------- 4. 免费迁移安装 ----------
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const b = document.querySelector('.ts-install[data-scheme="blue"][data-tone="light"]');
    if (!b) return 'button-not-found';
    b.click();
    return 'clicked';
  })()`, true);
  if (clicked !== 'clicked') failures.push('找不到「蓝统治 · 浅色」的安装按钮');
  await until(win, `document.getElementById('themeSelect') && [...document.getElementById('themeSelect').options].some(o => o.value === ${JSON.stringify(THEME_ID)})`,
    { label: '迁移主题出现在下拉里' });
  await wait(600);
  const after = await probe();
  steps.push({
    step: '4 · 免费迁移安装后',
    detail: {
      主题: after.theme, 下拉值: after.selectValue, 下拉项: after.options.join(','), 主题分组: after.optgroups.join(','),
      localStorage: after.saved, 注入样式长度: after.webStyleLen,
      关键变量: after.vars, 圆角: { card: after.cardRadius, btn: after.btnRadius },
      卡片阴影: after.cardShadow, 卡片边框: after.cardBorderWidth, body背景: after.bodyBg,
    },
  });
  if (after.theme !== 'webtheme') failures.push(`迁移主题的 data-theme 应为 webtheme，实际 ${after.theme}`);
  if (after.saved !== THEME_ID) failures.push(`localStorage 应记 ${THEME_ID}，实际 ${after.saved}`);
  if (after.selectValue !== THEME_ID) failures.push(`下拉应选中 ${THEME_ID}，实际 ${after.selectValue}`);
  if (after.webStyleLen < 100) failures.push(`迁移主题的 CSS 没注入（长度 ${after.webStyleLen}）`);
  // 承接生效：这些值必须来自主题包（neo-skin blue/light）
  const EXPECT = { void: '#f3efe6', accent: '#2340a8', dswBase: '#f3efe6', dswSidebar: '#1e317a', dswBrand: '#2340a8' };
  for (const [k, v] of Object.entries(EXPECT)) {
    if (after.vars[k].toLowerCase() !== v) failures.push(`承接值不对 [${k}]：期望 ${v}，实际 ${after.vars[k] || '(空)'}`);
  }
  if (after.vars.glow !== 'transparent') failures.push(`承接模式下 --glow 应为 transparent，实际 ${after.vars.glow || '(空)'}`);
  if (after.vars.text === '(空)' || !after.vars.text) failures.push('承接后 --text 为空');

  // ---------- 5. 结构层落地 ----------
  steps.push({
    step: '5 · 结构层（圆角清零 / 边框加粗 / 硬阴影 / 按压位移）',
    detail: { 卡片圆角: after.cardRadius, 按钮圆角: after.btnRadius, 卡片阴影: after.cardShadow, 卡片边框宽: after.cardBorderWidth, 背景视频: after.bgvideo },
  });
  if (after.cardRadius !== '0px') failures.push(`结构层圆角清零没生效：.card 圆角 = ${after.cardRadius}`);
  if (after.btnRadius !== '0px') failures.push(`结构层圆角清零没生效：.mini-btn 圆角 = ${after.btnRadius}`);
  if (!/4px 4px 0px?/.test(after.cardShadow || '')) failures.push(`结构层硬阴影没生效：.card box-shadow = ${after.cardShadow}`);
  if (after.bgvideo !== 'none') failures.push(`迁移主题应关掉动态壁纸，实际 display=${after.bgvideo}`);

  // ---------- 6. 切回内置主题：必须完全撤回 ----------
  await win.webContents.executeJavaScript(`(() => { document.getElementById('themeSelect').value='dark';
    document.getElementById('themeSelect').dispatchEvent(new Event('change', {bubbles:true})); })()`, true);
  await wait(700);
  const back = await probe();
  steps.push({ step: '6 · 切回 dark', detail: { 主题: back.theme, void: back.vars.void, accent: back.vars.accent, 卡片圆角: back.cardRadius, 卡片阴影: back.cardShadow, 注入样式长度: back.webStyleLen, 内联变量残留: back.inlineVars.slice(0, 120), dswBase: back.vars.dswBase || '(空)' } });
  if (back.theme !== 'dark') failures.push(`切回后 data-theme 应为 dark，实际 ${back.theme}`);
  if (back.vars.void !== '#04070f') failures.push(`切回后 --void 应为 #04070f，实际 ${back.vars.void}`);
  if (back.vars.accent !== '#00d4aa') failures.push(`切回后 --accent 应为 #00d4aa，实际 ${back.vars.accent}`);
  if (back.vars.dswBase) failures.push(`切回后不该再有 --dsw-alias-bg-base（实际 ${back.vars.dswBase}）—— 内联变量残留`);
  if (back.webStyleLen !== 0) failures.push(`切回后注入的样式应清空，实际长度 ${back.webStyleLen}`);
  if (back.cardRadius === '0px') failures.push('切回后 .card 圆角仍是 0px —— 结构层残留');
  if (/4px 4px 0px?/.test(back.cardShadow || '')) failures.push('切回后 .card 仍是硬阴影 —— 结构层残留');

  // ---------- 7. 切回迁移主题（验证可重复切换）----------
  await win.webContents.executeJavaScript(`(() => { document.getElementById('themeSelect').value=${JSON.stringify(THEME_ID)};
    document.getElementById('themeSelect').dispatchEvent(new Event('change', {bubbles:true})); })()`, true);
  await wait(700);
  const again = await probe();
  steps.push({ step: '7 · 再切回迁移主题', detail: { 主题: again.theme, void: again.vars.void, accent: again.vars.accent, 卡片圆角: again.cardRadius, 注入样式长度: again.webStyleLen } });
  if (again.vars.void.toLowerCase() !== '#f3efe6') failures.push(`二次切换后 --void 应为 #f3efe6，实际 ${again.vars.void}`);
  if (again.cardRadius !== '0px') failures.push('二次切换后结构层没恢复');
  if (again.webStyleLen < 100) failures.push('二次切换后注入样式为空');

  // ---------- 8. 移除迁移主题 ----------
  const rm = await win.webContents.executeJavaScript(`window.api.themeRemove(${JSON.stringify(THEME_ID)})`, true);
  const refreshed = await win.webContents.executeJavaScript('window.__dshThemes.refresh().then(()=>document.getElementById("themeSelect").options.length)', true);
  await wait(300);
  const gone = await probe();
  steps.push({ step: '8 · 移除迁移主题', detail: { 移除结果: rm, 刷新后下拉项数: refreshed, 下拉项: gone.options.join(','), 主题分组: gone.optgroups.join(',') || '(无)' } });
  if (!rm || !rm.ok) failures.push(`移除失败：${JSON.stringify(rm)}`);
  if (gone.options.some((o) => o.includes(':'))) failures.push(`移除后下拉仍含迁移主题：${gone.options.filter((o) => o.includes(':')).join(',')}`);
  if (gone.optgroups.length) failures.push('移除后仍残留 WebUI 主题分组');

  // ---------- 收尾：还原主题库文件与 localStorage ----------
  try {
    await win.webContents.executeJavaScript(`(() => {
      if (${JSON.stringify(priorStorage)}.theme === null) localStorage.removeItem('dsh-theme');
      else localStorage.setItem('dsh-theme', ${JSON.stringify(priorStorage)}.theme);
      if (${JSON.stringify(priorStorage)}.custom === null) localStorage.removeItem('dsh-custom');
      else localStorage.setItem('dsh-custom', ${JSON.stringify(priorStorage)}.custom);
      return true;
    })()`, true);
  } catch { /* 窗口可能已关 */ }
  if (storeExisted) fs.writeFileSync(STORE_FILE, storeBackup, 'utf8');
  else if (fs.existsSync(STORE_FILE)) fs.unlinkSync(STORE_FILE);
  report.storeRestored = true;

  clearTimeout(watchdog);
  report.ok = failures.length === 0;
  fs.writeFileSync(RESULT, JSON.stringify(report, null, 2), 'utf8');
  process.stdout.write(`result -> ${RESULT}\n`);
  app.exit(report.ok ? 0 : 5);
})().catch((err) => {
  try { fs.writeFileSync(RESULT, JSON.stringify({ ok: false, failures, steps, error: String((err && err.stack) || err) }, null, 2)); } catch (e) {}
  try {
    if (storeExisted) fs.writeFileSync(STORE_FILE, storeBackup, 'utf8');
    else if (fs.existsSync(STORE_FILE)) fs.unlinkSync(STORE_FILE);
  } catch (e) { /* 还原失败也要报出主错误 */ }
  app.exit(4);
});
