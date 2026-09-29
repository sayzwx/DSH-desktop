/* theme-bridge-probe.cjs —— 验证「桌面端能否消费 Web 端主题 token」的离线实测脚本
 *
 * 用途
 *   回答一个问题：把社区主题的 CSS（--dsw-alias-* 覆盖）注入桌面端页面，
 *   桌面端界面会不会跟着变？答案是「不会」；必须再加一层桥接规则，且
 *   桥接规则必须落在 body 上。本脚本用真实 renderer/styles.css 逐步骤证明。
 *
 * 为什么需要它
 *   这是「桌面端主题迁移方案」的实测依据（见 DeepSeek_Harness_桌面端主题迁移方案.md §2）。
 *   实现桥接表时也可以用它做回归：断言桥接后桌面端 token 取自 web 主题、且没有键变成空值。
 *
 * 跑法（cwd 必须是仓库根）
 *   env -u ELECTRON_RUN_AS_NODE node node_modules/electron/cli.js scripts/theme-bridge-probe.cjs
 *
 *   路径可用环境变量覆盖（默认指向本机开发目录）：
 *     DESKTOP_ROOT   桌面端仓库根，默认 D:/DS_harness
 *     HARNESS_SRC    Harness 源码根，默认 D:/DSH/harness
 *
 * 输出
 *   %TEMP%/bridge-test/result.json  —— 逐步骤的 token 解析值与真实渲染值
 *
 * 判定标准（看 result.json）
 *   B0  只注入原 CSS：桌面端 --accent 与渲染色【必须不变】→ 证明「注入原 CSS 无用」
 *   B1  桥接在 :root：--accent 等【必须变成空】→ 证明父元素看不到子元素变量（陷阱一）
 *   B2  桥接在 body：--accent 等【必须等于主题值】且渲染同步 → 证明传导成立
 *   C   挂 data-ds-dark-theme：值【必须切到官方深色档】
 *   C2  摘掉后【必须可逆】
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

app.disableHardwareAcceleration();
['no-sandbox', 'disable-gpu', 'disable-software-rasterizer', 'in-process-gpu']
  .forEach((s) => app.commandLine.appendSwitch(s));

const DESKTOP_ROOT = process.env.DESKTOP_ROOT || 'D:/DS_harness';
const HARNESS_SRC = process.env.HARNESS_SRC || 'D:/DSH/harness';

const DIR = path.join(os.tmpdir(), 'bridge-test');
const OUT = path.join(DIR, 'result.json');
const PAGE = path.join(DIR, 'page.html');
const STYLES_URI = 'file:///' + path.join(DESKTOP_ROOT, 'renderer/styles.css').replace(/\\/g, '/');

// 官方设计 token 源文件：调色板层(--dsw-static-*)与别名层(--dsw-alias-*)都在这一份里，
// 且浅色档挂 body、深色档挂 body[data-ds-dark-theme]，是个自包含、可直接注入的单元。
const PLATFORM_CSS = fs.readFileSync(
  path.join(HARNESS_SRC, 'packages/client/ui-theme/src/styles/design-platform.css'),
  'utf8'
);

// 模拟一个「web 主题包」的覆盖：只声明它改的那几十个 token，其余沿用官方默认。
// 注意这里刻意写成无档位的 body{} —— 正是它让陷阱二（官方深色档特异性覆盖主题）暴露出来。
const THEME_OVERRIDE = `body{
  --dsw-alias-bg-base: rgb(250, 249, 245);
  --dsw-alias-brand-primary: rgb(200, 60, 40);
  --dsw-alias-label-primary: rgb(28, 25, 23);
  --dsw-alias-label-secondary: rgb(120, 113, 108);
  --dsw-alias-border-l2: rgba(28, 25, 23, 0.12);
}`;

// 桥接规则：把 web 的 --dsw-alias-* 接到桌面端自己的 token 上
const BRIDGE_DECL = `
  --void: var(--dsw-alias-bg-base);
  --accent: var(--dsw-alias-brand-primary);
  --text: var(--dsw-alias-label-primary);
  --text-dim: var(--dsw-alias-label-secondary);
  --border: var(--dsw-alias-border-l2);
`;
const BRIDGE_ON_ROOT = `:root[data-theme="webtheme"] {${BRIDGE_DECL}}`;
const BRIDGE_ON_BODY = `:root[data-theme="webtheme"] body {${BRIDGE_DECL}}`;

const READ_FN = `
(() => {
  const cs = getComputedStyle(document.documentElement);
  const bs = getComputedStyle(document.body);
  const p = document.getElementById('probe');
  const ps = getComputedStyle(p);
  const g = (o, k) => (o.getPropertyValue(k) || '').trim();
  return {
    root: {
      accent: g(cs, '--accent'), void: g(cs, '--void'),
      text: g(cs, '--text'), border: g(cs, '--border'),
      cyan: g(cs, '--cyan'), panel: g(cs, '--panel'),
      nebula: g(cs, '--nebula-navy'), glow: g(cs, '--glow'),
    },
    body: {
      accent: g(bs, '--accent'), void: g(bs, '--void'),
      dswBrand: g(bs, '--dsw-alias-brand-primary'),
      dswBg: g(bs, '--dsw-alias-bg-base'),
      dswLabel: g(bs, '--dsw-alias-label-primary'),
      dswStatic: g(bs, '--dsw-static-neutral-bluish-00'),
      dswColorScheme: bs.colorScheme,
    },
    rendered: { bg: ps.backgroundColor, color: ps.color, border: ps.borderTopColor },
  };
})()
`;

function injectFn(css) {
  return `(() => {
    const s = document.createElement('style');
    s.dataset.probe = '1';
    s.textContent = ${JSON.stringify(css)};
    document.head.appendChild(s);
    return s.textContent.length;
  })()`;
}

const steps = [];
async function snap(win, label, note) {
  const data = await win.webContents.executeJavaScript(READ_FN, true);
  steps.push({ label, note, ...data });
}

(async () => {
  const watchdog = setTimeout(() => {
    try { fs.writeFileSync(OUT, JSON.stringify({ error: 'watchdog timeout', steps }, null, 2)); } catch (e) {}
    app.exit(3);
  }, 90000);

  await app.whenReady();

  // 自建探针页，避免依赖外部文件
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(PAGE, `<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${STYLES_URI}">
<style>#probe{background:var(--accent);color:var(--text);border:1px solid var(--border);}</style>
</head><body><div id="probe">probe</div></body></html>`, 'utf8');

  const win = new BrowserWindow({
    show: false,
    width: 1000,
    height: 700,
    webPreferences: { offscreen: true, contextIsolation: false, nodeIntegration: false },
  });
  win.webContents.setFrameRate(30);
  await win.loadURL('file:///' + PAGE.replace(/\\/g, '/'));
  await new Promise((r) => setTimeout(r, 400));

  await snap(win, 'A 基线', '不注入任何东西');

  await win.webContents.executeJavaScript(injectFn(PLATFORM_CSS + THEME_OVERRIDE), true);
  await new Promise((r) => setTimeout(r, 250));
  await snap(win, 'B0 注入原 CSS + 主题覆盖，无桥接', '预期：桌面端毫无变化');

  await win.webContents.executeJavaScript(
    `document.documentElement.setAttribute('data-theme','webtheme')`, true);
  await win.webContents.executeJavaScript(injectFn(BRIDGE_ON_ROOT), true);
  await new Promise((r) => setTimeout(r, 250));
  await snap(win, 'B1 桥接在 :root 上', '预期：静默失效，token 变空');

  await win.webContents.executeJavaScript(
    `[...document.querySelectorAll('style[data-probe]')].pop().remove()`, true);
  await win.webContents.executeJavaScript(injectFn(BRIDGE_ON_BODY), true);
  await new Promise((r) => setTimeout(r, 250));
  await snap(win, 'B2 桥接在 body 上', '预期：成功，桌面端 token 拿到 web 主题值');

  await win.webContents.executeJavaScript(
    `document.body.setAttribute('data-ds-dark-theme','')`, true);
  await new Promise((r) => setTimeout(r, 250));
  await snap(win, 'C 挂 data-ds-dark-theme', '预期：切到官方深色档（主题覆盖被官方特异性盖掉）');

  await win.webContents.executeJavaScript(
    `document.body.removeAttribute('data-ds-dark-theme')`, true);
  await new Promise((r) => setTimeout(r, 250));
  await snap(win, 'C2 摘掉 data-ds-dark-theme', '预期：回到浅色档，可逆');

  clearTimeout(watchdog);
  fs.writeFileSync(OUT, JSON.stringify({ ok: true, steps }, null, 2), 'utf8');
  process.stdout.write(`result -> ${OUT}\n`);
  app.exit(0);
})().catch((err) => {
  try { fs.writeFileSync(OUT, JSON.stringify({ error: String((err && err.stack) || err), steps }, null, 2)); } catch (e) {}
  app.exit(4);
});
