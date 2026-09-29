/**
 * 事件流重复连接回归测试（真实 Electron + 真实 main.js + 真实引擎）。
 *
 * 背景 —— 用户长期反馈「每条消息正好显示两份」：重复的用户气泡、重复的回合统计框、
 * 重复的权限告警条。根因是主进程 openStream() 的去重判据只挡 readyState===1（OPEN），
 * 而 openChatStreams() 会被两条独立路径触发（主进程自己的 setState('running') 与渲染层的
 * chat:connect），两者只隔一次 IPC 往返，而到 127.0.0.1 的 WebSocket 握手至少跨一个宏任务
 * —— 第二次调用看到的是一条「握手中」的连接，于是又建了一条。mux 在连接建立时会自动为
 * 每个会话订阅（`session/subscribed` + `session/queue`），两条 mux 就意味着一份事件被投递
 * 两遍，界面上自然每条消息两份。
 *
 * 本测试三个层次，全部可确定复现（不依赖运气）：
 *   A. 单次 chat:connect 之后活连接数为 2（mux + host）。
 *   B. **同一 tick 内并发两次 chat:connect**（复现那条竞态路径）之后仍然是 2。
 *      修复前这里会是 4 —— 前半段这条断言就是给这个 bug 立的桩。
 *   C. 帧级验证：重新建连后，每个会话必须**恰好**收到一条 session/subscribed；
 *      mux 的 session/event 不允许出现重复 (sessionId, event.seq)。
 *      这一层直接对应「界面上重复显示」这个可观察症状。
 *
 * 与 smoke-renderer.cjs 一样以 DSH_DEV_INSTANCE 启动：userData 与正式版隔离，
 * 不会因单实例锁静默退出；对引擎只做只读/连接类操作，不改任何会话数据。
 *
 * 用法: env -u ELECTRON_RUN_AS_NODE node scripts/chat-stream-dedup-e2e.cjs
 */
const http = require('node:http');
const path = require('node:path');
const { spawn, execSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.DEDUP_CDP_PORT || 9336);
const BOOT_WAIT_MS = 20000;
const EXPECTED_LIVE_STREAMS = 2; // mux + host

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
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
    } catch { /* CDP 还没起来，继续轮询 */ }
    if (Date.now() > deadlineMs) throw new Error(`CDP 未在 ${BOOT_WAIT_MS}ms 内就绪（端口 ${PORT}）`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

function killTree(pid) {
  if (pid == null) return;
  try {
    if (process.platform === 'win32') execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    else { try { process.kill(-pid, 'SIGKILL'); } catch { /* ignore */ } try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ } }
  } catch { /* 进程可能已自行退出 */ }
}

