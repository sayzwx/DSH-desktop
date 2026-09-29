'use strict';

/**
 * WebUI 主题包解析与迁移（Web UI theme pack reader / migrator）
 *
 * ## 背景：一个 DSH WebUI 主题包到底由什么组成
 *
 * 实测（`dsh-neo-skin@0.6.0`）把主题包拆开，它是**四层**叠出来的，不是"一张配色表"：
 *
 *   1. **token 层** —— `ctx.theme.overrideTokens(SOURCE, tokens)`，89 个 `--dsw-*` 变量，
 *      每个都是 `{ light, dark }` 双档。这是配色主体（78 个 alias 语义层 + 11 个 specific 组件层）。
 *   2. **结构层** —— 一段硬编码 CSS 字符串（`STRUCTURE_CSS`），写成 `[class*="_card"]` 这类
 *      WebUI CSS-Module 类名选择器，干的是「圆角清零 / 边框加粗 / 硬阴影 / 按压位移」。
 *      它还改 4 个形状 token（`--dsw-shadow-lv1/lv1-blur/lv2/lv3`）。
 *   3. **方案层** —— 每个 scheme 自带一段 CSS（`SCHEMES[id].css`），修结构层顾及不到的地方
 *      （典型：浅色档侧栏是深蓝底，但 DSH 用共用的 `--dsw-alias-label-*` 上色，必须单独提亮）。
 *   4. **行为层** —— 客户端 JS 逻辑：开/关、方案切换、注册设置行、把开关写 localStorage。
 *
 * ## 桌面端怎么接
 *
 * 第 1 层 → `renderer/styles.css` 的 `:root[data-theme="webtheme"]` 承接层（已就绪）。
 * 第 2/3 层 → 需要**类名翻译**：WebUI 的 `[class*="_sessionRow"]` 在桌面端不存在，
 *            对应的桌面端类名是 `.chat-session`。本模块给出一张**可验证的**翻译表：
 *            翻译结果里的每个桌面端类名都必须真的出现在 `renderer/styles.css` 里，
 *            验证不过的一律不翻译、只记进 notes —— 宁可少做，不可瞎映射。
 * 第 4 层 → 桌面端原生就有主题下拉 + localStorage 持久化，所以行为层落点是
 *            「一个 scheme × 一个档位 = 一个桌面端主题条目」，无需移植代码。
 *
 * ## 安全边界（重要）
 *
 * 本模块**只读文件、只做静态字面量提取**，绝不 `require` / `eval` / 执行第三方代码。
 * `client.js` 里的 `SCHEMES` 与 `STRUCTURE_CSS` 都是标准 JSON 字面量（构建产物），
 * 用「字符串感知的括号配对」取出文本后交给 `JSON.parse` —— 这是纯粹的文本解析。
 *
 * @module lib/web-themes
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/** 桌面端「一档」的取值；官方主题包固定这两档。 */
const TONES = ['light', 'dark'];

/** 主题包必备的变量前缀 —— 出现任意一个即认为这个包带主题能力。 */
const THEME_VAR_RE = /--dsw-(?:alias|specific)-[a-z0-9-]+\s*:/;

// ============================================================ 字面量静态提取

/**
 * 从 `text[start]` 处的 `{` / `[` 开始，返回配平到对应闭合符的片段。
 * 字符串字面量内的括号不计入深度（`client.js` 里大量 CSS 字符串含 `{}`，
 * 不处理字符串引号会让配平立刻失效）。
 */
function balancedSlice(text, start) {
  const open = text[start];
  if (open !== '{' && open !== '[') return null;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < text.length) {
        if (text[i] === '\\') i++;
        else if (text[i] === quote) break;
        i++;
      }
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** 找到 `const <name> = ...` 之后的第一个 `{` / `[` 并取配平片段。 */
function literalAfter(text, decl, open) {
  const at = text.indexOf(decl);
  if (at < 0) return null;
  const brace = text.indexOf(open, at + decl.length);
  if (brace < 0) return null;
  return balancedSlice(text, brace);
}

/**
 * 从 `client.js` 里静态取出 `SCHEMES` 与 `STRUCTURE_CSS`。
 *
 * `SCHEMES` 是构建期填进去的 JSON 对象字面量（`{ id: { label, css, tokens } }`），
 * 可直接 `JSON.parse`；`STRUCTURE_CSS` 是 `[ "…", … ].join("\n")` 的字面量数组。
 *
 * @returns {{schemes: object, structureCss: string, how: string}|null}
 */
