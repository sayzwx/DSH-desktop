/**
 * 浅色主题定点放大截图（用来肉眼确认到底是"看不见"还是"能看见但很淡"）。
 * 输出到 dist/light-audit/zoom-*.png，clip 由 CDP 完成裁剪 + scale 放大。
 * 用法: env -u ELECTRON_RUN_AS_NODE node scripts/light-zoom.cjs
 */
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'light-audit');
const PORT = 9342;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (u) => new Promise((res, rej) => http.get(u, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const electron = require(path.join(ROOT, 'node_modules', 'electron'));
  const child = spawn(electron, [
    `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*',
    '--disable-gpu', '--disable-software-rasterizer', '--in-process-gpu', '--no-sandbox',
    '--force-device-scale-factor=1', ROOT,
  ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DSH_DEV_INSTANCE: 'light-zoom', DSH_NO_AUTOSTART: '1' } });
  let ws;
  try {
    let page = null;
    for (let i = 0; i < 60 && !page; i++) {
      await sleep(400);
      try { page = (await getJson(`http://127.0.0.1:${PORT}/json/list`)).find((t) => t.type === 'page' && t.webSocketDebuggerUrl); } catch {}
    }
    if (!page) throw new Error('CDP 未就绪');
    const WebSocket = require(path.join(ROOT, 'node_modules', 'ws'));
    ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
    let id = 0; const pending = new Map();
    ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    const send = (m, p = {}) => new Promise((r2) => { const i = ++id; pending.set(i, r2); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
    const evalJs = async (e) => {
      const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
      if (r.result && r.result.exceptionDetails) return { __error: String(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) };
      return r.result && r.result.result ? r.result.result.value : undefined;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.bringToFront');
    await sleep(2600);
    await evalJs(`(() => { window.__dshThemes.apply('light'); return document.documentElement.getAttribute('data-theme'); })()`);
    await sleep(1000);

    // 采样关键元素的实际渲染像素（ReadPixels 太麻烦，直接放大截图，人眼看）
    const shots = [
      { name: 'zoom-logo', sel: '.logo', scale: 6 },
      { name: 'zoom-card', sel: '#statusCard', scale: 3 },
      { name: 'zoom-charts', sel: '.usage-charts', scale: 2 },
      { name: 'zoom-sidebar', sel: '.sidebar', scale: 3 },
    ];
    for (const s of shots) {
      const box = await evalJs(`(() => { const el = document.querySelector(${JSON.stringify(s.sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()`);
      if (!box || box.__error || !box.width) { console.log('跳过', s.sel); continue; }
      const clip = { x: box.x, y: box.y, width: Math.min(box.width, 900), height: Math.min(box.height, 600), scale: s.scale };
      const r = await send('Page.captureScreenshot', { format: 'png', clip });
      const data = r && r.result && r.result.data;
      if (data) {
        fs.writeFileSync(path.join(OUT, s.name + '.png'), Buffer.from(data, 'base64'));
        console.log('已保存', s.name + '.png', JSON.stringify(clip));
      }
    }
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exitCode = 1;
  } finally {
    try { ws && ws.close(); } catch {}
    try { child.kill('SIGKILL'); } catch {}
  }
})();
