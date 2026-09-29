/* chat-dup-frame-e2e.cjs —— 「显示框重复」渲染层端到端验证
 *
 * 用户反馈的原始症状：每条消息正好显示两份 —— 重复的用户气泡、重复的权限告警条
 * （⚠ 权限预设已变更为… / ⚠ 沙箱模式已变更为… / ⚠ 审批策略已变更为…）。根因在主进程建了
 * 两条 mux 连接（见 scripts/chat-stream-dedup-e2e.cjs），但**渲染层本身也不该被重复帧击穿**：
 * 旧实现只按消息身份（ev.data.id / messageId / provenance.seq）去重，覆盖不到
 * turn/end、permission/preset、sandbox/mode、approval/policy 这类不带消息 id 的事件。
 *
 * 本测试把「同一帧投递两次」这个输入直接喂给真实的界面，验证渲染层自己就能挡住：
 *   1. 直播帧重复投递 → 用户气泡 / 三条告警条 / 助手正文各只出现一次
 *   2. 助手正文的 chunk 被重复投递 → 文本不翻倍
 *   3. 新 seq 照常渲染（不能因为去重把正常事件也吃掉）
 *   4. 乱序到达的新 seq（10 先于 9）两条都要渲染 —— 丢消息比重复显示更糟
 *   5. 历史窗口已渲染的 seq，随后被直播帧重复投递 → 不再画第二个框
 *
 * 用的是真实 renderer/index.html + 真实 preload.js + 真实 renderer/*.js，
 * 只有引擎 RPC 是桩（本测试不需要引擎）。桩的好处是能确定性地注入重复帧，
 * 且完全不碰用户的真实会话数据。
 *
 * 跑法（cwd 必须是仓库根）：
 *   env -u ELECTRON_RUN_AS_NODE node node_modules/electron/cli.js scripts/chat-dup-frame-e2e.cjs
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
['no-sandbox', 'disable-gpu', 'disable-software-rasterizer', 'in-process-gpu']
  .forEach((s) => app.commandLine.appendSwitch(s));

const ROOT = process.env.DESKTOP_ROOT || 'D:/DS_harness';
const SID = 'session-dup-frame-test';

const failures = [];
const steps = [];
const consoleErrors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 桩：会话与历史可注入 ----------
let historyEvents = [];

// ---------- 通道注册（漏一个页面 boot 不起来；preload 里的 invoke 全量兜底）----------
const preloadSrc = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
const channels = [...new Set([...preloadSrc.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((m) => m[1]))];
const BENIGN = {
  // running + webUp 让对话外壳真正挂起来并自动选中会话（否则 currentSessionId 为 null，所有事件都被 isCur 挡掉）
  'harness:status': () => ({ state: 'running', webUp: true, pid: 1234, port: 3080, harnessDir: 'stub' }),
  'chat:list': () => ({ ok: true, items: [{ sessionId: SID, title: '重复帧测试会话', running: false, updatedAt: Date.now() }] }),
  'chat:history': () => ({ ok: true, events: historyEvents, hasMore: false, projections: null }),
  'chat:connect': () => ({ ok: true, connected: true, streams: 2 }),
  'chat:disconnect': () => ({ ok: true }),
  'chat:models': () => ({ ok: true, value: { provider: 'stub', model: 'stub' } }),
  'notify:getPrefs': () => ({ ok: true, prefs: {} }),
  'workspace:list': () => ({ ok: true, items: [] }),
  'host:describe': () => ({ ok: false, error: 'stub' }),
};
for (const ch of channels) {
  ipcMain.handle(ch, async () => (BENIGN[ch] ? BENIGN[ch]()
    : { ok: false, error: 'stub(' + ch + ')', items: [], list: [], sessions: [], presets: [], providers: [], models: [], namespaces: [] }));
}

// ---------- 帧构造与投递 ----------
const mkEvent = (seq, type, data) => ({ stream: 'mux', payload: { type: 'session/event', sessionId: SID, event: { type, seq, time: Date.now(), data } } });

/** 把一串帧依次投递两遍，模拟两条 mux 连接各推一遍（这是线上真实的到达形态）。 */
function pushTwice(win, frames) {
  for (const f of frames) win.webContents.send('chat:frame', f);
  for (const f of frames) win.webContents.send('chat:frame', f);
}

/** 交错变体：两条连接逐条交替（A1 B1 A2 B2 …），比「整段两遍」更接近真实竞态。 */
function pushInterleaved(win, frames) {
  for (const f of frames) { win.webContents.send('chat:frame', f); win.webContents.send('chat:frame', f); }
}

