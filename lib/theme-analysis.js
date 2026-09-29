'use strict';

/**
 * 主题兼容分析（Theme compatibility analysis）—— 用用户已配置的模型解析主题包源码
 *
 * ## 为什么需要模型
 *
 * `lib/web-themes.js` 的免费路径能覆盖**有确定答案**的部分：89 个 token 逐字节搬过来、
 * 结构层的形状意图（圆角/边框/阴影/按压）抽成策略、能对上号的 WebUI 类名翻译成桌面端类名。
 *
 * 剩下三类东西没有确定答案，硬编码只会瞎猜：
 *   1. **翻译表没收录的 WebUI 类名**（比如 `_badge`、某个作者自造的 `_tagPill`）——
 *      要判断它在桌面端最接近哪个组件，只能看声明内容猜语义。
 *   2. **档位语义错配**：官方 `--dsw-alias-brand-primary` 的语义是"用户自定义强调色"，
 *      默认值是近黑/近白；而桌面端 `--accent` 是**填充色**。主题没声明它的时候，
 *      桌面端按钮会变成近黑 —— 得从主题自己的色族里派生一个可用的强调色。
 *   3. **行为层**：主题包 `client.js` 里的交互（切换、持久化、第三方插件适配）哪些
 *      在桌面端**天然就有**、哪些**无法承接**，需要按语义判断并明确告诉用户。
 *
 * 所以模型只做这三件事，其余一律不经过它 —— 免费路径已经确定的部分，绝不让模型重算
 * （既省 token，也避免它把对的改错）。
 *
 * ## 安全边界
 *
 * 发给模型的是**主题包的静态文本**（CSS、变量表、行为清点）。不执行、不 require。
 * 模型返回的内容只当**数据**用：
 *   · `css` 字段会被主进程做一轮 CSS 卫生检查（见 `sanitizeCss`）后才落盘
 *   · 选择器必须能通过桌面端验证器（类名不存在的一律丢弃）
 *   · `tokens` 的 key 必须是 `--dsw-*`，值必须是颜色/长度这类字面量，不可能是 `url(...)`
 *
 * @module lib/theme-analysis
 */

const { chatOnce } = require('./llm-call.js');
const { buildSelectorVerifier, collectDesktopClasses, ELEMENT_SELECTOR_RE } = require('./web-themes.js');

/** 分析结果的 JSON Schema 描述（写在提示里，让模型照抄形状）。 */
const OUTPUT_SHAPE = `{
  "accent": "可选，桌面端强调色。仅当该主题的 --dsw-alias-brand-primary 缺失或是灰阶（近黑/近白）时才填，从主题自己的色族里派生（优先 --dsw-alias-brand-primary-new-colorprimary-new-color，其次 --dsw-alias-state-business-primary，再次 --dsw-alias-button-primary-fill）。其它情况留空字符串。",
  "accentReason": "为什么这么派生，一句话",
  "tokens": { "--dsw-*": "值" },
  "css": "字符串，追加的桌面端 CSS。只为下面「未映射」清单里的规则补译，写不出就留空字符串。禁止用 url()、@import、position:fixed、display:none。",
  "behavior": [ { "feature": "功能名", "verdict": "carried|native|unavailable", "detail": "说明" } ],
  "unmapped": [ "仍无法承接的项，一句话" ],
  "confidence": "high|medium|low"
}`;

const SYSTEM = `你是 DeepSeek Harness 桌面端（Electron）的主题迁移工程师。

背景：WebUI 主题包只有「配色变量表 + 针对 WebUI CSS-Module 类名的 CSS」。桌面端是另一套 DOM
结构（类名完全不同）和另一套 CSS 变量。已经有一条免费路径自动完成了有确定答案的搬运，
你的任务是处理**没有确定答案**的部分。

绝对规则：
1. 只输出 JSON，不要任何解释文字、不要 markdown 围栏。
2. 不要复述输入里已经确定的映射，也不要"顺手优化"没让你改的东西。
3. 你**不知道**桌面端长什么样，所以不要凭空编造类名。下面给了桌面端真实存在的类名清单，
   你写的选择器里每一个类名都必须在这份清单里出现，否则会被系统丢弃。
4. 拿不准就留空并在 unmapped 里说明。宁可少做，不可瞎猜。
5. 不写 url()、@import、@font-face、position:fixed、display:none、pointer-events:none。`;

/**
 * 构造分析请求。
 *
 * @param {object} o
 * @param {object} o.plugin       扫描结果里的 plugin（含 behavior / schemes）
 * @param {string} o.stylesCss    桌面端 styles.css（用来抽出"真实存在的类名"给模型参考）
 * @param {object} o.migration    免费路径已生成的部分（让模型知道哪些已完成、哪些没翻译动）
 */
function buildAnalysisPrompt({ plugin, stylesCss = '', migration }) {
  // 给模型看的"可用类名"必须是**独立类名**（见 collectDesktopClasses 的注释），
  // 否则它会照着 `.bad` / `.active` 这种状态修饰类写规则。
  const knownClasses = [...collectDesktopClasses(stylesCss)].sort().join(' ');

  const tokenPair = migration && migration.tokens ? migration.tokens : {};
  const facts = {
    主题包: { id: plugin.id, version: plugin.version, 来源: plugin.source },
    方案标签: migration && migration.label ? migration.label : plugin.schemes.map((s) => s.label).join(' / '),
    该档变量总数: Object.keys(tokenPair).length,
    关键变量: pickKeyTokens(tokenPair),
    免费路径已完成的翻译: migration ? migration.css : '(无)',
    免费路径留下的说明: (migration && migration.notes) || [],
    结构层形状策略: (migration && migration.shapePolicy) || plugin.shapePolicy || {},
    行为层静态清点: plugin.behavior,
    未映射的原始选择器: describeUnmapped(plugin),
  };

  const user = `## 桌面端真实可用的类名（你写的选择器只能用这些）
${knownClasses}

## 桌面端可用的 CSS 变量（可以直接引用）
--void --bg --nebula-navy --abyss --deep --deep-2 --deep-3 --panel --panel-hover --float --chrome
--border --border-strong --border-muted --border-heavy --border-inverted --text --text-dim --text-caption
--dust --starlight --accent --accent-2 --accent-3 --accent-soft --on-accent --warn --ok --danger --info
--code-bg --inline-code-bg --scroll-hover-l1 --scroll-hover-l2 --sidebar-fill --nav-item-active
--nav-item-active-accent --nav-item-hover --bubble-bg --bubble-highlight --input-bg --menu-bg --selector-bg
--tip-bg --mask-drop --skeleton --gradient-nebula --gradient-aurora --gradient-horizon

## 主题包事实
\`\`\`json
${JSON.stringify(facts, null, 1)}
\`\`\`

## 请输出（严格 JSON，不要围栏）
${OUTPUT_SHAPE}`;

  return { system: SYSTEM, user };
}

/** 挑出最能说明配色意图的十几个变量，避免把 89 行全塞进去。 */
function pickKeyTokens(tokens) {
  const keys = [
    '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2',
    '--dsw-alias-border-l2', '--dsw-alias-border-l4', '--dsw-alias-border-inverted',
    '--dsw-alias-brand-primary', '--dsw-alias-brand-primary-invert',
    '--dsw-alias-brand-primary-new-colorprimary-new-color',
    '--dsw-alias-button-primary-fill', '--dsw-alias-button-contrast-fill',
    '--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-caption',
    '--dsw-alias-state-business-primary', '--dsw-alias-state-error-primary', '--dsw-alias-state-warning-primary',
    '--dsw-alias-markdown-code-block', '--dsw-alias-markdown-inline-code',
    '--dsw-specific-sidebar-fill', '--dsw-specific-bubble', '--dsw-specific-menu', '--dsw-specific-tip',
  ];
  const out = {};
  for (const k of keys) if (tokens[k]) out[k] = tokens[k];
  return out;
}

/** 从"免费路径没翻译动的规则"里提炼给模型看的信息。 */
function describeUnmapped(plugin) {
  const out = [];
  for (const n of (plugin && plugin.__unmapped) || []) out.push(n);
  return out.length ? out : '(免费路径已全部翻译，或未收集到清单)';
}

/**
 * 校验并净化模型返回的分析结果。
 *
 * 三道过滤，逐道都会把丢弃的东西记进 `dropped` 而不是静默吞掉：
 *   1. `tokens` 只接受 `--dsw-*` 键 + 安全字面量值（禁 url/expression/var 以外的函数）
 *   2. `css` 逐条规则检查选择器（类名必须在 styles.css 里真实存在）+ 禁用的声明
 *   3. `accent` 必须是合法颜色
 */
