/**
 * 浅色主题对比度审计（真实应用 + 真实页面 + 截图）。
 *
 * 起因（2026-09-29 用户反馈）：浅色下「有好多地方都没变，还是白色都融入背景里了」。
 * 逐元素算两件事，避免靠猜：
 *   ① 低对比文字：元素的有效背景（向上找第一个不透明背景）与文字色的对比度 < 3.0
 *   ② 融入背景的盒子：自身底色与页面底色几乎相同（Δ<6/255）、且边框极淡（alpha<0.15）
 *      或干脆没边框 —— 这类面板在白底上等于看不见
 * 同时把每页截图落盘（dist/light-audit/*.png），人眼复核。
 *
 * 用法: env -u ELECTRON_RUN_AS_NODE node scripts/light-theme-audit.cjs
 * 输出: dist/light-audit/report.json + 每页截图
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist', 'light-audit');
const PORT = 9339;
const BOOT_WAIT_MS = 25000;

const AUDIT_JS = `(() => {
  const parse = (c) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(/[,\\s/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.some((n) => Number.isNaN(n))) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const pageBg = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
  const effBg = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const bg = parse(getComputedStyle(n).backgroundColor);
      if (bg && bg.a > 0.5) return bg;
      n = n.parentElement;
    }
    return pageBg;
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => { const l1 = lum(a); const l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const sel = (el) => {
    if (el.id) return '#' + el.id;
    const cls = String(el.className || '').trim().split(/\\s+/).filter(Boolean).slice(0, 2).join('.');
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
  };
  const lowText = [];
  const meltBox = [];
  const seenT = new Set();
  const seenB = new Set();
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (Number(cs.opacity) < 0.2) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 3 || rect.height < 3) continue;
    if (!rect.width || !rect.height) continue;
    const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (hasOwnText) {
      const fg = parse(cs.color);
      // 背景是渐变（background-image）时不能只看 backgroundColor：
      // 只看它会把「渐变底 + 白字」（如 .logo-mark）误判成白字白底（踩过一次）。
      const hasGradient = cs.backgroundImage && cs.backgroundImage !== 'none';
      const bg = hasGradient ? null : effBg(el);
      if (fg && bg) {
        const r = ratio(fg, bg);
        if (r < 3.0) {
          const k = sel(el) + cs.color;
          if (!seenT.has(k)) {
            seenT.add(k);
            lowText.push({ sel: sel(el), color: cs.color, bg: 'rgb(' + bg.r + ',' + bg.g + ',' + bg.b + ')', ratio: Number(r.toFixed(2)), sample: el.textContent.trim().slice(0, 24) });
          }
        }
      }
    }
    const bg = parse(cs.backgroundColor);
    if (!bg || bg.a < 0.3) continue;
    // 全屏铺底（背景视频 / 星域画布）本就该和页面同色，不是"融入背景的盒子"
    const vw = window.innerWidth * window.innerHeight;
    if (rect.width * rect.height >= vw * 0.95) continue;
    const same = Math.abs(bg.r - pageBg.r) < 6 && Math.abs(bg.g - pageBg.g) < 6 && Math.abs(bg.b - pageBg.b) < 6;
    if (!same) continue;
    const bw = parseFloat(cs.borderTopWidth) || 0;
    const bc = parse(cs.borderTopColor);
    const hasShadow = cs.boxShadow && cs.boxShadow !== 'none';
    const faintBorder = bw > 0 && bc && bc.a < 0.15;
    if (!hasShadow && (faintBorder || bw === 0)) {
      const k = sel(el);
      if (!seenB.has(k)) {
        seenB.add(k);
        meltBox.push({ sel: sel(el), bg: cs.backgroundColor, border: bw > 0 ? cs.borderTopColor : 'none', borderW: bw, shadow: hasShadow ? 'yes' : 'no', size: Math.round(rect.width) + 'x' + Math.round(rect.height) });
      }
    }
  }
  return { theme: document.documentElement.getAttribute('data-theme'), lowText: lowText.slice(0, 60), meltBox: meltBox.slice(0, 60), overflow: overflowCheck() };

  function overflowCheck() {
    // 固定宽度容器里的横向溢出。
    // 只查侧栏**底部**（.sidebar-footer 及其子元素）：64px 宽下曾把「通讯已建立」
    // 和「打开 Web UI (:3080)」的右半截裁掉，看着像坏掉的方块。
    // 不查 .nav-btn —— 导航标签是 opacity:0 刻意留在布局里的，悬停时侧栏整体展开到
    // 240px 才显示，静止态 scrollWidth 大于 clientWidth 属于设计的一部分（不是缺陷）。
    const out = [];
    for (const sel of ['.sidebar-footer', '.status-pill', '#openWebBtn', '.win-indicator']) {
      for (const el of document.querySelectorAll(sel)) {
        if (el.offsetParent === null && el.tagName !== 'BODY') continue;
        if (el.scrollWidth > el.clientWidth + 2) {
          out.push({ sel, clientW: el.clientWidth, scrollW: el.scrollWidth, text: (el.textContent || '').trim().slice(0, 18) });
        }
      }
    }
    return out.slice(0, 20);
  }
})()`;

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForPage(onDead) {
  const deadline = Date.now() + BOOT_WAIT_MS;
  for (;;) {
    const dead = onDead();
    if (dead !== null && dead !== undefined) throw new Error(`Electron 已退出（code ${dead}）`);
    try {
      const targets = await getJson(`http://127.0.0.1:${PORT}/json/list`);
      const p = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p;
    } catch { /* 未就绪 */ }
    if (Date.now() > deadline) throw new Error(`CDP 未在 ${BOOT_WAIT_MS}ms 内就绪`);
    await sleep(300);
  }
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const electron = require(path.join(ROOT, 'node_modules', 'electron'));
  const child = spawn(electron, [
    `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*',
    '--disable-gpu', '--disable-software-rasterizer', '--in-process-gpu', '--no-sandbox',
    '--force-device-scale-factor=1',
    ROOT,
  ], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DSH_DEV_INSTANCE: 'light-audit', DSH_NO_AUTOSTART: '1' },
  });
  let exited = null;
  const boot = [];
  const cap = (b) => { for (const l of String(b).split(/\r?\n/)) { if (l.trim()) { boot.push(l); if (boot.length > 60) boot.shift(); } } };
  child.stdout.on('data', cap);
  child.stderr.on('data', cap);
  child.on('exit', (c) => { exited = c; });

  let ws;
  try {
    const page = await waitForPage(() => exited);
    const WebSocket = require(path.join(ROOT, 'node_modules', 'ws'));
    ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
    let id = 0;
    const pending = new Map();
    ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result && r.result.exceptionDetails) return { __error: String(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) };
      return r.result && r.result.result ? r.result.result.value : undefined;
    };

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.bringToFront');
    await sleep(2500);

    // 切主题（默认 light；可用 DSH_AUDIT_THEME=graphite|dark|custom 复核其它主题没被改坏）
    const AUDIT_THEME = process.env.DSH_AUDIT_THEME || 'light';
    await evalJs(`(() => { if (window.__dshThemes) window.__dshThemes.apply(${JSON.stringify(AUDIT_THEME)}); return document.documentElement.getAttribute('data-theme'); })()`);
    await sleep(900);

    const pages = [['dashboard', '仪表盘'], ['chat', '对话'], ['market', '插件市场'], ['settings', '设置']];
    const report = { theme: null, pages: {}, shots: [] };
    for (const [key, label] of pages) {
      await evalJs(`document.querySelector('.nav-btn[data-page="${key}"]') && document.querySelector('.nav-btn[data-page="${key}"]').click()`);
      await sleep(1600);
      const res = await evalJs(AUDIT_JS);
      report.theme = res && res.theme;
      report.pages[key] = res && res.__error ? { error: res.__error } : { lowText: (res && res.lowText) || [], meltBox: (res && res.meltBox) || [], overflow: (res && res.overflow) || [] };
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      const data = shot && shot.result && shot.result.data;
      if (data) {
        const f = path.join(OUT_DIR, key + '.png');
        fs.writeFileSync(f, Buffer.from(data, 'base64'));
        report.shots.push(f);
      }
      console.log(`  [${label}] 低对比文字 ${report.pages[key].lowText ? report.pages[key].lowText.length : '-'} 处 / 融入背景盒子 ${report.pages[key].meltBox ? report.pages[key].meltBox.length : '-'} 处 / 横向溢出 ${report.pages[key].overflow ? report.pages[key].overflow.length : '-'} 处`);
    }

    // 设置页是手风琴式，展开第一个模块再截一张
    const opened = await evalJs(`(() => { const h = document.querySelector('.settings-module-head'); if (h) { h.click(); return true; } return false; })()`);
    if (opened) {
      await sleep(900);
      const res = await evalJs(AUDIT_JS);
      report.pages['settings-open'] = { lowText: res.lowText, meltBox: res.meltBox };
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      if (shot && shot.result && shot.result.data) {
        const f = path.join(OUT_DIR, 'settings-open.png');
        fs.writeFileSync(f, Buffer.from(shot.result.data, 'base64'));
        report.shots.push(f);
      }
      console.log(`  [设置·展开] 低对比文字 ${res.lowText.length} 处 / 融入背景盒子 ${res.meltBox.length} 处`);
    }

    fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
    console.log('报告:', path.join(OUT_DIR, 'report.json'));
  } catch (e) {
    console.error('FAIL:', e.message);
    console.error(boot.slice(-8).join('\n'));
    process.exitCode = 1;
  } finally {
    try { ws && ws.close(); } catch { /* ignore */ }
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  }
})();
