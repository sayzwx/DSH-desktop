/* Verify the desktop UI renderer over CDP: DOM state + preload API round-trips. */
const http = require('node:http');
const WebSocket = require('D:/DS_harness/node_modules/ws');

const PORT = 9333;

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
  const targets = await getJson(`http://127.0.0.1:${PORT}/json`);
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  let id = 0;
  const pending = new Map();
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
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
    if (r.result?.exceptionDetails) return { err: r.result.exceptionDetails.text };
    return r.result?.result?.value;
  }

  await new Promise((r) => setTimeout(r, 4000)); // wait for app boot

  const checks = {};
  checks.starfieldApi = await evalJs('typeof window.__starfield');
  checks.videoSrc = await evalJs('document.getElementById("bgvideo")?.getAttribute("src")');
  checks.presetCards = await evalJs('document.querySelectorAll("#presetList .preset-card").length');
  checks.providerCells = await evalJs('document.querySelectorAll("#providerGrid .provider-cell").length');
  checks.modelGroups = await evalJs('document.querySelectorAll("#modelGroupList .model-group").length');
  checks.chatSessions = await evalJs('document.querySelectorAll("#chatSessions .chat-session").length');
  checks.toolbar = await evalJs('!!document.getElementById("ctModelBtn") && !!document.getElementById("ctEffortSeg") && !!document.getElementById("ctStatusText")');
  checks.modelBtnText = await evalJs('document.getElementById("ctModelName")?.textContent');
  checks.effortButtons = await evalJs('document.querySelectorAll("#ctEffortSeg .ct-eff").length');
  checks.effortLabels = await evalJs('[...document.querySelectorAll("#ctEffortSeg .ct-eff")].map(b=>b.textContent).join(",")');
  checks.statusText = await evalJs('document.getElementById("ctStatusText")?.textContent');
  checks.apiPresets = await evalJs('window.api.getPresets().then(r=>JSON.stringify({ok:r.ok,n:(r.presets||[]).length}))');
  checks.apiProviders = await evalJs('window.api.getLlmProviders().then(r=>JSON.stringify({ok:r.ok,n:(r.providers||[]).length}))');
  checks.apiModels = await evalJs('window.api.chatModels(document.querySelector("#chatSessions .chat-session")?.dataset?.id).then(r=>JSON.stringify({ok:r.ok,cur:r.value?.current}))');
  checks.selectModel = await evalJs(`(async () => {
    const sid = document.querySelector('#chatSessions .chat-session')?.dataset?.id;
    if (!sid) return 'no session';
    const r = await window.api.chatSelectModel(sid, 'opencode-go', 'deepseek-v4-flash', 'high');
    return JSON.stringify({ok:r.ok, selected:r.value?.selected});
  })()`);

  console.log(JSON.stringify(checks, null, 1));
  ws.close();
  process.exit(0);
}

main().catch((e) => { console.error('VERIFY FAILED:', e.message); process.exit(1); });
