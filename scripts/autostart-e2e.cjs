/**
 * 启动行为回归测试（真实 Electron + 真实 main.js + 真实渲染层）。
 *
 * 2026-09-29 用户要求的三件事，这里逐条钉死：
 *   1) **启动应用端就自动启动 Harness**（不要每次手动点「启动 Harness」）
 *      —— 主进程 app.whenReady 里调 autoStartHarness()；:3080 已有服务时直接接管。
 *      本测试通过 harness:logs 里出现「应用启动：…」日志来钉这条链路确实在启动期跑过。
 *   2) **打开后停在控制台**，不要一上来就跳到对话/网页端
 *      —— app.js 启动序列末尾不再自动点击「对话」导航。
 *   3) **控制台「发射控制」卡里有「打开 Web 端」按钮**，且随运行态启用/禁用。
 *
 * 测试自身带 DSH_NO_AUTOSTART=1 启动第二个实例来验证「跳过」分支，再用不带开关的
 * 实例验证「自动接管」分支 —— 两条都要跑，否则开关本身坏了也发现不了。
 *
 * 用法: env -u ELECTRON_RUN_AS_NODE node scripts/autostart-e2e.cjs
 */
const http = require('node:http');
const path = require('node:path');
const { spawn, execSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.AUTOSTART_CDP_PORT || 9338);
const BOOT_WAIT_MS = 20000;
const EXPECTED_LIVE_STREAMS = 2;

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function waitForPage(deadlineMs, onDead) {
  for (;;) {
    const dead = onDead ? onDead() : null;
    if (dead !== null && dead !== undefined) throw new Error(`Electron 已退出（exit code ${dead}）`);
    try {
      const targets = await getJson(`http://127.0.0.1:${PORT}/json/list`);
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* CDP 未就绪，继续轮询 */ }
    if (Date.now() > deadlineMs) throw new Error(`CDP 未在 ${BOOT_WAIT_MS}ms 内就绪（端口 ${PORT}）`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

function killTree(pid) {
  if (pid == null) return;
  try {
    if (process.platform === 'win32') execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    else { try { process.kill(-pid, 'SIGKILL'); } catch { /* ignore */ } try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ } }
  } catch { /* 已退出 */ }
}

function engineUp() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:3080/api/host.describe', { timeout: 2500 }, (res) => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 起一个真实应用实例，返回 { child, evalJs, close }。envExtra 里可带 DSH_NO_AUTOSTART。 */
async function launchInstance(envExtra, bootLog) {
  let electron = null;
  try {
    const resolved = require(path.join(ROOT, 'node_modules', 'electron'));
    if (typeof resolved === 'string') electron = resolved;
  } catch { /* 回退 dist 路径 */ }
  if (!electron) {
    const bin = process.platform === 'win32' ? 'electron.exe' : 'electron';
    electron = path.join(ROOT, 'node_modules', 'electron', 'dist', bin);
  }
  const child = spawn(electron, [
    `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*',
    '--disable-gpu', '--disable-software-rasterizer', '--in-process-gpu', '--no-sandbox',
    ROOT,
  ], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DSH_DEV_INSTANCE: 'autostart-e2e', ...envExtra },
  });
  let exitedEarly = null;
  const capture = (buf) => {
    for (const line of String(buf).split(/\r?\n/)) {
      if (!line.trim()) continue;
      bootLog.push(line);
      if (bootLog.length > 60) bootLog.shift();
    }
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.on('exit', (code) => { exitedEarly = code; });

  const page = await waitForPage(Date.now() + BOOT_WAIT_MS, () => exitedEarly);
  const WebSocket = require(path.join(ROOT, 'node_modules', 'ws'));
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  let msgId = 0;
  const pending = new Map();
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
    return r.result?.result?.value;
  };
  return {
    child, evalJs, send,
    close: () => { try { ws.close(); } catch { /* ignore */ } killTree(child.pid); },
    exited: () => exitedEarly,
  };
}

async function main() {
  const failures = [];
  const notes = [];
  let passed = 0;
  const check = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) passed++;
    else failures.push(`${name}\n    期望: ${JSON.stringify(expected)}\n    实际: ${JSON.stringify(actual)}`);
  };
  const bootLog = [];

  const watchdog = setTimeout(() => {
    console.error('FAIL: 看门狗超时（180s）');
    console.error(bootLog.slice(-10).join('\n'));
    process.exit(3);
  }, 180000);

  let inst;
  try {
    const up = await engineUp();
    if (!up) {
      console.log('SKIP: :3080 引擎未在线 —— 本测试需要真实引擎（端口空闲时会触发引擎自动安装，不能在测试里做）');
      clearTimeout(watchdog);
      return;
    }

    // ===== 实例一：DSH_NO_AUTOSTART=1 → 必须跳过自动启动（测试基建自己依赖这个开关）=====
    inst = await launchInstance({ DSH_NO_AUTOSTART: '1' }, bootLog);
    await inst.send('Runtime.enable');
    await sleep(2500);
    const skipped = await inst.evalJs(`(async () => {
      const logs = await window.api.getLogs();
      return (logs || []).filter((l) => /应用启动：(检测到|未检测到|已自动启动|自动启动失败|自动启动未执行)/.test(l.line || '')).map((l) => l.line);
    })()`);
    if (skipped?.__error) throw new Error(`读日志抛错: ${skipped.__error}`);
    check('DSH_NO_AUTOSTART=1 时不产生任何「应用启动」日志', skipped.length, 0);
    // 启动停在控制台（这条与自动启动无关，两个实例都验）
    const page1 = await inst.evalJs(`({ active: document.querySelector('.page.active')?.id, consoleBtn: !!document.getElementById('consoleOpenWebBtn'), consoleBtnDisabled: document.getElementById('consoleOpenWebBtn')?.disabled })`);
    check('启动后停留在控制台（不自动跳到对话/网页端）', page1.active, 'page-dashboard');
    check('控制台有「打开 Web 端」按钮', page1.consoleBtn, true);
    inst.close();
    inst = null;
    await sleep(1200); // 等上一个实例的进程树退干净，避免端口/单实例锁干扰

    // ===== 实例二：不带开关 → 启动期必须自动拉起（:3080 在线 → 接管）=====
    inst = await launchInstance({}, bootLog);
    await inst.send('Runtime.enable');
    await sleep(3000); // 自动启动在 whenReady 里异步跑，给它一点时间
    const adopted = await inst.evalJs(`(async () => {
      const logs = await window.api.getLogs();
      return (logs || []).filter((l) => /应用启动：(检测到|未检测到|已自动启动|自动启动失败|自动启动未执行)/.test(l.line || '')).map((l) => l.line);
    })()`);
    if (adopted?.__error) throw new Error(`读日志抛错: ${adopted.__error}`);
    check('启动期自动拉起 Harness（接管已有服务）',
      adopted.some((l) => /应用启动：检测到 :3080 已有服务在运行，已接管/.test(l)), true);
    notes.push(`应用启动日志: ${JSON.stringify(adopted)}`);

    const st = await inst.evalJs(`(async () => {
      const s = await window.api.getStatus();
      await new Promise((r) => setTimeout(r, 400));
      return {
        state: s.state, webUp: s.webUp,
        active: document.querySelector('.page.active')?.id,
        consoleBtnDisabled: document.getElementById('consoleOpenWebBtn')?.disabled,
        startDisabled: document.getElementById('startBtn')?.disabled,
      };
    })()`);
    check('引擎在线（已接管）', [st.state === 'running' || st.webUp, st.startDisabled], [true, true]);
    check('启动后停留在控制台（第二个实例同样不跳页）', st.active, 'page-dashboard');
    check('运行中「打开 Web 端」按钮可用', st.consoleBtnDisabled, false);
  } catch (err) {
    const tail = bootLog
      .filter((l) => !/ERROR:(gpu|raster)|Failed to create|ContextResult|DevTools listening/.test(l))
      .slice(-8);
    failures.push(`测试自身失败: ${err.message}` + (tail.length ? `\n    启动输出:\n    ${tail.join('\n    ')}` : ''));
  } finally {
    if (inst) inst.close();
    clearTimeout(watchdog);
  }

  for (const n of notes) console.log(`  (${n})`);
  if (failures.length > 0) {
    console.error(`FAIL (${failures.length} 项，通过 ${passed} 项)`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`PASS: 启动行为（自动拉起 Harness / 跳过开关生效 / 停在控制台不跳页 / 控制台「打开 Web 端」按钮随运行态启停）共 ${passed} 项`);
}

main();
