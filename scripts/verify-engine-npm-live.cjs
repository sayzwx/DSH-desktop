/* P0 真机端到端：应用通过 DSH_HARNESS_DIR 指向 **npm 形态引擎**，验证能识别并启动
   用法: node scripts/verify-engine-npm-live.cjs [cdpPort] */
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ROOT = 'D:/DS_harness';
const PORT = Number(process.argv[2] || 9540);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (u) => new Promise((res, rej) => http.get(u, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));

(async () => {
  const env = { ...process.env, DSH_DEV_INSTANCE: 'live-npm-engine', DSH_HARNESS_DIR: 'D:/DS_harness/dist/engine-npm' };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn('D:/DSH/app/DSH.exe', [`--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', '--disable-gpu', '--disable-software-rasterizer', '--in-process-gpu', '--no-sandbox'], { env, stdio: 'ignore' });
  let page = null;
  for (let i = 0; i < 45 && !page; i++) { await sleep(800); try { page = (await getJson(`http://127.0.0.1:${PORT}/json/list`)).find((t) => t.type === 'page'); } catch {} }
  if (!page) { console.log('CDP 未就绪'); process.exit(1); }
  const WebSocket = require(path.join(ROOT, 'node_modules', 'ws'));
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise((r) => { ws.on('open', r); setTimeout(r, 2500); });
  let id = 0; const pending = new Map();
  ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; const t = setTimeout(() => { pending.delete(i); r({ __timeout: true }); }, 40000); pending.set(i, (m) => { clearTimeout(t); r(m); }); ws.send(JSON.stringify({ id: i, method, params })); });
  const js = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };

  const r0 = await js('window.api.startHarness().then((r) => r).catch((e) => ({ crash: String(e.message) }))');
  console.log('startHarness:', JSON.stringify(r0).slice(0, 140));
  let st = null;
  for (let i = 0; i < 40; i++) {
    await sleep(2500);
    st = await js('window.api.getStatus().then((r) => ({ state: r.state, webUp: r.webUp, dir: r.harnessDir, envDir: r.debugHarnessDirEnv, found: r.debugFound }))');
    if (st && st.webUp) break;
    if (i % 4 === 3) console.log(`  …${(i + 1) * 2.5}s state=${st && st.state}`);
  }
  console.log('最终状态:', JSON.stringify(st));
  const logs = await js('window.api.getHarnessLogs && window.api.getHarnessLogs().then((r) => (r.lines || []).slice(-8).join("\\n")).catch(() => "")');
  const rel = String(logs || '').split('\n').filter((l) => /启动 harness|npm|harness exited|exited/.test(l)).slice(-3);
  for (const l of rel) console.log('  日志:', l.slice(0, 140));
  console.log(st && st.webUp ? 'PASS: 应用成功识别并启动 **npm 形态引擎**' : 'FAIL: 未就绪');
  ws.close();
  try { const ver = await getJson(`http://127.0.0.1:${PORT}/json/version`); const bws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((r) => { bws.on('open', r); setTimeout(r, 1200); }); bws.send(JSON.stringify({ id: 1, method: 'Browser.close' })); } catch {}
  await sleep(600); process.exit(st && st.webUp ? 0 : 1);
})();
