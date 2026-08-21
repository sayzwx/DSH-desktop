/* CDP driver v2: verify slash-command panel in the packaged app (correct event order). */
const http = require('node:http');

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function main() {
  const list = await getJson('http://127.0.0.1:9333/json');
  const page = list.find((p) => p.type === 'page');
  const WS = require('ws');
  const ws = new WS(page.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await new Promise((r) => ws.on('open', r));
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { error: r.result.exceptionDetails.text };
    return r.result.result ? r.result.result.value : undefined;
  };

  const out = {};
  // 确保在对话页且有会话
  out.prep = await evalJs(`(async () => {
    document.querySelector('.nav-btn[data-page="chat"]')?.click();
    await new Promise(r => setTimeout(r, 300));
    const newBtn = document.querySelector('#chatNewSession');
    if (newBtn) newBtn.click();
    await new Promise(r => setTimeout(r, 2500));
    const input = document.querySelector('#chatInput');
    input.focus();
    return { sessionActive: !!input && document.querySelector('#chatShell')?.style.display !== 'none' };
  })()`);

  // 正确的触发顺序：输入框为空 → keydown '/'（触发 open）→ 输入事件
  out.open = await evalJs(`(async () => {
    const input = document.querySelector('#chatInput');
    input.value = '';
    // 清空草稿状态后触发 keydown
    const ev = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
    const dispatched = input.dispatchEvent(ev);
    // 模拟浏览器默认行为：插入 '/'
    input.value = '/';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 2000));
    const panel = document.querySelector('.cmd-panel');
    const list = panel ? panel.querySelector('.cmd-list') : null;
    return {
      keydownDefaultPrevented: dispatched === false,
      valueInInput: input.value,
      panelExists: !!panel,
      panelDisplay: panel ? getComputedStyle(panel).display : null,
      itemCount: panel ? panel.querySelectorAll('.cmd-item').length : 0,
      itemNames: panel ? [...panel.querySelectorAll('.cmd-item')].slice(0, 8).map(i => i.dataset.name) : [],
      panelRect: panel ? (() => { const r = panel.getBoundingClientRect(); const i = input.getBoundingClientRect(); return { panelTop: r.top, panelBottom: r.bottom, inputTop: i.top, opensUpward: r.bottom <= i.top + 2 }; })() : null,
      listScrollable: list ? (list.scrollHeight > list.clientHeight) : null,
      listOverflow: list ? getComputedStyle(list).overflowY : null,
    };
  })()`);

  // 点击第一项 → 应关闭面板并执行命令
  out.click = await evalJs(`(async () => {
    const panel = document.querySelector('.cmd-panel');
    if (!panel) return { error: 'panel missing' };
    const first = panel.querySelector('.cmd-item');
    if (!first) return { error: 'no items', html: panel.innerHTML.slice(0, 300) };
    const name = first.dataset.name;
    first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    first.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 800));
    const panelAfter = document.querySelector('.cmd-panel');
    return {
      clickedItem: name,
      closedAfterClick: !panelAfter || panelAfter.style.display === 'none' || getComputedStyle(panelAfter).display === 'none',
    };
  })()`);

  // 选中高亮 + 键盘导航（ArrowDown/Enter）
  out.keyboard = await evalJs(`(async () => {
    const input = document.querySelector('#chatInput');
    // 重新打开
    input.value = '';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }));
    input.value = '/';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 1500));
    const panel = document.querySelector('.cmd-panel');
    const total = panel ? panel.querySelectorAll('.cmd-item').length : 0;
    const selectedFirst = panel ? !!panel.querySelector('.cmd-item.selected') : false;
    // ArrowDown
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 200));
    const selectedIdx = panel ? [...panel.querySelectorAll('.cmd-item')].findIndex(i => i.classList.contains('selected')) : -1;
    return { total, selectedFirst, selectedAfterDown: selectedIdx, open: !!panel };
  })()`);

  // 过滤：输入 /comp → 列表被过滤
  out.filter = await evalJs(`(async () => {
    const input = document.querySelector('#chatInput');
    input.value = '/comp';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 600));
    const panel = document.querySelector('.cmd-panel');
    const names = panel ? [...panel.querySelectorAll('.cmd-item')].map(i => i.dataset.name) : [];
    return { filteredCount: names.length, names: names.slice(0, 5), open: !!panel };
  })()`);

  // 删除 "/" → 面板关闭
  out.delete = await evalJs(`(async () => {
    const input = document.querySelector('#chatInput');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 500));
    const panel = document.querySelector('.cmd-panel');
    return { closedAfterDelete: !panel || panel.style.display === 'none' || getComputedStyle(panel).display === 'none' };
  })()`);

  console.log(JSON.stringify(out, null, 2));
  ws.close();
}

main().catch((e) => { console.error('DRIVER FAILED:', e.message); process.exit(1); });