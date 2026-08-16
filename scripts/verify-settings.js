/* Verify modular settings page. */
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
  await sleep(5000);

  await evalJs(`document.querySelector('.nav-btn[data-page="settings"]').click()`);
  await sleep(1500);

  const out = {};
  out.moduleCount = await evalJs(`document.querySelectorAll('.settings-module').length`);
  out.openCount = await evalJs(`document.querySelectorAll('.settings-module.open').length`);
  out.openName = await evalJs(`document.querySelector('.settings-module.open .sm-title')?.textContent`);
  // 展开插件模块
  await evalJs(`(() => { const h = [...document.querySelectorAll('.settings-module-head')].find(h => h.textContent.includes('插件')); h.click(); })()`);
  await sleep(600);
  out.afterPluginsClick = await evalJs(`document.querySelector('.settings-module.open .sm-title')?.textContent`);
  out.presetCards = await evalJs(`document.querySelectorAll('#presetList .preset-card').length`);
  // 展开模型模块
  await evalJs(`(() => { const h = [...document.querySelectorAll('.settings-module-head')].find(h => h.textContent.includes('模型')); h.click(); })()`);
  await sleep(800);
  out.providerOptions = await evalJs(`[...document.querySelectorAll('#providerSelect option')].map(o => o.textContent).join(',')`);
  out.providerStats = await evalJs(`document.getElementById('providerStats')?.textContent.replace(/\\s+/g,' ').trim()`);
  out.modelGroupsShown = await evalJs(`document.querySelectorAll('#modelGroupList .model-group').length`);
  // 选择具体提供商过滤
  await evalJs(`(() => { const s = document.getElementById('providerSelect'); s.value = 'deepseek-official'; s.dispatchEvent(new Event('change')); })()`);
  await sleep(400);
  out.filteredGroups = await evalJs(`[...document.querySelectorAll('#modelGroupList .mg-id')].map(e => e.textContent).join(',')`);
  // 主题选择框
  out.themeSelectOptions = await evalJs(`[...document.querySelectorAll('#themeSelect option')].map(o => o.textContent).join(',')`);
  out.customRowHidden = await evalJs(`document.getElementById('customColorRow').hidden`);
  await evalJs(`(() => { const s = document.getElementById('themeSelect'); s.value = 'custom'; s.dispatchEvent(new Event('change')); })()`);
  await sleep(300);
  out.customRowShown = await evalJs(`!document.getElementById('customColorRow').hidden`);
  out.themeAttr = await evalJs(`document.documentElement.dataset.theme`);
  // 恢复深空
  await evalJs(`(() => { const s = document.getElementById('themeSelect'); s.value = 'dark'; s.dispatchEvent(new Event('change')); })()`);
  console.log(JSON.stringify(out, null, 1));
  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error('VERIFY FAILED:', e.message); process.exit(1); });
