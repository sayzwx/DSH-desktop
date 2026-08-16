/* Verify plugin notes are all Chinese. */
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
  await sleep(800);
  await evalJs(`(() => { const h = [...document.querySelectorAll('.settings-module-head')].find(h => h.textContent.includes('插件')); h.click(); })()`);
  await sleep(2000);
  // 展开全部插件（点显示更多几次）
  for (let i = 0; i < 5; i++) {
    await evalJs(`(() => { const b = document.getElementById('pluginCatalogMore'); if (!b.hidden) b.click(); return true; })()`);
    await sleep(300);
  }
  out.cards = await evalJs(`document.querySelectorAll('#pluginCatalogList .pkg-card').length`);
  out.samples = await evalJs(`[...document.querySelectorAll('#pluginCatalogList .pkg-card')].slice(0, 8).map(c => c.querySelector('.pkg-name').textContent + ' → ' + c.querySelector('.pkg-desc').textContent).join(' | ')`);
  // 检查是否有英文残留（不含中文且含 ascii 单词的 desc）
  out.englishResidue = await evalJs(`[...document.querySelectorAll('#pluginCatalogList .pkg-desc')].filter(d => !/[\\u4e00-\\u9fa5]/.test(d.textContent) && /[a-zA-Z]{4,}/.test(d.textContent)).map(d => d.textContent.slice(0, 40)).join(' ;; ') || '（无英文残留）'`);
  console.log(JSON.stringify(out, null, 1));
  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error('VERIFY FAILED:', e.message); process.exit(1); });
