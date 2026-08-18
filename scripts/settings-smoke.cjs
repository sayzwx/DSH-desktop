/**
 * settings.js 冒烟测试：用最小 DOM shim 加载真实 settings.js，
 * 以 live harness 的 llm.providers / llm.models 数据驱动，断言：
 *  1) 提供商下拉框包含全部提供商（含分组与模型数）
 *  2) 未启用提供商渲染密钥编辑器（ref 派生、状态徽章）
 *  3) 保存密钥 → credentials.set + settings.mutate 顺序调用
 *  4) 测试连接 → llm.discoverModels 携带输入框密钥
 *  5) 已启用且有模型的提供商不出现密钥编辑器
 * 用法: node scripts/settings-smoke.cjs
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
const api = {
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

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  fetch,
  localStorage: { getItem: () => null, setItem() {} },
  window: { api, __modal: undefined },
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
  const code = fs.readFileSync(path.join(RENDERER, 'settings.js'), 'utf8');
  // 把 renderModelGroups 里的 list.innerHTML = ... 重定向到 setListHtml，
  // 使 .mg-key 解析能看到最新渲染结果
  const patched = code.replace(
    "list.innerHTML = cards.join('');",
    "setListHtml(cards.join(''));",
  );
  vm.runInContext(patched, sandbox, { filename: 'settings.js' });
  await new Promise((r) => setTimeout(r, 300));

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
  provEl.value = 'deepseek-official';
  provEl.fire('change');
  const dsHtml = el('#modelGroupList').innerHTML;
  if (dsHtml.includes('mg-key')) failures.push('deepseek-official 不应出现密钥编辑器');
  if (!dsHtml.includes('deepseek-v4-flash')) failures.push('deepseek-official 模型未渲染');

  // 6) 全部视图恢复
  provEl.value = '';
  provEl.fire('change');
  const allHtml = el('#modelGroupList').innerHTML;
  if (!allHtml.includes('opencode-go') || !allHtml.includes('deepseek-official')) failures.push('全部视图恢复失败');
  if (allHtml.includes('mg-key')) failures.push('全部视图不应出现密钥编辑器（无失败提供商）');

  if (failures.length) {
    console.error('\nFAILURES:\n' + failures.join('\n'));
    process.exit(1);
  }
  console.log('\nALL CHECKS PASSED  (providers=' + optCount + ', credentials.set=' + calls.setCredential.length
    + ', mutate=' + calls.mutate.length + ', discover=' + calls.discover.length + ')');
})().catch((e) => { console.error(e); process.exit(1); });
