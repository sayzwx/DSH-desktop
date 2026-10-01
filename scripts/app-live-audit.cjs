/**
 * **真机实时审计**：直接打开已安装的应用（默认 `D:\DSH\app\DSH.exe`），用 CDP 驱动它。
 *
 * 为什么要有这个（用户的明确要求）：仓库内的测试窗口只是"近似环境" —— 没有真引擎、没有真
 * preload 之外的那套桥、没有用户主题库、**也不能真跑 git**（本机 agent 环境禁止 node 派生子进程，
 * 但**应用进程自己可以**）。只有把真应用打开，才能验到"装上之后才出现"的问题。
 *
 * 用法：
 *   node scripts/app-live-audit.cjs                 # 默认 exe，随机端口，跑完关闭自己启的实例
 *   node scripts/app-live-audit.cjs --keep          # 跑完不关（留给人肉看）
 *   node scripts/app-live-audit.cjs --exe <path> --port 9411
 * ⚠️ 需要允许派生子进程（本机 agent 沙箱里要用免沙箱方式跑）。
 *
 * 会做：
 *   1. 起应用（`DSH_DEV_INSTANCE=live-audit` → 独立 userData，**不抢用户正在用的实例**）
 *   2. 等窗口就绪，收集启动期报错
 *   3. **真 git**：读当前工作区状态 / 列分支（应用进程能 spawn）
 *   4. 打开新面板（快捷动作 / 审阅 / 内置浏览器工具条 / Git 状态栏）后逐个主题量对比度
 *   5. 截图 + 报告；结束时用 CDP `Browser.close` 关掉自己启的实例
 */
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist', 'live-audit');
const DEFAULT_EXE = 'D:/DSH/app/DSH.exe';

