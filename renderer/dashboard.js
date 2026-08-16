/**
 * 仪表盘：深空数据 —— 用图展示会话使用数据
 * 数据来自 harness 的 tokenUsage / sessionStats 投影（主进程聚合）。
 */
(function () {
  const api = window.api;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const C = { cyan: '#00d4aa', violet: '#7b61ff', gold: '#ffd700', orange: '#ff6c33', dust: '#6b7b8d' };

  const fmt = (n) =>
    n >= 1e9 ? (n / 1e9).toFixed(2) + 'B'
      : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M'
        : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K'
          : String(Math.round(n));
  const fmtMs = (ms) =>
    ms >= 3.6e6 ? (ms / 3.6e6).toFixed(1) + 'h'
      : ms >= 6e4 ? (ms / 6e4).toFixed(1) + 'm'
        : (ms / 1e3).toFixed(0) + 's';

  // 估算价（DeepSeek 公开价近似，$/M tokens）
  const RATE = { input: 0.28, cache: 0.07, output: 0.42 };

  function donut(canvas, pct) {
    const ctx = canvas.getContext('2d');
    const cx = canvas.width / 2, cy = canvas.height / 2, r = 66, lw = 16;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(107, 123, 141, 0.22)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    const start = -Math.PI / 2;
    const end = start + Math.PI * 2 * Math.min(1, pct / 100);
    const grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
    grad.addColorStop(0, C.cyan);
    grad.addColorStop(1, C.violet);
    ctx.strokeStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, end);
    ctx.stroke();
    ctx.fillStyle = '#e8f4f8';
    ctx.font = '600 26px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pct.toFixed(1) + '%', cx, cy - 4);
    ctx.fillStyle = C.dust;
    ctx.font = '11px sans-serif';
    ctx.fillText('缓存命中率', cx, cy + 20);
  }

  function hbars(canvas, items, unit) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const padL = 74, padR = 64, rowH = 34, top = 16;
    const bw = W - padL - padR;
    const max = Math.max(...items.map((i) => i[1]), 1);
    const colors = [C.cyan, C.violet, C.gold, C.orange];
    items.forEach(([label, val], i) => {
      const y = top + i * rowH;
      ctx.fillStyle = C.dust;
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, padL - 8, y + rowH / 2);
      const w = Math.max(2, (val / max) * bw);
      const grad = ctx.createLinearGradient(padL, 0, padL + bw, 0);
      grad.addColorStop(0, colors[i % colors.length]);
      grad.addColorStop(1, C.violet);
      ctx.fillStyle = 'rgba(107,123,141,0.15)';
      ctx.fillRect(padL, y + 4, bw, rowH - 8);
      ctx.fillStyle = grad;
      ctx.fillRect(padL, y + 4, w, rowH - 8);
      ctx.fillStyle = '#e8f4f8';
      ctx.textAlign = 'left';
      ctx.fillText(unit(val), padL + w + 8, y + rowH / 2);
    });
  }

  function renderTable(list) {
    const body = $('#usageTableBody');
    body.innerHTML = list.length === 0
      ? '<tr><td colspan="6" class="empty">暂无会话数据</td></tr>'
      : list
          .map(
            (s) => `<tr>
            <td title="${esc(s.sessionId)}">${esc(s.title)}</td>
            <td>${s.turns}</td>
            <td>${fmt(s.uncachedInputTokens)}</td>
            <td>${fmt(s.cacheReadTokens)}</td>
            <td>${fmt(s.outputTokens)}</td>
            <td>${s.running ? '<span class="u-running">● 运行中</span>' : '<span class="u-idle">○ 待命</span>'}</td>
          </tr>`
          )
          .join('');
  }

  function drawCharts(hit, agg) {
    const wrap = $('#usageCharts');
    wrap.innerHTML = `
      <div class="u-chart-box"><canvas id="chHit" width="180" height="180"></canvas></div>
      <div class="u-chart-box"><canvas id="chTime" width="340" height="120"></canvas><div class="u-chart-title">耗时 · LLM vs 工具</div></div>
      <div class="u-chart-box"><canvas id="chToken" width="340" height="150"></canvas><div class="u-chart-title">Token 构成（输入 / 缓存读取 / 输出）</div></div>`;
    donut($('#chHit'), hit);
    hbars($('#chTime'), [['LLM 推理', agg.llm], ['工具执行', agg.tool]], fmtMs);
    hbars($('#chToken'), [['输入', agg.in], ['缓存读取', agg.cr], ['输出', agg.out]], fmt);
  }

  async function refresh() {
    const r = await api.getUsageStats();
    const meta = $('#usageMeta');
    if (!r.ok) {
      meta.textContent = '读取失败：' + r.error;
      return;
    }
    const list = r.sessions || [];
    const agg = list.reduce(
      (a, s) => {
        a.in += s.uncachedInputTokens;
        a.out += s.outputTokens;
        a.cr += s.cacheReadTokens;
        a.cw += s.cacheWriteTokens;
        a.llm += s.llmMs;
        a.tool += s.toolMs;
        a.turns += s.turns;
        a.steps += s.steps;
        if (s.running) a.running += 1;
        return a;
      },
      { in: 0, out: 0, cr: 0, cw: 0, llm: 0, tool: 0, turns: 0, steps: 0, running: 0 }
    );
    const totalIn = agg.in + agg.cr;
    const hit = totalIn > 0 ? (agg.cr / totalIn) * 100 : 0;
    const cost = (agg.in / 1e6) * RATE.input + (agg.cr / 1e6) * RATE.cache + (agg.out / 1e6) * RATE.output;
    meta.textContent = `共 ${list.length} 个会话 · 累计 ${agg.turns} 轮 / ${agg.steps} 步 · 更新于 ${new Date().toLocaleTimeString('zh-CN')}`;
    $('#usageGrid').innerHTML = `
      <div class="u-stat"><div class="u-num">${fmt(agg.in)}</div><div class="u-lbl">输入 Tokens（未命中）</div></div>
      <div class="u-stat"><div class="u-num">${fmt(agg.cr)}</div><div class="u-lbl">缓存读取 Tokens</div></div>
      <div class="u-stat"><div class="u-num">${fmt(agg.out)}</div><div class="u-lbl">输出 Tokens</div></div>
      <div class="u-stat"><div class="u-num">$${cost.toFixed(2)}</div><div class="u-lbl">估算花费（DeepSeek 公开价近似）</div></div>
      <div class="u-stat"><div class="u-num">${hit.toFixed(1)}%</div><div class="u-lbl">上下文缓存命中率</div></div>
      <div class="u-stat"><div class="u-num">${agg.running} / ${list.length}</div><div class="u-lbl">运行中 / 会话数</div></div>`;
    drawCharts(hit, agg);
    renderTable(list);
  }

  function init() {
    const btn = $('#refreshUsageBtn');
    if (btn) btn.addEventListener('click', refresh);
    api.onState((s) => {
      if (s === 'running') refresh();
    });
    api.getStatus().then((st) => {
      if (st.state === 'running' || st.webUp) refresh();
    });
  }

  init();
})();
