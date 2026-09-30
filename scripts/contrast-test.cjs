/**
 * 对比度工具 + 精修护栏测试（纯 node，不需要 Electron）。
 *
 * 覆盖：
 *   · 对比度算法对 WCAG 标准值（#000/#fff=21、#767676/#fff≈4.54）
 *   · alpha 合成（半透明白压黑不能按纯白算）
 *   · ensureReadable 保持色相
 *   · **精修护栏**三种场景：浅底浅字 / 深底深字 / 正常主题（必须零改动）
 *
 * 跑法: node scripts/contrast-test.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const C = require(path.join(ROOT, 'lib', 'contrast.js'));
const W = require(path.join(ROOT, 'lib', 'web-themes.js'));
const A = require(path.join(ROOT, 'lib', 'theme-analysis.js'));

const failures = [];
let passed = 0;
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failures.push(`${name}\n    期望: ${JSON.stringify(expected)}\n    实际: ${JSON.stringify(actual)}`);
}
function near(name, actual, expected, tol = 0.06) {
  if (actual != null && Math.abs(actual - expected) <= tol) { passed++; return; }
  failures.push(`${name}\n    期望: ${expected}±${tol}\n    实际: ${actual}`);
}
function checkTrue(name, cond, detail) {
  if (cond) { passed++; return; }
  failures.push(name + (detail !== undefined ? `\n    实际: ${JSON.stringify(detail)}` : ''));
}

console.log('=== ① WCAG 标准值 ===');
near('#000 on #fff = 21', C.contrastRatio('#000', '#fff'), 21, 0.01);
near('#767676 on #fff ≈ 4.54', C.contrastRatio('#767676', '#fff'), 4.54);
near('#777 on #fff ≈ 4.48', C.contrastRatio('#777', '#fff'), 4.48);
near('同色 = 1', C.contrastRatio('#123456', '#123456'), 1, 0.01);
check('解析不了的返回 null', C.contrastRatio('color-mix(in srgb, red 10%, blue)', '#fff'), null);

console.log('=== ② alpha 合成 ===');
const half = C.contrastRatio('rgba(255,255,255,0.5)', '#000');
checkTrue('半透明白压黑 ≈ 5.3（不是 21）', half != null && half > 5 && half < 5.6, half);
const q = C.contrastRatio('rgba(255,255,255,0.35)', '#0b0d2e');
checkTrue('低透明度白压深蓝远低于纯白（21）', q != null && q < 4, q);

console.log('=== ③ ensureReadable 保持色相 ===');
const fixed = C.ensureReadable('#4a90d9', '#3b6fb5', 4.5);
checkTrue('同色系相邻被修正', fixed.changed, fixed);
checkTrue('修后达标', C.contrastRatio(fixed.color, '#3b6fb5') >= 4.5, fixed);
const h1 = C.rgbToHsl(C.parseColor(fixed.color));
checkTrue('色相基本保留（213° ± 12）', Math.abs(h1.h - 213) <= 12, h1.h);
checkTrue('饱和度没有被拉成灰', h1.s > 0.3, h1.s);
const keep = C.ensureReadable('#93c5fd', '#0f172a', 4.5);
checkTrue('本来就够 → 不改', !keep.changed, keep);

console.log('=== ④ 精修护栏（真实管线） ===');
const stylesCss = fs.readFileSync(path.join(ROOT, 'renderer', 'styles.css'), 'utf8');
const defs = W.collectDesktopTokenDefaults(stylesCss);
checkTrue('默认值解析拿到 40+ 个', defs.size > 40, defs.size);
check('var() 链已解开（--text）', defs.get('--text'), '#e8f4f8');
check('半透明值保留（--panel）', defs.get('--panel'), 'rgba(13, 24, 48, 0.85)');

const PAIRS = [
  ['--text', '--panel', 4.5], ['--text', '--float', 4.5], ['--text', '--void', 3.0], ['--text', '--chrome', 3.0],
  ['--text-dim', '--panel', 3.0], ['--text-dim', '--float', 3.0], ['--accent', '--panel', 3.0],
];
function runGuard(tokens) {
  const r = A.sanitizeAnalysis({ tokens: { ...tokens }, css: '', accent: '', behavior: [], unmapped: [], confidence: 'medium' }, { stylesCss });
  const merged = { ...Object.fromEntries(defs), ...r.analysis.tokens };
  const bad = PAIRS.filter(([fg, bg, min]) => { const cr = C.contrastRatio(merged[fg], merged[bg]); return cr == null || cr < min; });
  return { tokens: r.analysis.tokens, adjustments: r.analysis.adjustments || [], merged, bad };
}

const light = runGuard({ '--panel': '#f5f6f7', '--float': '#eceef1', '--chrome': '#ffffff', '--text-dim': '#cfd6dd' });
checkTrue('浅底浅字：护栏出手', light.adjustments.length >= 2, light.adjustments);
check('浅底浅字：全部组合达标', light.bad.map(([f, b]) => `${f}@${b}`), []);
checkTrue('浅底浅字：文字被压暗（不是白字）', C.parseColor(light.merged['--text']).r < 140, light.merged['--text']);

const dark = runGuard({ '--panel': '#0f172a', '--float': '#111c33', '--text': '#1b2438', '--text-dim': '#243049' });
checkTrue('深底深字：护栏出手', dark.adjustments.length >= 2, dark.adjustments);
check('深底深字：全部组合达标', dark.bad.map(([f, b]) => `${f}@${b}`), []);
checkTrue('深底深字：文字被提亮', C.parseColor(dark.merged['--text']).r > 60, dark.merged['--text']);

const ok = runGuard({ '--panel': '#0f172a', '--text': '#e2e8f7', '--text-dim': '#93a3bf' });
check('正常主题：零改动（不能有假阳性）', ok.adjustments.length, 0);
check('正常主题：token 原样保留', ok.tokens, { '--panel': '#0f172a', '--text': '#e2e8f7', '--text-dim': '#93a3bf' });

const multi = runGuard({ '--panel': '#f5f6f7', '--float': '#eceef1', '--chrome': '#ffffff' });
const textAdj = multi.adjustments.filter((a) => a.token === '--text');
check('同一个前景色只产出**一条**修正（多底色一次解出）', textAdj.length, 1);
checkTrue('那条修正覆盖了多个底色', String(textAdj[0].on).split(' / ').length >= 3, textAdj[0]);

console.log();
if (failures.length) {
  console.error(`FAIL (${failures.length} 项，通过 ${passed} 项)`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`PASS: 对比度与精修护栏（算法标准值 / alpha 合成 / 色相保留 / 三场景 / 多底色一次解）共 ${passed} 项`);
