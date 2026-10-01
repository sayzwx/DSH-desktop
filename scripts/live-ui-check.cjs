/**
 * 真机 UI 检查：**直接打开已安装的应用**，用 CDP 检查界面结构（不依赖截图）。
 *
 * 为什么不用截图：本机（无 GPU 的会话）里对话页 `Page.captureScreenshot` 会挂死
 * —— 视频/星云要合成帧，实测 90s 也拿不到。所以改成量 **DOM 与计算样式**：
 * 位置、尺寸、可见性这些"排版对不对"的问题，量的结果比肉眼看截图更准，也能进回归。
 *
 * 用法: node scripts/live-ui-check.cjs [--port N] [--keep]
 * 需要免沙箱（要派生子进程）。
 */
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const PORT = Number(argOf('--port', String(9500 + Math.floor(Math.random() * 200))));
const KEEP = argv.includes('--keep');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (u) => new Promise((res, rej) => http.get(u, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));

const failures = [];
let passed = 0;
const ok = (name, cond, detail) => { if (cond) { passed++; return; } failures.push(name + (detail !== undefined ? `\n    实际: ${JSON.stringify(detail)}` : '')); };

(async () => {
  const env = { ...process.env, DSH_DEV_INSTANCE: 'live-ui' };
  delete env.ELECTRON_RUN_AS_NODE;   // 带着它 Electron 退化成纯 Node，Chromium 开关全被拒
  const child = spawn('D:/DSH/app/DSH.exe', [
    `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*',   // 缺 allow-origins 会"连上但零响应"
    '--disable-gpu', '--disable-software-rasterizer', '--in-process-gpu', '--no-sandbox',   // 缺 no-sandbox 渲染进程必崩
  ], { env, stdio: 'ignore' });

  let ws = null;
  try {
    let page = null;
    for (let i = 0; i < 45 && !page; i++) {
      await sleep(800);
      try { page = (await getJson(`http://127.0.0.1:${PORT}/json/list`)).find((t) => t.type === 'page'); } catch { /* 等 */ }
    }
    if (!page) throw new Error('CDP 未就绪');
    const WebSocket = require(path.join(ROOT, 'node_modules', 'ws'));
    ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
    let id = 0;
    const pending = new Map();
    ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
    ws.on('error', (e) => failures.push('CDP socket 错误：' + ((e && e.message) || e)));
    await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
    const send = (method, params = {}, t = 30000) => new Promise((r) => {
      const i = ++id;
      const timer = setTimeout(() => { pending.delete(i); r({ __timeout: true }); }, t);
      pending.set(i, (m) => { clearTimeout(timer); r(m); });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
    const js = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.__timeout) return { __timeout: true };
      if (r.result && r.result.exceptionDetails) return { __error: String((r.result.exceptionDetails.exception || {}).description || '').slice(0, 200) };
      return r.result && r.result.result ? r.result.result.value : undefined;
    };

    // 进对话页（右侧列属于对话页；停在仪表盘时整页 display:none）
    await js(`(() => { const b = document.querySelector('.nav-btn[data-page="chat"]'); if (b) b.click(); return !!b; })()`);
    await sleep(3500);
    // 没有会话/引擎未就绪时应用会把对话外壳隐藏（display:none）→ 量出来全是 0，
    // 断言会**假通过**。这里只在"被隐藏"时强制显示，让几何数字真实可信。
    const forced = await js(`(() => {
      const shell = document.querySelector('.chat-shell');
      const page = document.getElementById('page-chat');
      const marks = [];
      // 页面没激活（应用在引擎/会话未就绪时会这样）→ 子孙全 0×0，断言会假通过
      if (page && !page.classList.contains('active')) { page.classList.add('active'); marks.push('page-activated'); }
      if (page && getComputedStyle(page).display === 'none') { page.style.display = 'flex'; marks.push('page-shown'); }
      if (shell && getComputedStyle(shell).display === 'none') { shell.style.display = 'flex'; marks.push('shell-shown'); }
      return marks.join(',') || 'already-visible';
    })()`);
    if (forced === 'forced') console.log('  （对话外壳原本隐藏：已强制显示以便量布局）');
    await sleep(600);

    // ---------- 1. 右侧列：在布局里、不遮住输入区 ----------
    const dock = await js(`(() => {
      const d = document.getElementById('qaDock');
      const btn = document.getElementById('ctQuickBtn');
      if (btn && d && d.hidden) btn.click();
      return true;
    })()`);
    void dock;
    await sleep(900);
    const layout = await js(`(() => {
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
      const dock = document.getElementById('qaDock');
      const panel = document.getElementById('qaPanel');
      const card = document.querySelector('#qaPanel .qa-card');
      const send = document.getElementById('chatSend');
      const input = document.getElementById('chatInput');
      const cs = (el) => el ? getComputedStyle(el) : null;
      const dB = r(dock), pB = r(panel), cB = r(card), sB = r(send), iB = r(input);
      const page = document.getElementById('page-chat');
      return {
        pageActive: !!(page && page.classList.contains('active')),
        pageDisplay: page ? getComputedStyle(page).display : null,
        dockInShell: !!(dock && dock.parentElement && dock.parentElement.classList.contains('chat-shell')),
        dockBox: dB, panelBox: pB, firstCardBox: cB, sendBox: sB, inputBox: iB,
        panelPosition: cs(panel) ? cs(panel).position : null,      // 必须是 static（旧 bug：fixed → 浮到右下角）
        cardInsideDock: !!(card && dock && dock.contains(card)),
        cardNearPanelTop: !!(pB && cB && Math.abs(cB.y - (pB.y + 8)) < 200),   // 不该跑到屏幕底部
        dockRightOfInput: !!(dB && iB && dB.x >= iB.x + iB.w - 2),             // 列在输入区右边（不覆盖）
        toggleInToolbar: !!(document.getElementById('chatToolbar') || { contains: () => false }).contains(document.getElementById('ctQuickBtn')),
      };
    })()`);
    console.log('布局:', JSON.stringify(layout).slice(0, 460));
    ok('右侧列在 .chat-shell 里', layout && layout.dockInShell === true, layout && layout.dockInShell);
    ok('动作列表不再是 fixed 浮层', layout && layout.panelPosition === 'static', layout && layout.panelPosition);
    ok('卡片在列内且贴着列头（不浮到右下角）', layout && layout.cardInsideDock === true && layout.cardNearPanelTop === true, layout && { inside: layout.cardInsideDock, near: layout.cardNearPanelTop, card: layout.firstCardBox, panel: layout.panelBox });
    ok('列在输入框右侧（不遮住发送按钮）', layout && layout.dockRightOfInput === true && layout.sendBox && layout.dockBox && layout.sendBox.x + layout.sendBox.w <= layout.dockBox.x + 2, layout && { send: layout.sendBox, dock: layout.dockBox });
    ok('开关按钮在工具条里', layout && layout.toggleInToolbar === true);

    // 按钮形态：必须是"侧边面板"图标而不是 ＋（＋ 会被理解成"新增"），且打开时要有按下态
    const btn = await js(`(() => {
      const b = document.getElementById('ctQuickBtn');
      if (!b) return null;
      return {
        text: (b.textContent || '').trim(),
        hasSvg: !!b.querySelector('svg'),
        svgRects: b.querySelectorAll('svg rect, svg path').length,
        pressed: b.getAttribute('aria-pressed'),
        activeClass: b.classList.contains('active'),
        title: b.title,
        box: (() => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
        color: getComputedStyle(b).color,
        svgBox: (() => { const sv = b.querySelector('svg'); if (!sv) return null; const r = sv.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
      };
    })()`);
    console.log('开关按钮:', JSON.stringify(btn));
    ok('按钮不是 ＋ 文字', btn && btn.text.includes('＋') === false, btn && btn.text);
    ok('按钮是图标（内联 SVG）', btn && btn.hasSvg === true && btn.svgRects >= 2, btn);
    ok('按钮有按下态（aria-pressed=true）', btn && btn.pressed === 'true' && btn.activeClass === true, btn);
    ok('悬停提示说清是侧边预览', btn && /侧边预览/.test(btn.title || ''), btn && btn.title);
    ok('按钮可见且有尺寸（没被工具条挤掉）', btn && btn.box[0] >= 20 && btn.box[1] >= 18, btn && btn.box);
    ok('图标本身渲染出来了', btn && btn.svgBox && btn.svgBox[0] >= 10, btn && btn.svgBox);

    // ---------- 2. 消息区排版 ----------
    // 没有消息就量不到排版（会得到 null 然后假失败）→ 先点一条会话把它渲染出来
    const picked = await js(`(async () => {
      if (document.querySelector('.msg-md')) return 'already';
      const rows = [...document.querySelectorAll('.chat-session')];
      if (!rows.length) return 'no-sessions';
      rows[0].click();
      await new Promise((r) => setTimeout(r, 3000));
      return document.querySelector('.msg-md') ? 'clicked' : 'still-empty';
    })()`);
    if (picked !== 'already') console.log('  （消息区准备:', picked, '）');
    const typo = await js(`(() => {
      const md = document.querySelector('.msg-md');
      const code = document.querySelector('.md-code pre');
      const cs = (el) => el ? getComputedStyle(el) : null;
      const msgs = [...document.querySelectorAll('.msg')];
      return {
        msgFont: md ? cs(md).fontSize : null,
        codeFont: code ? cs(code).fontSize : null,
        roleRows: document.querySelectorAll('.msg-role').length,
        assistantNoBubble: msgs.filter((m) => m.classList.contains('msg-assistant')).every((m) => {
          const c = getComputedStyle(m);
          return c.backgroundColor === 'rgba(0, 0, 0, 0)' || c.backgroundColor === 'transparent';
        }),
      };
    })()`);
    console.log('排版:', JSON.stringify(typo).slice(0, 300));
    if (!typo || !typo.msgFont) {
      console.log('  （跳过排版断言：这条会话没有已渲染的消息）');
    } else {
      ok('正文字号 ≥14px', parseFloat(typo.msgFont) >= 14, typo.msgFont);
      ok('助手消息不套气泡', typo.assistantNoBubble === true, typo.assistantNoBubble);
      ok('助手消息有角色行', typo.roleRows > 0, typo.roleRows);
      if (typo.codeFont) ok('代码块字号 ≥12px', parseFloat(typo.codeFont) >= 12, typo.codeFont);
    }

    // ---------- 3. 产物卡片 ----------
    const art = await js(`(async () => {
      window.__panels.render({ turnFiles: [
        ${JSON.stringify(path.join(ROOT, 'package.json'))},
        ${JSON.stringify(path.join(ROOT, 'renderer', 'styles.css'))},
        ${JSON.stringify(path.join(ROOT, 'README.md'))}
      ] });
      await new Promise((r) => setTimeout(r, 1200));
      const cards = [...document.querySelectorAll('.cd-file-card')];
      return {
        count: cards.length,
        names: cards.map((c) => (c.querySelector('.cd-file-name') || {}).textContent),
        metas: cards.map((c) => (c.querySelector('.cd-file-meta') || {}).textContent),
        icons: cards.map((c) => (c.querySelector('.cd-file-icon') || {}).textContent),
        hasActs: cards.every((c) => c.querySelectorAll('.cd-file-act').length === 2),
      };
    })()`);
    console.log('产物卡片:', JSON.stringify(art).slice(0, 400));
    ok('产物渲染成卡片', art && art.count === 3, art && art.count);
    ok('卡片有文件名', art && art.names && art.names.includes('styles.css'), art && art.names);
    ok('卡片补上了体积', art && art.metas && art.metas.some((m) => /KB|MB|B$/.test(String(m))), art && art.metas);
    ok('卡片有两个悬停操作', art && art.hasActs === true, art && art.hasActs);

    // ---------- 4. Git：切会话要换目录 ----------
    const gitInfo = await js(`(async () => {
      const bar = document.getElementById('gitBar');
      const before = bar ? bar.textContent.replace(/\\s+/g, ' ').trim() : '';
      // 找两条 cwd 不同的会话，切过去看状态栏是否跟着变
      const rows = [...document.querySelectorAll('.chat-session')];
      const withCwd = rows.map((r) => ({ id: r.dataset.id, cwd: r.dataset.cwd, dir: (r.querySelector('.cs-path') || {}).textContent || '' }));
      const uniq = [];
      const seen = new Set();
      for (const r of withCwd) { if (r.cwd && !seen.has(r.cwd)) { seen.add(r.cwd); uniq.push(r); } }
      if (uniq.length < 2) return { skipped: true, sessions: withCwd.slice(0, 4) };
      rows.find((r) => r.dataset.id === uniq[0].id).click();
      await new Promise((r) => setTimeout(r, 2500));
      const a = bar.textContent.replace(/\\s+/g, ' ').trim();
      const aDir = window.__ws.cwd();
      rows.find((r) => r.dataset.id === uniq[1].id).click();
      await new Promise((r) => setTimeout(r, 2500));
      const b = bar.textContent.replace(/\\s+/g, ' ').trim();
      const bDir = window.__ws.cwd();
      return { before, a, b, aDir, bDir, dirs: withCwd.map((x) => x.cwd) };
    })()`);
    console.log('Git 状态栏:', JSON.stringify(gitInfo).slice(0, 420));
    if (gitInfo && !gitInfo.skipped) {
      ok('__ws.cwd() 跟着会话走', gitInfo.aDir !== gitInfo.bDir, { a: gitInfo.aDir, b: gitInfo.bDir });
      ok('状态栏文案跟着会话变', gitInfo.a !== gitInfo.b, { a: gitInfo.a, b: gitInfo.b });
    } else {
      console.log('  （跳过：没有两条 cwd 不同的会话）');
    }
  } catch (e) {
    failures.push('检查自身失败：' + ((e && e.message) || e));
  } finally {
    try { ws && ws.close(); } catch { /* ignore */ }
    if (!KEEP) {
      try {
        const ver = await getJson(`http://127.0.0.1:${PORT}/json/version`);
        const WebSocket = require(path.join(ROOT, 'node_modules', 'ws'));
        const bws = new WebSocket(ver.webSocketDebuggerUrl);
        await new Promise((r) => { bws.on('open', r); setTimeout(r, 1500); });
        bws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
        await sleep(1000);
      } catch { /* ignore */ }
      try { child.kill(); } catch { /* ignore */ }
    }
  }

  console.log('');
  if (failures.length) {
    console.error(`FAIL (${failures.length} 项，通过 ${passed} 项)`);
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }
  console.log(`PASS: 真机 UI 检查（右侧列布局 / 消息排版 / 产物卡片 / git 跟随会话）共 ${passed} 项`);
  process.exit(0);
})();
