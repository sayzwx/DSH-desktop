/* Verify chat scrolls to bottom when page becomes visible. */
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
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise((r) => ws.on('open', r));
  const evalJs = (expr) => new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
  }).then((r) => r.result?.result?.value);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(6000);

  const out = {};
  out.startPage = await evalJs(`document.querySelector('.page.active')?.id`);
  out.chatPageVisible = await evalJs(`getComputedStyle(document.getElementById('page-chat')).display !== 'none'`);
  // 打开对话页（自动打开的会话应已渲染）
  await evalJs(`document.querySelector('.nav-btn[data-page="chat"]').click()`);
  await sleep(2500);
  out.scrollInfo = await evalJs(`(() => { const m = document.getElementById('chatMessages'); return { top: m.scrollTop, scrollHeight: m.scrollHeight, clientHeight: m.clientHeight }; })()`);
  out.atBottom = await evalJs(`(() => { const m = document.getElementById('chatMessages'); return m.scrollHeight - m.scrollTop - m.clientHeight < 40; })()`);
  console.log(JSON.stringify(out, null, 1));
  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error('VERIFY FAILED:', e.message); process.exit(1); });