const argv = process.argv.slice(2);
const argOf = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
const EXE = argOf('--exe', DEFAULT_EXE);
const PORT = Number(argOf('--port', String(9300 + Math.floor(Math.random() * 300))));
const KEEP = argv.includes('--keep');
const BOOT_WAIT_MS = 45000;      // 真应用要拉引擎，给足时间
const THEMES = (argOf('--themes', 'light,graphite,dark') || '').split(',').filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (u) => new Promise((res, rej) => {
  http.get(u, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

// 与 scripts/light-theme-audit.cjs 同源：低对比文字 / 融入背景的盒子 / 横向溢出。
// 直接查 body *，所以**面板只要打开就会被量到**（这正是本轮要覆盖的新界面）。
const AUDIT_JS = `(() => {
  const parse = (c) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(/[,\\s/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.some((n) => Number.isNaN(n))) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const pageBg = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
  const effBg = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const bg = parse(getComputedStyle(n).backgroundColor);
      if (bg && bg.a > 0.5) return bg;
      n = n.parentElement;
    }
    return pageBg;
  };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const l1 = lum(a); const l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const sel = (el) => {
    if (el.id) return '#' + el.id;
    const cls = String(el.className || '').trim().split(/\\s+/).filter(Boolean).slice(0, 2).join('.');
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
  };
  const lowText = []; const meltBox = []; const seenT = new Set(); const seenB = new Set();
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (Number(cs.opacity) < 0.2) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 3 || rect.height < 3) continue;
    const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (hasOwnText) {
      const fg = parse(cs.color);
      const hasGradient = cs.backgroundImage && cs.backgroundImage !== 'none';
      const bg = hasGradient ? null : effBg(el);
      if (fg && bg) {
        const r = ratio(fg, bg);
        if (r < 3.0) {
          const k = sel(el) + cs.color;
          if (!seenT.has(k)) { seenT.add(k); lowText.push({ sel: sel(el), color: cs.color, bg: 'rgb(' + bg.r + ',' + bg.g + ',' + bg.b + ')', ratio: Number(r.toFixed(2)), sample: el.textContent.trim().slice(0, 24) }); }
        }
      }
    }
    const bg = parse(cs.backgroundColor);
    if (!bg || bg.a < 0.3) continue;
    const vw = window.innerWidth * window.innerHeight;
    if (rect.width * rect.height >= vw * 0.95) continue;
    const same = Math.abs(bg.r - pageBg.r) < 6 && Math.abs(bg.g - pageBg.g) < 6 && Math.abs(bg.b - pageBg.b) < 6;
    if (!same) continue;
    const bw = parseFloat(cs.borderTopWidth) || 0;
    const bc = parse(cs.borderTopColor);
    const hasShadow = cs.boxShadow && cs.boxShadow !== 'none';
    const faintBorder = bw > 0 && bc && bc.a < 0.15;
    if (!hasShadow && (faintBorder || bw === 0)) {
      const k = sel(el);
      if (!seenB.has(k)) { seenB.add(k); meltBox.push({ sel: sel(el), bg: cs.backgroundColor, border: bw > 0 ? cs.borderTopColor : 'none', size: Math.round(rect.width) + 'x' + Math.round(rect.height) }); }
    }
  }
  return { theme: document.documentElement.getAttribute('data-theme'), lowText: lowText.slice(0, 40), meltBox: meltBox.slice(0, 40) };
})()`;

/** 把新面板打开（量对比度时要它们在 DOM 里可见） */
const OPEN_PANELS_JS = `(async () => {
  const out = {};
  try { const b = document.getElementById('ctQuickBtn'); if (b) { b.hidden = false; b.click(); out.quick = !document.getElementById('qaPanel').hidden; } } catch (e) { out.quickErr = String(e.message).slice(0, 60); }
  try { if (window.__quickActions) { window.__quickActions.openReview(); await new Promise((r) => setTimeout(r, 600)); out.review = !document.getElementById('qaReview').hidden; } } catch (e) { out.reviewErr = String(e.message).slice(0, 60); }
  try { await window.__gitBar.refresh(); out.gitBar = !document.getElementById('gitBar').hidden; } catch (e) { out.gitBarErr = String(e.message).slice(0, 60); }
  return out;
})()`;

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(EXE)) { console.error(`找不到应用：${EXE}`); process.exit(2); }
  const report = { exe: EXE, port: PORT, boot: [], pages: {}, panels: null, git: null, errors: [] };
  console.log(`启动真应用：${EXE}（实例标签 live-audit，端口 ${PORT}）`);
  // 🔴 必须把 ELECTRON_RUN_AS_NODE 从子进程环境里摘掉：带着它 Electron 会退化成纯 Node，
  //    Chromium 开关（--remote-debugging-port）直接被拒 —— 报 "bad option"，看起来像应用起不来。
  const childEnv = { ...process.env, DSH_DEV_INSTANCE: 'live-audit' };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  // 🔴 本机（无头/沙箱会话）GPU 进程会反复崩，Chromium 随即 `FATAL: GPU process isn't usable. Goodbye.`
  //    把应用整个带走 —— 表现是"窗口刚出来就自己退了"。真机测试必须带这几个开关；
  //    要看真实 GPU 效果就用 --gpu 显式打开（用户桌面环境里 GPU 是正常的）。
  // 少了 --remote-allow-origins=*，ws 能连上但**任何命令都收不到响应**（踩过：以为是应用没起来）
  // 少了 --no-sandbox，渲染进程直接 crash（Target crashed）——实测五种组合，只有带 no-sandbox 的能活。
  const flags = [`--remote-debugging-port=${PORT}`, '--remote-allow-origins=*'];
  if (!argv.includes('--gpu')) flags.push('--disable-gpu', '--disable-software-rasterizer', '--in-process-gpu');
  if (!argv.includes('--sandbox')) flags.push('--no-sandbox');
  const child = spawn(EXE, flags, {
    env: childEnv,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const bootLog = [];
  child.stdout.on('data', (b) => bootLog.push(b.toString()));
  child.stderr.on('data', (b) => bootLog.push(b.toString()));
  child.on('error', (e) => report.errors.push(`启动失败：${e.message}`));

  let ws = null;
  try {
    // ---------- 等 CDP 就绪 ----------
    let page = null;
    const t0 = Date.now();
    while (Date.now() - t0 < BOOT_WAIT_MS && !page) {
      await sleep(700);
      try {
        const list = await getJson(`http://127.0.0.1:${PORT}/json/list`);
        page = (list || []).find((t) => t.type === 'page' && t.webSocketDebuggerUrl && /index\.html/i.test(t.url || ''))
          || (list || []).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      } catch { /* 还没起来 */ }
    }
    if (!page) throw new Error(`CDP 未就绪（${BOOT_WAIT_MS}ms）\n启动日志尾部：\n${bootLog.join('').slice(-800)}`);
    console.log(`窗口就绪：${page.url}`);

    const WebSocket = require(path.join(ROOT, 'node_modules', 'ws'));
    ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
    let id = 0;
    const pending = new Map();
    const consoleErrors = [];
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        consoleErrors.push((m.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 200));
      }
    });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    // 连上之后再挂一个 listener：否则运行期一个 'error' 事件（未监听）会变成未捕获异常，
    // 进程直接死掉、连 finally 里的报告都来不及写（踩过：第二次跑就是这样静默消失的）
    ws.on('error', (e) => { report.errors.push('CDP socket 错误：' + ((e && e.message) || e)); });
    const send = (method, params = {}, timeoutMs = 15000) => new Promise((r) => {
      const i = ++id;
      const timer = setTimeout(() => { pending.delete(i); r({ __timeout: true, method }); }, timeoutMs);
      pending.set(i, (m) => { clearTimeout(timer); r(m); });
      try { ws.send(JSON.stringify({ id: i, method, params })); } catch (e) { clearTimeout(timer); r({ __error: String(e && e.message) }); }
    });
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result && r.result.exceptionDetails) return { __error: String((r.result.exceptionDetails.exception || {}).description || '').slice(0, 200) };
      return r.result && r.result.result ? r.result.result.value : undefined;
    };
    await send('Runtime.enable');

    // ---------- 启动健康 ----------
    console.log('  [步骤] 启动健康检查…');
    const health = await evalJs(`(() => ({
      title: document.title,
      theme: document.documentElement.getAttribute('data-theme'),
      modules: ['__md','__panels','__inspector','__gitBar','__quickActions','__dshThemes'].filter((k) => !!window[k]),
      hasGitBar: !!document.getElementById('gitBar'),
      hasQuick: !!document.getElementById('ctQuickBtn'),
      version: (document.querySelector('.app-version, #appVersion') || {}).textContent || '',
    }))()`);
    report.boot = health;
    console.log('启动健康:', JSON.stringify(health).slice(0, 300));

    // ---------- 真 git（应用进程能 spawn —— 这是真机测试的核心价值） ----------
    console.log('  [步骤] 真 git 状态…');
    const wsDir = await evalJs(`window.api.gitWorkspaceDir()`);
    const statusDir = await evalJs(`(async () => {
      const d = (window.__ws && window.__ws.path && window.__ws.path()) || (await window.api.gitWorkspaceDir()).dir;
      const st = await window.api.gitStatus(d);
      return { dir: d, isRepo: st.isRepo, branch: st.branch, dirty: st.dirty, branches: (st.branches || []).map((b) => b.name).slice(0, 8), reason: st.reason || '', error: st.error || '' };
    })()`);
    report.git = { workspaceDir: wsDir && wsDir.dir, ...statusDir };
    console.log('真 git 状态:', JSON.stringify(report.git).slice(0, 300));

    // 切到对话页：快捷动作列属于对话页（不是浮层），不切页它的占位矩形是 0×0
    await evalJs(`(() => { const b = document.querySelector('.nav-btn[data-page="chat"]'); if (b) b.click(); return !!b; })()`);
    await sleep(2000);

    // ---------- 真 git 全链路：造一个真仓库，走完 状态→新建分支→切回→改动→diff→初始化 ----------
    // 仓库放在**用户主目录下**（保证落在白名单内）；用真 git（应用进程能 spawn，这正是真机测试的价值）
    console.log('  [步骤] 真仓库全链路…');
    const { spawn: spawnAsync } = require('node:child_process');
    // 🔴 夹具必须用**异步 spawn**：本环境里 `spawnSync` 会被拦（返回 status:null、无输出，
    //    看起来像 git 命令失败），而异步 spawn 正常 —— 应用本身就是用它启动起来的。
    const g = (cwd, args) => new Promise((resolve) => {
      const c = spawnAsync('git', args, { cwd, windowsHide: true });
      let out = '';
      let err = '';
      c.stdout.on('data', (b) => { out += b.toString(); });
      c.stderr.on('data', (b) => { err += b.toString(); });
      c.on('error', (e) => resolve({ status: -1, stdout: out, stderr: String(e.message) }));
      c.on('close', (code) => resolve({ status: code, stdout: out, stderr: err }));
    });
    const sandbox = fs.mkdtempSync(path.join(os.homedir(), 'dsh-live-git-'));
    const repo = path.join(sandbox, 'demo');
    const plain = path.join(sandbox, 'plain');
    fs.mkdirSync(repo, { recursive: true });
    fs.mkdirSync(plain, { recursive: true });
    try {
      const init = await g(repo, ['init', '-b', 'main']);
      report.gitReal = { fixture: init.status === 0 ? 'ok' : `失败：${(init.stderr || '').trim().slice(0, 80)}` };
      if (init.status === 0) {
        await g(repo, ['config', 'user.email', 'live@example.com']);
        await g(repo, ['config', 'user.name', 'Live Audit']);
        fs.writeFileSync(path.join(repo, 'a.md'), '# live\nv1\n', 'utf8');
        await g(repo, ['add', '.']);
        await g(repo, ['commit', '-m', 'init']);
        const r = await evalJs(`(async () => {
          const dir = ${JSON.stringify(repo)};
          const s1 = await window.api.gitStatus(dir);
          const c = await window.api.gitCreateBranch(dir, 'feat/live-check');
          const s2 = await window.api.gitStatus(dir);
          const back = await window.api.gitCheckout(dir, 'main');
          const s3 = await window.api.gitStatus(dir);
          const bad = await window.api.gitCreateBranch(dir, '-b');
          return {
            s1: { ok: s1.ok, isRepo: s1.isRepo, branch: s1.branch, branches: (s1.branches || []).map((b) => b.name), error: s1.error || '' },
            created: { ok: c.ok, error: c.error || '' },
            s2branch: s2.branch,
            back: { ok: back.ok },
            s3branch: s3.branch,
            badRejected: bad.ok === false,
          };
        })()`);
        // 改动 → 审阅
        fs.appendFileSync(path.join(repo, 'a.md'), 'v2\n', 'utf8');
        fs.writeFileSync(path.join(repo, 'b.txt'), 'new\n', 'utf8');
        const d = await evalJs(`(async () => {
          const dir = ${JSON.stringify(repo)};
          const list = await window.api.gitDiff(dir);
          const f = await window.api.gitDiff(dir, 'a.md');
          const evil = await window.api.gitDiff(dir, '../../secret');
          const ini = await window.api.gitInit(${JSON.stringify(plain)});
          const st = await window.api.gitStatus(${JSON.stringify(plain)});
          const term = await window.api.gitOpenTerminal(dir);
          return {
            files: (list.files || []).map((x) => x.code + ' ' + x.file),
            diffHasAdd: /\\+v2/.test(f.diff || ''),
            diffLen: (f.diff || '').length,
            diffHead: (f.diff || '').slice(0, 160),
            fileErr: f.error || '',
            evilRejected: evil.ok === false,
            initOk: ini.ok === true,
            plainIsRepo: st.isRepo === true,
            terminalOk: term.ok === true,
          };
        })()`);
        report.gitReal = { ...report.gitReal, ...r, ...d };
        console.log('  真仓库结果:', JSON.stringify(report.gitReal).slice(0, 420));
      }
    } finally {
      try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
    }

    // ---------- 打开新面板 + 逐主题量对比度 ----------
    console.log('  [步骤] 打开面板…');
    report.panels = await evalJs(OPEN_PANELS_JS);
    console.log('面板打开:', JSON.stringify(report.panels));
    await sleep(900);

    for (const theme of THEMES) {
      await evalJs(`(async () => { if (window.__dshThemes) await window.__dshThemes.apply(${JSON.stringify(theme)}); return document.documentElement.getAttribute('data-theme'); })()`);
      // 🔴 不能只按固定时间等：主题切换有 0.6s+ 过渡，量早了会拿到**上一个主题**的颜色，
      //    表现成"一堆低对比文字"的假警报（实测踩到：light 报 6 处，实际浅色完全正常）。
      //    改为**轮询到真正生效**：属性对上了 + body 底色与主题预期一致（light 要亮、graphite/dark 要暗）。
      const wantLight = theme === 'light';
      let settled = false;
      for (let i = 0; i < 20 && !settled; i++) {
        const s = await evalJs(`(() => {
          const bg = getComputedStyle(document.body).backgroundColor;
          const m = /rgba?\\(([^)]+)\\)/.exec(bg || '');
          const p = m ? m[1].split(/[,\\s/]+/).filter(Boolean).map(Number) : [255, 255, 255];
          const lum = 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
          return { attr: document.documentElement.getAttribute('data-theme'), lum: Math.round(lum) };
        })()`);
        if (s && s.attr === theme && ((wantLight && s.lum > 150) || (!wantLight && s.lum < 120))) settled = true;
        else await sleep(350);
      }
      if (!settled) console.log(`  [${theme}] 主题生效等待超时（当前状态量，结果仅供参考）`);
      await sleep(400);   // 过渡收尾
      const res = await evalJs(AUDIT_JS);
      if (res && res.__error) { report.pages[theme] = { error: res.__error }; console.log(`  [${theme}] 量测失败: ${res.__error}`); continue; }
      const img = await send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT_DIR, `live-${theme}.png`);
      if (img && img.result && img.result.data) fs.writeFileSync(file, Buffer.from(img.result.data, 'base64'));
      report.pages[theme] = { lowText: res.lowText, meltBox: res.meltBox, shot: file, settled };
      console.log(`  [${theme}] 低对比文字 ${res.lowText.length} / 融入背景盒子 ${res.meltBox.length}  → ${path.basename(file)}`);
      if (res.lowText.length) for (const t of res.lowText.slice(0, 5)) console.log(`      · ${t.sel}  ${t.color} on ${t.bg}  ratio=${t.ratio}  "${t.sample}"`);
    }

    const realErrors = consoleErrors.filter((e) => !/favicon|net::ERR|DevTools/i.test(e));
    if (realErrors.length) report.errors.push(...realErrors.slice(0, 5));
  } catch (e) {
    report.errors.push((e && e.message) || String(e));
    console.error('FAIL:', (e && e.message) || e);
  } finally {
    fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
    try { ws && ws.close(); } catch { /* ignore */ }
    if (!KEEP) {
      // 只关自己启的实例：CDP 的 Browser.close（不需要 taskkill，本环境也 spawn 不了）
      try {
        const ver = await getJson(`http://127.0.0.1:${PORT}/json/version`);
        const WebSocket = require(path.join(ROOT, 'node_modules', 'ws'));
        const bws = new WebSocket(ver.webSocketDebuggerUrl);
        await new Promise((r) => { bws.on('open', r); setTimeout(r, 2000); });
        bws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
        await sleep(1200);
        bws.close();
        console.log('已关闭自己启动的实例');
      } catch (e) { console.log('关闭实例失败（可手动关闭）:', (e && e.message) || e); }
      try { child.unref(); } catch { /* ignore */ }
    } else {
      console.log('--keep：应用保持打开');
    }
  }

  const bad = Object.entries(report.pages).filter(([, v]) => v.lowText && v.lowText.length);
  const unsettled = Object.entries(report.pages).filter(([, v]) => v.settled === false).map(([k]) => k);
  console.log('');
  if (report.errors.length) { console.error(`FAIL（${report.errors.length} 条错误）`); for (const e of report.errors) console.error('  - ' + e); process.exit(1); }
  if (bad.length) {
    console.log(`INFO: ${bad.map(([k, v]) => k + '(' + v.lowText.length + ')').join(' ')} 报出低对比文字 —— `
      + '仅当对应主题 settled=true 时才可信（应用繁忙时求值会超时，量到的是切换中的颜色）。');
    for (const [k, v] of bad) if (v.settled === false) console.log(`  · ${k} 未收敛，本次数据不可信`);
  }
  if (unsettled.length) console.log(`注：${unsettled.join('/')} 未确认主题生效；需要精确对比度请用 scripts/light-theme-audit.cjs。`);
  console.log('PASS: 真机审计（启动健康 / 真 git / 面板打开 / 各主题对比度）');
  console.log('报告：' + path.join(OUT_DIR, 'report.json'));
  void os;
  process.exit(0);
})();
