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

  async function refreshModels() {
    const stats = $('#providerStats');
    const sel = $('#providerSelect');
    const [lp, lm, sd] = await Promise.all([
      api.getLlmProviders(),
      api.getLlmModels(),
      api.getSettingsDescribe(),
    ]);
    if (!lp.ok && !lm.ok) {
      sel.innerHTML = '<option value="">（获取失败）</option>';
      stats.innerHTML = `<div class="empty">模型目录获取失败：${esc(lp.error || lm.error)}</div>`;
      $('#modelGroupList').innerHTML = '';
      return;
    }
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
    const cr = await api.describeCredentials(refs);
    credStates = cr.ok ? cr.credentials || {} : {};
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
    // 主进程逐行推进度（注册前会清掉上一次的监听，反复开编辑器不会堆积）
    api.onProbeProgress((line) => { if (probeBtn.disabled) probeOutput(line); });
    probeBtn.addEventListener('click', async () => {
      const url = urlMode.value === 'custom' ? urlInput.value.trim() : (baseURL || '');
      if (!/^https?:\/\//.test(url)) { probeOutput('请先填写 API 地址（baseURL）再刷新', 'bad'); return; }
      const ep = routeEndpoint();   // 协议取值与「测试连接」共用同一套判断
      const api2 = ep.api;
      const key = currentTypedKey();
      probeBtn.disabled = true; probeBtn.textContent = '刷新中…';
      probeOutput('正在向端点获取模型清单…');
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

  // ---------------- 事件绑定（原先在 settings.js 的 bind() 里） ----------------
  function wire() {
    $('#providerSelect').addEventListener('change', renderModelGroups);
    $('#refreshModelsBtn').addEventListener('click', refreshModels);
    renderCustomProviderForm();
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
  window.__providers = { refresh: refreshModels };

  wire();
})();
