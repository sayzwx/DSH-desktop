/**
 * 配置仓库：`llm-pi-ai` 提供商与模型配置的可视化编辑器
 *
 * ## 为什么配置只能存在这里
 *
 * 这些配置**不能**另找一个地方存（比如自己建个 providers.json）。引擎里的
 * `@deepseek-ai/dsh-llm-pi-ai` 适配器在挂载时是从它自己的 settings namespace 读的，
 * 写别处等于没写。所以「配置仓库」指的就是 `~/.dsh/settings.yaml` 里 `llm-pi-ai:` 这一段。
 * 本页面是它的可视化编辑器，不是它的替代品。
 *
 * ## 三层叠加 —— 本页面只编辑中间那一层
 *
 *   schema 默认层   引擎插件内置（如 defaultContextWindow: 262144、streamIdleTimeoutMs: 300000）
 *   用户层          settings.yaml，即 persons 真正"存下来"的东西  ← 本页面编辑的就是它
 *   合并后的值      前两层叠加，引擎实际使用的值（settings.describe 的 value 字段）
 *
 * 为什么必须认准中间层：界面如果拿「合并后的值」当草稿再整段写回，就会把 schema 默认值
 * **固化**成用户数据。实测过这个后果——`ali` 路由下面出现了用户从没填过的
 * `modelOverrides: {}` / `defaultContextWindow: 262144` / `streamIdleTimeoutMs: 300000`，
 * 模型对象里还带上了 `input: []`。文件越写越胖，而且 schema 一旦升级，这些旧默认值
 * 会盖住新默认值。官方 Web UI 的 ProviderEditor 注释把这条规则写得很直白：
 * "Profile edits land as minimal `settings.mutate` path ops against the stored section"。
 *
 * 所以本页面的做法是：
 *   1. 草稿 = `namespace.user.providers.<route>` 的深拷贝（只有用户层）
 *   2. 保存 = 把草稿与用户层做 diff，只发**变了的字段**的 `set` / `删掉的字段`的 `unset`
 *   3. 「用默认」= 从草稿里删掉该字段（发 unset），值随即回落到 schema 默认
 *
 * ## 写进去的东西会被引擎怎么读
 *
 * 有几条语义不看引擎源码看不出来，界面必须把它们讲清楚，否则小白改一下就坏：
 *
 * - **`models` 非空 = 整个替换内置目录**。给一条内置路由（如 deepseek）加一个模型，
 *   其它几十个模型会一起消失。"只想修正一个模型"要用 `modelOverrides`。
 * - **`modelOverrides` 只在 `models` 为空时能用**，而且只能点名内置目录里已有的 id。
 *   两者同时非空，引擎直接报错拒绝。
 * - **`reasoningEfforts` 省略 ≠ 继承**。手写路由没有内置目录，省略就等于
 *   `reasoning: false`（模型不思考）。`false` 是「明确声明不思考」的合法值；
 *   但 `{}`（空对象）和 `null` 都是**非法**的，引擎会报
 *   "has an empty reasoningEfforts"。
 * - **只有 `off` 档允许留空值**，其余档位必须给线上拼写，且不能是空串。
 * - **一条路由不能声明「只有 off」**：要么给至少一个思考档，要么写 `false`。
 *
 * ## 密钥
 *
 * `apiKeyEnv` 只是一个**变量名**，明文密钥存在 `~/.dsh/.credentials.yaml`。
 * 主进程负责把明文读出来用于出站请求，**永远不跨 IPC 回渲染进程**，所以本页面
 * 只能显示"已配置 / 未配置"，无法回显密钥，这是有意为之的安全边界。
 *
 * @module renderer/registry
 */

