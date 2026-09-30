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
 * 主题包自带的图片/字体能不能引用），因此**不需要模型**。模型只在"这条 WebUI 类名落到哪"
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
      + '：图片/字体现在可以引用主题包内的文件（CSP 已放行 file:），动态壁纸仍由 starfield.js 独占',
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

/**
 * 读一个 npm 包目录的 package.json。
 *
 * 原先要求**必须有 `dsh.client`** —— 但全量审计（市场 287 个主题类插件）发现有一批主题包
 * 只声明了 `dsh.bundle.patch`（cordis.patch.yml），没有 `dsh.client`，于是**连扫描的资格都没有**，
 * 用户装了也永远搜不到（实测：dsh-vae-theme / dsh-wallpaper-engine / beauticode-dsh 等）。
 * 现在放宽为：只要有 package.json 就返回，`client` 允许为空 ——
 * 由调用方按「**有没有客户端产物源码**」来判断是不是 WebUI 插件（比"必须声明"更贴合现实）。
 */
function readPluginManifest(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (!pkg || typeof pkg.name !== 'string') return null;
    const client = (pkg.dsh && pkg.dsh.client) || null;
    return { pkg, client };
  } catch {
    return null;
  }
}

/**
 * 读官方「皮肤生态」包的 skin.json（存在即返回对象，否则 null）。
 *
 * 这类包与 token 型主题（dsh-neo-skin 那种 client.js 内嵌 SCHEMES 变量表）是**两套格式**：
 *   - skin.json：{ id, name, accent, bodyAttr, preview:{light,dark}, dshCompatibility, ... }
 *   - 样式：client.js 在 <body> 挂 bodyAttr 属性并注入一整段 CSS，选择器是 WebUI 专属类名，
 *     **不含 --dsw-alias-* token** —— 所以 token 路径的扫描会把它们误判成「纯功能插件」。
 */
