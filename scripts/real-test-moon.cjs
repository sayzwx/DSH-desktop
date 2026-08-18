/**
 * 紫月主题·真机实测驱动（CDP）
 *
 * 用 Chrome DevTools Protocol 驱动真实 Electron 窗口：
 *  1) 切换主题（moon / dark）
 *  2) 每 200ms 抓一帧整窗截图
 *  3) 顺带采样双视频状态（currentTime / opacity / fading）
 * 输出：
 *  - 相邻帧平均像素差异序列（画面"震动"量化指标）
 *  - 与 baseline 主题（dark）的对比
 *  - 视频调度状态日志
 *
 * 用法: node scripts/real-test-moon.cjs <theme> <frames> [delayMs]
 *   例: node scripts/real-test-moon.cjs moon 50
 *       node scripts/real-test-moon.cjs dark 30
 */
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const THEME = process.argv[2] || 'moon';
const FRAMES = parseInt(process.argv[3] || '50', 10);
const DELAY = parseInt(process.argv[4] || '200', 10);
const PORT = 9223;
const APP_DIR = 'D:\\DSH-desktop';
const OUT_DIR = path.join(APP_DIR, 'scripts', '.scratch', 'shots-' + THEME);

const WebSocket = require(path.join(APP_DIR, 'node_modules', 'ws'));
const { execFileSync } = require('node:child_process');

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // 若已有 electron 在跑，直接复用；否则启动一个
  let owner = null;
  const waitTarget = async (attempts) => {
    for (let i = 0; i < (attempts || 60); i++) {
      try {
        const list = await new Promise((resolve, reject) => {
          http.get(`http://127.0.0.1:${PORT}/json/list`, (res) => {
            let d = ''; res.on('data', (c) => (d += c));
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
          }).on('error', reject);
        });
        const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'));
        if (page) return page;
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('CDP target not found');
  };

  let page;
  try {
    page = await waitTarget(5);
  } catch {
    console.log('starting electron with CDP...');
    const exe = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');
    owner = spawn(exe, [`--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', APP_DIR], {
      cwd: APP_DIR, stdio: 'ignore', windowsHide: false,
    });
    page = await waitTarget(60);
  }
  console.log('page:', page.url);

  const ws = new WebSocket(page.webSocketDebuggerUrl, { origin: 'http://localhost' });
  let seq = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    }
  });
  await new Promise((r) => ws.on('open', r));

  await send('Runtime.enable');
  await send('Page.enable');

  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };

  // 等待页面初始化完成（脚本加载 + app.js init 的 setTheme 执行）
  for (let i = 0; i < 40; i++) {
    const ready = await evalJs(`(document.readyState === 'complete'
      && !!document.querySelector('#themeSelect')
      && document.documentElement.dataset.theme !== undefined
      && !!window.__bgMoon)`);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  // 切换主题（走真实 UI 事件链）
  await evalJs(`(() => {
    const sel = document.querySelector('#themeSelect');
    sel.value = '${THEME}';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 1500));

  const shots = [];
  const log = [];
  for (let i = 0; i < FRAMES; i++) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT_DIR, String(i).padStart(3, '0') + '.png');
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    shots.push(file);
    const st = await evalJs(`(() => {
      const A = document.querySelector('#bgmoonA');
      const B = document.querySelector('#bgmoonB');
      const g = window.__bgMoon ? window.__bgMoon.getInfo() : null;
      return {
        t: performance.now(),
        theme: document.documentElement.dataset.theme,
        a: A ? { ct: A.currentTime, op: A.style.opacity, p: A.paused } : null,
        b: B ? { ct: B.currentTime, op: B.style.opacity, p: B.paused } : null,
        info: g,
      };
    })()`);
    log.push(st);
    await new Promise((r) => setTimeout(r, DELAY));
  }

  // 相邻帧差异（画面震动量化）
  const script = `
import numpy as np
from PIL import Image
import glob, sys, json
files = sorted(glob.glob(r'${OUT_DIR}/*.png'))
prev = None
diffs = []
for f in files:
    a = np.asarray(Image.open(f).convert('L')).astype(np.float32) / 255.0
    if prev is not None:
        diffs.append(float(np.mean(np.abs(a - prev))))
    prev = a
if not diffs:
    print(json.dumps({'error': 'no frames'})); sys.exit(0)
arr = np.array(diffs)
print(json.dumps({
  'n': len(diffs),
  'mean': float(arr.mean()),
  'p95': float(np.percentile(arr, 95)),
  'max': float(arr.max()),
  'min': float(arr.min()),
  'median': float(np.median(arr)),
}))
`;
  const metric = JSON.parse(execFileSync('python', ['-c', script], { encoding: 'utf8' }).trim());

  // 采样视频状态：淡入淡出触发次数 / 稳态不透明度
  const fadeLog = log.filter((s) => s.info && s.info.fading);
  const solid = log.filter((s) =>
    (s.a && Math.abs(parseFloat(s.a.op) - 1) < 0.02) || (s.b && Math.abs(parseFloat(s.b.op) - 1) < 0.02));

  console.log('\n==== 实测报告 theme=' + THEME + ' ====');
  console.log('frames:', shots.length, ' interval:', DELAY + 'ms');
  console.log('相邻帧差异 mean=' + metric.mean.toFixed(4) + ' p95=' + metric.p95.toFixed(4) + ' max=' + metric.max.toFixed(4));
  console.log('淡入淡出中采样数:', fadeLog.length, '/', log.length);
  console.log('采样到不透明度=1 的次数:', solid.length, '/', log.length);
  const sample = log[Math.min(2, log.length - 1)];
  console.log('状态样例:', JSON.stringify({ theme: sample.theme, a: sample.a, fading: sample.info && sample.info.fading }));

  if (owner) { try { owner.kill(); } catch {} }
  ws.close();
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });