/* Final chat verification: full message content + user bubble persistence. */
const http = require('node:http');
const WebSocket = require('D:/DS_harness/node_modules/ws');
const TEST_SID = 'session-e9103343-30f9-4722-9e04-1898d263719f';

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
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 128 * 1024 * 1024 });
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

  const out = {};
  await evalJs(`(() => { const el = document.querySelector('#chatSessions .chat-session[data-id="${TEST_SID}"]'); if (el) el.click(); })()`);
  await sleep(2000);
  out.historyMsgs = await evalJs('document.querySelectorAll("#chatMessages .msg").length');
  out.historyFull = await evalJs('[...document.querySelectorAll("#chatMessages .msg")].map(m=>m.textContent.slice(0,50)).join(" ## ")');

  // live: send and watch mid-stream (3s in) + final
  await evalJs(`(() => { const i = document.getElementById('chatInput'); i.value = '回复「收到」两个字'; document.getElementById('chatSend').click(); return true; })()`);
  await sleep(3500);
  out.midMsgs = await evalJs('document.querySelectorAll("#chatMessages .msg").length');
  out.midTail = await evalJs('[...document.querySelectorAll("#chatMessages .msg")].slice(-2).map(m=>m.textContent.slice(0,40)).join(" || ")');
  out.midTyping = await evalJs('!!document.querySelector("#chatMessages .typing")');
  out.midStatus = await evalJs('document.getElementById("ctStatusText")?.textContent');
  await sleep(9000);
  out.finalMsgs = await evalJs('document.querySelectorAll("#chatMessages .msg").length');
  out.finalTail = await evalJs('[...document.querySelectorAll("#chatMessages .msg")].slice(-2).map(m=>m.textContent.slice(0,60)).join(" || ")');
  out.finalTyping = await evalJs('!!document.querySelector("#chatMessages .typing")');
  out.finalStatus = await evalJs('document.getElementById("ctStatusText")?.textContent');
  out.draftsEl = await evalJs('!!document.getElementById("chatDrafts")');
  out.pasteHandler = await evalJs('!!document.getElementById("chatInput").onpaste');
  console.log(JSON.stringify(out, null, 1));
  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error('VERIFY FAILED:', e.message); process.exit(1); });
