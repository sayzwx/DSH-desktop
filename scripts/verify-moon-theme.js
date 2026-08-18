/**
 * 紫月主题验证（DOM-shim 风格，参考 scripts/settings-smoke.cjs）
 *
 * 用最小 fake DOM 在 vm 中加载真实的 renderer/bg-moon.js 与 renderer/app.js，断言：
 *  1) setTheme('moon') → documentElement data-theme=moon、localStorage 写入、
 *     紫月层显示并播放；其他主题 → 紫月层暂停并隐藏（app.js 主题联动）
 *  2) 无缝循环素材已就位（bg-moon-loop.mp4 存在、单视频、src 正确）
 *  3) 素材本身在编码层就是无缝的：
 *     中缝（t≈4.9 vs t≈5.0）与外缝（t≈9.9 vs t≈0.1）帧差远小于原素材循环缝
 *     （用 ffmpeg 提取帧 + numpy 量化，替代已删除的交叉淡化机制）
 *
 * 真机视觉/帧差异实测由 scripts/real-test-moon.cjs（CDP 驱动真实 Electron）完成。
 * 用法: node scripts/verify-moon-theme.js
 */
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const RENDERER = path.join(__dirname, '..', 'renderer');
const SCRATCH = path.join(__dirname, '.scratch');
const failures = [];
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? '  [' + detail + ']' : ''));
  if (!cond) failures.push(name + (detail ? ' :: ' + detail : ''));
};

// ---------- 最小 fake DOM ----------
function fakeEl(tag) {
  const handlers = {};
  const attrs = {};
  const el = {
    tag: tag || 'el',
    style: {},
    dataset: {},
    className: '',
    textContent: '',
    value: '',
    disabled: false,
    hidden: false,
    checked: false,
    paused: true,
    scrollTop: 0,
    scrollHeight: 0,
    attrs,
    currentTime: 0,
    duration: 0,
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    fire(type, ev) { (handlers[type] || []).forEach((fn) => fn(ev || {})); },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return attrs[k] ?? null; },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    play() { this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; },
    appendChild() {}, removeChild() {}, insertBefore() {},
    click() {}, focus() {},
    querySelector() { return fakeEl(); },
    querySelectorAll() { return []; },
  };
  return el;
}

const moonVideo = fakeEl('video'); // 紫月层内唯一视频
const bgMoonLayer = Object.assign(fakeEl('div'), {
  querySelector: (s) => (s === 'video' ? moonVideo : fakeEl()),
});
const mainVideo = fakeEl('video'); // 原 #bgvideo

const els = new Map();
function el(sel) {
  if (!els.has(sel)) els.set(sel, sel === '#bgvideoMoon' ? bgMoonLayer : fakeEl());
  return els.get(sel);
}

const rootEl = fakeEl();
rootEl.style.removeProperty = function () {};
rootEl.style.setProperty = function () {};

const sandboxDocument = {
  querySelector: (s) => el(s),
  querySelectorAll: () => [],
  getElementById: (id) => (id === 'bgvideoMoon' ? bgMoonLayer : id === 'bgvideo' ? mainVideo : el('#' + id)),
  createElement: () => fakeEl(),
  createDocumentFragment: () => ({ appendChild() {} }),
  addEventListener() {},
  documentElement: rootEl,
  hidden: false,
};

const storage = new Map();
const localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
};
const api = {
  getStatus: async () => ({ state: 'stopped', webUp: false, harnessDir: 'C:\\dsh', port: 3080 }),
  getLogs: async () => [],
  getApiKey: async () => ({ ok: true, configured: false }),
  setApiKey: async () => ({ ok: true }),
  getPresets: async () => ({ ok: true, presets: [] }),
  readPreset: async () => ({ ok: false }),
  openPresetDoc: async () => ({ ok: false }),
  getLlmProviders: async () => ({ ok: true, providers: [] }),
  getLlmModels: async () => ({ ok: true, groups: [], failures: [] }),
  getSettingsDescribe: async () => ({ ok: true, writable: true, hasDocument: true, namespaces: [] }),
  describeCredentials: async () => ({ ok: true, credentials: {} }),
  setCredential: async () => ({ ok: true }),
  mutateSettings: async () => ({ ok: true }),
  discoverModels: async () => ({ ok: true, models: [] }),
  getPluginCatalog: async () => ({ ok: true, plugins: [] }),
  getPresetDefault: async () => ({ ok: true, default: null }),
  openSettingsDoc: async () => ({ ok: false }),
  listResults: async () => ({ home: '', dirs: [] }),
  chatModels: async () => ({ ok: true, value: {} }),
  startHarness: async () => ({ ok: true }),
  stopHarness: async () => ({ ok: true }),
  openWeb: async () => ({}),
  onState() {}, onLog() {},
};

const browserWindow = { api, __modal: undefined, __starfield: undefined };
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  document: sandboxDocument,
  localStorage,
  window: browserWindow,
  alert() {},
};
vm.createContext(sandbox);

(async () => {
  const bgMoonCode = fs.readFileSync(path.join(RENDERER, 'bg-moon.js'), 'utf8');
  const appCode = fs.readFileSync(path.join(RENDERER, 'app.js'), 'utf8');
  vm.runInContext(bgMoonCode, sandbox, { filename: 'bg-moon.js' });
  vm.runInContext(appCode, sandbox, { filename: 'app.js' });
  await new Promise((r) => setTimeout(r, 150));

  const bgMoon = browserWindow.__bgMoon;
  const themeSelect = el('#themeSelect');

  console.log('\n[1] app.js 主题联动');
  ok('启动后默认主题为 dark', rootEl.getAttribute('data-theme') === 'dark', rootEl.getAttribute('data-theme'));
  ok('dark 下紫月层未激活', !bgMoon.isActive() && bgMoonLayer.style.display === 'none');

  themeSelect.fire('change', { target: { value: 'moon' } });
  ok('setTheme("moon") 设置 data-theme', rootEl.getAttribute('data-theme') === 'moon');
  ok('moon 激活紫月层', bgMoon.isActive() === true);
  ok('moon 显示紫月层', bgMoonLayer.style.display === 'block', bgMoonLayer.style.display);
  ok('moon 时视频播放', moonVideo.paused === false);
  ok('moon 时暂停原 #bgvideo', mainVideo.paused === true);

  themeSelect.fire('change', { target: { value: 'dark' } });
  ok('setTheme("dark") 停用紫月层', rootEl.getAttribute('data-theme') === 'dark' && bgMoon.isActive() === false);
  ok('dark 隐藏紫月层', bgMoonLayer.style.display === 'none');
  ok('dark 下视频暂停', moonVideo.paused === true);

  themeSelect.fire('change', { target: { value: 'moon' } });
  ok('再次 moon 恢复播放', bgMoon.isActive() === true && moonVideo.paused === false);
  ok('无淡化机制（fading 恒为 false）', bgMoon.getInfo().fading === false);

  console.log('\n[2] 静态断言');
  const html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(RENDERER, 'styles.css'), 'utf8');
  ok('bg-moon-loop.mp4 存在', fs.existsSync(path.join(RENDERER, 'bg-moon-loop.mp4')));
  ok('紫月层单一视频且 src=bg-moon-loop.mp4', /id="bgvideoMoon"[\s\S]*data-theme/.test(html) ? true : (() => {
    // 取 #bgvideoMoon 容器片段检查只有一个 video
    const seg = html.split('id="bgvideoMoon"')[1].split('</div>')[0];
    return (seg.match(/<video/g) || []).length === 1 && seg.includes('bg-moon-loop.mp4');
  })(), (html.split('id="bgvideoMoon"')[1].split('</div>')[0].match(/<video/g) || []).length + ' video(s)');
  ok('index.html 含紫月选项', html.includes('<option value="moon">紫月</option>'));
  ok('index.html 引入 bg-moon.js 且先于 app.js',
    html.indexOf('bg-moon.js') !== -1 && html.indexOf('bg-moon.js') < html.indexOf('app.js'));
  ok('styles.css 含 [data-theme="moon"] 变量块', css.includes(':root[data-theme="moon"]'));
  ok('styles.css 隐藏原 #bgvideo（moon 下）', css.includes(':root[data-theme="moon"] #bgvideo { display: none; }'));
  // 防回归：单视频无缝设计下，紫月视频必须默认完全不透明（旧的交叉淡化设计把它初始化为 0，
  // 一旦 bg-moon.js 不再调度透明度，画面会只剩静态占位渐变——真机实测抓到的坑）
  ok('紫月视频默认不透明（无 opacity:0 遗留）',
    !/#bgvideoMoon video\s*\{[\s\S]{0,200}opacity:\s*0/.test(css));
  // 防回归：紫月视频禁止任何 transform/scale 动画（960x540 放大到全屏后，
  // 连续亚像素重采样在合成器层产生"游动/抖动"观感——真机实测结论）
  ok('紫月视频无 transform 动画（无 moon-drift 残留）',
    !css.includes('moon-drift')
    && !/#bgvideoMoon video[^{]*\{[\s\S]{0,240}\b(animation|transform)\s*:/.test(css));

  console.log('\n[3] 素材编码层无缝性量化（ffmpeg 抽帧 + numpy 帧差）');
  const ff = 'C:\\Users\\shiy\\AppData\\Roaming\\Python\\Python314\\site-packages\\imageio_ffmpeg\\binaries\\ffmpeg-win-x86_64-v7.1.exe';
  const loop = path.join(RENDERER, 'bg-moon-loop.mp4');
  if (fs.existsSync(ff) && fs.existsSync(loop)) {
    fs.mkdirSync(SCRATCH, { recursive: true });
    for (const [name, t] of [['j1', '4.9'], ['j2', '5.0'], ['o1', '0.1'], ['o2', '9.9']]) {
      execFileSync(ff, ['-hide_banner', '-loglevel', 'error', '-ss', t, '-i', loop, '-frames:v', '1', '-y', path.join(SCRATCH, name + '.png')]);
    }
    const out = execFileSync('python', ['-c', `
import numpy as np
from PIL import Image
import os
scratch = r'${SCRATCH.replace(/\\/g, '\\\\')}'
def L(n): return np.asarray(Image.open(os.path.join(scratch, n + '.png')).convert('L')).astype(np.float32) / 255.0
mid = float(np.mean(np.abs(L('j1') - L('j2'))))
outer = float(np.mean(np.abs(L('o1') - L('o2'))))
print(f'{mid:.4f} {outer:.4f}')
`], { encoding: 'utf8' }).trim().split(' ');
    const mid = parseFloat(out[0]); const outer = parseFloat(out[1]);
    ok('中缝帧差 < 0.02（原素材缝 0.082）', mid < 0.02, String(mid));
    ok('外缝帧差 < 0.02（原素材缝 0.082）', outer < 0.02, String(outer));
    console.log(`      中缝 ${mid.toFixed(4)}  外缝 ${outer.toFixed(4)}  （原素材循环缝 0.0815）`);
  } else {
    ok('ffmpeg / 素材缺失，跳过编码层校验', false, 'missing tooling');
  }

  if (failures.length) {
    console.error('\nFAILURES:\n' + failures.join('\n'));
    process.exit(1);
  }
  console.log('\nALL MOON-THEME CHECKS PASSED');
  process.exit(0);
})().catch((e) => {
  console.error('VERIFY FAILED:', e);
  process.exit(1);
});