function readSkinManifest(dir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'skin.json'), 'utf8'));
    if (!raw || typeof raw.id !== 'string' || !raw.id.trim()) return null;
    return raw;
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
        // 平台判定：优先信声明；**没声明就看有没有客户端产物源码** ——
        // 市场里有一批主题包只有 cordis.patch.yml，不写 dsh.client（实测至少 5 个真主题），
        // 旧逻辑会直接把它们跳过，用户装了也搜不到。
        // 取主题资产：客户端产物（真正跑起来的产物）+ 包内 css 文件（CSS 文件型主题的全部内容）。
        // 入口可能是根 client.js（token 型）、lib/client.js（skin 包）、bundle/client.js（Cordis 插件），
        // 见 readPluginClientSource；css 文件见 collectPackageCss。
        const clientSrc = readPluginClientSources(dir).src;
        const cssText = collectPackageCss(dir).map((c) => c.text).join('\n');
        const allText = clientSrc + '\n' + cssText;
        let platformInferred = false;
        if (!man.client) {
          const probeSrc = readPluginClientSources(dir).src + cssText;
          if (!probeSrc.trim()) {
            skipped.push({ id, reason: '没有 dsh.client 声明，也读不到客户端产物源码' });
            continue;
          }
          man.client = { platform: 'web' };
          platformInferred = true;
        }
        if (man.client.platform !== 'web') {
          skipped.push({ id, reason: `platform=${man.client.platform || '(未声明)'}，不是 WebUI 插件` });
          continue;
        }


        // skin 型主题（官方皮肤生态）：识别为独立 kind，**不能**落进 token 路径 ——
        // 那会在下面被误报成「纯功能插件」，用户就永远迁不了它（2026-09-29 用户装了
        // @smalltailqwq/dsh-client-ui-skin-maid-atelier 后反馈「装了也搜不到」）。
        const skinMeta = readSkinManifest(dir);
        if (skinMeta) {
          seen.add(id);
          const skinId = skinMeta.id.trim();
          const accent = typeof skinMeta.accent === 'string' ? skinMeta.accent.trim() : '';
          plugins.push({
            id,
            version: man.pkg.version || '',
            description: skinMeta.description || man.pkg.description || '',
            author: skinMeta.author || (typeof man.pkg.author === 'string' ? man.pkg.author : '') || '',
            homepage: man.pkg.homepage || '',
            dir,
            root,
            platform: 'web',
            platformInferred,
            enabled: !disabled.includes(id),
            source: 'skin.json',
            kind: 'skin',
            hasClientJs: clientSrc.length > 0,
            skin: {
              skinId,
              name: skinMeta.name || skinMeta.nameEn || skinId,
              tagline: skinMeta.tagline || '',
              accent,
              bodyAttr: typeof skinMeta.bodyAttr === 'string' ? skinMeta.bodyAttr : '',
              previewLight: skinMeta.preview && skinMeta.preview.light ? path.join(dir, skinMeta.preview.light) : '',
              previewDark: skinMeta.preview && skinMeta.preview.dark ? path.join(dir, skinMeta.preview.dark) : '',
            },
            // 一个 skin 包 = 一个方案（浅/深两档由 skin 自己的样式管，桌面端按官方档位打底）
            schemes: [{
              id: skinId,
              label: skinMeta.name || skinMeta.nameEn || skinId,
              tokenCount: accent ? 1 : 0,
              tones: ['light', 'dark'],
            }],
            shapePolicy: {},
            behavior: inventoryBehavior(clientSrc),
            verifyOk: typeof verify === 'function',
          });
          continue;
        }

        // 官方包（@deepseek-ai/*：client 组件、web-frontend、brand、cordis 运行时…）
        // 是 **WebUI 自己的组成部分**，不是可迁移的主题包 —— 它们也会引用 --dsw-*、data-theme
        // （是 token 的**消费者**而不是定义者）。按"有没有 token 痕迹"判定会把 31 个官方组件
        // 全列成主题（实测踩到）。放在 skin 分支**之后**：官方将来若出 skin 包（带 skin.json），
        // 仍会在上面被正常识别。
        if (/^@deepseek-ai\//.test(id)) {
          skipped.push({ id, reason: '官方 WebUI 客户端组件，不是可迁移的主题包' });
          continue;
        }

        // 三条解析路，从"知道结构"到"通用提取"依次退让：
        //   ① 字面量 SCHEMES（parseClientBundle）
        //   ② 源码目录 src/schemes/*.tokens.json（parseSchemeDir）
        //   ③ **通用变量提取**：任何 `--dsw-*` 键都捞，值可以是对象字面量 / pair(x) 这类
        //      简单 helper 调用 / 裸字面量 / CSS 文本；按最近的 overrideTokens('ns' 之类分组。
        //      这一条是为「插件写法千奇百怪」准备的 —— 市场里的 Cordis 插件形态
        //      （ctx.theme.overrideTokens）本来完全扫不到。
        const resolved = resolveSchemeSource({ dir });
        let src = Object.keys(resolved.schemes || {}).length ? resolved : null;
        if (src) src.clientSrc = allText;   // 行为清点仍要看 JS 源码，但提取要用合并文本

        // 提不出变量表，但看得出来是个主题包（有 --dsw- 痕迹 / 调了主题 API / 自带皮肤资源）：
        // 不丢进"纯功能插件"里埋掉，而是标成**通用型** —— 免费路径给不了东西，
        // 但可以走「模型读整包结构再做承接」，总比用户看到"搜不到"强。
        if (!src || Object.keys(src.schemes || {}).length === 0) {
          // 真正的主题包信号：**调用主题注册 API**（写 token），或名字/描述就说是主题/皮肤。
          const registersTheme = /theme\s*\.\s*(?:overrideTokens|registerTheme|defineTheme|addTheme|registerTokens)\s*\(/.test(clientSrc);
          // 「像主题」的判据：**看代码证据，不看名字**。
          // 试过两版都不对：按名字/描述放宽（theme|skin|背景|壁纸|字体|品牌…）会把
          // dsh-tool-bash / @shikijs/themes / dsh-jobs 拉进来（描述里出现 background/font 太常见）；
          // 只看"注入样式 + 有外观 CSS"也不行 —— dshmarket（市场管理器）给自己面板写样式同样命中。
          // 最终判据是**页面级**证据：
          //   ① 调主题注册 API（写 token），或
          //   ② 在 body/html/:root 上写背景图 / 定义 --dsw-*（改整个页面的底，而不是自己组件的样式），或
          //   ③ 注入样式 + 自带图片资源（壁纸型皮肤的写法）
          const stylesPageBackground = /(body|html|:root)[^{}]{0,40}\{[^{}]{0,600}?(background-image|background\s*:[^;{}]*(url|--dsw-|--void|--bg)|--dsw-[a-z0-9-]+\s*:)/.test(allText);
          const injectsStyle = /createElement\(\s*['"]style['"]\s*\)|insertRule\s*\(|adoptedStyleSheets|setProperty\(\s*['"]--/.test(clientSrc);
          const hasImageAsset = (() => {
            try {
              if (!fs.statSync(path.join(dir, 'assets')).isDirectory()) return false;
              return fs.readdirSync(path.join(dir, 'assets'), { recursive: true })
                .some((f) => /\.(png|jpe?g|webp|gif|avif)$/i.test(String(f)));
            } catch { return false; }
          })();
          const hasPreset = (() => {
            try { return fs.readdirSync(dir, { recursive: true }).some((f) => /\.tczp$/i.test(String(f))); } catch { return false; }
          })();
          const looksThemeish = registersTheme || stylesPageBackground || hasPreset || (injectsStyle && hasImageAsset);
          if (looksThemeish) {
            seen.add(id);
            plugins.push({
              id,
              version: man.pkg.version || '',
              description: man.pkg.description || '',
              author: typeof man.pkg.author === 'string' ? man.pkg.author : (man.pkg.author && man.pkg.author.name) || '',
              homepage: typeof man.pkg.homepage === 'string' ? man.pkg.homepage : '',
              dir,
              root,
              platform: 'web',
              platformInferred,
              enabled: !disabled.includes(id),
              source: '通用（无变量表）',
              kind: 'generic',
              hasClientJs: clientSrc.length > 0,
              clientEntry: readPluginClientSource(dir).file || '',
              skin: null,
              schemes: [{ id: 'default', label: man.pkg.name.replace(/^@[^/]+\//, ''), tokenCount: 0, tones: ['light', 'dark'] }],
              shapePolicy: {},
              behavior: inventoryBehavior(clientSrc),
              verifyOk: typeof verify === 'function',
            });
            continue;
          }
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
          platformInferred,
          enabled: !disabled.includes(id),
          source: src.how,
          kind: 'tokens',
          clientEntry: readPluginClientSource(dir).file || '',
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
/**
 * **统一的"从插件里解析出变量表"入口** —— 扫描、迁移、模型分析三处共用，避免各写一份
 * 退让逻辑（历史问题：buildMigration 里硬编码读 `<包>/client.js`，而 Cordis 插件形态的
 * 入口在 `bundle/client.js`，于是扫描认得、迁移却报"找不到 scheme"）。
 *
 * 三条路依次退让：
 *   ① SCHEMES 字面量（parseClientBundle）
 *   ② 源码目录 src/schemes/*.tokens.json（parseSchemeDir）
 *   ③ 通用变量提取（parseTokenMapsFromSource）
 *
 * @returns {{schemes:Object, structureCss:string, how:string, clientSrc:string, file:string}}
 */
function resolveSchemeSource(plugin) {
  const dir = plugin && plugin.dir;
  const { src: clientSrc, file } = readPluginClientSources(dir);
  // 包内的 css 文件也是主题内容源（CSS 文件型主题的全部内容就在那里）
  const cssFiles = collectPackageCss(dir);
  const cssText = cssFiles.map((c) => c.text).join('\n');
  const allText = clientSrc + '\n' + cssText;
  const fromClient = parseClientBundle(clientSrc);
  if (fromClient && Object.keys(fromClient.schemes || {}).length) {
    return { ...fromClient, clientSrc, file, how: 'client.js' };
  }
  const fromSrc = parseSchemeDir(dir);
  if (fromSrc && Object.keys(fromSrc.schemes || {}).length) {
    return { ...fromSrc, clientSrc, file, how: 'src/schemes' };
  }
  const generic = parseTokenMapsFromSource(allText);
  if (generic) return { ...generic, structureCss: '', clientSrc: allText, file, cssFiles };
  return { schemes: {}, structureCss: '', how: 'none', clientSrc: allText, file, cssFiles };
}

/**
 * 把主题包的页面级背景图翻译成桌面端的 #themeBg 规则（免费路径）。
 * @returns {{css:string, note:string}|null}
 */
function buildBackgroundCss(plugin, clientSrc) {
  let bg = null;
  try {
    bg = detectPageBackground(clientSrc, plugin && plugin.dir);
  } catch { /* 读不到就算了，不阻断迁移 */ }
  if (!bg) return null;
  const isData = /^data:image\//i.test(bg.url);
  const fileUrl = isData ? bg.url : fileUrlOf(bg.file);
  const decls = bg.decls.split(bg.url).join(fileUrl);   // 虚拟路径 → 包内文件的 file:// URL
  const css = '/* 背景图自动承接：原主题把这张图当页面底纹（' + bg.selector + ' 的 background-image），\n'
    + '   桌面端挂到 #themeBg —— data-theme="webtheme" 下 #bgvideo/#bgfx 会被隐藏，否则背景无处可挂 */\n'
    + '#themeBg { ' + decls + ' }';
  const name = isData ? '主题预设内嵌壁纸（data: URI）' : bg.file.split(path.sep).pop();
  const note = `背景图已自动承接：${name}（${(bg.size / 1024 / 1024).toFixed(1)}MB，原为 ${bg.selector} 的底纹）→ 桌面端 #themeBg`;
  return { css, note };
}

function buildMigration({ plugin, schemeId, tone, stylesCss = '' }) {
  if (!TONES.includes(tone)) throw new Error(`tone 必须是 light / dark，收到 ${tone}`);
  const verify = buildSelectorVerifier(stylesCss);

  const parsed = resolveSchemeSource(plugin);
  const clientSrc = parsed.clientSrc || '';
  const raw = parsed.schemes[schemeId];
  if (!raw) throw new Error(`主题包 ${plugin.id} 里找不到 scheme「${schemeId}」`);

  const scheme = normalizeScheme(Object.assign({ id: schemeId }, raw));
  const tokens = scheme.flat[tone] || {};
  if (Object.keys(tokens).length === 0) throw new Error(`scheme「${schemeId}」没有 ${tone} 档变量`);
  // 页面级背景图（免费承接，不花模型的钱）：皮肤的氛围几乎全靠它
  const background = buildBackgroundCss(plugin, parsed.clientSrc || clientSrc);

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
    css: [shapeCss, schemeCss.css, background && background.css].filter(Boolean).join('\n\n'),
    notes: background ? [...notes, background.note] : notes,
  };
}

/**
 * 找出主题包的**页面级背景图**，并解析成包内真实文件。
 *
 * 为什么值得单做（免费、确定、不花模型的钱）：皮肤/壁纸类主题的"氛围"几乎全靠这一张图，
 * 而它的写法是确定的 —— body/html 上的 `background-image`。实测 kimino：
 *   `body { background-image: linear-gradient(…), url('/kimino-bg/current.jpg') !important; … }`
 * 其中 `/kimino-bg/current.jpg` 是**运行期虚拟路径**（由宿主插件提供），
 * 包内真实文件是 `assets/current.jpg` —— 所以解析要按**文件名**兜底。
 *
 * @param {string} clientSrc 客户端产物源码
 * @param {string} pluginDir 主题包目录
 * @returns {{selector:string, decls:string, file:string, url:string}|null}
 */
function detectPageBackground(clientSrc, pluginDir) {
  if (!clientSrc || !pluginDir) return null;
  const BG_PROPS = ['background-image', 'background-size', 'background-position', 'background-repeat', 'background-attachment', 'background-blend-mode'];
  const candidates = [];
  const ruleRe = /(?:^|[\n;}])\s*(body(?:\[[^\]]{0,60}\])?|html|:root)\s*\{([^{}]{0,1600})\}/g;
  let m;
  while ((m = ruleRe.exec(clientSrc)) !== null) {
    const body = m[2];
    if (!/background-image\s*:\s*[^;]*url\(/i.test(body)) continue;
    const decls = {};
    for (const prop of BG_PROPS) {
      const mm = new RegExp(prop + '\\s*:\\s*([^;]{1,400})', 'i').exec(body);
      if (mm) decls[prop] = mm[1].replace(/\s*!important\s*$/i, '').replace(/\s+/g, ' ').trim();
    }
    const urls = [...(decls['background-image'] || '').matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)].map((x) => x[1]);
    for (const u of urls) candidates.push({ selector: m[1], decls, url: u, order: m.index });
  }
  // ⑤ 预设文件形态：*.tczp（第三方主题引擎 dsh-theme-customizer 的预设），
  //    JSON 里 areas.*.image.dataURI 内嵌壁纸（data: URI，CSP 放行，自包含无需包内文件）。
  //    实测 dsh-vae-theme：主题内容全在一个 theme.tczp 里，client.js 只是把它写进别的插件。
  //    🔴 必须在"没有 body 背景候选就提前返回"**之前**执行 —— 否则这类包永远走不到这里
  //    （踩过：提前 return 让 vae 的壁纸永远检不出来）。
  try {
    const stack = [{ d: path.resolve(pluginDir), depth: 0 }];
    while (stack.length) {
      const { d, depth } = stack.pop();
      let entries = [];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (depth < 3 && !/^(node_modules|\.git)$/.test(e.name)) stack.push({ d: p, depth: depth + 1 }); continue; }
        if (!/\.tczp$/i.test(e.name) || e.name.length > 60) continue;
        const st = fs.statSync(p);
        if (st.size > 8 * 1024 * 1024) continue;
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        for (const [areaKey, area] of Object.entries(j.areas || {})) {
          const du = area && area.image && area.image.dataURI;
          if (typeof du === 'string' && /^data:image\//i.test(du)) {
            candidates.push({
              selector: `tczp:${areaKey}`,
              // 🔴 decls 必须是**对象**（与 body 候选同形）—— 最终组装按 BG_PROPS 逐键取值，
              //    给字符串会得到空 decl（踩过：壁纸检出了却拼不出规则）。
              decls: {
                'background-image': `url(${du})`,
                'background-size': 'cover',
                'background-position': 'center',
                'background-repeat': 'no-repeat',
              },
              file: p, size: du.length, url: du.slice(0, 40) + '…',
            });
            break;   // 一个预设取一张主背景就够
          }
        }
      }
    }
  } catch { /* 预设解析失败不阻断 */ }
  if (!candidates.length) return null;

  const root = path.resolve(pluginDir);
  /** 把 URL（可能是虚拟路径 / 相对路径 / file://）解析成包内真实文件。 */
  const resolveInPackage = (u) => {
    const clean = String(u).split('?')[0].split('#')[0].replace(/^file:\/\//i, '');
    const base = path.basename(clean);
    if (!/\.(png|jpe?g|webp|gif|avif|bmp|svg)$/i.test(base)) return '';
    // ① 相对/绝对路径直接可用且真实存在
    if (!clean.startsWith('/')) {
      const direct = path.resolve(root, clean);
      if (direct.startsWith(root) && fs.existsSync(direct)) return direct;
    }
    // ② 按文件名在包内搜索（虚拟路径走这条）
    const stack = [{ d: root, depth: 0 }];
    while (stack.length) {
      const { d, depth } = stack.pop();
      let entries = [];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (e.isFile() && e.name === base) return path.join(d, e.name);
        if (e.isDirectory() && depth < 3 && !/^(node_modules|\.git)$/.test(e.name)) {
          stack.push({ d: path.join(d, e.name), depth: depth + 1 });
        }
      }
    }
    return '';
  };

  const resolved = [];
  for (const c of candidates) {
    // data: URI 候选（tczp 预设内嵌壁纸）是自包含的，不走包内文件解析 ——
    // 否则会被 resolveInPackage 当成"包里找不到的文件"丢掉（踩过：vae 的壁纸因此检不出来）。
    if (/^data:image\//i.test(c.url)) { resolved.push({ ...c, file: c.file || '', size: c.size || 0 }); continue; }
    const file = resolveInPackage(c.url);
    if (!file) continue;
    let size = 0;
    try { size = fs.statSync(file).size; } catch { /* ignore */ }
    resolved.push({ ...c, file, size });
  }
  if (!resolved.length) return null;
  // 多张时：优先 body/html 上的、其次体积最大的（页面底图通常最大）
  resolved.sort((a, b) => (Number(/^body/.test(b.selector)) - Number(/^body/.test(a.selector))) || (b.size - a.size));
  const best = resolved[0];
  const decl = BG_PROPS.filter((p) => best.decls[p]).map((p) => `${p}: ${best.decls[p]}`).join('; ');
  return { selector: best.selector, decls: decl, file: best.file, size: best.size, url: best.url };
}

/**
 * 把包内文件路径变成 CSS 可用的 file:// URL（正斜杠 + 编码）。
 */
function fileUrlOf(absPath) {
  return 'file:///' + encodeURI(String(absPath).split(path.sep).join('/'));
}

/**
 * 收集包内的 **CSS 文件**（第四种主题形态：主题就是一份/一组 css）。
 * 实测：deepseek-harness-hello-kitty-suite 的 `skin/skin/<id>/skin.css`、
 * dsh-theme-blackhole 的 `assets/blackhole.css` —— 它们的 client.js 里没有任何主题痕迹，
 * 主题内容全在 css 文件里。忽略 node_modules/.git，限 20 个文件 / 400KB。
 * @returns {Array<{rel:string,text:string}>}
 */
function collectPackageCss(dir) {
  const out = [];
  if (!dir) return out;
  const root = path.resolve(dir);
  const stack = [{ d: root, depth: 0 }];
  let bytes = 0;
  while (stack.length && out.length < 20) {
    const { d, depth } = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (out.length >= 20 || bytes > 400 * 1024) break;
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (depth < 4 && !/^(node_modules|\.git)$/.test(e.name)) stack.push({ d: p, depth: depth + 1 });
        continue;
      }
      if (!/\.css$/i.test(e.name)) continue;
      try {
        const text = fs.readFileSync(p, 'utf8');
        bytes += text.length;
        out.push({ rel: path.relative(root, p).split(path.sep).join('/'), text });
      } catch { /* 忽略读不了的 */ }
    }
  }
  return out;
}

/**
 * 抽桌面端**基础主题**（:root / :root[data-theme="dark"] 那个块）的变量默认值，
 * 并把 `var(--x)` 链解开一层到多层。给"精修对比度护栏"用：
 * 模型只改了底色、没给文字色时，护栏要能拿**默认文字色**去算对比度。
 *
 * `color-mix(...)` 这类无法静态求值的值原样保留（护栏那边解析不了会跳过该组合）。
 * @returns {Map<string,string>}
 */
function collectDesktopTokenDefaults(stylesCss) {
  const out = new Map();
  const src = String(stylesCss || '');
  // 基础块：从第一个 `:root` 起，到下一个 `}`（该块只放变量）
  const start = src.search(/:root\s*[,{]/);
  if (start < 0) return out;
  const open = src.indexOf('{', start);
  const close = src.indexOf('}', open);
  if (open < 0 || close < 0) return out;
  const block = src.slice(open + 1, close);
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out.set(m[1], m[2].trim());
  }
  // 解开 var() 链（最多 5 层，防止自引用死循环）
  const resolve = (v, depth = 0) => {
    if (depth > 5) return v;
    const mm = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]+))?\)$/i.exec(v.trim());
    if (!mm) return v;
    const next = out.get(mm[1]);
    if (next === undefined) return (mm[2] || '').trim() || v;
    return resolve(next, depth + 1);
  };
  for (const [k, v] of [...out]) out.set(k, resolve(v));
  return out;
}

/**
 * 桌面端**真实存在**的 CSS 变量名白名单（从 styles.css 抽）。
 *
 * 为什么需要：模型在做精修/承时时，经常会给出**桌面端自己的变量**（`--panel` / `--text` /
 * `--accent` …）而不是 `--dsw-*` —— 对没有对应官方 token 的观感来说，这恰恰是唯一正确的做法。
 * 但净化只认 `--dsw-*`，于是产出被整批丢弃（实测：kimino 的 14 条桌面端变量全被拒，
 * 用户看到的现象就是"精修了但没效果"）。
 *
 * @param {string} stylesCss
 * @returns {Set<string>} 不含 --dsw-*（那些走各自通道）
 */
function collectDesktopTokenNames(stylesCss) {
  const out = new Set();
  if (!stylesCss) return out;
  const re = /(--[a-z0-9-]+)\s*:/g;
  let m;
  while ((m = re.exec(stylesCss)) !== null) {
    if (!m[1].startsWith('--dsw-')) out.add(m[1]);
  }
  return out;
}

/**
 * 桌面端**真实存在**的元素 id 白名单（从 index.html 抽）。
 *
 * 用途：迁移过来的主题要挂静态背景图，得写 `#themeBg { background-image: … }` ——
 * 而净化原本只认"styles.css 里存在的类名"，`#id` 选择器一律被丢弃，
 * 于是模型即使写出了正确的背景规则也会被系统丢掉。
 *
 * @param {string} html index.html 全文
 * @returns {Set<string>}
 */
