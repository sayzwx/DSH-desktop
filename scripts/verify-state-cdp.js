/* CDP: list targets, navigate back to file URL, verify key UI features */
const http = require('node:http');
function getJson(url) { return new Promise((res, rej) => http.get(url, (r) => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}}); }).on('error',rej)); }
async function main() {
  let list = await getJson('http://127.0.0.1:9333/json');
  console.log('ALL TARGETS:', JSON.stringify(list.map(p => ({ type: p.type, title: p.title, url: p.url.slice(0, 90) })), null, 1));
  const page = list.find((p) => p.type === 'page');
  const WS = require('ws');
  const ws = new WS(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params={}) => new Promise((r) => { const i=++id; pending.set(i,r); ws.send(JSON.stringify({id:i,method,params})); });
  await new Promise((r) => ws.on('open', r));
  const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result.result ? r.result.result.value : { exc: r.result.exceptionDetails?.text }; };

  // 强制回到应用主页面
  const repoRoot = require('node:path').resolve(__dirname, '..');
  const pageUrl = `file:///${repoRoot.replace(/\\/g, '/')}/app/resources/app/renderer/index.html`;
  await send('Page.enable');
  await send('Page.navigate', { url: pageUrl });
  await new Promise((r) => setTimeout(r, 6000));

  const out = {};
  out.url = await evalJs('location.href');
  out.title = await evalJs('document.title');
  out.hasWinIndicator = await evalJs(`!!document.querySelector('#winIndicator')`);
  out.winText = await evalJs(`document.querySelector('#winIndicatorText')?.textContent || null`);
  out.winHidden = await evalJs(`document.querySelector('#winIndicator')?.hidden ?? null`);
  out.hasBgModule = await evalJs(`!!document.querySelector('[data-module="background"]')`);
  out.buttons = await evalJs(`[...document.querySelectorAll('[data-module="background"] button')].map(b => b.id)`);
  out.updateLabel = await evalJs(`document.querySelector('#downloadUpdateBtn')?.textContent || null`);
  out.hasStartB = await evalJs(`!!document.querySelector('#mkStartHarness')`);
  console.log(JSON.stringify(out, null, 2));
  ws.close();
}
main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });