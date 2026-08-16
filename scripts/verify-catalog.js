/* Verify: default preset select, plugin catalog, default model select. */
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
  await evalJs(`document.querySelector('.nav-btn[data-page="settings"]').click()`);
  await sleep(1000);
  await evalJs(`(() => { const h = [...document.querySelectorAll('.settings-module-head')].find(h => h.textContent.includes('插件')); h.click(); })()`);
  await sleep(2500);

  out.presetOptions = await evalJs(`[...document.querySelectorAll('#defaultPresetSelect option')].map(o => o.textContent).join(',')`);
  out.presetCurrent = await evalJs(`document.getElementById('defaultPresetSelect').value`);
  out.catalogCount = await evalJs(`document.getElementById('pluginCatalogCount').textContent`);
  out.catalogCards = await evalJs(`document.querySelectorAll('#pluginCatalogList .pkg-card').length`);
  out.catalogFirst = await evalJs(`document.querySelector('#pluginCatalogList .pkg-name')?.textContent`);
  out.catalogDesc = await evalJs(`document.querySelector('#pluginCatalogList .pkg-desc')?.textContent.slice(0, 50)`);
  out.moreVisible = await evalJs(`!document.getElementById('pluginCatalogMore').hidden`);
  // 搜索
  await evalJs(`(() => { const i = document.getElementById('pluginSearch'); i.value = 'apiproxy'; i.dispatchEvent(new Event('input')); })()`);
  await sleep(400);
  out.searchResults = await evalJs(`[...document.querySelectorAll('#pluginCatalogList .pkg-name')].map(e => e.textContent).join(',')`);
  await evalJs(`(() => { const i = document.getElementById('pluginSearch'); i.value = ''; i.dispatchEvent(new Event('input')); })()`);

  // 默认模型选择框（模型模块）
  await evalJs(`(() => { const h = [...document.querySelectorAll('.settings-module-head')].find(h => h.textContent.includes('模型')); h.click(); })()`);
  await sleep(800);
  out.modelOptions = await evalJs(`[...document.querySelectorAll('#defaultModelSelect option')].map(o => o.textContent).slice(0, 4).join(',')`);
  out.modelOptCount = await evalJs(`document.querySelectorAll('#defaultModelSelect option').length`);

  // 保存默认预设（不真改值：先读回当前值，避免影响配置）— 只验证读取链路
  out.presetDefaultApi = await evalJs(`window.api.getPresetDefault().then(r => JSON.stringify(r))`);
  console.log(JSON.stringify(out, null, 1));
  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error('VERIFY FAILED:', e.message); process.exit(1); });
