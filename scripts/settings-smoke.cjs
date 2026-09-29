/**
 * 设置页「模型配置」冒烟测试：用最小 DOM shim 加载真实 renderer/settings.js +
 * renderer/providers.js（提供商那部分已从 settings.js 拆出），
 * 以 live harness 的 llm.providers / llm.models 数据驱动，断言：
 *  1) 提供商下拉框包含全部提供商（含分组与模型数）
 *  2) 未启用提供商渲染密钥编辑器（ref 派生、状态徽章）
 *  3) 保存密钥 → credentials.set + settings.mutate 顺序调用
 *  4) 测试连接 → llm.discoverModels 携带输入框密钥
 *  5) 已启用且有模型的提供商不出现密钥编辑器
 * 用法: node scripts/settings-smoke.cjs   （需要 :3080 有 live harness）
 */
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const RENDERER = path.join(__dirname, '..', 'renderer');

// ---------- 最小 fake DOM ----------
function fakeEl(tag) {
  const handlers = {};
  return {
    tag: tag || 'el',
    innerHTML: '',
    textContent: '',
    value: '',
    disabled: false,
    hidden: false,
    dataset: {},
    selectedOptions: [],
    addEventListener(type, fn) { handlers[type] = fn; },
    fire(type) { if (handlers[type]) handlers[type](); },
    querySelector() { return fakeEl(); },
    querySelectorAll() { return []; },
    closest() { return null; },
  };
}

const els = new Map();
function el(sel) {
  if (!els.has(sel)) els.set(sel, fakeEl());
  return els.get(sel);
}

// 从最近一次 #modelGroupList 的 innerHTML 里解析 .mg-key 块（仅取 data-provider）。
// 同一份 HTML 必须返回同一批对象：wireKeyEditors 挂的 handler 与测试 fire 的是同一批。
let blocksCache = null;
let blocksCacheFor = '';
function parseKeyBlocks(html) {
  if (blocksCache !== null && blocksCacheFor === html) return blocksCache;
  blocksCacheFor = html;
  const blocks = [];
  const re = /<div class="mg-key" data-provider="([^"]+)">/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const provider = m[1];
    const block = fakeEl('mg-key');
    block.dataset.provider = provider;
    const children = {
      '.mg-key-input': fakeEl('input'),
      '.mg-key-save': fakeEl('button'),
      '.mg-key-test': fakeEl('button'),
      '.mg-key-msg': fakeEl('msg'),
    };
    block.querySelector = (s) => children[s] || fakeEl();
    block._children = children;
    blocks.push(block);
  }
  blocksCache = blocks;
  return blocks;
}

// ---------- 记录型 api stub ----------
const calls = { setCredential: [], mutate: [], discover: [] };
const rawApi = {
  getPresets: async () => ({ ok: true, presets: [] }),
  readPreset: async () => ({ ok: false }),
  openPresetDoc: async () => ({ ok: false }),
  getLlmProviders: async () => {
    const r = await fetch('http://127.0.0.1:3080/api/llm.providers', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'smoke-1', method: 'llm.providers', payload: {} }),
    });
    const b = await r.json();
    return b.result.ok ? { ok: true, providers: b.result.value.providers } : { ok: false, error: 'bad' };
  },
  getLlmModels: async () => {
    const r = await fetch('http://127.0.0.1:3080/api/llm.models', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'smoke-2', method: 'llm.models', payload: {} }),
    });
    const b = await r.json();
    return b.result.ok ? { ok: true, groups: b.result.value.groups, failures: b.result.value.failures } : { ok: false, error: 'bad' };
  },
  getSettingsDescribe: async () => ({
    ok: true,
    writable: true,
    hasDocument: true,
    namespaces: [
      { ns: 'llm-pi-ai', applies: 'live', revision: 1,
        value: { providers: { 'opencode-go': { apiKeyEnv: 'OPENCODE_GO_API_KEY' } } },
        user: { providers: { 'opencode-go': { apiKeyEnv: 'OPENCODE_GO_API_KEY' } } } },
      { ns: 'llm-deepseek', applies: 'live', revision: 0, value: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
    ],
  }),
  describeCredentials: async (refs) => {
    const credentials = {};
    for (const ref of refs || []) credentials[ref] = { configured: ref === 'DEEPSEEK_API_KEY', writable: true };
    return { ok: true, credentials };
  },
  setCredential: async (ref, value) => { calls.setCredential.push([ref, value]); return { ok: true }; },
  mutateSettings: async (ns, ops, expectedRevision) => { calls.mutate.push([ns, ops, expectedRevision]); return { ok: true }; },
  discoverModels: async (settingsNs, provider, apiKey) => {
    calls.discover.push([settingsNs, provider, apiKey]);
    return { ok: true, models: [{ id: 'claude-x', name: 'Claude X' }] };
  },
  getPluginCatalog: async () => ({ ok: true, plugins: [] }),
  getPresetDefault: async () => ({ ok: true, default: null }),
  setPresetDefault: async () => ({ ok: true }),
  openSettingsDoc: async () => ({ ok: false }),
  onState() {},
  getStatus: async () => ({ state: 'running', webUp: true }),
};

// 桥（preload）会随版本新增方法，这份手写清单必然滞后 —— 上一版就是因为缺 onUpdaterProgress
// 直接崩在 settings.js 的 bind() 里，整个冒烟测试失效。用 Proxy 兜底：未知方法一律返回
// { ok: false }，让被测代码走它自己的失败分支，而不是把测试一起带走。
// （已确认：settings.js / providers.js 里没有 `typeof api.x` 这类特性探测，兜底不会改变判定。）
const api = new Proxy(rawApi, {
  get(target, key) {
    if (key in target) return target[key];
    if (typeof key === 'symbol') return undefined;
    return async () => ({ ok: false, error: 'not stubbed: ' + String(key) });
  },
});

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  fetch,
  // providers.js 的 notifyChanged 会 new CustomEvent 并 window.dispatchEvent
  CustomEvent: class CustomEvent {
    constructor(type, init) { this.type = type; Object.assign(this, init || {}); }
  },
  localStorage: { getItem: () => null, setItem() {} },
  window: {
    api,
    __modal: undefined,
    // settings.js / providers.js 都通过 window.__i18n 取文案（i18n.js 暴露的桥）。
    // 冒烟测试直接回显 key —— 断言看的是结构而不是译文。
    __i18n: { t: (key) => key },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
  },
  document: {
    querySelector: (s) => el(s),
    querySelectorAll: (s) => s === '.mg-key' ? parseKeyBlocks(blocksCacheFor) : [],
  },
};
vm.createContext(sandbox);

const setListHtml = (html) => { blocksCacheFor = html; blocksCache = null; el('#modelGroupList').innerHTML = html; };
sandbox.setListHtml = setListHtml;
const lastListHtml = () => blocksCacheFor;

(async () => {
  // 模型配置（提供商）那块已经从 settings.js 拆到 providers.js，两个文件都要加载，
  // 否则下拉框 / 统计 / 密钥编辑器全是空的。
  // 把 renderModelGroups 里的 list.innerHTML = ... 重定向到 setListHtml，
  // 使 .mg-key 解析能看到最新渲染结果 —— 这一行现在在 providers.js 里。
  const patch = (code) => code.replace(
    "list.innerHTML = cards.join('');",
    "setListHtml(cards.join(''));",
  );

  const settingsCode = fs.readFileSync(path.join(RENDERER, 'settings.js'), 'utf8');
  const providersCode = fs.readFileSync(path.join(RENDERER, 'providers.js'), 'utf8');
  if (!patch(providersCode).includes('setListHtml(cards.join(')) {
    console.error('providers.js 里找不到 list.innerHTML = cards.join(\'\') —— 重定向补丁失效，测试会看到空列表');
    process.exit(1);
  }

  vm.runInContext(patch(settingsCode), sandbox, { filename: 'settings.js' });
  vm.runInContext(patch(providersCode), sandbox, { filename: 'providers.js' });
  await new Promise((r) => setTimeout(r, 300));

  // settings.js 的 init() 是靠 api.getStatus() 回调去刷模型目录的，而 providers.js 的入口
  // 要等它加载完才存在。真实应用里 getStatus 是 IPC 回调（必然晚于脚本加载），这里显式补一次
  // 刷新，免得测试依赖微任务时序。刷新是幂等的，多刷一次没有副作用。
  if (!sandbox.window.__providers) {
    console.error('providers.js 没有挂上 window.__providers');
    process.exit(1);
  }
  await sandbox.window.__providers.refresh();
  await new Promise((r) => setTimeout(r, 100));

  const failures = [];
  const sel = el('#providerSelect');
  const stats = el('#providerStats');

  // 1) 下拉框包含全部提供商
  const optCount = (sel.innerHTML.match(/<option /g) || []).length;
  if (optCount < 30) failures.push(`选项数异常: ${optCount}`);
  if (!sel.innerHTML.includes('value="deepseek-official"')) failures.push('缺少 deepseek-official');
  if (!sel.innerHTML.includes('value="anthropic"')) failures.push('缺少 anthropic');
  if (!/个提供商可选/.test(stats.innerHTML)) failures.push('统计缺少提供商数');
  if (!stats.innerHTML.includes('设置只读')) {
    // writable=true 时不应出现只读标记
  } else failures.push('writable=true 却显示只读');

  // 2) 选中未启用提供商 anthropic → 密钥编辑器（ANTHROPIC_API_KEY）
  const provEl = el('#providerSelect');
  provEl.value = 'anthropic';
  provEl.fire('change');
  const idleHtml = el('#modelGroupList').innerHTML;
  if (!idleHtml.includes('mg-idle')) failures.push('anthropic 未渲染 idle 卡片');
  if (!idleHtml.includes('ANTHROPIC_API_KEY')) failures.push('密钥引用未派生 ANTHROPIC_API_KEY');
  if (!idleHtml.includes('未配置密钥')) failures.push('缺少未配置徽章');
  if (!idleHtml.includes('mg-key-input') || !idleHtml.includes('保存密钥') || !idleHtml.includes('测试连接')) {
    failures.push('密钥编辑器控件缺失');
  }

  let blocks = parseKeyBlocks(el('#modelGroupList').innerHTML);
  const anthropicBlock = blocks.find((b) => b.dataset.provider === 'anthropic');
  if (!anthropicBlock) failures.push('anthropic 的 .mg-key 块未解析');

  if (anthropicBlock) {
    const input = anthropicBlock._children['.mg-key-input'];
    const msg = anthropicBlock._children['.mg-key-msg'];
    const save = anthropicBlock._children['.mg-key-save'];
    const test = anthropicBlock._children['.mg-key-test'];

    // 3a) 空密钥保存 → 提示，不调 RPC
    save.fire('click');
    await new Promise((r) => setTimeout(r, 50));
    if (calls.setCredential.length !== 0) failures.push('空密钥不应触发 credentials.set');
    if (!msg.innerHTML.includes('请先粘贴')) failures.push('空密钥提示缺失: ' + msg.innerHTML);

    // 3b) 填密钥保存 → credentials.set + settings.mutate
    input.value = 'sk-ant-test';
    save.fire('click');
    await new Promise((r) => setTimeout(r, 80));
    if (calls.setCredential.length !== 1 || calls.setCredential[0][0] !== 'ANTHROPIC_API_KEY' || calls.setCredential[0][1] !== 'sk-ant-test') {
      failures.push('credentials.set 调用不符: ' + JSON.stringify(calls.setCredential));
    }
    if (calls.mutate.length !== 1 || calls.mutate[0][0] !== 'llm-pi-ai'
      || JSON.stringify(calls.mutate[0][1]) !== JSON.stringify([{ op: 'set', path: ['providers', 'anthropic', 'apiKeyEnv'], value: 'ANTHROPIC_API_KEY' }])
      || calls.mutate[0][2] !== 1) {
      failures.push('settings.mutate 调用不符: ' + JSON.stringify(calls.mutate));
    }
    // 保存成功触发 refreshModels → 重新渲染（新块）
    await new Promise((r) => setTimeout(r, 300));
    blocks = parseKeyBlocks(el('#modelGroupList').innerHTML);
    const fresh = blocks.find((b) => b.dataset.provider === 'anthropic');
    if (!fresh) failures.push('保存后重渲染丢失 anthropic 块');

    // 4) 测试连接 → discoverModels 带输入框密钥
    const freshInput = fresh._children['.mg-key-input'];
    const freshMsg = fresh._children['.mg-key-msg'];
    const freshTest = fresh._children['.mg-key-test'];
    freshInput.value = 'sk-ant-probe';
    freshTest.fire('click');
    await new Promise((r) => setTimeout(r, 50));
    if (calls.discover.length !== 1 || calls.discover[0][0] !== 'llm-pi-ai' || calls.discover[0][1] !== 'anthropic' || calls.discover[0][2] !== 'sk-ant-probe') {
      failures.push('discoverModels 调用不符: ' + JSON.stringify(calls.discover));
    }
    if (!freshMsg.innerHTML.includes('连接成功') || !freshMsg.innerHTML.includes('Claude X')) {
      failures.push('测试连接成功提示缺失: ' + freshMsg.innerHTML);
    }
  }

  // 5) 已启用且有模型的提供商 → 无密钥编辑器
  //    注意判据要用真正的编辑器控件，不能用宽泛的 `mg-key` 类：
  //    groupCard() 给「编辑提供商配置」折叠框挂的就是 `mg-edit-box mg-key`，
  //    任何 pi-ai 分组卡片都会命中 mg-key，早先写的 `includes('mg-key')` 必然误报。
  const hasKeyEditor = (html) => /mg-key-input|mg-key-save/.test(html);
  provEl.value = 'deepseek-official';
  provEl.fire('change');
  const dsHtml = el('#modelGroupList').innerHTML;
  if (hasKeyEditor(dsHtml)) failures.push('deepseek-official 不应出现密钥编辑器');
  if (!dsHtml.includes('deepseek-v4-flash')) failures.push('deepseek-official 模型未渲染');

  // 6) 全部视图恢复
  provEl.value = '';
  provEl.fire('change');
  const allHtml = el('#modelGroupList').innerHTML;
  if (!allHtml.includes('opencode-go') || !allHtml.includes('deepseek-official')) failures.push('全部视图恢复失败');
  if (hasKeyEditor(allHtml)) failures.push('全部视图不应出现密钥编辑器（无失败提供商）');

  if (failures.length) {
    console.error('\nFAILURES:\n' + failures.join('\n'));
    process.exit(1);
  }
  console.log('\nALL CHECKS PASSED  (providers=' + optCount + ', credentials.set=' + calls.setCredential.length
    + ', mutate=' + calls.mutate.length + ', discover=' + calls.discover.length + ')');
})().catch((e) => { console.error(e); process.exit(1); });
