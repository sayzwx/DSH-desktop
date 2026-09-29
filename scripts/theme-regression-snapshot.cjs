/* theme-regression-snapshot.cjs —— 真实整页回归比对（阶段 A-4）
 *
 * 目的：证明 A-1（61 个承接 token 的派生默认值）与 A-2（webtheme 承接层）
 *       这两处**纯新增**的改动，没有改变内置四套主题在真实页面上的任何一个
 *       computed style。
 *
 * 做法（比"改前跑一次、改后跑一次"更严格，因为它消除了两件事的干扰：
 *   ① 两次加载之间的环境抖动 ② DOM 结构差异）：
 *   在**同一个页面会话**里跑两轮快照 ——
 *     第一轮：真实 styles.css（含新增）
 *     第二轮：把 <link href="styles.css"> disabled 掉，改用 insertCSS 注入
 *             **剥离掉新增行之后**的样式表文本
 *   两轮之间 DOM 完全不动，只换样式表内容，所以差异必然来自 CSS 本身。
 *
 * 剥离范围用锚点行校验（4 个锚点全对才继续），不是靠"大概那个位置"。
 *
 * 跑法（cwd 必须是仓库根）：
 *   env -u ELECTRON_RUN_AS_NODE node node_modules/electron/cli.js scripts/theme-regression-snapshot.cjs
 * 输出：%TEMP%\theme-regression\{current,pre}.<theme>.json + result.json
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

app.disableHardwareAcceleration();
['no-sandbox', 'disable-gpu', 'disable-software-rasterizer', 'in-process-gpu']
  .forEach((s) => app.commandLine.appendSwitch(s));

const ROOT = process.env.DESKTOP_ROOT || 'D:/DS_harness';
const CSS_PATH = path.join(ROOT, 'renderer', 'styles.css');
const OUT_DIR = path.join(os.tmpdir(), 'theme-regression');
const RESULT = path.join(os.tmpdir(), 'theme-regression-result.json');
const THEMES = ['light', 'graphite', 'dark', 'custom'];

// ---------------------------------------------------------------- 样式表剥离
const cssRaw = fs.readFileSync(CSS_PATH, 'utf8');

// ------------------------------------------------------------------
// 按**标记**自定位这两处新增（不再按行号，CSS 前后再改动也不会失配）
// ------------------------------------------------------------------
const failures = [];

/** 从 `start` 处的 `{` 起找配平的 `}`（跳过字符串字面量），返回闭合符下标。 */
function matchBrace(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      const q = ch;
      i++;
      while (i < text.length) {
        if (text[i] === '\\') i++;
        else if (text[i] === q) break;
        i++;
      }
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// A-1：基础 :root 里那一段「承接层专用 token」的注释块 + 61 条声明
const A1_MARK = '承接层专用 token（面向 webUI 主题迁移）';
const a1Mark = cssRaw.indexOf(A1_MARK);
if (a1Mark < 0) failures.push(`找不到 A-1 标记「${A1_MARK}」`);
const a1CommentStart = cssRaw.lastIndexOf('/* ---', a1Mark);
const A1_LAST = '--tip-bg:';
const a1Last = cssRaw.indexOf(A1_LAST, a1Mark);
if (a1CommentStart < 0 || a1Last < 0) failures.push('A-1 边界定位失败（注释开头或 --tip-bg 没找到）');
// 删到 `--tip-bg: …;` 那一行的行尾（含换行）
const a1End = cssRaw.indexOf('\n', a1Last) + 1;
// 连同它前面的空白（保持基础 :root 原来的「空行 + }」形状）
let a1Start = a1CommentStart;
while (a1Start > 0 && (cssRaw[a1Start - 1] === ' ' || cssRaw[a1Start - 1] === '\n')) a1Start--;

// A-2：独立的 webtheme 承接层块
const A2_SEL = ':root[data-theme="webtheme"] {';
const a2Start = cssRaw.indexOf(A2_SEL);
if (a2Start < 0) failures.push(`找不到 A-2 选择器「${A2_SEL}」`);
let a2End = -1;
if (a2Start >= 0) {
  const close = matchBrace(cssRaw, cssRaw.indexOf('{', a2Start));
  if (close < 0) failures.push('A-2 块的括号不配平');
  else {
    let e = close + 1;
    while (e < cssRaw.length && (cssRaw[e] === '\n' || cssRaw[e] === '\r')) e++;
    a2End = e;
  }
}

if (failures.length) {
  fs.writeFileSync(RESULT, JSON.stringify({ ok: false, stage: 'locate', failures }, null, 2));
  process.stdout.write('区块定位失败，见 ' + RESULT + '\n');
  app.exit(6);
}

const a1Text = cssRaw.slice(a1CommentStart, a1End);
const a2Text = cssRaw.slice(a2Start, a2End);

// ------------------------------------------------------------------
// 构造「迁移改造之前的样式表」= 当前 CSS 去掉全部面向迁移主题的新增：
//   ① A-1：基础 :root 里那 61 条新 token 声明（唯一可能波及内置主题的一处）
//   ② 任何 `[data-theme="webtheme"]` 限定的选择器（A-2 整块 + 被追加进
//      既有规则列表的 webtheme 分支，例如 #bgvideo 的 display:none）
//
// ② 必须**按选择器**摘除，不能把整条规则删掉：`#bgvideo` 那条规则里
// light / graphite 的选择器是改造前就存在的，整条删掉会凭空制造差异。
//
// 顺带审计：凡前导段里出现 webtheme 的规则，至少要有一个选择器是
// [data-theme="webtheme"] 限定的 —— 否则说明有人把 webtheme 写进了
// 不带限定的上下文（那才是真的会波及内置主题）。
// ------------------------------------------------------------------
function stripGuardedSelectors(css) {
  let out = css;
  const touched = touchedRules;
  let guard = 0;
  for (;;) {
    if (guard++ > 200) break;
    const i = out.indexOf('data-theme="webtheme"');
    if (i < 0) break;
    let ps = Math.max(out.lastIndexOf('}', i), out.lastIndexOf(';', i));
    ps = ps < 0 ? 0 : ps + 1;
    const open = out.indexOf('{', i);
    if (open < 0) break;
    const close = matchBrace(out, open);
    if (close < 0) break;
    const prelude = out.slice(ps, open);
    const sels = prelude.split(',').map((s) => s.trim()).filter(Boolean);
    const guarded = sels.filter((s) => s.includes('[data-theme="webtheme"]'));
    const kept = sels.filter((s) => !s.includes('[data-theme="webtheme"]'));
    if (guarded.length === 0) touchNoGuard.push(prelude.replace(/\s+/g, ' ').slice(0, 120));
    touched.push({
      原选择器: sels.join(', ').slice(0, 130),
      摘除: guarded.length,
      保留: kept.length,
      动作: kept.length ? '摘除 webtheme 分支' : '整条删除',
    });
    if (!kept.length) {
      let e = close + 1;
      while (e < out.length && /\s/.test(out[e])) e++;
      out = out.slice(0, ps) + out.slice(e);
    } else {
      const lead = (prelude.match(/^\s*/) || [''])[0];
      const indent = (prelude.match(/\n(\s*)\S/) || [, ''])[1] || '  ';
      out = `${out.slice(0, ps)}${lead}${kept.join(',\n' + indent)} {${out.slice(open + 1, close + 1)}${out.slice(close + 1)}`;
    }
  }
  return { css: out, touched };
}

const touchNoGuard = [];
// 先摘 A-1（基础 :root 里的新 token 声明），再按选择器摘掉所有 webtheme 分支
const touchedRules = [];
const preCssFinal = stripGuardedSelectors(cssRaw.slice(0, a1Start) + cssRaw.slice(a1End)).css;
const preCss = preCssFinal;

// 剥离结果自检
const preChecks = {
  'A-1 区块字节数': a1Text.length,
  'A-2 区块字节数': a2Text.length,
  字节变化: `${cssRaw.length} → ${preCssFinal.length}（−${cssRaw.length - preCssFinal.length}）`,
  'pre 版残留 webtheme 出现次数': (preCssFinal.match(/webtheme/g) || []).length,
  'pre 版残留 A-1 声明': ['--tip-bg:', '--mask-drop:', '--btn-primary-fill:']
    .filter((t) => preCssFinal.includes(t)),
  '括号配平': (preCssFinal.match(/\{/g) || []).length - (preCssFinal.match(/\}/g) || []).length,
  '被改写的规则': touchedRules,
};
if (preChecks['pre 版残留 A-1 声明'].length) failures.push(`pre 版仍残留 A-1 声明：${preChecks['pre 版残留 A-1 声明'].join(', ')}`);
if (preChecks['括号配平'] !== 0) failures.push('pre 版括号不配平');
if (touchNoGuard.length) failures.push(`有规则带了 webtheme 却没有任何限定选择器，会波及内置主题：${touchNoGuard.join(' | ')}`);

// 顺带做一次静态碰撞检查：A-1 新增的 61 个 token 名字在**剥离后**的样式表里
// 必须完全不存在 —— 若存在，说明"新增"的名字其实和已有 token 撞车，
// 那才会真的改到内置主题（后写覆盖）。
// 注意：A-2 里的承接规则**故意**指向已有 token（--void / --accent 等），
// 所以它们不参与这项检查；判断标准看下面的 newTokens 差异表。
const wbStart = a2Start;
const wbEnd = a2End;
const wbText = a2Text;
const a1Names = [...new Set((a1Text.match(/^\s*(--[a-z0-9-]+)\s*:/gm) || [])
  .map((s) => s.trim().replace(/:$/, '')))];
const wbVarNames = [...new Set((wbText.match(/^\s*(--dsw-[a-z0-9-]+)\s*:/gm) || [])
  .map((s) => s.trim().replace(/:$/, '')))];
const newNames = a1Names;
const collided = a1Names.filter((n) => preCss.includes(n + ':'));
if (a1Names.length !== 61) failures.push(`A-1 解析出的新增 token 数不是 61，而是 ${a1Names.length}`);
if (collided.length) failures.push(`A-1 新增 token 与已有 token 撞名（${collided.length}）: ${collided.join(', ')}`);

// ---------------------------------------------------------------- 快照脚本
const customVars = [...new Set([...cssRaw.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))].sort();

const SNAPSHOT = `(() => {
  const PROPS = ['color','backgroundColor','backgroundImage','backgroundSize','backgroundPosition',
    'borderTopColor','borderTopWidth','borderTopStyle','borderRightColor','borderBottomColor','borderLeftColor',
    'borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius',
    'boxShadow','textShadow','opacity','filter','backdropFilter','fill','stroke','fontWeight','fontSize',
    'letterSpacing','outlineColor','outlineWidth'];
  const out = { nodes: {}, vars: {}, varsBody: {}, meta: {} };
  const pathOf = (el) => {
    const parts = [];
    let cur = el;
    while (cur && cur !== document.documentElement) {
      const parent = cur.parentElement;
      if (!parent) break;
      parts.unshift(cur.tagName.toLowerCase() + ':' + [...parent.children].indexOf(cur));
      cur = parent;
    }
    return parts.join('>') || 'html';
  };
  const VARS = ${JSON.stringify(customVars)};
  const csRoot = getComputedStyle(document.documentElement);
  const csBody = getComputedStyle(document.body);
  for (const n of VARS) {
    out.vars[n] = (csRoot.getPropertyValue(n) || '').trim();
    out.varsBody[n] = (csBody.getPropertyValue(n) || '').trim();
  }
  for (const el of document.querySelectorAll('*')) {
    const c = getComputedStyle(el);
    const o = {};
    for (const p of PROPS) o[p] = c[p];
    out.nodes[pathOf(el)] = o;
  }
  const root = document.documentElement;
  out.meta.theme = root.getAttribute('data-theme');
  out.meta.bodyBg = csBody.backgroundColor;
  out.meta.bodyColor = csBody.color;
  out.meta.sheets = [...document.styleSheets].map((s) => {
    try { return (s.href || 'inline') + '#' + s.cssRules.length; } catch (e) { return (s.href || 'inline') + '#blocked'; }
  });
  return out;
})()`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// preload 里的 channel 全注册上（漏一个页面 boot 不起来）；本脚本不需要真引擎
const preloadSrc = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
const channels = [...new Set([...preloadSrc.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((m) => m[1]))];
const BENIGN = {
  'harness:status': () => ({ state: 'stopped', webUp: false, pid: 0 }),
  'llm:reasoningLevels': () => {
    const m = require(path.join(ROOT, 'lib', 'model-probe.js'));
    return { ok: true, engine: m.ENGINE_LEVELS, wire: m.WIRE_CANDIDATES };
  },
};
for (const ch of channels) {
  ipcMain.handle(ch, async () => (BENIGN[ch] ? BENIGN[ch]() : { ok: false, error: 'stub(' + ch + ')', items: [], list: [], namespaces: [], providers: [], models: [], sessions: [] }));
}

(async () => {
  const report = { ok: false, anchors: 'ok', preChecks, failures, stats: {}, diffs: {} };
  const watchdog = setTimeout(() => {
    try { fs.writeFileSync(RESULT, JSON.stringify({ ...report, error: 'watchdog' }, null, 2)); } catch (e) {}
    app.exit(3);
  }, 240000);

  await app.whenReady();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const win = new BrowserWindow({
    show: false, width: 1440, height: 900,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  await wait(2600);
  await win.webContents.insertCSS('*{transition:none !important;animation:none !important}');
  await wait(300);

  const setTheme = async (t) => {
    const got = await win.webContents.executeJavaScript(`(() => {
      const s = document.getElementById('themeSelect');
      if (!s) return 'no #themeSelect';
      if (![...s.options].some(o => o.value === ${JSON.stringify(t)})) return 'option-missing';
      s.value = ${JSON.stringify(t)};
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return document.documentElement.getAttribute('data-theme');
    })()`, true);
    await wait(700);
    return got;
  };

  report.stats.channels = channels.length;
  report.stats.varsTracked = customVars.length;
  report.stats.strippedBytes = cssRaw.length - preCss.length;
  report.stats.newTokenNames = newNames.length;
  report.stats.webthemeOwnVars = wbVarNames.length;
  report.stats.collidedWithExisting = collided;

  // ---------- 第一轮：真实 CSS ----------
  const cur = {};
  for (const t of THEMES) {
    const got = await setTheme(t);
    if (got !== t) failures.push(`主题 ${t} 切换失败（${got}）`);
    const snap = await win.webContents.executeJavaScript(SNAPSHOT, true);
    cur[t] = snap;
    fs.writeFileSync(path.join(OUT_DIR, 'current.' + t + '.json'), JSON.stringify(snap));
  }
  report.diffs.currentMeta = Object.fromEntries(THEMES.map((t) => [t, cur[t].meta]));

  // ---------- 换样式表：禁用真表，注入剥离后的文本 ----------
  const disabled = await win.webContents.executeJavaScript(`(() => {
    const l = [...document.querySelectorAll('link[rel=stylesheet]')].find(x => /styles\\.css$/.test(x.getAttribute('href') || ''));
    if (!l) return 'link-not-found';
    l.disabled = true;
    return 'disabled:' + l.getAttribute('href');
  })()`, true);
  report.sheetSwap = disabled;
  if (!String(disabled).startsWith('disabled:')) failures.push('未能禁用 styles.css（' + disabled + '）');
  const cssKey = await win.webContents.insertCSS(preCss);
  await wait(700);

  // ---------- 第二轮：剥离后的 CSS ----------
  const pre = {};
  for (const t of THEMES) {
    const got = await setTheme(t);
    if (got !== t) failures.push(`[剥离后] 主题 ${t} 切换失败（${got}）`);
    const snap = await win.webContents.executeJavaScript(SNAPSHOT, true);
    pre[t] = snap;
    fs.writeFileSync(path.join(OUT_DIR, 'pre.' + t + '.json'), JSON.stringify(snap));
  }
  report.diffs.preMeta = Object.fromEntries(THEMES.map((t) => [t, pre[t].meta]));

  // ---------- 逐元素比对 ----------
  const summary = {};
  for (const t of THEMES) {
    const a = cur[t], b = pre[t];
    const nodeDiffs = [];
    const keys = new Set([...Object.keys(a.nodes), ...Object.keys(b.nodes)]);
    for (const k of keys) {
      const x = a.nodes[k], y = b.nodes[k];
      if (!x || !y) { nodeDiffs.push({ node: k, prop: '(缺失)', cur: x ? '有' : '无', pre: y ? '有' : '无' }); continue; }
      for (const p of Object.keys(x)) {
        if (x[p] !== y[p]) nodeDiffs.push({ node: k, prop: p, cur: x[p], pre: y[p] });
      }
    }
    const varDiffs = [];
    for (const k of new Set([...Object.keys(a.vars), ...Object.keys(b.vars)])) {
      if (a.vars[k] !== b.vars[k]) varDiffs.push({ var: k, cur: a.vars[k], pre: b.vars[k] });
    }
    const varBodyDiffsAll = [];
    for (const k of new Set([...Object.keys(a.varsBody), ...Object.keys(b.varsBody)])) {
      if (a.varsBody[k] !== b.varsBody[k]) varBodyDiffsAll.push({ var: k, cur: a.varsBody[k], pre: b.varsBody[k] });
    }
    // 新 token 在内置主题下必须与"完全没有它们"时不可区分 —— 它们不该被组件引用，
    // 所以唯一可能出现的差异是它们自己的声明。这里单独列出以便判断严重性。
    const isNew = (n) => newNames.includes(n) || n.startsWith('--dsw-');
    const newTokenDiffs = varDiffs.filter((d) => isNew(d.var));
    const realVarDiffs = varDiffs.filter((d) => !isNew(d.var));
    const newTokenBodyDiffs = varBodyDiffsAll.filter((d) => isNew(d.var));
    const varBodyDiffs = varBodyDiffsAll.filter((d) => !isNew(d.var));
    summary[t] = {
      元素数: Object.keys(a.nodes).length,
      元素样式差异: nodeDiffs.length,
      '变量差异（新增 token 自身除外）': realVarDiffs.length,
      '变量差异（仅新增 token 自身）': newTokenDiffs.length,
      'body变量差异（新增 token 自身除外）': varBodyDiffs.length,
      'body变量差异（仅新增 token 自身）': newTokenBodyDiffs.length,
    };
    if (nodeDiffs.length) report.diffs['nodes:' + t] = nodeDiffs.slice(0, 40);
    if (realVarDiffs.length) report.diffs['vars:' + t] = realVarDiffs;
    if (varBodyDiffs.length) report.diffs['varsBody:' + t] = varBodyDiffs.slice(0, 30);
    if (newTokenDiffs.length) report.diffs['newTokens:' + t] = newTokenDiffs;
    if (nodeDiffs.length) failures.push(`[${t}] ${nodeDiffs.length} 处元素样式差异`);
    if (realVarDiffs.length) failures.push(`[${t}] ${realVarDiffs.length} 处非新增 token 的值发生变化`);
    if (varBodyDiffs.length) failures.push(`[${t}] ${varBodyDiffs.length} 处 body 上的变量发生变化`);
    // 新增 token 自身：剥离后必须是空串（= 剥离前根本不存在 → 没有覆盖任何东西）
    const notEmptyInPre = newTokenDiffs.filter((d) => d.pre !== '');
    if (notEmptyInPre.length) failures.push(`[${t}] ${notEmptyInPre.length} 个新增 token 在剥离版里也有值（说明撞名覆盖）: ${notEmptyInPre.slice(0, 6).map((d) => d.var).join(', ')}`);
    if (newTokenDiffs.length !== newNames.length) failures.push(`[${t}] 新增 token 差异条数 ${newTokenDiffs.length} ≠ 新增 token 数 ${newNames.length}`);
  }
  report.summary = summary;

  clearTimeout(watchdog);
  report.ok = failures.length === 0;
  fs.writeFileSync(RESULT, JSON.stringify(report, null, 2), 'utf8');
  process.stdout.write('result -> ' + RESULT + '\n');
  process.stdout.write(JSON.stringify(summary, null, 1) + '\n');
  app.exit(report.ok ? 0 : 5);
})().catch((err) => {
  try { fs.writeFileSync(RESULT, JSON.stringify({ ok: false, error: String((err && err.stack) || err) }, null, 2)); } catch (e) {}
  app.exit(4);
});