function collectDesktopIds(html) {
  const out = new Set();
  if (!html) return out;
  const re = /\sid="([A-Za-z][A-Za-z0-9_-]*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) out.add(m[1]);
  return out;
}

/**
 * 桌面端**真实存在**的元素 id 白名单（从 index.html 抽）。
 *
 * 用途：迁移过来的主题要挂静态背景图，得写 `#themeBg { background-image: … }` ——
 * 而净化原本只认"styles.css 里存在的类名"，`#id` 选择器一律被丢弃，
 * 于是模型即使写出了正确的背景规则也会被系统丢掉。
 *
 * @param {string} html index.html 全文
 * @returns {Set<string>}
 */
function collectDesktopIds(html) {
  const out = new Set();
  if (!html) return out;
  const re = /\sid="([A-Za-z][A-Za-z0-9_-]*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) out.add(m[1]);
  return out;
}

/**
 * 读插件客户端的产物源码。**入口按 package.json 解析**，不再靠猜固定路径。
 *
 * 实测过的三种打包方式（都在市场里真实存在）：
 *   · 根目录 `client.js`                        —— token 型（dsh-neo-skin）
 *   · `lib/client.js`                           —— 官方皮肤生态 skin 包
 *   · `bundle/client.js`（`exports["./client"]`）—— Cordis 插件（dsh-kimino-theme）
 * 所以顺序是：manifest 的 exports["./client"] → exports["."] → main/module → 常见候选
 * → 最后在包内**有界搜索** client.js（跳过 node_modules，深度 ≤ 3）。
 * 只做静态读取，**绝不 require / eval**。
 */
