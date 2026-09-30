/**
 * 主题迁移端到端（通用版）：对**本机扫到的每一个主题包**跑完整链路。
 *
 * 与 skin-migrate-e2e.cjs 的分工：那条专测 skin 型（预览图 / skin 徽标 / 无变量表承接）；
 * 这条测**形态无关**的部分 —— 不管主题包是哪种写法、入口在哪，
 * 「扫到 → 迁移全部档位 → 写主题库 → 清单可见 → 界面正确标注」都必须通。
 *
 * 跑法（cwd 必须是仓库根）：
 *   env -u ELECTRON_RUN_AS_NODE node node_modules/electron/cli.js scripts/theme-formats-e2e.cjs
 * 输出：%TEMP%\theme-formats-e2e.json
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
const RESULT = path.join(os.tmpdir(), 'theme-formats-e2e.json');
const STORE = path.join(DSH_HOME, 'desktop-themes.json');

const { registerThemeIpc } = require(path.join(ROOT, 'lib', 'theme-ipc.js'));

const failures = [];
const steps = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return true;
  failures.push(`${name}\n    期望: ${JSON.stringify(expected)}\n    实际: ${JSON.stringify(actual)}`);
  return false;
};

const storeExisted = fs.existsSync(STORE);
const storeBackup = storeExisted ? fs.readFileSync(STORE, 'utf8') : null;
function restoreStore() {
  try {
    if (storeExisted) fs.writeFileSync(STORE, storeBackup, 'utf8');
    else if (fs.existsSync(STORE)) fs.unlinkSync(STORE);
  } catch { /* ignore */ }
}

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
const preloadSrc = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
const channels = [...new Set([...preloadSrc.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((m) => m[1]))];
for (const ch of channels) {
  if (ch.startsWith('theme:')) continue;
  ipcMain.handle(ch, async () => ({ ok: false, error: 'stub', items: [], list: [], sessions: [], presets: [], providers: [], models: [], namespaces: [] }));
}

(async () => {
  const report = { ok: false, failures, steps, consoleErrors: [] };
  const watchdog = setTimeout(() => {
    restoreStore();
    try { fs.writeFileSync(RESULT, JSON.stringify({ ...report, error: 'watchdog' }, null, 2)); } catch { /* ignore */ }
    app.exit(3);
  }, 180000);

  let win;
  try {
    await app.whenReady();
    win = new BrowserWindow({
      show: false, width: 1360, height: 860,
      webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    });
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) report.consoleErrors.push(String(message).slice(0, 200));
    });
    await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
    await wait(2200);
    const js = (expr) => win.webContents.executeJavaScript(expr, true);

    // ---------- 1. 扫描 ----------
    const scan = await js('window.api.themeScan()');
    if (!scan || !scan.ok) throw new Error('themeScan 失败: ' + JSON.stringify(scan && scan.error));
    const plugins = scan.plugins || [];
    steps.push({ step: '1 · 扫描', detail: plugins.map((p) => `${p.id}[${p.kind}] 入口=${p.clientEntry || '-'} 方案=${p.schemes.map((s) => `${s.id}(${s.tokenCount})`).join('/')}`) });
    if (!plugins.length) {
      console.log('SKIP: 本机没有可识别的主题包（先到插件市场装一个主题）');
      clearTimeout(watchdog); restoreStore(); app.exit(0); return;
    }
    check('没有官方客户端组件被误列成主题',
      plugins.filter((p) => /^@deepseek-ai\/dsh-(client|cordis|session-log|typert|api-)/.test(p.id)).length, 0);
    for (const p of plugins) {
      checkTrueLocal(`${p.id} 有可用方案`, p.schemes.length > 0 && p.schemes.every((s) => s.tones.length > 0));
    }

    // ---------- 2. 逐个主题迁移 + 写库 ----------
    const listBefore = await js('window.api.themeList()');
    const beforeIds = new Set(((listBefore && listBefore.themes) || []).map((t) => t.id));
    for (const p of plugins) {
      for (const sch of p.schemes) {
        for (const tone of sch.tones) {
          const m = await js(`window.api.themeMigrate(${JSON.stringify(p.id)}, ${JSON.stringify(sch.id)}, ${JSON.stringify(tone)})`);
          if (!m || !m.ok || !(m.migrations || []).length) {
            failures.push(`${p.id}/${sch.id}/${tone} 迁移失败: ${JSON.stringify(m && (m.error || m.errors))}`);
            continue;
          }
          const r = await js(`window.api.themeInstall(${JSON.stringify(m.migrations)}, null)`);
          if (!r || !r.ok) failures.push(`${p.id}/${sch.id}/${tone} 写库失败: ${JSON.stringify(r && r.error)}`);
          steps.push({ step: `2 · 迁移 ${sch.id}/${tone}`, detail: { id: m.migrations[0].id, label: m.migrations[0].label, tokens: m.migrations[0].tokenCount } });
        }
      }
    }

    // ---------- 3. 主题库与扫描回执 ----------
    const list = await js('window.api.themeList()');
    const ids = ((list && list.themes) || []).map((t) => t.id);
    steps.push({ step: '3 · 主题库', detail: { 新增: ids.filter((x) => !beforeIds.has(x)).length, 总数: ids.length } });
    checkTrueLocal('主题库里有迁移产物', ids.length > beforeIds.size);
    const scan2 = await js('window.api.themeScan()');
    const p0 = (scan2.plugins || []).find((x) => x.id === plugins[0].id);
    checkTrueLocal('扫描结果能回标"已迁移过的档位"', !!(p0 && p0.installedIds && p0.installedIds.length), p0 && p0.installedIds);

    // ---------- 4. 界面标注 ----------
    await js('window.__themeStudio.mount()');
    await wait(1200);
    const probe = await js(`(() => {
      const body = document.getElementById('tsBody') || document.body;
      const cards = [...body.querySelectorAll('.ts-card')].map((c) => ({
        name: (c.querySelector('.ts-card-name') || {}).textContent || '',
        badges: [...c.querySelectorAll('.mk-badge')].map((b) => b.textContent.trim()),
        rows: c.querySelectorAll('.ts-row').length,
      }));
      return { cards, hasEntryBadge: /读 .*\\.js/.test(body.innerText), text: body.innerText.slice(0, 200) };
    })()`);
    steps.push({ step: '4 · 界面标注', detail: probe.cards });
    checkTrueLocal('每张卡都渲染出了档位行', probe.cards.every((c) => c.rows > 0), probe.cards);
    checkTrueLocal('卡片标出了变量表来源（读 …js / skin.json / 通用型）',
      probe.cards.every((c) => c.badges.some((b) => /读 |skin|通用型|token 型/.test(b))), probe.cards.map((c) => c.badges));

    // ---------- 5. 清理 ----------
    for (const id of ids.filter((x) => !beforeIds.has(x))) {
      await js(`window.api.themeRemove(${JSON.stringify(id)})`).catch(() => {});
    }
    const after = await js('window.api.themeList()');
    const afterIds = ((after && after.themes) || []).map((t) => t.id);
    checkTrueLocal('清理后主题库回到原状', afterIds.length === beforeIds.size, { before: beforeIds.size, after: afterIds.length });
    steps.push({ step: '5 · 清理', detail: { 删除: ids.length - afterIds.length } });

    const realErrors = report.consoleErrors.filter((e) => !/favicon|ERR_FILE_NOT_FOUND/i.test(e));
    if (realErrors.length) failures.push(`渲染层报错: ${realErrors.slice(0, 3).join(' | ')}`);
  } catch (err) {
    failures.push(`测试自身失败: ${(err && err.message) || err}`);
  } finally {
    clearTimeout(watchdog);
    restoreStore();
  }

  try { fs.writeFileSync(RESULT, JSON.stringify(report, null, 2)); } catch { /* ignore */ }
  for (const s of steps) console.log(`  (${s.step}: ${JSON.stringify(s.detail).slice(0, 220)})`);
  if (failures.length) {
    console.error(`FAIL (${failures.length} 项)`);
    for (const f of failures) console.error('  - ' + f);
    app.exit(1);
  } else {
    console.log('PASS: 主题迁移端到端（扫描 / 迁移全部档位 / 写库 / 回标 / 界面标注 / 清理）');
    app.exit(0);
  }
})();

function checkTrueLocal(name, cond, detail) {
  if (cond) return true;
  failures.push(name + (detail !== undefined ? `\n    实际: ${JSON.stringify(detail)}` : ''));
  return false;
}