function parseClientBundle(clientSrc) {
  if (typeof clientSrc !== 'string' || clientSrc.length === 0) return null;

  let schemes = null;
  const schemesLit = literalAfter(clientSrc, 'const SCHEMES', '{');
  if (schemesLit) {
    try {
      const parsed = JSON.parse(schemesLit);
      if (parsed && typeof parsed === 'object') schemes = parsed;
    } catch { /* 不是 JSON 形状（可能用了单引号），下一路兜底 */ }
  }

  let structureCss = '';
  const structLit = literalAfter(clientSrc, 'const STRUCTURE_CSS', '[');
  if (structLit) {
    try {
      const arr = JSON.parse(structLit);
      if (Array.isArray(arr)) structureCss = arr.join('\n');
    } catch { /* 同上 */ }
  }

  if (!schemes && !structureCss) return null;
  return { schemes: schemes || {}, structureCss, how: 'client.js' };
}

/**
 * 兜底：直接读源码目录（`src/schemes/<id>.tokens.json` + `<id>.meta.json` + `<id>.css`）。
 * 发布到 npm 的包普遍带 `src/`（`files` 字段里列了），所以这条路基本都能走通。
 */
function parseSchemeDir(pkgDir) {
  const dir = path.join(pkgDir, 'src', 'schemes');
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const schemes = {};
  for (const f of entries) {
    if (!f.endsWith('.tokens.json')) continue;
    const id = f.slice(0, -'.tokens.json'.length);
    let tokens;
    try {
      tokens = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch { continue; }
    let label = id;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, id + '.meta.json'), 'utf8'));
      if (meta && typeof meta.label === 'string' && meta.label) label = meta.label;
    } catch { /* meta 缺失就用 id 当标签 */ }
    let css = '';
    try {
      css = fs.readFileSync(path.join(dir, id + '.css'), 'utf8');
    } catch { /* 有的方案不带 css */ }
    schemes[id] = { label, css, tokens };
  }
  return Object.keys(schemes).length ? { schemes, structureCss: '', how: 'src/schemes' } : null;
}

/** 归一化一个 scheme：只保留 `{light,dark}` 双档的字符串值。 */
function normalizeScheme(raw) {
  const tokens = {};
  const flat = {};
  const meta = { singles: [], malformed: [] };
  const src = raw && typeof raw.tokens === 'object' && raw.tokens ? raw.tokens : {};
  for (const [key, val] of Object.entries(src)) {
    if (!/^--dsw-[a-z0-9-]+$/.test(key)) continue;
    if (typeof val === 'string') {
      meta.singles.push(key);
      continue;
    }
    if (!val || typeof val !== 'object') {
      meta.malformed.push(key);
      continue;
    }
    const tones = {};
    for (const tone of TONES) {
      const v = val[tone];
      if (typeof v === 'string' && v.trim()) tones[tone] = v.trim();
    }
    if (Object.keys(tones).length === 0) {
      meta.malformed.push(key);
      continue;
    }
    for (const [tone, v] of Object.entries(tones)) {
      (flat[tone] || (flat[tone] = {}))[key] = v;
    }
    tokens[key] = tones;
  }
  return {
    id: String(raw && raw.id ? raw.id : ''),
    label: String((raw && raw.label) || (raw && raw.id) || ''),
    css: typeof (raw && raw.css) === 'string' ? raw.css : '',
    tokens,
    flat,
    meta,
  };
}

// ============================================================ 行为层静态清点

/**
 * 从 `client.js` 源码里清点**行为能力**（不做任何解释，只列出证据）。
 *
 * 这一步是给两处用的：
 *   · 界面上的「能力清单」（让用户知道这个主题包含什么，免费）
 *   · 模型兼容分析的输入（把"要分析什么"先缩小到有证据的部分，省 token）
 */
