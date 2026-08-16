/* End-to-end chat verification: history rendering + live streaming via CDP. */
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
  // 1) 主会话（列表第一个）历史渲染
  out.sessions = await evalJs('document.querySelectorAll("#chatSessions .chat-session").length');
  out.msgCountFirst = await evalJs('document.querySelectorAll("#chatMessages .msg").length');
  out.msgTextFirst = await evalJs('document.querySelector("#chatMessages .msg")?.textContent?.slice(0,60)');
  out.emptyState = await evalJs('!!document.querySelector("#chatMessages .chat-empty")');

  // 2) 切换到测试会话，检查历史渲染
  await evalJs(`(() => { const el = document.querySelector('#chatSessions .chat-session[data-id="${TEST_SID}"]'); if (el) el.click(); return !!el; })()`);
  await sleep(2500);
  out.testSidFound = await evalJs(`!!document.querySelector('#chatSessions .chat-session[data-id="${TEST_SID}"]')`);
  out.testMsgCount = await evalJs('document.querySelectorAll("#chatMessages .msg").length');
  out.testMsgText = await evalJs('[...document.querySelectorAll("#chatMessages .msg")].map(m=>m.textContent.slice(0,30)).join(" | ")');
  out.status = await evalJs('document.getElementById("ctStatusText")?.textContent');

  // 3) 向测试会话发一条消息，验证 live 流
  await evalJs(`(() => { const i = document.getElementById('chatInput'); i.value = '测试并发消息：请回复「已看到」三个字'; document.getElementById('chatSend').click(); return true; })()`);
  await sleep(12000);
  out.afterSendMsgs = await evalJs('document.querySelectorAll("#chatMessages .msg").length');
  out.afterSendText = await evalJs('[..."#chatMessages .msg".split(",")].length, [...document.querySelectorAll("#chatMessages .msg")].slice(-2).map(m=>m.textContent.slice(0,40)).join(" || ")');
  out.statusAfter = await evalJs('document.getElementById("ctStatusText")?.textContent');
  out.typing = await evalJs('!!document.querySelector("#chatMessages .typing")');

  console.log(JSON.stringify(out, null, 1));
  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error('VERIFY FAILED:', e.message); process.exit(1); });
