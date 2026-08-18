/**
 * 权限预设 + 上下文/花费 实测（CDP 驱动真实 Electron + live harness）
 *
 * 场景：
 *  1) 对话工具栏出现「权限」分段控件（3 个预设，当前值高亮）
 *  2) 切换 read-only → harness 投影确认；切换 danger-full-access 走风险确认弹窗
 *  3) 底部上下文/花费条：发一条真实消息后出现 tokens/百分比/估算花费
 *  4) 设置页「默认权限」与 Web UI 同一 settings.mutate 路径，保存后生效
 * 用法: node scripts/verify-chat-perm-usage.cjs
 */
(async () => {
  const http = require('node:http');
  const path = require('node:path');
  const fs = require('node:fs');
  const APP = 'D:\\DSH-desktop';
  const { spawn } = require('node:child_process');
  const WebSocket = require(path.join(APP, 'node_modules', 'ws'));

  // 清旧测试实例，起新实例
  try {
    const { execSync } = require('node:child_process');
    execSync('powershell -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'electron.exe\'\\" | Where-Object { $_.CommandLine -like \'*9223*\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"');
  } catch { /* ignore */ }
  await new Promise((r) => setTimeout(r, 800));
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
  for (let i = 0; i < 60; i++) {
    if (await ev(`document.readyState==='complete' && document.getElementById('chatShell').style.display !== 'none'`)) break;
    await sleep(1000);
  }
  await sleep(1500);

  const failures = [];
  const ok = (name, cond, detail) => {
    console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? '  [' + detail + ']' : ''));
    if (!cond) failures.push(name + (detail ? ' :: ' + detail : ''));
  };
  const permBtns = () => ev(`[...document.querySelectorAll('#ctPermSeg .ct-perm')].map(b => ({ v: b.dataset.perm, active: b.classList.contains('active') }))`);
  const permRowVisible = () => ev(`!document.getElementById('ctPermRow').hidden`);
  const usageBarText = () => ev(`({ hidden: document.getElementById('chatUsageBar').hidden, ctx: document.getElementById('cuContext').textContent, cost: document.getElementById('cuCost').textContent, fill: document.getElementById('cuFill').style.width })`);

  // 拦截 chatCreate：记录本测试创建的会话 id（清理时只归档它，绝不误伤历史会话）
  await ev(`(() => {
    window.__createdSid = null;
    const a = window.api;
    const orig = a.chatCreate.bind(a);
    a.chatCreate = async (opts) => {
      const r = await orig(opts);
      if (r.ok && r.sessionId) window.__createdSid = r.sessionId;
      return r;
    };
    return 1;
  })()`);

  console.log('\n[1] 新建会话 → 权限控件出现（跟随部署实际状态）');
  await ev(`document.getElementById('chatNewSession').click()`);
  await sleep(2500);
  // 优先用 chatCreate 创建出的会话；若复用了既有空白会话，则用当前激活会话（仅用于只读断言）
  let testSid = await ev(`window.__createdSid`);
  if (!testSid) testSid = await ev(`document.querySelector('#chatSessions .chat-session.active')?.dataset.id || null`);
  ok('已创建测试会话（或复用了既有空白会话）', !!testSid, testSid);
  const btns1 = await permBtns();
  ok('权限控件可见', await permRowVisible());
  ok('三个预设齐全', btns1.length === 3 && btns1.map((b) => b.v).join(',') === 'read-only,workspace-write,danger-full-access', JSON.stringify(btns1));
  // 权威值 = harness 投影；UI 高亮必须与之一致（不预设具体预设值）
  const authInit = await ev(`(async () => {
    const r = await window.api.chatHistory('${testSid}');
    return r.ok && r.projections?.values?.permissions ? r.projections.values.permissions.currentValue : null;
  })()`);
  const uiActive = btns1.find((b) => b.active)?.v;
  ok('UI 高亮与 harness 投影一致', authInit === null || uiActive === authInit, `ui=${uiActive} auth=${authInit}`);
  const restoreTo = authInit || uiActive || 'workspace-write';

  console.log('\n[2] 切换权限（read-only → 风险门 danger-full-access → 恢复）');
  const dbg = (tag) => ev(`(() => ({
    tag: '${tag}',
    btns: [...document.querySelectorAll('#ctPermSeg .ct-perm')].map(b => b.dataset.perm + (b.classList.contains('active') ? '*' : '')).join(','),
    rowHidden: document.getElementById('ctPermRow').hidden,
    active: document.querySelector('#chatSessions .chat-session.active')?.dataset.id.slice(0, 8) || null,
    errs: [...document.querySelectorAll('#chatMessages .msg-assistant')].map(m => m.textContent.slice(0, 70)).filter(t => t.includes('⚠')).join('|'),
  }))()`);
  await ev(`[...document.querySelectorAll('#ctPermSeg .ct-perm')].find(b => b.dataset.perm === 'read-only').click()`);
  await sleep(1800);
  console.log('  dbg:', JSON.stringify(await dbg('after-readonly')));
  const auth = await ev(`(async () => {
    const r = await window.api.chatHistory('${testSid}');
    return r.ok && r.projections?.values?.permissions ? r.projections.values.permissions.currentValue : 'no-proj';
  })()`);
  ok('read-only 已生效（harness 投影确认）', auth === 'read-only', auth);
  ok('UI 高亮同步为 read-only', (await permBtns()).find((b) => b.active)?.v === 'read-only', JSON.stringify(await permBtns()));

  // danger-full-access → 风险确认弹窗：先取消
  await ev(`[...document.querySelectorAll('#ctPermSeg .ct-perm')].find(b => b.dataset.perm === 'danger-full-access').click()`);
  await sleep(600);
  const modalShown = await ev(`!document.getElementById('modalOverlay').hidden`);
  ok('全权限触发风险确认弹窗', modalShown);
  const modalTitle = await ev(`document.getElementById('modalTitle').textContent`);
  ok('弹窗标题为权限风险确认', modalTitle.includes('权限风险确认'), modalTitle);
  await ev(`document.getElementById('modalCancel').click()`);
  await sleep(500);
  ok('取消后仍为 read-only', (await permBtns()).find((b) => b.active)?.v === 'read-only');
  // 再点并确认
  await ev(`[...document.querySelectorAll('#ctPermSeg .ct-perm')].find(b => b.dataset.perm === 'danger-full-access').click()`);
  await sleep(600);
  await ev(`document.getElementById('modalOk').click()`);
  await sleep(1800);
  const auth2 = await ev(`(async () => {
    const r = await window.api.chatHistory('${testSid}');
    return r.ok && r.projections?.values?.permissions ? r.projections.values.permissions.currentValue : 'no-proj';
  })()`);
  ok('确认后 danger-full-access 生效', auth2 === 'danger-full-access', auth2);
  // 恢复原值（投影缺失时按当前 UI 高亮恢复）
  await ev(`[...document.querySelectorAll('#ctPermSeg .ct-perm')].find(b => b.dataset.perm === '${restoreTo}').click()`);
  await sleep(1500);

  console.log('\n[3] 打开有真实模型用量的会话 → 底部上下文/花费条显示数字');
  // 遍历应用列表中的会话，找一个有真实用量的（percent > 0）
  let usageChecked = false;
  for (let attempt = 0; attempt < 8 && !usageChecked; attempt++) {
    const sid = await ev(`(async () => {
      const r = await window.api.chatList();
      if (!r.ok) return null;
      // 按更新时间取，跳过已归档（不可见）的
      const ids = r.items.map(i => i.sessionId);
      return ids[${attempt}] || null;
    })()`);
    if (!sid) break;
    const opened = await ev(`(() => { const el = document.querySelector('#chatSessions .chat-session[data-id="${sid}"]'); if (el) { el.click(); return true; } return false; })()`);
    await sleep(2500);
    const ub = await usageBarText();
    const pct = parseFloat((ub.ctx.match(/· ([\d.]+)%/) || [])[1] || '0');
    console.log(`    尝试 ${sid.slice(0, 8)}… pct=${pct}%  ctx="${ub.ctx}"  cost="${ub.cost}"`);
    if (pct > 0) { usageChecked = true; }
  }
  const ub1 = await usageBarText();
  ok('用量条已显示', ub1.hidden === false, JSON.stringify(ub1));
  ok('上下文显示 tokens 与百分比', /[\d,]+ \/ [\d,]+ tokens · \d+(\.\d+)?%/.test(ub1.ctx), ub1.ctx);
  ok('百分比 > 0（真实用量）', parseFloat((ub1.ctx.match(/· ([\d.]+)%/) || [])[1] || '0') > 0, ub1.ctx);
  ok('进度条有宽度', parseFloat(ub1.fill) > 0, ub1.fill);
  ok('估算花费已显示', /≈ \$\d/.test(ub1.cost), ub1.cost);

  console.log('\n[4] 设置页「默认权限」同步（跟随 live 当前值，改后恢复）');
  await ev(`document.querySelector('.nav-btn[data-page="settings"]').click()`);
  await sleep(1200);
  const origDefault = await ev(`(async () => {
    const d = await window.api.getSettingsDescribe();
    const ns = d.ok ? (d.namespaces || []).find(n => n.ns === 'permission') : null;
    return ns ? ns.value.defaultPreset : null;
  })()`);
  const permSel = await ev(`(() => {
    const s = document.getElementById('defaultPermissionSelect');
    return { opts: [...s.options].map(o => o.value + ':' + o.textContent), value: s.value };
  })()`);
  ok('设置下拉有 3 个预设', permSel.opts.length === 3, JSON.stringify(permSel.opts));
  ok('下拉值与 harness 一致', permSel.value === origDefault, `sel=${permSel.value} auth=${origDefault}`);
  // 切到 read-only 并保存（走真实 UI 流程）
  await ev(`(() => { const s = document.getElementById('defaultPermissionSelect'); s.value = 'read-only'; document.getElementById('applyDefaultPermissionBtn').click(); return 1; })()`);
  await sleep(1500);
  const saved = await ev(`(async () => {
    const d = await window.api.getSettingsDescribe();
    const ns = d.ok ? (d.namespaces || []).find(n => n.ns === 'permission') : null;
    return ns ? ns.value.defaultPreset : 'no-ns';
  })()`);
  ok('设置已写入 permission.defaultPreset=read-only', saved === 'read-only', saved);
  await ev(`(() => { const m = document.getElementById('modalOk'); if (!m.hidden) m.click(); return 1; })()`);
  // 恢复原值
  await ev(`(() => { const s = document.getElementById('defaultPermissionSelect'); s.value = '${origDefault}'; document.getElementById('applyDefaultPermissionBtn').click(); return 1; })()`);
  await sleep(1500);
  const restored = await ev(`(async () => {
    const d = await window.api.getSettingsDescribe();
    const ns = d.ok ? (d.namespaces || []).find(n => n.ns === 'permission') : null;
    return ns ? ns.value.defaultPreset : 'no-ns';
  })()`);
  ok(`已恢复原默认（${origDefault}）`, restored === origDefault, restored);
  await ev(`(() => { const m = document.getElementById('modalOk'); if (!m.hidden) m.click(); return 1; })()`);

  // 清理：只归档本测试创建（chatCreate 返回）的会话，绝不误伤历史会话
  try {
    const created = await ev(`window.__createdSid`);
    if (created) await ev(`window.api.chatArchiveSession('${created}')`);
  } catch { /* ignore */ }

  console.log('\n' + (failures.length ? 'FAILURES:\n' + failures.join('\n') : 'ALL PERM-USAGE CHECKS PASSED'));
  ws.close();
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });