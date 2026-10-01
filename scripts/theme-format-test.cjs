/**
 * 主题包**形态兼容**测试（离线、零费用、不需要 Electron）。
 *
 * 起因（2026-09-30 用户反馈「又检测不到，是不是不止这两种」）：市场里的主题写法至少三种，
 * 而且**入口位置也各不相同**：
 *   ① 根 `client.js` + `const SCHEMES = {…}` 字面量        —— dsh-neo-skin
 *   ② `lib/client.js` + `skin.json` + 整段 CSS            —— 官方皮肤生态（@smalltailqwq/…-skin-…）
 *   ③ **`bundle/client.js`**（入口写在 `exports["./client"]`）+ `ctx.theme.overrideTokens('ns', { '--dsw-x': pair(v) })`
 *                                                          —— Cordis 插件（dsh-kimino-theme）
 * 旧实现硬编码 `client.js` / `lib/client.js` 两个路径 + 只认 SCHEMES 字面量 → ③ 完全扫不到。
 *
 * 本测试覆盖：
 *   A. 入口解析：按 package.json 的 exports/main 找入口（三种形态都对）
 *   B. 通用变量提取：对象字面量 / pair() helper / 裸字面量 / CSS 文本 / 多种命名空间 API
 *   C. 官方客户端组件不会被误判成主题包
 *   D. 扫描结果与迁移解析**一致**（同一套 resolveSchemeSource，杜绝"扫到却迁不了"）
 *
 * 用法: node scripts/theme-format-test.cjs
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const W = require(path.join(ROOT, 'lib', 'web-themes.js'));
const ROOT_PLUGINS = path.join(os.homedir(), '.dsh', 'profiles', 'web', 'node_modules');

const failures = [];
let passed = 0;
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++;
  else failures.push(`${name}\n    期望: ${JSON.stringify(expected)}\n    实际: ${JSON.stringify(actual)}`);
};
const checkTrue = (name, cond, detail) => {
  if (cond) passed++;
  else failures.push(name + (detail !== undefined ? `\n    实际: ${JSON.stringify(detail)}` : ''));
};

// ---------- A. 入口解析 ----------
console.log('=== A. 入口解析（按 package.json）===');
const entryCases = [
  ['dsh-kimino-theme', 'bundle/client.js'],            // exports["./client"]
];
for (const [pkg, want] of entryCases) {
  const dir = path.join(ROOT_PLUGINS, pkg);
  if (!fs.existsSync(dir)) { console.log(`  (跳过 ${pkg}：未安装)`); continue; }
  const r = W.readPluginClientSource(dir);
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  console.log(`  ${pkg}: exports["./client"]=${JSON.stringify((pj.exports || {})['./client'])} → 解析到 ${r.file} (${r.src.length} 字符)`);
  check(`${pkg} 入口解析正确`, r.file, want);
  checkTrue(`${pkg} 读到了内容`, r.src.length > 1000, r.src.length);
}

// ---------- B. 通用变量提取（含合成样本）----------
console.log('=== B. 通用变量提取 ===');
const synthetic = {
  对象字面量: `const SCHEMES = { a: { tokens: { '--dsw-alias-bg-base': { light: '#fff', dark: '#000' } } } };`,
  pair_helper: `const pair = (v) => ({ light: v, dark: v });
ctx.theme.overrideTokens('mine', { '--dsw-alias-text': pair('#123456'), '--dsw-alias-bg': pair('rgb(1,2,3)') });`,
  裸字面量: `ctx.theme.overrideTokens('bare', { '--dsw-alias-border': '#abc', '--dsw-alias-radius': '8px' });`,
  css文本: `const css = 'body { --dsw-alias-bg-base: #101820; --dsw-alias-text: rgba(255,255,255,0.9); }';`,
  另一种API: `registerTheme('other', { '--dsw-alias-brand': { light: '#0af', dark: '#05f' } });`,
  单档对象: `defineTheme('single', { '--dsw-alias-x': { dark: '#222' } });`,
};
for (const [label, src] of Object.entries(synthetic)) {
  const g = W.parseTokenMapsFromSource(src);
  const found = g ? Object.values(g.schemes).reduce((n, s) => n + Object.keys(s.tokens).length, 0) : 0;
  const ns = g ? Object.keys(g.schemes).join(',') : '(无)';
  console.log(`  ${label}: 命名空间 ${ns} | 变量 ${found}`);
  checkTrue(`${label} 能提取到变量`, found > 0, g);
}
// pair() 的值两边都填上
const pairG = W.parseTokenMapsFromSource(synthetic.pair_helper);
check('pair() helper 解析成同值双档', pairG.schemes.mine.tokens['--dsw-alias-text'], { light: '#123456', dark: '#123456' });
// CSS 文本形式
const cssG = W.parseTokenMapsFromSource(synthetic.css文本);
check('CSS 文本形式也能提取', Object.keys(cssG.schemes.default.tokens).length, 2);
// 单档对象补成双档
const oneG = W.parseTokenMapsFromSource(synthetic.单档对象);
check('只给 dark 一档时补成双档', oneG.schemes.single.tokens['--dsw-alias-x'], { light: '#222', dark: '#222' });
// 空源码不该炸
check('空源码返回 null', W.parseTokenMapsFromSource(''), null);

// kimino 真实包：64 个变量、命名空间 kimino-bg
const kiminoDir = path.join(ROOT_PLUGINS, 'dsh-kimino-theme');
if (fs.existsSync(kiminoDir)) {
  const g = W.parseTokenMapsFromSource(W.readPluginClientSource(kiminoDir).src);
  const keys = Object.keys((g.schemes['kimino-bg'] && g.schemes['kimino-bg'].tokens) || {});
  console.log(`  dsh-kimino-theme 实测: 命名空间 ${Object.keys(g.schemes).join(',')} | 变量 ${keys.length}`);
  checkTrue('kimino 提取到 60+ 变量', keys.length >= 60, keys.length);
  checkTrue('kimino 命名空间是 kimino-bg（不是散进 default）', !!g.schemes['kimino-bg'], Object.keys(g.schemes));
}

// ---------- C. 官方客户端组件不当主题 ----------
console.log('=== C. 官方客户端组件排除 ===');
const stylesCss = fs.readFileSync(path.join(ROOT, 'renderer', 'styles.css'), 'utf8');
const scan = W.scanThemePlugins({ dshHome: path.join(os.homedir(), '.dsh'), stylesCss });
const officialListed = (scan.plugins || []).filter((p) => /^@deepseek-ai\/dsh-(client|cordis|session-log|typert|api-)/.test(p.id));
console.log(`  扫描到 ${(scan.plugins || []).length} 个主题包；官方组件被误列 ${officialListed.length} 个`);
console.log(`  主题包清单: ${(scan.plugins || []).map((p) => `${p.id}(${p.kind})`).join(', ') || '(无)'}`);
check('官方客户端组件不会被列成主题', officialListed.length, 0);
checkTrue('官方组件在 skipped 里给出明确理由',
  (scan.skipped || []).some((s) => /官方 WebUI 客户端组件/.test(s.reason || '')),
  (scan.skipped || []).slice(0, 2).map((s) => s.reason));

// ---------- D. 扫描与迁移一致 ----------
console.log('=== D. 扫描 vs 迁移 一致性 ===');
for (const p of scan.plugins || []) {
  const resolved = W.resolveSchemeSource(p);
  const scanIds = p.schemes.map((s) => s.id).sort();
  const migIds = Object.keys(resolved.schemes || {}).sort();
  console.log(`  ${p.id}: 扫描方案 ${scanIds.join(',')} | 迁移解析 ${migIds.join(',')} | 入口 ${resolved.file}`);
  check(`${p.id} 扫描与迁移看到同一批方案`, migIds, scanIds);
  for (const s of p.schemes) {
    for (const tone of s.tones) {
      let ok = true;
      let detail = '';
      try {
        const m = p.kind === 'skin' || p.kind === 'generic'
          ? W.buildSkinMigration({ plugin: p, tone, stylesCss })
          : W.buildMigration({ plugin: p, schemeId: s.id, tone, stylesCss });
        ok = !!(m && m.id && m.tokens);
        detail = m && m.label;
      } catch (e) {
        ok = false;
        detail = e.message;
      }
      checkTrue(`${p.id} / ${s.id} / ${tone} 能迁移出产物`, ok, detail);
    }
  }
}

// ---------- E. 精修产出：桌面端变量必须被保留（2026-09-30 用户报「精修没效果」）----------
// 真因：模型返回的是**桌面端变量**（--panel/--text/--accent…），净化只认 --dsw-*，
// 14 条全被丢弃 → 精修"跑成功"但什么都没带进来。
console.log('=== E. 精修产出的桌面端变量 ===');
const A = require(path.join(ROOT, 'lib', 'theme-analysis.js'));
const desktopTokens = W.collectDesktopTokenNames(stylesCss);
console.log(`  桌面端变量白名单: ${desktopTokens.size} 个`);
checkTrue('桌面端变量白名单非空', desktopTokens.size > 50, desktopTokens.size);

const modelOutput = {   // 复刻真实模型返回（kimino 精修那次）
  accent: '', accentReason: '',
  tokens: {
    '--panel': '#0f172a', '--float': '#111c33', '--sidebar-fill': '#0b1220', '--bubble-bg': '#101c33',
    '--menu-bg': '#0f1a30', '--tip-bg': '#0f1a30', '--text': '#e2e8f7', '--text-dim': '#93a3bf',
    '--text-caption': '#7f8ea8', '--border': 'rgba(147,197,253,0.28)', '--accent': '#93c5fd',
    '--danger': '#f87171', '--code-bg': '#0b1220', '--inline-code-bg': '#16233d',
    '--dsw-alias-bg-base': 'rgba(5,8,20,0.9)',
    '--totally-invented-var': '#fff',
  },
  css: '.card { border-radius: 0; }',
  behavior: [], unmapped: [], confidence: 'medium',
};
const san = A.sanitizeAnalysis(modelOutput, { stylesCss, pluginDir: 'C:/nonexistent' });
const keptTokens = Object.keys(san.analysis.tokens);
console.log(`  保留 ${keptTokens.length} 条 / 丢弃 ${san.dropped.length} 条`);
console.log(`  丢弃原因: ${JSON.stringify(san.dropped)}`);
check('14 条桌面端变量全部保留', keptTokens.filter((k) => k.startsWith('--') && !k.startsWith('--dsw-') && k !== '--totally-invented-var').length, 14);
check('--dsw-* 仍然保留', keptTokens.includes('--dsw-alias-bg-base'), true);
check('凭空造的变量名被丢弃', keptTokens.includes('--totally-invented-var'), false);
checkTrue('丢弃原因写清楚了（指明"不在桌面端变量表里"）',
  san.dropped.some((d) => /不在桌面端变量表里/.test(d)), san.dropped);

// 提示词要明确允许桌面端变量，否则模型只能猜
const prompt = A.buildAnalysisPrompt({ plugin: scan.plugins[0] || { id: 'x', schemes: [] }, stylesCss, migration: { tokens: {}, css: '', notes: [], label: 'x', shapePolicy: {} } });
checkTrue('提示词说明可以直接给桌面端变量', /也可以直接在 tokens 里给它们赋值/.test(prompt.user), null);
checkTrue('输出形状里写明了两类 token 名', /--dsw-\* 或桌面端变量/.test(prompt.user), null);

// ---------- F. 页面级背景图：免费自动承接 ----------
// 用户报「精修后为什么还是没有背景」—— 真因：webtheme 下 #bgvideo/#bgfx 会 display:none，
// 桌面端**根本没有挂背景图的落点**。现在有了 #themeBg，且 body/html 的 background-image
// 走**确定性免费路径**（不用花模型的钱）。
console.log('=== F. 页面级背景图（免费承接）===');
checkTrue('#themeBg 挂载点存在于 index.html', /id="themeBg"/.test(fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8')), null);
checkTrue('#themeBg 样式存在（fixed 全屏 cover）',
  /#themeBg \{[\s\S]{0,400}background-size: cover/.test(stylesCss), null);
const kiminoDir2 = path.join(ROOT_PLUGINS, 'dsh-kimino-theme');
if (fs.existsSync(kiminoDir2)) {
  const src2 = W.readPluginClientSource(kiminoDir2).src;
  const bg = W.detectPageBackground(src2, kiminoDir2);
  console.log('  kimino 检出背景图:', bg ? `${bg.selector} → ${path.basename(bg.file)}（${(bg.size / 1024 / 1024).toFixed(1)}MB）` : '(未检出)');
  checkTrue('检出 body 上的页面级背景图', !!bg && bg.selector === 'body', bg);
  checkTrue('虚拟路径 /kimino-bg/current.jpg 解析成包内真实文件',
    !!bg && fs.existsSync(bg.file) && /current\.jpg$/.test(bg.file), bg && bg.file);
  // 迁移产物里应该带上 #themeBg 规则（免费，不用模型）
  const p2 = (scan.plugins || []).find((x) => x.id === 'dsh-kimino-theme');
  if (p2) {
    const mig = W.buildMigration({ plugin: p2, schemeId: p2.schemes[0].id, tone: 'dark', stylesCss });
    checkTrue('免费迁移产物里含 #themeBg 背景规则', /#themeBg \{[^}]*background-image/.test(mig.css), mig.css.slice(0, 120));
    checkTrue('背景 URL 已改写成 file:// 且指向包内文件', /url\('file:\/\/\/[^']*current\.jpg'\)/.test(mig.css), null);
    checkTrue('notes 说明背景已承接', mig.notes.some((n) => /背景图已自动承接/.test(n)), mig.notes.slice(-1));
  }
}

// ---------- E. 扫描根覆盖与体检报告（用户报"别人机器扫不到主题"）----------
console.log('=== E. 扫描根 / 体检报告 / 自定义目录 ===');
{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-scan-home-'));
  // ① 全部 profile 都要进扫描根（原先只认 profiles/web —— profile 名不同就整片漏掉）
  const betaRoot = path.join(home, 'profiles', 'beta', 'node_modules');
  fs.mkdirSync(path.join(betaRoot, 'some-plugin'), { recursive: true });
  fs.writeFileSync(path.join(betaRoot, 'some-plugin', 'package.json'), JSON.stringify({ name: 'some-plugin', version: '1.0.0' }));
  const roots = W.pluginRoots({ dshHome: home, harnessDir: 'D:/some-harness' });
  checkTrue('扫描根包含非 web 的 profile', roots.some((r) => /profiles[\\/]beta[\\/]node_modules$/.test(r)), roots);
  checkTrue('扫描根包含 harness 同级 node_modules', roots.some((r) => /some-harness[\\/]node_modules$/.test(r)), roots);

  // ② 体检报告：读得到的根给包数；自定义的不存在根也要列出来（状态：不存在）
  // 自定义根的语义 = **node_modules 那一层**（与界面上的选择器一致）
  const custom = path.join(home, 'my-plugins', 'node_modules');
  const customParent = path.join(home, 'parent-with-node-modules');   // 用来验"选到上层也能用"
  fs.mkdirSync(path.join(customParent, 'node_modules'), { recursive: true });
  const reports = W.pluginRootReports({ dshHome: home, harnessDir: null, extraRoots: [custom] });
  const beta = reports.find((r) => r.path === path.resolve(betaRoot));
  checkTrue('体检：可读根标记 readable 且包数 > 0', !!beta && beta.readable === true && beta.entries >= 1, beta);
  const customRep = reports.find((r) => r.path === path.resolve(custom));
  checkTrue('体检：自定义但不存在 → exists=false 且 custom=true', !!customRep && customRep.exists === false && customRep.custom === true, customRep);

  // ③ 自定义扫描目录里的主题包**真的能被扫到**（这是给"装在别处"的兜底出口）
  const pkgDir = path.join(custom, 'fixture-token-theme');
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: 'fixture-token-theme', version: '1.0.0' }));
  // 注意形状：必须是**可识别的主题写法**（SCHEMES 字面量 / overrideTokens 调用 / CSS 文本…）。
  // 裸的 `const light = {...}; const dark = {...}` 不算 —— 那和无主题能力的普通代码无法区分。
  fs.writeFileSync(path.join(pkgDir, 'client.js'), [
    "const SCHEMES = { main: { tokens: {",
    "  '--dsw-alias-bg-base': { light: '#ffffff', dark: '#0b1020' },",
    "  '--dsw-alias-text-1': { light: '#111111', dark: '#eaf0ff' },",
    "} } };",
    "module.exports = { SCHEMES };",
  ].join('\n'));
  const stylesCss = fs.readFileSync(path.join(ROOT, 'renderer', 'styles.css'), 'utf8');
  const scanCustom = W.scanThemePlugins({ dshHome: home, harnessDir: null, stylesCss, extraRoots: [custom] });
  const hit = (scanCustom.plugins || []).find((p) => p.id === 'fixture-token-theme');
  checkTrue('自定义扫描目录里的主题被扫到', !!hit, (scanCustom.plugins || []).map((p) => p.id));
  checkTrue('扫描结果带回体检报告（含自定义根）',
    Array.isArray(scanCustom.rootReports) && scanCustom.rootReports.some((r) => r.custom === true && r.readable === true),
    scanCustom.rootReports);
  // 不传 extraRoots 时不该扫到它（证明"自定义根"确实生效，而不是碰巧扫到）
  // 选到"上层目录"也要能用（自动下钻到它的 node_modules）
  const pkgParent = path.join(customParent, 'node_modules', 'fixture-parent-theme');
  fs.mkdirSync(pkgParent, { recursive: true });
  fs.writeFileSync(path.join(pkgParent, 'package.json'), JSON.stringify({ name: 'fixture-parent-theme', version: '1.0.0' }));
  fs.writeFileSync(path.join(pkgParent, 'client.js'), "ctx.theme.overrideTokens('p', { '--dsw-alias-bg-base': '#222', '--dsw-alias-text-1': '#eee' });\n");
  const scanParent = W.scanThemePlugins({ dshHome: home, harnessDir: null, stylesCss, extraRoots: [customParent] });
  checkTrue('自定义根选到上层目录也能扫到（自动下钻 node_modules）',
    (scanParent.plugins || []).some((p) => p.id === 'fixture-parent-theme'), (scanParent.plugins || []).map((p) => p.id));

  const scanPlain = W.scanThemePlugins({ dshHome: home, harnessDir: null, stylesCss });
  checkTrue('不传自定义根就扫不到（确认是自定义根起的作用）',
    !(scanPlain.plugins || []).some((p) => p.id === 'fixture-token-theme'), (scanPlain.plugins || []).map((p) => p.id));

  fs.rmSync(home, { recursive: true, force: true });
}

console.log();
if (failures.length) {
  console.error(`FAIL (${failures.length} 项，通过 ${passed} 项)`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`PASS: 主题包形态兼容（入口解析 / 通用提取 / 官方排除 / 扫描与迁移一致 / 扫描根与自定义目录）共 ${passed} 项`);