function readPluginClientSource(dir) {
  const cands = [];
  const push = (rel) => {
    if (typeof rel === 'string' && rel && !cands.includes(rel)) cands.push(rel.replace(/^\.\//, ''));
  };
  const fromExport = (v) => {
    if (typeof v === 'string') push(v);
    else if (v && typeof v === 'object') {
      for (const k of ['import', 'default', 'require', 'node', 'browser', 'web']) {
        if (typeof v[k] === 'string') push(v[k]);
        else if (v[k] && typeof v[k] === 'object') fromExport(v[k]);
      }
    }
  };
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (pj && pj.exports && typeof pj.exports === 'object') {
      fromExport(pj.exports['./client']);
      fromExport(pj.exports['.']);
    } else if (typeof pj.exports === 'string') push(pj.exports);
    push(pj && pj.main);
    push(pj && pj.module);
    push(pj && pj.browser);
    // dsh 自己的字段（有些包把入口写在这里）
    if (pj && pj.dsh && pj.dsh.client) fromExport(pj.dsh.client.entry || pj.dsh.client.main || pj.dsh.client.file);
  } catch { /* 没有 package.json 就只走候选列表 */ }
  for (const rel of ['client.js', 'lib/client.js', 'bundle/client.js', 'dist/client.js', 'index.js', 'lib/index.js', 'bundle/index.js']) push(rel);

  for (const rel of cands) {
    try {
      const src = fs.readFileSync(path.join(dir, rel), 'utf8');
      if (src) return { src, file: rel };
    } catch { /* 试下一个 */ }
  }
  // 兜底：包内找 client.js（**有界**：深度 ≤ 3，不进 node_modules）
  const stack = [{ d: dir, depth: 0 }];
  while (stack.length) {
    const { d, depth } = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isFile() && e.name === 'client.js') {
        const rel = path.relative(dir, path.join(d, e.name)).split(path.sep).join('/');
        try {
          const src = fs.readFileSync(path.join(d, e.name), 'utf8');
          if (src) return { src, file: rel };
        } catch { /* 忽略 */ }
      } else if (e.isDirectory() && depth < 3 && !/^(node_modules|\.git|assets|preview|locale)$/.test(e.name)) {
        stack.push({ d: path.join(d, e.name), depth: depth + 1 });
      }
    }
  }
  return { src: '', file: '' };
}

/**
 * 读插件**全部**客户端相关源码（宿主半边 + 客户端半边 + 任何候选入口都并进来）。
 *
 * 为什么需要：市场里有包只声明 `dsh.bundle.patch`（cordis.patch.yml），`main` 指向宿主半边
 * （lib/index.js），客户端半边在 lib/client.js / bundle/client.js —— 只读 `main` 会漏掉
 * 整个客户端（实测 dsh-vae-theme / beauticode-dsh 因此判不成主题）。这些文件都很小，全读无害。
 */
