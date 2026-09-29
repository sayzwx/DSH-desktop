/* skin 迁移 e2e —— 验证「skin 型主题也能迁移到桌面端」（2026-09-29 用户反馈的缺口）
 *
 * 背景：市场里的主题是**两种格式**——
 *   ① token 型（dsh-neo-skin：client.js 内嵌 SCHEMES 的 --dsw-alias-* 变量表）
 *   ② skin 型（官方皮肤生态：skin.json + bodyAttr + 整段 WebUI 专属 CSS）
 * 旧扫描把 ② 误判成「纯功能插件」，用户装了也搜不到、迁不了。
 *
 * 本测试用**真实 theme IPC + 真实已安装的 skin 包**（用户装的
 * @smalltailqwq/dsh-client-ui-skin-maid-atelier）验证：
 *   1. 扫描能把它挑出来（kind=skin，1 个方案 / 浅深两档）
 *   2. 浅深两档都能免费迁移：产物带强调色 token、notes 如实说明迁移边界
 *   3. 写入主题库后 theme:list 能看到，且已迁移档位在扫描结果里打勾
 *   4. 删除后清单恢复原状（不污染用户数据）
 *
 * 跑法（cwd 必须是仓库根）：
 *   env -u ELECTRON_RUN_AS_NODE node node_modules/electron/cli.js scripts/skin-migrate-e2e.cjs
 * 输出：%TEMP%\skin-migrate-e2e.json
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

app.disableHardwareAcceleration();
['no-sandbox', 'disable-gpu', '--disable-software-rasterizer', 'in-process-gpu']
  .forEach((s) => app.commandLine.appendSwitch(s.replace(/^--/, '')));

const ROOT = process.env.DESKTOP_ROOT || 'D:/DS_harness';
const DSH_HOME = process.env.DSH_HOME_DIR || path.join(os.homedir(), '.dsh');
const RESULT = path.join(os.tmpdir(), 'skin-migrate-e2e.json');
const SKIN_ID = '@smalltailqwq/dsh-client-ui-skin-maid-atelier';

const { registerThemeIpc } = require(path.join(ROOT, 'lib', 'theme-ipc.js'));

const failures = [];
const steps = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 前置：记主题库原貌，跑完还原 ----------
const STORE = path.join(DSH_HOME, 'desktop-themes.json');
const storeExisted = fs.existsSync(STORE);
const storeBackup = storeExisted ? fs.readFileSync(STORE, 'utf8') : null;

// ---------- 真实主题 IPC（引擎 RPC 用桩；本测试不启动引擎）----------
registerThemeIpc({
  ipcMain,
  dshHome: DSH_HOME,
  appDir: ROOT,
  discoverHarness: () => ({ dir: process.env.HARNESS_DIR || 'D:/DSH/harness' }),
  readCredentialPlaintext: () => undefined,
  rpcCall: async () => ({ ok: false, error: 'stub: 本测试不启动引擎' }),
  revealPath: async () => '',
  showInFolder: () => {},
});

// 其余通道注册成桩（漏一个页面 boot 不起来）
const preloadSrc = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
const channels = [...new Set([...preloadSrc.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((m) => m[1]))];
const THEME_CHANNELS = new Set(channels.filter((c) => c.startsWith('theme:')));
for (const ch of channels) {
  if (THEME_CHANNELS.has(ch)) continue;
  ipcMain.handle(ch, async () => ({ ok: false, error: 'stub(' + ch + ')', items: [], list: [], sessions: [], presets: [], providers: [], models: [], namespaces: [] }));
}

const PROBE = `(() => {
  const body = document.getElementById('tsBody') || document.body;
  const txt = body.innerText || '';
  return {
    hasSkinBadge: txt.includes('skin 型'),
    hasPreview: !!body.querySelector('.ts-skin-fig img'),
    hasRefineBtn: !!body.querySelector('.ts-refine'),
    cardName: (body.querySelector('.ts-card-name') || {}).textContent || '',
  };
})()`;

(async () => {
  const report = { ok: false, failures, steps, consoleErrors: [] };
  const watchdog = setTimeout(() => {
    try { fs.writeFileSync(RESULT, JSON.stringify({ ...report, error: 'watchdog' }, null, 2)); } catch (e) {}
    app.exit(3);
  }, 150000);

  const check = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failures.push(`${name}\n    期望: ${JSON.stringify(expected)}\n    实际: ${JSON.stringify(actual)}`);
    return ok;
  };

  let win;
  try {
    await app.whenReady();
    win = new BrowserWindow({
      show: false, width: 1360, height: 860,
      webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    });
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) report.consoleErrors.push(String(message).slice(0, 300));
    });

    await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
    await wait(2200);

    // ---------- 1. 扫描：skin 包必须被识别 ----------
    const scan = await win.webContents.executeJavaScript('window.api.themeScan()', true);
    if (!scan || !scan.ok) throw new Error('themeScan 失败: ' + JSON.stringify(scan && scan.error));
    const skin = (scan.plugins || []).find((p) => p.id === SKIN_ID);
    steps.push({ step: '1 · 扫描', detail: {
      插件数: (scan.plugins || []).length,
      跳过数: (scan.skipped || []).length,
      skin: skin ? { kind: skin.kind, 方案: skin.schemes.map((s) => `${s.id}(${s.tones.join('/')})`), accent: skin.skin.accent } : null } });
    if (!skin) {
      throw new Error(`扫描没有找到 ${SKIN_ID} —— 请确认它已安装（~/.dsh/profiles/web/node_modules/）`);
    }
    check('skin 包被识别为 kind=skin', skin.kind, 'skin');
    check('skin 方案有浅深两档', skin.schemes.length === 1 && skin.schemes[0].tones.join(','), 'light,dark');
    check('skin 声明了强调色', !!skin.skin.accent, true);

    // 记下测试前的已迁移清单（只删本测试加的，不动用户已有的）
    const listBefore = await win.webContents.executeJavaScript('window.api.themeList()', true);
    const beforeIds = new Set(((listBefore && listBefore.themes) || []).map((t) => t.id));

    // ---------- 2. 迁移浅深两档 ----------
    for (const tone of ['light', 'dark']) {
      const m = await win.webContents.executeJavaScript(
        `window.api.themeMigrate(${JSON.stringify(SKIN_ID)}, ${JSON.stringify(skin.skin.skinId)}, ${JSON.stringify(tone)})`, true);
      if (!m || !m.ok || !(m.migrations || []).length) {
        failures.push(`迁移 ${tone} 失败: ${JSON.stringify(m && (m.error || m.errors))}`);
        continue;
      }
      const mig = m.migrations[0];
      steps.push({ step: `2 · 迁移 ${tone}`, detail: {
        id: mig.id, label: mig.label, tokens: mig.tokens, tokenCount: mig.tokenCount, notes: mig.notes } });
      check(`${tone} 产物 id`, mig.id, `${SKIN_ID}:${skin.skin.skinId}:${tone}`);
      check(`${tone} 产物 kind`, mig.kind, 'webtheme');
      check(`${tone} 强调色写进了 token`, mig.tokens && mig.tokens['--dsw-alias-brand-primary'], skin.skin.accent);
      check(`${tone} notes 如实说明「完整观感需在 WebUI 启用」`,
        (mig.notes || []).some((n) => /WebUI 里启用/.test(n)), true);
      const r = await win.webContents.executeJavaScript(
        `window.api.themeInstall(${JSON.stringify(m.migrations)}, null)`, true);
      if (!r || !r.ok) failures.push(`${tone} 写入主题库失败: ${JSON.stringify(r && r.error)}`);
    }

    // ---------- 3. 清单可见 + 扫描打勾 ----------
    const list = await win.webContents.executeJavaScript('window.api.themeList()', true);
    const ids = ((list && list.themes) || []).map((t) => t.id);
    steps.push({ step: '3 · 主题库清单', detail: { 新增: ids.filter((x) => !beforeIds.has(x)) } });
    check('浅色档在主题库里', ids.includes(`${SKIN_ID}:${skin.skin.skinId}:light`), true);
    check('深色档在主题库里', ids.includes(`${SKIN_ID}:${skin.skin.skinId}:dark`), true);

    // ---------- 4. 渲染层真实 DOM：徽标 / 预览图 / 无模型精修入口 ----------
    await win.webContents.executeJavaScript('window.__themeStudio.mount()', true);
    await wait(1200);
    const probe = await win.webContents.executeJavaScript(PROBE, true);
    steps.push({ step: '4 · 界面渲染', detail: probe });
    check('界面标出「skin 型」徽标', probe.hasSkinBadge, true);
    check('界面渲染出预览图', probe.hasPreview, true);
    check('skin 型不提供「模型精修」入口（如实不给做不到的事）', probe.hasRefineBtn, false);

    // ---------- 5. 清理：删掉本测试写入的主题，还原主题库原貌 ----------
    const added = ids.filter((x) => !beforeIds.has(x));
    for (const id of added) {
      await win.webContents.executeJavaScript(`window.api.themeRemove(${JSON.stringify(id)})`, true).catch(() => {});
    }
    const listAfter = await win.webContents.executeJavaScript('window.api.themeList()', true);
    const afterIds = (((listAfter && listAfter.themes) || []).map((t) => t.id));
    check('清理后主题库恢复原状', added.every((x) => !afterIds.includes(x)), true);
    steps.push({ step: '5 · 清理', detail: { 删除数: added.length } });

    const realErrors = report.consoleErrors.filter((e) => !/favicon|ERR_FILE_NOT_FOUND/i.test(e));
    if (realErrors.length) failures.push(`渲染层报错: ${realErrors.slice(0, 4).join(' | ')}`);
  } catch (err) {
    failures.push(`测试自身失败: ${err && err.message ? err.message : err}`);
  } finally {
    clearTimeout(watchdog);
    // 无论成败都还原主题库原貌（兜底：上面按 id 删，这里再兜一层）
    try {
      if (storeExisted) fs.writeFileSync(STORE, storeBackup, 'utf8');
      else if (fs.existsSync(STORE)) fs.unlinkSync(STORE);
    } catch { /* ignore */ }
  }

  try { fs.writeFileSync(RESULT, JSON.stringify(report, null, 2)); } catch (e) {}
  for (const s of steps) console.log(`  (${s.step}: ${JSON.stringify(s.detail).slice(0, 260)})`);
  if (failures.length) {
    console.error(`FAIL (${failures.length} 项)`);
    for (const f of failures) console.error('  - ' + f);
    app.exit(1);
  } else {
    console.log('PASS: skin 型主题识别 / 免费迁移（强调色+命名，边界如实标注）/ 主题库写入与清理');
    app.exit(0);
  }
})();
