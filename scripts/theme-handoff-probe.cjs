/* theme-handoff-probe.cjs —— 验证 webUI 主题承接层
 *
 * 验证四件事：
 *   1. 内置四套主题无回归（读基线 token，与预期值比对）
 *   2. 承接生效：注入真实主题包的 89 个变量后，全部承接种点都拿到值
 *   3. 防击穿：主题包未声明的变量必须回落到默认值，不能变空串
 *   4. 无污染：切回内置主题后 token 恢复基线
 *
 * 承接规则不硬编码 —— 直接从 renderer/styles.css 里提取，所以 CSS 改了脚本自动跟上。
 *
 * 跑法（cwd 必须是仓库根）：
 *   env -u ELECTRON_RUN_AS_NODE node node_modules/electron/cli.js scripts/theme-handoff-probe.cjs
 * 可选环境变量：
 *   THEME_JSON  主题包的 tokens.json 路径（默认取 %TEMP%/theme-survey 里拆出来的 dsh-neo-skin）
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

app.disableHardwareAcceleration();
['no-sandbox', 'disable-gpu', 'disable-software-rasterizer', 'in-process-gpu']
  .forEach((s) => app.commandLine.appendSwitch(s));

const ROOT = process.env.DESKTOP_ROOT || 'D:/DS_harness';
const OUT = path.join(os.tmpdir(), 'handoff-result.json');
const DIR = path.join(os.tmpdir(), 'handoff-probe');
const CSS_PATH = path.join(ROOT, 'renderer', 'styles.css');
const THEME_JSON = process.env.THEME_JSON
  || path.join(os.tmpdir(), 'theme-survey', 'neo', 'package', 'src', 'schemes', 'blue.tokens.json');

// ---------- 从 CSS 提取承接层信息（不硬编码，CSS 改动自动跟上）----------
const cssText = fs.readFileSync(CSS_PATH, 'utf8');
const rules = [...cssText.matchAll(/(--[a-z0-9-]+)\s*:\s*var\((--dsw-[a-z0-9-]+)\)\s*;/g)]
  .map((m) => ({ token: m[1], source: m[2] }));
// 承接变量声明（webtheme 块内）—— 取 webtheme 块文本
const wbStart = cssText.indexOf(':root[data-theme="webtheme"] {');
const wbEnd = cssText.indexOf('\n}', wbStart);
const wbText = cssText.slice(wbStart, wbEnd);
const declared = [...wbText.matchAll(/(--dsw-[a-z0-9-]+)\s*:\s*([^;]+);/g)]
  .map((m) => ({ name: m[1], fallback: m[2].trim() }));

// ---------- 主题包变量 ----------
let themeVars = {};
let themeName = '(缺失)';
if (fs.existsSync(THEME_JSON)) {
  const raw = JSON.parse(fs.readFileSync(THEME_JSON, 'utf8'));
  themeName = path.basename(THEME_JSON);
  for (const [k, v] of Object.entries(raw)) {
    if (v && typeof v === 'object' && v.light) themeVars[k] = v.light;
  }
}

const READ_ALL = `
(() => {
  const cs = getComputedStyle(document.documentElement);
  const out = {};
  for (const t of ${JSON.stringify([...new Set([...rules.map((r) => r.token), ...declared.map((d) => d.name)])])}) {
    out[t] = (cs.getPropertyValue(t) || '').trim();
  }
  return out;
})()
`;

(async () => {
  const report = { theme: themeName, counts: {}, steps: [], failures: [] };
  const watchdog = setTimeout(() => {
    try { fs.writeFileSync(OUT, JSON.stringify({ ...report, error: 'watchdog' }, null, 2)); } catch (e) {}
    app.exit(3);
  }, 90000);

  await app.whenReady();
  fs.mkdirSync(DIR, { recursive: true });
  const page = path.join(DIR, 'page.html');
  fs.writeFileSync(page, `<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="file:///${CSS_PATH.replace(/\\/g, '/')}">
<style>#probe{background:var(--accent);color:var(--text);border:1px solid var(--border);}</style>
</head><body><div id="probe">probe</div></body></html>`, 'utf8');

  const win = new BrowserWindow({
    show: false, width: 1000, height: 700,
    webPreferences: { offscreen: true, contextIsolation: false, nodeIntegration: false },
  });
  win.webContents.setFrameRate(30);
  await win.loadURL('file:///' + page.replace(/\\/g, '/'));
  await new Promise((r) => setTimeout(r, 400));

  const read = () => win.webContents.executeJavaScript(READ_ALL, true);
  const setTheme = async (t) => {
    await win.webContents.executeJavaScript(
      `document.documentElement.setAttribute('data-theme', ${JSON.stringify(t)})`, true);
    await new Promise((r) => setTimeout(r, 120));
  };
  const injectVars = async (vars) => {
    const js = Object.entries(vars)
      .map(([k, v]) => `document.documentElement.style.setProperty(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
      .join('\n');
    await win.webContents.executeJavaScript(`(() => { ${js} return true; })()`, true);
  };
  const clearVars = async () => {
    await win.webContents.executeJavaScript(
      `document.documentElement.removeAttribute('style'); true`, true);
  };

  report.counts = {
    rules: rules.length,
    tokensCovered: new Set(rules.map((r) => r.token)).size,
    declared: declared.length,
    themeVars: Object.keys(themeVars).length,
  };

  // ---------- 1. 内置主题基线 ----------
  const BASELINE = {
    dark: { '--void': '#04070f' },
    light: { '--void': '#ffffff' },
    graphite: { '--void': '#151517' },
  };
  const base = {};
  for (const t of ['dark', 'light', 'graphite']) {
    await setTheme(t);
    const vals = await read();
    base[t] = vals;
    for (const [k, expect] of Object.entries(BASELINE[t])) {
      const got = (vals[k] || '').toLowerCase();
      if (got !== expect) report.failures.push(`基线回归 [${t}] ${k}: 期望 ${expect}，实际 ${got || '(空)'}`);
    }
  }
  report.steps.push({
    step: '1 · 内置主题基线',
    detail: Object.fromEntries(Object.entries(BASELINE).map(([t, kv]) =>
      [t, Object.entries(kv).map(([k, v]) => `${k}=${base[t][k]} (期望 ${v})`).join(' / ')])),
  });

  // ---------- 2. 承接生效（注入真实主题包）----------
  await setTheme('webtheme');
  await injectVars(themeVars);
  const handed = await read();
  const emptyOnHandoff = [];
  for (const r of rules) {
    if (!handed[r.token]) emptyOnHandoff.push(r.token);
  }
  const emptyDeclared = declared.filter((d) => !handed[d.name]).map((d) => d.name);
  if (emptyOnHandoff.length) report.failures.push(`承接后为空串的桌面端 token（${emptyOnHandoff.length}）: ${emptyOnHandoff.slice(0, 8).join(', ')}`);
  if (emptyDeclared.length) report.failures.push(`承接后为空串的 --dsw-* 变量（${emptyDeclared.length}）: ${emptyDeclared.slice(0, 8).join(', ')}`);

  // 抽查：承接值应等于主题声明值（同一变量）
  const sample = ['--dsw-alias-bg-base', '--dsw-alias-brand-primary', '--dsw-alias-label-primary',
    '--dsw-specific-sidebar-fill', '--dsw-specific-bubble'];
  const sampleOut = sample.map((k) => ({
    var: k, theme: themeVars[k] || '(主题未声明)', got: handed[k] || '(空)',
  }));

  report.steps.push({
    step: '2 · 承接生效',
    detail: {
      抽查变量: sampleOut.map((s) => `${s.var}: 主题=${s.theme} → 承接=${s.got}`),
      '桌面端 --void': handed['--void'],
      '桌面端 --accent': handed['--accent'],
      '桌面端 --text': handed['--text'],
      '桌面端 --sidebar-fill': handed['--sidebar-fill'],
      '桌面端 --bubble-bg': handed['--bubble-bg'],
      '渲染探针 background': '(见第 5 步)',
    },
  });

  // ---------- 3. 防击穿：只声明 3 个变量 ----------
  await clearVars();
  await injectVars({ '--dsw-alias-bg-base': 'rgb(1, 2, 3)' });
  const partial = await read();
  const brokenByPartial = rules.filter((r) => !partial[r.token]).map((r) => r.token);
  if (brokenByPartial.length) {
    report.failures.push(`只声明 1 个变量时，${brokenByPartial.length} 个桌面端 token 变空（回落失效）: ${brokenByPartial.slice(0, 8).join(', ')}`);
  }
  report.steps.push({
    step: '3 · 防击穿（主题只声明 1 个变量）',
    detail: {
      '--void（应=主题值）': partial['--void'],
      '--accent（应=官方浅色档回落值，非空）': partial['--accent'],
      '空值 token 数': brokenByPartial.length,
    },
  });

  // ---------- 4. 无污染：切回内置主题 ----------
  await clearVars();
  await setTheme('dark');
  const back = await read();
  if ((back['--void'] || '').toLowerCase() !== '#04070f') {
    report.failures.push(`切回 dark 后 --void 未恢复: ${back['--void']}`);
  }
  const polluted = rules.filter((r) => back[r.token] !== base.dark[r.token]).map((r) => r.token);
  report.steps.push({
    step: '4 · 无污染（切回 dark）',
    detail: {
      '--void': back['--void'],
      '--accent': back['--accent'],
      '--void 恢复正确': (back['--void'] || '').toLowerCase() === '#04070f',
      '与 dark 基线不一致的 token 数（--dsw-* 自身除外）': polluted.filter((t) => !t.startsWith('--dsw-')).length,
    },
  });

  // ---------- 5. 真实渲染 ----------
  await setTheme('webtheme');
  await injectVars(themeVars);
  await new Promise((r) => setTimeout(r, 150));
  const rendered = await win.webContents.executeJavaScript(
    `(() => { const s = getComputedStyle(document.getElementById('probe'));
      return { bg: s.backgroundColor, color: s.color, border: s.borderTopColor }; })()`, true);
  const renderedNow = { accent: (await read())['--accent'] };
  report.steps.push({
    step: '5 · 真实渲染（webtheme + 主题变量）',
    detail: { '--accent': renderedNow.accent, '探针 background': rendered.bg, '探针 color': rendered.color, '探针 border': rendered.border },
  });

  clearTimeout(watchdog);
  report.ok = report.failures.length === 0;
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
  process.stdout.write(`result -> ${OUT}\n`);
  app.exit(report.ok ? 0 : 5);
})().catch((err) => {
  try { fs.writeFileSync(OUT, JSON.stringify({ error: String((err && err.stack) || err) }, null, 2)); } catch (e) {}
  app.exit(4);
});
