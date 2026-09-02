/**
 * 工具调用卡片：按 callId 配对的可折叠卡片。
 *
 * 每次工具调用渲染为一张卡：call 建卡显示"🔧 名称 调用中…"，result 到达时更新同一张卡为
 * 完成态并填充输出（可展开），避免一行一事件导致的重复堆叠。
 *
 * 卡片元素由本模块创建并追加到调用方给出的消息容器；callId→元素 的映射按会话分桶，
 * 因此切换会话不会串卡。宿主在 tool 事件上附带的展示视图（frame.view，见
 * harness/packages/host/apiproxy/src/api/events.ts 的 ToolEventView）当前只被用来取输出文本，
 * 按 card 类型分流渲染是后续工作。
 *
 * 依赖由 init(ctx) 注入，避免与 chat.js 形成隐式全局耦合：
 *   ctx.messagesEl        消息容器元素
 *   ctx.esc(s)            HTML 转义
 *   ctx.buf(sessionId)    取该会话的流式缓冲
 *   ctx.currentSessionId() 当前会话 id
 *   ctx.scrollBottom(force) 滚动到底
 *
 * 对外接口：window.__toolcards = { init, renderToolCall, renderToolResult }
 */
(function () {
  let ctx = null;
  const toolCards = new Map(); // sessionId -> Map<callId, 元素>

  function init(c) {
    ctx = c;
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

  function toolResultText(ev) {
    // 优先取视口 output（harness 的 view.view.output / exitCode），再退回 message.content 文本
    const v = ev.view && ev.view.view ? ev.view.view : null;
    if (v && v.output) {
      let t = String(v.output);
      if (v.exitCode !== undefined) t += `\n[exit ${v.exitCode}]`;
      return t;
    }
    const msg = ev.data && ev.data.message ? ev.data.message : null;
    const parts = [];
    for (const c of Array.isArray(msg && msg.content) ? msg.content : []) {
      if (c && c.type === 'tool-result') {
        const inner = c.content;
        if (typeof inner === 'string') { parts.push(inner); }
        else if (Array.isArray(inner)) {
          for (const b of inner) { if (b && b.type === 'text' && b.text) parts.push(b.text); }
        }
      }
    }
    return parts.join('\n');
  }

  function renderToolCall(sid, ev) {
    const id = toolCallIdOf(ev) || `seq-${ev.seq}`;
    const cards = toolCardsOf(sid);
    let el = cards.get(id);
    if (el && el.isConnected) return el; // 已存在：不重复建卡
    el = document.createElement('div');
    el.className = 'msg-tool';
    el.dataset.callId = id;
    if (id.startsWith('seq-')) { // 无 callId 时记录序号避免无限增长
      el.dataset.seq = String(ev.seq || 0);
    }
    ctx.messagesEl.appendChild(el);
    cards.set(id, el);
    setToolCardPending(el, ev.data?.name || 'tool', ev);
    return el;
  }

  function setToolCardPending(el, name, ev) {
    const argText = (() => {
      try {
        const a = ev && ev.data && ev.data.arguments;
        if (!a) return '';
        const parsed = typeof a === 'string' ? JSON.parse(a) : a;
        const key = Object.keys(parsed || {}).find((k) => typeof parsed[k] === 'string' && parsed[k].length > 0);
        const cmd = key ? parsed[key] : '';
        return cmd ? String(cmd).replace(/\s+/g, ' ').slice(0, 120) : '';
      } catch { return ''; }
    })();
    el.innerHTML = '';
    const summary = document.createElement('div');
    summary.className = 'mt-summary';
    summary.innerHTML = `<span class="mt-ic">🔧</span><span class="mt-name">${ctx.esc(name)}</span>
      <span class="mt-badge pending">调用中…</span>${argText ? `<span class="mt-arg">${ctx.esc(argText)}</span>` : ''}`;
    el.appendChild(summary);
  }

  function renderToolResult(sid, ev) {
    const id = toolCallIdOf(ev);
    // 无 callId 兜底：按 call→result 顺序映射到上一张 pending 卡
    let el = null;
    if (id) el = toolCardsOf(sid).get(id);
    if (!el || !el.isConnected) {
      // 历史/回放时可能没有对应 call 卡，去找该会话最后一张 pending 卡
      const cards = toolCardsOf(sid);
      let fallback = null;
      for (const [, c] of cards) { if (c.isConnected && c.querySelector('.mt-badge.pending')) fallback = c; }
      el = fallback;
      if (!el) { // 找不到就直接建结果卡
        el = renderToolCall(sid, ev);
      }
    }
    if (!el) return;
    const cards = toolCardsOf(sid);
    const key = id || el.dataset.callId;
    const output = toolResultText(ev);
    setToolCardDone(el, ev, output);
    if (key) cards.set(key, el);
  }

  function setToolCardDone(el, ev, output) {
    let name = ev.data?.name || el.querySelector('.mt-name')?.textContent || 'tool';
    const key = toolCallIdOf(ev);
    if (key && key.startsWith('chatcmpl')) {
      const saved = ctx.buf(ctx.currentSessionId())?.calls?.get(key);
      if (saved) name = saved;
    }
    el.dataset.name = name;
    const isErr = !!(ev && ev.data && ev.data.message && ev.data.message.content &&
      Array.isArray(ev.data.message.content) &&
      ev.data.message.content.some((c) => c && c.isError));
    el.innerHTML = '';
    const summary = document.createElement('div');
    summary.className = 'mt-summary';
    summary.innerHTML = `<span class="mt-ic">🔧</span><span class="mt-name">${ctx.esc(name)}</span>
      <span class="mt-badge ${isErr ? 'error' : 'done'}">${isErr ? '⚠ 出错' : '✓ 完成'}</span>`;
    el.appendChild(summary);
    if (output && output.trim()) {
      const det = document.createElement('details');
      det.className = 'mt-detail';
      det.innerHTML = `<summary>查看输出（${output.length} 字符${el.dataset.exitCode !== undefined ? `，exit ${el.dataset.exitCode}` : ''}）</summary><pre></pre>`;
      const pre = det.querySelector('pre');
      pre.textContent = output.slice(0, 4000);
      el.appendChild(det);
    }
    ctx.scrollBottom(false);
  }

  window.__toolcards = { init, renderToolCall, renderToolResult };
})();
