/**
 * 工具调用卡片：按 callId 配对，并按宿主下发的展示视图分流渲染。
 *
 * 卡片形态不是这里推断的。宿主在 tool/call 与 tool/result 上附带 envelope 级的
 * `view`（`ToolEventView = { for:'call'|'result', view: ToolCallView|ToolResultView }`，
 * 见 harness/packages/host/apiproxy/src/api/events.ts），实时帧与 session.history 的
 * HistoryEntry 两条路径都带，因此这里只负责按 `view.view.card` 渲染，不重新实现
 * presenter、也不按工具名分类。
 *
 * **view 可能缺失**：契约明说它从不持久化，同一事件在后续投递中可能带不同 view 或没有
 * view，"An absent view means the client's documented default (generic JSON card)"。
 * 因此每种卡片都必须有通用兜底，未知 card 值也回落通用卡而不是抛错。
 *
 * 六种 card（字段契约见 harness/packages/core/tools/src/presentation.ts）：
 *   generic  { title, kind?, rawInput?, content?, locations? }
 *   terminal { title, description?, cwd? } + 结果 { output?, exitCode?, signal? }
 *   diff     { title, diffs:[{path, oldText, newText}], locations? }，oldText 为 null 表示新建或覆写
 *   search   shape 'matches' { files:[{path,matches:[{lineNumber,line}]}], truncated, total }
 *            shape 'paths'   { paths[], truncated, total }
 *   read     { path, offset, lines:[{number,text}], totalLines, lang? }
 *   web      kind 'search' { sources:[{url,title?,snippet?,publishedAt?}], answer?, truncated }
 *            kind 'fetch'  { url, statusCode, truncated }
 *
 * 依赖由 init(ctx) 注入：messagesEl、esc、t、buf、openPath、currentSessionId()、scrollBottom(force)。
 *
 * 对外接口：window.__toolcards = { init, renderToolCall, renderToolResult }
 */
