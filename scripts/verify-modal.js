/* Verify themed modal + input focus protection. */
const http = require('node:http');
const WebSocket = require('D:/DS_harness/node_modules/ws');

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function main() {
  const targets = await getJson('http://127.0.0.1:9333/json');
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  let id = 0;
  const pending = new Map();
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  await new Promise((res) => ws.on('open', res));
  function send(method, params = {}) {
    return new Promise((resolve) => {
      const mid = ++id;
      pending.set(mid, resolve);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  }
  async function evalJs(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) return { err: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
    return r.result?.result?.value;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(5000);

  await evalJs(`document.querySelector('.nav-btn[data-page="chat"]').click()`);
  await sleep(1200);

  const out = {};

  // 1) 输入框焦点保护：聚焦输入框 → 点模型按钮 → 焦点应仍在输入框
  await evalJs(`(() => { const i = document.getElementById('chatInput'); i.focus(); return true; })()`);
  await sleep(300);
  await evalJs(`document.getElementById('ctModelBtn').click()`);
  await sleep(400);
  out.focusAfterModelClick = await evalJs(`document.activeElement?.id || document.activeElement?.tagName`);
  out.modelPanelOpen = await evalJs(`!document.getElementById('ctModelPanel').hidden`);
  await evalJs(`document.getElementById('ctModelPanel').hidden = true`);

  // 2) 创建空白会话用于删除测试
  await evalJs(`document.getElementById('chatNewSession').click()`);
  await sleep(2000);
  out.testSid = await evalJs(`document.querySelector('#chatSessions .chat-session.active')?.dataset.id || ''`);

  // 3) 点击删除 → 主题化模态框出现 → 取消 → 会话保留
  await evalJs(`(() => { const el = document.querySelector('#chatSessions .chat-session[data-id="${out.testSid}"] .cs-del'); if (el) el.click(); })()`);
  await sleep(600);
  out.modalVisible = await evalJs(`!document.getElementById('modalOverlay').hidden`);
  out.modalTitle = await evalJs(`document.getElementById('modalTitle').textContent`);
  out.modalBody = await evalJs(`document.getElementById('modalBody').textContent.slice(0, 40)`);
  out.modalOkText = await evalJs(`document.getElementById('modalOk').textContent`);
  out.modalDanger = await evalJs(`document.getElementById('modalOk').className.includes('danger')`);
  await evalJs(`document.getElementById('modalCancel').click()`);
  await sleep(600);
  out.cancelKeepsSession = await evalJs(`!!document.querySelector('#chatSessions .chat-session[data-id="${out.testSid}"]')`);
  out.modalClosedAfterCancel = await evalJs(`document.getElementById('modalOverlay').hidden`);

  // 4) 再次删除 → 确认 → 会话移除
  await evalJs(`(() => { const el = document.querySelector('#chatSessions .chat-session[data-id="${out.testSid}"] .cs-del'); if (el) el.click(); })()`);
  await sleep(500);
  await evalJs(`document.getElementById('modalOk').click()`);
  await sleep(1500);
  out.confirmRemovesSession = await evalJs(`!document.querySelector('#chatSessions .chat-session[data-id="${out.testSid}"]')`);

  // 5) 输入框仍可聚焦
  await evalJs(`(() => { const i = document.getElementById('chatInput'); i.focus(); i.value = '可输入'; return true; })()`);
  await sleep(300);
  out.inputTypable = await evalJs(`document.getElementById('chatInput').value === '可输入' && document.activeElement?.id === 'chatInput'`);

  console.log(JSON.stringify(out, null, 1));
  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error('VERIFY FAILED:', e.message); process.exit(1); });
