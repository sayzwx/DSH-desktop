/**
 * 模型配置（提供商管理）：提供商目录、API 密钥、每条路由的 api / baseURL / 模型清单
 *
 * 这一块是从 `renderer/settings.js` 里**整块搬出来**的 —— settings.js 曾因此膨胀到 1766 行，
 * 而它独占 124–1140 行（1017 行、58%），再往里加功能就会很难维护。
 * 块内代码逐字节未改，只额外做了两件事：
 *   1. 每个「保存 / 删除成功后刷新」处补一次 `notifyChanged()`，让「配置仓库」页跟着重读；
 *   2. 原先散在 settings.js `bind()` 里的三个事件绑定收进本文件的 `wire()`。
 *
 * 对外接口：`window.__providers.refresh()`（settings.js 在引擎状态变化时调用）。
 * 跨模块刷新走 `dsh:settings-saved` 事件，`detail.source` 用来防回环。
 *
 * @module renderer/providers
 */
(function () {
  'use strict';

  const api = window.api;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // ---------------- 模型配置 ----------------
  // 数据源：
  //  - llm.providers -> 提供商目录（全部可选，含启用状态与配置位置）
  //  - llm.models    -> 已加载的模型分组 + 加载失败原因
  //  - settings.describe -> 命名空间视图（llm-pi-ai 的 apiKeyEnv / revision / writable）
  //  - credentials.describe -> 每个派生密钥引用的已配置状态
  let providersAll = [];
  let modelGroupsAll = [];
  let modelFailures = [];
  let nsViews = {};    // ns -> settings.describe 命名空间视图
  let credStates = {}; // ref -> { configured, writable }
  let settingsWritable = true;
  let syncRunning = false; // 「刷新模型」互斥：设置页与对话框两个入口可能被同时点到

  function providerOf(id) {
    return providersAll.find((p) => p.provider === id);
  }
  function groupOf(id) {
    return modelGroupsAll.find((g) => g.id === id);
  }
  function failureOf(id) {
    return modelFailures.find((f) => f.id === id);
  }

  /** 与 Web UI 相同的约定：provider 路由 id -> 凭据引用名（如 anthropic -> ANTHROPIC_API_KEY）。 */
  function deriveKeyRef(provider) {
    return provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_') + '_API_KEY';
  }

  /** 该提供商配置里已记录的 apiKeyEnv（llm-pi-ai 的 providers.<name>），无则 undefined。 */
  function apiKeyEnvOf(provider) {
    const ns = nsViews['llm-pi-ai'];
    const profile = ns && ns.value && ns.value.providers ? ns.value.providers[provider] : undefined;
    return profile && typeof profile.apiKeyEnv === 'string' && profile.apiKeyEnv.length > 0
      ? profile.apiKeyEnv
      : undefined;
  }

  /**
   * 读一遍模型配置的全部外部事实：提供商目录、引擎当前在服务的模型目录、命名空间视图，
   * 再补一次凭据状态。
   *
   * 抽成独立函数是因为「刷新模型」不能只靠 refreshModels()：那边只是**重读**引擎当前
   * 加载了什么，而引擎加载什么完全由 settings.yaml 里写死的 `providers.<id>.models` 决定。
   * 厂商上线新模型时那串 id 不会自己变长，于是重读永远拿到旧清单 —— 这正是「刷新」按钮
   * 曾经点了没反应的原因。全量刷新需要同一份事实，但要多做一步「写回配置」。
   *
   * @returns {Promise<{ lp: object, lm: object }>} 两个目录调用的原始回执，调用方据此决定如何报错。
   */
  async function loadModelConfigState() {
    const [lp, lm, sd] = await Promise.all([
      api.getLlmProviders(),
      api.getLlmModels(),
      api.getSettingsDescribe(),
    ]);
    providersAll = lp.ok ? lp.providers || [] : [];
    modelGroupsAll = lm.ok ? lm.groups || [] : [];
    modelFailures = lm.ok ? lm.failures || [] : [];
    nsViews = {};
    settingsWritable = true;
    if (sd.ok) {
      settingsWritable = sd.writable !== false;
      for (const n of sd.namespaces || []) nsViews[n.ns] = n;
      // 合并 llm-pi-ai 中用户自定义的提供商：写入 settings 但尚未出现在 llm.providers
      // 目录时，也能在下拉框/卡片中显示、编辑与删除（与官方 webUI 一致）。
      const pi = nsViews['llm-pi-ai'];
      const userProviders = pi && pi.value && pi.value.providers ? pi.value.providers : {};
      for (const [id, profile] of Object.entries(userProviders)) {
        if (!profile || typeof profile !== 'object') continue;
        if (providersAll.some((p) => p.provider === id)) continue;
        providersAll.push({
          provider: id,
          displayName: (typeof profile.displayName === 'string' && profile.displayName) ? profile.displayName : id,
          active: !!profile.apiKeyEnv || !!(profile.baseURL && Array.isArray(profile.models) && profile.models.length > 0),
          settingsNs: 'llm-pi-ai',
          settingsPath: ['providers', id],
        });
      }
    }
    // 批量查询每个提供商实际使用的密钥引用状态（一个往返）
    const refs = [...new Set(providersAll.map((p) => apiKeyEnvOf(p.provider) || deriveKeyRef(p.provider)))];
    const cr = refs.length > 0 ? await api.describeCredentials(refs) : { ok: true, credentials: {} };
    credStates = cr.ok ? cr.credentials || {} : {};
    return { lp, lm };
  }

  async function refreshModels() {
    const stats = $('#providerStats');
    const sel = $('#providerSelect');
    const { lp, lm } = await loadModelConfigState();
    if (!lp.ok && !lm.ok) {
      sel.innerHTML = '<option value="">（获取失败）</option>';
      stats.innerHTML = `<div class="empty">模型目录获取失败：${esc(lp.error || lm.error)}</div>`;
      $('#modelGroupList').innerHTML = '';
      return;
    }
    renderProviderSelect(sel);
    renderModelGroups();
    const active = providersAll.filter((p) => p.active).length;
    const anyKey = Object.values(credStates || {}).some((c) => c && c.configured);
    stats.innerHTML =
      `<span class="pstat">${providersAll.length} 个提供商可选</span>` +
      `<span class="pstat ok">${active} 个已启用</span>` +
      `<span class="pstat">${modelGroupsAll.length} 个有可用模型</span>` +
      (modelFailures.length ? `<span class="pstat warn">${modelFailures.length} 个加载失败</span>` : '') +
      (settingsWritable ? '' : '<span class="pstat warn">设置只读</span>');
    renderFirstRunGuide(active, anyKey, modelGroupsAll.length);
  }

  // 无任何已配置密钥/模型时的引导说明（首次使用引导）
  function renderFirstRunGuide(activeCount, anyKey, modelGroupCount) {
    const list = $('#modelGroupList');
    if (!list) return;
    if (activeCount > 0 || anyKey || modelGroupCount > 0) return; // 已配置过，不需要引导
    const guide = document.createElement('div');
    guide.className = 'model-first-run';
    guide.innerHTML = `
      <div class="mfr-title">🚀 首次使用：先配置一个模型</div>
      <div class="mfr-desc">还没有可用的模型。在上方选择一个提供商，粘贴 API 密钥即可启用；</div>
      <div class="mfr-desc">或者直接使用 <strong>DeepSeek 官方 API</strong>（官方模型路由最稳定）。</div>
      <div class="mfr-actions">
        <button type="button" class="mini-btn mfr-goto-deepseek">配置 DeepSeek 官方 API</button>
        <button type="button" class="mini-btn mfr-open-select">查看其它提供商</button>
      </div>`;
    list.prepend(guide);
    const ds = guide.querySelector('.mfr-goto-deepseek');
    if (ds) ds.addEventListener('click', () => { $('#providerSelect').value = 'deepseek-official'; renderModelGroups(); });
    const os = guide.querySelector('.mfr-open-select');
    if (os) os.addEventListener('click', () => { $('#providerSelect').focus(); (window.__modal || { alert: () => {} }).alert('请从下拉框选择提供商（如 opencode / anthropic / openai 等），粘贴对应 API 密钥即可。', '选择提供商'); });
  }

  /** 下拉选项文案：带模型数 / 失败标记，让 37 个提供商一目了然。 */
  function providerOptionLabel(p) {
    const g = groupOf(p.provider);
    const f = failureOf(p.provider);
    if (g) return `${p.displayName || p.provider}（${g.models.length} 个模型）`;
    if (f) return `${p.displayName || p.provider}（加载失败）`;
    return p.displayName || p.provider;
  }

  function renderProviderSelect(sel) {
    const current = sel.value;
    const active = providersAll.filter((p) => p.active);
    const inactive = providersAll.filter((p) => !p.active);
    const opts = (list) =>
      list.map((p) => `<option value="${esc(p.provider)}">${esc(providerOptionLabel(p))}</option>`).join('');
    const html = [`<option value="">全部提供商（${providersAll.length} 个）</option>`];
    if (active.length > 0) html.push(`<optgroup label="已启用（${active.length}）">${opts(active)}</optgroup>`);
    if (inactive.length > 0) html.push(`<optgroup label="未启用（${inactive.length}）">${opts(inactive)}</optgroup>`);
    sel.innerHTML = html.join('');
    if (providersAll.some((p) => p.provider === current)) sel.value = current;
    else sel.value = '';
  }

  function groupCard(g, p) {
    const isPiAi = p && p.settingsNs === 'llm-pi-ai';
    const removable = isPiAi && isProviderRemovable(p.provider);
    return `<div class="model-group">
      <div class="mg-head"><span class="mg-name">${esc(g.name || g.id)}</span><code class="mg-id">${esc(g.id)}</code>
        ${p ? `<span class="badge ${p.active ? 'trust-system' : 'trust-user'}">${p.active ? '已启用' : '未启用'}</span>` : ''}</div>
      <div class="mg-models">${(g.models || []).map((m) => `<span class="mg-chip" title="${esc(m.id)}">${esc(m.name || m.id)}</span>`).join('') || '<span class="empty">（空）</span>'}</div>
      ${isPiAi ? `<div class="mg-key-actions">
        <button class="mini-btn mg-edit" type="button" title="修改 API 协议 / baseURL / 模型列表">编辑提供商配置</button>
        ${removable ? '<button class="mini-btn danger-btn mg-rm" type="button">删除提供商</button>' : ''}
      </div>
      <div class="mg-edit-box mg-key" data-provider="${esc(p.provider)}" style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border-strong)" hidden></div>
      <div class="mg-key-msg mg-key" data-provider="${esc(p.provider)}" style="margin-top:6px"></div>` : ''}
    </div>`;
  }

  /** 为"已启用 / 有模型分组"的提供商卡片挂接编辑与删除操作（与 keyEditor 同逻辑）。 */
  function wireGroupCardOps() {
    document.querySelectorAll('.model-group .mg-edit').forEach((btn) => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      const card = btn.closest('.model-group');
      const block = card.querySelector('.mg-edit-box, .mg-key[data-provider]');
      const provider = block && block.dataset.provider;
      const editBox = card.querySelector('.mg-edit-box');
      const msgBox = card.querySelector('.mg-key-msg');
      if (!provider || !editBox) return;
      const p = providerOf(provider);
      if (!p) return;

      btn.addEventListener('click', () => {
        if (!editBox.hidden) { editBox.hidden = true; return; }
        renderProviderEditor(editBox, provider);
      });

      wireZenUaBtn(card, provider);

      const rmBtn = card.querySelector('.mg-rm');
      if (rmBtn) rmBtn.addEventListener('click', async () => {
        const ok = window.__modal
          ? await window.__modal.confirm(`确定删除提供商 <strong>${esc(provider)}</strong> 的整份配置与对应 API 密钥？\n（此操作不可撤销，将移除其全部自定义模型）`, '删除提供商', { okText: '确认删除' })
          : confirm(`确定删除提供商 ${provider} 的配置与密钥？`);
        if (!ok) return;
        rmBtn.disabled = true; rmBtn.textContent = '删除中…';
        try {
          const ns = nsViews['llm-pi-ai'];
          const cfg = providerConfigOf(provider);
          const keyRef = (cfg && cfg.apiKeyEnv) || deriveKeyRef(provider);
          await api.unsetCredential(keyRef).catch(() => {});
          const mut = await api.mutateSettings('llm-pi-ai',
            [{ op: 'unset', path: ['providers', provider] }],
            ns ? ns.revision : undefined);
          if (!mut.ok) {
            if (msgBox) msgBox.textContent = '删除失败：' + (mut.error || 'unknown');
            rmBtn.disabled = false; rmBtn.textContent = '删除提供商';
            return;
          }
          if (msgBox) msgBox.textContent = `已删除提供商 <code>${esc(provider)}</code> 及其密钥引用`;
          refreshModels(); notifyChanged();
        } catch (e) {
          if (msgBox) msgBox.textContent = '删除出错：' + (e.message || String(e));
          rmBtn.disabled = false; rmBtn.textContent = '删除提供商';
        }
      });
    });
  }

  /** 密钥编辑器：填写 API 密钥 → 保存（credentials.set + settings.mutate）→ 测试连接（llm.discoverModels）。
   *  另提供：编辑提供商配置（API 类型 / baseURL / 模型列表）与删除整个提供商。 */
  function keyEditor(p) {
    if (!p || p.settingsNs !== 'llm-pi-ai') return ''; // 仅聚合提供商目录下的路由支持此流程
    if (!settingsWritable) {
      return `<div class="mg-key" data-provider="${esc(p.provider)}">
        <div class="mg-key-msg">设置当前为只读（read-only settings provider），无法保存密钥。</div>
      </div>`;
    }
    const ref = apiKeyEnvOf(p.provider) || deriveKeyRef(p.provider);
    const st = credStates[ref] || {};
    const configured = !!st.configured;
    const locked = st.writable === false;
    const removable = isProviderRemovable(p.provider);
    return `<div class="mg-key" data-provider="${esc(p.provider)}">
      <div class="mg-key-head">
        <span class="mg-key-ref">${esc(ref)}</span>
        <span class="badge ${configured ? 'trust-system' : 'trust-user'}">${configured ? '已配置密钥' : '未配置密钥'}</span>
      </div>
      <div class="mg-key-row">
        <input type="password" class="sm-input mg-key-input" autocomplete="off"
          placeholder="${configured ? '已配置密钥，输入新值可覆盖保存' : '粘贴 ' + esc(ref) + ' 密钥…'}" ${locked ? 'disabled' : ''} />
        <button class="mini-btn mg-key-save" type="button" ${locked ? 'disabled' : ''}>保存密钥</button>
        <button class="mini-btn mg-key-test" type="button">测试连接</button>
      </div>
      <div class="mg-key-actions">
        <button class="mini-btn mg-edit" type="button" title="修改 API 类型 / baseURL / 模型列表">编辑提供商配置</button>
        ${p.provider === 'opencode' || p.provider === 'opencode-go' ? '<button class="mini-btn mg-zenua" type="button" title="OpenCode Zen 免费模型需本地 UA 代理（否则 429 FreeUsageLimitError）">⚡ 免费模型（UA 代理）</button>' : ''}
        ${removable ? '<button class="mini-btn danger-btn mg-rm" type="button">删除提供商</button>' : ''}
      </div>
      <div class="mg-zenua-box" hidden></div>
      <div class="mg-edit-box" hidden></div>
      <div class="mg-key-msg"></div>
    </div>`;
  }

  /** user 层有该 provider 而 base 没有 → 允许删除（与 Web UI 一致）。 */
  function isProviderRemovable(provider) {
    const ns = nsViews['llm-pi-ai'];
    if (!ns) return false;
    const base = ns.base && ns.base.providers ? ns.base.providers[provider] : undefined;
    const user = ns.user && ns.user.providers ? ns.user.providers[provider] : undefined;
    return !base && !!user;
  }

  /** 读取 llm-pi-ai 中某个 provider 的完整配置（merge 后的 value），无则返回空对象。 */
  function providerConfigOf(provider) {
    const ns = nsViews['llm-pi-ai'];
    const prov = ns && ns.value && ns.value.providers ? ns.value.providers[provider] : undefined;
    return (prov && typeof prov === 'object') ? prov : {};
  }

  /**
   * 读取该 provider 在**用户层**（settings.yaml 真正写下来的那部分）的配置。
   *
   * 为什么保存时必须用它当基线，而不是 {@link providerConfigOf} 的合并值：
   * settings.describe 的 `value` 是「schema 默认 + 用户值」叠加后的结果，里面带着一大堆
   * 用户从没填过的字段（defaultContextWindow / streamIdleTimeoutMs / modelOverrides / …）。
   * 拿它整段写回等于把这些默认值**固化**成用户数据 —— 文件越写越胖，而且将来引擎升级
   * 默认值时，这些旧值会盖住新值。官方 Web UI 的做法是"只写本界面看得见的字段"：
   * 以用户层为基线做 diff，只发 set/unset。
   */
  function userProviderConfigOf(provider) {
    const ns = nsViews['llm-pi-ai'];
    const prov = ns && ns.user && ns.user.providers ? ns.user.providers[provider] : undefined;
    return (prov && typeof prov === 'object') ? prov : {};
  }

  /** 结构化深拷贝（配置里全是 JSON 值，没有函数/日期）。 */
  function cloneJson(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }

  /**
   * 把 `after` 相对 `before` 的差异翻成最小的 set/unset 路径操作。
   * 与官方 `ui-settings-models/ProviderEditor.pathOps` 同语义：只点名动过的顶层字段。
   */
  function settingsPathOps(base, before, after) {
    const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    const prev = isPlain(before) ? before : {};
    const ops = [];
    for (const [key, value] of Object.entries(after)) {
      if (JSON.stringify(prev[key]) === JSON.stringify(value)) continue;
      ops.push({ op: 'set', path: [...base, key], value });
    }
    for (const key of Object.keys(prev)) {
      if (!(key in after)) ops.push({ op: 'unset', path: [...base, key] });
    }
    return ops;
  }

  /** 从 llm-pi-ai schema 动态提取 API 协议枚举（不等死硬编码，schema 增列自动跟随）。 */
  function piApiOptions() {
    const ns = nsViews['llm-pi-ai'];
    const refs = ns && ns.schema && typeof ns.schema === 'object' ? ns.schema.refs : null;
    if (!refs) return ['openai-completions', 'openai-responses', 'anthropic-messages'];
    const consts = new Map();
    let apiUnion = null;
    for (const [uid, node] of Object.entries(refs)) {
      if (node && node.type === 'const' && typeof node.value === 'string') consts.set(Number(uid), node.value);
      if (node && node.type === 'union' && Array.isArray(node.list)) {
        // api 协议的 union 恰好是 3 个值且含 'openai-completions' 的候选
        const vals = node.list.map((u) => consts.get(Number(u))).filter(Boolean);
        if (/openai-completions|anthropic-messages/.test(vals.join(' ')) && (!apiUnion || vals.length > apiUnion.length)) apiUnion = vals;
      }
    }
    if (apiUnion && apiUnion.length >= 2) return apiUnion;
    return ['openai-completions', 'openai-responses', 'anthropic-messages'];
  }
  function piApiLabel(v) {
    const map = { 'openai-completions': 'OpenAI Completions', 'openai-responses': 'OpenAI Responses', 'anthropic-messages': 'Anthropic Messages' };
    return map[v] || v;
  }

  /**
   * 渲染 provider 编辑面板（模仿 webUI 模型编辑）：
   *  - "自定义设置"可折叠，含 API 地址（提供方默认/自定义）与模型目录（↻ 更新模型与能力 / 添加模型）
   *  - 底部 取消 / 保存
   * 保存：把变更写回 llm-pi-ai 的 providers.<name>（set 整段 profile）；成功则刷新。
   * 返回一个 { close } 句柄，调用方用于收起面板。
   */
  /**
   * 「更新模型与能力」时，端点清单里新出现的模型最多体检多少个。
   * 端点常常列出几百个模型，其中大量是额度用尽/未开通的；逐个发探测请求太慢，
   * 所以设一个预算，超出部分留给下次刷新。
   */
  const NEW_MODEL_BUDGET = 40;

  function renderProviderEditor(editBox, provider) {
    const p = providerOf(provider);
    const cfg = providerConfigOf(provider);
    const apiOptions = piApiOptions();
    // 注意：这里的变量曾经叫 `api`，把模块级的 `api = window.api`（preload 桥）在整个函数里
    // 遮蔽成了协议字符串 —— 于是本函数里所有 api.setCredential / api.discoverModels /
    // api.mutateSettings 都会抛 "api.xxx is not a function"（保存密钥、测试连接、更新模型与能力、
    // 保存配置四个动作同时失灵）。改名 apiProto，桥调用重新指回 window.api。
    const apiProto = apiOptions.includes(cfg.api) ? cfg.api : apiOptions[0];
    const baseURL = cfg.baseURL || '';
    // 模型清单的工作副本**必须**取自用户层，不能取自合并值。
    // 合并值里的每个模型条目都被 schema 补齐了默认字段（`input: []`、`compat: {chatTemplateKwargs:{}}`），
    // 拿它当基线去 diff，任何一个模型数组都会"看起来变了"，于是保存时把整份清单连默认值一起写回——
    // 哪怕用户什么都没改。这正是「打开编辑器点一下保存就报错/写脏配置」的根因。
    const userCfg = userProviderConfigOf(provider);
    const models = Array.isArray(userCfg.models) ? userCfg.models.slice() : [];
    const ref = apiKeyEnvOf(provider) || deriveKeyRef(provider);
    const keySt = credStates[ref] || {};
    const keyConfigured = !!keySt.configured;
    const keyLocked = keySt.writable === false;

    // 上一次探测判定「端点当前拒绝该模型」的 id 集合。只用于界面标记，不进配置
    // （用独立的 Set 而不是往模型对象上挂字段，避免脏字段被一起写进 settings.yaml）。
    const deadIds = new Set();

    const modelRows = () => models
      .map((m, i) => {
        // reasoningEfforts 直接展示成档位串：这是「这个模型到底能不能调思考强度」的唯一可见答案，
        // 而它只能靠现场探测得到（厂商目录里的 capabilities 只说能不能思考，不说档位）。
        const eff = m.reasoningEfforts;
        const think = eff === false ? '不思考' : (eff && typeof eff === 'object' ? Object.keys(eff).join('/') : '');
        return `<div class="mg-model-row" data-i="${i}">
        <code class="mg-model-id">${esc(m.id)}</code>
        ${m.name ? `<span class="mg-model-name">${esc(m.name)}</span>` : ''}
        ${m.contextWindow ? `<span class="mg-model-dim">ctx ${esc(m.contextWindow)}</span>` : ''}
        ${m.maxTokens ? `<span class="mg-model-dim">max ${esc(m.maxTokens)}</span>` : ''}
        ${think ? `<span class="mg-model-dim mg-model-think">think ${esc(think)}</span>` : ''}
        ${deadIds.has(m.id) ? '<span class="mg-model-dead">当前不可用</span>' : ''}
        <button type="button" class="mini-btn mg-model-del" title="移除该模型">✕</button>
      </div>`;
      }).join('') || '<div class="mg-model-empty">模型选择器中将不显示任何模型；目录外 ID 仍可直接发送。</div>';

    editBox.innerHTML = `
      <div class="mg-edit-key">
        <div class="mg-edit-key-head">
          <span class="mg-key-ref">${esc(ref)}</span>
          <span class="badge ${keyConfigured ? 'trust-system' : 'trust-user'}">${keyConfigured ? '已配置——输入新值可替换' : '未配置密钥'}</span>
        </div>
        <div class="mg-edit-key-row">
          <input type="password" class="sm-input mg-edit-key-input" autocomplete="off"
            placeholder="${keyConfigured ? '输入新值可替换当前密钥…' : '粘贴 ' + esc(ref) + ' 密钥…'}" ${keyLocked ? 'disabled' : ''} />
          <button class="mini-btn mg-edit-key-save" type="button" ${keyLocked ? 'disabled' : ''}>保存密钥</button>
          <button class="mini-btn mg-edit-key-test" type="button">测试连接</button>
        </div>
        <div class="mg-edit-key-msg"></div>
      </div>
      <details class="mg-edit-details open">
        <summary>自定义设置</summary>
        <div class="mg-edit-grid">
          <label>API 协议
            <select class="sm-input mg-edit-api"${p && p.declared ? '' : ' disabled'}>
              ${apiOptions.map((v) => `<option value="${esc(v)}"${v === apiProto ? ' selected' : ''}>${esc(piApiLabel(v))}</option>`).join('')}
            </select>
          </label>
          ${p && p.declared ? '' : '<div class="mg-field-note">内置目录路由的协议由 pi-ai 逐模型决定，这里不能改——写一个路由级的会把该路由下所有模型的协议一起覆盖掉</div>'}
          <label>API 地址
            <select class="sm-input mg-edit-urlmode">
              <option value="default">提供方默认</option>
              <option value="custom"${baseURL ? ' selected' : ''}>自定义</option>
            </select>
            <input type="text" class="sm-input mg-edit-url" placeholder="https://api.example.com/v1"
              value="${esc(baseURL)}" ${baseURL ? '' : 'hidden'} />
          </label>
          <div class="mg-models-block">
            <div class="mg-models-head">
              <span>模型目录</span>
              <span class="mg-models-note">${p && p.declared
                ? '（手写路由：必须自己列全模型，一个都不能少）'
                : '（跟随 pi-ai 内置目录；一旦在这里列了模型，内置目录会被整份替换）'}</span>
            </div>
            <div class="mg-model-list">${modelRows()}</div>
            <div class="mg-add-model">
              <input type="text" class="sm-input mg-add-model-input" placeholder="输入模型 ID 添加，如 deepseek-v4-flash" />
              <button class="mini-btn mg-add-model-btn" type="button">添加模型</button>
            </div>
            <div class="mg-probe-row">
              <button class="mini-btn mg-probe-btn" type="button"
                title="重新问一遍端点：模型清单、上下文窗口、输出上限、可用思考档位、当前是否可用">↻ 更新模型与能力</button>
              <span class="mg-probe-note">会发少量 <code>max_tokens=1</code> 的探测请求，token 消耗可忽略</span>
            </div>
            <div class="mg-discover-output"></div>
          </div>
        </div>
      </details>
      <div class="mg-edit-actions">
        <button class="mini-btn mg-edit-cancel" type="button">取消</button>
        <button class="mini-btn primary-btn mg-edit-save" type="button">保存</button>
        <span class="mg-edit-msg"></span>
      </div>`;
    editBox.hidden = false;

    // ----- API 密钥：改 key（即时保存到 credentials；不改 settings 的引用名） -----
    const keyInput = editBox.querySelector('.mg-edit-key-input');
    const keySaveBtn = editBox.querySelector('.mg-edit-key-save');
    const keyTestBtn = editBox.querySelector('.mg-edit-key-test');
    const keyMsg = editBox.querySelector('.mg-edit-key-msg');
    const keyShow = (html, kind) => { keyMsg.innerHTML = html; keyMsg.className = 'mg-edit-key-msg' + (kind ? ' ' + kind : ''); };
    if (keySaveBtn) keySaveBtn.addEventListener('click', async () => {
      const key = (keyInput.value || '').trim();
      if (!key) { keyShow('<span class="warn">请先粘贴 API 密钥</span>', 'bad'); return; }
      keySaveBtn.disabled = true; keySaveBtn.textContent = '保存中…';
      try {
        const set = await api.setCredential(ref, key);
        if (!set.ok) { keyShow('保存密钥失败：' + esc(set.error || 'unknown'), 'bad'); return; }
        keyShow(`已保存 <code>${esc(ref)}</code>`, 'ok');
        if (keyInput) keyInput.value = '';
        refreshModels(); notifyChanged();
      } catch (e) {
        keyShow('保存出错：' + esc(e.message || String(e)), 'bad');
      } finally {
        keySaveBtn.disabled = false; keySaveBtn.textContent = '保存密钥';
      }
    });
    if (keyTestBtn) keyTestBtn.addEventListener('click', async () => {
      const key = (keyInput.value || '').trim();
      keyTestBtn.disabled = true; keyTestBtn.textContent = '测试中…';
      keyShow('正在连接端点并发现模型…', '');
      try {
        const ep = routeEndpoint();
        // 手写路由没有内置端点可退：地址空着就没法测，先在本地拦下来，别让引擎抛那句英文。
        if (p && p.declared && !ep.baseURL) {
          keyShow('该提供商由本配置手写声明，请先在下方「API 地址」里填写端点——pi-ai 没有它的内置端点', 'bad');
          return;
        }
        const r = await api.discoverModels(p.settingsNs, provider, key || undefined, ep.api, ep.baseURL || undefined);
        if (!r.ok) { keyShow('连接失败：' + esc(r.error || 'unknown'), 'bad'); return; }
        const modelsR = r.models || [];
        // 「能列出模型」不等于「密钥可用」：阿里云百炼这类端点的 GET /models 不校验授权
        // （不带密钥也能列出全量 261 个），而真正对话时才会回 403/401。
        // 所以再挑一个真实模型发一次最小请求，才算把这条路由测通。
        const target = (models[0] && models[0].id) || (modelsR[0] && modelsR[0].id);
        if (!target) { keyShow('连接成功，但该端点未返回任何模型', 'ok'); return; }
        keyShow(`端点可达（${modelsR.length} 个模型），正在用 <code>${esc(target)}</code> 做一次真实调用…`, '');
        const cap = await api.probeCapabilities({
          baseURL: ep.baseURL, api: ep.api, apiKey: key || undefined, apiKeyEnv: ref, models: [target],
        });
        const row = cap && cap.ok ? (cap.results || [])[0] : null;
        if (row && row.alive === false) {
          keyShow(`端点可达，但调用 <code>${esc(target)}</code> 被拒：${esc(String(row.error).slice(0, 220))}`
            + '<br>密钥或端点授权有问题——请确认用的是公共端点（百炼为 <code>dashscope.aliyuncs.com</code>），'
            + '工作空间专属端点会对普通调用回 403。', 'bad');
          return;
        }
        if (row && row.alive) {
          const eff = row.reasoningEfforts;
          const think = eff === false ? '不思考' : (eff && typeof eff === 'object' ? Object.keys(eff).join('/') : '未知');
          keyShow(`连接成功：${modelsR.length} 个模型，<code>${esc(target)}</code> 应答正常`
            + `（ctx ${row.contextWindow || '?'} / max ${row.maxTokens || '?'} / think ${esc(think)}）`, 'ok');
          return;
        }
        keyShow(`连接成功，发现 ${modelsR.length} 个模型（未能完成真实调用验证）`, 'ok');
      } catch (e) {
        keyShow('测试出错：' + esc(e.message || String(e)), 'bad');
      } finally {
        keyTestBtn.disabled = false; keyTestBtn.textContent = '测试连接';
      }
    });

    // ----- 事件绑定 -----
    const urlMode = editBox.querySelector('.mg-edit-urlmode');
    const urlInput = editBox.querySelector('.mg-edit-url');
    const syncUrl = () => { urlInput.hidden = urlMode.value !== 'custom'; };
    urlMode.addEventListener('change', syncUrl); syncUrl();

    /**
     * 把「协议 + 端点」显式取出来，供发现模型 / 测试连接使用。
     *
     * 为什么必须显式传：llm.discoverModels 的入参是 `{settingsNs, provider, api?, baseURL?, apiKey?}`，
     * 引擎**不会**自己去读路由的配置——只有 pi-ai 内置了 catalog 的 provider（openai/deepseek/opencode…）
     * 才不需要这两个字段。手写路由一旦漏传，引擎就只会回：
     *   `pi-ai ships no catalog for provider "ali", so its models can only come from its endpoint;
     *    set a baseURL, or enter this provider's models by hand`
     * 这正是「测试连接」按钮曾经的失败原因。
     */
    const routeEndpoint = () => ({
      // 内置目录路由不带路由级协议，别拿界面上的选择框当结果传出去（那个框对它们是禁用的）；
      // 用户层真存过 api 时用存的那个，否则交给引擎/探测逻辑按目录判断。
      api: (p && p.declared) ? (editBox.querySelector('.mg-edit-api') || {}).value || apiProto : (cfg.api || undefined),
      baseURL: urlMode.value === 'custom' ? urlInput.value.trim() : (baseURL || ''),
    });

    const saveEdit = editBox.querySelector('.mg-edit-save');
    const cancelEdit = editBox.querySelector('.mg-edit-cancel');
    const m = editBox.querySelector('.mg-edit-msg');

    // 删除单个模型
    editBox.querySelectorAll('.mg-model-del').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.closest('.mg-model-row').dataset.i);
        models.splice(i, 1);
        editBox.querySelector('.mg-model-list').innerHTML = modelRows();
        rewireModelRows();
      });
    });
    function rewireModelRows() {
      editBox.querySelectorAll('.mg-model-del').forEach((btn) => {
        btn.onclick = () => {
          const i = Number(btn.closest('.mg-model-row').dataset.i);
          models.splice(i, 1);
          editBox.querySelector('.mg-model-list').innerHTML = modelRows();
          rewireModelRows();
        };
      });
    }
    // 添加模型
    const addInput = editBox.querySelector('.mg-add-model-input');
    const addBtn = editBox.querySelector('.mg-add-model-btn');
    const addModel = () => {
      const id = (addInput.value || '').trim();
      if (!id) { m.textContent = '请输入模型 ID'; return; }
      if (!models.some((x) => x.id === id)) models.push({ id });
      addInput.value = '';
      editBox.querySelector('.mg-model-list').innerHTML = modelRows();
      rewireModelRows();
      m.textContent = '';
    };
    addBtn.addEventListener('click', addModel);
    addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addModel(); } });
    // 「获取可用模型」与「刷新模型与能力」已经合并成一个动作，见下面的 probeBtn。
    // 之所以不再保留一个「只拉清单、不做体检」的按钮：端点列出的清单并不区分「能用的」与
    // 「额度用尽/未开通」的（阿里云百炼一次就列出 261 个，其中 239 个对该 key 不可用），
    // 只拉清单会把模型选择器变成一堆点了就报错的条目。
    const discoverOut = editBox.querySelector('.mg-discover-output');

    // 更新模型与能力：一次动作把「模型清单 + 上下文窗口 + 输出上限 + 可用思考档位 + 当前是否可用」全部问回来。
    // 这些都会变（厂商上下线模型、调整档位、放宽窗口），写死在配置里迟早说谎：
    // 写小了浪费模型能力，写大了请求直接报错。所以宁可每次现场问一遍。
    const probeBtn = editBox.querySelector('.mg-probe-btn');
    const currentTypedKey = () => {
      try {
        const own = editBox.querySelector('.mg-edit-key-input');
        if (own && own.value.trim()) return own.value.trim();
        const i = editBox.closest('.model-group, .mg-key')?.querySelector('.mg-key-input');
        return i ? i.value.trim() : '';
      } catch { return ''; }
    };
    const probeOutput = (text, kind) => {
      discoverOut.className = 'mg-discover-output' + (kind ? ' ' + kind : '');
      discoverOut.textContent = text;
    };
    // 主进程逐行推进度。编辑器的输出框不再是常驻消费者：探测只在点击后跑，
    // 所以认领发生在点击里，跑完就交还（真正的订阅在 wire() 里只做一次 ——
    // 每次打开编辑器都重订会把全量刷新的订阅顶掉）。
    probeBtn.addEventListener('click', async () => {
      const url = urlMode.value === 'custom' ? urlInput.value.trim() : (baseURL || '');
      if (!/^https?:\/\//.test(url)) { probeOutput('请先填写 API 地址（baseURL）再刷新', 'bad'); return; }
      const ep = routeEndpoint();   // 协议取值与「测试连接」共用同一套判断
      const api2 = ep.api;
      const key = currentTypedKey();
      probeBtn.disabled = true; probeBtn.textContent = '刷新中…';
      probeOutput('正在向端点获取模型清单…');
      const releaseProbe = claimProbeSink((t) => { if (probeBtn.disabled) probeOutput(t); });
      try {
        // ① 清单：端点当前列出的模型
        const disc = await api.discoverModels(p.settingsNs, provider, key || undefined, api2, url);
        const endpointIds = (disc && disc.ok && Array.isArray(disc.models))
          ? disc.models.map((d) => d && d.id).filter(Boolean) : [];
        const mine = models.map((m) => m.id);
        const mineSet = new Set(mine);
        const freshAll = endpointIds.filter((id) => !mineSet.has(id));
        // 新模型先做体检再决定要不要收：端点列出来的清单不区分「能用的」和「额度用尽/未开通」的，
        // 全量收进来只会让模型选择器变成一堆点了就报错的条目。
        const fresh = freshAll.slice(0, NEW_MODEL_BUDGET);
        probeOutput(`清单：端点 ${endpointIds.length || '?'} 个模型，配置里 ${mine.length} 个`
          + (freshAll.length ? `，新发现 ${freshAll.length} 个` : '')
          + (freshAll.length > fresh.length ? `（本次最多体检 ${NEW_MODEL_BUDGET} 个新的，其余下次）` : '')
          + '。开始探测能力…');
        // ② 能力：上下文窗口 / 输出上限 / 存活 / 可用思考档位（密钥传引用名，明文不出主进程）
        const cap = await api.probeCapabilities({
          baseURL: url, api: api2, apiKey: key || undefined, apiKeyEnv: ref, models: [...mine, ...fresh],
        });
        if (!cap || !cap.ok) { probeOutput('能力探测失败：' + ((cap && cap.error) || 'unknown'), 'bad'); return; }
        const byId = new Map((cap.results || []).map((r) => [r.id, r]));
        // ③ 回填已有模型；判定不可用的只做标记（保留在配置里，用户自己决定删不删）
        let updated = 0; let dead = 0; let unknown = 0;
        deadIds.clear();
        for (const m of models) {
          const r = byId.get(m.id);
          if (!r) continue;
          if (r.alive === false) { deadIds.add(m.id); dead++; continue; }
          if (r.name) m.name = r.name;
          if (r.contextWindow) m.contextWindow = r.contextWindow;
          if (r.maxTokens) m.maxTokens = r.maxTokens;
          if (r.reasoningEfforts !== undefined) m.reasoningEfforts = r.reasoningEfforts;
          if (r.error) unknown++; else updated++;
        }
        // ④ 新模型：只收体检通过的，并直接带上已探到的能力
        let added = 0;
        for (const id of fresh) {
          const r = byId.get(id);
          if (!r || r.alive !== true) continue;
          models.push({
            id,
            ...(r.name ? { name: r.name } : {}),
            ...(r.contextWindow ? { contextWindow: r.contextWindow } : {}),
            ...(r.maxTokens ? { maxTokens: r.maxTokens } : {}),
            ...(r.reasoningEfforts !== undefined ? { reasoningEfforts: r.reasoningEfforts } : {}),
          });
          added++;
        }
        editBox.querySelector('.mg-model-list').innerHTML = modelRows();
        rewireModelRows();
        const src = cap.catalog ? `厂商目录「${cap.catalog}」` : '现场探测';
        probeOutput(`能力来源：${src}。已更新 ${updated} 个模型`
          + (added ? `，新增 ${added} 个可用模型` : '')
          + (dead ? `，${dead} 个当前不可用（已标记，未删除）` : '')
          + (unknown ? `，${unknown} 个能力无法定论（保留原值）` : '')
          + (cap.hadKey === false ? '。⚠️ 未取到密钥，存活与档位探测不完整，请在上方输入密钥后重试' : '')
          + '。确认后点「保存」写入配置。', 'ok');
      } catch (e) {
        probeOutput('刷新出错：' + (e.message || String(e)), 'bad');
      } finally {
        releaseProbe();
        probeBtn.disabled = false; probeBtn.textContent = '↻ 更新模型与能力';
      }
    });

    // 保存
    saveEdit.addEventListener('click', async () => {
      const api2 = editBox.querySelector('.mg-edit-api').value;
      const customUrl = urlMode.value === 'custom' ? urlInput.value.trim() : '';
      // 手写声明的路由没有内置 catalog 兜底：端点与模型清单缺一不可，
      // 少了任何一个引擎都会在挂载这条路由时直接报错（needs a baseURL / resolves no models）。
      if (p && p.declared) {
        if (!customUrl) { m.textContent = '该提供商由本配置手写声明，必须填 API 地址——pi-ai 没有它的内置端点'; return; }
        if (!models.length) { m.textContent = '该提供商由本配置手写声明，模型目录不能为空——pi-ai 没有它的内置模型；请用「↻ 更新模型与能力」或手动添加'; return; }
      }
      // 基线取**用户层**：只把动过的字段写下去。
      // 旧实现是 `{ ...cfg, api: api2, models }`（cfg 为合并值），会把 schema 默认值
      // 一并固化成用户数据 —— 实测 `ali` 路由下因此出现了用户从没填过的
      // modelOverrides / defaultContextWindow / streamIdleTimeoutMs 等字段。
      const before = userProviderConfigOf(provider);
      const draft = cloneJson(before) || {};
      // 路由级 api 只对手写路由有意义：内置目录路由的协议是逐模型定的，
      // 写一个路由级的会把该路由下所有模型的协议一起覆盖掉（官方 UI 也只对手写路由提供这个字段）。
      // 旧实现无条件写 api，等于给 opencode 这类路由凭空盖了一层协议。
      if (p && p.declared) draft.api = api2;
      if (customUrl) draft.baseURL = customUrl;
      else delete draft.baseURL;
      // 空模型清单的语义是「照搬内置目录」，所以"清空"要发 unset 而不是写 []——
      // 写 [] 只是等价，但会让配置文件里留一条看起来"显式声明了空清单"的噪声。
      // 手写路由不允许走到这里（上面已经拦下）。
      if (models.length > 0) draft.models = models;
      else delete draft.models;
      // 与官方 Web UI 同约定：真的要存密钥时，把推导出来的引用名记进 profile。
      // 否则密钥会存到 <ROUTE>_API_KEY 而配置里没人引用它，引擎照样读不到。
      if (!draft.apiKeyEnv && keyConfigured) draft.apiKeyEnv = ref;
      const ops = settingsPathOps(['providers', provider], before, draft);
      if (!ops.length) { m.textContent = '没有改动'; return; }
      saveEdit.disabled = true; saveEdit.textContent = '保存中…';
      try {
        const ns = nsViews['llm-pi-ai'];
        const mut = await api.mutateSettings('llm-pi-ai', ops, ns ? ns.revision : undefined);
        if (!mut.ok) { m.textContent = '保存失败：' + (mut.error || 'unknown'); return; }
        m.textContent = `已保存 ${ops.length} 处改动 ✓`;
        // 成功：收起面板并刷新
        setTimeout(() => { editBox.hidden = true; editBox.innerHTML = ''; refreshModels(); notifyChanged(); }, 600);
      } catch (e) {
        m.textContent = '保存出错：' + (e.message || String(e));
      } finally {
        saveEdit.disabled = false; saveEdit.textContent = '保存';
      }
    });
    cancelEdit.addEventListener('click', () => {
      editBox.hidden = true;
      editBox.innerHTML = '';
    });

    return { close: () => { editBox.hidden = true; editBox.innerHTML = ''; } };
  }

  /** 添加自定义提供商（对齐官方 webUI）：填写 ID/名称/协议/baseURL/密钥/Headers →
   *  保存密钥到 credentials + 把 profile 写入 llm-pi-ai.providers.<id>，保存后出现在提供商列表。 */
  function renderCustomProviderForm() {
    const btn = $('#addCustomProviderBtn');
    const form = $('#customProviderForm');
    if (!btn || !form) return;
    btn.addEventListener('click', () => {
      form.hidden = !form.hidden;
      if (!form.hidden) { const m = form.querySelector('.cp-msg'); if (m) m.textContent = ''; }
    });
    const save = form.querySelector('.cp-save');
    const cancel = form.querySelector('.cp-cancel');
    const msg = form.querySelector('.cp-msg');
    const show = (html, kind) => { msg.innerHTML = html; msg.className = 'cp-msg' + (kind ? ' ' + kind : ''); };
    const reset = () => {
      for (const s of ['.cp-id', '.cp-name', '.cp-url', '.cp-key', '.cp-models']) {
        const el = form.querySelector(s);
        if (el) el.value = '';
      }
      const h = form.querySelector('.cp-headers');
      if (h) h.value = '';
      form.hidden = true;
      if (msg) { msg.textContent = ''; msg.className = 'cp-msg'; }
    };
    cancel.addEventListener('click', reset);
    save.addEventListener('click', async () => {
      const id = (form.querySelector('.cp-id').value || '').trim().toLowerCase();
      const name = (form.querySelector('.cp-name').value || '').trim();
      const api2 = form.querySelector('.cp-api').value;
      const url = (form.querySelector('.cp-url').value || '').trim();
      const key = (form.querySelector('.cp-key').value || '').trim();
      const headersRaw = (form.querySelector('.cp-headers').value || '').trim();
      const modelsEl = form.querySelector('.cp-models');
      const modelsRaw = modelsEl ? (modelsEl.value || '').trim() : '';
      if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(id)) { show('提供商 ID 只能是小写字母/数字/连字符（如 my-provider）', 'bad'); return; }
      if (!/^https?:\/\//.test(url)) { show('API 地址必须以 http:// 或 https:// 开头', 'bad'); return; }
      if (!settingsWritable) { show('设置当前为只读（read-only settings provider），无法保存', 'bad'); return; }
      if (providerOf(id)) { show(`提供商 <code>${esc(id)}</code> 已存在，请换一个 ID`, 'bad'); return; }
      // 解析自定义 Headers（每行 key: value，可选）
      const headers = {};
      for (const line of headersRaw.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        const m = /^([^:]+):\s*(.*)$/.exec(t);
        if (!m) { show(`Headers 格式错误：${esc(t)}（应为 key: value）`, 'bad'); return; }
        headers[m[1].trim()] = m[2].trim();
      }
      const keyRef = id.toUpperCase().replace(/[^A-Z0-9]+/g, '_') + '_API_KEY';
      save.disabled = true; save.textContent = '保存中…';
      try {
        if (key) {
          const st = await api.setCredential(keyRef, key);
          if (!st.ok) { show('保存密钥失败：' + esc(st.error || 'unknown'), 'bad'); return; }
        }
        // pi-ai 没内置该提供商的 catalog 时，这条手写路由必须自带模型清单：
        // 写 models: [] 会被引擎当成「照搬内置 catalog」，而内置 catalog 里根本没有
        // 这个键，于是报 `resolves no models`。先用手填的，再退回到向端点要一份。
        let entries = modelsRaw.split(/[\s,;]+/).map((s2) => s2.trim()).filter(Boolean)
          .map((mid) => ({ id: mid }));
        if (!entries.length) {
          if (!key) {
            show('该提供商未内置模型目录：请先填 API 密钥以便自动获取模型，'
              + '或直接在「模型列表」里手填模型 ID', 'bad');
            return;
          }
          show('正在从端点获取模型列表…');
          const d = await api.discoverModels('llm-pi-ai', id, key, api2, url);
          if (d && d.ok && Array.isArray(d.models)) {
            entries = d.models.filter((m2) => m2 && m2.id)
              .map((m2) => ({ id: m2.id, ...m2.contextWindow === undefined ? {} : { contextWindow: m2.contextWindow }, ...m2.maxTokens === undefined ? {} : { maxTokens: m2.maxTokens } }));
          }
          if (!entries.length) {
            show('无法从该端点取到模型列表' + (d && d.error ? '（' + esc(d.error) + '）' : '')
              + '：请在「模型列表」里手动填写模型 ID，每行一个', 'bad');
            return;
          }
        }
        const ns = nsViews['llm-pi-ai'];
        const patch = { apiKeyEnv: keyRef, displayName: name || id, api: api2, baseURL: url, models: entries };
        // pi-ai 只对「认得出来的真 OpenAI」才敢发 developer 角色，其它 OpenAI 兼容端点
        // 一律按 system 更安全——不少网关（含阿里云百炼）会以 400 拒绝 developer。
        // 这个开关只有 openai-completions / openai-responses 两族协议声明，别乱塞。
        if (api2 === 'openai-completions' || api2 === 'openai-responses') {
          patch.compat = { supportsDeveloperRole: false };
        }
        if (Object.keys(headers).length) patch.headers = headers;
        const mut = await api.mutateSettings('llm-pi-ai',
          [{ op: 'set', path: ['providers', id], value: patch }],
          ns ? ns.revision : undefined);
        if (!mut.ok) { show('保存失败：' + esc(mut.error || 'unknown'), 'bad'); return; }
        show(`已保存自定义提供商 <code>${esc(id)}</code>（${entries.length} 个模型），正在刷新…`, 'ok');
        reset();
        refreshModels(); notifyChanged();
      } catch (e) {
        show('保存出错：' + esc(e.message || String(e)), 'bad');
      } finally {
        save.disabled = false; save.textContent = '保存提供商';
      }
    });
  }

  // OpenCode Zen 免费模型 UA 代理（429 FreeUsageLimitError 处理）
  function wireZenUaBtn(scope, provider) {
    if (!provider || !['opencode', 'opencode-go'].includes(provider)) return;
    const btn = scope.querySelector('.mg-zenua');
    const box = scope.querySelector('.mg-zenua-box');
    if (!btn || !box || box.dataset.wired) return;
    box.dataset.wired = '1';

    const renderState = async () => {
      const st = await api.zenuaStatus();
      const running = !!(st && st.ok && st.running);
      box.innerHTML = `
        <div class="mg-zenua-note">
          ⚡ OpenCode Zen 免费模型（<code>deepseek-v4-flash-free</code>）需要本地 UA 代理：
          DSH 的归因 User-Agent 会被识别为"非官方客户端"而返回 <code>429 FreeUsageLimitError</code>。
          启用后会用本地代理（127.0.0.1:${st && st.port ? st.port : 8790}）改写成 <code>opencode/0.1.0</code>，
          并把 opencode 路由的 baseURL 指向该代理。
          ${running ? '<span class="mg-zenua-state on">● 代理运行中</span>' : '<span class="mg-zenua-state off">○ 代理未运行</span>'}
        </div>
        <div class="mg-zenua-actions">
          ${running
            ? '<button class="mini-btn mg-zenua-disable" type="button">停用 UA 代理</button>'
            : '<button class="mini-btn primary-btn mg-zenua-enable" type="button">启用 UA 代理（免费模型）</button>'}
        </div>
        <div class="mg-zenua-msg"></div>`;
      box.hidden = false;
      const en = box.querySelector('.mg-zenua-enable');
      const de = box.querySelector('.mg-zenua-disable');
      const msg = box.querySelector('.mg-zenua-msg');
      if (en) en.addEventListener('click', async () => {
        en.disabled = true; en.textContent = '启用中…';
        try {
          const r = await api.zenuaEnable();
          msg.textContent = (r && r.ok)
            ? (r.settings ? '已启用并通过代理改写 UA，保存 key 后即可使用免费模型。' : '代理已启动，但写入 opencode baseURL 可能失败：' + (r.error || 'unknown'))
            : '启用失败：' + ((r && r.error) || 'unknown');
          msg.className = 'mg-zenua-msg' + (r && r.ok ? ' ok' : ' bad');
          renderState();
        } catch (e) {
          msg.textContent = '启用出错：' + (e.message || String(e)); msg.className = 'mg-zenua-msg bad';
        } finally {
          en.disabled = false; en.textContent = '启用 UA 代理（免费模型）';
        }
      });
      if (de) de.addEventListener('click', async () => {
        de.disabled = true; de.textContent = '停用中…';
        try {
          const r = await api.zenuaDisable();
          msg.textContent = (r && r.ok) ? '已停用 UA 代理并恢复 opencode 默认地址。' : '停用失败：' + ((r && r.error) || 'unknown');
          msg.className = 'mg-zenua-msg' + (r && r.ok ? ' ok' : ' bad');
          renderState();
        } catch (e) {
          msg.textContent = '停用出错：' + (e.message || String(e)); msg.className = 'mg-zenua-msg bad';
        } finally {
          de.disabled = false; de.textContent = '停用 UA 代理';
        }
      });
    };

    btn.addEventListener('click', () => {
      if (box.hidden) renderState();
      else box.hidden = true;
    });
  }

  function wireKeyEditors() {
    document.querySelectorAll('.mg-key').forEach((block) => {
      if (block.dataset.wired) return;
      block.dataset.wired = '1';
      const provider = block.dataset.provider;
      const p = providerOf(provider);
      if (!p) return;
      const ref = apiKeyEnvOf(provider) || deriveKeyRef(provider);
      const input = block.querySelector('.mg-key-input');
      const msg = block.querySelector('.mg-key-msg');
      const show = (html, kind) => { msg.innerHTML = html; msg.className = 'mg-key-msg' + (kind ? ' ' + kind : ''); };
      const saveBtn = block.querySelector('.mg-key-save');
      const testBtn = block.querySelector('.mg-key-test');
      if (saveBtn) saveBtn.addEventListener('click', async () => {
        const key = (input ? input.value : '').trim();
        if (!key) { show('<span class="warn">请先粘贴 API 密钥再保存</span>', 'bad'); return; }
        saveBtn.disabled = true; saveBtn.textContent = '保存中…';
        try {
          const set = await api.setCredential(ref, key);
          if (!set.ok) { show('保存密钥失败：' + esc(set.error || 'unknown'), 'bad'); return; }
          const ns = nsViews['llm-pi-ai'];
          const mut = await api.mutateSettings('llm-pi-ai',
            [{ op: 'set', path: ['providers', provider, 'apiKeyEnv'], value: ref }],
            ns ? ns.revision : undefined);
          if (!mut.ok) { show('写入配置失败：' + esc(mut.error || 'unknown'), 'bad'); return; }
          show(`已保存 <code>${esc(ref)}</code> 并启用 <strong>${esc(p.displayName || provider)}</strong>，正在重新加载模型…`, 'ok');
          refreshModels(); notifyChanged();
        } catch (e) {
          show('保存出错：' + esc(e.message || String(e)), 'bad');
        } finally {
          saveBtn.disabled = false; saveBtn.textContent = '保存密钥';
        }
      });
      if (testBtn) testBtn.addEventListener('click', async () => {
        const key = (input ? input.value : '').trim();
        testBtn.disabled = true; testBtn.textContent = '测试中…';
        show('正在连接 <code>' + esc(p.settingsNs) + '</code> 并发现模型…', '');
        try {
          // 端点与协议必须显式传：pi-ai 没内置该 provider 的 catalog 时，
          // 引擎不会去读路由自身的配置，缺 baseURL 就只会回 "set a baseURL"。
          const cfg = providerConfigOf(provider);
          const r = await api.discoverModels(p.settingsNs, provider, key || undefined, cfg.api, cfg.baseURL || undefined);
          if (!r.ok) { show('连接失败：' + esc(r.error || 'unknown'), 'bad'); return; }
          const models = r.models || [];
          show(models.length > 0
            ? `连接成功，发现 ${models.length} 个模型：` + models.slice(0, 10).map((m) => `<code>${esc(m.name || m.id)}</code>`).join(' ') + (models.length > 10 ? ' …' : '')
            : '连接成功，但该端点未返回任何模型', 'ok');
        } catch (e) {
          show('测试出错：' + esc(e.message || String(e)), 'bad');
        } finally {
          testBtn.disabled = false; testBtn.textContent = '测试连接';
        }
      });

      // ---- 编辑提供商配置（自定义设置可折叠，与 webUI 一致） ----
      const editBtn = block.querySelector('.mg-edit');
      const editBox = block.querySelector('.mg-edit-box');
      if (editBtn && editBox) {
        editBtn.addEventListener('click', () => {
          if (!editBox.hidden) { editBox.hidden = true; return; }
          renderProviderEditor(editBox, provider);
        });
      }

      wireZenUaBtn(block, provider);

      // ---- 删除整个提供商（仅 user 层新增的可删） ----
      const rmBtn = block.querySelector('.mg-rm');
      if (rmBtn) rmBtn.addEventListener('click', async () => {
        const ok = window.__modal
          ? await window.__modal.confirm(`确定删除提供商 <strong>${esc(provider)}</strong> 的整份配置与对应 API 密钥？\n（此操作不可撤销，将移除其全部自定义模型）`, '删除提供商', { okText: '确认删除' })
          : confirm(`确定删除提供商 ${provider} 的配置与密钥？`);
        if (!ok) return;
        rmBtn.disabled = true; rmBtn.textContent = '删除中…';
        try {
          const ns = nsViews['llm-pi-ai'];
          const cfg = providerConfigOf(provider);
          const keyRef = (cfg && cfg.apiKeyEnv) || deriveKeyRef(provider);
          // 1) 清理凭据（尽力而为）
          await api.unsetCredential(keyRef).catch(() => {});
          // 2) 移除整个 providers.<name> 配置
          const mut = await api.mutateSettings('llm-pi-ai',
            [{ op: 'unset', path: ['providers', provider] }],
            ns ? ns.revision : undefined);
          if (!mut.ok) { show('删除失败：' + esc(mut.error || 'unknown'), 'bad'); rmBtn.disabled = false; rmBtn.textContent = '删除提供商'; return; }
          show(`已删除提供商 <code>${esc(provider)}</code> 及其密钥引用`, 'ok');
          refreshModels(); notifyChanged();
        } catch (e) {
          show('删除出错：' + esc(e.message || String(e)), 'bad');
          rmBtn.disabled = false; rmBtn.textContent = '删除提供商';
        }
      });
    });
  }

  function failureCard(f) {
    const p = providerOf(f.id);
    return `<div class="model-group mg-fail">
      <div class="mg-head"><span class="mg-name">${esc(f.name || f.id)}</span><code class="mg-id">${esc(f.id)}</code><span class="badge trust-broken">加载失败</span></div>
      <div class="mg-fail-msg">${esc(f.message)}</div>
      ${keyEditor(p)}
    </div>`;
  }

  /** 选中但既无模型分组、也未报错的提供商：说明其状态与配置位置，并给出密钥填写入口。 */
  function idleCard(p) {
    const where = p.settingsNs
      ? `配置位置：<code>${esc(p.settingsNs)}</code>${(p.settingsPath || []).length ? ` → <code>${esc(p.settingsPath.join(' / '))}</code>` : ''}`
      : '该提供商未声明配置位置';
    const tip = p.active
      ? '该提供商已启用，但当前没有加载到模型（可能尚未配置 API 密钥）。'
      : '该提供商未启用：填入 API 密钥并保存后即会启用（配置写入 harness settings.yaml，实时生效）。';
    return `<div class="model-group mg-idle">
      <div class="mg-head"><span class="mg-name">${esc(p.displayName || p.provider)}</span><code class="mg-id">${esc(p.provider)}</code>
        <span class="badge ${p.active ? 'trust-system' : 'trust-user'}">${p.active ? '已启用' : '未启用'}</span></div>
      <div class="mg-idle-msg">${esc(tip)}<br />${where}</div>
      ${keyEditor(p)}
    </div>`;
  }

  function renderModelGroups() {
    const selVal = $('#providerSelect').value;
    const list = $('#modelGroupList');
    const cards = [];
    if (selVal) {
      const g = groupOf(selVal);
      const f = failureOf(selVal);
      const p = providerOf(selVal);
      if (g) cards.push(groupCard(g, p));
      if (f) cards.push(failureCard(f));
      if (!g && !f && p) cards.push(idleCard(p));
      if (cards.length === 0) cards.push('<div class="empty">该提供商暂无可用模型</div>');
    } else {
      for (const g of modelGroupsAll) cards.push(groupCard(g, providerOf(g.id)));
      for (const f of modelFailures) cards.push(failureCard(f));
      if (cards.length === 0) cards.push('<div class="empty">尚无提供商加载模型（在上方选择一个提供商查看详情）</div>');
    }
    list.innerHTML = cards.join('');
    wireKeyEditors();
    wireGroupCardOps();
  }

  // ---------------- 模型刷新：把端点/目录的最新清单写回配置 ----------------

  /**
   * 「刷新模型」筛查新候选的预算：一次动作最多对多少个新候选判死活。
   *
   * 端点清单动辄几百条（阿里云百炼的 compatible-mode 端点一次列出 262 个模型，实测约六分之一
   * 对该密钥可用），逐个做**完整**能力探测会让一次点击变成几分钟的等待。所以分两段：
   * 筛查只发一次 `max_tokens=1`（实测约 0.4s/模型，这一档能覆盖上百个），存活的少数再补齐档位
   * （每个模型最多 8 次请求，但数量小）。一屏筛不完的留给下次刷新 —— 本轮通过写回后就不再是
   * 候选，于是每点一次都往前走一步。
   */
  const SYNC_SCREEN_BUDGET = 120;

  /** 筛查通过后做完整探测（上下文窗口 / 输出上限 / 思考档位）的预算，按存活数量自然收敛。 */
  const SYNC_DEEP_BUDGET = 40;

  /** 筛查的并发度：请求都只有 max_tokens=1，比默认值开高一点，几百个候选才跑得动。 */
  const SYNC_SCREEN_CONCURRENCY = 8;

  /** 进度输出的保留行数：全量刷新要「一眼看结果」，不需要回放几百行探测细节。 */
  const SYNC_LOG_TAIL = 200;

  /**
   * 探测进度的**唯一**订阅点（值 = 此刻接收进度的消费者）。
   *
   * 主进程的 `llm:probeProgress` 是全局通道，而 preload 的 `onProbeProgress` 每次订阅都会
   * 先 `removeAllListeners` —— 编辑器探测与全量刷新各自订阅一次，后订阅的会把先订阅的顶掉。
   * 所以本模块只订阅一次（见 wire()），再按「此刻谁在跑」把进度转发给它。
   * @type {((line: string) => void) | null}
   */
  let probeSink = null;

  /**
   * 认领探测进度通道，返回「交还」函数。
   *
   * 为什么是认领/交还而不是直接赋值：编辑器探测与全量刷新是两个独立入口，可能同时开着。
   * 直接赋值再在结束时置 null，先结束的那个会把还在跑的那个的进度一起关掉。
   * @param {(line: string) => void} sink 接收进度行的回调。
   * @returns {() => void} 交还函数；只在自己仍是当前消费者时恢复上一个。
   */
  function claimProbeSink(sink) {
    const fn = typeof sink === 'function' ? sink : null;
    const prev = probeSink;
    probeSink = fn;
    return () => { if (probeSink === fn) probeSink = prev; };
  }

  /**
   * 「已添加」的提供商：llm-pi-ai 里真的存了 profile 的那些。
   *
   * 为什么不拿 providersAll 整份当目标：目录里有 30 多个内置提供商，用户一个都没配过。
   * 它们既没有端点可问（pi-ai 目录作答），也没有配置可写 —— 写进去只会凭空造出一批
   * 「看起来配过」的 profile，把 routes 从「跟随内置目录」变成「钉死一份清单」。
   */
  function syncTargets() {
    const ns = nsViews['llm-pi-ai'];
    const profiles = (ns && ns.value && ns.value.providers) || {};
    return providersAll.filter((p) => p.settingsNs === 'llm-pi-ai'
      && !!profiles[p.provider] && typeof profiles[p.provider] === 'object');
  }

  /** 把探测/目录给出的元数据补进既有条目：既有值优先，只补空缺。 */
  function fillModelEntry(prev, found) {
    const out = { ...prev };
    if (out.name === undefined && found.name) out.name = found.name;
    if (out.contextWindow === undefined && found.contextWindow) out.contextWindow = found.contextWindow;
    if (out.maxTokens === undefined && found.maxTokens) out.maxTokens = found.maxTokens;
    return out;
  }

  /**
   * 端点目录项 → 配置条目。探测结果优先于清单：清单通常只给 id/name，
   * 而探测（厂商目录 + 现场问）才知道上下文窗口、输出上限和可用思考档位。
   * 只带真的问到的字段，其余留给引擎按内置目录解析 —— 写 undefined 会把继承关系切断。
   */
  function modelEntryFrom(found, probed) {
    const contextWindow = (probed && probed.contextWindow) || found.contextWindow;
    const maxTokens = (probed && probed.maxTokens) || found.maxTokens;
    return {
      id: found.id,
      ...(found.name ? { name: found.name } : {}),
      ...(contextWindow ? { contextWindow } : {}),
      ...(maxTokens ? { maxTokens } : {}),
      ...(probed && probed.reasoningEfforts !== undefined ? { reasoningEfforts: probed.reasoningEfforts } : {}),
    };
  }

  /**
   * 「刷新模型」：把每个已添加提供商的模型清单重新问一遍，把差异写回 llm-pi-ai。
   *
   * 一次动作做四件事：
   *   1. **问清单** —— `llm.discoverModels`。pi-ai 内置目录描述得了的路由直接由目录作答
   *      （不走网络，且带上下文窗口/输出上限）；网关、自建服务这类目录里没有的路由走
   *      `GET {baseURL}/models`。所以「自定义提供商」也能被刷到。
   *   2. **体检新模型** —— 端点列出的清单并不区分「能用的」和「额度用尽/未开通」的
   *      （阿里云百炼的 compatible-mode 端点一次列 262 个，实测约六分之一对该密钥可用），
   *      新出现的候选必须先问一句才能收。分两段：先只判死活（每个候选一次
   *      `max_tokens=1` 的请求，可覆盖上百个），存活的少数再补齐上下文窗口与思考档位。
   *      没密钥时探测结果不可信，就不做过滤。
   *   3. **写回配置** —— 以**用户层**为基线做 diff，只发真正变化的 set，避免把 schema 默认值
   *      固化成用户数据（同 renderProviderEditor 的保存路径）。
   *   4. **同步界面** —— 重读提供商与模型目录，并广播 `dsh:models-refreshed`，
   *      让对话框（chat.js）的模型选择器立刻跟着重读，而不是等切会话。
   *
   * 「最新可用」的语义：清单里有、配置里没有的 → 收进来（筛查通过的，追加在原清单之后）；
   * 配置里有、清单里已经没有的 → 视为厂商已下线，从配置里移除（这一步只在清单非空时做，
   * 端点答不出来就整条跳过）；清单里仍列着、但当前密钥调用被拒的 → 不收录，也不硬删已有的
   * （额度可能是临时的，留给编辑器里的「↻ 更新模型与能力」标记出来由用户决定）。
   * 已有条目的相对顺序不动 —— 刷新该增删条目，不该顺手重排用户的模型列表。
   *
   * @param {{onLine?: (line: string) => void}} [options] 逐行进度回调。对话框里的刷新入口
   *   用它把进度显示在自己的工具栏上（设置页的进度框此时不可见）。
   * @returns {Promise<{ok:boolean, error?:string, providers?:number, added?:number, removed?:number, unchanged?:number, failed?:number}>}
   */
  async function syncAllModels(options) {
    const opts = options || {};
    const onLine = typeof opts.onLine === 'function' ? opts.onLine : null;
    const out = $('#modelSyncOutput');
    const lines = [];
    const render = () => {
      if (!out) return;
      const tail = lines.length > SYNC_LOG_TAIL
        ? [`…（前 ${lines.length - SYNC_LOG_TAIL} 行已省略）`, ...lines.slice(-SYNC_LOG_TAIL)]
        : lines;
      out.textContent = tail.join('\n');
    };
    const line = (text) => {
      lines.push(text);
      render();
      if (onLine) onLine(text);
    };
    const finish = (kind) => {
      if (out) out.className = 'mg-discover-output sync' + (kind ? ' ' + kind : '');
    };
    const summary = (extra) => Object.assign({
      ok: true, providers: 0, added: 0, removed: 0, unchanged: 0, failed: 0,
    }, extra || {});

    if (syncRunning) return { ok: false, error: '正在刷新中，请稍候' };
    if (out) out.className = 'mg-discover-output sync';
    lines.length = 0;
    syncRunning = true;
    const btn = $('#refreshModelsBtn');
    if (btn) { btn.disabled = true; btn.textContent = '刷新中…'; }
    try {
      line('正在读取提供商与模型目录…');
      const { lp, lm } = await loadModelConfigState();
      if (!lp.ok && !lm.ok) {
        // 进度框走 textContent，不转义 —— esc 一次反而会把 & < 变成实体显示出来
        line('模型目录获取失败：' + (lp.error || lm.error || 'unknown'));
        finish('bad');
        return { ok: false, error: lp.error || lm.error || '模型目录获取失败' };
      }
      if (!settingsWritable) {
        line('设置当前为只读（read-only settings provider），无法把模型清单写回配置。');
        finish('bad');
        return { ok: false, error: '设置只读' };
      }
      const targets = syncTargets();
      if (targets.length === 0) {
        line('还没有已添加的提供商：先在上面填一个 API 密钥（或「＋ 添加自定义提供商」），再来刷新。');
        finish('bad');
        return { ok: false, error: '没有已添加的提供商' };
      }

      // 引擎此刻真正在服务的模型：用来判断「跟随内置目录」的路由是否真的需要写回一份清单。
      // 一份和目录一模一样的清单写进配置只是噪声 —— 它把路由从「跟随目录」变成「钉死」，
      // 将来目录升级反倒要多刷一次才生效。
      const servedIds = new Map(modelGroupsAll.map((g) => [g.id, new Set((g.models || []).map((m) => m.id))]));
      const piNs = () => nsViews['llm-pi-ai'];

      const stats = summary();
      stats.providers = targets.length;
      line(`已添加的提供商 ${targets.length} 个：${targets.map((p) => p.provider).join('、')}`);
      for (const p of targets) {
        const provider = p.provider;
        const label = (p.displayName && p.displayName !== provider) ? `${p.displayName}（${provider}）` : provider;
        const cfg = providerConfigOf(provider);
        const userCfg = userProviderConfigOf(provider);
        const before = Array.isArray(userCfg.models) ? userCfg.models : undefined;
        const url = typeof cfg.baseURL === 'string' ? cfg.baseURL : '';
        const apiProto = typeof cfg.api === 'string' && cfg.api.length > 0 ? cfg.api : undefined;
        const ref = apiKeyEnvOf(provider) || deriveKeyRef(provider);
        line(`── ${label}：正在获取模型清单…`);
        try {
          // ① 清单：不带明文密钥，主进程按 apiKeyEnv 在本机读（与「测试连接」同一约定）
          const disc = await api.discoverModels('llm-pi-ai', provider, undefined, apiProto, url || undefined);
          if (!disc || !disc.ok) {
            line(`   ✗ 获取清单失败：${disc && disc.error ? disc.error : 'unknown'}（该提供商本次跳过）`);
            stats.failed++;
            continue;
          }
          const found = (disc.models || []).filter((m) => m && typeof m.id === 'string' && m.id.length > 0);
          if (found.length === 0) {
            // 清单为空是最危险的一种回执：照着它写回等于把该路由的模型清空。
            // 宁可什么都不做，也不能把「端点此刻没答上来」当成「一个模型都没有」。
            line('   ✗ 端点/目录没有返回任何模型（本次跳过，不动原配置）');
            stats.failed++;
            continue;
          }

          const beforeIds = new Set((before || []).map((m) => m.id));
          const foundIds = new Set(found.map((m) => m.id));
          // 新候选先截预算：剩下的下一轮再筛查（写回后它们不再是候选，所以每轮都往前走）
          const freshAll = found.filter((m) => !beforeIds.has(m.id));
          const candidates = freshAll.slice(0, SYNC_SCREEN_BUDGET);
          const overflow = freshAll.length - candidates.length;

          // ② 体检：分两段，因为「筛掉几百个候选」和「把留下的问清楚」代价差一个量级。
          //    先只判死活（每个候选一次 max_tokens=1），再把存活的少数做完整探测
          //    （ctx / max / 思考档位，每个模型最多 8 次请求）。厂商目录能答的 ctx/max
          //    在筛查阶段就已回填，所以完整探测的预算按存活数量自然收敛。
          const probed = new Map();   // id -> 探测结果（两段合并）
          let alive = null;           // null = 没有可信的可用性结论，本次不做过滤
          let hadKey = true;
          const probeable = /^https?:\/\//.test(url)
            && (apiProto === undefined || apiProto === 'openai-completions' || apiProto === 'openai-responses');
          if (probeable && candidates.length > 0) {
            const ids = candidates.map((m) => m.id);
            line(`   清单 ${found.length} 个模型，新发现 ${freshAll.length} 个，正在筛查其中 ${ids.length} 个是否可用…`
              + (overflow > 0 ? `（其余 ${overflow} 个留待下次刷新）` : ''));
            const releaseProbe = claimProbeSink((t) => line('   ' + t));
            try {
              const cap = await api.probeCapabilities({
                baseURL: url, api: apiProto, apiKeyEnv: ref, models: ids,
                concurrency: SYNC_SCREEN_CONCURRENCY, aliveOnly: true,
              });
              if (cap && cap.ok) {
                hadKey = cap.hadKey !== false;
                for (const r of cap.results || []) if (r && r.id) probed.set(r.id, r);
                if (hadKey) alive = new Set([...probed.values()].filter((r) => r.alive === true).map((r) => r.id));
              } else {
                line(`   ⚠ 筛查失败：${(cap && cap.error) || 'unknown'}，本次不做可用性过滤`);
              }
              if (alive && alive.size > 0) {
                // 第二段：把筛查通过的补齐思考档位。这一步贵，但对象只剩存活的那几个。
                const survivors = candidates.filter((m) => alive.has(m.id)).slice(0, SYNC_DEEP_BUDGET);
                if (survivors.length > 0) {
                  line(`   筛查通过 ${alive.size} 个，正在补齐其中 ${survivors.length} 个的上下文窗口与思考档位…`);
                  const deep = await api.probeCapabilities({
                    baseURL: url, api: apiProto, apiKeyEnv: ref, models: survivors.map((m) => m.id),
                  });
                  if (deep && deep.ok) for (const r of deep.results || []) if (r && r.id) probed.set(r.id, r);
                  else line(`   ⚠ 能力补齐失败：${(deep && deep.error) || 'unknown'}（新增模型按清单元数据收录）`);
                }
              }
            } finally {
              releaseProbe();
            }
            if (!hadKey) line('   ⚠ 未取到该提供商的密钥，探测以未认证姿态进行 —— 结果不可信，本次不做可用性过滤');
          } else if (candidates.length > 0) {
            line(`   清单 ${found.length} 个模型，新发现 ${freshAll.length} 个（目录即权威，无需筛查）`);
          }

          // ③ 合成新清单。顺序策略：**原有条目保持原有顺序**，新收进来的按清单顺序追加在后面。
          //    为什么不用清单顺序整体重排：模型选择器按配置顺序渲染，用户看到的是自己熟悉的排列，
          //    而端点的排列会变（同一条路由，两次拉取的首项就从 qwen3.8-max 变成了 glm-5.3-prime），
          //    照它重排等于让「刷新」顺手把用户的模型列表搅一遍 —— 每次点击都可能变一次顺序，
          //    而条目内容其实没变。追加也顺带让写回的 diff 更小、新模型一眼可见。
          const prevById = new Map((before || []).map((m) => [m.id, m]));
          const next = [];
          const appended = [];
          for (const f of found) {
            const prev = prevById.get(f.id);
            if (prev) { next.push(fillModelEntry(prev, f)); continue; }
            if (alive && !alive.has(f.id)) continue;   // 端点列了但当前调不通 → 不收
            appended.push(modelEntryFrom(f, probed.get(f.id)));
          }
          next.push(...appended);
          const removedIds = before ? before.filter((m) => !foundIds.has(m.id)).map((m) => m.id) : [];

          // ④ 只有真的变了才写：跟随目录的路由在「目录里已有的都在服务中」时不写，
          //    免得把路由钉死在一份等于目录的清单上。
          const served = servedIds.get(provider) || new Set();
          const changed = before
            ? JSON.stringify(before) !== JSON.stringify(next)
            : next.some((m) => !served.has(m.id));
          if (!changed) {
            line(`   = 已是最新（清单 ${found.length} 个，配置里没有变化的条目）`);
            stats.unchanged++;
            continue;
          }

          const draft = cloneJson(userCfg) || {};
          draft.models = next;
          const ops = settingsPathOps(['providers', provider], userCfg, draft);
          if (ops.length === 0) { line('   = 已是最新'); stats.unchanged++; continue; }
          const mut = await api.mutateSettings('llm-pi-ai', ops, piNs() ? piNs().revision : undefined);
          if (!mut || !mut.ok) {
            // 校验在写入处拦下（assertServiceable）：一条 serviceable 不了的清单会被整个拒绝，
            // 原配置保持不动 —— 报出来让用户知道是哪一个提供商，而不是静默半成功。
            line(`   ✗ 写入配置失败：${(mut && mut.error) || 'unknown'}（原配置未改动）`);
            stats.failed++;
            continue;
          }
          // 乐观并发：下一次写必须带新 revision，否则会被 expectedRevision 挡下
          if (mut.revision !== undefined) {
            nsViews['llm-pi-ai'] = Object.assign({ ns: 'llm-pi-ai' }, piNs() || {}, {
              revision: mut.revision,
              ...(mut.value !== undefined ? { value: mut.value } : {}),
              ...(mut.user !== undefined ? { user: mut.user } : {}),
            });
          }
          const addedCount = next.filter((m) => !beforeIds.has(m.id)).length;
          stats.added += addedCount;
          stats.removed += removedIds.length;
          line(`   ✓ 已更新：清单 ${found.length} 个，新增 ${addedCount} 个可用模型`
            + (removedIds.length ? `，移除 ${removedIds.length} 个已不在清单中的模型（${removedIds.slice(0, 6).join('、')}${removedIds.length > 6 ? ' …' : ''}）` : '')
            + (alive && candidates.length ? `，筛查的 ${candidates.length} 个新候选中 ${candidates.length - addedCount} 个当前调不通已排除` : '')
            + (overflow > 0 ? `，另有 ${overflow} 个新候选留待下次刷新筛查` : ''));
        } catch (e) {
          line(`   ✗ 刷新出错：${(e && e.message) || String(e)}`);
          stats.failed++;
        }
      }

      // 其它命名空间里已启用的提供商（如 deepseek-official → llm-deepseek）不归 pi-ai 目录管，
      // 它们的模型由各自插件决定，这里只说明一句，免得用户以为漏刷了。
      const others = providersAll.filter((x) => x.active && x.settingsNs !== 'llm-pi-ai');
      if (others.length > 0) {
        line(`（另有 ${others.length} 个已启用提供商不属 pi-ai 目录：${others.map((x) => x.provider).join('、')}；其模型由各自插件提供，此处不刷新）`);
      }

      // ⑤ 写回后重读一遍：引擎按新配置重新注册路由，界面与对话框都从这一份事实重建
      await new Promise((r) => setTimeout(r, 250));
      await refreshModels();
      notifyChanged();
      // 对话框（chat.js）的模型选择器听这个事件重读 session.models —— 不广播的话
      // 用户刚刷新出来的模型要等切会话才出现。
      window.dispatchEvent(new CustomEvent('dsh:models-refreshed', {
        detail: { source: 'providers', added: stats.added, removed: stats.removed },
      }));
      const failNote = stats.failed > 0 ? `，${stats.failed} 个提供商失败（见上方逐条原因）` : '';
      line(`✓ 刷新完成：检查 ${stats.providers} 个已添加的提供商，新增 ${stats.added} 个可用模型，`
        + `移除 ${stats.removed} 个已下线模型，${stats.unchanged} 个已是最新${failNote}。`);
      line('对话框的模型列表已同步更新；需要连同上下文窗口 / 输出上限 / 思考档位一起重探的，'
        + '在对应提供商卡片里用「↻ 更新模型与能力」。');
      finish(stats.failed > 0 ? 'bad' : 'ok');
      return Object.assign(stats, { ok: true });
    } catch (e) {
      line('刷新出错：' + ((e && e.message) || String(e)));
      finish('bad');
      return { ok: false, error: (e && e.message) || String(e) };
    } finally {
      syncRunning = false;
      if (btn) { btn.disabled = false; btn.textContent = '↻ 刷新模型'; }
    }
  }

  // ---------------- 事件绑定（原先在 settings.js 的 bind() 里） ----------------
  function wire() {
    $('#providerSelect').addEventListener('change', renderModelGroups);
    // 这个按钮以前只是「重读一遍引擎当前加载了什么」—— 清单本身不会因此变长，点了像没反应。
    // 现在它做真正的事：向每个已添加的提供商重新问一遍清单，把差异写回配置（见 syncAllModels）。
    $('#refreshModelsBtn').addEventListener('click', () => { syncAllModels(); });
    renderCustomProviderForm();
    // 探测进度只订阅一次（见 probeSink 的说明）
    api.onProbeProgress((t) => { if (probeSink) probeSink(t); });
  }

  /**
   * 本模块保存成功后广播一次，让「配置仓库」页跟着重读。
   * 只在保存 / 删除成功后调用，不在每次 refresh 时调用 ——
   * 否则两个模块的监听会互相触发，形成「刷新 → 广播 → 刷新」的回环。
   */
  function notifyChanged() {
    window.dispatchEvent(new CustomEvent('dsh:settings-saved', {
      detail: { ns: 'llm-pi-ai', source: 'providers' },
    }));
  }

  // 反向：别处（配置仓库页）保存后这边也要重读 —— 下拉框里的「N 个模型」会变。
  // source 是自己的就跳过：自己保存时已经刷过一遍，再刷一次只是白打一轮引擎请求。
  window.addEventListener('dsh:settings-saved', (e) => {
    const d = e.detail || {};
    if (d.source === 'providers') return;
    if (d.ns && d.ns !== 'llm-pi-ai') return;
    refreshModels();
  });

  // index.html 里本文件排在 settings.js **之前**，所以 settings.js 的 init() 走到
  // refreshProviders() 时这个入口必然已经存在（脚本加载是同步的，IPC 回调要等下一轮事件循环）。
  // syncModels 是「刷新模型」的可编程入口：对话框（chat.js）的模型面板也用它，
  // 这样「写配置 + 重读 + 广播」这套语义只有一份实现，不会两边各写一套而漂移。
  window.__providers = { refresh: refreshModels, syncModels: syncAllModels };

  wire();
})();
