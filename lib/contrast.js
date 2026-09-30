/**
 * 颜色与对比度工具（纯函数，无依赖）—— 给"主题精修"用的**对比度护栏**。
 *
 * 用户的诉求：精修不应该只顾"像不像原主题"，还要**保证看得清** ——
 * 比如模型把面板刷成深色，却没给文字色，结果文字跟底色糊在一起（或者反过来：
 * 浅色主题下刷出浅底浅字）。所以需要一个能算、能自动修正的判据。
 *
 * 判据用 WCAG 相对亮度（sRGB → 线性化后加权），阈值：
 *   · 正文/主要文字      ≥ 4.5:1
 *   · 次要文字/强调色    ≥ 3.0:1
 *   · 低于 3.0 直接判定"看不清"，必须修
 */

/** 解析颜色：#rgb / #rrggbb / #rrggbbaa / rgb() / rgba()；已经是 {r,g,b,a} 的对象直接透传 */
function parseColor(input) {
  if (input && typeof input === 'object' && typeof input.r === 'number' && typeof input.g === 'number' && typeof input.b === 'number') {
    return { r: input.r, g: input.g, b: input.b, a: typeof input.a === 'number' ? input.a : 1 };
  }
  const s = String(input == null ? '' : input).trim();
  if (!s) return null;
  const hex = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  const m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.slice(0, 3).some((n) => Number.isNaN(n))) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 && !Number.isNaN(p[3]) ? p[3] : 1 };
  }
  return null;
}

function toCss(c) {
  const r = Math.round(c.r);
  const g = Math.round(c.g);
  const b = Math.round(c.b);
  if (c.a >= 0.999) return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  return `rgba(${r}, ${g}, ${b}, ${Number(c.a.toFixed(3))})`;
}

/** 相对亮度（WCAG 2.x） */
function relLuminance(c) {
  const f = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/** 把半透明前景叠在不透明底色上，得到"实际看到的颜色" */
function compositeOver(fg, bg) {
  if (!fg) return bg;
  if (fg.a >= 0.999 || !bg) return { ...fg, a: 1 };
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

/**
 * 对比度（1 ~ 21）。
 * 半透明前景会先按 alpha 合成到底色上 —— 否则 rgba(255,255,255,0.5) 这种会被
 * 当成纯白算，误判成高对比（实际压在深底上只有一半亮度）。
 */
function contrastRatio(fgInput, bgInput) {
  const fg0 = parseColor(fgInput);
  const bg0 = parseColor(bgInput);
  if (!fg0 || !bg0) return null;
  const bg = compositeOver(bg0, { r: 0, g: 0, b: 0, a: 1 });
  const fg = compositeOver(fg0, bg);
  const l1 = relLuminance(fg);
  const l2 = relLuminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function rgbToHsl({ r, g, b }) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
    else if (max === gg) h = ((bb - rr) / d + 2) / 6;
    else h = ((rr - gg) / d + 4) / 6;
  }
  return { h: h * 360, s, l };
}

function hslToRgb({ h, s, l }) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb = [0, 0, 0];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = l - c / 2;
  return { r: (rgb[0] + m) * 255, g: (rgb[1] + m) * 255, b: (rgb[2] + m) * 255, a: 1 };
}

/**
 * 在**保持色相/饱和度**的前提下，把前景色调到与背景至少达到 minRatio。
 *
 * 为什么保持色相：主题的"气质"来自色相（青蓝的强调色不该被修正成灰色）。
 * 方向由底色亮度决定：底暗往亮处走、底亮往暗处走（改动最小、也最符合直觉）。
 *
 * @returns {{color:string, ratio:number, changed:boolean, reason:string}}
 */
function ensureReadable(fgInput, bgInput, minRatio = 4.5) {
  const fg0 = parseColor(fgInput);
  const bg0 = parseColor(bgInput);
  const original = String(fgInput);
  if (!fg0 || !bg0) return { color: original, ratio: null, changed: false, reason: '颜色解析不了' };
  const bgOpaque = compositeOver(bg0, { r: 0, g: 0, b: 0, a: 1 });
  const fgSolid = compositeOver(fg0, bgOpaque);
  const before = contrastRatio(fgSolid, bgOpaque);
  if (before != null && before >= minRatio) return { color: original, ratio: before, changed: false, reason: '' };

  const bgLum = relLuminance(bgOpaque);
  const goLighter = bgLum < 0.5;          // 暗底 → 提亮前景；亮底 → 压暗前景
  const hsl = rgbToHsl(fgSolid);
  let best = null;
  for (let step = 1; step <= 20; step++) {
    const l = goLighter ? Math.min(1, hsl.l + step * 0.05) : Math.max(0, hsl.l - step * 0.05);
    const cand = hslToRgb({ h: hsl.h, s: hsl.s, l });
    const ratio = contrastRatio(cand, bgOpaque);
    if (ratio != null && ratio >= minRatio) { best = { cand, ratio }; break; }
    if (l <= 0 || l >= 1) break;
  }
  if (!best) {
    // 极端情况（底色是中灰、色相又在中间）：兜底取纯白/纯黑里更好的那个
    const white = { r: 255, g: 255, b: 255, a: 1 };
    const black = { r: 0, g: 0, b: 0, a: 1 };
    const rw = contrastRatio(white, bgOpaque);
    const rb = contrastRatio(black, bgOpaque);
    best = rw >= rb ? { cand: white, ratio: rw } : { cand: black, ratio: rb };
  }
  const changed = toCss(best.cand).toLowerCase() !== String(fgSolid && toCss(fgSolid)).toLowerCase();
  return {
    color: toCss(best.cand),
    ratio: best.ratio,
    changed,
    reason: `对比度 ${before == null ? '?' : before.toFixed(2)} → ${best.ratio.toFixed(2)}（阈值 ${minRatio}）`,
  };
}

module.exports = { parseColor, toCss, relLuminance, compositeOver, contrastRatio, ensureReadable, rgbToHsl, hslToRgb };
