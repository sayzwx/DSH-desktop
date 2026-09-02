/**
 * 轻量 Markdown 渲染。
 *
 * 支持：代码块（带语言标签与复制按钮）、行内代码、KaTeX 行内 `$…$` 与块级 `$$…$$`、
 * 标题、粗体/斜体、嵌套的无序/有序列表、任务列表 `- [ ]` / `- [x]`、链接、表格、引用、分隔线。
 *
 * 安全前提：只有本模块生成的白名单标签会进入 innerHTML，所有外部文本都先经 mdEscape 转义。
 * 行内代码与数学公式按 token 从**原始文本**切出、只对 token 之外的部分转义，因此不存在
 * 二次转义（旧实现先整体转义再对行内代码内容转义一次，`` `a < b` `` 会显示成 `a &lt; b`）。
 * KaTeX 以 throwOnError:false 且不开 trust 渲染：非法公式降级为原文，\href 之类不会被放行。
 *
 * 对外接口：window.__md = { escape, inline, block }
 */
(function () {
  const t = (key, params) => window.__i18n.t(key, params);

  function mdEscape(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderMath(tex, displayMode) {
    const raw = displayMode ? `$$${tex}$$` : `$${tex}$`;
    const katex = window.katex;
    if (!katex) return mdEscape(raw);
    try {
      // trust 保持默认 false：不放行 \href / \includegraphics 这类能引出外部资源的命令
      return katex.renderToString(tex, { displayMode, throwOnError: false, output: 'html' });
    } catch {
      return mdEscape(raw); // 渲染失败降级为原文，不能让整段消息消失
    }
  }

  // 行内代码与行内公式：内容必须首尾非空白，避免把 "$5 和 $10" 当成公式
  const INLINE_TOKEN = /(`[^`]+`)|(\$[^\s$][^$]*?[^\s$]\$)/g;

  /** 在已转义的文本上套用粗体/斜体/链接规则。 */
  function mdApplyRules(escaped) {
    let s = escaped;
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // 斜体 *x*（避免号码、小数误伤）
    s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*(?=$|[^*])/g, '$1<em>$2</em>');
    // 链接 [text](url)：& 已被转义成 &amp;，在 href 里正是需要的形式
    s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return s;
  }

  function mdInline(text) {
    const raw = String(text ?? '');
    let out = '';
    let last = 0;
    for (const m of raw.matchAll(INLINE_TOKEN)) {
      out += mdApplyRules(mdEscape(raw.slice(last, m.index)));
      out += m[1]
        ? `<code>${mdEscape(m[1].slice(1, -1))}</code>`
        : renderMath(m[2].slice(1, -1), false);
      last = m.index + m[0].length;
    }
    out += mdApplyRules(mdEscape(raw.slice(last)));
    return out;
  }

  // ---------------- 列表：按缩进递归，支持嵌套与任务项 ----------------
  function indentOf(line) {
    const m = line.match(/^[ \t]*/);
    return m[0].replace(/\t/g, '  ').length;
  }
  const isBullet = (line) => /^\s*[-*+]\s+/.test(line);
  const isNumbered = (line) => /^\s*\d+[.)]\s+/.test(line);
  const isAnyItem = (line) => isBullet(line) || isNumbered(line);
  const itemText = (line) => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '');

  function taskItem(text, childHtml) {
    const m = text.match(/^\[([ xX])\]\s+([\s\S]*)$/);
    if (!m) return `<li>${mdInline(text)}${childHtml}</li>`;
    const checked = m[1].toLowerCase() === 'x' ? ' checked' : '';
    return `<li class="md-task"><input type="checkbox" disabled${checked} />${mdInline(m[2])}${childHtml}</li>`;
  }

  /**
   * 从 start 行起解析一个列表，返回 { html, next }。
   * 更深缩进的列表项递归成子列表；更深缩进的普通行并入上一项（悬挂缩进续行）。
   */
  function parseList(lines, start) {
    const baseIndent = indentOf(lines[start]);
    const ordered = isNumbered(lines[start]);
    const items = [];
    let i = start;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        // 松散列表：空行之后若还是同缩进的列表项就继续，否则本列表结束
        const next = lines[i + 1];
        if (next && isAnyItem(next) && indentOf(next) === baseIndent) { i++; continue; }
        break;
      }
      const ind = indentOf(line);
      if (ind < baseIndent) break;
      if (ind === baseIndent && isAnyItem(line)) {
        let text = itemText(line);
        i++;
        let childHtml = '';
        if (i < lines.length && isAnyItem(lines[i]) && indentOf(lines[i]) > baseIndent) {
          const child = parseList(lines, i);
          childHtml = child.html;
          i = child.next;
        } else {
          // 悬挂缩进的续行并入本项
          while (i < lines.length && lines[i].trim() && indentOf(lines[i]) > baseIndent && !isAnyItem(lines[i])) {
            text += ` ${lines[i].trim()}`;
            i++;
          }
        }
        items.push({ text, childHtml });
      } else if (ind > baseIndent) {
        // 缩进更深的非列表项行 = 悬挂缩进续行，并入上一项
        if (items.length === 0) break;
        items[items.length - 1].text += ` ${line.trim()}`;
        i++;
      } else {
        // 同级或更浅、又不是列表项：本列表到此结束，交回上层按段落/标题/公式继续解析。
        // 这里若误判成续行，列表之后的所有内容都会被吞进最后一个列表项。
        break;
      }
    }
    const tag = ordered ? 'ol' : 'ul';
    return { html: `<${tag}>${items.map((it) => taskItem(it.text, it.childHtml)).join('')}</${tag}>`, next: i };
  }

  // ---------------- 代码块：语言标签 + 复制按钮 ----------------
  /**
   * 高亮围栏代码。语言标记原样交给 hljs —— 它自带别名表（js→javascript、ts→typescript、
   * py→python、sh→bash），不需要在这里另维护一份映射。
   * @returns 已转义（或已高亮）的 HTML，可直接放进 <code>。
   */
  function highlightCode(raw, lang) {
    const hljs = window.hljs;
    if (hljs && lang && hljs.getLanguage(lang)) {
      try {
        // hljs 的输出本身已是转义过的 HTML，不能再走 mdEscape
        return hljs.highlight(raw, { language: lang, ignoreIllegals: true }).value;
      } catch { /* 落到纯转义 */ }
    }
    return mdEscape(raw);
  }

  function codeBlockHTML(marker, body) {
    const lang = marker || '';
    const code = highlightCode(body.join('\n'), lang);
    const label = lang ? `<span class="md-code-lang">${mdEscape(lang)}</span>` : '<span class="md-code-lang"></span>';
    return `<div class="md-code"${lang ? ` data-lang="${mdEscape(lang)}"` : ''}>`
      + `<div class="md-code-bar">${label}`
      + `<button type="button" class="md-code-copy">${mdEscape(t('md.copy'))}</button></div>`
      + `<pre><code${lang ? ` class="lang-${mdEscape(lang)}"` : ''}>${code}</code></pre></div>`;
  }

  // 复制按钮用事件委托，不在每次渲染时逐个绑定：一段长回答可能有几十个代码块
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.md-code-copy');
    if (!btn) return;
    const box = btn.closest('.md-code');
    const code = box && box.querySelector('pre code');
    if (!code) return;
    const text = code.textContent;
    const done = (label) => {
      btn.textContent = label;
      setTimeout(() => { btn.textContent = t('md.copy'); }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => done(t('md.copied')), () => done(t('md.copyFailed')));
    } else {
      done(t('md.copyFailed'));
    }
  });

  function mdBlock(text) {
    const lines = String(text ?? '').split(/\r?\n/);
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      // 代码块
      const fenceOpen = line.match(/^\s*(```|~~~)\s*([\w+-]*)/);
      if (fenceOpen) {
        const marker = fenceOpen[2] || '';
        const body = [];
        i++;
        while (i < lines.length && !/^\s*(?:```|~~~)\s*$/.test(lines[i])) { body.push(lines[i]); i++; }
        i++; // 跳过闭合围栏
        out.push({ html: codeBlockHTML(marker, body) });
        continue;
      }
      // 块级公式 $$ … $$
      if (/^\s*\$\$/.test(line)) {
        const first = line.replace(/^\s*\$\$/, '');
        const body = [];
        if (/\$\$\s*$/.test(first)) {
          // 单行 $$…$$：开闭围栏在同一行
          body.push(first.replace(/\$\$\s*$/, ''));
          i++;
        } else {
          if (first.trim()) body.push(first);
          i++;
          while (i < lines.length && !/\$\$\s*$/.test(lines[i])) { body.push(lines[i]); i++; }
          if (i < lines.length) {
            const tail = lines[i].replace(/\$\$\s*$/, '');
            if (tail.trim()) body.push(tail);
            i++;
          }
        }
        out.push({ html: `<div class="md-math-block">${renderMath(body.join('\n'), true)}</div>` });
        continue;
      }
      // 标题
      const h = line.match(/^(#{1,6})\s+(.+)$/);
      if (h) { out.push({ html: `<h${Math.min(6, h[1].length)}>${mdInline(h[2])}</h${Math.min(6, h[1].length)}>` }); i++; continue; }
      // 分隔线
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { out.push({ html: '<hr/>' }); i++; continue; }
      // 引用
      if (/^\s*>\s?/.test(line)) {
        const q = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        out.push({ html: `<blockquote>${q.map((l) => mdInline(l)).join('<br/>')}</blockquote>` });
        continue;
      }
      // 列表（嵌套 + 任务项）
      if (isAnyItem(line)) {
        const r = parseList(lines, i);
        out.push({ html: r.html });
        i = r.next;
        continue;
      }
      // 表格（| a | b |，行 2 为分隔）
      if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|[:\s|-]*$/.test(lines[i + 1])) {
        const cells = (l) => l.split('|').filter((_, idx, arr) => idx > 0 && idx < arr.length - 1).map((s) => s.trim());
        const headerCells = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) {
          rows.push(`<tr>${cells(lines[i]).map((c) => `<td>${mdInline(c)}</td>`).join('')}</tr>`);
          i++;
        }
        out.push({
          html: `<table><thead><tr>${headerCells.map((c) => `<th>${mdInline(c)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`,
        });
        continue;
      }
      // 空行
      if (!line.trim()) { i++; continue; }
      out.push({ html: `<p>${mdInline(line)}</p>` });
      i++;
    }
    return out.map((o) => o.html).join('\n');
  }

  window.__md = { escape: mdEscape, inline: mdInline, block: mdBlock };
})();