const PROBE = `(() => {
  const host = document.getElementById('chatMessages');
  const notices = [...host.querySelectorAll('.msg-notice')];
  const text = (el) => el.textContent || '';
  const count = (re) => notices.filter((n) => re.test(text(n))).length;
  const assistants = [...host.querySelectorAll('.msg-assistant:not(.msg-notice)')];
  return {
    userBubbles: host.querySelectorAll('.msg-user').length,
    userTexts: [...host.querySelectorAll('.msg-user')].map((n) => text(n).trim()),
    permNotices: count(/权限预设已变更为/),
    sandboxNotices: count(/沙箱模式已变更为/),
    approvalNotices: count(/审批策略已变更为/),
    permValues: notices.filter((n) => /权限预设已变更为/.test(text(n))).map((n) => text(n).trim()),
    sandboxValues: notices.filter((n) => /沙箱模式已变更为/.test(text(n))).map((n) => text(n).trim()),
    approvalValues: notices.filter((n) => /审批策略已变更为/.test(text(n))).map((n) => text(n).trim()),
    assistantTexts: assistants.map((n) => {
      // 定稿后的 assistant 消息会挂上操作条（复制按钮）与 meta（模型/token），
      // 直接读 textContent 会把按钮文字也读进来 —— 只数正文部分。
      const clone = n.cloneNode(true);
      clone.querySelectorAll('.msg-actions, .msg-meta').forEach((x) => x.remove());
      return (clone.textContent || '').trim();
    }),
    noticeTotal: notices.length,
    sessionId: (document.querySelector('#chatSessions .chat-session.active') || {}).dataset
      ? document.querySelector('#chatSessions .chat-session.active').dataset.id : null,
  };
})()`;

