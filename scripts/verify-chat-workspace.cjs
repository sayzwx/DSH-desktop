/**
 * 对话页工作区行为实测（CDP 驱动真实 Electron + live harness）
 *
 * 场景：
 *  1) 「＋ 新会话」一键开聊：不弹文件夹选择器、直接创建默认目录（未分组）会话
 *  2) 添加工作区后：筛选视图保持"全部"，历史会话仍然可见
 *  3) 在工作区分组内「＋」新建会话：其他历史不受影响
 *  4) 工具栏筛选切换：收窄到某工作区 → 切回"全部"恢复所有历史
 *
 * 用法: node scripts/verify-chat-workspace.cjs
 */
(async () => {
  const http = require('node:http');
  const path = require('node:path');
  const fs = require('node:fs');
  const APP = 'D:\\DSH-desktop';
  const { spawn } = require('node:child_process');
  const WebSocket = require(path.join(APP, 'node_modules', 'ws'));
  const WS_TEST_DIR = path.join(APP, 'scripts', '.scratch', 'ws-test');

  // 清掉旧测试实例，起全新实例
  try {
    const { execSync } = require('node:child_process');
    execSync('powershell -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'electron.exe\'\\" | Where-Object { $_.CommandLine -like \'*9223*\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"');
  } catch { /* ignore */ }
  await new Promise((r) => setTimeout(r, 800));
  fs.mkdirSync(WS_TEST_DIR, { recursive: true });

  spawn(path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe'),
    ['--remote-debugging-port=9223', '--remote-allow-origins=*', APP], { cwd: APP, stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 60 && !targets; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      targets = await new Promise((res, rej) => http.get('http://127.0.0.1:9223/json/list', (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
    } catch { targets = null; }
  }
  const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
  const ws = new WebSocket(page.webSocketDebuggerUrl, { origin: 'http://localhost' });
  let seq = 0; const pend = new Map();
  ws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
  await new Promise((r) => ws.on('open', r));
  const send = (method, params) => new Promise((r2) => { const id = ++seq; pend.set(id, r2); ws.send(JSON.stringify({ id, method, params: params || {} })); });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EXC ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  await send('Runtime.enable');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 等 harness 就绪、对话页连接
  for (let i = 0; i < 60; i++) {
    const ready = await ev(`document.readyState==='complete' && document.getElementById('chatShell').style.display !== 'none'`);
    if (ready) break;
    await sleep(1000);
  }
  await sleep(1500);
  const failures = [];
  const ok = (name, cond, detail) => {
    console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? '  [' + detail + ']' : ''));
    if (!cond) failures.push(name + (detail ? ' :: ' + detail : ''));
  };

  // 拦截记录：chatCreate / pickWorkspaceDir 调用；并记录本测试创建的会话 id（清理用）
  await ev(`(() => {
    window.__calls = { create: [], pick: [] };
    window.__createdSid = null;
    const a = window.api;
    const origCreate = a.chatCreate.bind(a);
    const origPick = a.pickWorkspaceDir.bind(a);
    a.chatCreate = (opts) => {
      window.__calls.create.push(opts === null ? null : opts);
      const r = origCreate(opts);
      if (r && typeof r.then === 'function') {
        return r.then((res) => { if (res && res.ok && res.sessionId) window.__createdSid = res.sessionId; return res; });
      }
      if (r && r.ok && r.sessionId) window.__createdSid = r.sessionId;
      return r;
    };
    a.pickWorkspaceDir = () => { window.__calls.pick.push(1); return Promise.resolve({ ok: true, cancelled: true, path: null }); };
    return 1;
  })()`);

  const sessionsSnapshot = () => ev(`({
    groups: [...document.querySelectorAll('#chatSessions .ws-group')].map(g => ({
      key: g.dataset.key, title: g.querySelector('.ws-group-title')?.textContent,
      count: g.querySelectorAll('.chat-session').length,
      ids: [...g.querySelectorAll('.chat-session')].map(e => e.dataset.id),
    })),
    wsName: document.getElementById('ctWsName')?.textContent,
    active: document.querySelector('#chatSessions .chat-session.active')?.dataset.id || null,
  })`);

  console.log('\n[1] 「＋ 新会话」一键开聊（不强制选工作区）');
  const before = await sessionsSnapshot();
  await ev(`document.getElementById('chatNewSession').click()`);
  await sleep(2500);
  const after1 = await sessionsSnapshot();
  const calls1 = await ev(`window.__calls`);
  ok('未弹出文件夹选择器（pickWorkspaceDir 未被调用）', calls1.pick.length === 0, 'pick=' + calls1.pick.length);
  ok('新会话已创建/打开（有激活会话；复用空白时 active 可能不变）', after1.active !== null, `active=${after1.active}`);
  const newGroup = after1.groups.find((g) => g.title === '未分组');
  ok('新会话出现在「未分组」', !!newGroup && newGroup.ids.includes(after1.active), JSON.stringify(newGroup || null));
  ok('工作区控件仍为「全部」', after1.wsName === '全部', after1.wsName);
  ok('chatCreate 以默认目录调用（null / 复用空白会话）', calls1.create.length === 0 || calls1.create[calls1.create.length - 1] === null, JSON.stringify(calls1.create));

  console.log('\n[2] 添加工作区（stub 原生选择器）→ 历史保持可见');
  await ev(`(() => {
    const a = window.api;
    a.pickWorkspaceDir = () => Promise.resolve({ ok: true, cancelled: false, path: ${JSON.stringify(WS_TEST_DIR.replace(/\\/g, '\\\\'))} });
    return 1;
  })()`);
  // 打开工作区菜单 → 点「添加工作区…」
  await ev(`document.getElementById('ctWsBtn').click()`);
  await sleep(300);
  const addBtn = await ev(`(() => {
    const btns = [...document.querySelectorAll('#ctWsPanel .ct-wi')];
    const add = btns.find((b) => b.dataset.id === '__add__');
    if (add) add.click();
    return !!add;
  })()`);
  ok('菜单中有「添加工作区…」', addBtn);
  await sleep(3000);
  const after2 = await sessionsSnapshot();
  ok('添加后仍为「全部」视图（不自动筛选）', after2.wsName === '全部', after2.wsName);
  ok('未分组历史会话仍然可见', after2.groups.some((g) => g.title === '未分组' && g.count > 0), JSON.stringify(after2.groups.map((g) => [g.title, g.count])));
  const wsGroup = after2.groups.find((g) => g.key !== '__ungrouped__' && g.title !== '未分组');
  ok('新工作区分组已出现', !!wsGroup, JSON.stringify(after2.groups));

  console.log('\n[3] 工作区分组内「＋」新建会话 → 其他历史不受影响');
  const wsAdd = await ev(`(() => {
    const g = [...document.querySelectorAll('#chatSessions .ws-group')].find((x) => x.dataset.key !== '__ungrouped__' && x.querySelector('.ws-group-title')?.textContent !== '未分组');
    if (!g) return false;
    const add = g.querySelector('.ws-group-add');
    if (!add) return false;
    add.click();
    return true;
  })()`);
  ok('工作区分组有「＋」按钮', wsAdd);
  await sleep(2500);
  const after3 = await sessionsSnapshot();
  const wsGroup3 = after3.groups.find((g) => g.key !== '__ungrouped__' && g.title !== '未分组');
  ok('新会话归属该工作区', wsGroup3 && wsGroup3.ids.includes(after3.active), JSON.stringify(wsGroup3 || null));
  ok('未分组历史仍然可见', after3.groups.some((g) => g.title === '未分组' && g.count > 0));
  ok('仍为「全部」视图', after3.wsName === '全部');

  console.log('\n[4] 工具栏筛选切换（收窄 → 恢复全部）');
  await ev(`document.getElementById('ctWsBtn').click()`);
  await sleep(300);
  const filterToWs = await ev(`(() => {
    const btns = [...document.querySelectorAll('#ctWsPanel .ct-wi')];
    const t = btns.find((b) => b.dataset.id && b.dataset.id !== '__add__' && b.querySelector('.ct-wi-name')?.textContent !== '未命名工作区');
    if (!t) return null;
    const id = t.dataset.id; t.click(); return id;
  })()`);
  ok('菜单能切到具体工作区', filterToWs !== null);
  await sleep(800);
  const filtered = await sessionsSnapshot();
  ok('筛选后只显示该工作区会话', filtered.groups.length === 1 && filtered.wsName !== '全部', JSON.stringify(filtered.groups.map((g) => [g.title, g.count])));
  // 切回全部
  await ev(`document.getElementById('ctWsBtn').click()`);
  await sleep(300);
  await ev(`(() => { const b = [...document.querySelectorAll('#ctWsPanel .ct-wi')].find((x) => x.dataset.id === ''); if (b) b.click(); return 1; })()`);
  await sleep(800);
  const restored = await sessionsSnapshot();
  ok('切回「全部」后所有历史恢复可见', restored.wsName === '全部' && restored.groups.length >= 2
    && restored.groups.some((g) => g.title === '未分组'), JSON.stringify(restored.groups.map((g) => [g.title, g.count])));

  // 清理：只归档本测试通过 chatCreate 创建的会话（绝不动其他历史会话）
  try {
    const created = await ev(`window.__createdSid`);
    if (created) await ev(`window.api.chatArchiveSession('${created}')`);
  } catch { /* 清理失败不影响结论 */ }

  console.log('\n' + (failures.length ? 'FAILURES:\n' + failures.join('\n') : 'ALL CHAT-WORKSPACE CHECKS PASSED'));
  ws.close();
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });