/**
 * 左侧 Dock：GitHub / MCP 工具 / 技能（VS Code 风格侧边栏）
 * - GitHub：未登录先连接账户（PAT Token）→ 账户信息（头像/登录名）→ 仓库列表 → 分支 → 文件树；
 *   支持切换登录（重新连接）与登出。
 * - MCP：读取活动 profile 组合文件中的 mcp-client 服务器。
 * - 技能：harness skill.list。
 */
(function () {
  const api = window.api;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const dock = $('#dock');
  const dockTitle = $('#dockTitle');
  const dockBody = $('#dockBody');
  const dockClose = $('#dockClose');

  let currentView = null;
  let ghUser = null;           // {login, name, avatar}
  let ghNav = null;            // {owner, repo, branch, defaultBranch}
  let ghTreeCache = null;      // {tree, truncated}

  const TITLES = { github: 'GitHub', mcp: 'MCP 工具', skill: '技能' };

  function openView(v) {
    currentView = v;
    dock.hidden = false;
    dockTitle.textContent = TITLES[v] || v;
    if (v === 'github') renderGithub();
    else if (v === 'mcp') renderMcp();
    else renderSkill();
  }

  document.querySelectorAll('.dock-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.dock;
      if (currentView === v && !dock.hidden) {
        dock.hidden = true;
        currentView = null;
        return;
      }
      openView(v);
    });
  });
  dockClose.addEventListener('click', () => { dock.hidden = true; });

  function dockErr(msg) {
    dockBody.innerHTML = `<div class="dock-empty">⚠ ${esc(msg)}</div>`;
  }

  // ================= GitHub =================
  async function renderGithub() {
    if (ghNav) {
      if (ghNav.branch) { renderTree(); return; }
      if (ghNav.repo) { renderBranches(); return; }
    }
    const st = await api.ghStatus();
    if (!st.ok) { dockErr(st.error); return; }
    if (!st.connected) { ghUser = null; renderConnect(); return; }
    ghUser = st;
    renderRepos();
  }

  function renderConnect() {
    dockBody.innerHTML = `
      <div class="dock-connect">
        <div class="dock-connect-icon">🐙</div>
        <div class="dock-connect-title">连接 GitHub 账户</div>
        <div class="dock-connect-desc">输入 Personal Access Token 以读取你的仓库。Token 仅保存在本机（~/.dsh/.github-token），需要 repo 读取权限。</div>
        <input id="ghTokenInput" class="sm-input" type="password" placeholder="ghp_…（粘贴 Token）" style="width:100%;max-width:none" />
        <div class="dock-row">
          <button class="primary-btn" id="ghConnectBtn">连接</button>
          <button class="mini-btn" id="ghTokenPageBtn">获取 Token</button>
        </div>
        <div class="dock-hint" id="ghConnectHint"></div>
      </div>`;
    $('#ghConnectBtn').onclick = async () => {
      const token = $('#ghTokenInput').value.trim();
      if (!token) { $('#ghConnectHint').textContent = '请先粘贴 Token'; return; }
      $('#ghConnectHint').textContent = '正在连接…';
      try {
        const r = await api.ghLogin(token);
        if (!r.ok) {
          $('#ghConnectHint').textContent = '连接失败：' + r.error;
          return;
        }
        ghUser = r;
        renderRepos();
      } catch (err) {
        // IPC 异常（主进程网络错误等）也要落地到提示，不能卡在"正在连接…"
        $('#ghConnectHint').textContent = '连接失败：' + (err && err.message ? err.message : String(err));
      }
    };
    $('#ghTokenPageBtn').onclick = () => api.ghOpenTokenPage();
  }

  function accountHeader(extra) {
    return `<div class="dock-account">
      ${ghUser && ghUser.avatar ? `<img class="dock-avatar" src="${ghUser.avatar}" alt="" />` : '<div class="dock-avatar dock-avatar-ph">🐙</div>'}
      <div class="dock-account-info">
        <div class="dock-account-name">${esc(ghUser ? ghUser.name : '')}</div>
        <div class="dock-account-login">@${esc(ghUser ? ghUser.login : '')}</div>
      </div>
      <div class="dock-account-actions">
        <button class="mini-btn" id="ghSwitchBtn" title="切换登录账户">切换</button>
        <button class="mini-btn" id="ghLogoutBtn" title="登出">登出</button>
      </div>
      ${extra || ''}
    </div>`;
  }

  function bindAccountActions() {
    $('#ghSwitchBtn').onclick = async () => {
      await api.ghLogout();
      ghUser = null;
      ghNav = null;
      renderConnect();
    };
    $('#ghLogoutBtn').onclick = async () => {
      await api.ghLogout();
      ghUser = null;
      ghNav = null;
      renderConnect();
    };
  }

  async function renderRepos() {
    dockBody.innerHTML = accountHeader() + '<div class="dock-loading">正在读取仓库…</div>';
    bindAccountActions();
    const r = await api.ghRepos();
    if (!r.ok) { dockErr(r.error); return; }
    const repos = r.repos || [];
    dockBody.innerHTML = accountHeader(`<div class="dock-count">${repos.length} 个仓库</div>`) +
      (repos.length === 0
        ? '<div class="dock-empty">该账户没有仓库</div>'
        : repos.map((x) => `
          <div class="dock-repo" data-full="${esc(x.full_name)}" data-def="${esc(x.default_branch)}">
            <div class="dock-repo-name">${x.private ? '🔒 ' : '📦 '}${esc(x.name)}</div>
            <div class="dock-repo-desc">${esc(x.description || x.full_name)}</div>
            <div class="dock-repo-meta">${esc(x.default_branch)}${x.updated_at ? ' · ' + esc((x.updated_at || '').slice(0, 10)) : ''}</div>
          </div>`).join(''));
    bindAccountActions();
    dockBody.querySelectorAll('.dock-repo').forEach((el) => {
      el.onclick = () => {
        ghNav = { owner: el.dataset.full.split('/')[0], repo: el.dataset.full.split('/')[1], defaultBranch: el.dataset.def };
        renderBranches();
      };
    });
  }

  async function renderBranches() {
    dockBody.innerHTML = `<div class="dock-breadcrumb">
        <button class="mini-btn" id="ghBackRepos">‹ 仓库</button>
        <span class="dock-crumb">${esc(ghNav.owner)}/${esc(ghNav.repo)}</span>
      </div><div class="dock-loading">正在读取分支…</div>`;
    $('#ghBackRepos').onclick = () => { ghNav = null; renderGithub(); };
    const r = await api.ghBranches(ghNav.owner, ghNav.repo);
    if (!r.ok) { dockErr(r.error); return; }
    const branches = r.branches || [];
    dockBody.innerHTML = `<div class="dock-breadcrumb">
        <button class="mini-btn" id="ghBackRepos">‹ 仓库</button>
        <span class="dock-crumb">${esc(ghNav.owner)}/${esc(ghNav.repo)}</span>
      </div><div class="dock-count">${branches.length} 个分支</div>` +
      branches.map((b) => `<div class="dock-branch" data-b="${esc(b)}"><span class="dock-branch-icon">⎇</span>${esc(b)}${b === ghNav.defaultBranch ? '<span class="dock-badge">默认</span>' : ''}</div>`).join('');
    $('#ghBackRepos').onclick = () => { ghNav = null; renderGithub(); };
    dockBody.querySelectorAll('.dock-branch').forEach((el) => {
      el.onclick = () => { ghNav.branch = el.dataset.b; ghTreeCache = null; renderTree(); };
    });
  }

  async function renderTree() {
    dockBody.innerHTML = `<div class="dock-breadcrumb">
        <button class="mini-btn" id="ghBackBranches">‹ 分支</button>
        <span class="dock-crumb">${esc(ghNav.owner)}/${esc(ghNav.repo)} @ ${esc(ghNav.branch)}</span>
      </div><div class="dock-loading">正在构建文件树…</div>`;
    $('#ghBackBranches').onclick = () => { ghNav.branch = null; renderBranches(); };
    if (!ghTreeCache) {
      const r = await api.ghTree(ghNav.owner, ghNav.repo, ghNav.branch);
      if (!r.ok) { dockErr(r.error); return; }
      ghTreeCache = { tree: r.tree || [], truncated: !!r.truncated };
    }
    const root = buildTree(ghTreeCache.tree);
    dockBody.innerHTML = `<div class="dock-breadcrumb">
        <button class="mini-btn" id="ghBackBranches">‹ 分支</button>
        <span class="dock-crumb">${esc(ghNav.owner)}/${esc(ghNav.repo)} @ ${esc(ghNav.branch)}</span>
      </div><div class="dock-count">${ghTreeCache.tree.length} 个条目${ghTreeCache.truncated ? '（已截断）' : ''}</div>
      <div class="dock-tree" id="dockTree"></div>`;
    $('#ghBackBranches').onclick = () => { ghNav.branch = null; renderBranches(); };
    renderTreeNodes($('#dockTree'), root);
  }

  function buildTree(flat) {
    const root = { path: '', name: '', kind: 'dir', children: new Map() };
    for (const item of flat) {
      const parts = item.path.split('/');
      let cur = root;
      let acc = '';
      for (let i = 0; i < parts.length; i++) {
        acc = acc ? acc + '/' + parts[i] : parts[i];
        let node = cur.children.get(acc);
        if (!node) {
          const isLast = i === parts.length - 1;
          node = { path: acc, name: parts[i], kind: isLast && item.type === 'blob' ? 'file' : 'dir', children: new Map() };
          cur.children.set(acc, node);
        }
        cur = node;
      }
    }
    return root;
  }

  function renderTreeNodes(container, node, depth = 0) {
    const kids = [...node.children.values()].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const kid of kids) {
      const row = document.createElement('div');
      row.className = 'tree-row' + (kid.kind === 'dir' ? ' tree-dir' : '');
      row.style.paddingLeft = (8 + depth * 14) + 'px';
      row.innerHTML = `<span class="tree-ic">${kid.kind === 'dir' ? '▸' : '📄'}</span><span class="tree-name">${esc(kid.name)}</span>`;
      container.appendChild(row);
      if (kid.kind === 'dir') {
        const sub = document.createElement('div');
        sub.className = 'tree-children';
        sub.hidden = true;
        container.appendChild(sub);
        row.onclick = () => {
          const open = !sub.hidden;
          sub.hidden = open;
          row.querySelector('.tree-ic').textContent = open ? '▾' : '▸';
          if (open) renderTreeNodes(sub, kid, depth + 1);
        };
      }
    }
  }

  // ================= MCP =================
  async function renderMcp() {
    dockBody.innerHTML = '<div class="dock-loading">正在读取 MCP 服务器…</div>';
    const r = await api.mcpList();
    const servers = r.ok ? r.servers || [] : [];
    if (!r.ok) {
      dockErr(r.error);
      return;
    }
    dockBody.innerHTML = `<div class="dock-count">${servers.length} 个 MCP 服务器</div>` +
      (servers.length === 0
        ? `<div class="dock-empty">未配置 MCP 服务器。<br />在 <code>~/.dsh/profiles/web/cordis.yml</code> 中添加 <code>mcp-client</code> 行后重启生效。</div>`
        : servers.map((s) => `<div class="dock-mcp">
            <div class="dock-repo-name">🔌 ${esc(s.serverName)}</div>
            <div class="dock-repo-desc">${esc(s.command || '（未声明启动命令）')}</div>
          </div>`).join(''));
  }

  // ================= 技能 =================
  async function renderSkill() {
    dockBody.innerHTML = '<div class="dock-loading">正在读取技能…</div>';
    const r = await api.skillsList(null);
    if (!r.ok) { dockErr(r.error); return; }
    const skills = r.skills || [];
    dockBody.innerHTML = `<div class="dock-count">${skills.length} 个技能</div>` +
      (skills.length === 0
        ? '<div class="dock-empty">暂无技能</div>'
        : skills.map((s) => `<div class="dock-skill">
            <div class="dock-repo-name">🧠 ${esc(s.name)} ${s.modelInvocable ? '<span class="dock-badge">模型可用</span>' : ''}</div>
            <div class="dock-repo-desc">${esc(s.description || '')}</div>
            ${s.whenToUse ? `<div class="dock-skill-when">适用：${esc(s.whenToUse)}</div>` : ''}
          </div>`).join(''));
  }
})();
