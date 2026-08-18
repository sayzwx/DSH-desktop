/**
 * 紫月主题·页内逐帧实测
 * 用 requestVideoFrameCallback + canvas 直接量化渲染器呈现的每一帧：
 *  - 相邻呈现帧差异（应 ≈ 素材 1/30s 运动量，无突跳）
 *  - 中缝/外缝跨越点的差异（应极小 = 无缝）
 *  - 与 ffmpeg 参考帧对比（确认屏幕内容 = 素材，无花屏/冻结）
 * 不受窗口遮挡影响（不依赖整窗截图）。
 * 用法: node scripts/.scratch/measure-frames.cjs
 */
(async () => {
  const http = require('node:http');
  const path = require('node:path');
  const fs = require('node:fs');
  const APP = 'D:\\DSH-desktop';
  const { spawn, execFileSync } = require('node:child_process');
  const WebSocket = require(path.join(APP, 'node_modules', 'ws'));
  const SCRATCH = path.join(APP, 'scripts', '.scratch');

  let targets;
  try {
    targets = await new Promise((res, rej) => http.get('http://127.0.0.1:9223/json/list', (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  } catch {
    spawn(path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe'),
      ['--remote-debugging-port=9223', '--remote-allow-origins=*', APP], { cwd: APP, stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 8000));
    targets = await new Promise((res, rej) => http.get('http://127.0.0.1:9223/json/list', (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  }
  const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
  const ws = new WebSocket(page.webSocketDebuggerUrl, { origin: 'http://localhost' });
  let seq = 0; const pend = new Map();
  ws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
  await new Promise((r) => ws.on('open', r));
  const send = (method, params) => new Promise((r2) => { const id = ++seq; pend.set(id, r2); ws.send(JSON.stringify({ id, method, params: params || {} })); });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval EXC: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  await send('Runtime.enable');

  // 等页面就绪并切到 moon
  for (let i = 0; i < 40; i++) {
    const ready = await ev(`document.readyState==='complete' && !!document.querySelector('#bgmoonA') && !!window.__bgMoon`);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await ev(`(() => { const s = document.querySelector('#themeSelect'); s.value='moon'; s.dispatchEvent(new Event('change',{bubbles:true})); return 1; })()`);
  await new Promise((r) => setTimeout(r, 2500));

  // 页内逐帧测量：等素材走到末尾段再采 4 秒（跨过外缝 10→0，中缝已在途中）
  const result = await ev(`(async () => {
    const v = document.querySelector('#bgmoonA');
    if (!v || typeof v.requestVideoFrameCallback !== 'function') return { err: 'no rVFC' };
    // 等 ct 进入 [8.8, 9.2] 区间再开始（确保 4s 采样窗口跨过外缝）
    const waitT = Date.now();
    while ((v.currentTime < 8.8 || v.currentTime > 9.2) && Date.now() - waitT < 12000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const W = 96, H = 54;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    let prev = null;
    const out = [];
    let lastCt = -1;
    const sample = () => {
      cx.drawImage(v, 0, 0, W, H);
      const d = cx.getImageData(0, 0, W, H).data;
      let s = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { s += (d[i] + d[i + 1] + d[i + 2]) / 3; n++; }
      return { g: s / n };
    };
    return await new Promise((resolve) => {
      const T0 = performance.now();
      const DUR = 4000; // ms
      const step = (now, meta) => {
        const cur = sample();
        const ct = v.currentTime;
        if (prev !== null) {
          out.push({ t: +(now - T0).toFixed(1), dt: +(meta.mediaTime - lastCt).toFixed(4), g: +cur.g.toFixed(2), dg: +Math.abs(cur.g - prev.g).toFixed(3), ct: +ct.toFixed(3) });
        } else {
          out.push({ t: 0, dt: 0, g: +cur.g.toFixed(2), dg: 0, ct: +ct.toFixed(3) });
        }
        prev = cur; lastCt = meta.mediaTime;
        if (now - T0 < DUR) v.requestVideoFrameCallback(step);
        else resolve(out);
      };
      v.requestVideoFrameCallback(step);
    });
  })()`);
  if (result.err) { console.error('ERR', result.err); process.exit(1); }

  // 汇总
  console.log('呈现帧数:', result.length, ' 时长: 4000ms');
  const dgs = result.slice(1).map((r) => r.dg);
  const maxDg = Math.max(...dgs);
  const big = result.filter((r, i) => i > 0 && r.dg > 3.0); // 亮度突变提示
  console.log('相邻帧亮度变化: mean=' + (dgs.reduce((a, b) => a + b, 0) / dgs.length).toFixed(2)
    + ' max=' + maxDg.toFixed(2));
  // 跨缝观察：ct 单调递进说明播放连续；ct 回绕处（外缝）变化应极小
  const cts = result.map((r) => r.ct);
  let wraps = 0; const wrapDiffs = [];
  for (let i = 1; i < cts.length; i++) {
    if (cts[i] - cts[i - 1] < -1.5) { // 外缝回绕（10→0）
      wraps++;
      wrapDiffs.push(dgs[i - 1]);
    }
  }
  console.log('外缝(10s→0s)回绕次数:', wraps, ' 回绕处相邻帧亮度变化:', wrapDiffs.map((x) => x.toFixed(2)).join(', ') || '无');
  if (big.length) console.log('突变帧(t, dg, ct):', big.slice(0, 8).map((r) => `${r.t}ms/${r.dg}/${r.ct}`).join('  '));
  else console.log('无显著突变帧（>3.0 亮度差）');
  console.log('样例(前5帧):', JSON.stringify(result.slice(0, 5)));

  // 与 ffmpeg 参考帧对比（屏幕内容 = 素材）——同一时刻取 canvas 帧与 ct
  const probe = await ev(`(() => {
    const v = document.querySelector('#bgmoonA');
    const W = 96, H = 54;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(v, 0, 0, W, H);
    const d = Array.from(cx.getImageData(0, 0, W, H).data);
    return { d, ct: v.currentTime };
  })()`);
  const probeCt = probe.ct;
  fs.writeFileSync(path.join(SCRATCH, 'inpage.json'), JSON.stringify(probe.d));
  const ref = path.join(SCRATCH, 'ref2.png');
  const ff = 'C:\\Users\\shiy\\AppData\\Roaming\\Python\\Python314\\site-packages\\imageio_ffmpeg\\binaries\\ffmpeg-win-x86_64-v7.1.exe';
  // 逐帧精确 seek（-i 后 -ss：解码到目标时刻），消除关键帧误差
  execFileSync(ff, ['-hide_banner', '-loglevel', 'error', '-i', path.join(APP, 'renderer', 'bg-moon-loop.mp4'), '-ss', String(Math.max(0, probeCt - 0.03)), '-frames:v', '1', '-y', ref]);
  const py = execFileSync('python', ['-c', `
import numpy as np, json
from PIL import Image
ref = np.asarray(Image.open(r'${ref.replace(/\\/g, '\\\\')}').convert('L').resize((96, 54))).astype(np.float32)/255.0
g = np.array(json.load(open(r'${path.join(SCRATCH, 'inpage.json').replace(/\\/g, '\\\\')}'))).reshape(54, 96, 4).astype(np.float32)
page = (g[:,:,0]+g[:,:,1]+g[:,:,2])/3/255.0
print(f'{float(np.mean(np.abs(page-ref))):.4f}')
`], { encoding: 'utf8' }).trim();
  console.log('屏幕内容 vs 素材参考帧 diff:', py, ' (ct≈' + probeCt.toFixed(2) + '；<0.05 即内容一致)');

  ws.close();
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });