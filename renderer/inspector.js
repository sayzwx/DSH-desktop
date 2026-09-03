/**
 * 会话透视抽屉（轨道 E）：子 agent 目录 + 事件轨迹，两个 tab 共用一个抽屉。
 *
 * 与 panels.js 同一套约定：本模块只渲染并把用户动作回调出去，数据一律由 chat.js 提供
 * （子 agent 走 api.subagent*，轨迹读 chat.js 累积的 per-session 事件台账），不自己订阅帧。
 *
 * 子 agent（subagent.* 四个只读/写 RPC 已由 main.js 桥接）：
 * - list 返回 { entries, parentAvailable }。entry 是联合类型：
 *   健康项 { kind:'child', id, activity:'running'|'inactive', hasChildren, mode:'one-shot'(label?) | 'continuable'(label) }，
 *   诊断项 { kind:'diagnostic', id, reason:'corrupt'|'unsupported'|'unavailable' } —— 可读但禁用。
 * - one-shot 是只读执行记录（看转录）；continuable 才能 interrupt（中断当前回合）与 prompt（续聊）。
 * - 地址是扁平的 { parentSessionId, childSessionId, mode }，由 list 的 entry 与当前会话拼出。
 *
 * 轨迹（纯本地）：把 chat.js 的会话事件台账按 turn 分组成左侧台账，选中行在右侧检查器
 * 展示 seq/type/time/token/耗时/输入/输出与原始 JSON。这是官方 Trajectory 的降级实现
 * （台账 + 检查器），不含时间轴缩放与虚拟滚动。
 *
 * 对外接口：window.__inspector = { init, render, reset, setTab }
 */