function inventoryBehavior(clientSrc) {
  const s = typeof clientSrc === 'string' ? clientSrc : '';
  const has = (re) => re.test(s);
  const storageKeys = [...new Set([...s.matchAll(/localStorage\.setItem\(\s*([A-Za-z_$][\w$]*)\s*,/g)].map((m) => m[1]))];
  const storageValues = [...new Set([...s.matchAll(/STORAGE_KEY\s*=\s*"([^"]+)"/g)].map((m) => m[1]))];
  const services = [...new Set([...s.matchAll(/ctx\.(?:inject|slots|locale|theme|effect|settings|http|log|fs|route)\b/g)].map((m) => m[0]))];
  const slots = [...new Set([...s.matchAll(/slots\.(?:inject|register)\(\s*"([^"]+)"/g)].map((m) => m[1]))];
  const externals = [...new Set([...s.matchAll(/require\(\s*"([^"]+)"/g)].map((m) => m[1]))];
  return {
    toggle: has(/enabled/),
    schemeSwitch: has(/setScheme|SCHEME_KEY|scheme\b/),
    structureLayer: has(/STRUCTURE_CSS|createStructureStyle/),
    settingsRow: has(/slots\.(inject|register)/),
    persistence: storageKeys.length > 0 || storageValues.length > 0,
    storageKeys: [...storageKeys, ...storageValues],
    themeApi: [...new Set([...s.matchAll(/ctx\.theme\.(\w+)/g)].map((m) => m[1]))],
    services,
    slots,
    externals,
    resourceHints: {
      backgroundImage: has(/backgroundImage|background-image/),
      backgroundVideo: has(/<video|\.mp4|videoUrl/),
      font: has(/@font-face|fontFamily\s*:\s*"/),
      wallpaper: has(/wallpaper|wallpaperUrl/),
      webgpuCanvas: has(/webgpu|WebGPU|getContext\(\s*"webgpu"/),
      pet: has(/桌宠|pet|waifu|sprite/i),
    },
    // 第三方插件的适配（主题包常顺手修别人的 CSS 兼容问题）
    thirdPartyAdapters: [...new Set([...s.matchAll(/\.([a-z][a-z0-9]{1,7})_[a-z]{3,12}\b/g)].map((m) => m[0]))].slice(0, 20),
  };
}

/**
 * 行为层落点结论（免费路径，不调模型）。
 *
 * 主题包的「行为层」是一段客户端 JS：开关、方案切换、注册设置行、localStorage 持久化。
 * 桌面端不是同一套 DOM，也不能跑第三方 JS，所以这里不"执行"它，而是把它的每项能力
 * **逐条给出落点**——用户至少要知道"哪件事在桌面端由什么承担、哪件事没有落点"，
 * 而不是装完之后对这个主题的行为一无所知。
 *
 * 判断依据全是源码里静态可读的事实，加上桌面端自身的事实（下拉即开关、设置页是自有 DOM、
 * CSP 的 `img-src` 不含 `file:`），因此**不需要模型**。模型只在"这条 WebUI 类名落到哪"
 * 这类没有确定答案的地方兜底。
 *
 * @param {object} b inventoryBehavior() 的结果
 */
function summarizeBehavior(b) {
  const held = [];        // 桌面端原生承担
  const unavailable = []; // 桌面端无落点
  const resources = [];   // 资源层，明确不迁移

  if (b.toggle) held.push('开 / 关');
  if (b.schemeSwitch) held.push('方案切换');
  if (b.structureLayer) held.push('结构层样式');
  if (b.persistence) {
    held.push(`选择记忆（localStorage${b.storageKeys.length ? '：' + b.storageKeys.slice(0, 2).join(' / ') : ''}）`);
  }
  if (b.themeApi.length) held.push(`token 覆盖（ctx.theme.${b.themeApi.join(' / ')}）`);

  if (b.settingsRow) {
    unavailable.push(`把设置行注册进 WebUI 通用设置${b.slots.length ? `（slot：${b.slots.slice(0, 2).join(' / ')}）` : ''}`);
  }
  if (b.thirdPartyAdapters.length) {
    unavailable.push(`对第三方插件的 CSS 适配（${b.thirdPartyAdapters.slice(0, 3).join(' / ')}）`);
  }

  const rh = b.resourceHints;
  if (rh.backgroundImage) resources.push('背景图');
  if (rh.backgroundVideo) resources.push('背景视频');
  if (rh.wallpaper) resources.push('壁纸');
  if (rh.font) resources.push('自定义字体');
  if (rh.webgpuCanvas) resources.push('WebGPU 画布');
  if (rh.pet) resources.push('桌宠 / 精灵图');

  return { held, unavailable, resources };
}

/** 把 summarizeBehavior 的结果压成给用户看的 note（没有内容的段直接不出现）。 */
function behaviorNote(sum) {
  const parts = [];
  if (sum.held.length) {
    parts.push(
      `行为层：${sum.held.join(' / ')} → 桌面端原生承担`
      + '（每个方案档位就是一个独立下拉项：选中即启用、切走即停用，选择记在 localStorage 的 dsh-theme 里）',
    );
  }
  if (sum.unavailable.length) {
    parts.push(
      `行为层无法承接：${sum.unavailable.join('；')}`
      + '——桌面端设置页是自有 DOM，插件没有注入点，也不会执行主题包里的 JS',
    );
  }
  if (sum.resources.length) {
    parts.push(
      `资源层未迁移（${sum.resources.join(' / ')}）`
      + '：桌面端 CSP 的 img-src 不含 file:，壁纸与星域由 starfield.js 独占',
    );
  }
  return parts;
}

// ============================================================ WebUI 类名 → 桌面端类名

/**
 * WebUI CSS-Module 类名 → 桌面端候选选择器。
 *
 * 命名规律：WebUI 的模块类名是 `_<camelCase>`（带 hash 后缀），所以主题包用
 * `[class*="_sessionRow"]` 这种"忽略 hash"的写法。桌面端类名是 kebab-case 的语义名。
 *
 * **表中每一项都要过 `verifySelector`**：候选里凡是在 `renderer/styles.css` 找不到的
 * 一律剔除；某条映射全部候选都找不到时，该条整体视为"未翻译"，只写进 notes。
 * 这样表可以随便扩，但不会产出指向空气的规则。
 */
const WEB_CLASS_MAP = {
  _card: { desktop: ['.card', '.modal-body', '.cmd-panel', '.ct-model-panel', '.actions-card'], note: '卡片 / 弹层主体' },
  _panel: { desktop: ['.card', '.modal-body', '.cmd-panel'], note: '面板' },
  _bubble: { desktop: ['.msg-user', '.msg-assistant', '.msg'], note: '消息气泡' },
  _code: { desktop: ['.msg-md pre', '.msg-md code'], note: '代码块' },
  _option: { desktop: ['.ct-mi', '.cmd-item'], note: '列表选项' },
  _callRow: { desktop: ['.msg-tool', '.tr-tool'], note: '工具调用行' },
  _notice: { desktop: ['.msg-notice', '.badge'], note: '提示条' },
  _selector: { desktop: ['.ct-model-panel', '.cmd-panel'], note: '下拉选择器' },
  _workspace: { desktop: ['.cs-ws', '.ct-ws'], note: '工作区条目' },
  _sectionHeader: { desktop: ['.cs-label', '.chat-sessions-head'], note: '分组标题' },
  _sectionLabel: { desktop: ['.cs-label', '.chat-sessions-head'], note: '分组标签' },
  _sessionRow: { desktop: ['.chat-session', '.cmd-item'], note: '会话行' },
  _projectRow: { desktop: ['.cs-ws', '.chat-session'], note: '项目行' },
  _searchResultRow: { desktop: ['.cs-search-msg', '.cs-result'], note: '搜索结果行' },
  _iconButton: { desktop: ['.mini-btn', '.copy-btn', '.cs-collapse', '.cs-del'], note: '图标按钮' },
  _crumb: { desktop: [], note: '面包屑（桌面端无对应组件）' },
  _crumbBar: { desktop: [], note: '面包屑栏（桌面端无对应组件）' },
};

/** 无类名的选择器（元素 / 伪类）—— 这类选择器在两端是同一种语言，直接放行。 */
const ELEMENT_SELECTOR_RE = /^(?:html|body|:root|button|input|textarea|select|option|a|pre|code|table|thead|tbody|th|td|tr|main|form|label|h[1-6]|p|hr|img|svg|ul|ol|li|blockquote)\b/;

/**
 * 抽出桌面端**真实存在的类名**集合。
 *
 * 不能简单地全文 `\.(\w+)` 匹配 —— 那样会把状态修饰类也算成"存在的类名"：
 * `.mt-exit.bad` 里的 `bad`、`.nav-btn.active` 里的 `active` 都会被当成可用目标，
 * 于是模型写 `.bad { ... }` 也能通过校验，但它其实只是 `.mt-exit` 的附属状态。
 *
 * 正确做法：只从**选择器前导段**取类名，且要求它前面是分隔符（起点 / 空白 / `>` `+` `~`）。
 * 这样 `.mt-exit.bad` 只贡献 `mt-exit`，`active` 不会被收录。
 */
function collectDesktopClasses(cssText) {
  // 先压平 at-rule 前导（`@media (...) {` → `{`），否则嵌套规则的「前导段」里会带上 @media 文本
  const flat = String(cssText || '')
    .replace(/@[a-zA-Z-]+[^{;]*\{/g, '{')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const known = new Set();
  const ruleRe = /([^{}]*)\{([^{}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(flat)) !== null) {
    for (const sel of m[1].split(',')) {
      for (const cm of sel.matchAll(/(^|[\s>+~])(\.[a-zA-Z][a-zA-Z0-9_-]*)/g)) known.add(cm[2].slice(1));
    }
  }
  return known;
}

/** 桌面端类名是否存在（在 styles.css 里作为类名 token 出现过）。 */
function buildSelectorVerifier(cssText) {
  const known = collectDesktopClasses(cssText);
  return (selector) => {
    const classes = [...selector.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1]);
    if (classes.length === 0) return ELEMENT_SELECTOR_RE.test(selector.replace(/^[\s>+~]+/, ''));
    return classes.every((c) => known.has(c));
  };
}

/**
 * 把一段 WebUI 选择器翻译成桌面端选择器。
 * @returns {{selectors: string[], unmapped: string[], notes: string[]}}
 */
function translateSelector(selectorList, verify) {
  const out = [];
  const unmapped = [];
  const notes = [];
  for (const raw of selectorList.split(',')) {
    // `:not([class*="_selected"])` 这类限定不属于"要找的组件"，先剥掉再取类名，
    // 否则会把 _selected 当成一个未知组件类名报出来（实测就是这样误报的）。
    const sel = raw.trim().replace(/:not\([^)]*\)/g, '').trim();
    if (!sel) continue;
    const hits = [...sel.matchAll(/\[class\*=\\?["']?_?([A-Za-z][A-Za-z0-9]*)\\?["']?\]/g)].map((m) => m[1]);
    const keys = hits.length ? hits.map((h) => '_' + h) : [];
    if (keys.length === 0) {
      // 不是 web 类名选择器（可能是 :root / body / button 等通用选择器）—— 这类选择器
      // 在桌面端同样有效，直接原样保留（主题包常用 body 设字体/背景）。
      if (verify(sel)) out.push(sel);
      else unmapped.push(sel);
      continue;
    }
    const targets = [];
    for (const k of keys) {
      const map = WEB_CLASS_MAP[k];
      if (!map) {
        unmapped.push(sel);
        notes.push(`未知 WebUI 类名 ${k}（翻译表暂无此条）`);
        continue;
      }
      const ok = map.desktop.filter(verify);
      if (ok.length === 0) {
        unmapped.push(sel);
        notes.push(`${k}（${map.note}）在桌面端没有可用落点`);
        continue;
      }
      targets.push(...ok);
    }
    if (targets.length) out.push([...new Set(targets)].join(', '));
  }
  return { selectors: out, unmapped, notes };
}

// ============================================================ 结构层 → 形状策略

/**
 * 从结构层 CSS 里**抽取形状意图**，而不是逐字搬运选择器。
 *
 * 结构层的写法（`[class*="_card"]{border-radius:0}`）在桌面端整体不可用，
 * 但它的**意图**是通用且可翻译的：圆角清零、边框加粗、硬阴影、按压位移。
 * 抽取成策略后用桌面端选择器重写，比逐条硬搬可靠得多。
 */
function extractShapePolicy(structureCss) {
  const css = String(structureCss || '');
  const policy = {
    zeroRadius: /border-radius\s*:\s*0/.test(css),
    borderWidth: null,
    press: null,
    hardShadow: null,
    shadowTokens: {},
  };
  const bw = /border-width\s*:\s*(\d+(?:\.\d+)?)px/.exec(css);
  if (bw) policy.borderWidth = Number(bw[1]);

  // 按压位移：表达式本身可移植（`:active` + `transform: translate(Npx, Mpx)`），
  // 只有选择器不可移植，所以这里只取位移量，选择器由桌面端自己给。
  const pr = /:active[^{]*\{[^}]*transform\s*:\s*translate\(\s*(-?\d+(?:\.\d+)?)px\s*,\s*(-?\d+(?:\.\d+)?)px\s*\)/.exec(css);
  if (pr) policy.press = { dx: Number(pr[1]), dy: Number(pr[2]) };

  // 硬阴影：一条规则里可能同时有「常态」和「按下」两个 box-shadow（实测 neo-skin 是
  // 4px 常态 / 1px 按下），取偏移量最大的那个作为常态阴影。
  const hardShadows = [...css.matchAll(/box-shadow\s*:\s*(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+0\s+(?:var\((--dsw-[a-z0-9-]+)\)|([^;!}]+))/gi)]
    .map((m) => ({
      dx: Number(m[1]),
      dy: Number(m[2]),
      colorVar: m[3] || null,
      colorLiteral: (m[4] || '').trim() || null,
      mag: Math.abs(Number(m[1])) + Math.abs(Number(m[2])),
    }))
    .filter((h) => h.dx > 0 && h.dy > 0);
  if (hardShadows.length) {
    hardShadows.sort((a, b) => b.mag - a.mag);
    const best = hardShadows[0];
    policy.hardShadow = { dx: best.dx, dy: best.dy, colorVar: best.colorVar, colorLiteral: best.colorLiteral };
  }

  for (const m of css.matchAll(/--dsw-shadow-lv[\w-]*\s*:\s*([^;]+);/g)) {
    const name = /--dsw-shadow-lv[\w-]*/.exec(m[0])[0];
    policy.shadowTokens[name] = m[1].trim();
  }
  return policy;
}

/**
 * 把形状策略渲染成桌面端 CSS。
 *
 * 桌面端的落点选择偏保守：只覆盖「一眼能看出是这个主题风格」的容器与按钮，
 * 不做全站 `*` 通配（那会连滚动条、徽标、细粒度控件一起压平，反而失真）。
 * 阴影色一律走 `--border-heavy`（已由承接层映射到主题的 `border-l4`），
 * 这样深浅档换色时硬阴影里的白/黑边会自动跟着走。
 */
function renderShapeCss(policy, verify) {
  const lines = [];
  const containers = ['.card', '.modal-body', '.cmd-panel', '.ct-model-panel'].filter(verify);
  const bubbles = ['.msg-user', '.msg-assistant'].filter(verify);
  const controls = ['button', '.mini-btn', '.primary-btn', '.nav-btn', '.copy-btn'].filter(verify);
  const codeBlocks = ['.msg-md pre', '.msg-md code'].filter(verify);

  if (policy.zeroRadius) {
    const all = [...new Set([...containers, ...bubbles, ...controls, ...codeBlocks])];
    if (all.length) {
      lines.push(`/* 结构层：圆角清零（源主题声明 border-radius:0） */`);
      lines.push(`${all.join(', ')} { border-radius: 0 !important; }`);
    }
  }
  if (policy.borderWidth) {
    const bw = [...new Set([...containers, ...bubbles])];
    if (bw.length) {
      lines.push(`/* 结构层：边框加粗 ${policy.borderWidth}px */`);
      lines.push(`${bw.join(', ')} { border-width: ${policy.borderWidth}px !important; }`);
    }
  }
  if (policy.press) {
    const pc = controls;
    if (pc.length) {
      lines.push(`/* 结构层：按压位移 ${policy.press.dx}px, ${policy.press.dy}px */`);
      lines.push(`${pc.map((s) => s + ':active').join(', ')} { transform: translate(${policy.press.dx}px, ${policy.press.dy}px) !important; }`);
    }
  }
  if (policy.hardShadow) {
    const color = policy.hardShadow.colorVar ? `var(--border-heavy)` : (policy.hardShadow.colorLiteral || 'var(--border-heavy)');
    const targets = [...new Set([...containers, ...bubbles])];
    if (targets.length) {
      lines.push(`/* 结构层：硬阴影 ${policy.hardShadow.dx}px ${policy.hardShadow.dy}px 0（源色 ${policy.hardShadow.colorVar || policy.hardShadow.colorLiteral} → --border-heavy） */`);
      lines.push(`${targets.join(', ')} { box-shadow: ${policy.hardShadow.dx}px ${policy.hardShadow.dy}px 0 ${color} !important; }`);
    }
  }
  return lines.join('\n');
}

/** 把 scheme 自己的 CSS（第 3 层）按选择器逐条翻译，翻译不动的原样保留并记 notes。 */
function translateSchemeCss(cssText, verify) {
  const css = String(cssText || '');
  const notes = [];
  const kept = [];
  const dropped = [];
  // 极简 CSS 规则切分：按 `}` 拆出「选择器 { 声明 }」，本层输入都是主题作者手写的短 CSS
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(css)) !== null) {
    const rawSel = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const body = m[2].trim();
    if (!rawSel || !body) continue;
    const t = translateSelector(rawSel, verify);
    notes.push(...t.notes);
    if (t.selectors.length === 0) {
      dropped.push(rawSel.replace(/\s+/g, ' ').slice(0, 90));
      continue;
    }
    // 一条规则里的多个 web 选择器可能翻译到同一批桌面端选择器（实测：会话行/项目行/搜索结果行
    // 都会命中 .chat-session），必须在规则级去重，否则拼出一串重复选择器。
    const merged = [...new Set(t.selectors.flatMap((s) => s.split(',').map((x) => x.trim())).filter(Boolean))];
    kept.push(`${merged.join(', ')} { ${body} }`);
  }
  return { css: kept.join('\n'), dropped, notes: [...new Set(notes)] };
}

// ============================================================ 扫描本机主题插件

/** 插件可能落地的目录（profile 装插件、引擎自带、pnpm 全局）。 */
function pluginRoots({ dshHome, harnessDir } = {}) {
  const home = dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const roots = [
    path.join(home, 'profiles', 'web', 'node_modules'),
    path.join(home, 'profiles', 'node_modules'),
  ];
  if (harnessDir) {
    roots.push(path.join(harnessDir, 'node_modules'));
    roots.push(path.join(harnessDir, '..', 'node_modules'));
  }
  return [...new Set(roots)];
}

/** 读一个 npm 包目录的 package.json（只收有 `dsh.client` 的包）。 */
function readPluginManifest(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (!pkg || typeof pkg.name !== 'string') return null;
    const client = pkg.dsh && pkg.dsh.client;
    if (!client || typeof client !== 'object') return null;
    return { pkg, client };
  } catch {
    return null;
  }
}

/**
 * 扫描本机已安装的 WebUI 插件，挑出**带主题能力**的那些。
 *
 * 判定标准（三道，全部可解释）：
 *   1. `package.json` 有 `dsh.client`（是个客户端插件，不是纯宿主插件）
 *   2. `dsh.client.platform` 为 `web`（它的效果长在 WebUI 上）
 *   3. 它的 `client.js` 或 `src/schemes/*.tokens.json` 里出现 `--dsw-alias-*` / `--dsw-specific-*`
 *      （带主题 token；纯功能插件没有这些）
 *
 * @param {{dshHome?:string,harnessDir?:string,disabled?:string[],stylesCss?:string}} opts
 * @returns {{ok:boolean, roots:string[], plugins:Array, scanned:number, skipped:Array}}
 */
function scanThemePlugins({ dshHome, harnessDir, disabled = [], stylesCss = '' } = {}) {
  const roots = pluginRoots({ dshHome, harnessDir });
  const verify = buildSelectorVerifier(stylesCss);
  const plugins = [];
  const skipped = [];
  const seen = new Set();
  let scanned = 0;

  for (const root of roots) {
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory() && !e.isSymbolicLink()) continue;
      if (e.name.startsWith('.')) continue;
      const dirs = [];
      if (e.name.startsWith('@')) {
        // scope 包：@scope/name
        const scopeDir = path.join(root, e.name);
        try {
          for (const sub of fs.readdirSync(scopeDir, { withFileTypes: true })) {
            if (sub.isDirectory() || sub.isSymbolicLink()) dirs.push(path.join(scopeDir, sub.name));
          }
        } catch { /* 忽略 */ }
      } else {
        dirs.push(path.join(root, e.name));
      }

      for (const dir of dirs) {
        scanned++;
        const man = readPluginManifest(dir);
        if (!man) continue;
        const id = man.pkg.name;
        if (seen.has(id)) continue;
        if (man.client.platform !== 'web') {
          skipped.push({ id, reason: `platform=${man.client.platform || '(未声明)'}，不是 WebUI 插件` });
          continue;
        }

        // 取主题资产：client.js 优先（那是真正跑起来的产物），源码目录兜底
        const clientPath = path.join(dir, 'client.js');
        let clientSrc = '';
        try {
          clientSrc = fs.readFileSync(clientPath, 'utf8');
        } catch { /* 没有 client.js 是允许的：可能只有 src/schemes */ }

        const fromClient = parseClientBundle(clientSrc);
        const fromSrc = parseSchemeDir(dir);
        const src = fromClient && Object.keys(fromClient.schemes).length ? fromClient : (fromSrc || fromClient);

        if (!src || Object.keys(src.schemes || {}).length === 0) {
          const hasVar = THEME_VAR_RE.test(clientSrc);
          skipped.push({ id, reason: hasVar ? '有主题变量但解析不出 scheme 列表' : '不含 --dsw-alias-* 主题 token（纯功能插件）' });
          continue;
        }

        const schemes = Object.entries(src.schemes).map(([sid, raw]) => {
          const n = normalizeScheme(Object.assign({ id: sid }, raw));
          return {
            id: n.id || sid,
            label: n.label || sid,
            tokenCount: Object.keys(n.tokens).length,
            tones: TONES.filter((t) => n.flat[t] && Object.keys(n.flat[t]).length > 0),
          };
        }).filter((s) => s.tokenCount > 0);

        if (schemes.length === 0) {
          skipped.push({ id, reason: 'scheme 里没有可用的 {light,dark} 双档变量' });
          continue;
        }

        seen.add(id);
        const structureCss = (src.structureCss || '').length ? src.structureCss : '';
        const policy = extractShapePolicy(structureCss);
        plugins.push({
          id,
          version: man.pkg.version || '',
          description: man.pkg.description || '',
          author: typeof man.pkg.author === 'string' ? man.pkg.author : (man.pkg.author && man.pkg.author.name) || '',
          homepage: typeof man.pkg.homepage === 'string' ? man.pkg.homepage : '',
          dir,
          root,
          platform: 'web',
          enabled: !disabled.includes(id),
          source: src.how,
          hasClientJs: clientSrc.length > 0,
          schemes,
          shapePolicy: policy,
          behavior: inventoryBehavior(clientSrc),
          cssRuleCount: (src.schemes && src.schemes[schemes[0].id] && src.schemes[schemes[0].id].css ? 1 : 0),
          verifyOk: typeof verify === 'function',
        });
      }
    }
  }

  plugins.sort((a, b) => a.id.localeCompare(b.id));
  return { ok: true, roots, plugins, scanned, skipped };
}

/**
 * 迁移一个 scheme 的一个档位 → 桌面端主题载荷。
 *
 * 免费路径（不调模型）：token 层 + 结构层策略 + 方案 CSS 的类名翻译。
 * 输出的 `css` 可以直接塞进 `data-theme="webtheme"` 下的一次性样式表。
 *
 * @param {object} o
 * @param {object} o.plugin     scanThemePlugins 里的一个 plugin
 * @param {string} o.schemeId
 * @param {'light'|'dark'} o.tone
 * @param {string} o.stylesCss  桌面端 styles.css 全文（用于验证映射目标是否存在）
 */
function buildMigration({ plugin, schemeId, tone, stylesCss = '' }) {
  if (!TONES.includes(tone)) throw new Error(`tone 必须是 light / dark，收到 ${tone}`);
  const verify = buildSelectorVerifier(stylesCss);

  const clientPath = path.join(plugin.dir, 'client.js');
  let clientSrc = '';
  try {
    clientSrc = fs.readFileSync(clientPath, 'utf8');
  } catch { /* 用源码目录 */ }
  const parsed = parseClientBundle(clientSrc) || parseSchemeDir(plugin.dir) || { schemes: {}, structureCss: '' };
  const raw = parsed.schemes[schemeId];
  if (!raw) throw new Error(`主题包 ${plugin.id} 里找不到 scheme「${schemeId}」`);

  const scheme = normalizeScheme(Object.assign({ id: schemeId }, raw));
  const tokens = scheme.flat[tone] || {};
  if (Object.keys(tokens).length === 0) throw new Error(`scheme「${schemeId}」没有 ${tone} 档变量`);

  const policy = extractShapePolicy(parsed.structureCss || '');
  const shapeCss = renderShapeCss(policy, verify);
  const schemeCss = translateSchemeCss(scheme.css, verify);

  const notes = [];
  // 行为层先交代清楚：它替用户回答"这个主题的开关 / 方案切换在桌面端该去哪点"，
  // 而这些结论全是静态可读的事实，不该花模型的钱去做。
  const behavior = summarizeBehavior(plugin.behavior || inventoryBehavior(clientSrc));
  notes.push(...behaviorNote(behavior));
  // 档位语义错配警戒：官方浅色档 brand-primary 是近黑、深色档是近白（它表示"用户自定义强调色"），
  // 而桌面端 --accent 是填充色。外部主题若没声明 brand-primary，--accent 会变成近黑 → 按钮不可见。
  const bp = tokens['--dsw-alias-brand-primary'];
  if (!bp) {
    notes.push('该档未声明 --dsw-alias-brand-primary：桌面端 --accent 将回落到官方档位默认值'
      + `（${tone === 'light' ? '近黑 rgb(15,17,21)' : '近白 rgb(249,250,251)'}）。`
      + '若按钮/强调色看起来"没上色"，请在兼容分析里让模型从品牌色变体派生一个可用强调色。');
  } else if (isAchromatic(bp)) {
    notes.push(`该档的 --dsw-alias-brand-primary 是灰阶值 ${bp}（官方语义是"用户自定义强调色"，默认成黑白），`
      + '桌面端 --accent 是填充色，用它会让按钮失去识别度。建议在兼容分析里派生。');
  }
  if (policy.zeroRadius || policy.borderWidth || policy.press || policy.hardShadow) {
    notes.push(`结构层已翻译为形状策略：${[
      policy.zeroRadius ? '圆角清零' : '',
      policy.borderWidth ? `边框 ${policy.borderWidth}px` : '',
      policy.hardShadow ? `硬阴影 ${policy.hardShadow.dx}px ${policy.hardShadow.dy}px 0` : '',
      policy.press ? `按压位移 ${policy.press.dx},${policy.press.dy}` : '',
    ].filter(Boolean).join(' / ')}`);
  }
  if (schemeCss.dropped.length) {
    notes.push(`方案 CSS 有 ${schemeCss.dropped.length} 条规则在桌面端找不到落点（可用模型兼容分析补译）：`
      + schemeCss.dropped.slice(0, 3).join(' | '));
  }
  notes.push(...schemeCss.notes.slice(0, 6));

  const id = `${plugin.id}:${schemeId}:${tone}`;
  return {
    id,
    kind: 'webtheme',
    label: `${scheme.label} · ${tone === 'light' ? '浅色' : '深色'}`,
    origin: { plugin: plugin.id, version: plugin.version, scheme: schemeId, tone },
    createdAt: new Date().toISOString(),
    tokens,
    tokenCount: Object.keys(tokens).length,
    shapePolicy: policy,
    behavior,
    css: [shapeCss, schemeCss.css].filter(Boolean).join('\n\n'),
    notes,
  };
}

/** 灰阶判定：三通道极差很小即视为"没有色相"。支持 `rgb()/rgba()` 与 `#rrggbb`。 */
function isAchromatic(color) {
  const s = String(color).trim();
  let r; let g; let b;
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(s);
  if (m) {
    r = Number(m[1]); g = Number(m[2]); b = Number(m[3]);
  } else {
    const h = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s);
    if (!h) return false;
    r = parseInt(h[1], 16); g = parseInt(h[2], 16); b = parseInt(h[3], 16);
  }
  return Math.max(r, g, b) - Math.min(r, g, b) < 12;
}

module.exports = {
  TONES,
  WEB_CLASS_MAP,
  ELEMENT_SELECTOR_RE,
  balancedSlice,
  literalAfter,
  parseClientBundle,
  parseSchemeDir,
  normalizeScheme,
  inventoryBehavior,
  summarizeBehavior,
  behaviorNote,
  collectDesktopClasses,
  buildSelectorVerifier,
  translateSelector,
  translateSchemeCss,
  extractShapePolicy,
  renderShapeCss,
  pluginRoots,
  scanThemePlugins,
  buildMigration,
  isAchromatic,
};
