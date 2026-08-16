/* Verify modal overlay hidden and page interactive. */
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

  const out = {};
  out.overlayHidden = await evalJs(`document.getElementById('modalOverlay').hidden`);
  out.overlayDisplay = await evalJs(`getComputedStyle(document.getElementById('modalOverlay')).display`);
  out.inputVisible = await evalJs(`(() => { const r = document.getElementById('chatInput').getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`);
  out.elementAtInput = await evalJs(`(() => { const r = document.getElementById('chatInput').getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2); return el ? (el.id || el.className || el.tagName) : 'null'; })()`);
  // 完整交互冒烟：点输入框能聚焦
  await evalJs(`(() => { const i = document.getElementById('chatInput'); i.focus(); return true; })()`);
  await sleep(300);
  out.activeElement = await evalJs(`document.activeElement?.id || document.activeElement?.tagName`);
  console.log(JSON.stringify(out, null, 1));
  ws.close();
  process.exit(0);
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
main().catch((e) => { console.error('VERIFY FAILED:', e.message); process.exit(1); });