function sanitizeAnalysis(raw, { stylesCss = '' } = {}) {
  const dropped = [];
  const out = { accent: '', accentReason: '', tokens: {}, css: '', behavior: [], unmapped: [], confidence: 'low' };
  if (!raw || typeof raw !== 'object') return { analysis: out, dropped: ['返回值不是对象'] };

  if (typeof raw.accent === 'string' && raw.accent.trim()) {
    const a = raw.accent.trim();
    if (/^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/i.test(a) && !/url|expression|var\(/i.test(a)) out.accent = a;
    else dropped.push(`accent 不是合法颜色：${a.slice(0, 40)}`);
  }
  if (typeof raw.accentReason === 'string') out.accentReason = raw.accentReason.slice(0, 300);
  if (typeof raw.confidence === 'string' && /^(high|medium|low)$/i.test(raw.confidence.trim())) {
    out.confidence = raw.confidence.trim().toLowerCase();
  }

  if (raw.tokens && typeof raw.tokens === 'object') {
    for (const [k, v] of Object.entries(raw.tokens)) {
      if (!/^--dsw-[a-z0-9-]+$/.test(k)) { dropped.push(`token 名不合法：${String(k).slice(0, 40)}`); continue; }
      if (typeof v !== 'string' || !v.trim()) { dropped.push(`token ${k} 的值不是非空字符串`); continue; }
      const val = v.trim();
      if (/url\(|expression\(|@import|;|\{|\}/i.test(val)) { dropped.push(`token ${k} 的值含禁用内容`); continue; }
      if (val.length > 120) { dropped.push(`token ${k} 的值过长`); continue; }
      out.tokens[k] = val;
    }
  }

  const verify = buildSelectorVerifier(stylesCss);
  const cssIn = typeof raw.css === 'string' ? raw.css : '';
  const kept = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(cssIn)) !== null) {
    const rawSel = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const body = m[2].trim();
    if (!rawSel || !body) continue;
    if (/url\(|@import|expression\(/i.test(body)) { dropped.push(`规则含禁用声明：${rawSel.slice(0, 60)}`); continue; }
    const decls = body.split(';').map((d) => d.trim()).filter(Boolean).filter((d) => {
      if (/^(position\s*:\s*fixed|display\s*:\s*none|pointer-events\s*:\s*none)/i.test(d)) {
        dropped.push(`规则含禁用声明「${d.slice(0, 40)}」（${rawSel.slice(0, 40)}）`);
        return false;
      }
      return true;
    });
    if (!decls.length) continue;
    const sels = rawSel.split(',').map((s) => s.trim()).filter(Boolean).filter((s) => {
      const classes = [...s.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((x) => x[1]);
      if (classes.length === 0) return ELEMENT_SELECTOR_RE.test(s.replace(/^[\s>+~]+/, ''));
      return classes.every((c) => verify('.' + c));
    });
    if (!sels.length) { dropped.push(`选择器在桌面端不存在：${rawSel.slice(0, 60)}`); continue; }
    kept.push(`${[...new Set(sels)].join(', ')} { ${decls.join('; ')} }`);
  }
  out.css = kept.join('\n');

  if (Array.isArray(raw.behavior)) {
    out.behavior = raw.behavior.slice(0, 30).map((b) => ({
      feature: String((b && b.feature) || '').slice(0, 80),
      verdict: /^(carried|native|unavailable)$/.test(String((b && b.verdict) || '')) ? b.verdict : 'unavailable',
      detail: String((b && b.detail) || '').slice(0, 300),
    })).filter((b) => b.feature);
  }
  if (Array.isArray(raw.unmapped)) {
    out.unmapped = raw.unmapped.slice(0, 30).map((s) => String(s).slice(0, 200)).filter(Boolean);
  }
  return { analysis: out, dropped };
}

/**
 * 跑一次兼容分析。
 *
 * @param {object} o
 * @param {string} o.baseURL
 * @param {string} [o.apiKey]
 * @param {string} o.model
 * @param {object} o.plugin
 * @param {string} o.stylesCss
 * @param {object} o.migration
 * @param {number} [o.timeoutMs]
 * @param {(line:string)=>void} [o.onProgress]
 */
async function analyzeTheme({ baseURL, apiKey, model, plugin, stylesCss, migration, timeoutMs = 180000, onProgress }) {
  const log = (l) => { try { if (onProgress) onProgress(l); } catch { /* 界面已关 */ } };
  const { system, user } = buildAnalysisPrompt({ plugin, stylesCss, migration });
  log(`分析请求：${(system.length + user.length)} 字符 → ${model}`);

  const res = await chatOnce({
    baseURL,
    apiKey,
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    maxTokens: 4096,
    temperature: 0,
    jsonMode: true,
    timeoutMs,
  });
  if (!res.ok) return { ok: false, error: res.error };

  let raw = res.json;
  if (raw === undefined) {
    const { tryParseJson } = require('./llm-call.js');
    raw = tryParseJson(res.content);
  }
  if (raw === undefined) {
    return { ok: false, error: '模型没有返回可解析的 JSON', raw: String(res.content).slice(0, 800) };
  }
  const { analysis, dropped } = sanitizeAnalysis(raw, { stylesCss });
  // `dropped` 必须**同时**挂在 analysis 里：界面拿顶层那份做预览，
  // 而安装时渲染层只把 `analysis` 交给 theme:install —— 净化记录不能在这里断链
  // （断链的表现是「丢弃了 4 处」这件事永远进不了主题库的 notes，静默无感）。
  const carried = { ...analysis, dropped };
  log(`分析完成：tokens ${Object.keys(analysis.tokens).length} 条 / css ${analysis.css.split('\n').length} 行 / 丢弃 ${dropped.length} 处`);
  return { ok: true, analysis: carried, dropped, usage: res.usage, model };
}

module.exports = { buildAnalysisPrompt, sanitizeAnalysis, analyzeTheme, OUTPUT_SHAPE };
