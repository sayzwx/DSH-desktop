/* Verify: default page=chat, workspace select, dashboard charts, plugin ns list. */
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
  // 1) 默认定位对话页
  out.defaultPage = await evalJs(`document.querySelector('.page.active')?.id`);
  out.chatScrolled = await evalJs(`(() => { const m = document.getElementById('chatMessages'); return m.scrollHeight - m.scrollTop - m.clientHeight < 40; })()`);
  // 2) 工作区选择框
  out.wsOptions = await evalJs(`[...document.querySelectorAll('#ctWorkspace option')].map(o => o.textContent).join(',')`);
  // 3) 仪表盘
  await evalJs(`document.querySelector('.nav-btn[data-page="dashboard"]').click()`);
  await sleep(2500);
  out.usageStats = await evalJs(`[...document.querySelectorAll('#usageGrid .u-stat')].map(s => s.textContent.replace(/\\s+/g, ' ').trim()).join(' | ')`);
  out.chartCanvases = await evalJs(`[...document.querySelectorAll('#usageCharts canvas')].map(c => c.id).join(',')`);
  out.tableRows = await evalJs(`document.querySelectorAll('#usageTableBody tr').length`);
  out.recentSignalGone = await evalJs(`!document.getElementById('logPreview')`);
  // 4) 设置页插件配置域
  await evalJs(`document.querySelector('.nav-btn[data-page="settings"]').click()`);
  await sleep(1200);
  await evalJs(`(() => { const h = [...document.querySelectorAll('.settings-module-head')].find(h => h.textContent.includes('插件')); h.click(); })()`);
  await sleep(1200);
  out.nsCount = await evalJs(`document.querySelectorAll('#pluginNsList .ns-card').length`);
  out.nsNames = await evalJs(`[...document.querySelectorAll('#pluginNsList .ns-name')].map(e => e.textContent).join(',')`);
  out.nsNotes = await evalJs(`[...document.querySelectorAll('#pluginNsList .ns-note')].slice(0, 3).map(e => e.textContent.slice(0, 30)).join(' | ')`);
  console.log(JSON.stringify(out, null, 1));
  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error('VERIFY FAILED:', e.message); process.exit(1); });