function engineUp() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:3080/api/host.describe', { timeout: 2500 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let electron = null;
  try {
    const resolved = require(path.join(ROOT, 'node_modules', 'electron'));
    if (typeof resolved === 'string') electron = resolved;
  } catch { /* 回退到 dist 路径 */ }
  if (!electron) {
    const bin = process.platform === 'win32' ? 'electron.exe' : 'electron';
    electron = path.join(ROOT, 'node_modules', 'electron', 'dist', bin);
  }

  // 本机 GPU 进程起不来时 Electron 会 FATAL 崩溃（"GPU process isn't usable. Goodbye."），
  // 崩了之后 CDP 目标闪现即消失，只会得到一句「CDP 未就绪」，把真因埋掉。
  const child = spawn(electron, [
    `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*',
    '--disable-gpu', '--disable-software-rasterizer', '--in-process-gpu', '--no-sandbox',
    ROOT,
  ], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DSH_DEV_INSTANCE: 'dedup-e2e' },
  });

  const failures = [];
  const notes = [];
  let passed = 0;
  let exitedEarly = null;
  const bootLog = [];
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

  // 看门狗：任何一步挂住都要收场，否则外层命令只能靠超时（实测踩过一次，日志只剩半截）
  const watchdog = setTimeout(() => {
    console.error('FAIL: 看门狗超时（150s），测试自身挂死');
    console.error(bootLog.slice(-10).join('\n'));
    killTree(child.pid);
    process.exit(3);
  }, 150000);

  const check = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) passed++;
    else failures.push(`${name}\n    期望: ${JSON.stringify(expected)}\n    实际: ${JSON.stringify(actual)}`);
    return ok;
  };

  try {
    const page = await waitForPage(Date.now() + BOOT_WAIT_MS, () => exitedEarly);
    if (exitedEarly !== null) throw new Error(`Electron 提前退出（code ${exitedEarly}）`);

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
      if (r.result?.exceptionDetails) {
        return { __error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
      }
      return r.result?.result?.value;
    };

    await send('Runtime.enable');
    await sleep(2500); // 让渲染层脚本与首轮状态探测跑完

    const up = await engineUp();
    if (!up) {
      console.log('SKIP: :3080 引擎未在线 —— 本测试需要真实引擎（端口空闲时 startHarness 会触发引擎自动安装，不能调）');
      clearTimeout(watchdog);
      killTree(child.pid);
      return;
    }

    const started = await evalJs(`window.api.startHarness()`);
    if (!started || started.ok !== true) throw new Error(`startHarness 接管失败: ${JSON.stringify(started)}`);
    await sleep(2500); // 等 setState('running') → openChatStreams → refreshSessions

    // --- A. 稳态：单次 connect 之后活连接数必须是 2（mux + host）---
    const single = await evalJs(`window.api.chatConnect()`);
    if (single?.__error) throw new Error(`chatConnect 抛错: ${single.__error}`);
    check('单次 connect 后活连接数为 2（mux + host）', single?.streams, EXPECTED_LIVE_STREAMS);

    // --- B. 回归：同一 tick 内并发两次 connect（复现 openChatStreams 竞态）---
    // 断开让 chatWs/chatWsHost 归零，下一次调用必然重新建连，此时两条调用之间只隔一次
    // IPC 往返，握手还没完成 —— 修复前第二次会再建一条，活连接数变成 4。
    await evalJs(`window.api.chatDisconnect()`);
    const raced = await evalJs(`Promise.all([window.api.chatConnect(), window.api.chatConnect()]).then((r) => r.map((x) => x.streams))`);
    if (raced?.__error) throw new Error(`并发 chatConnect 抛错: ${raced.__error}`);
    check('并发两次 connect 后活连接数仍为 2（重复连接会被拦下）', raced, [EXPECTED_LIVE_STREAMS, EXPECTED_LIVE_STREAMS]);

    // 连打三次也要稳
    await evalJs(`window.api.chatDisconnect()`);
    await sleep(200);
    const raced3 = await evalJs(`Promise.all([window.api.chatConnect(), window.api.chatConnect(), window.api.chatConnect()]).then((r) => r.map((x) => x.streams))`);
    check('并发三次 connect 后活连接数仍为 2', raced3, [2, 2, 2]);

    // --- C. 帧级验证：重新建连后每个会话恰好一条 session/subscribed ---
    // 引擎的 mux 在连接建立时自动为每个会话订阅（session/subscribed + session/queue），
    // 所以「同一 session 收到两条 subscribed」= 存在两条 mux 连接 = 事件会被投递两遍。
    // 这里刻意走**并发双连接**那条竞态路径：如果主进程没挡住，帧级也会看到重复投递，
    // 于是这条断言和 A/B 一起给出「连接数 → 界面上重复显示」的完整证据链。
    await evalJs(`window.api.chatDisconnect()`);
    await sleep(300);
    const frames = await evalJs(`(async () => {
      const seen = [];
      window.api.onChatFrame((msg) => { seen.push(msg); });
      await Promise.all([window.api.chatConnect(), window.api.chatConnect()]);
      await new Promise((r) => setTimeout(r, 2500));
      const subs = {};
      const evSeqs = {};
      const miscSeqs = {};
      let muxFrameCount = 0;
      for (const m of seen) {
        const p = m && m.payload;
        if (!p) continue;
        if (m.stream === 'mux') muxFrameCount++;
        if (p.type === 'session/subscribed') subs[p.sessionId] = (subs[p.sessionId] || 0) + 1;
        if (p.type === 'session/event' && p.event) {
          const k = p.sessionId + '#' + p.event.seq;
          evSeqs[k] = (evSeqs[k] || 0) + 1;
        }
        // 非事件类 mux 帧（queue/jobs/projection）也会被重复投递，但没有 seq，
        // 用「同一 payload 的 JSON」当指纹看有没有同帧两遍
        if (p.type && p.type !== 'session/event' && m.stream === 'mux') {
          const k = p.type + '|' + (p.sessionId || '') + '|' + JSON.stringify(p).length;
          miscSeqs[k] = (miscSeqs[k] || 0) + 1;
        }
      }
      return {
        total: seen.length,
        muxFrameCount,
        maxSubsPerSession: Object.values(subs).reduce((a, b) => Math.max(a, b), 0),
        sessionCount: Object.keys(subs).length,
        dupEventSeqs: Object.entries(evSeqs).filter(([, n]) => n > 1).length,
        eventCount: Object.keys(evSeqs).length,
        dupMisc: Object.entries(miscSeqs).filter(([, n]) => n > 1).length,
      };
    })()`);
    if (frames?.__error) throw new Error(`帧采集抛错: ${frames.__error}`);

    if (frames.sessionCount === 0) {
      notes.push('本机引擎没有任何可见会话 —— 只验证连接数不变量，帧级断言跳过');
    } else {
      check('每个会话恰好一条 session/subscribed（两条 mux 会出现两条）', frames.maxSubsPerSession, 1);
      check('没有重复的 (sessionId, event.seq)', frames.dupEventSeqs, 0);
      check('没有重复的非事件类 mux 帧', frames.dupMisc, 0);
      notes.push(`建连后 2.5s 收到 mux 帧 ${frames.muxFrameCount} 条、覆盖会话 ${frames.sessionCount} 个、去重后事件 ${frames.eventCount} 条`);
    }

    // 引擎日志里不应出现「重复连接」告警：那条日志是兜底不变量真的触发过的证据
    const dupLogs = await evalJs(`(async () => {
      const logs = await window.api.getLogs();
      return (logs || []).filter((l) => /事件流出现重复连接/.test(l.line || '')).length;
    })()`);
    const dupLogCount = typeof dupLogs === 'number' ? dupLogs : ((dupLogs && dupLogs.__error) ? -1 : 0);
    if (dupLogCount < 0) notes.push('（getLogs 不可用，跳过重复连接告警日志断言）');
    else check('兜底不变量未被触发（主判据已挡住，没走到强切连接）', dupLogCount, 0);

    ws.close();
  } catch (err) {
    const tail = bootLog
      .filter((l) => !/ERROR:(gpu|raster)|Failed to create|ContextResult|DevTools listening/.test(l))
      .slice(-8);
    failures.push(`测试自身失败: ${err.message}`
      + (tail.length ? `\n    启动输出（已滤掉 GPU 噪声）:\n    ${tail.join('\n    ')}` : ''));
  } finally {
    clearTimeout(watchdog);
    killTree(child.pid);
  }

  for (const n of notes) console.log(`  (${n})`);
  if (failures.length > 0) {
    console.error(`FAIL (${failures.length} 项，通过 ${passed} 项)`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`PASS: 事件流连接唯一性（单次/并发二次/并发三次 connect 后活连接数均为 ${EXPECTED_LIVE_STREAMS}；每会话一条 subscribed；无重复事件 seq）共 ${passed} 项`);
}

main();
