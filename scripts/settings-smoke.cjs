/**
 * 设置页「模型配置」冒烟测试：用最小 DOM shim 加载真实 renderer/settings.js +
 * renderer/providers.js（提供商那部分已从 settings.js 拆出），
 * 以 live harness 的 llm.providers / llm.models 数据驱动，断言：
 *  1) 提供商下拉框包含全部提供商（含分组与模型数）
 *  2) 未启用提供商渲染密钥编辑器（ref 派生、状态徽章）
 *  3) 保存密钥 → credentials.set + settings.mutate 顺序调用
 *  4) 测试连接 → llm.discoverModels 携带输入框密钥
 *  5) 已启用且有模型的提供商不出现密钥编辑器
 *  6) 「刷新模型」→ discoverModels 带路由的 api/baseURL、差异写回 llm-pi-ai，
 *     并广播 dsh:models-refreshed（对话框靠它同步重读模型列表）
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
const calls = { setCredential: [], mutate: [], discover: [], probe: [] };
// 渲染层广播的事件（providers.js 靠它通知对话框重读模型列表）
const events = [];
// live harness 当前真的在服务的模型分组（用于「全部视图」的数据驱动断言）
const liveGroupIds = [];
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
    if (b.result.ok) {
      liveGroupIds.length = 0;
      for (const g of b.result.value.groups || []) liveGroupIds.push(g.id);
      return { ok: true, groups: b.result.value.groups, failures: b.result.value.failures };
    }
    return { ok: false, error: 'bad' };
  },
  getSettingsDescribe: async () => ({
    ok: true,
    writable: true,
    hasDocument: true,
    namespaces: [
      // 两个「已添加」的提供商，正好覆盖「刷新模型」的两条路径：
      //  - opencode-go：只有 apiKeyEnv，没有端点 → 清单由目录/内置目录作答，不做筛查
      //  - ali：手写路由（api + baseURL + 已有模型清单）→ 走端点清单 + 两段体检 + 差异写回
      { ns: 'llm-pi-ai', applies: 'live', revision: 1,
        value: {
          providers: {
            'opencode-go': { apiKeyEnv: 'OPENCODE_GO_API_KEY' },
            ali: {
              apiKeyEnv: 'ALI_API_KEY',
              displayName: '阿里云百炼',
              api: 'openai-completions',
              baseURL: 'https://dashscope.example/v1',
              models: [
                { id: 'qwen-a', name: 'Qwen A', contextWindow: 100000 },
                { id: 'qwen-gone', name: 'Qwen Gone' },
              ],
            },
          },
        },
        user: {
          providers: {
            'opencode-go': { apiKeyEnv: 'OPENCODE_GO_API_KEY' },
            ali: {
              apiKeyEnv: 'ALI_API_KEY',
              displayName: '阿里云百炼',
              api: 'openai-completions',
              baseURL: 'https://dashscope.example/v1',
              models: [
                { id: 'qwen-a', name: 'Qwen A', contextWindow: 100000 },
                { id: 'qwen-gone', name: 'Qwen Gone' },
              ],
            },
          },
        } },
      { ns: 'llm-deepseek', applies: 'live', revision: 0, value: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
    ],
  }),
  describeCredentials: async (refs) => {
    const credentials = {};
    for (const ref of refs || []) credentials[ref] = { configured: ref === 'DEEPSEEK_API_KEY' || ref === 'ALI_API_KEY', writable: true };
    return { ok: true, credentials };
  },
  setCredential: async (ref, value) => { calls.setCredential.push([ref, value]); return { ok: true }; },
  mutateSettings: async (ns, ops, expectedRevision) => { calls.mutate.push([ns, ops, expectedRevision]); return { ok: true, revision: 2 }; },
  discoverModels: async (settingsNs, provider, apiKey, api, baseURL) => {
    calls.discover.push([settingsNs, provider, apiKey, api, baseURL]);
    // ali 的端点「现在」列出了 qwen-new（新上线，故意排在清单最前）与 qwen-a（已在配置里），
    // 且已不列 qwen-gone（下线）。端点顺序与配置顺序不同是有意的：用来钉住
    // 「刷新只增删条目，不按清单重排用户已有的顺序」这条约定。
    if (provider === 'ali') {
      return { ok: true, models: [{ id: 'qwen-new', name: 'Qwen New', contextWindow: 200000 }, { id: 'qwen-a', name: 'Qwen A' }] };
    }
    return { ok: true, models: [{ id: 'claude-x', name: 'Claude X' }] };
  },
  // 体检分两段：先 aliveOnly 筛查，再对存活的做完整探测（补齐思考档位）
  probeCapabilities: async (payload) => {
    calls.probe.push(payload);
    const ids = payload.models || [];
    if (payload.aliveOnly) {
      return { ok: true, hadKey: true, results: ids.map((id) => (id === 'qwen-new' ? { id, alive: true, contextWindow: 200000 } : { id, alive: false, error: 'HTTP 400 not activated' })) };
    }
    return { ok: true, hadKey: true, results: ids.map((id) => ({ id, alive: true, contextWindow: 200000, maxTokens: 65536, reasoningEfforts: { off: 'none', medium: 'medium' } })) };
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
    // 「刷新模型」完成时要广播 dsh:models-refreshed（对话框靠它重读模型列表），
    // 所以这里记下事件类型而不只是吞掉。
    dispatchEvent(e) { events.push(e && e.type); return true; },
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
  //    判据用**当前引擎真的在服务的分组**（llm.models），不写死某个提供商：
  //    写死会随本机配置漂移 —— 例如把某个提供商的清单清空后它就不再分组，
  //    于是断言会在代码没坏的时候失败（这正是它此前红着的原因）。
  provEl.value = '';
  provEl.fire('change');
  const allHtml = el('#modelGroupList').innerHTML;
  if (liveGroupIds.length === 0) failures.push('live harness 没有任何模型分组，无法验证全部视图');
  for (const gid of liveGroupIds) {
    if (!allHtml.includes(gid)) failures.push('全部视图缺少分组 ' + gid);
  }
  if (hasKeyEditor(allHtml)) failures.push('全部视图不应出现密钥编辑器（无失败提供商）');

  // 7) 「刷新模型」：向已添加的提供商重新问一遍清单，把差异写回配置，并广播给对话框。
  //    这是本次新增的能力 —— 旧实现只是重读一遍引擎当前加载了什么，清单本身不会因此变长。
  if (typeof sandbox.window.__providers.syncModels !== 'function') {
    failures.push('providers.js 没有暴露 window.__providers.syncModels（对话框刷新入口与设置页共用它）');
  }
  calls.discover.length = 0;
  calls.mutate.length = 0;
  calls.probe.length = 0;
  events.length = 0;

  const refreshBtn = el('#refreshModelsBtn');
  const syncOut = el('#modelSyncOutput');
  if (!syncOut || !('textContent' in syncOut)) {
    failures.push('index.html 缺少 #modelSyncOutput 进度框');
  }
  refreshBtn.fire('click');
  // 刷新要打真实引擎（读提供商/模型目录）+ 两轮 stub 探测，等它写出「刷新完成」再断言
  const syncDeadline = Date.now() + 15000;
  while (Date.now() < syncDeadline && !/刷新完成/.test(syncOut.textContent || '')) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!/刷新完成/.test(syncOut.textContent || '')) {
    failures.push('「刷新模型」未在 15s 内完成：' + String(syncOut.textContent || '').slice(0, 300));
  }

  // 7a) 每个已添加的提供商都要被问到；手写路由必须带上路由自己的 api/baseURL ——
  //     引擎不会自己去读路由配置，漏传就只会回 "pi-ai ships no catalog for provider ali"。
  const aliDisc = calls.discover.find((c) => c[1] === 'ali');
  if (!aliDisc) failures.push('ali 未被刷新（已添加的提供商必须都问到）');
  else if (aliDisc[3] !== 'openai-completions' || aliDisc[4] !== 'https://dashscope.example/v1') {
    failures.push('ali 的 discoverModels 未带路由 api/baseURL：' + JSON.stringify(aliDisc));
  }
  if (!calls.discover.some((c) => c[1] === 'opencode-go')) failures.push('opencode-go 未被刷新');

  // 7b) 两段体检：先 aliveOnly 筛查（并发 8），再对存活的补齐能力
  const screen = calls.probe.find((p) => p.aliveOnly === true);
  if (!screen) failures.push('未做 aliveOnly 候选筛查');
  else {
    if (screen.baseURL !== 'https://dashscope.example/v1') failures.push('筛查未带端点地址');
    if (screen.apiKeyEnv !== 'ALI_API_KEY') failures.push('筛查未传凭据引用名（明文不该出主进程）');
    if (!(screen.models || []).includes('qwen-new')) failures.push('新上线的 qwen-new 未进入筛查');
    if ((screen.models || []).includes('qwen-a')) failures.push('已在配置里的 qwen-a 不该被当候选筛查');
    if (screen.concurrency !== 8) failures.push('筛查并发度不是 8：' + screen.concurrency);
  }
  const deep = calls.probe.find((p) => p.aliveOnly !== true && (p.models || []).includes('qwen-new'));
  if (!deep) failures.push('筛查通过的 qwen-new 未做完整能力探测');

  // 7c) 差异写回：新上线的收进来（带探测到的能力）、已下线的移除、已有的原样保留。
  //     基线必须取用户层，且只发真正变化的 set。
  const aliMut = calls.mutate.map((c) => (c[1] || []).find((op) => op.path && op.path[1] === 'ali' && op.path[2] === 'models')).find(Boolean);
  if (!aliMut) failures.push('ali 的模型清单没有写回 llm-pi-ai：' + JSON.stringify(calls.mutate));
  else {
    const ids = (aliMut.value || []).map((m) => m.id);
    // 顺序断言：qwen-a 是原有条目，qwen-new 是新收的 —— 端点把 qwen-new 排在最前，
    // 但写回必须保持「原有在前、新增追加在后」，否则每次刷新都会把用户的模型列表重排一遍。
    if (JSON.stringify(ids) !== JSON.stringify(['qwen-a', 'qwen-new'])) {
      failures.push('写回的模型清单不符（原有条目顺序应保持、新增追加在后）：' + JSON.stringify(ids));
    }
    if (ids.includes('qwen-gone')) failures.push('已下线的 qwen-gone 应被移除');
    const kept = (aliMut.value || []).find((m) => m.id === 'qwen-a');
    if (!kept || kept.contextWindow !== 100000 || kept.name !== 'Qwen A') {
      failures.push('已有条目 qwen-a 的元数据未原样保留：' + JSON.stringify(kept));
    }
    const added = (aliMut.value || []).find((m) => m.id === 'qwen-new');
    if (!added || added.contextWindow !== 200000 || added.maxTokens !== 65536 || !added.reasoningEfforts) {
      failures.push('新条目 qwen-new 未带上探测到的能力：' + JSON.stringify(added));
    }
  }
  // 无端点的目录型提供商也要写回，但不做筛查（清单本身就是权威）
  const ogMut = calls.mutate.map((c) => (c[1] || []).find((op) => op.path && op.path[1] === 'opencode-go' && op.path[2] === 'models')).find(Boolean);
  if (!ogMut || ogMut.value[0].id !== 'claude-x') failures.push('opencode-go 的清单未写回：' + JSON.stringify(calls.mutate));
  if (calls.probe.some((p) => (p.models || []).some((m) => m.startsWith('claude')))) {
    failures.push('没有 baseURL 的目录型路由不该发探测请求');
  }

  // 7d) 写回只发 models，不能把 schema 默认值一起固化（同「保存」路径的约定）
  for (const [ns, ops] of calls.mutate) {
    if (ns !== 'llm-pi-ai') failures.push('写回了错误的命名空间：' + ns);
    for (const op of ops || []) {
      if (op.op !== 'set' || op.path.length !== 3 || op.path[2] !== 'models') {
        failures.push('刷新只应写 providers.<id>.models：' + JSON.stringify(op));
      }
    }
  }
  // 乐观并发：带上当前 revision，否则会被 settings.mutate 挡下
  if (calls.mutate.some((c) => c[2] !== 1 && c[2] !== 2)) {
    failures.push('mutate 未带 revision：' + JSON.stringify(calls.mutate.map((c) => c[2])));
  }

  // 7e) 广播：对话框（chat.js）的模型选择器靠这个事件同步重读 session.models
  if (!events.includes('dsh:models-refreshed')) {
    failures.push('刷新完成后未广播 dsh:models-refreshed：' + JSON.stringify(events));
  }
  if (!/新增 1 个可用模型/.test(syncOut.textContent || '')) {
    failures.push('进度总结未报出新增数量：' + String(syncOut.textContent || '').slice(-200));
  }

  if (failures.length) {
    console.error('\nFAILURES:\n' + failures.join('\n'));
    process.exit(1);
  }
  console.log('\nALL CHECKS PASSED  (providers=' + optCount + ', credentials.set=' + calls.setCredential.length
    + ', refresh: discover=' + calls.discover.length + ', probe=' + calls.probe.length
    + ', mutate=' + calls.mutate.length + ', events=' + JSON.stringify(events) + ')');
})().catch((e) => { console.error(e); process.exit(1); });