(function () {
  'use strict';

  const api = window.api;
  const $ = (s) => document.querySelector(s);
  /** 属性安全的转义：比其它模块多转义引号，因为本模块把值写进 value="…"。 */
  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  const NS = 'llm-pi-ai';

  // ---------------- 状态 ----------------
  let nsView = null;          // settings.describe 里的 llm-pi-ai 命名空间视图
  let runtime = [];           // llm.providers 里属于 llm-pi-ai 的运行时条目（含 declared）
  let creds = {};             // 凭据引用名 -> { configured, writable }
  let writable = true;
  let engineLevels = [];      // 引擎认识的档位名，由主进程给出（见 preload 的 reasoningLevels）
  let wireMap = {};           // 档位 -> 线上拼写候选
  const openRoutes = new Set();  // 展开中的路由（刷新后保持）
  const drafts = new Map();      // route -> 编辑中的草稿（用户层副本）
  let loaded = false;

  // ---------------- 小工具 ----------------
  const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  function getAt(root, path) {
    let cur = root;
    for (const k of path) {
      if (!isPlain(cur)) return undefined;
      cur = cur[k];
    }
    return cur;
  }

  function setAt(root, path, value) {
    let cur = root;
    for (let i = 0; i < path.length - 1; i++) {
      const k = path[i];
      if (!isPlain(cur[k])) cur[k] = {};
      cur = cur[k];
    }
    cur[path[path.length - 1]] = value;
  }

  function delAt(root, path) {
    const parents = [];
    let cur = root;
    for (let i = 0; i < path.length - 1; i++) {
      const k = path[i];
      if (!isPlain(cur[k])) return;
      parents.push([cur, k]);
      cur = cur[k];
    }
    delete cur[path[path.length - 1]];
    // 一路回收空壳，避免留下 compat: {} 这类空对象——引擎对空对象往往直接报错。
    for (let i = parents.length - 1; i >= 0; i--) {
      const [parent, key] = parents[i];
      if (isPlain(parent[key]) && Object.keys(parent[key]).length === 0) delete parent[key];
    }
  }

  /**
   * 把 `after` 相对 `before` 的差异翻成最小的 set/unset 路径操作。
   * 语义与官方 `ui-settings-models/ProviderEditor.pathOps` 一致：
   * 只点名「本页面看得见的字段」，没动过的字段不发任何操作，
   * 因此不会像整段 replace 那样把看不见的字段删掉。
   */
  function pathOps(base, before, after) {
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

  /** 用户层里存下来的路由表 —— 这才是「配置仓库」的内容。 */
  const userRoutes = () => (isPlain(nsView && nsView.user && nsView.user.providers) ? nsView.user.providers : {});
  /** 合并后的路由表（含 schema 默认值），只用于展示"继承来的默认是什么"。 */
  const mergedOf = (route) => {
    const all = nsView && isPlain(nsView.value) ? nsView.value.providers : null;
    const v = all ? all[route] : undefined;
    return isPlain(v) ? v : {};
  };
  const runtimeOf = (route) => runtime.find((p) => p.provider === route) || null;
  /** 该路由是否由本配置手写声明（pi-ai 没有它的内置目录）。 */
  const isDeclared = (route) => {
    const rt = runtimeOf(route);
    if (rt && typeof rt.declared === 'boolean') return rt.declared;
    // 运行时目录拿不到时的兜底：自己声明了 api + baseURL 的，就是手写路由。
    const m = mergedOf(route);
    return !!(m.api && m.baseURL);
  };
  /** 与 Web UI 同一约定：provider 路由 id -> 凭据引用名。 */
  const deriveKeyRef = (route) => route.toUpperCase().replace(/[^A-Z0-9]+/g, '_') + '_API_KEY';
  const keyRefOf = (route) => {
    const named = getAt(userRoutes()[route], ['apiKeyEnv']);
    if (typeof named === 'string' && named.length > 0) return named;
    const m = getAt(mergedOf(route), ['apiKeyEnv']);
    return (typeof m === 'string' && m.length > 0) ? m : deriveKeyRef(route);
  };

  // ---------------- 字段清单 ----------------
  /**
   * 逐字段的可视化编辑。`declaredOnly` 的字段只在手写路由上出现——
   * 内置路由的协议与地址由 pi-ai 的目录决定，路由级覆盖会连带影响它下面所有模型。
   */
  const FIELDS = [
    { path: ['displayName'], label: '显示名称', type: 'text',
      hint: '模型选择器和提供商卡片上显示的名字' },
    { path: ['apiKeyEnv'], label: '密钥引用名', type: 'text',
      hint: '只是一个变量名；真正的密钥存本机 ~/.dsh/.credentials.yaml，界面不回显明文' },
    { path: ['api'], label: 'API 协议', type: 'enum', declaredOnly: true,
      hint: '决定请求体怎么拼，选错会一路 400' },
    { path: ['baseURL'], label: 'API 地址', type: 'text', declaredOnly: true,
      hint: '要写到 /v1 这一层，例：https://dashscope.aliyuncs.com/compatible-mode/v1' },
    { path: ['compat', 'supportsDeveloperRole'], label: '禁用 developer 角色', type: 'bool', declaredOnly: true,
      hint: '第三方网关多半不认 role=developer，而开了思考档位的模型在标准 OpenAI 语义下会发它。勾上改回 system' },
    { path: ['defaultContextWindow'], label: '默认上下文窗口', type: 'number',
      hint: '模型没单独声明上下文窗口时用它（单位：token）' },
    { path: ['defaultMaxTokens'], label: '默认输出上限', type: 'number',
      hint: '模型没单独声明输出上限时用它（单位：token）' },
    { path: ['streamIdleTimeoutMs'], label: '流空闲超时（毫秒）', type: 'number',
      hint: '思考型模型长时间不出第一个字会被误判成断流，慢的端点可以调大' },
    { path: ['maxRequestImageBytes'], label: '单请求图片上限（字节）', type: 'number',
      hint: '发图给视觉模型时的体积上限' },
    { path: ['defaultInput'], label: '默认输入模态', type: 'list',
      hint: '逗号分隔，可选 text / image。模型没单独声明时用这个' },
    { path: ['headers'], label: '自定义请求头', type: 'kv',
      hint: '每行一个 Key: Value。写 Authorization 会盖掉密钥鉴权，谨慎' },
  ];

  const API_PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages'];
  const API_LABELS = {
    'openai-completions': 'OpenAI Completions',
    'openai-responses': 'OpenAI Responses',
    'anthropic-messages': 'Anthropic Messages',
  };

  // ---------------- 载入 ----------------
  /**
   * 读一次配置仓库并重画。**任何异常都要在页面上说出来**。
   *
   * 为什么必须包一层：renderer 的文件和 preload 的桥是在不同时刻从磁盘加载的
   * （preload 在窗口创建时、index.html 与各 .js 在页面加载时），开发期反复改文件
   * 很容易出现「新页面 + 旧桥」的错位组合。这时某个桥方法不存在或没有对应的 IPC 处理器，
   * `ipcRenderer.invoke` 会直接 reject。不兜底的话页面只是**静默空白**，
   * 控制台一条未处理拒绝——用户看到的就是"点了没反应"，完全无从下手。
   */
  async function load() {
    const listEl = $('#rgRouteList');
    if (!listEl) return;              // 页面里没有这个模块，直接不干活
    try {
      await loadInner(listEl);
    } catch (e) {
      const msg = (e && e.message) || String(e);
      const stats = $('#rgStats');
      if (stats) stats.innerHTML = '';
      listEl.innerHTML = `<div class="empty">配置仓库读取失败：${esc(msg)}<br>`
        + '如果提示某个方法不存在或没有对应的处理器，说明界面文件与 preload 桥不是同一版本——'
        + '完全退出应用（不是关窗口）再重新打开一次即可。</div>';
    }
  }

  async function loadInner(listEl) {
    const [sd, lp, rl] = await Promise.all([
      api.getSettingsDescribe(),
      api.getLlmProviders(),
      // 桥版本可能比页面旧：方法不在就直接跳过，不要让它把整次加载拖崩
      typeof api.reasoningLevels === 'function'
        ? api.reasoningLevels().catch(() => null)
        : Promise.resolve(null),
    ]);
    if (rl && rl.ok) { engineLevels = rl.engine || []; wireMap = rl.wire || {}; }
    if (!engineLevels.length) engineLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

    writable = sd.ok ? sd.writable !== false : false;
    nsView = sd.ok ? (sd.namespaces || []).find((n) => n.ns === NS) || null : null;
    runtime = (lp.ok ? lp.providers || [] : []).filter((p) => p.settingsNs === NS);

    if (!nsView) {
      listEl.innerHTML = `<div class="empty">读不到 ${esc(NS)} 配置域：${esc(sd.error || '引擎未就绪')}</div>`;
      const s = $('#rgStats');
      if (s) s.innerHTML = '';
      return;
    }

    // 批量问一次凭据状态（一个往返），拿"已配置/未配置"
    const routes = Object.keys(userRoutes());
    const allRefs = [...new Set([
      ...routes.map(keyRefOf),
      ...runtime.map((p) => deriveKeyRef(p.provider)),
    ])];
    const cr = await api.describeCredentials(allRefs);
    creds = cr.ok ? cr.credentials || {} : {};

    // 配置被外部改动（比如另一个面板存过）后，丢弃旧草稿，避免拿着过期基线做 diff
    drafts.clear();
    loaded = true;
    render();
  }

  // ---------------- 总渲染 ----------------
  function render() {
    const stats = $('#rgStats');
    const listEl = $('#rgRouteList');
    if (!stats || !listEl) return;

    const routes = Object.keys(userRoutes()).sort();
    const declared = routes.filter(isDeclared).length;
    const withModels = routes.filter((r) => (getAt(userRoutes()[r], ['models']) || []).length > 0).length;
    const keyed = routes.filter((r) => (creds[keyRefOf(r)] || {}).configured).length;

    stats.innerHTML =
      `<span class="pstat">配置仓库里 ${routes.length} 条路由</span>`
      + `<span class="pstat">${declared} 条手写声明</span>`
      + `<span class="pstat">${withModels} 条自带模型清单</span>`
      + `<span class="pstat ${keyed ? 'ok' : ''}">${keyed} 条已配密钥</span>`
      + `<span class="pstat">配置版本 r${esc(nsView ? nsView.revision : '?')}</span>`
      + (writable ? '' : '<span class="pstat warn">设置只读</span>');

    if (!routes.length) {
      listEl.innerHTML = '<div class="empty">配置仓库还是空的。在上面的「模型配置」里选一个提供商填密钥，或直接在下方「未配置的内置提供商」里加一条。</div>';
    } else {
      listEl.innerHTML = routes.map((r) => routeCard(r)).join('');
      routes.forEach((r) => wireRouteCard(r));
    }

    renderBuiltin();
    const raw = $('#rgRawPre');
    if (raw) raw.textContent = JSON.stringify(userRoutes(), null, 2);
  }

  /** 未配置的内置路由：默认就能用，只有要改地址/换引用名时才需要落一条配置。 */
  function renderBuiltin() {
    const listEl = $('#rgBuiltinList');
    const sum = $('#rgBuiltinSummary');
    if (!listEl) return;
    const configured = new Set(Object.keys(userRoutes()));
    const rest = runtime.filter((p) => !configured.has(p.provider));
    if (sum) sum.textContent = `未配置的内置提供商（${rest.length}）`;
    if (!rest.length) {
      listEl.innerHTML = '<div class="empty">运行时目录里的路由都已经在仓库里了。</div>';
      return;
    }
    listEl.innerHTML = rest.map((p) => {
      const ref = deriveKeyRef(p.provider);
      const st = creds[ref] || {};
      return `<div class="rg-builtin-row">
        <span class="rg-builtin-name">${esc(p.displayName || p.provider)}</span>
        <code class="rg-route-code">${esc(p.provider)}</code>
        ${p.active ? '<span class="badge trust-system">运行时已启用</span>' : ''}
        ${st.configured ? `<span class="badge trust-system">${esc(ref)} 已配</span>` : ''}
        <span class="rg-spacer"></span>
        <button class="mini-btn rg-builtin-add" type="button" data-route="${esc(p.provider)}"
          title="在配置仓库里为它落一条配置；不落也能用，落了你才能改它的地址或引用名">添加配置</button>
      </div>`;
    }).join('');
    listEl.querySelectorAll('.rg-builtin-add').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const route = btn.dataset.route;
        btn.disabled = true; btn.textContent = '添加中…';
        try {
          // 只写一个 apiKeyEnv 引用名，其余全部留给 schema 默认——这正是官方
          // 卡片「输入密钥即物化 profile」的等价物，写多了反而固化默认值。
          const r = await api.mutateSettings(NS,
            [{ op: 'set', path: ['providers', route], value: { apiKeyEnv: deriveKeyRef(route) } }],
            nsView ? nsView.revision : undefined);
          if (!r.ok) { toast('添加失败：' + (r.error || 'unknown'), 'bad'); return; }
          openRoutes.add(route);
          toast(`已在仓库里创建 <code>${esc(route)}</code>`, 'ok');
          await load();
          notifyChanged();
        } catch (e) {
          toast('添加出错：' + (e.message || String(e)), 'bad');
        } finally {
          btn.disabled = false; btn.textContent = '添加配置';
        }
      });
    });
  }

  // ---------------- 路由卡片 ----------------
  function routeCard(route) {
    const stored = userRoutes()[route] || {};
    const merged = mergedOf(route);
    const rt = runtimeOf(route);
    const ref = keyRefOf(route);
    const keySt = creds[ref] || {};
    const models = getAt(stored, ['models']);
    const modelCount = Array.isArray(models) ? models.length : 0;
    const overrides = getAt(stored, ['modelOverrides']);
    const ovCount = isPlain(overrides) ? Object.keys(overrides).length : 0;
    const open = openRoutes.has(route);

    const badges = [
      `<span class="badge ${isDeclared(route) ? 'trust-user' : 'trust-system'}">${isDeclared(route) ? '手写声明' : '内置目录'}</span>`,
      `<span class="badge ${keySt.configured ? 'trust-system' : 'trust-user'}">${keySt.configured ? '密钥已配' : '未配密钥'}</span>`,
      modelCount ? `<span class="badge trust-system">自定义 ${modelCount} 个模型</span>` : '',
      ovCount ? `<span class="badge trust-system">修正 ${ovCount} 个模型</span>` : '',
      rt && rt.active ? '<span class="badge trust-system">运行时已启用</span>' : '',
    ].filter(Boolean).join('');

    return `<div class="rg-route${open ? ' open' : ''}" data-route="${esc(route)}">
      <div class="rg-route-head">
        <span class="rg-chevron">${open ? '▾' : '▸'}</span>
        <span class="rg-route-name">${esc((stored.displayName || merged.displayName) || route)}</span>
        <code class="rg-route-code">${esc(route)}</code>
        ${badges}
        <span class="rg-spacer"></span>
        <span class="rg-dirty" hidden>未保存</span>
      </div>
      <div class="rg-route-body" ${open ? '' : 'hidden'}></div>
    </div>`;
  }

  function wireRouteCard(route) {
    const card = document.querySelector(`.rg-route[data-route="${cssEscape(route)}"]`);
    if (!card) return;
    const head = card.querySelector('.rg-route-head');
    head.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const isOpen = openRoutes.has(route);
      if (isOpen) {
        openRoutes.delete(route);
        // 收起即丢弃草稿，避免"改了没存"的内容在下次展开时突然复活
        drafts.delete(route);
      } else {
        openRoutes.add(route);
      }
      card.classList.toggle('open', !isOpen);
      card.querySelector('.rg-chevron').textContent = isOpen ? '▸' : '▾';
      const body = card.querySelector('.rg-route-body');
      body.hidden = isOpen;
      if (!isOpen) renderBody(card, route);
      else body.innerHTML = '';
    });
    if (openRoutes.has(route)) renderBody(card, route);
  }

  /** CSS 属性选择器里的转义（路由 id 理论上可能带点号等字符）。 */
  function cssEscape(s) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
    return String(s).replace(/["\\]/g, '\\$&');
  }

  // ---------------- 编辑体 ----------------
  function draftOf(route) {
    if (!drafts.has(route)) drafts.set(route, clone(userRoutes()[route]) || {});
    return drafts.get(route);
  }

  function renderBody(card, route) {
    const body = card.querySelector('.rg-route-body');
    const d = draftOf(route);
    const declared = isDeclared(route);
    const ref = keyRefOf(route);
    const keySt = creds[ref] || {};

    const fieldHtml = FIELDS
      .filter((f) => !f.declaredOnly || declared)
      .map((f) => fieldRow(d, route, f))
      .join('');

    body.innerHTML = `
      <div class="rg-section">
        <div class="rg-section-title">基础字段</div>
        <div class="rg-fields">${fieldHtml}</div>
      </div>

      <div class="rg-section">
        <div class="rg-section-title">API 密钥</div>
        <div class="rg-key-row">
          <span class="mg-key-ref">${esc(ref)}</span>
          <span class="badge ${keySt.configured ? 'trust-system' : 'trust-user'}">${keySt.configured ? '已配置——输入新值可替换' : '未配置'}</span>
          <input type="password" class="sm-input rg-key-input" autocomplete="off"
            placeholder="粘贴密钥（只进本机凭据库，界面不回显）" ${keySt.writable === false ? 'disabled' : ''} />
          <button class="mini-btn rg-key-save" type="button" ${keySt.writable === false ? 'disabled' : ''}>保存密钥</button>
        </div>
        <div class="rg-key-msg"></div>
      </div>

      <div class="rg-section">
        <div class="rg-section-title">模型目录</div>
        <div class="rg-models-mode"></div>
        <div class="rg-models-body"></div>
        <div class="rg-probe-row">
          <button class="mini-btn rg-probe-btn" type="button"
            title="向端点现场问一遍：模型清单、上下文窗口、输出上限、可用思考档位、当前是否可用">↻ 更新模型与能力</button>
          <span class="mg-probe-note">会发少量 <code>max_tokens=1</code> 的探测请求，token 消耗可忽略</span>
        </div>
        <div class="mg-discover-output"></div>
      </div>

      <div class="rg-actions">
        <button class="mini-btn rg-discard" type="button">放弃改动</button>
        <button class="mini-btn primary-btn rg-save" type="button">保存到配置</button>
        <button class="mini-btn danger-btn rg-remove" type="button">删除整条配置</button>
        <span class="rg-save-msg"></span>
      </div>`;

    renderModelsSection(body, route, d, declared);
    wireFields(body, route, d);
    wireKey(body, route, ref);
    wireActions(body, card, route, d);
    syncDirty(card, route, d);
  }

  /**
   * 一个字段一行。三种形态：
   *  - 用户层里有 → 可编辑 + 「↺ 用默认」
   *  - 用户层里没有、只有 schema 默认 → 只读展示默认值 + 「改」（把它拉进草稿）
   *  - 两边都没有 → 显示"未设置" + 「改」
   * 「用默认」发的是 unset，值随即回落到 schema 默认——这才是"恢复默认"，而不是把默认值抄进去。
   */
  function fieldRow(draft, route, f) {
    const stored = getAt(draft, f.path);
    const inherited = getAt(mergedOf(route), f.path);
    const isSet = stored !== undefined;
    const shown = isSet ? stored : inherited;
    const badge = isSet
      ? '<span class="badge trust-user">已设置</span>'
      : (inherited === undefined ? '' : '<span class="badge trust-system">默认</span>');

    let control = '';
    if (f.type === 'bool') {
      const checked = shown === true ? ' checked' : '';
      control = `<label class="rg-bool"><input type="checkbox" class="rg-in"${checked}${isSet ? '' : ' disabled'} /> 启用</label>`;
    } else if (f.type === 'enum') {
      control = `<select class="sm-input rg-in"${isSet ? '' : ' disabled'}>${
        API_PROTOCOLS.map((v) => `<option value="${esc(v)}"${v === shown ? ' selected' : ''}>${esc(API_LABELS[v] || v)}</option>`).join('')
      }</select>`;
    } else if (f.type === 'kv') {
      const obj = isPlain(shown) ? shown : {};
      control = `<div class="rg-kv">${
        Object.entries(obj).map(([k, v]) => `<div class="rg-kv-row">
          <input type="text" class="sm-input rg-kv-k" value="${esc(k)}" placeholder="Header 名"${isSet ? '' : ' disabled'} />
          <input type="text" class="sm-input rg-kv-v" value="${esc(v)}" placeholder="值"${isSet ? '' : ' disabled'} />
          <button class="mini-btn rg-kv-del" type="button"${isSet ? '' : ' disabled'}>✕</button>
        </div>`).join('')
      }<button class="mini-btn rg-kv-add" type="button"${isSet ? '' : ' disabled'}>＋ 加一行</button></div>`;
    } else if (f.type === 'list') {
      const val = Array.isArray(shown) ? shown.join(', ') : '';
      control = `<input type="text" class="sm-input rg-in" value="${esc(val)}" placeholder="text, image"${isSet ? '' : ' disabled'} />`;
    } else if (f.type === 'number') {
      const val = num(shown);
      control = `<input type="number" class="sm-input rg-in" value="${val === null ? '' : esc(val)}"${isSet ? '' : ' disabled'} />`;
    } else {
      control = `<input type="text" class="sm-input rg-in" value="${esc(typeof shown === 'string' ? shown : '')}" placeholder="${esc(f.hint)}"${isSet ? '' : ' disabled'} />`;
    }

    const text = Array.isArray(inherited) ? inherited.join(', ')
      : (isPlain(inherited) ? JSON.stringify(inherited) : String(inherited ?? ''));

    return `<div class="rg-field" data-path="${esc(f.path.join('.'))}">
      <div class="rg-field-head">
        <span class="rg-field-label">${esc(f.label)}</span>
        ${badge}
        <span class="rg-spacer"></span>
        <button class="mini-btn rg-field-toggle" type="button">${isSet ? '↺ 用默认' : '改'}</button>
      </div>
      ${control}
      <div class="rg-field-hint">${esc(f.hint)}${!isSet && inherited !== undefined ? ` —— 当前用的是默认值 <code>${esc(text)}</code>` : ''}</div>
    </div>`;
  }

  function wireFields(body, route, d) {
    body.querySelectorAll('.rg-field').forEach((row) => {
      const path = row.dataset.path.split('.');
      const f = FIELDS.find((x) => x.path.join('.') === row.dataset.path);
      if (!f) return;
      const toggle = row.querySelector('.rg-field-toggle');
      if (toggle) toggle.addEventListener('click', () => {
        if (getAt(d, path) === undefined) {
          const inherited = getAt(mergedOf(route), path);
          // 拉进草稿：默认值作为起点，用户就能在它上面改
          setAt(d, path, clone(inherited) !== undefined ? clone(inherited)
            : (f.type === 'kv' ? {} : f.type === 'list' ? [] : f.type === 'bool' ? false : f.type === 'number' ? 0 : ''));
        } else {
          delAt(d, path);
        }
        const card = row.closest('.rg-route');
        renderBody(card, route);
      });

      const write = (value) => {
        if (value === undefined) delAt(d, path); else setAt(d, path, value);
        syncDirty(row.closest('.rg-route'), route, d);
      };

      const input = row.querySelector('.rg-in');
      if (input) {
        const handler = () => {
          if (f.type === 'bool') { write(input.checked); return; }
          if (f.type === 'number') {
            const v = Number(input.value);
            write(input.value.trim() === '' || !Number.isFinite(v) ? undefined : v);
            return;
          }
          if (f.type === 'list') {
            const arr = input.value.split(',').map((s) => s.trim()).filter(Boolean);
            write(arr.length ? arr : undefined);
            return;
          }
          const v = input.value.trim();
          write(v === '' ? undefined : v);
        };
        input.addEventListener('input', handler);
        input.addEventListener('change', handler);
      }

      // Headers 键值对
      if (f.type === 'kv') {
        const rebuild = () => {
          const obj = {};
          row.querySelectorAll('.rg-kv-row').forEach((r) => {
            const k = r.querySelector('.rg-kv-k').value.trim();
            const v = r.querySelector('.rg-kv-v').value;
            if (k) obj[k] = v;
          });
          write(Object.keys(obj).length ? obj : undefined);
        };
        row.querySelectorAll('.rg-kv-k, .rg-kv-v').forEach((i) => i.addEventListener('input', rebuild));
        row.querySelectorAll('.rg-kv-del').forEach((b) => b.addEventListener('click', () => {
          b.closest('.rg-kv-row').remove();
          rebuild();
        }));
        const add = row.querySelector('.rg-kv-add');
        if (add) add.addEventListener('click', () => {
          const box = row.querySelector('.rg-kv');
          const div = document.createElement('div');
          div.className = 'rg-kv-row';
          div.innerHTML = '<input type="text" class="sm-input rg-kv-k" placeholder="Header 名" />'
            + '<input type="text" class="sm-input rg-kv-v" placeholder="值" />'
            + '<button class="mini-btn rg-kv-del" type="button">✕</button>';
          box.insertBefore(div, add);
          div.querySelector('.rg-kv-del').addEventListener('click', () => { div.remove(); rebuild(); });
          div.querySelectorAll('input').forEach((i) => i.addEventListener('input', rebuild));
        });
      }
    });
  }

  // ---------------- 模型目录 ----------------
  /**
   * 模型目录有三种形态，取决于用户层存了什么：
   *   catalog   —— models 空 / modelOverrides 空：完全跟随 pi-ai 内置目录
   *   list      —— models 非空：**整份替换**内置目录
   *   overrides —— modelOverrides 非空（且 models 空）：只修正内置目录里的个别模型
   * 手写路由没有内置目录可跟随，只能 list（引擎对它的 modelOverrides 直接报错）。
   */
  function modeOf(d, declared) {
    const models = getAt(d, ['models']);
    const ov = getAt(d, ['modelOverrides']);
    if (Array.isArray(models) && models.length > 0) return 'list';
    if (isPlain(ov) && Object.keys(ov).length > 0) return 'overrides';
    return declared ? 'list' : 'catalog';
  }

  function renderModelsSection(body, route, d, declared) {
    const modeEl = body.querySelector('.rg-models-mode');
    const listEl = body.querySelector('.rg-models-body');
    const mode = modeOf(d, declared);
    const models = Array.isArray(getAt(d, ['models'])) ? getAt(d, ['models']) : [];
    const ov = isPlain(getAt(d, ['modelOverrides'])) ? getAt(d, ['modelOverrides']) : {};

    modeEl.innerHTML = declared
      ? '<div class="rg-mode-note">这条路由是<strong>手写声明</strong>的：pi-ai 没有它的内置目录，所以模型必须在这里逐个列出来，一个都不能少。</div>'
      : `<div class="rg-modes">
          <label class="rg-mode"><input type="radio" name="rgm-${esc(route)}" value="catalog"${mode === 'catalog' ? ' checked' : ''} /> 跟随内置目录</label>
          <label class="rg-mode"><input type="radio" name="rgm-${esc(route)}" value="list"${mode === 'list' ? ' checked' : ''} /> 自定义模型清单</label>
          <label class="rg-mode"><input type="radio" name="rgm-${esc(route)}" value="overrides"${mode === 'overrides' ? ' checked' : ''} /> 只修正个别模型</label>
        </div>
        <div class="rg-mode-note">${
          mode === 'list'
            ? '⚠️ 一旦这里列了模型，<strong>整份替换</strong>内置目录——没列出来的内置模型会一起消失。只改一两个模型请用「只修正个别模型」。'
            : mode === 'overrides'
              ? '在保留内置目录全部模型的前提下，覆盖其中几个的窗口 / 输出上限 / 思考档位。模型 ID 必须是内置目录里已有的。'
              : '内置目录里有几个模型就用几个，配置里不写模型清单。'
        }</div>`;

    modeEl.querySelectorAll('input[type=radio]').forEach((r) => r.addEventListener('change', () => {
      if (!r.checked) return;
      if (r.value === 'catalog') {
        delAt(d, ['models']);
        delAt(d, ['modelOverrides']);
      } else if (r.value === 'list') {
        if (!Array.isArray(getAt(d, ['models']))) setAt(d, ['models'], []);
        delAt(d, ['modelOverrides']);
      } else {
        delAt(d, ['models']);
        if (!isPlain(getAt(d, ['modelOverrides']))) setAt(d, ['modelOverrides'], {});
      }
      renderBody(body.closest('.rg-route'), route);
    }));

    if (mode === 'catalog') {
      const mergedModels = getAt(mergedOf(route), ['models']);
      const n = Array.isArray(mergedModels) ? mergedModels.length : 0;
      listEl.innerHTML = `<div class="rg-empty-note">跟随内置目录${n ? `（本条配置里存了 ${n} 条，但为空时以目录为准）` : ''}。每条内置路由的模型数量由 pi-ai 决定，这里不展示。</div>`;
      return;
    }

    const rows = mode === 'list' ? models : ov;
    listEl.innerHTML = (mode === 'list' ? models : Object.entries(ov).map(([id, v]) => ({ id, ...v })))
      .map((m, i) => modelRow(m, i, mode))
      .join('') || `<div class="rg-empty-note">${mode === 'list' ? '还没有模型。至少列一个——空清单等价于「跟随内置目录」。' : '还没有要修正的模型。'}</div>`;

    listEl.insertAdjacentHTML('beforeend', `<div class="rg-model-add">
      <input type="text" class="sm-input rg-model-add-input" placeholder="输入模型 ID，如 qwen3.8-max" />
      <button class="mini-btn rg-model-add-btn" type="button">＋ 添加模型</button>
    </div>`);

    wireModelRows(listEl, route, d, mode);
  }

  /**
   * 一行模型。`reasoningEfforts` 用三态下拉 + 档位点选，而不是让人写 `{off: none}`：
   *  - 继承内置目录（省略字段）：内置路由才有意义；手写模型省略 = 不思考
   *  - 不思考（false）：明确声明成非思考模型
   *  - 自定义档位：展开档位点选，右侧是引擎认识的全部档位
   * 空对象 `{}` 是引擎明确拒绝的值，所以"一个档都不选"会被转成 `false`，不会写出 `{}`。
   */
  function modelRow(m, i, mode) {
    const eff = m.reasoningEfforts;
    const isFalse = eff === false;
    const isMap = isPlain(eff) && Object.keys(eff).length > 0;
    const state = isMap ? 'custom' : (isFalse ? 'false' : 'inherit');
    const chips = engineLevels.map((lv) => {
      const on = isMap && lv in eff;
      return `<button class="rg-chip${on ? ' on' : ''}" type="button" data-level="${esc(lv)}"
        title="${esc(lv)}${on ? '（线上拼写：' + esc(String(eff[lv])) + '）' : ''}">${esc(lv)}</button>`;
    }).join('');

    return `<div class="rg-model" data-i="${i}">
      <div class="rg-model-line">
        <input type="text" class="sm-input rg-m-id" value="${esc(m.id || '')}" placeholder="模型 ID" />
        <input type="text" class="sm-input rg-m-name" value="${esc(m.name || '')}" placeholder="显示名（可留空）" />
        <button class="mini-btn rg-m-del" type="button" title="从这条配置里移除">✕</button>
      </div>
      <div class="rg-model-line">
        <label class="rg-mini">上下文窗口<input type="number" class="sm-input rg-m-ctx" value="${num(m.contextWindow) === null ? '' : esc(m.contextWindow)}" placeholder="如 1000000" /></label>
        <label class="rg-mini">输出上限<input type="number" class="sm-input rg-m-max" value="${num(m.maxTokens) === null ? '' : esc(m.maxTokens)}" placeholder="如 131072" /></label>
        <label class="rg-mini">输入模态<input type="text" class="sm-input rg-m-input" value="${esc(Array.isArray(m.input) ? m.input.join(',') : '')}" placeholder="text,image" /></label>
      </div>
      <div class="rg-model-line rg-model-think">
        <label class="rg-mini">思考档位
          <select class="sm-input rg-m-effmode">
            <option value="inherit"${state === 'inherit' ? ' selected' : ''}>跟随内置目录</option>
            <option value="false"${state === 'false' ? ' selected' : ''}>不思考（非思考模型）</option>
            <option value="custom"${state === 'custom' ? ' selected' : ''}>自定义档位</option>
          </select>
        </label>
        <div class="rg-chips"${state === 'custom' ? '' : ' hidden'}>${chips}</div>
      </div>
    </div>`;
  }

  function wireModelRows(listEl, route, d, mode) {
    const getList = () => (mode === 'list' ? getAt(d, ['models']) : getAt(d, ['modelOverrides']));

    const readRow = (rowEl) => {
      const out = {};
      const id = rowEl.querySelector('.rg-m-id').value.trim();
      const name = rowEl.querySelector('.rg-m-name').value.trim();
      const ctx = Number(rowEl.querySelector('.rg-m-ctx').value);
      const max = Number(rowEl.querySelector('.rg-m-max').value);
      const inp = rowEl.querySelector('.rg-m-input').value.split(',').map((s) => s.trim()).filter(Boolean);
      if (name) out.name = name;
      if (Number.isFinite(ctx) && ctx > 0) out.contextWindow = ctx;
      if (Number.isFinite(max) && max > 0) out.maxTokens = max;
      if (inp.length) out.input = inp;

      const modeSel = rowEl.querySelector('.rg-m-effmode');
      if (modeSel.value === 'false') out.reasoningEfforts = false;
      else if (modeSel.value === 'custom') {
        const prev = rowEl.__eff || {};
        const next = {};
        rowEl.querySelectorAll('.rg-chip.on').forEach((c) => {
          const lv = c.dataset.level;
          // 保留已探到的线上拼写；没有就按档位名取第一候选（off → none）
          next[lv] = (lv in prev) ? prev[lv] : ((wireMap[lv] || [lv])[0]);
        });
        if (!Object.keys(next).length) {
          // 引擎明确拒绝空对象，一个档都没选只能理解成"不思考"
          out.reasoningEfforts = false;
        } else if (!Object.keys(next).some((lv) => lv !== 'off')) {
          // 同样被引擎拒绝：只声明 off 等于什么都没声明
          out.reasoningEfforts = false;
        } else {
          out.reasoningEfforts = next;
        }
      }
      // inherit：什么都不写（字段省略 = 跟随内置目录）
      return { id, value: out };
    };

    const commit = () => {
      const collect = (el) => {
        const obj = {};
        el.querySelectorAll('.rg-model').forEach((rowEl) => {
          const { id, value } = readRow(rowEl);
          if (!id) return;
          if (mode === 'list') {
            obj[id] = value;   // 先按 id 归集，重复 id 后写的赢，再由 list 还原顺序
          } else {
            delete value.id;
            obj[id] = value;
          }
        });
        return obj;
      };
      const obj = collect(listEl);
      if (mode === 'list') {
        const order = [...listEl.querySelectorAll('.rg-model')].map((r) => r.querySelector('.rg-m-id').value.trim()).filter(Boolean);
        const seen = new Set();
        const arr = [];
        for (const id of order) {
          if (seen.has(id)) continue;
          seen.add(id);
          arr.push({ id, ...obj[id] });
        }
        setAt(d, ['models'], arr);
      } else {
        setAt(d, ['modelOverrides'], obj);
      }
      syncDirty(listEl.closest('.rg-route'), route, d);
    };

    listEl.querySelectorAll('.rg-model').forEach((rowEl) => {
      const idx = Number(rowEl.dataset.i);
      const src = getList();
      // 已探到的线上拼写要留着：换档位开关时不能把 `off: none` 改写成别的拼写
      const cur = mode === 'list' ? src[idx] : Object.values(src)[idx];
      rowEl.__eff = isPlain(cur && cur.reasoningEfforts) ? cur.reasoningEfforts : {};

      rowEl.querySelectorAll('.rg-m-id, .rg-m-name, .rg-m-ctx, .rg-m-max, .rg-m-input')
        .forEach((i) => i.addEventListener('input', commit));
      // 模型 ID 被清空时草稿里这一条会消失，但 DOM 还留着——失焦时重画一次让两边对上
      rowEl.querySelector('.rg-m-id').addEventListener('blur', (e) => {
        if (!e.target.value.trim()) renderBody(listEl.closest('.rg-route'), route);
      });

      rowEl.querySelector('.rg-m-effmode').addEventListener('change', (e) => {
        const chips = rowEl.querySelector('.rg-chips');
        chips.hidden = e.target.value !== 'custom';
        commit();
      });
      rowEl.querySelectorAll('.rg-chip').forEach((c) => c.addEventListener('click', () => {
        c.classList.toggle('on');
        commit();
      }));
      const del = rowEl.querySelector('.rg-m-del');
      del.addEventListener('click', () => {
        const arr = getList();
        if (mode === 'list') arr.splice(idx, 1);
        else delete arr[cur && cur.id ? cur.id : Object.keys(arr)[idx]];
        commit();
        renderBody(listEl.closest('.rg-route'), route);
      });
    });

    const addInput = listEl.querySelector('.rg-model-add-input');
    const addBtn = listEl.querySelector('.rg-model-add-btn');
    const add = () => {
      const id = (addInput.value || '').trim();
      if (!id) return;
      if (mode === 'list') {
        const arr = getAt(d, ['models']) || [];
        if (!arr.some((m) => m.id === id)) arr.push({ id });
        setAt(d, ['models'], arr);
      } else {
        const obj = getAt(d, ['modelOverrides']) || {};
        if (!(id in obj)) obj[id] = {};
        setAt(d, ['modelOverrides'], obj);
      }
      renderBody(listEl.closest('.rg-route'), route);
    };
    addBtn.addEventListener('click', add);
    addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  }

  // ---------------- 密钥 ----------------
  function wireKey(body, route, ref) {
    const input = body.querySelector('.rg-key-input');
    const btn = body.querySelector('.rg-key-save');
    const msg = body.querySelector('.rg-key-msg');
    const show = (html, kind) => { msg.innerHTML = html; msg.className = 'rg-key-msg' + (kind ? ' ' + kind : ''); };
    btn.addEventListener('click', async () => {
      const key = (input.value || '').trim();
      if (!key) { show('<span class="warn">请先粘贴密钥</span>', 'bad'); return; }
      btn.disabled = true; btn.textContent = '保存中…';
      try {
        const r = await api.setCredential(ref, key);
        if (!r.ok) { show('保存失败：' + esc(r.error || 'unknown'), 'bad'); return; }
        input.value = '';
        show(`已保存到本机凭据库 <code>${esc(ref)}</code>`, 'ok');
        await load();
        notifyChanged();
      } catch (e) {
        show('保存出错：' + esc(e.message || String(e)), 'bad');
      } finally {
        btn.disabled = false; btn.textContent = '保存密钥';
      }
    });
  }

  // ---------------- 保存 / 放弃 / 删除 ----------------
  function syncDirty(card, route, d) {
    if (!card) return;
    const ops = pathOps(['providers', route], userRoutes()[route], d);
    const badge = card.querySelector('.rg-dirty');
    const save = card.querySelector('.rg-save');
    if (badge) badge.hidden = ops.length === 0;
    if (save) save.disabled = ops.length === 0 || !writable;
    const hint = card.querySelector('.rg-save-msg');
    if (hint && ops.length === 0) hint.textContent = '';
  }

  function wireActions(body, card, route, d) {
    body.querySelector('.rg-discard').addEventListener('click', () => {
      drafts.delete(route);
      renderBody(card, route);
    });

    body.querySelector('.rg-save').addEventListener('click', async () => {
      const msg = body.querySelector('.rg-save-msg');
      const declared = isDeclared(route);
      // 手写路由的必要条件：协议 + 地址 + 非空模型清单。
      // 少任何一个引擎都会在挂载这条路由时直接报错，所以先在本地拦下来说人话。
      if (declared) {
        if (!getAt(d, ['baseURL'])) { msg.textContent = '手写声明的路由必须填 API 地址——pi-ai 没有它的内置端点'; return; }
        if (!getAt(d, ['api'])) { msg.textContent = '手写声明的路由必须选一个 API 协议'; return; }
        const ms = getAt(d, ['models']);
        if (!Array.isArray(ms) || ms.length === 0) {
          msg.textContent = '手写声明的路由必须至少列一个模型——pi-ai 没有它的内置目录，空清单会被引擎拒绝（resolves no models）';
          return;
        }
      }
      const dupId = (arr) => {
        const seen = new Set();
        for (const m of arr || []) {
          if (!m.id) return '有模型没填 ID';
          if (seen.has(m.id)) return `模型 "${m.id}" 重复了，同一个模型只能列一次`;
          seen.add(m.id);
        }
        return null;
      };
      if (Array.isArray(getAt(d, ['models']))) {
        const bad = dupId(getAt(d, ['models']));
        if (bad) { msg.textContent = bad; return; }
      }
      const ov = getAt(d, ['modelOverrides']);
      if (isPlain(ov) && Object.keys(ov).length) {
        if (Array.isArray(getAt(d, ['models'])) && getAt(d, ['models']).length) {
          msg.textContent = '「自定义模型清单」和「只修正个别模型」不能同时用——清单已经整份替换了内置目录，改字段请直接改清单里的条目';
          return;
        }
      }

      const ops = pathOps(['providers', route], userRoutes()[route], d);
      if (!ops.length) { msg.textContent = '没有改动'; return; }

      const btn = body.querySelector('.rg-save');
      btn.disabled = true; btn.textContent = '保存中…';
      try {
        const r = await api.mutateSettings(NS, ops, nsView ? nsView.revision : undefined);
        if (!r.ok) {
          const err = String(r.error || 'unknown');
          msg.innerHTML = '保存失败：' + esc(err)
            + (/conflict/i.test(err) ? '<br>配置已被其它面板改动过，点「↻ 重新读取」拿到最新内容再改。' : '');
          return;
        }
        msg.textContent = `已保存 ${ops.length} 处改动 ✓`;
        notifyChanged();
        await load();          // 重新读取会丢掉草稿并刷新基线版本号
      } catch (e) {
        msg.textContent = '保存出错：' + (e.message || String(e));
      } finally {
        btn.disabled = false; btn.textContent = '保存到配置';
        const c = document.querySelector(`.rg-route[data-route="${cssEscape(route)}"]`);
        if (c) syncDirty(c, route, draftOf(route));
      }
    });

    body.querySelector('.rg-remove').addEventListener('click', async () => {
      const msg = body.querySelector('.rg-save-msg');
      const ok = window.__modal
        ? await window.__modal.confirm(
          `确定从配置仓库里删掉 <strong>${esc(route)}</strong> 整条配置？<br>它自己声明的模型会一起消失；如果是内置路由，删掉后回落到 pi-ai 的默认行为。密钥不会一起删。`,
          '删除配置', { okText: '确认删除' })
        : confirm(`确定删掉 ${route} 的整条配置？`);
      if (!ok) return;
      const btn = body.querySelector('.rg-remove');
      btn.disabled = true; btn.textContent = '删除中…';
      try {
        const r = await api.mutateSettings(NS,
          [{ op: 'unset', path: ['providers', route] }],
          nsView ? nsView.revision : undefined);
        if (!r.ok) { msg.textContent = '删除失败：' + (r.error || 'unknown'); return; }
        openRoutes.delete(route);
        drafts.delete(route);
        notifyChanged();
        await load();
      } catch (e) {
        msg.textContent = '删除出错：' + (e.message || String(e));
      } finally {
        btn.disabled = false; btn.textContent = '删除整条配置';
      }
    });

    // 探测：把端点当前的模型清单 + 能力问回来，回填进草稿（不自动保存）
    const probeBtn = body.querySelector('.rg-probe-btn');
    const out = body.querySelector('.mg-discover-output');
    const showOut = (t, kind) => { out.className = 'mg-discover-output' + (kind ? ' ' + kind : ''); out.textContent = t; };
    api.onProbeProgress((line) => { if (probeBtn.disabled) showOut(line); });
    probeBtn.addEventListener('click', async () => {
      const url = getAt(d, ['baseURL']) || getAt(mergedOf(route), ['baseURL']);
      const proto = getAt(d, ['api']) || getAt(mergedOf(route), ['api']);
      if (!/^https?:\/\//.test(String(url || ''))) {
        showOut('这条配置里没有可用的 API 地址，无法探测。手写路由请在「API 地址」里填写端点。', 'bad');
        return;
      }
      const typed = (body.querySelector('.rg-key-input') || {}).value;
      probeBtn.disabled = true; probeBtn.textContent = '刷新中…';
      showOut('正在向端点获取模型清单…');
      try {
        const disc = await api.discoverModels(NS, route, (typed || '').trim() || undefined, proto, url);
        const endpointIds = (disc && disc.ok && Array.isArray(disc.models))
          ? disc.models.map((x) => x && x.id).filter(Boolean) : [];
        const ms = Array.isArray(getAt(d, ['models'])) ? getAt(d, ['models']) : [];
        const mine = ms.map((m) => m.id);
        const fresh = endpointIds.filter((id) => !mine.includes(id));
        showOut(`清单：端点 ${endpointIds.length || '?'} 个，本条配置里 ${mine.length} 个`
          + (fresh.length ? `，新发现 ${fresh.length} 个` : '') + '。开始探测能力…');

        const cap = await api.probeCapabilities({
          baseURL: url, api: proto, apiKey: (typed || '').trim() || undefined, apiKeyEnv: ref,
          models: [...mine, ...fresh],
        });
        if (!cap || !cap.ok) { showOut('能力探测失败：' + ((cap && cap.error) || 'unknown'), 'bad'); return; }
        const byId = new Map((cap.results || []).map((r) => [r.id, r]));

        let updated = 0, dead = 0, unknown = 0;
        const deadIds = [];
        for (const m of ms) {
          const r = byId.get(m.id);
          if (!r) continue;
          if (r.alive === false) { dead++; deadIds.push(m.id); continue; }
          if (r.name) m.name = r.name;
          if (r.contextWindow) m.contextWindow = r.contextWindow;
          if (r.maxTokens) m.maxTokens = r.maxTokens;
          if (r.reasoningEfforts !== undefined) m.reasoningEfforts = r.reasoningEfforts;
          if (r.error) unknown++; else updated++;
        }
        let added = 0;
        if (Array.isArray(getAt(d, ['models']))) {
          for (const id of fresh) {
            const r = byId.get(id);
            if (!r || r.alive !== true) continue;
            ms.push({
              id,
              ...(r.name ? { name: r.name } : {}),
              ...(r.contextWindow ? { contextWindow: r.contextWindow } : {}),
              ...(r.maxTokens ? { maxTokens: r.maxTokens } : {}),
              ...(r.reasoningEfforts !== undefined ? { reasoningEfforts: r.reasoningEfforts } : {}),
            });
            added++;
          }
        }
        const src = cap.catalog ? `厂商目录「${cap.catalog}」` : '现场探测';
        showOut(`能力来源：${src}。已更新 ${updated} 个模型`
          + (added ? `，新增 ${added} 个可用模型` : '')
          + (dead ? `，${dead} 个当前不可用（${deadIds.slice(0, 3).join(' / ')}${deadIds.length > 3 ? ' …' : ''}）` : '')
          + (unknown ? `，${unknown} 个能力无法定论（保留原值）` : '')
          + (cap.hadKey === false ? '。⚠️ 未取到密钥，存活与档位探测不完整，请在上方输入密钥后重试' : '')
          + '。这些改动还在草稿里，点「保存到配置」才写盘。', 'ok');
        renderBody(card, route);
      } catch (e) {
        showOut('刷新出错：' + (e.message || String(e)), 'bad');
      } finally {
        probeBtn.disabled = false; probeBtn.textContent = '↻ 更新模型与能力';
      }
    });
  }

  // ---------------- 导出 / 导入 ----------------
  function exportBackup() {
    const payload = {
      _format: 'dsh-config-registry',
      _version: 1,
      _exportedAt: new Date().toISOString(),
      ns: NS,
      providers: userRoutes(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dsh-config-registry-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('已导出配置仓库备份（<strong>不含密钥明文</strong>，只含引用名）', 'ok');
  }

  /** 导入前先算清楚会改什么，让人看着 diff 决定，而不是一键覆盖。 */
  function diffRoutes(incoming) {
    const cur = userRoutes();
    const added = [], changed = [], removed = [];
    for (const [route, cfg] of Object.entries(incoming)) {
      if (!(route in cur)) { added.push(route); continue; }
      if (JSON.stringify(cur[route]) !== JSON.stringify(cfg)) changed.push(route);
    }
    for (const route of Object.keys(cur)) if (!(route in incoming)) removed.push(route);
    return { added, changed, removed };
  }

  async function importBackup(file) {
    const text = await file.text();
    let payload;
    try { payload = JSON.parse(text); } catch (e) { toast('这个文件不是合法 JSON：' + esc(e.message), 'bad'); return; }
    const incoming = isPlain(payload) && isPlain(payload.providers) ? payload.providers : null;
    if (!incoming) { toast('文件里没有 providers 段，不是本页面导出的备份', 'bad'); return; }

    const { added, changed, removed } = diffRoutes(incoming);
    const line = (label, arr) => arr.length ? `<br>${label}（${arr.length}）：<code>${esc(arr.join(', '))}</code>` : '';
    const body = '将按文件里的内容覆盖配置仓库：'
      + line('新增', added) + line('改动', changed) + line('文件里没有、会被删掉', removed)
      + (!added.length && !changed.length && !removed.length ? '<br>没有差异，内容与当前配置一致。' : '')
      + '<br><br>密钥明文不包含在备份里，各提供商原有的密钥引用会保留；引用名改了的话需要重新填一次密钥。';
    const ok = window.__modal
      ? await window.__modal.confirm(body, '导入配置仓库', { okText: '确认导入' })
      : confirm('确认用文件内容覆盖当前配置仓库？');
    if (!ok) return;

    // 整段替换 `providers`：导出的语义就是"还原成这个文件的样子"，
    // 所以这里用一次 set 而不是逐字段 diff —— 但路径只到 providers，不碰别的域。
    const r = await api.mutateSettings(NS, [{ op: 'set', path: ['providers'], value: incoming }],
      nsView ? nsView.revision : undefined);
    if (!r.ok) { toast('导入失败：' + esc(r.error || 'unknown'), 'bad'); return; }
    toast('导入完成', 'ok');
    notifyChanged();
    await load();
  }

  // ---------------- 杂项 ----------------
  function toast(html, kind) {
    const el = $('.rg-toolbar-msg');
    if (!el) return;
    el.innerHTML = html;
    el.className = 'rg-toolbar-msg' + (kind ? ' ' + kind : '');
    clearTimeout(el.__t);
    el.__t = setTimeout(() => { el.innerHTML = ''; el.className = 'rg-toolbar-msg'; }, 8000);
  }

  /** 告诉其它面板（模型配置模块）配置变了，让它们重新读一遍。 */
  function notifyChanged() {
    // source 用来防回环：本模块每次保存后都已经自己 `await load()` 过了，
    // 下面那个同名监听必须能认出「这是我自己发的」，否则会白白多读一轮。
    window.dispatchEvent(new CustomEvent('dsh:settings-saved', {
      detail: { ns: NS, source: 'registry' },
    }));
  }

  function wireToolbar() {
    const refresh = $('#rgRefreshBtn');
    if (!refresh) return;
    refresh.addEventListener('click', async () => {
      refresh.disabled = true; refresh.textContent = '读取中…';
      try { await load(); } finally { refresh.disabled = false; refresh.textContent = '↻ 重新读取'; }
    });
    $('#rgExportBtn').addEventListener('click', exportBackup);
    const fileInput = $('#rgImportFile');
    $('#rgImportBtn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (f) { try { await importBackup(f); } catch (e) { toast('导入出错：' + esc(e.message || String(e)), 'bad'); } }
    });
    $('#rgOpenFileBtn').addEventListener('click', async () => {
      const r = await api.openSettingsDoc();
      if (!r || !r.ok) toast('打不开配置文件：' + esc((r && r.error) || 'unknown'), 'bad');
    });
    // 模块展开时才真正去读一次，省得每次开设置页都打一轮引擎
    const head = document.querySelector('.settings-module[data-module="registry"] .settings-module-head');
    if (head) head.addEventListener('click', () => {
      const mod = head.closest('.settings-module');
      // bindModules 的手风琴是在同一个 click 上切换 open 的，这里等它跑完再看结果
      setTimeout(() => { if (mod.classList.contains('open') && !loaded) load(); }, 0);
    });
  }

  wireToolbar();

  // 反向：模型配置页（renderer/providers.js）保存后，这边也重读一次 ——
  // 两边改的是同一份 llm-pi-ai 段，不跟着刷的话本页会一直显示旧值。
  // 只在已经读过的情况下跟着刷：没读过就不主动打这一轮引擎请求（与「展开时才读」的策略一致）。
  window.addEventListener('dsh:settings-saved', (e) => {
    const d = e.detail || {};
    if (d.source === 'registry') return;
    if (d.ns && d.ns !== NS) return;
    if (loaded) load();
  });

  window.__registry = {
    refresh: load,
    isLoaded: () => loaded,
  };
})();
