/**
 * 右侧快捷动作面板（对齐 Qoder 的那一列）：
 *   打开工作区文件 / 打开侧边任务 / 打开内置浏览器 / 打开审阅 / 打开终端
 *
 * 三块实现方式各不相同，都是"用对工具"而不是硬凑：
 *   · 工作区文件 → 系统文件管理器打开工作区目录（主进程 shell.openPath）
 *   · 侧边任务   → 切换左侧会话列表（沿用 chat.js 既有折叠按钮，不重造）
 *   · 内置浏览器 → 主进程 `WebContentsView`（独立 webContents，**不受页面 CSP 限制**）。
 *                  渲染层负责留位置并回报矩形，视图由主进程贴上去。
 *   · 审阅       → 主进程 git diff（状态清单 + 单文件 diff，只读、+/- 着色）
 *   · 终端       → 在工作区目录打开**系统终端**（应用内终端需要 node-pty 原生依赖，另议）
 */
(function () {
  const api = window.api;
  if (!api || !api.gitDiff) return;

  const panel = document.getElementById('qaPanel');
  const review = document.getElementById('qaReview');
  const browser = document.getElementById('qaBrowser');
  const toggleBtn = document.getElementById('ctQuickBtn');
  const browserSlot = document.getElementById('qaBrowserView');
  const addrInput = document.getElementById('qaAddr');
  if (!panel || !review || !browser) return;

  /**
   * 把三块搬进**对话区右侧的一列**（`.qa-dock`），而不是让它们浮在整个窗口上。
   * 用户反馈"右侧预览框跟应用是割裂的"—— 浮层卡片压在壁纸上、自带阴影，确实像贴上去的。
   * 现在它跟左侧会话列表一样是 `.chat-shell` 里的一列：同一套面板底色/边框/圆角，
   * 开关按钮也搬进工具条（不再有右下角那颗悬浮 ＋）。
   */
  /**
   * 右侧栏的两个标签页：
   *   · 任务与产物 —— 对话的上下文面板（#chatContextDock：任务清单/目标/队列/后台任务/本回合产物）
   *   · 动作       —— 打开工作区文件 / 侧边任务 / 内置浏览器 / 审阅 / 终端
   * 用户反馈：① 上下文面板原先挤在消息区和输入框之间，半透明面板叠着壁纸"叠在一起观感很差"；
   *          ② 侧边栏"意义没有体现出来"。所以把上下文**搬进侧栏**作为一个正式标签页，
   *          内容出现时自动打开侧栏并切过去（像 WorkBuddy 的侧栏那样承接产物与任务）。
   */
  let contextDock = document.getElementById('chatContextDock');
  let viewContext = null;
  let viewActions = null;
  let viewGithub = null;
  let githubLoaded = false;
  const shell = document.querySelector('.chat-shell');
  const toolbar = document.getElementById('chatToolbar');
  if (shell) {
    dock = document.createElement('aside');
    dock.className = 'qa-dock';
    dock.id = 'qaDock';
    dock.hidden = true;
    dock.innerHTML = `<div class="qa-dock-head">
        <div class="qa-dock-tabs" role="tablist">
          <button type="button" class="qa-tab" data-qatab="context" role="tab">任务与产物</button>
          <button type="button" class="qa-tab" data-qatab="actions" role="tab">动作</button>
          <button type="button" class="qa-tab" data-qatab="github" role="tab">GitHub</button>
        </div>
        <button type="button" class="mini-btn qa-dock-close" title="收起">✕</button>
      </div>
      <div class="qa-dock-body"></div>`;
    shell.appendChild(dock);
    const body = dock.querySelector('.qa-dock-body');
    viewContext = document.createElement('div');
    viewContext.className = 'qa-view qa-view-context';
    viewActions = document.createElement('div');
    viewActions.className = 'qa-view qa-view-actions';
    if (contextDock) viewContext.appendChild(contextDock);   // 整体搬进侧栏（chat.js 继续往里渲染）
    body.appendChild(viewContext);
    body.appendChild(viewActions);
    viewActions.appendChild(panel);
    viewActions.appendChild(review);
    viewActions.appendChild(browser);
    viewGithub = document.createElement('div');
    viewGithub.className = 'qa-view qa-view-github';
    viewGithub.hidden = true;
    viewGithub.innerHTML = '<div id="ghPanelRoot" class="gh-panel-root"><div class="dock-loading">切到此标签时自动读取…</div></div>';
    body.appendChild(viewGithub);
    dock.querySelector('.qa-dock-close').addEventListener('click', () => closeAll());
    dock.querySelector('.qa-dock-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('.qa-tab');
      if (b) switchTab(b.dataset.qatab);
    });
  }
  if (toolbar && toggleBtn) toolbar.appendChild(toggleBtn);   // 工具条按钮（配合 .qa-toggle 的静态定位）

  let activeTab = 'context';
  function switchTab(tab) {
    activeTab = tab === 'actions' ? 'actions' : (tab === 'github' ? 'github' : 'context');
    if (dock) {
      dock.querySelectorAll('.qa-tab').forEach((b) => b.classList.toggle('active', b.dataset.qatab === activeTab));
    }
    if (viewContext) viewContext.hidden = activeTab !== 'context';
    if (viewActions) viewActions.hidden = activeTab !== 'actions';
    if (viewGithub) viewGithub.hidden = activeTab !== 'github';
    // GitHub 标签：首次切入才拉数据（懒加载）；内容由 dock.js 渲染进 #ghPanelRoot
    if (activeTab === 'github' && !githubLoaded && window.__dshDock) {
      githubLoaded = true;
      window.__dshDock.renderGithub(document.getElementById('ghPanelRoot'));
    }
  }
  /** 打开侧栏并切到指定标签（chat.js 在任务/产物出现时会调 openContext()） */
  function openContext() {
    ensureDock();
    switchTab('context');
  }

  let dir = '';
  let browserOpen = false;
  let lastReview = null;

  function toast(msg, kind) {
    if (window.__app && typeof window.__app.toast === 'function') window.__app.toast(msg, kind);
    else if (kind === 'error') console.warn('[quick-actions]', msg);
  }

  async function resolveDir() {
    // 同 git-bar：优先当前会话的真实目录（cwd），再退回工作区路径。
    // "打开工作区文件/审阅/终端"都该作用在你正在聊的那个目录上。
    const fromCwd = window.__ws && typeof window.__ws.cwd === 'function' ? window.__ws.cwd() : '';
    if (fromCwd) return fromCwd;
    const fromChat = window.__ws && typeof window.__ws.path === 'function' ? window.__ws.path() : '';
    if (fromChat) return fromChat;
    try {
      const r = await api.gitWorkspaceDir();
      return (r && r.ok && r.dir) || '';
    } catch { return ''; }
  }

  // ---------------------------------------------------------------- 动作
  async function actOpenFolder() {
    dir = dir || (await resolveDir());
    if (!dir) { toast('还没有工作区目录', 'error'); return; }
    const r = await api.hostOpenPath(dir);
    if (r && r.ok === false) toast(`打开失败：${r.error || ''}`, 'error');
  }

  function actSideTask() {
    // 「侧边任务」= 左侧的会话/任务列表；用既有折叠按钮切换，避免两套状态打架
    const collapse = document.getElementById('chatCollapseSessions');
    const expand = document.getElementById('chatCollapsedBar');
    if (collapse && collapse.offsetParent !== null) collapse.click();
    else if (expand) expand.click();
    else toast('找不到侧边列表', 'error');
  }

  async function actTerminal() {
    dir = dir || (await resolveDir());
    if (!dir) { toast('还没有工作区目录', 'error'); return; }
    const r = await api.gitOpenTerminal(dir);
    if (!r || !r.ok) toast(`打开终端失败：${(r && r.error) || ''}`, 'error');
    else toast('已在系统终端打开工作区', 'ok');
  }

  // ---------------------------------------------------------------- 审阅
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderDiff(text) {
    const lines = String(text || '').split('\n');
    const body = lines.map((l) => {
      let cls = 'd-ctx';
      if (/^\+\+\+|^---/.test(l)) cls = 'd-meta';
      else if (/^@@/.test(l)) cls = 'd-hunk';
      else if (/^\+/.test(l)) cls = 'd-add';
      else if (/^-/.test(l)) cls = 'd-del';
      else if (/^(diff|index|new file|deleted file|similarity|rename)/.test(l)) cls = 'd-meta';
      return `<span class="d-line ${cls}">${esc(l) || '&nbsp;'}</span>`;
    }).join('');
    return `<pre class="qa-diff">${body}</pre>`;
  }

  async function renderReview() {
    dir = dir || (await resolveDir());
    if (!dir) { review.querySelector('.qa-body').innerHTML = '<div class="qa-empty">还没有工作区目录</div>'; return; }
    const bodyEl = review.querySelector('.qa-body');
    bodyEl.innerHTML = '<div class="qa-empty">读取改动中…</div>';
    const r = await api.gitDiff(dir);
    lastReview = r;
    if (!r || !r.ok) {
      bodyEl.innerHTML = `<div class="qa-empty">${esc((r && r.error) || '读取失败')}</div>`;
      return;
    }
    if (!r.files.length) {
      bodyEl.innerHTML = `<div class="qa-empty">工作区干净：<b>${esc(r.branch || '')}</b> 上没有任何改动</div>`;
      return;
    }
    const rows = r.files.map((f) => `<button type="button" class="qa-file" data-file="${esc(f.file)}">
        <span class="qa-file-code">${esc(f.code)}</span>
        <span class="qa-file-name">${esc(f.file)}</span>
      </button>`).join('');
    bodyEl.innerHTML = `
      <div class="qa-review-head">
        <span>${esc(r.branch || '')}</span>
        <span class="qa-review-count">${r.total} 处改动</span>
      </div>
      <div class="qa-file-list">${rows}</div>
      <div class="qa-diff-holder"><div class="qa-empty">选一个文件看 diff</div></div>`;
  }

  async function showFileDiff(file) {
    const holder = review.querySelector('.qa-diff-holder');
    if (!holder) return;
    holder.innerHTML = '<div class="qa-empty">读取中…</div>';
    const r = await api.gitDiff(dir, file);
    if (!r || !r.ok) { holder.innerHTML = `<div class="qa-empty">${esc((r && r.error) || '读取失败')}</div>`; return; }
    if (!r.diff) {
      holder.innerHTML = r.files.find((f) => f.file === file && f.untracked)
        ? '<div class="qa-empty">新文件（未跟踪）：还没有可对比的 diff</div>'
        : '<div class="qa-empty">这个文件没有文本 diff</div>';
      return;
    }
    holder.innerHTML = renderDiff(r.diff) + (r.truncated ? '<div class="qa-empty">（diff 过长已截断）</div>' : '');
  }

  // ---------------------------------------------------------------- 内置浏览器
  async function sendBounds() {
    if (!browserOpen || !browserSlot) return;
    const r = browserSlot.getBoundingClientRect();
    await api.browserSetBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
  }

  async function actBrowser(url) {
    ensureDock();
    if (!browserOpen) {
      browser.hidden = false;
      browserOpen = true;
      await new Promise((res) => requestAnimationFrame(res));
      await sendBounds();
    }
    const res = await api.browserOpen(url || addrInput.value || 'https://www.bing.com', null);
    if (!res || !res.ok) { toast(`内置浏览器打不开：${(res && res.error) || ''}`, 'error'); return; }
    if (addrInput && res.url) addrInput.value = res.url;
    await sendBounds();
  }

  async function closeBrowser() {
    browserOpen = false;
    browser.hidden = true;
    await api.browserClose();
  }

  if (browserSlot && typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => { sendBounds(); });
    ro.observe(browserSlot);
  }
  window.addEventListener('resize', () => { sendBounds(); });

  api.onBrowserEvent && api.onBrowserEvent((data) => {
    if (!data) return;
    if (data.type === 'state') {
      if (addrInput && data.url && document.activeElement !== addrInput) addrInput.value = data.url;
      if (data.loading) browser.classList.add('qa-loading'); else browser.classList.remove('qa-loading');
    } else if (data.type === 'error') {
      toast(data.error || '页面加载失败', 'error');
    }
  });

  // ---------------------------------------------------------------- 面板开合
  /** 同步工具条按钮的按下态（aria-pressed + active 类）——图标按钮没按下态就看不出开关 */
  function syncToggle() {
    if (!toggleBtn) return;
    const open = !!(dock && !dock.hidden);
    toggleBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
    toggleBtn.classList.toggle('active', open);
    toggleBtn.title = open
      ? '收起侧边预览'
      : '侧边预览（打开工作区文件 / 侧边任务 / 内置浏览器 / 审阅 / 终端）';
  }

  /** 审阅/浏览器都在这一列里 —— 用它之前先把列打开，否则"点了没反应" */
  function ensureDock() {
    if (dock && dock.hidden) { dock.hidden = false; if (shell) shell.classList.add('qa-open'); switchTab(activeTab); syncToggle(); }
  }

  function closeAll() {
    panel.hidden = true;
    review.hidden = true;
    closeBrowser();
    if (dock) dock.hidden = true;          // 整列收起（右侧让回给消息区）
    if (shell) shell.classList.remove('qa-open');
    syncToggle();
  }

  function togglePanel() {
    if (dock && dock.hidden) {
      dock.hidden = false;
      shell && shell.classList.add('qa-open');
      switchTab(activeTab);
      panel.hidden = activeTab === 'actions' ? false : true;
      review.hidden = true;
      // 打开时顺带刷新一下目录（可能刚切过会话）
      dir = '';
      syncToggle();
    } else {
      closeAll();
    }
  }

  if (toggleBtn) {
    toggleBtn.hidden = false;
    toggleBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePanel(); });
    syncToggle();   // 初始态：aria-pressed=false + 正确的悬停提示
  }

  document.querySelectorAll('#qaPanel [data-act]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const a = btn.getAttribute('data-act');
      if (a === 'folder') actOpenFolder();
      else if (a === 'sideTask') actSideTask();
      else if (a === 'browser') actBrowser();
      else if (a === 'review') { ensureDock(); panel.hidden = true; review.hidden = false; renderReview(); }
      else if (a === 'terminal') actTerminal();
    });
  });

  review.addEventListener('click', (e) => {
    if (e.target.closest('#qaReviewClose')) { review.hidden = true; return; }
    if (e.target.closest('#qaReviewRefresh')) { renderReview(); return; }
    const f = e.target.closest('[data-file]');
    if (f) showFileDiff(f.getAttribute('data-file'));
  });

  browser.addEventListener('click', async (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { await api.browserNav(nav.getAttribute('data-nav')); return; }
    if (e.target.closest('#qaBrowserClose')) { closeBrowser(); return; }
    if (e.target.closest('#qaBrowserExternal')) {
      const st = await api.browserState();
      const url = (st && st.url) || addrInput.value;
      if (url) await api.browserOpenExternal(url);
    }
  });
  if (addrInput) {
    addrInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = addrInput.value.trim();
        if (v) api.browserNavigate(v).then((r) => { if (r && !r.ok) toast(r.error || '地址打不开', 'error'); });
      }
    });
  }

  // 快捷键：Alt+E / Ctrl+T / Ctrl+Shift+G / Ctrl+Shift+J（与 Qoder 一致）
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.altKey && !mod && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); actOpenFolder(); return; }
    if (mod && !e.shiftKey && (e.key === 't' || e.key === 'T')) { e.preventDefault(); actBrowser(); return; }
    if (mod && e.shiftKey && (e.key === 'g' || e.key === 'G')) { e.preventDefault(); ensureDock(); review.hidden = false; renderReview(); return; }
    if (mod && e.shiftKey && (e.key === 'j' || e.key === 'J')) { e.preventDefault(); actTerminal(); return; }
    if (e.key === 'Escape') {
      if (browserOpen) closeBrowser();
      else if (dock && !dock.hidden) closeAll();
    }
  });

  window.addEventListener('dsh:workspace-changed', () => {
    dir = '';
    if (!review.hidden) renderReview();
  });

  window.__quickActions = { open: () => { ensureDock(); switchTab('actions'); panel.hidden = false; }, close: closeAll, openReview: () => { ensureDock(); switchTab('actions'); review.hidden = false; renderReview(); }, openBrowser: actBrowser, openContext };
})();