function readPluginClientSources(dir) {
  const cands = [];
  const push = (rel) => { if (typeof rel === 'string' && rel && !cands.includes(rel)) cands.push(rel.replace(/^\.\//, '')); };
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const fromExport = (v) => {
      if (typeof v === 'string') push(v);
      else if (v && typeof v === 'object') for (const k of ['import', 'default', 'require', 'node', 'browser', 'web']) fromExport(v[k]);
    };
    if (pj && pj.exports && typeof pj.exports === 'object') { fromExport(pj.exports['./client']); fromExport(pj.exports['.']); }
    push(pj && pj.main); push(pj && pj.module);
  } catch { /* 没有 package.json 就走候选列表 */ }
  for (const rel of ['client.js', 'lib/client.js', 'bundle/client.js', 'dist/client.js', 'index.js', 'lib/index.js', 'bundle/index.js', 'browser-injection.mjs', 'atmosphere.js']) push(rel);
  const parts = [];
  const files = [];
  for (const rel of cands) {
    try {
      const text = fs.readFileSync(path.join(dir, rel), 'utf8');
      if (text) { parts.push(text); files.push(rel); }
    } catch { /* 试下一个 */ }
  }
  return { src: parts.join('\n'), file: files[0] || '', files };
}

/**
 * **通用**变量表提取：从任意客户端产物里捞出 `--dsw-*` 变量表，不依赖任何特定框架写法。
 *
 * 为什么需要它：市场里的主题写法至少有这三种（都真实存在）
 *   1. `const SCHEMES = {…}` 字面量                      → parseClientBundle 认
 *   2. `src/schemes/*.tokens.json` 源码目录               → parseSchemeDir 认
 *   3. `ctx.theme.overrideTokens('ns', { '--dsw-x': pair('#fff') })` 调用参数
 *      （Cordis 插件形态，dsh-kimino-theme 就是这种）        → **本函数认**
 * 做法：扫出所有 `--dsw-*` 键，解析它右边的值表达式，支持
 *   · `{ light: A, dark: B }` 对象字面量（缺一档就两档同值）
 *   · `pair(X)` 这类**简单 helper 调用**（先在文件里找 `const pair = (v) => ({light:v,dark:v})` 这种定义）
 *   · 直接一个字面量（字符串 / 模板串 / 十六进制 / rgb()/hsl() 函数）
 *   · CSS 文本里的 `--dsw-x: value;`
 * 再按最近的 `overrideTokens('ns'` / `registerTheme('ns'` 之类的命名参数分组。
 *
 * @returns {{schemes:Object,how:string,unresolved:string[]}|null}
 */
function parseTokenMapsFromSource(src) {
  if (typeof src !== 'string' || !src) return null;

  // 简单 helper 解析：const NAME = (v) => ({ light: v, dark: v }) / => v / => ({ light: v })
  // 🔴 注意 `({ … })` 这种**带括号**的对象体（dsh-kimino-theme 就是 `const pair = (v) => ({ light: v, dark: v })`），
  //    只匹配 `{…}` 会漏掉，导致 pair('x') 解析不出值。
  const helpers = new Map();
  const helperRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*(\(\s*\{[\s\S]{0,240}?\}\s*\)|\{[\s\S]{0,240}?\}|[^;,\n{}]{1,60})/g;
  let hm;
  while ((hm = helperRe.exec(src)) !== null) {
    const [, name, param, rawBody] = hm;
    let b = rawBody.trim();
    if (b.startsWith('(') && b.endsWith(')')) b = b.slice(1, -1).trim();
    if (/^\{[\s\S]*\}$/.test(b)) {
      const light = new RegExp('light\\s*:\\s*' + param + '\\b').test(b);
      const dark = new RegExp('dark\\s*:\\s*' + param + '\\b').test(b);
      if (light && dark) { helpers.set(name, 'both'); continue; }
      if (light || dark) { helpers.set(name, 'one'); continue; }
    } else if (b === param) {
      helpers.set(name, 'both');
    }
  }

  const litVal = (s) => {
    const t = String(s || '').trim();
    if (!t) return '';
    let m = /^'(.*)'$/.exec(t) || /^"(.*)"$/.exec(t);
    if (m) return m[1].includes('${') ? '' : m[1];
    m = /^`([^`$]*)`$/.exec(t);
    if (m) return m[1];
    if (/^#[0-9a-fA-F]{3,8}$/.test(t)) return t;
    if (/^rgba?\([^)]*\)$/i.test(t) || /^hsla?\([^)]*\)$/i.test(t)) return t;
    if (/^-?\d*\.?\d+(px|rem|em|%|vh|vw|s|ms)?$/.test(t)) return t;
    return '';
  };

  // 从 `{` 起取平衡的一段（引号/括号都要算）
  const balanced = (text, start, open, close) => {
    let depth = 0; let quote = '';
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === '\\') { i++; continue; }
        if (c === quote) quote = '';
        continue;
      }
      if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
      if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) return text.slice(start, i + 1); }
    }
    return '';
  };

  /** 解析键右侧的值表达式 → {light,dark} 或 null */
  const resolveValue = (expr) => {
    const t = String(expr || '').trim();
    if (!t) return null;
    if (t.startsWith('{')) {
      const obj = balanced(t, 0, '{', '}');
      if (!obj) return null;
      const l = litVal((/light\s*:\s*([^,}]+)/.exec(obj) || [])[1]);
      const d = litVal((/dark\s*:\s*([^,}]+)/.exec(obj) || [])[1]);
      if (l && d) return { light: l, dark: d };
      if (l || d) return { light: l || d, dark: d || l };
      return null;
    }
    const call = /^([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)$/.exec(t);
    if (call && helpers.has(call[1])) {
      const v = litVal(call[2]);
      if (v) return { light: v, dark: v };
      return null;
    }
    const single = litVal(t);
    return single ? { light: single, dark: single } : null;
  };

  const schemes = {};
  const unresolved = [];
  // 命名空间标记：（调用点位置 → 名字）。按位置分组，**不限回看距离** ——
  // 一次 overrideTokens('ns', { …64 个键… }) 的块可能几千字符，定长回看会让后面的键
  // 全落到 default（实测踩到过：9 个变量归对了，55 个落进了 default）。
  const markers = [];
  const markerRe = /(?:overrideTokens|registerTheme|defineTheme|addTheme|registerTokens)\s*\(\s*['"]([^'"]{1,60})['"]/g;
  let mm2;
  while ((mm2 = markerRe.exec(src)) !== null) markers.push({ at: mm2.index, name: mm2[1] });
  const bracketRe = /(?:variant|theme|tokens)\s*\[\s*['"]([^'"]{1,60})['"]\s*\]/g;
  while ((mm2 = bracketRe.exec(src)) !== null) markers.push({ at: mm2.index, name: mm2[1] });
  markers.sort((a, b) => a.at - b.at);
  const defaultNs = markers.length ? markers[0].name : 'default';
  const schemeOf = (idx) => {
    let name = '';
    for (const m of markers) {
      if (m.at < idx) name = m.name;
      else break;
    }
    return name || defaultNs;
  };
  const put = (ns, key, tones) => {
    const s = schemes[ns] || (schemes[ns] = { id: ns, label: ns, tokens: {}, css: '' });
    if (!s.tokens[key]) s.tokens[key] = tones;
  };

  // (a) 带引号的键：'--dsw-x': <值>
  const keyRe = /['"](--dsw-[a-z0-9-]+)['"]\s*:\s*/g;
  let km;
  while ((km = keyRe.exec(src)) !== null) {
    const key = km[1];
    const after = src.slice(km.index + km[0].length);
    let expr;
    if (after.trimStart().startsWith('{')) {
      const i = after.indexOf('{');
      expr = balanced(after, i, '{', '}');
    } else {
      // 取到下一个顶层逗号 / 换行 / 右括号
      let depth = 0; let quote = ''; let out = '';
      for (let i = 0; i < after.length && i < 300; i++) {
        const c = after[i];
        if (quote) { out += c; if (c === quote && after[i - 1] !== '\\') quote = ''; continue; }
        if (c === "'" || c === '"' || c === '`') { quote = c; out += c; continue; }
        if (c === '(' || c === '[' || c === '{') depth++;
        if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; }
        if ((c === ',' || c === '\n') && depth === 0) break;
        out += c;
      }
      expr = out;
    }
    const tones = resolveValue(expr);
    if (tones) put(schemeOf(km.index), key, tones);
    else if (unresolved.length < 20) unresolved.push(key + ' = ' + String(expr).slice(0, 40));
  }

  // (b) CSS 文本形式：--dsw-x: value;（同一份文件里可能同时有两种写法）
  const cssRe = /(--dsw-[a-z0-9-]+)\s*:\s*([^;{}\n'"]+)\s*;/g;
  let cm;
  while ((cm = cssRe.exec(src)) !== null) {
    const v = litVal(cm[2]);
    if (v) put('default', cm[1], { light: v, dark: v });
  }

  const kept = Object.fromEntries(Object.entries(schemes).filter(([, s]) => Object.keys(s.tokens).length > 0));
  if (Object.keys(kept).length === 0) return null;
  return { schemes: kept, how: '通用变量提取', unresolved };
}


/**
 * skin 包的运行期资源表。
 *
 * skin 的样式在 client.js 里以模板字符串拼出，图片/字体走 `skinAssetUrl("<hash>.<ext>")`，
 * 实文件在 `<包目录>/assets/runtime/<hash>.<ext>`（实测 maid-atelier 有 31 个引用 / 37 个文件 / 6.3MB）。
 * 把这些解析出来，模型才有可能让桌面端真的用上皮肤自己的图 —— 这是「完全承接」与
 * 「只换个强调色」的分界。
 *
 * 只接受**简单文件名**（不含路径分隔符与 ..），杜绝穿越到包外。
 */
function parseSkinAssets(dir, clientSrc) {
  const out = [];
  const seen = new Set();
  const re = /skinAssetUrl\(\s*["']([^"']+)["']\s*\)/g;
  let m;
  while ((m = re.exec(clientSrc)) !== null) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes('..')) continue;
    const relPosix = `assets/runtime/${name}`;
    const file = path.join(dir, 'assets', 'runtime', name);
    let exists = false;
    let size = 0;
    try { const st = fs.statSync(file); exists = st.isFile(); size = st.size; } catch { /* 不存在 */ }
    out.push({
      name,
      rel: relPosix,
      exists,
      size,
      ext: path.extname(name).slice(1).toLowerCase(),
    });
  }
  return out;
}

