/**
 * 轻量 Markdown 渲染（零依赖；回答框排版向 webUI 看齐）。
 *
 * 支持：代码块、行内代码、标题、粗体/斜体、无序/有序列表、链接、表格、引用、分隔线。
 * 安全前提：所有外部文本先经 mdEscape 转义，本模块只生成结构白名单内的标签，
 * 因此调用方可以把 innerHTML 直接交给这里的返回值。新增语法时必须维持这一前提。
 *
 * 对外接口：window.__md = { escape, inline, block }
 */
(function () {
  function mdEscape(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function mdInline(text) {
    let s = mdEscape(text);
    // 行内代码（先保护，避免被后续规则破坏）
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0001${codes.length - 1}\u0001`; });
    // 粗体 **x**
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // 斜体 *x*（避免号码、小数误伤）
    s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*(?=$|[^*])/g, '$1<em>$2</em>');
    // 链接 [text](url)
    s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    // 还原行内代码
    s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => `<code>${mdEscape(codes[Number(i)])}</code>`);
    return s;
  }

  function mdBlock(text) {
    const lines = String(text ?? '').split(/\r?\n/);
    const out = [];
    let i = 0;
    const fenceTemp = [];
    while (i < lines.length) {
      const line = lines[i];
      // 代码块
      if (/^\s*(```|~~~)/.test(line)) {
        const marker = line.match(/^\s*(?:```|~~~)\s*([\w+-]*)/)[1] || '';
        const body = [];
        i++;
        while (i < lines.length && !/^\s*(?:```|~~~)\s*$/.test(lines[i])) { body.push(lines[i]); i++; }
        i++; // 跳过闭合围栏
        const placeholder = `\u0002${fenceTemp.length}\u0002`;
        fenceTemp.push({ marker, body });
        out.push(placeholder);
        continue;
      }
      // 标题
      const h = line.match(/^#{1,6}\s+(.+)$/);
      if (h) { const lv = Math.min(6, Math.max(1, line.match(/^#+/)[0].length)); out.push(`<h${lv}>${mdInline(h[1])}</h${lv}>`); i++; continue; }
      // 分隔线
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { out.push('<hr/>'); i++; continue; }
      // 引用
      if (/^\s*>\s?/.test(line)) {
        const q = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        out.push(`<blockquote>${q.map((l) => mdInline(l)).join('<br/>')}</blockquote>`);
        continue;
      }
      // 无序列表
      if (/^\s*[-*+]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*+]\s+/, '')); i++; }
        out.push(`<ul>${items.map((it) => `<li>${mdInline(it)}</li>`).join('')}</ul>`);
        continue;
      }
      // 有序列表
      if (/^\s*\d+[.)]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i++; }
        out.push(`<ol>${items.map((it) => `<li>${mdInline(it)}</li>`).join('')}</ol>`);
        continue;
      }
      // 表格（| a | b |，行 2 为分隔）
      if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|[:\s|-]*$/.test(lines[i + 1])) {
        const headerCells = line.split('|').filter((s, idx, arr) => idx > 0 && idx < arr.length - 1).map((s) => s.trim());
        i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) {
          const cells = lines[i].split('|').filter((s, idx, arr) => idx > 0 && idx < arr.length - 1).map((s) => s.trim());
          rows.push(`<tr>${cells.map((c) => `<td>${mdInline(c)}</td>`).join('')}</tr>`);
          i++;
        }
        out.push(`<table><thead><tr>${headerCells.map((c) => `<th>${mdInline(c)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`);
        continue;
      }
      // 空行
      if (!line.trim()) { i++; continue; }
      out.push(`<p>${mdInline(line)}</p>`);
      i++;
    }
    // 还原代码块
    const result = out.join('\n').replace(/\u0002(\d+)\u0002/g, (_, idx) => {
      const b = fenceTemp[Number(idx)];
      return `<pre><code${b.marker ? ` class="lang-${mdEscape(b.marker)}"` : ''}>${mdEscape(b.body.join('\n'))}</code></pre>`;
    });
    return result;
  }

  window.__md = { escape: mdEscape, inline: mdInline, block: mdBlock };
})();
