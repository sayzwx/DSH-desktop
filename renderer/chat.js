/**
 * 对话窗口：并发会话 + 模型选择 + 思考等级 + 运行状态可视化
 *
 * - 并发：每个会话独立的流式缓冲（turn/blocks/tool/model），切换会话不丢失进行中的输出；
 *   发送不再被单个会话的运行阻塞（harness queue 模式排队），可在任意会话随时发信号。
 * - 模型：custom 分组下拉（session.models → session.selectModel，带默认思考等级）。
 * - 思考等级：当前模型 reasoning.efforts 的星轨分段选择（session.selectModel + reasoningEffort）。
 * - 可视化：工具栏实时状态（运行中 · 模型 · 正在调用的工具）、会话列表运行点、
 *   其他运行中会话横幅、流式消息的模型徽标与 token 用量。
 */
(function () {
  const api = window.api;
  const $ = (s) => document.querySelector(s);

  const shell = $('#chatShell');
  const placeholder = $('#chatPlaceholder');
  const chatStartBtn = $('#chatStartBtn');
  const sessionsEl = $('#chatSessions');
  const messagesEl = $('#chatMessages');
  const inputEl = $('#chatInput');
  const sendBtn = $('#chatSend');
  const cancelBtn = $('#chatCancel');
  const newBtn = $('#chatNewSession');

  const ctModelBtn = $('#ctModelBtn');
  const ctModelName = $('#ctModelName');
  const ctModelPanel = $('#ctModelPanel');
  const ctEffortRow = $('#ctEffortRow');
  const ctEffortSeg = $('#ctEffortSeg');
  const ctStatusDot = $('#ctStatusDot');
  const ctStatusText = $('#ctStatusText');
  const ctOther = $('#ctOtherRunning');

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let running = false;
  let currentSessionId = null;
  let lastSessionId = null; // 断线重连时恢复上次会话，避免被自动切走
  let sessions = [];
  let workspaces = [];           // workspace.list items
  let currentWorkspaceId = null; // null = 全部
  let archivedSessionIds = new Set();
  let modelState = null;     // 当前会话的 session.models
  let streamMsg = null;      // 当前会话正在流的消息 DOM
  let domBlocks = new Map(); // 当前会话 DOM 块 (index -> element)
  let pendingUserEl = null;
  // 发送模式：queue = 排队跟进，steer = 插话/转向（与 Web UI 的 ui-conversation.busyEnter 语义一致）
  const SEND_MODE_KEY = 'dsh-send-mode';
  let sendMode = 'queue';
  try { const s = localStorage.getItem(SEND_MODE_KEY); if (s === 'steer' || s === 'queue') sendMode = s; } catch { /* ignore */ }

  // ---------- 并发缓冲：每个会话独立 ----------
  const bufs = new Map();
  function buf(sid) {
    if (!bufs.has(sid)) bufs.set(sid, { turn: false, blocks: new Map(), tool: null, model: null });
    return bufs.get(sid);
  }

  const EFFORT_CN = { off: '关闭', minimal: '极简', low: '浅思', medium: '常规', high: '深度', max: '极限' };
  const effortCn = (id) => EFFORT_CN[id] || id;

  // ---------------- 工作区 ----------------
  async function loadWorkspaces() {
    const r = await api.chatWorkspaces();
    if (!r.ok) return;
    workspaces = r.items || [];
    archivedSessionIds = new Set(r.archivedSessionIds || []);
    if (currentWorkspaceId && !workspaces.some((w) => w.workspaceId === currentWorkspaceId)) {
      currentWorkspaceId = null;
    }
    renderWorkspaceControl();
    renderSessions();
  }

  function workspaceOf(sessionId) {
    return workspaces.find((w) => (w.sessionIds || []).includes(sessionId)) || null;
  }

  function visibleSessions() {
    return sessions.filter((s) => {
      if (archivedSessionIds.has(s.sessionId)) return false;
      if (currentWorkspaceId) {
        const w = workspaces.find((x) => x.workspaceId === currentWorkspaceId);
        return w ? (w.sessionIds || []).includes(s.sessionId) : false;
      }
      return true;
    });
  }

  // ---- 工作区菜单（筛选视图 / 从电脑添加）----
  const ctWsBtn = $('#ctWsBtn');
  const ctWsName = $('#ctWsName');
  const ctWsPanel = $('#ctWsPanel');
  // 菜单面板挂到 body：工具栏和会话面板都是 overflow:hidden 容器，挂里面会被裁切
  document.body.appendChild(ctWsPanel);

  function currentWorkspace() {
    return workspaces.find((w) => w.workspaceId === currentWorkspaceId) || null;
  }

  function renderWorkspaceControl() {
    const w = currentWorkspace();
    ctWsName.textContent = w ? (w.title || w.path || '未命名工作区') : '全部';
  }

  function closeWorkspaceMenu() {
    ctWsPanel.hidden = true;
    ctWsPanel.innerHTML = '';
  }

  // 工具栏工作区菜单：切换筛选视图 / 从电脑添加工作区
  // （新会话不再从这里选归属 —— 「＋ 新会话」一键开聊，详见 newSession）
  function openWorkspaceMenu(anchor) {
    const rows = [];
    if (currentWorkspaceId) {
      rows.push(`<button type="button" class="ct-wi" data-id="">全部工作区</button>`);
    }
    for (const w of workspaces) {
      const active = w.workspaceId === currentWorkspaceId;
      rows.push(`<button type="button" class="ct-wi${active ? ' active' : ''}" data-id="${esc(w.workspaceId)}">
        <span class="ct-wi-name">${esc(w.title || w.path || '未命名工作区')}</span>
        <span class="ct-wi-path">${esc(w.path || '')}</span>
      </button>`);
    }
    if (workspaces.length > 0) rows.push('<div class="ct-wi-sep"></div>');
    rows.push('<button type="button" class="ct-wi ct-wi-add" data-id="__add__">添加工作区…</button>');
    ctWsPanel.innerHTML = rows.join('');
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(400, Math.max(260, window.innerWidth - rect.left - 16));
    ctWsPanel.style.width = `${width}px`;
    ctWsPanel.style.top = `${rect.bottom + 6}px`;
    ctWsPanel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
    ctWsPanel.hidden = false;
    ctWsPanel.querySelectorAll('.ct-wi').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        closeWorkspaceMenu();
        if (id === '__add__') {
          pickWorkspaceFolder();
          return;
        }
        // 筛选视图：null = 全部（显示所有工作区与未分组的历史会话）
        currentWorkspaceId = id || null;
        renderWorkspaceControl();
        renderSessions();
        renderOtherRunning();
      };
    });
  }

  ctWsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (ctWsPanel.hidden) openWorkspaceMenu(ctWsBtn);
    else closeWorkspaceMenu();
  });
  document.addEventListener('mousedown', (e) => {
    if (!ctWsPanel.hidden && !e.target.closest('#ctWs') && !ctWsPanel.contains(e.target)) closeWorkspaceMenu();
  });

  // ---------------- 会话列表 ----------------
  const turnSeed = new Set(); // 每个会话首次从 session.list 同步一次运行状态（重启后恢复"运行中"）

  async function refreshSessions() {
    if (!running) return;
    const r = await api.chatList();
    if (!r.ok) return;
    sessions = r.items || [];
    // 重连/启动后事件流没有运行态基线：用 session.list 的 running 标记补种一次
    for (const s of sessions) {
      if (!turnSeed.has(s.sessionId)) {
        turnSeed.add(s.sessionId);
        const b = buf(s.sessionId);
        b.turn = !!s.running;
        if (s.sessionId === currentSessionId) setTurnUI(b.turn);
      }
    }
    if (!currentSessionId && sessions.length > 0) {
      const restore = lastSessionId && sessions.some((s) => s.sessionId === lastSessionId)
        ? lastSessionId
        : sessions[0].sessionId;
      await openSession(restore);
    }
    renderSessions();
    renderOtherRunning();
  }

  // ---- 会话列表：按工作区分组（同 webui 左侧栏）----
  const WS_COLLAPSE_KEY = 'dsh-ws-group-collapsed';

  function groupCollapsed(key) {
    try {
      return (JSON.parse(localStorage.getItem(WS_COLLAPSE_KEY) || '{}'))[key] === true;
    } catch { return false; }
  }
  function setGroupCollapsed(key, on) {
    let map = {};
    try { map = JSON.parse(localStorage.getItem(WS_COLLAPSE_KEY) || '{}') || {}; } catch { /* 损坏的折叠状态按空处理 */ }
    map[key] = on;
    localStorage.setItem(WS_COLLAPSE_KEY, JSON.stringify(map));
  }

  function sessionRowHTML(s) {
    return `<div class="chat-session ${s.sessionId === currentSessionId ? 'active' : ''}" data-id="${esc(s.sessionId)}">
      ${s.blank ? '<span class="cs-blank" title="空白新会话">新</span>' : ''}
      <span class="cs-title">${esc(s.title)}</span>
      ${s.running ? '<span class="cs-dot" title="运行中"></span>' : ''}
      <span class="cs-del" title="删除该历史会话">✕</span>
    </div>`;
  }

  function groupSectionHTML(key, title, pathTitle, sessionList, showAdd) {
    const collapsed = groupCollapsed(key);
    const rows = sessionList.map(sessionRowHTML).join('');
    return `<div class="ws-group" data-key="${esc(key)}">
      <div class="ws-group-head">
        <button type="button" class="ws-group-toggle" title="折叠 / 展开">${collapsed ? '▸' : '▾'}</button>
        <span class="ws-group-icon">📁</span>
        <span class="ws-group-title" title="${esc(pathTitle || title)}">${esc(title)}</span>
        <span class="ws-group-count">${sessionList.length}</span>
        ${showAdd ? '<button type="button" class="ws-group-add" title="在此工作区新建会话">＋</button>' : ''}
      </div>
      ${collapsed ? '' : `<div class="ws-group-body">${rows || '<div class="ws-group-empty">暂无会话</div>'}</div>`}
    </div>`;
  }

  function renderSessions() {
    const list = visibleSessions();
    const parts = [];
    if (currentWorkspaceId) {
      const w = workspaces.find((x) => x.workspaceId === currentWorkspaceId);
      if (w) {
        parts.push(groupSectionHTML(w.workspaceId, w.title || w.path || '未命名工作区', w.path, list, false));
      }
    } else {
      for (const w of workspaces) {
        const wsSessions = list.filter((s) => (w.sessionIds || []).includes(s.sessionId));
        parts.push(groupSectionHTML(w.workspaceId, w.title || w.path || '未命名工作区', w.path, wsSessions, true));
      }
      const ungrouped = list.filter((s) => !workspaceOf(s.sessionId));
      if (ungrouped.length > 0) {
        parts.push(groupSectionHTML('__ungrouped__', '未分组', '', ungrouped, false));
      }
    }
    if (parts.length === 0) {
      sessionsEl.innerHTML = '<div class="chat-empty" style="padding:20px 8px">暂无会话<br />点击「＋ 新会话」开始</div>';
      return;
    }
    sessionsEl.innerHTML = parts.join('');
    sessionsEl.querySelectorAll('.chat-session').forEach((el) => {
      el.onclick = () => openSession(el.dataset.id);
    });
    sessionsEl.querySelectorAll('.cs-del').forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        deleteSession(el.closest('.chat-session').dataset.id);
      };
    });
    sessionsEl.querySelectorAll('.ws-group-toggle').forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        const key = el.closest('.ws-group').dataset.key;
        setGroupCollapsed(key, !groupCollapsed(key));
        renderSessions();
      };
    });
    sessionsEl.querySelectorAll('.ws-group-add').forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        const key = el.closest('.ws-group').dataset.key;
        createSessionInWorkspace(key === '__ungrouped__' ? null : key);
      };
    });
  }

  function renderOtherRunning() {
    const n = sessions.filter((s) => s.running && s.sessionId !== currentSessionId).length;
    if (n === 0) { ctOther.hidden = true; return; }
    ctOther.hidden = false;
    ctOther.textContent = `⚡ 另有 ${n} 个会话运行中 →`;
    ctOther.onclick = () => {
      const other = sessions.find((s) => s.running && s.sessionId !== currentSessionId);
      if (other) openSession(other.sessionId);
    };
  }

  // ---------------- 模型选择 / 思考等级 ----------------
  function findModel(provider, model) {
    const grp = (modelState?.groups || []).find((g) => g.id === provider);
    return grp?.models.find((m) => m.id === model);
  }
  function currentEffort() {
    const cur = modelState?.current;
    if (!cur) return undefined;
    const m = findModel(cur.provider, cur.model);
    return cur.reasoningEffort ?? m?.reasoning?.defaultEffort;
  }
  function modelLabel() {
    const cur = modelState?.current;
    if (!cur) return '模型…';
    const m = findModel(cur.provider, cur.model);
    return m?.name || cur.model;
  }

  function renderModelPicker() {
    ctModelName.textContent = modelLabel();
    if (!modelState) {
      ctModelPanel.innerHTML = '<div class="ct-model-empty">未连接 harness</div>';
      return;
    }
    const cur = modelState.current;
    ctModelPanel.innerHTML = (modelState.groups || [])
      .map(
        (g) => `<div class="ct-mg">
          <div class="ct-mg-head">${esc(g.name || g.id)}</div>
          ${g.models
            .map((m) => {
              const active = cur && m.id === cur.model && g.id === cur.provider ? ' active' : '';
              const hint = m.reasoning?.efforts?.length ? `<span class="ct-mg-hint">${m.reasoning.efforts.map((e) => effortCn(e.id)).join('·')}</span>` : '';
              return `<button type="button" class="ct-mi${active}" data-provider="${esc(g.id)}" data-model="${esc(m.id)}">
                <span class="ct-mi-name">${esc(m.name || m.id)}</span>
                <span class="ct-mi-id">${esc(m.id)}</span>${hint}
              </button>`;
            })
            .join('')}
        </div>`
      )
      .join('');
    ctModelPanel.querySelectorAll('.ct-mi').forEach((btn) => {
      btn.onclick = () => chooseModel(btn.dataset.provider, btn.dataset.model);
    });
  }

  function renderEffort() {
    const cur = modelState?.current;
    const m = cur ? findModel(cur.provider, cur.model) : null;
    const efforts = m?.reasoning?.efforts || [];
    if (!cur || efforts.length === 0) {
      ctEffortRow.hidden = true;
      return;
    }
    ctEffortRow.hidden = false;
    const eff = currentEffort();
    ctEffortSeg.innerHTML = efforts
      .map((e) => `<button type="button" class="ct-eff${e.id === eff ? ' active' : ''}" data-eff="${esc(e.id)}" title="${esc(e.description || '')}">${esc(effortCn(e.id))}</button>`)
      .join('');
    ctEffortSeg.querySelectorAll('.ct-eff').forEach((btn) => {
      btn.onclick = () => chooseEffort(btn.dataset.eff);
    });
  }

  // 发送模式（插话/排队）渲染与切换；偏好持久化到 localStorage，且尽量与 Web UI 的 busyEnter 同步
  function renderSendMode() {
    const seg = $('#ctModeSeg');
    if (!seg) return;
    seg.querySelectorAll('.ct-mode-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === sendMode);
    });
  }

  function applySendMode(mode, persist) {
    if (mode !== 'queue' && mode !== 'steer') return;
    sendMode = mode;
    if (persist !== false) {
      try { localStorage.setItem(SEND_MODE_KEY, mode); } catch { /* ignore */ }
      // 与 Web UI 同槽位：写 ui-conversation.busyEnter（尽力而为，失败不阻塞）
      api.mutateSettings('ui-conversation', [{ op: 'set', path: ['busyEnter'], value: mode }], undefined).catch(() => {});
    }
    renderSendMode();
  }

  // 若已连接且 Web 端配过 busyEnter，则采纳它作为默认（本机偏好优先）
  async function syncSendModeFromWeb() {
    try {
      const d = await api.getSettingsDescribe();
      if (d.ok) {
        const ns = (d.namespaces || []).find((n) => n.ns === 'ui-conversation');
        const webVal = ns && ns.value && ns.value.busyEnter;
        if ((webVal === 'queue' || webVal === 'steer') && !localStorage.getItem(SEND_MODE_KEY)) {
          sendMode = webVal;
          renderSendMode();
        }
      }
    } catch { /* ignore */ }
  }

  function renderStatus() {
    const b = buf(currentSessionId);
    const label = modelLabel();
    if (!currentSessionId) {
      ctStatusDot.className = 'ct-status-dot idle';
      ctStatusText.textContent = '空闲';
      return;
    }
    if (b.turn) {
      ctStatusDot.className = 'ct-status-dot running';
      ctStatusText.textContent = `运行中 · ${label}${b.tool ? ` · ${b.tool}` : ''}`;
    } else {
      ctStatusDot.className = 'ct-status-dot idle';
      const eff = currentEffort();
      ctStatusText.textContent = `待命 · ${label}${eff ? ` · ${effortCn(eff)}` : ''}`;
    }
  }

  async function loadModels(sid) {
    const r = await api.chatModels(sid);
    modelState = r.ok ? r.value : null;
    renderModelPicker();
    renderEffort();
    renderStatus();
    renderUsage(); // 花费按当前模型单价估算，模型切换后刷新
  }

  async function chooseModel(provider, model) {
    if (!currentSessionId) return;
    const m = findModel(provider, model);
    const effort = m?.reasoning?.defaultEffort;
    ctModelPanel.hidden = true;
    const r = await api.chatSelectModel(currentSessionId, provider, model, effort);
    if (r.ok) {
      modelState.current = r.value.selected;
      renderModelPicker();
      renderEffort();
      renderStatus();
      const b = buf(currentSessionId);
      b.model = model;
      keepInputFocus();
    } else {
      showChatError(`模型切换失败：${r.error}`);
    }
  }

  async function chooseEffort(eff) {
    const cur = modelState?.current;
    if (!cur || !currentSessionId) return;
    const r = await api.chatSelectModel(currentSessionId, cur.provider, cur.model, eff);
    if (r.ok) {
      modelState.current = r.value.selected;
      renderEffort();
      renderStatus();
      keepInputFocus();
    } else {
      showChatError(`思考等级切换失败：${r.error}`);
    }
  }

  // ---------------- 权限预设（与 Web UI 同一机制：/permission 命令 + permissions 投影） ----------------
  const PERM_LABEL_CN = {
    'read-only': '只读',
    'workspace-write': '工作区写',
    'danger-full-access': '全权限',
    custom: '自定义',
  };
  const permLabel = (id) => PERM_LABEL_CN[id] || id;
  const ctPermRow = $('#ctPermRow');
  const ctPermSeg = $('#ctPermSeg');
  let permState = null; // { options: [{value,name}], currentValue } from permissions projection

  function renderPermControl() {
    if (!currentSessionId || !permState || !permState.options || permState.options.length === 0) {
      ctPermRow.hidden = true;
      return;
    }
    ctPermRow.hidden = false;
    ctPermSeg.innerHTML = permState.options
      .map(
        (o) => `<button type="button" class="ct-perm${o.value === permState.currentValue ? ' active' : ''}" data-perm="${esc(o.value)}"
          title="${esc(o.name || o.value)}">${esc(permLabel(o.value))}</button>`
      )
      .join('');
    ctPermSeg.querySelectorAll('.ct-perm').forEach((btn) => {
      btn.onclick = () => switchPermission(btn.dataset.perm);
    });
  }

  async function switchPermission(preset) {
    if (!currentSessionId || !permState || preset === permState.currentValue) return;
    // 全权限 = 无审批的全文件访问：与 Web UI 一致，需要显式风险确认
    if (preset === 'danger-full-access') {
      const ok = await themedConfirm(
        `切换到「全权限」将关闭文件操作的审批提示（sandbox: danger-full-access + approval: never）。\n确认切换当前会话的权限预设？`,
        '权限风险确认'
      );
      if (!ok) return;
    }
    const r = await api.chatPermissionSet(currentSessionId, preset);
    if (!r.ok) {
      showChatError(`权限切换失败：${r.error}`);
      return;
    }
    // 乐观更新；harness 会推送 permissions 投影做权威确认
    permState.currentValue = preset;
    renderPermControl();
    keepInputFocus();
  }

  // ---------------- 上下文用量 / 估算花费（底部条） ----------------
  const chatUsageBar = $('#chatUsageBar');
  const cuContext = $('#cuContext');
  const cuFill = $('#cuFill');
  const cuCost = $('#cuCost');
  let usageState = null; // { contextWindow?, projectedTokens?, tokenUsage? }

  /** 估算单价表（USD / 1M tokens）：各厂商公开定价的近似值，仅供界面参考。 */
  const COST_TABLE = [
    { match: /^deepseek-v4-pro/, in: 0.56, out: 2.19, read: 0.14, write: 2.19 },
    { match: /^deepseek-v4-flash/, in: 0.28, out: 1.1, read: 0.07, write: 1.1 },
    { match: /^deepseek-/, in: 0.28, out: 1.1, read: 0.07, write: 1.1 },
    { match: null, in: 2, out: 8, read: 0.5, write: 8 }, // 未知模型按均价粗估
  ];
  const costOf = (modelId) => COST_TABLE.find((row) => row.match === null || row.match.test(modelId || '')) || COST_TABLE[COST_TABLE.length - 1];

  function estimateCost() {
    const tu = usageState?.tokenUsage;
    if (!tu) return null;
    const totals = (tu.uncachedInputTokens || 0) + (tu.cacheReadTokens || 0) + (tu.cacheWriteTokens || 0) + (tu.outputTokens || 0);
    if (totals === 0) return null;
    const rate = costOf(modelState?.current?.model);
    const usd =
      (tu.uncachedInputTokens || 0) * rate.in
      + (tu.cacheReadTokens || 0) * rate.read
      + (tu.cacheWriteTokens || 0) * rate.write
      + (tu.outputTokens || 0) * rate.out;
    return usd / 1e6;
  }

  const fmtTokens = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));

  function renderUsage() {
    if (!currentSessionId || !usageState) {
      chatUsageBar.hidden = true;
      return;
    }
    chatUsageBar.hidden = false;
    const { contextWindow, projectedTokens } = usageState;
    const tu = usageState.tokenUsage || {};
    const fallback = (tu.uncachedInputTokens || 0) + (tu.cacheReadTokens || 0) + (tu.cacheWriteTokens || 0) + (tu.outputTokens || 0);
    const used = projectedTokens != null ? projectedTokens : fallback;
    if (contextWindow != null && contextWindow > 0) {
      const pct = Math.min(100, (used / contextWindow) * 100);
      cuContext.textContent = `${fmtTokens(used)} / ${fmtTokens(contextWindow)} tokens · ${pct.toFixed(1)}%`;
      cuFill.style.width = `${pct.toFixed(1)}%`;
      cuContext.title = `已用上下文 ${fmtTokens(used)} / 模型最大上下文 ${fmtTokens(contextWindow)}（${pct.toFixed(1)}%）`;
      cuFill.parentElement.classList.toggle('cu-hot', pct >= 80);
    } else if (used > 0) {
      cuContext.textContent = `${fmtTokens(used)} tokens（最大上下文未知）`;
      cuFill.style.width = '0%';
      cuContext.title = '本会话已用 tokens（模型最大上下文暂不可知）';
    } else {
      cuContext.textContent = '上下文 —';
      cuFill.style.width = '0%';
      cuContext.title = '尚无模型请求';
    }
    const usd = estimateCost();
    const modelName = modelState?.current?.model || '';
    cuCost.textContent = usd == null
      ? '花费 —'
      : `≈ $${usd >= 0.01 ? usd.toFixed(2) : usd.toFixed(4)}`;
    cuCost.title = usd == null
      ? '尚无用量，暂无花费估算'
      : `按 ${modelName || '当前模型'} 单价估算的本会话累计花费（仅参考，非账单）`;
  }

  function applyProjections(values) {
    if (!values) return;
    if (values.permissions) {
      permState = { options: values.permissions.options || [], currentValue: values.permissions.currentValue };
      renderPermControl();
    }
    if (values.contextPressure || values.tokenUsage || values.sessionStats) {
      const prev = usageState || {};
      const merged = { ...prev };
      if (values.contextPressure) Object.assign(merged, values.contextPressure);
      if (values.tokenUsage) merged.tokenUsage = values.tokenUsage;
      usageState = merged;
      renderUsage();
    }
  }

  // 模型面板开合
  ctModelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    ctModelPanel.hidden = !ctModelPanel.hidden;
    if (!ctModelPanel.hidden && modelState) renderModelPicker();
  });
  document.addEventListener('mousedown', (e) => {
    if (!ctModelPanel.hidden && !e.target.closest('#ctModel')) ctModelPanel.hidden = true;
  });

  // ---------------- 消息渲染（带身份去重） ----------------
  // 每个会话维护"已渲染消息身份"集合：user/message 与 assistant/message 携带 id/seq，
  // 同一身份的事件只渲染一次（重连/重复投递时复用已有元素，而不是追加第二个框）。
  // renderHistory 整段重绘时会清空对应会话的集合。
  const renderedIds = new Map(); // sessionId -> Set<string>  （仅当前活动的会话使用；切换会话时重建）

  function renderedIdFor(sid) {
    if (!renderedIds.has(sid)) renderedIds.set(sid, new Set());
    return renderedIds.get(sid);
  }

  // 推导消息身份键：优先显式 id，否则用 provider+seq/时间戳兜底；没有可取身份时返回 null（不做去重）
  function msgIdentity(ev) {
    if (!ev || !ev.data) return null;
    const id = ev.data.id || ev.data.messageId || ev.data.seq;
    if (typeof id !== 'undefined' && id !== null) return String(id);
    if (ev.data.provenance?.seq !== undefined) return `p-${ev.data.provenance.seq}`;
    return null;
  }

  function emptyState() {
    messagesEl.innerHTML = `<div class="chat-empty">
      <div class="big">✉</div>
      信号通道已就绪<br />向深空发送第一条消息，智能体将立即响应
    </div>`;
  }

  function makeUserMsg(text) {
    const div = document.createElement('div');
    div.className = 'msg msg-user';
    div.textContent = text;
    messagesEl.appendChild(div);
    return div;
  }

  function makeAssistantMsg() {
    const div = document.createElement('div');
    div.className = 'msg msg-assistant pending';
    messagesEl.appendChild(div);
    return div;
  }

  function makeToolChip(name, text) {
    const div = document.createElement('div');
    div.className = 'msg-tool';
    const t = text ? ` · ${text.slice(0, 240)}` : '';
    div.textContent = `🔧 ${name}${t}`;
    messagesEl.appendChild(div);
  }

  function showChatError(message) {
    const div = document.createElement('div');
    div.className = 'msg msg-assistant';
    div.style.borderColor = 'rgba(255,107,53,0.45)';
    div.style.background = 'rgba(255,107,53,0.08)';
    div.textContent = `⚠ ${message}`;
    messagesEl.appendChild(div);
    scrollBottom(false);
  }

  function makeTyping() {
    const div = document.createElement('div');
    div.className = 'typing';
    div.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(div);
    return div;
  }

  function removeTyping() {
    messagesEl.querySelectorAll('.typing').forEach((el) => el.remove());
  }

  function renderAssistantContent(container, content, meta) {
    container.innerHTML = '';
    for (const block of content || []) {
      if (block.type === 'reasoning' && block.text) {
        const d = document.createElement('details');
        d.className = 'msg-reasoning';
        d.innerHTML = `<summary>🧠 思考过程</summary><div></div>`;
        d.querySelector('div').textContent = block.text;
        container.appendChild(d);
      } else if (block.type === 'text' && block.text) {
        const p = document.createElement('div');
        p.textContent = block.text;
        container.appendChild(p);
      }
    }
    if (meta) {
      const m = document.createElement('div');
      m.className = 'msg-meta';
      m.textContent = meta;
      container.appendChild(m);
    }
  }

  function scrollBottom(force) {
    if (force || messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 160) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  // 对话页在启动时是 display:none（默认停在仪表盘），此时设置 scrollTop 无效；
  // 页面变为可见（切到「对话」）时强制滚动到最新内容。
  const pageChat = document.getElementById('page-chat');
  let chatPageShown = pageChat && pageChat.classList.contains('active');
  if (pageChat) {
    new MutationObserver(() => {
      const shown = pageChat.classList.contains('active');
      if (shown && !chatPageShown) scrollBottom(true);
      chatPageShown = shown;
    }).observe(pageChat, { attributes: true, attributeFilter: ['class'] });
  }

  function setTurnUI(on) {
    const b = buf(currentSessionId);
    cancelBtn.disabled = !(on && currentSessionId);
    sendBtn.disabled = !currentSessionId;
    if (on) {
      removeTyping();
      messagesEl.appendChild(makeTyping());
      scrollBottom(true);
    } else {
      removeTyping();
    }
    renderStatus();
  }

  // ---------------- 历史加载 ----------------
  // 历史可能携带大量 assistant/chunk 事件（尾部常是几十上百个 chunk），
  // 只从尾部反向收集"界面事件"（用户消息 / 完成的消息 / 工具调用），最多 80 条。
  function renderHistory(events) {
    messagesEl.innerHTML = '';
    renderedIds.set(currentSessionId, new Set()); // 整段重绘：重置该会话的去重集合
    const surface = [];
    for (let i = (events || []).length - 1; i >= 0 && surface.length < 80; i--) {
      const ev = events[i]?.event;
      if (!ev) continue;
      if (ev.type === 'user/message') {
        if (ev.data?.source?.kind !== 'user') continue;
        surface.push(ev);
      } else if (ev.type === 'assistant/message') {
        if ((ev.data?.content || []).length === 0) continue; // 空消息不渲染
        surface.push(ev);
      } else if (ev.type === 'tool/call' || ev.type === 'tool/result') {
        surface.push(ev);
      }
    }
    for (const ev of surface.reverse()) {
      if (ev.type === 'user/message') {
        renderUserMessage(ev);
      } else if (ev.type === 'assistant/message') {
        const div = makeAssistantMsg();
        div.classList.remove('pending');
        const model = ev.data?.provenance?.model || '';
        const usage = ev.data?.usage ? ` · ${ev.data.usage.inputTokens}↑ ${ev.data.usage.outputTokens}↓ tokens` : '';
        renderAssistantContent(div, ev.data?.content, model ? `${model}${usage}` : '');
      } else if (ev.type === 'tool/call') {
        makeToolChip(ev.data?.name || 'tool', '调用中…');
      } else if (ev.type === 'tool/result') {
        const text = (ev.data?.content || []).map((b) => b.text).join('\n').slice(0, 200);
        makeToolChip(ev.data?.name || 'tool', text);
      }
    }
    if (!messagesEl.children.length) emptyState();
    scrollBottom(true);
  }

  // 图片块渲染：优先用内嵌 data，否则按 attachmentId 从 harness 取
  function renderImageBlock(container, block, sid) {
    if (!block || block.type !== 'image') return;
    const img = document.createElement('img');
    img.className = 'msg-img';
    img.alt = block.name || '图片';
    if (block.data) {
      img.src = `data:${block.mediaType};base64,${block.data}`;
      img.onload = () => scrollBottom(false);
      container.appendChild(img);
    } else if (block.attachment?.attachmentId) {
      api.chatAttachment(sid, block.attachment.attachmentId).then((r) => {
        if (r.ok) {
          img.src = `data:${r.attachment?.mediaType || block.mediaType || 'image/png'};base64,${r.data}`;
          img.onload = () => scrollBottom(false);
          container.appendChild(img);
        }
      }).catch(() => {});
    }
  }

  function renderUserMessage(ev, pendingEl) {
    const blocks = ev.data?.content || [];
    const el = pendingEl || makeUserMsg('');
    el.innerHTML = '';
    const text = blocks
      .filter((b) => b.type === 'text' && typeof b.text === 'string' && !/^\[附件\] /.test(b.text))
      .map((b) => b.text).join('\n');
    if (text) {
      const p = document.createElement('div');
      p.textContent = text;
      el.appendChild(p);
    }
    for (const b of blocks) {
      if (b.type === 'image') {
        renderImageBlock(el, b, currentSessionId);
      } else if (b.type === 'text' && typeof b.text === 'string' && /^\[附件\] /.test(b.text)) {
        const m = /^\[附件\] ([^（]+)（(\d+) 字节）已保存到 (.+)$/.exec(b.text);
        if (m) {
          el.appendChild(makeFileChipEl({ name: m[1], size: Number(m[2]), path: m[3] }));
        } else {
          const sp = document.createElement('div');
          sp.textContent = b.text;
          el.appendChild(sp);
        }
      }
    }
    return el;
  }

  function renderAssistantContent(container, content, meta) {
    container.innerHTML = '';
    for (const block of content || []) {
      if (block.type === 'reasoning' && block.text) {
        const d = document.createElement('details');
        d.className = 'msg-reasoning';
        d.innerHTML = `<summary>🧠 思考过程</summary><div></div>`;
        d.querySelector('div').textContent = block.text;
        container.appendChild(d);
      } else if (block.type === 'text' && block.text) {
        const p = document.createElement('div');
        p.textContent = block.text;
        container.appendChild(p);
      } else if (block.type === 'image') {
        renderImageBlock(container, block);
      }
    }
    if (meta) {
      const m = document.createElement('div');
      m.className = 'msg-meta';
      m.textContent = meta;
      container.appendChild(m);
    }
  }

  // 从缓冲重建进行中的流（切换会话回来时）
  function renderLiveBuffer(sid) {
    const b = buf(sid);
    if (b.blocks.size === 0 && !b.turn) return;
    if (b.blocks.size > 0) {
      streamMsg = makeAssistantMsg();
      streamMsg.classList.remove('pending');
      domBlocks = new Map();
      const idxs = [...b.blocks.keys()].sort((a, c) => a - c);
      for (const i of idxs) {
        const blk = b.blocks.get(i);
        if (blk.kind === 'reasoning') {
          const d = document.createElement('details');
          d.className = 'msg-reasoning';
          d.innerHTML = '<summary>🧠 思考过程</summary><div></div>';
          const txt = d.querySelector('div');
          txt.textContent = blk.text;
          txt.__dshLen = (blk.text || '').length;
          streamMsg.appendChild(d);
          domBlocks.set(i, txt);
        } else {
          const el = document.createElement('div');
          el.textContent = blk.text;
          el.__dshLen = (blk.text || '').length;
          streamMsg.appendChild(el);
          domBlocks.set(i, el);
        }
      }
      const meta = b.model ? document.createElement('div') : null;
      if (meta) {
        meta.className = 'msg-meta';
        meta.textContent = b.model;
        streamMsg.appendChild(meta);
      }
    }
    if (b.turn) {
      removeTyping();
      messagesEl.appendChild(makeTyping());
    }
    scrollBottom(true);
  }

  async function openSession(sessionId) {
    if (!sessionId) return;
    currentSessionId = sessionId;
    lastSessionId = sessionId;
    streamMsg = null;
    domBlocks = new Map();
    pendingUserEl = null;
    // 会话级状态在切换时重置，由本次历史投影重新填充
    permState = null;
    usageState = null;
    renderSessions();
    const b = buf(sessionId);
    const r = await api.chatHistory(sessionId);
    if (r.ok) {
      renderHistory(r.events);
      renderLiveBuffer(sessionId);
      applyProjections(r.projections?.values);
    } else {
      emptyState();
    }
    setTurnUI(b.turn);
    loadModels(sessionId);
  }

  // ---------------- 发送（并发：queue 模式，不阻塞；支持图片 + 文件） ----------------
  const draftImages = []; // {mediaType, data, name, thumb}
  const draftFiles = [];  // {path, name, size}
  const draftsEl = $('#chatDrafts');

  async function normalizeImage(file) {
    const SUPPORTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (!SUPPORTED.includes(file.type)) return { error: '仅支持 PNG / JPG / WebP / GIF 图片' };
    const MAX_BYTES = 5 * 1024 * 1024;
    const MAX_PX = 40_000_000;
    const dataUrl = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsDataURL(file);
    });
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = dataUrl;
    });
    const px = img.naturalWidth * img.naturalHeight;
    let out = dataUrl;
    let mediaType = file.type;
    if (file.size > MAX_BYTES || px > MAX_PX) {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, Math.sqrt(MAX_PX / px), 4096 / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      mediaType = file.type === 'image/gif' ? 'image/png' : file.type;
      out = canvas.toDataURL(mediaType === 'image/png' ? 'image/png' : 'image/jpeg', 0.85);
      if (out.length > MAX_BYTES * 1.4) out = canvas.toDataURL('image/jpeg', 0.7);
    }
    return { mediaType, data: out.split(',')[1], name: file.name || 'pasted-image', thumb: out };
  }

  function fileIcon(name) {
    const ext = (String(name || '').split('.').pop() || '').toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return '🖼️';
    if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) return '🎬';
    if (['mp3', 'wav'].includes(ext)) return '🎵';
    if (['pdf'].includes(ext)) return '📕';
    if (['doc', 'docx'].includes(ext)) return '📘';
    if (['ppt', 'pptx'].includes(ext)) return '📙';
    if (['xls', 'xlsx', 'csv'].includes(ext)) return '📗';
    if (['zip', 'rar', '7z'].includes(ext)) return '🗜️';
    return '📄';
  }

  function fmtSize(n) {
    if (!n) return '';
    if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
    if (n >= 1024) return `${Math.round(n / 1024)} KB`;
    return `${n} B`;
  }

  function draftFileChipHTML(d) {
    return `<div class="draft-file" data-file="${d.__i}">
        <span class="df-ic">${fileIcon(d.name)}</span>
        <span class="df-name" title="${esc(d.path || d.name)}">${esc(d.name || '文件')}</span>
        <span class="df-size">${fmtSize(d.size)}</span>
        <button type="button" class="draft-x" title="移除文件">×</button>
      </div>`;
  }

  function renderDrafts() {
    if (draftImages.length === 0 && draftFiles.length === 0) {
      draftsEl.hidden = true;
      draftsEl.innerHTML = '';
      return;
    }
    draftsEl.hidden = false;
    const imgHTML = draftImages
      .map((d, i) => `<div class="draft-thumb" data-img="${i}">
          <img src="${d.thumb}" alt="待发送图片" />
          <button type="button" class="draft-x" title="移除图片">×</button>
        </div>`)
      .join('');
    const fileHTML = draftFiles.map((d, i) => draftFileChipHTML({ ...d, __i: i })).join('');
    draftsEl.innerHTML = imgHTML + fileHTML;
    draftsEl.querySelectorAll('.draft-thumb[data-img]').forEach((thumb) => {
      const btn = thumb.querySelector('.draft-x');
      if (btn) btn.onclick = () => {
        draftImages.splice(Number(thumb.dataset.img), 1);
        renderDrafts();
      };
    });
    draftsEl.querySelectorAll('.draft-file[data-file]').forEach((chip) => {
      const btn = chip.querySelector('.draft-x');
      if (btn) btn.onclick = () => {
        draftFiles.splice(Number(chip.dataset.file), 1);
        renderDrafts();
      };
    });
  }

  function makeFileChipEl(f) {
    const chip = document.createElement('span');
    chip.className = 'draft-file static';
    chip.innerHTML = `<span class="df-ic">${fileIcon(f.name)}</span><span class="df-name">${esc(f.name || '文件')}</span><span class="df-size">${fmtSize(f.size)}</span>`;
    return chip;
  }

  const attachBtn = $('#chatAttach');
  if (attachBtn) {
    attachBtn.addEventListener('click', async () => {
      const r = await api.pickFiles();
      if (!r || !r.ok || r.cancelled) return;
      for (const f of r.files || []) {
        if (!draftFiles.some((d) => d.path === f.path)) draftFiles.push(f);
      }
      renderDrafts();
      keepInputFocus();
    });
  }

  async function send() {
    const text = inputEl.value.trim();
    if ((!text && draftImages.length === 0 && draftFiles.length === 0) || !currentSessionId) return;
    const sentImages = draftImages.slice();
    const sentFiles = draftFiles.slice();
    inputEl.value = '';
    autoGrow();
    document.querySelector('.chat-empty')?.remove();
    pendingUserEl = makeUserMsg(text || ((sentImages.length || sentFiles.length) ? '' : ''));
    for (const d of sentImages) {
      const img = document.createElement('img');
      img.className = 'msg-img';
      img.src = d.thumb;
      pendingUserEl.appendChild(img);
    }
    for (const f of sentFiles) {
      pendingUserEl.appendChild(makeFileChipEl(f));
    }
    scrollBottom(true);
    const r = await api.chatSend(currentSessionId, text, sentImages, sentFiles, sendMode);
    if (r.ok) {
      draftImages.length = 0;
      draftFiles.length = 0;
      renderDrafts();
    } else {
      if (pendingUserEl) pendingUserEl.textContent = `⚠ 发送失败: ${r.error}`;
      pendingUserEl = null;
    }
  }

  async function cancelTurn() {
    if (!currentSessionId) return;
    await api.chatCancel(currentSessionId);
  }

  // 在指定工作区新建会话（workspaceId = null 表示未分组 / 默认目录）
  async function createSessionInWorkspace(workspaceId) {
    if (!running) return;
    // 该工作区已有空白会话 → 直接复用，不重复创建（与 webui 行为一致）
    const blanks = sessions.filter((s) => {
      if (archivedSessionIds.has(s.sessionId) || !s.blank) return false;
      if (workspaceId) return (workspaces.find((w) => w.workspaceId === workspaceId)?.sessionIds || []).includes(s.sessionId);
      return !workspaceOf(s.sessionId);
    });
    if (blanks.length > 0) {
      await openSession(blanks[0].sessionId);
      return;
    }
    const r = await api.chatCreate(workspaceId ? { workspaceId } : null);
    if (!r.ok) {
      themedAlert('创建会话失败：' + r.error, '星际通讯中断');
      return;
    }
    await refreshSessions();
    await loadWorkspaces();
    if (r.sessionId) await openSession(r.sessionId);
  }

  // 「＋ 新会话」：一键开聊，不再强制选择工作区。
  //  - 处于工作区筛选视图 → 新会话归属该工作区（保证创建后立即可见）
  //  - 否则 → 直接在默认目录开"闲聊"会话（未分组），点击即可对话
  async function newSession() {
    if (!running) return;
    await createSessionInWorkspace(currentWorkspaceId);
  }

  // 从电脑上选一个文件夹作为工作区（原生目录选择器）。
  // 添加后保持"全部"筛选视图 —— 不隐藏任何历史会话，新工作区以分组形式出现在列表中。
  async function pickWorkspaceFolder() {
    if (!running) return;
    const pick = await api.pickWorkspaceDir();
    if (!pick.ok || pick.cancelled || !pick.path) return;
    const add = await api.addWorkspace(pick.path);
    if (!add.ok) {
      themedAlert('添加工作区失败：' + add.error, '星际通讯中断');
      return;
    }
    await refreshSessions();
    await loadWorkspaces();
  }

  async function deleteSession(sessionId) {
    const s = sessions.find((x) => x.sessionId === sessionId);
    const ok = await themedConfirm(`确定删除历史会话「${s?.title || sessionId}」？\n会话将从列表移除，无法在此恢复。`);
    if (!ok) return;
    const r = await api.chatArchiveSession(sessionId);
    if (!r.ok) {
      showChatError(`删除失败：${r.error}`);
      return;
    }
    archivedSessionIds.add(sessionId);
    if (currentSessionId === sessionId) {
      const rest = visibleSessions().filter((x) => x.sessionId !== sessionId);
      if (rest.length > 0) {
        await openSession(rest[0].sessionId);
      } else {
        currentSessionId = null;
        messagesEl.innerHTML = '<div class="chat-empty"><div class="big">🗑</div>会话已删除<br />点击「＋ 新会话」重新开始</div>';
        setTurnUI(false);
        renderStatus();
      }
    }
    refreshSessions();
  }

  // ---------------- 事件流（并发缓冲） ----------------
  function applyChunk(b, chunk) {
    const blk = b.blocks.get(chunk.index);
    if (chunk.type === 'block-start') {
      if (!blk) b.blocks.set(chunk.index, { kind: chunk.blockType === 'reasoning' ? 'reasoning' : 'text', text: '' });
    } else if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
      // 部分 chunk 流没有 block-start，delta 直接到达 → 隐式建块
      if (blk) blk.text += chunk.text;
      else b.blocks.set(chunk.index, { kind: chunk.type === 'reasoning-delta' ? 'reasoning' : 'text', text: chunk.text });
    } else if (chunk.type === 'block-end') {
      if (blk) {
        if (chunk.block?.text !== undefined) blk.text = chunk.block.text;
        b.blocks.delete(chunk.index);
      } else if (chunk.block?.text !== undefined) {
        b.blocks.set(chunk.index, { kind: chunk.block.type === 'reasoning' ? 'reasoning' : 'text', text: chunk.block.text });
      }
    }
  }

  function renderChunk(chunk) {
    const index = chunk.index;
    if (chunk.type === 'block-start') {
      if (!streamMsg) streamMsg = makeAssistantMsg();
      const el = document.createElement('div');
      if (chunk.blockType === 'reasoning') {
        const d = document.createElement('details');
        d.className = 'msg-reasoning';
        d.innerHTML = '<summary>🧠 思考过程</summary><div></div>';
        el.appendChild(d);
        streamMsg.appendChild(el);
        const txt = d.querySelector('div');
        txt.__dshLen = 0;
        domBlocks.set(index, txt);
      } else {
        el.className = 'stream-caret';
        el.__dshLen = 0;
        streamMsg.appendChild(el);
        domBlocks.set(index, el);
      }
    } else if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
      if (!streamMsg) streamMsg = makeAssistantMsg();
      let el = domBlocks.get(index);
      if (!el) {
        // 隐式建块（无 block-start）
        if (chunk.type === 'reasoning-delta') {
          const d = document.createElement('details');
          d.className = 'msg-reasoning';
          d.innerHTML = '<summary>🧠 思考过程</summary><div></div>';
          streamMsg.appendChild(d);
          el = d.querySelector('div');
        } else {
          el = document.createElement('div');
          el.className = 'stream-caret';
          streamMsg.appendChild(el);
        }
        el.__dshLen = 0;
        domBlocks.set(index, el);
      }
      // 只追加"尚未写入"的增量：若 renderLiveBuffer/历史已重建过同 index 文本，跳过重复部分
      const base = el.__dshLen || 0;
      el.textContent = el.textContent.slice(0, base) + chunk.text;
      el.__dshLen = el.textContent.length;
      const blk = buf(currentSessionId)?.blocks?.get(index);
      if (blk && typeof blk.text === 'string' && el.textContent.length < blk.text.length) {
        // 缓冲里还有更长文本（renderLiveBuffer 重建过）→ 直接补全到一致
        el.textContent = blk.text;
        el.__dshLen = el.textContent.length;
      }
    } else if (chunk.type === 'block-end') {
      const el = domBlocks.get(index);
      if (el && chunk.block?.text) el.textContent = chunk.block.text;
      domBlocks.delete(index);
      const caret = streamMsg?.querySelectorAll('.stream-caret');
      if (caret && caret.length) caret[caret.length - 1].classList.remove('stream-caret');
    }
  }

  function finalizeStream(data) {
    if (!streamMsg) return;
    streamMsg.classList.remove('pending');
    const model = data?.provenance?.model || '';
    const usage = data?.usage ? ` · ${data.usage.inputTokens}↑ ${data.usage.outputTokens}↓ tokens` : '';
    const content = data?.content;
    const hasContent = Array.isArray(content) && content.some(
      (b) => (b.type === 'text' && b.text) || (b.type === 'reasoning' && b.text) || b.type === 'image'
    );
    if (hasContent) {
      renderAssistantContent(streamMsg, content, model ? `${model}${usage}` : '');
    } else if (model || usage) {
      // 最终消息无 content（文本只存在于 chunk 流）→ 保留已流式渲染的正文，仅补 meta
      const hasText = streamMsg.textContent.trim().length > 0;
      if (!hasText) {
        streamMsg.remove();
        streamMsg = null;
      } else {
        const m = document.createElement('div');
        m.className = 'msg-meta';
        m.textContent = `${model}${usage}`;
        streamMsg.appendChild(m);
      }
    }
    streamMsg = null;
    domBlocks = new Map();
  }

  function handleSessionEvent(p) {
    const ev = p.event;
    if (!ev) return;
    const b = buf(p.sessionId);
    const isCur = p.sessionId === currentSessionId;

    switch (ev.type) {
      case 'turn/start':
        b.turn = true;
        if (isCur) setTurnUI(true);
        refreshSessions();
        break;

      case 'turn/end': {
        b.turn = false;
        b.tool = null;
        b.blocks.clear();
        if (isCur) {
          setTurnUI(false);
          const reason = ev.data?.reason;
          if (reason?.kind === 'error' && reason?.error?.message) {
            showChatError(reason.error.message);
          } else if (reason?.kind === 'aborted') {
            showChatError('回复已被中止');
          }
          if (streamMsg) {
            const hasContent = streamMsg.textContent.trim().length > 0;
            streamMsg.classList.remove('pending');
            if (!hasContent) streamMsg.remove();
            streamMsg = null;
          }
          domBlocks = new Map();
          renderStatus();
        }
        refreshSessions();
        break;
      }

      case 'user/message': {
        if (!isCur) break;
        const isRealUser = ev.data?.source?.kind === 'user';
        if (!isRealUser) break;
        const key = msgIdentity(ev);
        if (key) {
          const seen = renderedIdFor(currentSessionId);
          // 已在 DOM（历史或此前事件渲染过）→ 只标记去重，不再新建；若 pendingUserEl 存在则复用刷新
          if (seen.has(key)) {
            if (pendingUserEl && !pendingUserEl.dataset.msgKey) {
              pendingUserEl.dataset.msgKey = key;
              renderUserMessage(ev, pendingUserEl);
            }
            pendingUserEl = null;
            break;
          }
        }
        const blocks = ev.data?.content || [];
        const text = blocks.filter((bl) => bl.type === 'text').map((bl) => bl.text).join('\n');
        if (pendingUserEl) {
          // 用服务端回显刷新本地气泡（保留，不移除）
          pendingUserEl.dataset.msgKey = key || '';
          renderUserMessage(ev, pendingUserEl);
          pendingUserEl = null;
        } else if (text || blocks.some((bl) => bl.type === 'image')) {
          const el = renderUserMessage(ev, null);
          if (key && el) el.dataset.msgKey = key;
          scrollBottom(false);
        }
        if (key) renderedIdFor(currentSessionId).add(key);
        break;
      }

      case 'assistant/chunk': {
        const chunk = ev.data?.chunk;
        if (!chunk) break;
        applyChunk(b, chunk);
        if (isCur) {
          renderChunk(chunk);
          scrollBottom(false);
        }
        break;
      }

      case 'assistant/message': {
        if (ev.data?.provenance?.model) b.model = ev.data.provenance.model;
        if (isCur) {
          const key = msgIdentity(ev);
          if (key) {
            const seen = renderedIdFor(currentSessionId);
            if (seen.has(key)) {
              // 该消息已渲染（接历史/其他来源）→ 只清理流缓冲，不产生第二框
              b.blocks.clear();
              if (streamMsg) { streamMsg.remove(); streamMsg = null; }
              domBlocks = new Map();
              break;
            }
            seen.add(key);
          }
          finalizeStream(ev.data);
          scrollBottom(false);
        }
        b.blocks.clear();
        break;
      }

      case 'tool/call': {
        b.tool = ev.data?.name || 'tool';
        if (isCur) {
          makeToolChip(b.tool, '调用中…');
          renderStatus();
          scrollBottom(false);
        }
        break;
      }

      case 'tool/result': {
        b.tool = null;
        if (isCur) {
          const text = (ev.data?.content || []).map((bl) => bl.text).join('\n').slice(0, 200);
          makeToolChip(ev.data?.name || 'tool', text);
          renderStatus();
          scrollBottom(false);
        }
        break;
      }

      case 'session/title':
      case 'session/projection':
        refreshSessions();
        break;

      default:
        break;
    }
  }

  function handleFrame(msg) {
    const p = msg.payload;
    if (!p) return;
    if (msg.stream === 'host') {
      if (p.type === 'host/session-status') {
        if (!p.running) {
          const b = buf(p.sessionId);
          b.turn = false;
          if (p.sessionId === currentSessionId) setTurnUI(false);
        }
        refreshSessions();
      } else if (p.type === 'host/session-added' || p.type === 'host/session-removed') {
        refreshSessions();
      } else if (p.type === 'host/agent-error' && p.message) {
        showChatError(p.message);
      }
      return;
    }
    if (msg.stream === 'mux') {
      if (p.type === 'session/subscribed') {
        // mux 重连/重开时引擎只推送 subscribed 基线（lastSeq），不会重放对话事件。
        // 这里把该会话的流式缓冲与 DOM 状态重置，避免残留 blocks 在 reopen 时与 history 叠加成双框。
        const b = buf(p.sessionId);
        b.blocks.clear();
        b.turn = false;
        b.tool = null;
        renderedIds.set(p.sessionId, new Set());
        if (p.sessionId === currentSessionId) {
          streamMsg = null;
          domBlocks = new Map();
        }
        if (p.sessionId === currentSessionId) setTurnUI(false);
        return;
      }
      if (p.type === 'session/event') handleSessionEvent(p);
      else if (p.type === 'session/projection') {
        if (p.sessionId !== currentSessionId) return;
        if (p.key === 'title') refreshSessions();
        else if (['permissions', 'contextPressure', 'tokenUsage', 'sessionStats'].includes(p.key)) {
          applyProjections({ [p.key]: p.value });
        }
      } else if (p.type === 'question/requested') {
        // 智能体提问（ask_user_question）：rpcId 在 server-request 帧顶层
        handleQuestionRequested({ rpcId: msg.rpcId, sessionId: p.sessionId, questions: p.questions || [] });
      } else if (p.type === 'question/resolved') {
        handleQuestionResolved({ sessionId: p.sessionId, questionRpcId: p.questionRpcId, outcome: p.outcome });
      }
    }
  }

  // ---------------- 主题化模态框（替换原生 confirm / alert） ----------------
  const modalOverlay = $('#modalOverlay');
  const modalTitle = $('#modalTitle');
  const modalBody = $('#modalBody');
  const modalOk = $('#modalOk');
  const modalCancel = $('#modalCancel');

  function openModal({ title, message, okText = '确定', cancelText = '取消', danger = false }) {
    return new Promise((resolve) => {
      modalTitle.textContent = title;
      modalBody.textContent = message;
      modalOk.textContent = okText;
      modalCancel.textContent = cancelText;
      modalCancel.hidden = cancelText === '';
      modalOk.className = 'primary-btn' + (danger ? ' danger' : '');
      modalOverlay.hidden = false;
      const done = (v) => {
        modalOverlay.hidden = true;
        modalOk.onclick = null;
        modalCancel.onclick = null;
        modalOverlay.onclick = null;
        resolve(v);
      };
      modalOk.onclick = () => done(true);
      modalCancel.onclick = () => done(false);
      modalOverlay.onclick = (e) => { if (e.target === modalOverlay) done(false); };
      modalOk.focus();
    });
  }

  const themedConfirm = (message, title = '确认操作') => openModal({ title, message, okText: '确认删除', danger: true });
  const themedAlert = (message, title = '提示') => openModal({ title, message, okText: '知道了', cancelText: '' });
  // 供 app.js / settings.js 复用
  window.__modal = {
    confirm: themedConfirm,
    alert: (message, title) => themedAlert(message, title),
  };

  // ---------------- 智能体提问（ask_user_question 多选项卡片） ----------------
  const questionCards = new Map(); // sessionId -> { rpcId, sessionId, questions, el }

  function handleQuestionRequested(q) {
    if (!q || !q.rpcId || !Array.isArray(q.questions) || q.questions.length === 0) return;
    const prev = questionCards.get(q.sessionId);
    if (prev && prev.el && prev.el.isConnected) removeQuestionCard(prev.el);
    const card = { rpcId: q.rpcId, sessionId: q.sessionId, questions: q.questions, el: null };
    questionCards.set(q.sessionId, card);
    // 只渲染当前会话；其它会话的未决提问在切过去时由 mux 重放重新送达
    if (q.sessionId === currentSessionId) card.el = renderQuestionCard(card);
  }

  function handleQuestionResolved(p) {
    const card = questionCards.get(p.sessionId);
    if (!card) return;
    if (card.el && card.el.isConnected) markQuestionResolved(card.el, p.outcome || 'cancelled');
    questionCards.delete(p.sessionId);
  }

  function removeQuestionCard(cardEl) {
    if (cardEl && cardEl.isConnected) cardEl.remove();
    scrollBottom(false);
  }

  function renderQuestionCard(card) {
    const el = document.createElement('div');
    el.className = 'msg msg-question';
    const inner = document.createElement('div');
    inner.className = 'question-card';
    el.appendChild(inner);
    messagesEl.appendChild(el);
    scrollBottom(true);

    const state = card.questions.map(() => ({ selected: new Set(), custom: '' }));
    const answersFor = () => card.questions.map((question, qi) => {
      const st = state[qi];
      const answer = { id: question.id, selected: [...st.selected] };
      // ask_user_question 语义：单选且有选项时，自定义回答覆盖所选选项（否则提交会被 harness 拒绝）
      if (st.custom && question.multiSelect !== true && Array.isArray(question.options) && question.options.length > 0) {
        answer.selected = [];
      }
      if (st.custom) answer.custom = st.custom;
      return answer;
    });

    let html = '<div class="q-title">🛰️ 智能体提问</div>';
    card.questions.forEach((question, qi) => {
      html += '<div class="q-item">';
      if (question.header) html += `<div class="q-header">${esc(question.header)}</div>`;
      html += `<div class="q-q">${esc(question.question || '')}</div>`;
      if (question.detail) html += `<div class="q-detail">${esc(question.detail)}</div>`;
      if (Array.isArray(question.options) && question.options.length > 0) {
        const multi = question.multiSelect === true;
        html += `<div class="q-options" data-qi="${qi}" data-multi="${multi ? '1' : '0'}">`;
        for (const opt of question.options) {
          const label = opt && typeof opt.label === 'string' ? opt.label : '';
          if (!label) continue;
          html += `<button type="button" class="q-option" data-qi="${qi}">${esc(label)}</button>`;
        }
        html += '</div>';
      }
      html += `<input class="q-custom" type="text" data-qi="${qi}" placeholder="自定义回答（可选）" />`;
      html += '</div>';
    });
    html += `<div class="q-actions">
        <button type="button" class="primary-btn q-ok" disabled>提交</button>
        <button type="button" class="mini-btn q-cancel">暂不回答</button>
      </div>`;
    inner.innerHTML = html;

    const okBtn = inner.querySelector('.q-ok');
    const refreshOk = () => {
      okBtn.disabled = !state.some((st) => st.selected.size > 0 || st.custom);
    };

    inner.querySelectorAll('.q-option').forEach((btn) => {
      const qi = Number(btn.dataset.qi);
      btn.addEventListener('click', () => {
        const row = inner.querySelector(`.q-options[data-qi="${qi}"]`);
        const multi = row.dataset.multi === '1';
        if (!multi) {
          if (!btn.classList.contains('sel')) {
            row.querySelectorAll('.q-option').forEach((x) => x.classList.remove('sel'));
          }
          state[qi].selected.clear();
        }
        if (btn.classList.toggle('sel')) state[qi].selected.add(btn.textContent);
        else state[qi].selected.delete(btn.textContent);
        refreshOk();
      });
    });
    inner.querySelectorAll('.q-custom').forEach((c) => {
      c.addEventListener('input', () => {
        state[Number(c.dataset.qi)].custom = c.value.trim();
        refreshOk();
      });
    });

    okBtn.addEventListener('click', async () => {
      okBtn.disabled = true;
      const answers = answersFor();
      const r = await api.chatAnswerQuestion(card.rpcId, currentSessionId, answers);
      if (r && r.ok) {
        markQuestionResolved(el, 'answered', answers);
      } else {
        const reason = r && r.reason ? `（${r.reason}）` : '';
        okBtn.disabled = false;
        inner.querySelector('.q-title').textContent = `🛰️ 提交失败：${(r && r.error) || '未知错误'}${reason}，请重试`;
      }
    });
    inner.querySelector('.q-cancel').addEventListener('click', () => {
      removeQuestionCard(el);
      questionCards.delete(card.sessionId);
    });
    return el;
  }

  function markQuestionResolved(el, outcome, answers) {
    if (!el || !el.isConnected) return;
    const inner = el.querySelector('.question-card');
    if (!inner) return;
    const tag = document.createElement('div');
    tag.className = 'q-resolved';
    if (outcome === 'cancelled') {
      tag.textContent = '🛰️ 该提问已被取消';
    } else {
      const labels = (answers || [])
        .map((a) => {
          const parts = [...(a.selected || [])];
          if (a.custom) parts.push(`自定义：${a.custom}`);
          return parts.join('、');
        })
        .filter(Boolean);
      tag.textContent = `🛰️ 已回答：${labels.join('；') || '（空）'}`;
    }
    inner.innerHTML = '';
    inner.appendChild(tag);
    el.classList.add('resolved');
    scrollBottom(false);
  }

  // ---------------- 输入框焦点保护 ----------------
  // 工具栏按钮点击不抢输入焦点（mousedown preventDefault），避免"点完模型就敲不了字"
  const inputFocused = { v: false };
  inputEl.addEventListener('focus', () => { inputFocused.v = true; });
  inputEl.addEventListener('blur', () => { inputFocused.v = false; });
  function keepInputFocus() {
    if (inputFocused.v && !inputEl.disabled) inputEl.focus();
  }
  [ctModelBtn, ...document.querySelectorAll('.ct-eff'), $('#ctEffortSeg')].forEach((el) => {
    if (el) el.addEventListener('mousedown', (e) => e.preventDefault());
  });

  // ---------------- 历史面板折叠 ----------------
  const chatShell = $('#chatShell');
  const chatCollapsedBar = $('#chatCollapsedBar');
  const COLLAPSE_KEY = 'dsh-chat-sessions-collapsed';

  function applyCollapsed(on) {
    chatShell.classList.toggle('sessions-collapsed', on);
    chatCollapsedBar.hidden = !on;
    localStorage.setItem(COLLAPSE_KEY, on ? '1' : '0');
  }

  $('#chatCollapseSessions').addEventListener('click', () => applyCollapsed(true));
  chatCollapsedBar.addEventListener('click', () => applyCollapsed(false));

  // ---------------- UI 联动 ----------------
  function setConnected(on) {
    running = on;
    if (on) {
      shell.style.display = 'flex';
      placeholder.style.display = 'none';
      applyCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
      api.chatConnect().then(() => {
        refreshSessions();
        loadWorkspaces();
      });
    } else {
      shell.style.display = 'none';
      placeholder.style.display = 'flex';
      currentSessionId = null;
      streamMsg = null;
      domBlocks = new Map();
      ctStatusDot.className = 'ct-status-dot idle';
      ctStatusText.textContent = '空闲';
      ctOther.hidden = true;
      ctModelName.textContent = '模型…';
      ctEffortRow.hidden = true;
    }
  }

  function autoGrow() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
  }

  inputEl.addEventListener('keydown', (e) => {
    // Enter 发送；Shift/Alt+Enter 换行（不拦截，走默认换行）
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      send();
    }
  });
  inputEl.addEventListener('input', autoGrow);
  inputEl.addEventListener('paste', async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (!it.type.startsWith('image/')) continue;
      const file = it.getAsFile();
      if (!file) continue;
      e.preventDefault();
      if (draftImages.length >= 20) {
        showChatError('一条消息最多添加 20 张图片');
        break;
      }
      const norm = await normalizeImage(file);
      if (norm.error) {
        showChatError(`图片无法添加：${norm.error}`);
        continue;
      }
      draftImages.push(norm);
      renderDrafts();
    }
  });
  sendBtn.addEventListener('click', send);
  cancelBtn.addEventListener('click', cancelTurn);
  newBtn.addEventListener('click', newSession);
  chatStartBtn.addEventListener('click', async () => {
    const r = await api.startHarness();
    if (!r.ok) themedAlert('启动失败：' + r.error, '星际通讯中断');
  });

  const ctModeSeg = $('#ctModeSeg');
  if (ctModeSeg) {
    ctModeSeg.addEventListener('click', (e) => {
      const btn = e.target.closest('.ct-mode-btn');
      if (!btn) return;
      applySendMode(btn.dataset.mode, true);
    });
  }

  api.onChatFrame(handleFrame);
  api.onState((s) => setConnected(s === 'running'));

  renderSendMode();
  syncSendModeFromWeb();
  api.getStatus().then((st) => setConnected(st.state === 'running' || st.webUp));
})();