(function () {
  let ctx = null;

  const state = {
    tab: 'subagent',       // 'subagent' | 'trajectory'
    sub: null,             // 选中查看转录的子 agent：{ addr, entry }
    selectedSeq: null,     // 轨迹台账里选中的事件 seq
  };

  function init(c) {
    ctx = c;
    const tabs = document.getElementById('inspectTabs');
    if (tabs) {
      tabs.querySelectorAll('.inspect-tab').forEach((btn) => {
        btn.onclick = () => {
          if (state.tab === btn.dataset.tab && !state.sub) return;
          state.tab = btn.dataset.tab;
          state.sub = null;
          render();
        };
      });
    }
    const title = document.getElementById('inspectDrawerTitle');
    if (title) title.textContent = t('inspect.title');
    syncTabUI();
  }

  const esc = (s) => ctx.esc(s);
  const t = (key, params) => ctx.t(key, params);

  function setTab(tab) {
    if (tab !== 'subagent' && tab !== 'trajectory') return;
    state.tab = tab;
    state.sub = null;
    render();
  }

  /** 切换会话时由 chat.js 调用：清掉上一个会话的选中态与转录。 */
  function reset() {
    state.sub = null;
    state.selectedSeq = null;
  }

  function syncTabUI() {
    const tabs = document.getElementById('inspectTabs');
    if (!tabs) return;
    tabs.querySelectorAll('.inspect-tab').forEach((b) => {
      b.textContent = t(b.dataset.tab === 'subagent' ? 'inspect.tab.subagent' : 'inspect.tab.trajectory');
      b.classList.toggle('active', b.dataset.tab === state.tab);
    });
  }

  function render() {
    if (!ctx) return;
    syncTabUI();
    if (state.tab === 'subagent') renderSubagent();
    else renderTrajectory();
  }

  // ---------------- 通用小工具 ----------------
  function empty(text) {
    const d = document.createElement('div');
    d.className = 'inspect-empty';
    d.textContent = text;
    return d;
  }

  /** 加载中的占位：与 empty 分开一个类，好让调用方/测试区分"在途"与"确实为空"。 */
  function loading(text) {
    const d = document.createElement('div');
    d.className = 'inspect-loading';
    d.textContent = text;
    return d;
  }

  function warnLine(text) {
    const d = document.createElement('div');
    d.className = 'inspect-warn';
    d.textContent = `⚠ ${text}`;
    return d;
  }

  function addrOf(entry, parentSessionId) {
    return {
      parentSessionId,
      childSessionId: entry.id,
      mode: entry.mode === 'continuable' ? 'continuable' : 'one-shot',
    };
  }

  function firstText(content) {
    const blocks = Array.isArray(content) ? content : [];
    for (const b of blocks) {
      if (b && b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
        return b.text.replace(/\s+/g, ' ').trim();
      }
    }
    return '';
  }

  // ---------------- 子 agent tab ----------------
  async function renderSubagent() {
    const host = ctx.host;
    const sid = ctx.getCurrentSessionId();
    host.textContent = '';
    if (!sid) { host.appendChild(empty(t('subagent.empty'))); return; }
    if (state.sub) { renderTranscript(state.sub); return; }

    host.appendChild(loading(t('subagent.loading')));
    const r = await ctx.api.subagentList(sid);
    // 异步回来后可能已切会话 / 切 tab / 进了转录：过期结果直接丢弃
    if (ctx.getCurrentSessionId() !== sid || state.tab !== 'subagent' || state.sub) return;

    host.textContent = '';
    if (!r || !r.ok) {
      host.appendChild(empty(t('subagent.listFailed', { error: (r && r.error) || 'unknown' })));
      return;
    }
    const entries = (r.value && r.value.entries) || [];
    const parentAvailable = !!(r.value && r.value.parentAvailable);
    if (entries.length === 0) { host.appendChild(empty(t('subagent.empty'))); return; }
    if (!parentAvailable) host.appendChild(warnLine(t('subagent.parentUnavailable')));

    const list = document.createElement('div');
    list.className = 'sa-list';
    for (const entry of entries) list.appendChild(rowFor(entry, sid));
    host.appendChild(list);
  }

  function rowFor(entry, parentSessionId) {
    const row = document.createElement('div');
    if (!entry || entry.kind === 'diagnostic') {
      // 诊断项：可读但禁用，给出原因而不是当作健康子 agent
      row.className = 'sa-row sa-diag';
      const reason = entry ? t(`subagent.diagnostic.${entry.reason}`) : '';
      row.innerHTML = `<span class="sa-ic">⚠</span>
        <span class="sa-main"><span class="sa-label">${esc(entry ? entry.id : '')}</span>
        <span class="sa-reason">${esc(reason || (entry && entry.reason) || '')}</span></span>`;
      return row;
    }

    const continuable = entry.mode === 'continuable';
    const label = entry.label || entry.id;
    row.className = 'sa-row' + (entry.activity === 'running' ? ' running' : '');
    row.innerHTML = `
      <span class="sa-ic">${continuable ? '🤖' : '⚙'}</span>
      <span class="sa-main">
        <span class="sa-label">${esc(label)}</span>
        <span class="sa-meta">
          <span class="sa-badge mode-${esc(entry.mode)}">${esc(t(continuable ? 'subagent.mode.continuable' : 'subagent.mode.oneShot'))}</span>
          <span class="sa-badge act-${esc(entry.activity)}">${esc(t(entry.activity === 'running' ? 'subagent.activity.running' : 'subagent.activity.inactive'))}</span>
          ${entry.hasChildren ? `<span class="sa-badge nest" title="${esc(t('subagent.hasChildren'))}">⊞</span>` : ''}
        </span>
      </span>
      <span class="sa-acts"></span>`;

    const acts = row.querySelector('.sa-acts');
    const viewBtn = document.createElement('button');
    viewBtn.type = 'button';
    viewBtn.className = 'mini-btn';
    viewBtn.textContent = t('subagent.viewTranscript');
    viewBtn.onclick = () => { state.sub = { addr: addrOf(entry, parentSessionId), entry }; render(); };
    acts.appendChild(viewBtn);

    if (continuable) {
      const intBtn = document.createElement('button');
      intBtn.type = 'button';
      intBtn.className = 'mini-btn';
      intBtn.textContent = t('subagent.interrupt');
      intBtn.onclick = async () => {
        intBtn.disabled = true;
        const rr = await ctx.api.subagentInterrupt(addrOf(entry, parentSessionId));
        intBtn.disabled = false;
        if (rr && rr.ok) ctx.notify(t('subagent.interruptDone'), 'info');
        else ctx.notify(t('subagent.interruptFailed', { error: (rr && rr.error) || 'unknown' }), 'error');
      };
      acts.appendChild(intBtn);
    }
    return row;
  }

  async function renderTranscript(sub) {
    const host = ctx.host;
    host.textContent = '';

    const top = document.createElement('div');
    top.className = 'sa-transcript-head';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'mini-btn sa-back';
    back.textContent = t('subagent.back');
    back.onclick = () => { state.sub = null; render(); };
    top.appendChild(back);
    const label = document.createElement('span');
    label.className = 'sa-transcript-title';
    label.textContent = (sub.entry && (sub.entry.label || sub.entry.id)) || sub.addr.childSessionId;
    top.appendChild(label);
    host.appendChild(top);

    const body = document.createElement('div');
    body.className = 'sa-transcript';
    host.appendChild(body);
    body.appendChild(loading(t('subagent.loading')));

    const r = await ctx.api.subagentHistory(sub.addr, undefined, 200);
    if (state.sub !== sub) return; // 已返回或切换，过期结果丢弃
    body.textContent = '';
    if (!r || !r.ok) {
      body.appendChild(empty(t('subagent.historyFailed', { error: (r && r.error) || 'unknown' })));
      return;
    }
    const events = (r.value && r.value.events) || [];
    if (events.length === 0) { body.appendChild(empty(t('subagent.historyEmpty'))); return; }
    for (const h of events) {
      const ev = (h && h.event) || h;
      const node = transcriptEvent(ev);
      if (node) body.appendChild(node);
    }

    if (sub.addr.mode === 'continuable') host.appendChild(promptRow(sub));
    else host.appendChild(warnLine(t('subagent.readOnly')));
  }

  /** 子会话转录的精简渲染：user/assistant 文本 + 工具调用一行摘要，不复刻主对话的所有卡片。 */
  function transcriptEvent(ev) {
    if (!ev || !ev.type) return null;
    const data = ev.data || {};
    if (ev.type === 'user/message') {
      const text = firstText(data.content);
      if (!text) return null;
      const d = document.createElement('div');
      d.className = 'tr-msg tr-user';
      d.textContent = text;
      return d;
    }
    if (ev.type === 'assistant/message') {
      const blocks = Array.isArray(data.content) ? data.content : [];
      const text = blocks.filter((b) => b.type === 'text' && b.text).map((b) => b.text).join('\n\n');
      if (!text) return null;
      const d = document.createElement('div');
      d.className = 'tr-msg tr-assistant';
      const md = document.createElement('div');
      md.className = 'msg-md';
      md.innerHTML = ctx.mdBlock(text);
      d.appendChild(md);
      return d;
    }
    if (ev.type === 'tool/call') {
      const d = document.createElement('div');
      d.className = 'tr-tool';
      d.textContent = `🔧 ${data.name || 'tool'}`;
      return d;
    }
    if (ev.type === 'tool/result') {
      const d = document.createElement('div');
      const isError = data.isError === true;
      d.className = 'tr-tool' + (isError ? ' err' : '');
      const out = typeof data.output === 'string' ? data.output : firstText(data.content);
      d.textContent = `${isError ? '⚠' : '✓'} ${data.name || 'result'}${out ? ` — ${out.replace(/\s+/g, ' ').slice(0, 120)}` : ''}`;
      return d;
    }
    return null;
  }

  function promptRow(sub) {
    const row = document.createElement('div');
    row.className = 'sa-prompt';
    const input = document.createElement('textarea');
    input.rows = 1;
    input.className = 'sa-prompt-input';
    input.placeholder = t('subagent.promptPlaceholder');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'primary-btn';
    btn.textContent = t('subagent.prompt');
    const send = async () => {
      const text = input.value.trim();
      if (!text) return;
      btn.disabled = true;
      const r = await ctx.api.subagentPrompt(sub.addr, [{ type: 'text', text }], undefined);
      btn.disabled = false;
      if (r && r.ok) {
        ctx.notify(t('subagent.promptSent'), 'info');
        input.value = '';
        renderTranscript(sub); // 重新拉转录，刚投递的消息稍后会出现
      } else {
        ctx.notify(t('subagent.promptFailed', { error: (r && r.error) || 'unknown' }), 'error');
      }
    };
    btn.onclick = send;
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    };
    row.appendChild(input);
    row.appendChild(btn);
    return row;
  }

  // ---------------- 轨迹 tab ----------------
  const TRAJ_ICON = {
    'user/message': '🧑', 'assistant/message': '🤖', 'tool/call': '🔧', 'tool/result': '✓',
    'turn/start': '▶', 'turn/end': '■', 'llm/retry': '↻', 'llm/retry-started': '↻',
    'compaction/start': '🗜', 'compaction/end': '🗜', 'command/run': '⌘', 'command/done': '⌘',
  };

  function groupByTurn(log) {
    const groups = [];
    let cur = { turn: null, items: [] };
    groups.push(cur);
    let turnNo = 0;
    for (const ev of log) {
      if (ev.type === 'turn/start') {
        turnNo++;
        cur = { turn: turnNo, items: [] };
        groups.push(cur);
      }
      cur.items.push(ev);
    }
    // 首个 turn/start 之前的空 group 去掉
    return groups.filter((g) => g.items.length > 0);
  }

  function summarize(ev) {
    const data = ev.data || {};
    switch (ev.type) {
      case 'user/message': return firstText(data.content).slice(0, 80);
      case 'assistant/message': {
        const txt = firstText(data.content).slice(0, 60);
        const u = data.usage;
        return u ? `${txt}${txt ? ' · ' : ''}${u.inputTokens}↑ ${u.outputTokens}↓` : txt;
      }
      case 'tool/call': return String(data.name || '');
      case 'tool/result': return `${data.name || ''}${data.isError ? ' ⚠' : ''}`;
      case 'turn/end': return data.usage ? `${data.usage.inputTokens}↑ ${data.usage.outputTokens}↓` : '';
      default: return '';
    }
  }

  function renderTrajectory() {
    const host = ctx.host;
    const sid = ctx.getCurrentSessionId();
    host.textContent = '';
    if (!sid) { host.appendChild(empty(t('trajectory.empty'))); return; }
    const log = ctx.getEventLog(sid) || [];
    if (log.length === 0) { host.appendChild(empty(t('trajectory.empty'))); return; }

    const wrap = document.createElement('div');
    wrap.className = 'traj-wrap';
    const ledger = document.createElement('div');
    ledger.className = 'traj-ledger';
    const inspector = document.createElement('div');
    inspector.className = 'traj-inspector';
    inspector.appendChild(empty(t('trajectory.inspectorHint')));
    wrap.appendChild(ledger);
    wrap.appendChild(inspector);
    host.appendChild(wrap);

    let selectedRow = null;
    for (const g of groupByTurn(log)) {
      const head = document.createElement('div');
      head.className = 'traj-turn';
      head.textContent = g.turn === null ? t('trajectory.noTurn') : t('trajectory.turn', { n: g.turn });
      const count = document.createElement('span');
      count.className = 'traj-turn-count';
      count.textContent = t('trajectory.rows', { n: g.items.length });
      head.appendChild(count);
      ledger.appendChild(head);
      for (const ev of g.items) {
        const row = document.createElement('div');
        row.className = 'traj-row';
        row.innerHTML = `<span class="traj-seq">#${esc(String(ev.seq ?? ''))}</span>
          <span class="traj-ic">${TRAJ_ICON[ev.type] || '·'}</span>
          <span class="traj-type">${esc(ev.type)}</span>
          <span class="traj-sum">${esc(summarize(ev))}</span>`;
        row.onclick = () => {
          if (selectedRow) selectedRow.classList.remove('sel');
          row.classList.add('sel');
          selectedRow = row;
          showInspector(inspector, ev);
        };
        ledger.appendChild(row);
      }
    }
  }

  function fieldRow(label, value) {
    const d = document.createElement('div');
    d.className = 'traj-field';
    const k = document.createElement('span');
    k.className = 'traj-k';
    k.textContent = label;
    const v = document.createElement('span');
    v.className = 'traj-v';
    v.textContent = value;
    d.appendChild(k);
    d.appendChild(v);
    return d;
  }

  function showInspector(panel, ev) {
    panel.textContent = '';
    const data = ev.data || {};
    panel.appendChild(fieldRow(t('trajectory.type'), ev.type));
    if (ev.seq !== undefined) panel.appendChild(fieldRow(t('trajectory.seq'), String(ev.seq)));
    if (ev.time) panel.appendChild(fieldRow(t('trajectory.time'), new Date(ev.time).toLocaleString()));
    const u = data.usage;
    if (u) panel.appendChild(fieldRow(t('trajectory.tokens'), `${u.inputTokens}↑ / ${u.outputTokens}↓`));
    if (typeof data.durationMs === 'number') panel.appendChild(fieldRow(t('trajectory.duration'), `${data.durationMs} ms`));

    const input = firstText(data.content) || (data.args ? safeJson(data.args) : '');
    if (input) {
      const h = document.createElement('div'); h.className = 'traj-subhead'; h.textContent = t('trajectory.input');
      panel.appendChild(h);
      const pre = document.createElement('pre'); pre.className = 'traj-pre'; pre.textContent = input.slice(0, 4000);
      panel.appendChild(pre);
    }
    const output = typeof data.output === 'string' ? data.output : (data.result ? safeJson(data.result) : '');
    if (output) {
      const h = document.createElement('div'); h.className = 'traj-subhead'; h.textContent = t('trajectory.output');
      panel.appendChild(h);
      const pre = document.createElement('pre'); pre.className = 'traj-pre'; pre.textContent = output.slice(0, 4000);
      panel.appendChild(pre);
    }
    const h = document.createElement('div'); h.className = 'traj-subhead'; h.textContent = t('trajectory.detail');
    panel.appendChild(h);
    const raw = document.createElement('pre'); raw.className = 'traj-pre'; raw.textContent = safeJson(data);
    panel.appendChild(raw);
  }

  function safeJson(v) {
    try { return typeof v === 'string' ? v : JSON.stringify(v, null, 1); }
    catch { return String(v); }
  }

  /** 实时事件到达：仅当轨迹 tab 正显示时重绘台账；子 agent tab 不由事件驱动，避免重复拉目录。 */
  function onEvent() {
    if (ctx && state.tab === 'trajectory') renderTrajectory();
  }

  window.__inspector = { init, render, reset, setTab, onEvent };
})();