/**
 * 构造给模型看的 skin 包结构摘要（**不执行**包内任何代码，只做静态文本抽取）。
 *
 * 为什么需要摘要而不是把整包丢给模型：maid-atelier 的 client.js 是 26 万字符，
 * 直接塞进上下文既贵又会被截断。摘要把「配色分布 + 形状语言 + 资源表 + 代表性规则样本」
 * 压到几十 KB 以内，信息密度反而更高。
 *
 * @param {object} o
 * @param {object} o.plugin          扫描结果里的 skin 插件（含 dir / skin）
 * @param {number} [o.budgetBytes]   规则样本的字节预算
 * @returns {object} digest
 */
function buildSkinDigest({ plugin, budgetBytes = 12000 } = {}) {
  const dir = plugin && plugin.dir;
  let src = '';
  try { src = readPluginClientSource(dir).src; } catch { /* 读不到就产出空摘要 */ }

  // 1) 配色分布：出现次数 + 每色一处用途上下文（模型的"色感"就靠这个）。
  // 正则按"长优先"排列：`#00000000` 必须先于 `#0000`/`#000` 匹配，否则会被截成 `#0000`（踩过）。
  const colorRe = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{4}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]{5,60}\)|hsla?\([^)]{5,60}\)/g;
  const colorMap = new Map();
  let cm;
  while ((cm = colorRe.exec(src)) !== null) {
    const raw = cm[0];
    const key = raw.replace(/\s+/g, '').toLowerCase();
    let rec = colorMap.get(key);
    if (!rec) { rec = { value: raw, count: 0, where: [] }; colorMap.set(key, rec); }
    rec.count++;
    if (rec.where.length < 2) {
      const ctx = src.slice(Math.max(0, cm.index - 70), cm.index).replace(/\s+/g, ' ');
      const decl = /([a-z-]+)\s*:\s*[^;{}]*$/.exec(ctx);
      rec.where.push((decl ? decl[1] + ': ' : '') + ctx.slice(-46).trim());
    }
  }
  const colors = [...colorMap.values()].sort((a, b) => b.count - a.count).slice(0, 40);

  // 2) 形状语言：圆角 / 边框 / 阴影 / 字体 —— 皮肤的"性格"大多在这里
  const grab = (re, max = 12) => {
    const map = new Map();
    let g;
    while ((g = re.exec(src)) !== null) {
      const v = g[1].trim().replace(/\s+/g, ' ');
      if (!v || v.length > 90) continue;
      map.set(v, (map.get(v) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([value, count]) => ({ value, count }));
  };
  const shapes = {
    圆角: grab(/border-radius\s*:\s*([^;{}"']+)/g),
    边框宽度: grab(/border(?:-(?:top|right|bottom|left))?-width\s*:\s*([^;{}"']+)/g, 8),
    边框: grab(/border\s*:\s*([^;{}"']+)/g, 8),
    阴影: grab(/box-shadow\s*:\s*([^;{}"']+)/g, 10),
    字体: grab(/font-family\s*:\s*([^;{}"']+)/g, 8),
    文字阴影: grab(/text-shadow\s*:\s*([^;{}"']+)/g, 6),
    滤镜: grab(/(?:backdrop-)?filter\s*:\s*([^;{}"']+)/g, 8),
  };

  // 3) 资源表：每个资源再记一处「被赋给了哪个属性/变量」，模型据此判断哪张图是背景哪张是装饰
  const assets = parseSkinAssets(dir, src).map((a) => {
    const constRe = new RegExp('([A-Za-z0-9_$]+)\\s*=\\s*skinAssetUrl\\(\\s*["\']' + a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\']');
    const c = constRe.exec(src);
    const constName = c ? c[1] : '';
    const usedIn = [];
    if (constName) {
      const useRe = new RegExp('\\$\\{' + constName.replace(/\$/g, '\\$') + '\\}', 'g');
      let u;
      while ((u = useRe.exec(src)) !== null && usedIn.length < 2) {
        const start = Math.max(0, u.index - 90);
        const end = Math.min(src.length, u.index + 40);
        usedIn.push(src.slice(start, end).replace(/\s+/g, ' ').trim().slice(-110));
      }
      // 有些常量是**裸引用**（不套 ${}，例如直接传给某个 helper 或作为对象字段），
      // 只找 ${} 会漏；这里再兜一层，跳过声明本身那一处。
      if (!usedIn.length) {
        const bareRe = new RegExp('\\b' + constName.replace(/\$/g, '\\$') + '\\b', 'g');
        let b;
        while ((b = bareRe.exec(src)) !== null && usedIn.length < 2) {
          const start = Math.max(0, b.index - 90);
          const end = Math.min(src.length, b.index + 40);
          const ctx = src.slice(start, end).replace(/\s+/g, ' ').trim();
          if (/=\s*skinAssetUrl/.test(ctx)) continue;   // 跳过 "const X = skinAssetUrl(...)" 声明行
          usedIn.push(ctx.slice(-110));
        }
      }
    }
    return { 文件: a.rel, 存在: a.exists, 体积: a.size, 用在: usedIn.length ? usedIn : ['(未在 client.js 里找到引用点)'] };
  });

  // 4) 规则样本：挑"有形状/资源信息"的 CSS 片段（JS 语法块会被下面的初筛挡掉）
  const rules = [];
  let bytes = 0;
  const ruleRe = /([^{}\n]{2,140})\{([^{}]{4,600})\}/g;
  let rm;
  while ((rm = ruleRe.exec(src)) !== null) {
    const sel = rm[1].trim();
    const body = rm[2].trim();
    if (!/[.\[#:>]|body|html|\*/.test(sel)) continue;              // 选择器要像 CSS
    if (/=>|function|const |return |var |import |\(\)\s*\{/.test(sel + body)) continue; // 排除 JS 块
    if (!/(border-radius|box-shadow|background|border|color|font|filter|--)/.test(body)) continue;
    const chunk = `${sel} { ${body.replace(/\s+/g, ' ').slice(0, 420)} }`;
    if (bytes + chunk.length > budgetBytes) break;
    bytes += chunk.length;
    rules.push(chunk);
    if (rules.length >= 60) break;
  }

  return {
    skin: plugin.skin || null,
    version: plugin.version || '',
    sourceBytes: src.length,
    colors,
    shapes,
    assets,
    rules,
    ruleBytes: bytes,
  };
}

/** 灰阶判定：三通道极差很小即视为"没有色相"。支持 `rgb()/rgba()` 与 `#rrggbb`。 */function isAchromatic(color) {
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

/**
 * skin 型主题 → 桌面端主题载荷（免费确定性路径）。
 *
 * 能迁移的：skin.json 里声明了的「强调色 + 命名 + 预览图路径」；浅/深两档都产出，
 * 以桌面端官方对应档位为底色，只把强调色换成 skin 的 accent。
 * 迁不走的：skin 的整段 CSS（bodyAttr + WebUI 专属选择器）。桌面端没有那些类名，
 * 逐条翻译 26 万字符的皮肤样式既不现实也不可靠 —— 这里**如实写进 notes**，
 * 完整观感仍需在 WebUI 里启用该皮肤。
 */
function buildSkinMigration({ plugin, tone, stylesCss = '' } = {}) {
  if (!plugin || (plugin.kind !== 'skin' && plugin.kind !== 'generic')) {
    throw new Error('buildSkinMigration 只接受 skin / generic 型插件');
  }
  if (!TONES.includes(tone)) throw new Error(`tone 必须是 light / dark，收到 ${tone}`);
  const verify = buildSelectorVerifier(stylesCss);
  // generic（提不出变量表的主题包）没有 skin.json：用包名当方案名、不猜强调色，
  // 免费路径只给"命名 + 官方档打底"，真正的观感靠「模型全文承接」。
  const skin = plugin.skin || {
    skinId: 'default',
    name: String(plugin.id || '').replace(/^@[^/]+\//, ''),
    tagline: '',
    accent: '',
    bodyAttr: '',
    previewLight: '',
    previewDark: '',
  };
  const accent = String(skin.accent || '').trim();

    // 页面级背景图（免费承接）：皮肤的氛围几乎全靠它。skin 的 CSS 是一整段 WebUI 专属选择器，
  // 翻译不了，但 body/html 的 background-image 是确定的 —— 直接搬成桌面端 #themeBg。
  const skinClientSrc = readPluginClientSource(plugin.dir).src
    + '\n' + collectPackageCss(plugin.dir).map((c) => c.text).join('\n');
  const background = buildBackgroundCss(plugin, skinClientSrc);

const notes = [];
  if (!accent) {
    notes.push('skin.json 未声明 accent：桌面端强调色将回落到官方档位默认值。');
  } else if (isAchromatic(accent)) {
    notes.push(`skin.json 的 accent 是灰阶值 ${accent}（桌面端 --accent 是填充色，灰阶会让按钮失去识别度），已回落官方默认。`);
  }
  notes.push((plugin.kind === 'skin'
    ? 'skin 型主题（官方皮肤生态，skin.json + bodyAttr + 整段 CSS）'
    : '通用型主题（本机扫不出变量表：既不是 SCHEMES 字面量，也没有 skin.json）')
    + '：桌面端能确定性承接的是强调色与命名，底色沿用官方' + (tone === 'light' ? '浅色' : '深色') + '档。'
    + (plugin.kind === 'generic' ? '要真正搬它的观感请用「模型全文承接」（它会读整包结构摘要）。' : ''));
  notes.push('皮肤的整体观感（背景 / 贴图 / 侧栏装饰）是 WebUI 专属选择器的整段 CSS，'
    + '桌面端没有对应类名，不在迁移范围内 —— 完整观感请在 WebUI 里启用该皮肤。'
    + (skin.previewLight || skin.previewDark ? ' 预览图见下。' : ''));

  // accent 有且非灰阶才写品牌 token；其余一律走承接层的官方默认（buildMigration 同一约定）
  const tokens = {};
  if (accent && !isAchromatic(accent)) {
    tokens['--dsw-alias-brand-primary'] = accent;
    tokens['--dsw-specific-brand-toggle'] = accent;
  }

  const id = `${plugin.id}:${skin.skinId}:${tone}`;
  return {
    id,
    kind: 'webtheme',
    label: `${skin.name} · ${tone === 'light' ? '浅色' : '深色'}`,
    origin: { plugin: plugin.id, version: plugin.version || '', scheme: skin.skinId, tone },
    createdAt: new Date().toISOString(),
    tokens,
    tokenCount: Object.keys(tokens).length,
    shapePolicy: {},
    behavior: plugin.behavior || {},
    css: background ? background.css : '',
    skinPreview: { light: skin.previewLight || '', dark: skin.previewDark || '' },
    notes: background ? [...notes, background.note] : notes,
  };
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
  readSkinManifest,
  readPluginClientSource,
  readPluginClientSources,
  collectDesktopTokenNames,
  collectDesktopTokenDefaults,
  collectDesktopIds,
  collectPackageCss,
  detectPageBackground,
  fileUrlOf,
  collectDesktopIds,
  parseTokenMapsFromSource,
  resolveSchemeSource,
  parseSkinAssets,
  buildSkinDigest,
  scanThemePlugins,
  buildMigration,
  buildSkinMigration,
  isAchromatic,
};
