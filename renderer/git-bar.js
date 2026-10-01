/**
 * Git 状态栏（输入框下方那条「仓库 | 本地 | ⎇ 分支 ▾」）。
 *
 * 目标：桌面端**知道当前工作区在哪个仓库、哪个分支**，并且能直接切分支 / 新建分支 ——
 * 不用切到终端去 `git checkout`。
 *
 * 数据来源：主进程 `lib/git-ipc.js`（spawn git，不拼 shell）。
 * 目录来源：优先 `window.__ws.path()`（chat.js 发布当前工作区；见其 publishWorkspace），
 *          取不到时回落到主进程的默认工作区目录。
 *
 * 🔴 铁律：`api` 这个名字只属于 preload 桥（见工作区记忆），子函数里绝不再声明同名局部变量。
 */
(function () {
  const api = window.api;
  if (!api || !api.gitStatus) return;

  const bar = document.getElementById('gitBar');
  const repoEl = document.getElementById('gbRepo');
  const scopeEl = document.getElementById('gbScope');
  const dirtyEl = document.getElementById('gbDirty');
  const branchBtn = document.getElementById('gbBranchBtn');
  const branchNameEl = document.getElementById('gbBranchName');
  const panel = document.getElementById('gbPanel');
  if (!bar || !panel) return;

  // 面板挂到 body：聊天列是 overflow 容器，挂里面会被裁掉（沿用工作区菜单的做法）
  document.body.appendChild(panel);

  let status = null;
  let dir = '';
  let busy = false;

  /** 当前工作区目录：渲染层优先，主进程兜底 */
  async function resolveDir() {
    // 优先"当前会话的真实运行目录"（cwd），其次才是筛选用的工作区路径 ——
    // 在「全部」视图下工作区路径是空的，只看 path() 会回落到引擎目录（真机 bug）。
    const fromCwd = window.__ws && typeof window.__ws.cwd === 'function' ? window.__ws.cwd() : '';
    if (fromCwd) return fromCwd;
    const fromChat = window.__ws && typeof window.__ws.path === 'function' ? window.__ws.path() : '';
    if (fromChat) return fromChat;
    try {
      const r = await api.gitWorkspaceDir();
      return (r && r.ok && r.dir) || '';
    } catch { return ''; }
  }

  function setBusy(on) {
    busy = on;
    branchBtn.disabled = on;
    bar.classList.toggle('gb-busy', on);
  }

  function toast(msg, kind) {
    if (window.__app && typeof window.__app.toast === 'function') window.__app.toast(msg, kind);
    else if (kind === 'error') console.warn('[git-bar]', msg);
  }

  // ---------------------------------------------------------------- 渲染
  function render() {
    bar.hidden = false;
    if (!status) {
      repoEl.textContent = '工作区';
      scopeEl.textContent = '本地';
      branchNameEl.textContent = '读取中…';
      dirtyEl.hidden = true;
      return;
    }
    if (status.code === 'NO_GIT') {
      repoEl.textContent = '未检测到 Git';
      scopeEl.textContent = '本地';
      branchNameEl.textContent = '安装 Git 后可用';
      dirtyEl.hidden = true;
      branchBtn.title = status.error || '';
      return;
    }
    if (!status.isRepo) {
      repoEl.textContent = (status.dir || '').split(/[\\/]/).filter(Boolean).pop() || '工作区';
      repoEl.title = status.dir || '';
      scopeEl.textContent = '本地';
      branchNameEl.textContent = '不是 Git 仓库';
      dirtyEl.hidden = true;
      branchBtn.title = '点这里初始化仓库（git init -b main）';
      return;
    }
    repoEl.textContent = status.name || '仓库';
    repoEl.title = `${status.root}\n${(status.remotes || []).join('\n')}`;
    scopeEl.textContent = '本地';
    branchNameEl.textContent = status.detached ? '（游离 HEAD）' : status.branch;
    const bits = [];
    if (status.dirty) bits.push(`● ${status.dirty} 处改动`);
    if (status.ahead) bits.push(`↑ ${status.ahead}`);
    if (status.behind) bits.push(`↓ ${status.behind}`);
    dirtyEl.hidden = bits.length === 0;
    dirtyEl.textContent = bits.join('  ');
    dirtyEl.title = status.untracked ? `其中未跟踪 ${status.untracked} 个文件` : '';
    branchBtn.title = `当前分支 ${status.branch || '(游离)'} · 共 ${status.branches.length} 个本地分支`;
  }

  async function refresh() {
    setBusy(true);
    try {
      dir = await resolveDir();
      status = await api.gitStatus(dir || undefined);
      if (status && status.dir) dir = status.dir;
      render();
      if (!panel.hidden) renderPanel();
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------- 分支面板
  let query = '';
  let creating = false;

  function closePanel() {
    panel.hidden = true;
    panel.innerHTML = '';
    creating = false;
    query = '';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderPanel() {
    if (!status) { panel.innerHTML = '<div class="gb-panel-empty">读取中…</div>'; return; }
    if (status.code === 'NO_GIT') {
      panel.innerHTML = `<div class="gb-panel-empty">${esc(status.error || '未检测到 Git')}</div>`;
      return;
    }
    if (!status.isRepo) {
      panel.innerHTML = `
        <div class="gb-panel-head">当前目录不是 Git 仓库</div>
        <div class="gb-panel-sub">${esc(status.dir || '')}</div>
        <div class="gb-panel-row"><button type="button" class="primary-btn gb-act" data-act="init">初始化仓库（main）</button></div>`;
      return;
    }
    const list = (status.branches || []).filter((b) => !query || b.name.toLowerCase().includes(query.toLowerCase()));
    const rows = list.length
      ? list.map((b) => `<button type="button" class="gb-branch-row${b.current ? ' is-current' : ''}" data-branch="${esc(b.name)}">
          <span class="gb-branch-mark">${b.current ? '✓' : ''}</span>
          <span class="gb-branch-name">${esc(b.name)}</span>
          ${b.upstream ? `<span class="gb-branch-up">→ ${esc(b.upstream)}</span>` : ''}
        </button>`).join('')
      : '<div class="gb-panel-empty">没有匹配的分支</div>';
    panel.innerHTML = `
      <div class="gb-panel-head">
        <span>本地分支（${(status.branches || []).length}）</span>
        <button type="button" class="mini-btn" data-act="refresh" title="刷新">↻</button>
      </div>
      <input class="gb-search" id="gbSearch" type="text" placeholder="搜索分支…" value="${esc(query)}" />
      <div class="gb-branch-list">${rows}</div>
      ${creating
        ? `<div class="gb-new">
             <input class="gb-search" id="gbNewName" type="text" placeholder="新分支名（如 feat/my-work）" />
             <div class="gb-new-actions">
               <button type="button" class="primary-btn" data-act="create-confirm">创建并切换</button>
               <button type="button" class="mini-btn" data-act="create-cancel">取消</button>
             </div>
             <div class="gb-panel-sub">从 <b>${esc(status.branch || 'HEAD')}</b> 切出；只会字母数字 . _ - /</div>
           </div>`
        : '<button type="button" class="gb-new-btn" data-act="create">＋ 新建分支</button>'}
      <div class="gb-panel-foot">
        <span class="gb-foot-repo" title="${esc(status.root)}">${esc(status.root)}</span>
      </div>`;
    const search = panel.querySelector('#gbSearch');
    if (search) {
      search.addEventListener('input', () => {
        query = search.value;
        const cur = panel.querySelector('#gbSearch');
        renderPanel();
        const next = panel.querySelector('#gbSearch');
        if (next) { next.focus(); next.setSelectionRange(query.length, query.length); }
        void cur;
      });
    }
    const newName = panel.querySelector('#gbNewName');
    if (newName) {
      newName.focus();
      newName.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); doCreate(newName.value); }
        if (e.key === 'Escape') { creating = false; renderPanel(); }
      });
    }
  }

  async function openPanel() {
    panel.hidden = false;
    if (!status) await refresh();
    renderPanel();
  }

  // ---------------------------------------------------------------- 动作
  async function doCheckout(branch) {
    setBusy(true);
    try {
      const r = await api.gitCheckout(dir, branch);
      if (!r || !r.ok) { toast(`切分支失败：${(r && r.error) || '未知错误'}`, 'error'); return; }
      toast(`已切到 ${branch}`, 'ok');
      closePanel();
      await refresh();
    } finally { setBusy(false); }
  }

  async function doCreate(name) {
    const branch = String(name || '').trim();
    if (!branch) { toast('请填写分支名', 'error'); return; }
    setBusy(true);
    try {
      const r = await api.gitCreateBranch(dir, branch, status && status.isRepo ? status.branch : undefined);
      if (!r || !r.ok) { toast(`新建分支失败：${(r && r.error) || '未知错误'}`, 'error'); return; }
      toast(`已创建并切到 ${branch}`, 'ok');
      closePanel();
      await refresh();
    } finally { setBusy(false); }
  }

  async function doInit() {
    setBusy(true);
    try {
      const r = await api.gitInit(dir);
      if (!r || !r.ok) { toast(`初始化失败：${(r && r.error) || '未知错误'}`, 'error'); return; }
      toast('已初始化 Git 仓库（main）', 'ok');
      await refresh();
      renderPanel();
    } finally { setBusy(false); }
  }

  branchBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (panel.hidden) openPanel();
    else closePanel();
  });

  panel.addEventListener('click', (e) => {
    e.stopPropagation();
    const row = e.target.closest('[data-branch]');
    if (row) { doCheckout(row.getAttribute('data-branch')); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const a = act.getAttribute('data-act');
    if (a === 'refresh') refresh().then(() => renderPanel());
    else if (a === 'init') doInit();
    else if (a === 'create') { creating = true; renderPanel(); }
    else if (a === 'create-cancel') { creating = false; renderPanel(); }
    else if (a === 'create-confirm') {
      const input = panel.querySelector('#gbNewName');
      doCreate(input ? input.value : '');
    }
  });

  document.addEventListener('click', () => { if (!panel.hidden) closePanel(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) closePanel();
  });

  // 切工作区 / 窗口重新获得焦点时刷新（分支可能在别处被改过）
  window.addEventListener('dsh:workspace-changed', () => { refresh(); });
  window.addEventListener('focus', () => { refresh(); });

  window.__gitBar = { refresh, getStatus: () => status, getDir: () => dir, openPanel };

  // 首次加载：等 chat.js 把工作区拉回来（它在启动时会调 chatWorkspaces），稍等再查
  setTimeout(() => { refresh(); }, 1200);
  void scopeEl;
})();
