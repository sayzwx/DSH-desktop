/* Verify workspaces, blank-session reuse, delete, collapse. */
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
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 128 * 1024 * 1024 });
  let id = 0;
  const pending = new Map();
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
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
    if (r.result?.exceptionDetails) return { err: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
    return r.result?.result?.value;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(5000);

  const out = {};
  // 工作区 pills
  out.wsPills = await evalJs('[...document.querySelectorAll("#csWorkspaces .cs-ws")].map(b=>b.textContent).join(",")');
  out.wsActive = await evalJs('document.querySelector("#csWorkspaces .cs-ws.active")?.textContent');
  // 全部视图会话数（测试会话已归档，应不可见）
  out.allCount = await evalJs('document.querySelectorAll("#chatSessions .chat-session").length');
  // 切到工作区
  await evalJs(`(() => { const b = document.querySelector('#csWorkspaces .cs-ws[data-ws]'); if (b) b.click(); })()`);
  await sleep(800);
  out.wsCount = await evalJs('document.querySelectorAll("#chatSessions .chat-session").length');
  out.wsTitles = await evalJs('[...document.querySelectorAll("#chatSessions .cs-title")].map(t=>t.textContent.slice(0,20)).join("|")');
  // 回全部
  await evalJs(`(() => { const b = document.querySelector('#csWorkspaces .cs-ws[data-ws=""]'); if (b) b.click(); })()`);
  await sleep(500);

  // 空会话复用：点两次新会话
  await evalJs(`document.getElementById('chatNewSession').click()`);
  await sleep(2000);
  out.sid1 = await evalJs(`document.querySelector('#chatSessions .chat-session.active')?.dataset.id || ''`);
  out.sid1Blank = await evalJs(`!!document.querySelector('#chatSessions .chat-session.active .cs-blank')`);
  const count1 = await evalJs('document.querySelectorAll("#chatSessions .chat-session").length');
  await evalJs(`document.getElementById('chatNewSession').click()`);
  await sleep(1500);
  out.sid2 = await evalJs(`document.querySelector('#chatSessions .chat-session.active')?.dataset.id || ''`);
  out.sid2Blank = await evalJs(`!!document.querySelector('#chatSessions .chat-session.active .cs-blank')`);
  const count2 = await evalJs('document.querySelectorAll("#chatSessions .chat-session").length');
  out.reuseSame = out.sid1 === out.sid2;
  out.noDuplicate = count1 === count2;
  out.counts = `${count1} -> ${count2}`;

  // 删除当前空白会话（允许 confirm）
  await evalJs(`window.confirm = () => true`);
  await evalJs(`(() => { const el = document.querySelector('#chatSessions .chat-session[data-id="${out.sid2}"] .cs-del'); if (el) el.click(); })()`);
  await sleep(2000);
  out.deletedGone = await evalJs(`!document.querySelector('#chatSessions .chat-session[data-id="${out.sid2}"]')`);
  out.countAfterDel = await evalJs('document.querySelectorAll("#chatSessions .chat-session").length');
  out.deletedMsg = await evalJs('(document.querySelector("#chatMessages .chat-empty")?.textContent || "").slice(0, 20)');

  // 折叠
  await evalJs(`document.getElementById('chatCollapseSessions').click()`);
  await sleep(500);
  out.collapsed = await evalJs(`document.getElementById('chatShell').classList.contains('sessions-collapsed')`);
  out.barVisible = await evalJs(`!document.getElementById('chatCollapsedBar').hidden`);
  await evalJs(`document.getElementById('chatCollapsedBar').click()`);
  await sleep(500);
  out.expanded = await evalJs(`!document.getElementById('chatShell').classList.contains('sessions-collapsed')`);

  console.log(JSON.stringify(out, null, 1));
  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error('VERIFY FAILED:', e.message); process.exit(1); });
