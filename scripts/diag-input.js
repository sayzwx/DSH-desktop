/* Diagnose input focus issue via CDP. */
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

  // 打开对话页
  await evalJs(`document.querySelector('.nav-btn[data-page="chat"]').click()`);
  await sleep(1500);

  const out = {};
  out.inputRect = await evalJs(`(() => { const r = document.getElementById('chatInput').getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; })()`);
  out.elementAtInputCenter = await evalJs(`(() => { const r = document.getElementById('chatInput').getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2); return el ? (el.id || el.className || el.tagName) : 'null'; })()`);
  // 点击输入框
  await evalJs(`(() => { const i = document.getElementById('chatInput'); i.focus(); i.click(); return true; })()`);
  await sleep(400);
  out.activeAfterClick = await evalJs(`document.activeElement?.id || document.activeElement?.tagName`);
  out.inputDisabled = await evalJs(`document.getElementById('chatInput').disabled`);
  out.inputReadonly = await evalJs(`document.getElementById('chatInput').readOnly`);
  out.shellDisplay = await evalJs(`getComputedStyle(document.getElementById('chatShell')).display`);
  out.pageChatDisplay = await evalJs(`getComputedStyle(document.getElementById('page-chat')).display`);
  // 模型面板展开后是否盖住输入框
  await evalJs(`document.getElementById('ctModelBtn').click()`);
  await sleep(400);
  out.panelOpen = await evalJs(`!document.getElementById('ctModelPanel').hidden`);
  out.elementAtInputCenter2 = await evalJs(`(() => { const r = document.getElementById('chatInput').getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2); return el ? (el.id || el.className || el.tagName) : 'null'; })()`);
  out.panelRect = await evalJs(`(() => { const r = document.getElementById('ctModelPanel').getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; })()`);
  out.inputRect2 = await evalJs(`(() => { const r = document.getElementById('chatInput').getBoundingClientRect(); return {y:Math.round(r.y)}; })()`);
  // 面板与输入框是否重叠
  out.panelBottomVsInputTop = await evalJs(`(() => { const p = document.getElementById('ctModelPanel').getBoundingClientRect(); const i = document.getElementById('chatInput').getBoundingClientRect(); return { panelBottom: Math.round(p.bottom), inputTop: Math.round(i.top), overlap: p.bottom > i.top }; })()`);
  // 收起面板，检查工具栏/草稿条
  await evalJs(`document.getElementById('ctModelPanel').hidden = true`);
  out.draftsHidden = await evalJs(`document.getElementById('chatDrafts').hidden`);
  out.barHidden = await evalJs(`document.getElementById('chatCollapsedBar').hidden`);
  console.log(JSON.stringify(out, null, 1));
  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error('VERIFY FAILED:', e.message); process.exit(1); });