(function () {
  let ctx = null;
  const toolCards = new Map(); // sessionId -> Map<callId, 元素>

  function init(c) { ctx = c; }
  const esc = (s) => ctx.esc(s);
  const t = (key, params) => ctx.t(key, params);

  // 降级计数：上游新增了客户端不认识的 card 值时，回落 generic 卡并记一笔，供设置页诊断暴露。
  // 只统计"有 card 值但不在契约六种之内"；view 缺失走 generic 是契约里的正常默认，不算降级。
  const KNOWN_CARDS = new Set(['generic', 'terminal', 'diff', 'search', 'read', 'web']);
  let downgradeCount = 0;
  const downgradeKinds = new Map(); // card 值 -> 命中次数
  function noteDowngrade(card) {
    downgradeCount++;
    downgradeKinds.set(card, (downgradeKinds.get(card) || 0) + 1);
  }
  function getDowngrades() {
    return { count: downgradeCount, kinds: [...downgradeKinds.entries()].map(([card, n]) => ({ card, n })) };
  }

  function toolCardsOf(sid) {
    if (!toolCards.has(sid)) toolCards.set(sid, new Map());
    return toolCards.get(sid);
  }

  function toolCallIdOf(ev) {
    const d = ev.data || {};
    if (d.callId) return d.callId;
    // tool/result：从 message.content 里的 tool-result 块取 toolCallId
    const msg = d.message || {};
    for (const c of Array.isArray(msg.content) ? msg.content : []) {
      if (c && c.toolCallId) return c.toolCallId;
    }
    return null;
  }

  /** 取展示视图；显式传入的（实时帧的 p.view）优先于挂在事件上的（历史回放）。 */
  function viewOf(ev, explicit) {
    const wrap = explicit || ev.view;
    return wrap && wrap.view ? wrap.view : null;
  }

  function parseArgs(raw) {
    try { return typeof raw === 'string' ? JSON.parse(raw) : (raw || {}); } catch { return {}; }
  }

  /** ToolCallKind → 图标。词汇表见 presentation.ts 的 ToolCallKind。 */
  const KIND_ICON = {
    read: '📖', edit: '✎', delete: '🗑', move: '↔',
    search: '🔍', execute: '⚡', fetch: '🌐', other: '🔧',
  };

  // ---------------- 模型可见结果的纯文本抽取 ----------------
  function toolResultText(ev) {
    const msg = ev.data && ev.data.message ? ev.data.message : null;
    const parts = [];
    for (const c of Array.isArray(msg && msg.content) ? msg.content : []) {
      if (c && c.type === 'tool-result') {
        const inner = c.content;
        if (typeof inner === 'string') parts.push(inner);
        else if (Array.isArray(inner)) {
          for (const b of inner) { if (b && b.type === 'text' && b.text) parts.push(b.text); }
        }
      }
    }
    return parts.join('\n');
  }

  /** ContentBlock[] → 纯文本（generic 卡的 content 字段）。 */
  function contentText(blocks) {
    if (!Array.isArray(blocks)) return '';
    return blocks
      .map((b) => (b && b.type === 'text' ? String(b.text || '') : ''))
      .filter(Boolean)
      .join('\n');
  }

  // ---------------- 长文本：折叠而非截断 ----------------
  // 旧实现把输出硬截到 4000 字符（output.slice(0, 4000)），超长部分永久丢失。
  // 这里改为先渲染预览、按需展开完整内容：既不一次性把几十万字塞进 DOM，也不丢数据。
  const LONG_PREVIEW = 2000;

  function longTextBlock(text, extraClass) {
    const full = String(text == null ? '' : text);
    const wrap = document.createElement('div');
    wrap.className = 'mt-long' + (extraClass ? ` ${extraClass}` : '');
    const pre = document.createElement('pre');
    wrap.appendChild(pre);
    if (full.length <= LONG_PREVIEW) {
      pre.textContent = full;
      return wrap;
    }
    pre.textContent = `${full.slice(0, LONG_PREVIEW)}\n…`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mini-btn mt-long-more';
    btn.textContent = t('tool.card.outputFull', { n: full.length });
    btn.onclick = () => {
      const expanded = pre.dataset.expanded === '1';
      if (expanded) {
        pre.textContent = `${full.slice(0, LONG_PREVIEW)}\n…`;
        pre.dataset.expanded = '0';
        btn.textContent = t('tool.card.outputFull', { n: full.length });
        pre.style.maxHeight = '260px';
      } else {
        pre.textContent = full;
        pre.dataset.expanded = '1';
        btn.textContent = t('tool.card.outputCollapse');
        pre.style.maxHeight = 'none';
      }
    };
    pre.style.maxHeight = '260px';
    wrap.appendChild(btn);
    return wrap;
  }

  // ---------------- 逐行 diff ----------------
  // LCS 动态规划。上限之外直接放弃逐行比对：n×m 的 dp 表在 500×500 已约 1MB，
  // 再大会在主线程上卡住渲染，而超大文件的逐行 diff 本身也没人读。
  const DIFF_LINE_CAP = 500;
  const DIFF_CONTEXT = 3;

  /**
   * @returns 行数组 [{type:'ctx'|'add'|'del'|'gap', oldNo, newNo, text}]，超出上限时返回 null。
   */
  function diffLines(oldStr, newStr) {
    const a = String(oldStr == null ? '' : oldStr).split('\n');
    const b = String(newStr == null ? '' : newStr).split('\n');
    if (a.length > DIFF_LINE_CAP || b.length > DIFF_LINE_CAP) return null;
    const n = a.length;
    const m = b.length;
    const dp = [];
    for (let i = 0; i <= n; i++) dp.push(new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const rows = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { rows.push({ type: 'ctx', oldNo: i + 1, newNo: j + 1, text: a[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ type: 'del', oldNo: i + 1, newNo: null, text: a[i] }); i++; }
      else { rows.push({ type: 'add', oldNo: null, newNo: j + 1, text: b[j] }); j++; }
    }
    while (i < n) { rows.push({ type: 'del', oldNo: i + 1, newNo: null, text: a[i] }); i++; }
    while (j < m) { rows.push({ type: 'add', oldNo: null, newNo: j + 1, text: b[j] }); j++; }
    return collapseContext(rows);
  }

  /** 把连续的未变行折叠成一条 gap，只在改动两侧各留 DIFF_CONTEXT 行上下文。 */
  function collapseContext(rows) {
    const changed = rows.map((r) => r.type !== 'ctx');
    const keep = new Array(rows.length).fill(false);
    for (let k = 0; k < rows.length; k++) {
      if (!changed[k]) continue;
      for (let d = -DIFF_CONTEXT; d <= DIFF_CONTEXT; d++) {
        const at = k + d;
        if (at >= 0 && at < rows.length) keep[at] = true;
      }
    }
    const out = [];
    let skipped = 0;
    for (let k = 0; k < rows.length; k++) {
      if (keep[k]) {
        if (skipped > 0) { out.push({ type: 'gap', text: skipped }); skipped = 0; }
        out.push(rows[k]);
      } else skipped++;
    }
    if (skipped > 0) out.push({ type: 'gap', text: skipped });
    return out;
  }

  function renderDiffFile(host, diff) {
    const box = document.createElement('div');
    box.className = 'mt-diff-file';
    const head = document.createElement('div');
    head.className = 'mt-diff-head';
    const isNew = diff.oldText === null || diff.oldText === undefined;
    head.innerHTML = `<span class="mt-path">${esc(diff.path || '')}</span>`;
    const note = document.createElement('span');
    note.className = 'mt-diff-note';
    note.textContent = isNew ? t('tool.card.newFile') : '';
    if (note.textContent) head.appendChild(note);
    if (diff.path && ctx.openPath) {
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'mini-btn mt-path-open';
      open.textContent = t('tool.card.openFile');
      open.onclick = (e) => { e.stopPropagation(); ctx.openPath(diff.path); };
      head.appendChild(open);
    }
    box.appendChild(head);

    const rows = diffLines(diff.oldText, diff.newText);
    if (rows === null) {
      const big = document.createElement('div');
      big.className = 'mt-diff-toobig';
      const oldN = String(diff.oldText == null ? '' : diff.oldText).split('\n').length;
      const newN = String(diff.newText == null ? '' : diff.newText).split('\n').length;
      big.textContent = t('tool.card.diffTooLarge', { old: oldN, new: newN, cap: DIFF_LINE_CAP });
      box.appendChild(big);
      box.appendChild(longTextBlock(diff.newText == null ? '' : diff.newText, 'mt-diff-raw'));
      host.appendChild(box);
      return;
    }
    let add = 0;
    let del = 0;
    for (const r of rows) { if (r.type === 'add') add++; else if (r.type === 'del') del++; }
    const stats = document.createElement('span');
    stats.className = 'mt-diff-stats';
    stats.innerHTML = `<span class="mt-add">+${add}</span> <span class="mt-del">-${del}</span>`;
    head.appendChild(stats);

    const table = document.createElement('div');
    table.className = 'mt-diff-rows';
    for (const r of rows) {
      if (r.type === 'gap') {
        const g = document.createElement('div');
        g.className = 'mt-diff-row gap';
        g.textContent = t('tool.card.diffGap', { n: r.text });
        table.appendChild(g);
        continue;
      }
      const row = document.createElement('div');
      row.className = `mt-diff-row ${r.type}`;
      const sign = r.type === 'add' ? '+' : r.type === 'del' ? '-' : ' ';
      row.innerHTML = `<span class="mt-ln">${r.oldNo == null ? '' : r.oldNo}</span>`
        + `<span class="mt-ln">${r.newNo == null ? '' : r.newNo}</span>`
        + `<span class="mt-sign">${sign}</span>`;
      const code = document.createElement('span');
      code.className = 'mt-diff-text';
      code.textContent = r.text;
      row.appendChild(code);
      table.appendChild(row);
    }
    box.appendChild(table);
    host.appendChild(box);
  }

  // ---------------- 代码高亮 ----------------
  /**
   * 整块高亮而不是逐行：块注释、模板字符串这类跨行 token 逐行高亮会断裂。
   * hljs 未加载或语言未注册时退回纯文本（转义后放进 pre），不抛错。
   */
  function highlightInto(pre, code, lang) {
    const hljs = window.hljs;
    if (hljs && lang && hljs.getLanguage(lang)) {
      try {
        pre.innerHTML = hljs.highlight(String(code), { language: lang, ignoreIllegals: true }).value;
        return;
      } catch { /* 落到纯文本 */ }
    }
    pre.textContent = String(code);
  }

  function renderReadCard(host, view) {
    const lines = Array.isArray(view.lines) ? view.lines : [];
    const head = document.createElement('div');
    head.className = 'mt-read-head';
    const from = lines.length > 0 ? lines[0].number : (view.offset || 1);
    const to = lines.length > 0 ? lines[lines.length - 1].number : from;
    head.innerHTML = `<span class="mt-path">${esc(view.path || '')}</span>`
      + `<span class="mt-read-range">${esc(t('tool.card.readRange', { from, to, total: view.totalLines }))}</span>`;
    if (view.path && ctx.openPath) {
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'mini-btn mt-path-open';
      open.textContent = t('tool.card.openFile');
      open.onclick = (e) => { e.stopPropagation(); ctx.openPath(view.path); };
      head.appendChild(open);
    }
    host.appendChild(head);

    const body = document.createElement('div');
    body.className = 'mt-read-body';
    const gutter = document.createElement('div');
    gutter.className = 'mt-read-gutter';
    gutter.textContent = lines.map((l) => l.number).join('\n');
    const pre = document.createElement('pre');
    pre.className = 'mt-read-code';
    highlightInto(pre, lines.map((l) => l.text).join('\n'), view.lang);
    body.appendChild(gutter);
    body.appendChild(pre);
    host.appendChild(body);
  }

  function renderSearchCard(host, view) {
    const banner = document.createElement('div');
    banner.className = 'mt-search-banner';
    if (view.shape === 'paths') {
      const shown = Array.isArray(view.paths) ? view.paths.length : 0;
      banner.textContent = view.truncated
        ? t('tool.card.pathsTruncated', { shown, total: view.total })
        : t('tool.card.pathsTotal', { total: view.total });
      host.appendChild(banner);
      const list = document.createElement('div');
      list.className = 'mt-search-paths';
      for (const p of view.paths || []) {
        const row = document.createElement('div');
        row.className = 'mt-path-row';
        row.textContent = p;
        if (ctx.openPath) {
          row.title = t('tool.card.openFile');
          row.onclick = () => ctx.openPath(p);
        }
        list.appendChild(row);
      }
      host.appendChild(list);
      return;
    }
    // shape === 'matches'
    const files = Array.isArray(view.files) ? view.files : [];
    const shown = files.reduce((n, f) => n + ((f.matches || []).length), 0);
    banner.textContent = view.truncated
      ? t('tool.card.searchTruncated', { shown, total: view.total })
      : t('tool.card.searchTotal', { total: view.total });
    host.appendChild(banner);
    for (const f of files) {
      const det = document.createElement('details');
      det.className = 'mt-search-file';
      det.open = files.length === 1; // 只有一个文件时直接展开，多个时收起免得刷屏
      const sum = document.createElement('summary');
      sum.innerHTML = `<span class="mt-path">${esc(f.path || '')}</span>`
        + `<span class="mt-search-count">${esc(t('tool.card.searchFileCount', { n: (f.matches || []).length }))}</span>`;
      det.appendChild(sum);
      const rows = document.createElement('div');
      rows.className = 'mt-search-rows';
      for (const m of f.matches || []) {
        const row = document.createElement('div');
        row.className = 'mt-search-row';
        row.innerHTML = `<span class="mt-ln">${esc(String(m.lineNumber))}</span>`;
        const code = document.createElement('span');
        code.className = 'mt-search-line';
        code.textContent = m.line;
        row.appendChild(code);
        rows.appendChild(row);
      }
      det.appendChild(rows);
      host.appendChild(det);
    }
  }

  function renderWebCard(host, view) {
    if (view.kind === 'fetch') {
      const row = document.createElement('div');
      row.className = 'mt-web-fetch';
      row.innerHTML = `<span class="mt-web-status">HTTP ${esc(String(view.statusCode))}</span>`
        + `<span class="mt-path">${esc(view.url || '')}</span>`
        + (view.truncated ? `<span class="mt-web-trunc">${esc(t('tool.card.fetchTruncated'))}</span>` : '');
      host.appendChild(row);
      return;
    }
    // kind === 'search'
    if (view.answer) {
      const ans = document.createElement('div');
      ans.className = 'mt-web-answer';
      ans.textContent = view.answer;
      host.appendChild(ans);
    }
    const sources = Array.isArray(view.sources) ? view.sources : [];
    const head = document.createElement('div');
    head.className = 'mt-search-banner';
    head.textContent = view.truncated
      ? t('tool.card.webSourcesTruncated', { n: sources.length })
      : t('tool.card.webSources', { n: sources.length });
    host.appendChild(head);
    const list = document.createElement('div');
    list.className = 'mt-web-sources';
    for (const s of sources) {
      const item = document.createElement('div');
      item.className = 'mt-web-source';
      const a = document.createElement('a');
      a.href = s.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = s.title || s.url;
      item.appendChild(a);
      let domain = '';
      try { domain = new URL(s.url).hostname; } catch { /* 非法 URL 就不显示域名 */ }
      if (domain || s.publishedAt) {
        const meta = document.createElement('span');
        meta.className = 'mt-web-meta';
        meta.textContent = [domain, s.publishedAt].filter(Boolean).join(' · ');
        item.appendChild(meta);
      }
      if (s.snippet) {
        const sn = document.createElement('div');
        sn.className = 'mt-web-snippet';
        sn.textContent = s.snippet;
        item.appendChild(sn);
      }
      list.appendChild(item);
    }
    host.appendChild(list);
  }

  function locationChips(locations) {
    if (!Array.isArray(locations) || locations.length === 0) return null;
    const wrap = document.createElement('div');
    wrap.className = 'mt-locations';
    for (const loc of locations) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'mt-loc';
      chip.textContent = loc.line ? `${loc.path}:${loc.line}` : loc.path;
      chip.title = ctx.openPath ? t('tool.card.openFile') : loc.path;
      if (ctx.openPath) chip.onclick = () => ctx.openPath(loc.path);
      else chip.disabled = true;
      wrap.appendChild(chip);
    }
    return wrap;
  }

  // ---------------- 卡片骨架 ----------------
  function makeSummary(icon, title, badgeClass, badgeText) {
    const summary = document.createElement('div');
    summary.className = 'mt-summary';
    summary.innerHTML = `<span class="mt-ic">${esc(icon)}</span><span class="mt-name">${esc(title)}</span>`
      + `<span class="mt-badge ${badgeClass}">${esc(badgeText)}</span>`;
    return summary;
  }

  /** 通用卡兜底：view 缺失或 card 值未知时走这里，等价于旧实现但不硬截断输出。 */
  function renderGenericFallback(el, ev, view, output, isErr, locationsFallback) {
    const name = (view && view.title) || ev.data?.name || el.querySelector('.mt-name')?.textContent || 'tool';
    el.innerHTML = '';
    el.appendChild(makeSummary(
      KIND_ICON[(view && view.kind) || 'other'],
      name,
      isErr ? 'error' : 'done',
      isErr ? t('tool.card.error') : t('tool.card.done'),
    ));
    const bodyText = (view && view.content ? contentText(view.content) : '') || output;
    if (bodyText && bodyText.trim()) {
      const det = document.createElement('details');
      det.className = 'mt-detail';
      const sum = document.createElement('summary');
      sum.textContent = t('tool.card.output', { n: bodyText.length });
      det.appendChild(sum);
      det.appendChild(longTextBlock(bodyText));
      el.appendChild(det);
    }
    if (view && view.rawInput !== undefined) {
      const raw = document.createElement('details');
      raw.className = 'mt-detail';
      const sum = document.createElement('summary');
      sum.textContent = t('tool.card.rawInput');
      raw.appendChild(sum);
      const pre = document.createElement('pre');
      pre.textContent = typeof view.rawInput === 'string'
        ? view.rawInput
        : JSON.stringify(view.rawInput, null, 2);
      raw.appendChild(pre);
      el.appendChild(raw);
    }
    // GenericResultView 不带 locations，用调用视图的兜底，否则完成后文件位置 chips 会消失
    const chips = locationChips((view && view.locations) || locationsFallback);
    if (chips) el.appendChild(chips);
  }

  function isErrorResult(ev) {
    const content = ev?.data?.message?.content;
    return Array.isArray(content) && content.some((c) => c && c.isError);
  }

  // ---------------- 生命周期 ----------------
  function renderToolCall(sid, ev, explicitView) {
    const id = toolCallIdOf(ev) || `seq-${ev.seq}`;
    const cards = toolCardsOf(sid);
    const existing = cards.get(id);
    if (existing && existing.isConnected) return existing; // 已存在：不重复建卡
    const el = document.createElement('div');
    el.className = 'msg-tool';
    el.dataset.callId = id;
    if (id.startsWith('seq-')) el.dataset.seq = String(ev.seq || 0); // 无 callId 时记序号避免无限增长
    ctx.messagesEl.appendChild(el);
    cards.set(id, el);

    const view = viewOf(ev, explicitView);
    el.innerHTML = '';
    if (!view) {
      // 无展示视图：沿用旧行为，从参数里挑一个显著字符串做摘要
      const args = parseArgs(ev.data?.arguments);
      const key = Object.keys(args).find((k) => typeof args[k] === 'string' && args[k].length > 0);
      const argText = key ? String(args[key]).replace(/\s+/g, ' ').slice(0, 120) : '';
      const summary = makeSummary('🔧', ev.data?.name || 'tool', 'pending', t('tool.card.pending'));
      if (argText) summary.innerHTML += `<span class="mt-arg">${esc(argText)}</span>`;
      el.appendChild(summary);
      return el;
    }

    el.dataset.card = view.card;
    // 结果视图按契约省略字段就等于"保留 pending 态的值"：GenericResultView 只有 title/content，
    // TerminalResultView 只有 title/output/exitCode/signal，DiffResultView 只有 title/diffs，
    // 三者都不带 locations，terminal 的 description 与 diff 的 locations 也只存在于调用视图。
    // 结果渲染会先清空元素，所以把调用视图存在元素上，完成态按"结果优先、调用兜底"合并回来。
    el._callView = view;
    const icon = view.card === 'terminal' ? '⚡' : view.card === 'diff' ? '✎' : KIND_ICON[view.kind || 'other'];
    el.appendChild(makeSummary(icon, view.title || ev.data?.name || 'tool', 'pending', t('tool.card.pending')));
    if (view.card === 'terminal' && view.description) {
      const d = document.createElement('div');
      d.className = 'mt-term-desc';
      d.textContent = view.description;
      el.appendChild(d);
    }
    if (view.card === 'diff') {
      // 调用期的 diff 由参数推导，oldText 为 null 表示新建或覆写（此时无前像可比）
      const body = document.createElement('div');
      body.className = 'mt-body';
      for (const d of view.diffs || []) renderDiffFile(body, d);
      el.appendChild(body);
    }
    const chips = locationChips(view.locations);
    if (chips) el.appendChild(chips);
    return el;
  }

  function renderToolResult(sid, ev, explicitView) {
    const id = toolCallIdOf(ev);
    let el = id ? toolCardsOf(sid).get(id) : null;
    if (!el || !el.isConnected) {
      // 历史/回放时可能没有对应 call 卡：退回该会话最后一张 pending 卡
      const cards = toolCardsOf(sid);
      let fallback = null;
      for (const [, c] of cards) { if (c.isConnected && c.querySelector('.mt-badge.pending')) fallback = c; }
      el = fallback || renderToolCall(sid, ev, explicitView);
    }
    if (!el) return;
    const cards = toolCardsOf(sid);
    const key = id || el.dataset.callId;

    const view = viewOf(ev, explicitView);
    const callView = el._callView || null; // 调用期视图，用于兜底结果视图不携带的字段
    const output = toolResultText(ev);
    const isErr = isErrorResult(ev);
    el.innerHTML = '';

    if (!view) {
      // 契约规定：view 缺失就是通用 JSON 卡
      const savedName = id && id.startsWith('chatcmpl')
        ? ctx.buf(ctx.currentSessionId())?.calls?.get(id)
        : null;
      renderGenericFallback(
        el,
        savedName ? { ...ev, data: { ...ev.data, name: savedName } } : ev,
        null, output, isErr,
        callView && callView.locations,
      );
      if (key) cards.set(key, el);
      ctx.scrollBottom(false);
      return;
    }

    el.dataset.card = view.card;
    const title = view.title || el.dataset.name || ev.data?.name || 'tool';
    el.dataset.name = title;
    const icon = view.card === 'terminal' ? '⚡'
      : view.card === 'diff' ? '✎'
        : view.card === 'search' ? '🔍'
          : view.card === 'read' ? '📖'
            : view.card === 'web' ? '🌐' : '🔧';

    if (view.card === 'terminal') {
      // 退出码与信号互斥；被信号杀死时没有 exitCode
      const pill = view.signal
        ? t('tool.card.signal', { signal: view.signal })
        : view.exitCode === undefined ? '' : t('tool.card.exit', { code: view.exitCode });
      const failed = isErr || (view.exitCode !== undefined && view.exitCode !== 0) || !!view.signal;
      el.appendChild(makeSummary(icon, title, failed ? 'error' : 'done', failed ? t('tool.card.error') : t('tool.card.done')));
      if (pill) {
        const p = document.createElement('span');
        p.className = `mt-exit ${failed ? 'bad' : 'good'}`;
        p.textContent = pill;
        el.querySelector('.mt-summary').appendChild(p);
      }
      // TerminalResultView 不带 description，用调用视图兜底，否则完成后命令说明会消失
      const desc = view.description || (callView && callView.description);
      if (desc) {
        const d = document.createElement('div');
        d.className = 'mt-term-desc';
        d.textContent = desc;
        el.appendChild(d);
      }
      const body = document.createElement('div');
      body.className = 'mt-body mt-term';
      if (view.output && view.output.trim()) body.appendChild(longTextBlock(view.output, 'mt-term-out'));
      else if (output.trim()) body.appendChild(longTextBlock(output, 'mt-term-out'));
      else body.appendChild(emptyHint());
      el.appendChild(body);
    } else if (view.card === 'diff') {
      el.appendChild(makeSummary(icon, title, isErr ? 'error' : 'done', isErr ? t('tool.card.error') : t('tool.card.done')));
      const body = document.createElement('div');
      body.className = 'mt-body';
      for (const d of view.diffs || []) renderDiffFile(body, d);
      el.appendChild(body);
    } else if (view.card === 'search') {
      el.appendChild(makeSummary(icon, title, isErr ? 'error' : 'done', isErr ? t('tool.card.error') : t('tool.card.done')));
      const body = document.createElement('div');
      body.className = 'mt-body';
      renderSearchCard(body, view);
      el.appendChild(body);
    } else if (view.card === 'read') {
      el.appendChild(makeSummary(icon, title, isErr ? 'error' : 'done', isErr ? t('tool.card.error') : t('tool.card.done')));
      const body = document.createElement('div');
      body.className = 'mt-body';
      if (Array.isArray(view.lines) && view.lines.length > 0) renderReadCard(body, view);
      // 契约允许 read 卡退化成通用文本卡：lines 为空时用 content 或原始输出
      else body.appendChild(longTextBlock(contentText(view.content) || output));
      el.appendChild(body);
    } else if (view.card === 'web') {
      el.appendChild(makeSummary(icon, title, isErr ? 'error' : 'done', isErr ? t('tool.card.error') : t('tool.card.done')));
      const body = document.createElement('div');
      body.className = 'mt-body';
      renderWebCard(body, view);
      // web fetch 的正文本来就是 markdown，在原始 tool/result 内容里，卡片只带检索摘要
      if (view.kind === 'fetch' && output.trim()) {
        const det = document.createElement('details');
        det.className = 'mt-detail';
        const sum = document.createElement('summary');
        sum.textContent = t('tool.card.output', { n: output.length });
        det.appendChild(sum);
        det.appendChild(longTextBlock(output));
        body.appendChild(det);
      }
      el.appendChild(body);
    } else {
      // generic 结果卡与未知 card 值都走通用兜底：上游新增卡类型时降级而非抛错。
      // GenericResultView 只有 title/content，locations 要从调用视图兜底。
      if (view && view.card && !KNOWN_CARDS.has(view.card)) noteDowngrade(view.card);
      renderGenericFallback(el, ev, view, output, isErr, callView && callView.locations);
    }

    if (key) cards.set(key, el);
    ctx.scrollBottom(false);
  }

  function emptyHint() {
    const d = document.createElement('div');
    d.className = 'mt-empty';
    d.textContent = t('tool.card.noOutput');
    return d;
  }

  window.__toolcards = { init, renderToolCall, renderToolResult, getDowngrades };
})();
