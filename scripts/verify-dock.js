/* Verify: running-state restore, dock buttons, GitHub connect UI, MCP, skills. */
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
  await sleep(7000);

  const out = {};
  // 1) 运行状态恢复：找一个 running 的会话（当前会话在运行），检查状态栏
  out.statusText = await evalJs(`document.getElementById('ctStatusText')?.textContent`);
  out.statusDot = await evalJs(`document.getElementById('ctStatusDot')?.className`);
  out.runningDots = await evalJs(`document.querySelectorAll('#chatSessions .cs-dot').length`);
  out.typing = await evalJs(`!!document.querySelector('#chatMessages .typing')`);

  // 2) dock 按钮存在
  out.dockButtons = await evalJs(`[...document.querySelectorAll('.dock-btn')].map(b => b.dataset.dock).join(',')`);
  // GitHub 面板
  await evalJs(`document.querySelector('.dock-btn[data-dock="github"]').click()`);
  await sleep(1500);
  out.dockVisible = await evalJs(`!document.getElementById('dock').hidden`);
  out.dockTitle = await evalJs(`document.getElementById('dockTitle').textContent`);
  out.ghConnectUI = await evalJs(`!!document.getElementById('ghKeySelect') && !!document.getElementById('ghConnectBtn')`);
  out.ghHint = await evalJs(`document.getElementById('dockBody')?.textContent.slice(0, 120)`);
  // MCP 面板
  await evalJs(`document.querySelector('.dock-btn[data-dock="mcp"]').click()`);
  await sleep(800);
  out.mcpText = await evalJs(`document.getElementById('dockBody')?.textContent.slice(0, 140)`);
  // 技能面板
  await evalJs(`document.querySelector('.dock-btn[data-dock="skill"]').click()`);
  await sleep(1500);
  out.skillText = await evalJs(`document.getElementById('dockBody')?.textContent.slice(0, 160)`);
  out.skillCards = await evalJs(`document.querySelectorAll('.dock-skill').length`);
  // 关闭 dock
  await evalJs(`document.getElementById('dockClose').click()`);
  out.dockClosed = await evalJs(`document.getElementById('dock').hidden`);

  // 3) GitHub API 链路（未连接状态）
  out.ghStatusApi = await evalJs(`window.api.ghStatus().then(r => JSON.stringify({ok:r.ok, connected:r.connected}))`);
  out.mcpApi = await evalJs(`window.api.mcpList().then(r => JSON.stringify({ok:r.ok, servers:r.servers?.length || 0}))`);
  out.skillsApi = await evalJs(`window.api.skillsList(null).then(r => JSON.stringify({ok:r.ok, n:r.skills?.length || 0}))`);

  console.log(JSON.stringify(out, null, 1));
  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error('VERIFY FAILED:', e.message); process.exit(1); });
