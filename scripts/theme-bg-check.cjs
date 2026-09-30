/**
 * 目视验证：迁移后的主题，背景图是否真的显示出来了。
 *
 * 做法：真实应用 → 扫主题 → 迁移（免费路径，不花模型的钱）→ 写库 → 应用 → 截图。
 * 用法（cwd = 仓库根）：env -u ELECTRON_RUN_AS_NODE node node_modules/electron/cli.js scripts/theme-bg-check.cjs
 * 产出：dist/theme-bg-check.png（可直接肉眼复核）
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

app.disableHardwareAcceleration();
['no-sandbox', 'disable-gpu', 'disable-software-rasterizer', 'in-process-gpu']
  .forEach((s) => app.commandLine.appendSwitch(s));

const ROOT = 'D:/DS_harness';
const OUT = path.join(ROOT, 'dist', 'theme-bg-check.png');
const { registerThemeIpc } = require(path.join(ROOT, 'lib', 'theme-ipc.js'));

registerThemeIpc({
  ipcMain,
  dshHome: path.join(os.homedir(), '.dsh'),
  appDir: ROOT,
  discoverHarness: () => ({ dir: 'D:/DSH/harness' }),
  readCredentialPlaintext: () => undefined,
  rpcCall: async () => ({ ok: false, error: 'stub' }),
  revealPath: async () => '',
  showInFolder: () => {},
});
const preloadSrc = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
for (const ch of [...new Set([...preloadSrc.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((m) => m[1]))]) {
  if (!ch.startsWith('theme:')) ipcMain.handle(ch, async () => ({ ok: false, error: 'stub', items: [], list: [], sessions: [], presets: [], providers: [], models: [], namespaces: [] }));
}

const STORE = path.join(os.homedir(), '.dsh', 'desktop-themes.json');
const storeBackup = fs.existsSync(STORE) ? fs.readFileSync(STORE, 'utf8') : null;
const restore = () => { try { if (storeBackup) fs.writeFileSync(STORE, storeBackup, 'utf8'); } catch { /* ignore */ } };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const watchdog = setTimeout(() => { restore(); app.exit(3); }, 120000);
  try {
    await app.whenReady();
    const win = new BrowserWindow({
      width: 1360, height: 860, show: true,
      webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    });
    await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
    await wait(2500);
    const js = (e) => win.webContents.executeJavaScript(e, true);

    const scan = await js('window.api.themeScan()');
    const plugin = (scan.plugins || [])[0];
    if (!plugin) { console.log('SKIP: 本机没有主题包'); clearTimeout(watchdog); restore(); app.exit(0); return; }

    for (const tone of ['dark']) {
      const id = `${plugin.id}:${plugin.schemes[0].id}:${tone}`;
      const m = await js(`window.api.themeMigrate(${JSON.stringify(plugin.id)}, ${JSON.stringify(plugin.schemes[0].id)}, ${JSON.stringify(tone)})`);
      if (!m || !m.ok) { console.log('迁移失败:', JSON.stringify(m && m.error)); break; }
      console.log('迁移 css 前 200 字:', (m.migrations[0].css || '').slice(0, 200).replace(/\n/g, ' '));
      console.log('迁移 notes:', JSON.stringify(m.migrations[0].notes.slice(-1)));
      await js(`window.api.themeInstall(${JSON.stringify(m.migrations)}, null)`);
      await js(`(async () => { await window.__dshThemes.refresh(); window.__dshThemes.apply(${JSON.stringify(id)}); })()`);
      await wait(6000);
      const state = await js(`(() => {
        const el = document.getElementById('themeBg');
        const cs = el ? getComputedStyle(el) : null;
        const styleEl = document.getElementById('webThemeStyle');
        return { theme: document.documentElement.getAttribute('data-theme'),
                 hasImage: cs ? /url\\(/.test(cs.backgroundImage) : false,
                 image: cs ? cs.backgroundImage.slice(0, 160) : '',
                 size: cs ? cs.backgroundSize : '', attach: cs ? cs.backgroundAttachment : '',
                 pos: cs ? cs.backgroundPosition : '', display: cs ? cs.display : '',
                 injected: styleEl ? styleEl.textContent.slice(0, 600) : '(无 #webThemeStyle)' };
      })()`);
      console.log('应用后状态:', JSON.stringify({ ...state, injected: undefined }));
      console.log('注入的 CSS:'); console.log(state.injected);
      await wait(2500);
      const img = await win.webContents.capturePage();
      fs.writeFileSync(OUT, img.toPNG());
      console.log('已截图:', OUT, fs.statSync(OUT).size, 'bytes');
    }
  } catch (e) {
    console.error('FAIL:', (e && e.message) || e);
    process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
    restore();
  }
  app.exit(process.exitCode || 0);
})();
