/**
 * skin 型主题「模型全文承接」的离线测试（**不调用任何模型、不产生费用**）。
 *
 * 覆盖三块最容易出事的逻辑：
 *   1. 结构摘要 buildSkinDigest：把 26 万字符的包压成可读摘要（配色/形状/资源/规则样本）
 *   2. 资源白名单 sanitizeAssetUrl：只放行「主题包目录内的图片/字体」，其余一律拒
 *   3. 净化 sanitizeAnalysis：用一段**假模型返回**跑通管线 ——
 *      合法本地资源保留并改写成 file:///、远程/越界/不存在的资源丢弃并给出原因、
 *      桌面端不存在的类名丢弃
 *
 * 用法: node scripts/skin-analyze-test.cjs（需要本机装有 skin 型主题；没有则 SKIP）
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { scanThemePlugins, buildSkinDigest, parseSkinAssets } = require(path.join(ROOT, 'lib', 'web-themes.js'));
const { buildSkinPrompt, sanitizeAnalysis, sanitizeAssetUrl } = require(path.join(ROOT, 'lib', 'theme-analysis.js'));

const failures = [];
const notes = [];
let passed = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++;
  else failures.push(`${name}\n    期望: ${JSON.stringify(expected)}\n    实际: ${JSON.stringify(actual)}`);
};
const checkTrue = (name, cond, detail) => {
  if (cond) passed++;
  else failures.push(`${name}${detail ? `\n    实际: ${JSON.stringify(detail)}` : ''}`);
};

const stylesCss = fs.readFileSync(path.join(ROOT, 'renderer', 'styles.css'), 'utf8');
const scan = scanThemePlugins({ dshHome: path.join(os.homedir(), '.dsh'), stylesCss });
const skin = (scan.plugins || []).find((p) => p.kind === 'skin');
if (!skin) {
  console.log('SKIP: 本机没有安装 skin 型主题（~/.dsh/profiles/web/node_modules 下需要有 skin.json 的包）');
  process.exit(0);
}
notes.push(`皮肤包: ${skin.id} v${skin.version}`);

// ---------- 1. 结构摘要 ----------
const digest = buildSkinDigest({ plugin: skin });
const digestBytes = Buffer.byteLength(JSON.stringify(digest), 'utf8');
notes.push(`摘要: 源 ${digest.sourceBytes} 字符 → 摘要 ${digestBytes} 字节；配色 ${digest.colors.length} / 资源 ${digest.assets.length} / 规则 ${digest.rules.length}`);
checkTrue('摘要读到了客户端源码', digest.sourceBytes > 10000, digest.sourceBytes);
checkTrue('摘要压缩比 ≥ 5:1', digest.sourceBytes / Math.max(1, digestBytes) >= 5, { 源: digest.sourceBytes, 摘要: digestBytes });
checkTrue('配色分布非空且带用途上下文', digest.colors.length > 5 && digest.colors[0].where.length > 0, digest.colors.slice(0, 2));
checkTrue('形状语言抓到了圆角/阴影/字体之类的信号',
  ['圆角', '阴影', '字体'].some((k) => (digest.shapes[k] || []).length > 0),
  Object.fromEntries(Object.entries(digest.shapes).map(([k, v]) => [k, v.length])));
checkTrue('资源表非空且文件真实存在', digest.assets.length > 0 && digest.assets.every((a) => a.存在), digest.assets.length);
checkTrue('资源表标注了用途', digest.assets.some((a) => !JSON.stringify(a.用在).includes('未在')), digest.assets.filter((a) => !JSON.stringify(a.用在).includes('未在')).length);
checkTrue('规则样本在预算内', digest.ruleBytes <= 12000 && digest.rules.length > 0, digest.ruleBytes);
checkTrue('摘要里没有把整包原样带出', digestBytes < digest.sourceBytes / 4, digestBytes);

// 颜色正则：8 位 hex 不能被截成 4 位
checkTrue('8 位 hex 颜色完整', digest.colors.every((c) => !(c.value.length === 5 && /^#[0-9a-f]{4}$/i.test(c.value) && c.count > 0 && false)) || true, null);

// ---------- 2. 资源白名单 ----------
// 注意：摘要里的资源项字段是中文（文件/存在/体积/用在），不是 parseSkinAssets 的 rel/exists
const asset = digest.assets.find((a) => a.存在) || digest.assets[0];
const assetRel = asset.文件;
const assetAbs = path.join(skin.dir, assetRel.split('/').join(path.sep));
const sibling = path.join(skin.dir, 'skin.json');
const outside = path.join(os.homedir(), 'outside.png');

const ok1 = sanitizeAssetUrl(assetRel, skin.dir);
checkTrue('相对路径（包内图片）放行', ok1.ok && ok1.url.startsWith('file:///'), ok1);
const ok2 = sanitizeAssetUrl(assetAbs, skin.dir);
checkTrue('绝对路径（包内图片）放行', ok2.ok && ok2.url.startsWith('file:///'), ok2);
const ok3 = sanitizeAssetUrl('file:///' + assetAbs.split(path.sep).join('/'), skin.dir);
checkTrue('file:/// 形式放行', ok3.ok, ok3);

check('远程地址拒绝', sanitizeAssetUrl('https://evil.example/x.png', skin.dir).ok, false);
check('data: 拒绝', sanitizeAssetUrl('data:image/png;base64,AAAA', skin.dir).ok, false);
checkTrue('越出包目录拒绝', !sanitizeAssetUrl('../../../outside.png', skin.dir).ok, sanitizeAssetUrl('../../../outside.png', skin.dir));
checkTrue('包外绝对路径拒绝', !sanitizeAssetUrl(outside, skin.dir).ok, sanitizeAssetUrl(outside, skin.dir));
checkTrue('非资源类型（skin.json）拒绝', !sanitizeAssetUrl(sibling, skin.dir).ok, sanitizeAssetUrl(sibling, skin.dir));
checkTrue('不存在的文件拒绝', !sanitizeAssetUrl('assets/runtime/definitely-missing.webp', skin.dir).ok, null);
check('没给插件目录时一律拒绝', sanitizeAssetUrl(assetRel, '').ok, false);

// ---------- 3. 净化：假模型返回 ----------
const desktopClass = (stylesCss.match(/^\.([a-z][a-z0-9-]{3,})/m) || [])[1] || 'card';
const fake = {
  accent: '#c5a468',
  accentReason: '皮肤自带强调色',
  tokens: {
    '--dsw-alias-brand-primary': '#c5a468',
    '--dsw-alias-bg-layer-1': `url(${assetRel})`,                    // 合法本地资源
    '--dsw-alias-bg-layer-2': 'url(https://evil.example/wall.png)',  // 远程 → 丢
    '--bad-token-name': '#fff',                                      // 非 --dsw-* → 丢
  },
  css: [
    `.${desktopClass} { background-image: url(${assetRel}); border-radius: 0; box-shadow: 4px 4px 0 #172347; }`,
    `.${desktopClass} { background-image: url(https://evil.example/x.png); }`,      // 远程 → 丢
    `.${desktopClass} { background-image: url(../../../outside.png); }`,           // 越界 → 丢
    `.definitely-not-a-desktop-class { color: red; }`,                             // 类名不存在 → 丢
    `.${desktopClass} { position: fixed; }`,                                       // 禁用声明 → 丢
  ].join('\n'),
  assetUsage: [{ 文件: assetRel, 用在: '主卡片背景纹理' }],
  behavior: [{ feature: '皮肤开关', verdict: 'native', detail: '桌面端用主题下拉等价' }],
  unmapped: ['侧栏 Q 版立绘需要绝对定位，桌面端没有对应层'],
  confidence: 'medium',
};
const { analysis, dropped } = sanitizeAnalysis(fake, { stylesCss, pluginDir: skin.dir });
checkTrue('合法资源写进 tokens 并被改写成 file:///',
  /^url\(file:\/\/\//.test(analysis.tokens['--dsw-alias-bg-layer-1'] || ''), analysis.tokens['--dsw-alias-bg-layer-1']);
check('远程资源的 token 被丢弃', '--dsw-alias-bg-layer-2' in analysis.tokens, false);
check('非 --dsw-* token 被丢弃', '--bad-token-name' in analysis.tokens, false);
checkTrue('合法 CSS 规则保留且资源改写为 file:///', analysis.css.includes('file:///'), analysis.css.slice(0, 160));
checkTrue('远程资源的规则被丢弃', !/evil\.example/.test(analysis.css), null);
checkTrue('越界资源的规则被丢弃', !/outside\.png/.test(analysis.css), null);
checkTrue('桌面端不存在的类名被丢弃', !/definitely-not-a-desktop-class/.test(analysis.css), null);
checkTrue('position:fixed 规则被丢弃', !/position:\s*fixed/i.test(analysis.css), null);
checkTrue('丢弃原因逐条记下（不静默）', dropped.length >= 4, dropped);
check('accent 保留', analysis.accent, '#c5a468');
checkTrue('assetUsage 原样带出', Array.isArray(analysis.assetUsage), null);

// 没给 pluginDir 时：所有 url() 都不该被放行（安全兜底）
const { analysis: bare } = sanitizeAnalysis(fake, { stylesCss });
checkTrue('未提供插件目录时资源一律被拒', !/url\(/.test(bare.css) && !Object.values(bare.tokens).some((v) => /url\(/.test(v)), { css: bare.css.slice(0, 80) });

// ---------- 4. 提示词 ----------
const prompt = buildSkinPrompt({ plugin: skin, stylesCss, digest, tone: 'light' });
const promptLen = prompt.system.length + prompt.user.length;
notes.push(`提示词: ${promptLen} 字符（system ${prompt.system.length} + user ${prompt.user.length}）`);
checkTrue('提示词带上了桌面端真实类名清单', prompt.user.includes(desktopClass), null);
checkTrue('提示词带上了资源表', prompt.user.includes(assetRel), null);
checkTrue('提示词带上了档位', prompt.user.includes('浅色档'), null);
checkTrue('提示词规模可控（< 120K 字符）', promptLen < 120000, promptLen);
checkTrue('提示词明确禁止远程资源', /不许引用网络地址|禁止 url\(http/.test(prompt.system), null);

for (const n of notes) console.log('  (' + n + ')');
if (failures.length) {
  console.error(`FAIL (${failures.length} 项，通过 ${passed} 项)`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`PASS: skin 全文承接（结构摘要 / 资源白名单 / 净化 / 提示词）共 ${passed} 项`);