(async () => {
  const watchdog = setTimeout(() => {
    console.error('FAIL: 看门狗超时（150s）');
    console.error(consoleErrors.slice(0, 10).join('\n'));
    app.exit(3);
  }, 150000);

  const check = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failures.push(`${name}\n    期望: ${JSON.stringify(expected)}\n    实际: ${JSON.stringify(actual)}`);
    return ok;
  };

  let win;
  try {
    await app.whenReady();
    win = new BrowserWindow({
      show: false, width: 1440, height: 900,
      webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    });
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) consoleErrors.push(String(message).slice(0, 300));
    });
    const probe = () => win.webContents.executeJavaScript(PROBE, true);

    await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
    await wait(2600);
    await win.webContents.insertCSS('*{transition:none !important;animation:none !important}');

    // 页面自己应当已经把 stub 会话选中（refreshSessions 在 running 时自动 openSession）
    const boot = await probe();
    check('渲染层已挂上真实会话', boot.sessionId, SID);

    // ---------- 1. 直播帧重复投递（整段两遍）----------
    pushTwice(win, [
      mkEvent(1, 'turn/start', {}),
      mkEvent(2, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: '/permission workspace-write' }] }),
      mkEvent(3, 'permission/preset', { preset: 'perm-A' }),
      mkEvent(4, 'sandbox/mode', { mode: 'sandbox-B' }),
      mkEvent(5, 'approval/policy', { policy: 'approval-C' }),
      mkEvent(6, 'assistant/chunk', { chunk: { type: 'block-start', index: 0, blockType: 'text' } }),
      mkEvent(7, 'assistant/chunk', { chunk: { type: 'text-delta', index: 0, text: '收到' } }),
      mkEvent(8, 'assistant/message', { content: [{ type: 'text', text: '收到' }] }),
      mkEvent(9, 'turn/end', {}),
    ]);
    await wait(600);
    const dup = await probe();
    steps.push({ step: '1 · 同一批帧投递两遍', detail: {
      用户气泡: dup.userBubbles, 权限条: dup.permNotices, 沙箱条: dup.sandboxNotices,
      审批条: dup.approvalNotices, 助手消息: dup.assistantTexts.join(' | '), 提示条总数: dup.noticeTotal } });

    check('重复投递后用户气泡只有 1 个', dup.userBubbles, 1);
    check('重复投递后权限预设告警只有 1 条', dup.permNotices, 1);
    check('重复投递后沙箱模式告警只有 1 条', dup.sandboxNotices, 1);
    check('重复投递后审批策略告警只有 1 条', dup.approvalNotices, 1);
    check('重复投递后助手正文只有 1 份（chunk 未翻倍）', dup.assistantTexts, ['收到']);
    check('权限告警带的是本次的值', dup.permValues.some((s) => s.includes('perm-A')), true);
    check('沙箱告警带的是本次的值', dup.sandboxValues.some((s) => s.includes('sandbox-B')), true);
    check('审批告警带的是本次的值', dup.approvalValues.some((s) => s.includes('approval-C')), true);

    // ---------- 2. 交错变体（两条连接逐条交替）----------
    pushInterleaved(win, [
      mkEvent(10, 'permission/preset', { preset: 'perm-D' }),
      mkEvent(11, 'sandbox/mode', { mode: 'sandbox-E' }),
      mkEvent(12, 'approval/policy', { policy: 'approval-F' }),
    ]);
    await wait(500);
    const inter = await probe();
    check('交错重复后权限告警共 2 条（各带本次数值，没有多出第三跳）', inter.permValues.length, 2);
    check('交错重复后沙箱告警共 2 条', inter.sandboxValues.length, 2);
    check('交错重复后审批告警共 2 条', inter.approvalValues.length, 2);
    check('交错重复后新增值恰好各一次', [
      inter.permValues.filter((s) => s.includes('perm-D')).length,
      inter.sandboxValues.filter((s) => s.includes('sandbox-E')).length,
      inter.approvalValues.filter((s) => s.includes('approval-F')).length,
    ], [1, 1, 1]);

    // ---------- 3. 新 seq 照常渲染（不能把正常事件一起吃掉）----------
    win.webContents.send('chat:frame', mkEvent(13, 'permission/preset', { preset: 'perm-G' }));
    await wait(400);
    const fresh = await probe();
    check('未重复的新事件照常渲染', fresh.permValues.filter((s) => s.includes('perm-G')).length, 1);

    // ---------- 4. 乱序到达的新 seq：两条都要渲染 ----------
    win.webContents.send('chat:frame', mkEvent(15, 'permission/preset', { preset: 'perm-H' })); // 15 先到
    win.webContents.send('chat:frame', mkEvent(14, 'permission/preset', { preset: 'perm-I' })); // 14 后到
    await wait(400);
    const ooo = await probe();
    check('乱序后 seq=15 已渲染', ooo.permValues.filter((s) => s.includes('perm-H')).length, 1);
    check('乱序后 seq=14（水位之下但从未应用过）也必须渲染 —— 不能丢消息',
      ooo.permValues.filter((s) => s.includes('perm-I')).length, 1);

    // ---------- 5. 历史已渲染的 seq 被直播帧重复投递 → 不再画第二个框 ----------
    historyEvents = [
      { event: { type: 'user/message', seq: 100, time: Date.now(), data: { source: { kind: 'user' }, content: [{ type: 'text', text: '历史消息' }] } } },
      // 历史里的权限告警不由 renderHistory 渲染，但它的 seq 必须一并记进水位
      { event: { type: 'permission/preset', seq: 101, time: Date.now(), data: { preset: 'perm-J' } } },
    ];
    await win.webContents.reload();
    await wait(2800);
    await win.webContents.insertCSS('*{transition:none !important;animation:none !important}');
    const afterHist = await probe();
    check('历史渲染出 1 个用户气泡', afterHist.userBubbles, 1);
    check('历史里的权限告警不重复渲染（renderHistory 不画它）', afterHist.permNotices, 0);

    // 直播补发同一个 seq：用户消息不得多出第二个气泡，告警也不得凭空出现
    win.webContents.send('chat:frame', mkEvent(100, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: '历史消息' }] }));
    win.webContents.send('chat:frame', mkEvent(101, 'permission/preset', { preset: 'perm-J' }));
    await wait(500);
    const afterReplay = await probe();
    steps.push({ step: '5 · 历史 + 直播补发同 seq', detail: {
      用户气泡: afterReplay.userBubbles, 权限条: afterReplay.permNotices, 用户文本: afterReplay.userTexts.join(' / ') } });
    check('历史已渲染的 seq 被直播补发 → 仍只有 1 个气泡', afterReplay.userBubbles, 1);
    check('历史已记账的 seq 被直播补发 → 告警不出现', afterReplay.permNotices, 0);

    // 之后的新 seq 必须照常工作（历史播种没有把水位抬到未来）
    win.webContents.send('chat:frame', mkEvent(102, 'permission/preset', { preset: 'perm-K' }));
    await wait(400);
    const afterNew = await probe();
    check('历史播种之后新 seq 照常渲染', afterNew.permValues.filter((s) => s.includes('perm-K')).length, 1);

    // 渲染层不应有报错
    const realErrors = consoleErrors.filter((e) => !/favicon|ERR_FILE_NOT_FOUND.*\.ico/i.test(e));
    if (realErrors.length) failures.push(`渲染层控制台报错 ${realErrors.length} 条:\n    ${realErrors.slice(0, 6).join('\n    ')}`);
  } catch (err) {
    failures.push(`测试自身失败: ${err.message}`);
  } finally {
    clearTimeout(watchdog);
  }

  try { const r = path.join(require('os').tmpdir(), 'chat-dup-frame-e2e.json'); fs.writeFileSync(r, JSON.stringify({ failures, steps }, null, 2)); } catch { /* 忽略 */ }
  for (const s of steps) console.log(`  (${s.step}: ${JSON.stringify(s.detail)})`);
  if (failures.length) {
    console.error(`FAIL (${failures.length} 项)`);
    for (const f of failures) console.error(`  - ${f}`);
    app.exit(1);
  } else {
    console.log('PASS: 重复帧渲染（整段两遍 / 交错 / chunk 不翻倍 / 新 seq 照常 / 乱序不丢 / 历史与直播边界）');
    app.exit(0);
  }
})();
