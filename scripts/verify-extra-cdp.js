/* CDP: reload page then verify window indicator + settings + filter */
const http = require('node:http');
function getJson(url) { return new Promise((res, rej) => http.get(url, (r) => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}}); }).on('error',rej)); }
async function main() {
  const list = await getJson('http://127.0.0.1:9333/json');
  const page = list.find((p) => p.type === 'page');
  const WS = require('ws');
  const ws = new WS(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params={}) => new Promise((r) => { const i=++id; pending.set(i,r); ws.send(JSON.stringify({id:i,method,params})); });
  await new Promise((r) => ws.on('open', r));
  const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result.result ? r.result.result.value : { err: r.result.exceptionDetails?.text }; };

  await send('Page.enable');
  await send('Page.reload', { ignoreCache: true });
  await new Promise((r) => setTimeout(r, 4000));

  const out = {};
  out.windowIndicator = await evalJs(`(() => {
    const ind = document.querySelector('#winIndicator');
    const txt = document.querySelector('#winIndicatorText');
    return { exists: !!ind, hidden: ind ? ind.hidden : null, text: txt ? txt.textContent : null };
  })()`);
  out.settingsModules = await evalJs(`(async () => {
    document.querySelector('.nav-btn[data-page="settings"]')?.click();
    await new Promise(r => setTimeout(r, 300));
    const bg = document.querySelector('[data-module="background"]');
    const btns = bg ? [...bg.querySelectorAll('button')].map(b => b.id) : [];
    const upd = document.querySelector('#downloadUpdateBtn');
    return { bgModule: !!bg, btns, updateBtnLabel: upd ? upd.textContent : null };
  })()`);
  out.filterPer = await evalJs(`(async () => {
    document.querySelector('.nav-btn[data-page="chat"]')?.click();
    await new Promise(r => setTimeout(r, 300));
    const input = document.querySelector('#chatInput');
    if (!input) return { error: 'no input' };
    input.focus();
    input.value = '';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }));
    input.value = '/per';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 2000));
    const panel = document.querySelector('.cmd-panel');
    const names = panel ? [...panel.querySelectorAll('.cmd-item')].map(i => i.dataset.name) : [];
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return { matched: names, open: !!panel };
  })()`);
  console.log(JSON.stringify(out, null, 2));
  ws.close();
}
main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });