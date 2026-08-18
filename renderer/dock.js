/**
 * 左侧 Dock：GitHub / MCP 工具 / 技能（VS Code 风格侧边栏）
 * - GitHub：未连接先用本机 SSH 密钥连接（git@github.com 验证）→ 账户信息（头像/登录名）→
 *   输入 owner/repo 或 git@ 地址添加仓库 → 分支 → 文件树；支持切换登录与登出。
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
        <div class="dock-connect-title">使用 SSH 密钥连接</div>
        <div class="dock-connect-desc">通过本机 SSH 密钥验证 GitHub 身份（git@github.com）。密钥文件不会被读取或上传，仅在本机用于连接与浏览；22 端口不通时自动回退 443 端口（ssh.github.com）。</div>
        <div class="dock-field-label">密钥</div>
        <select id="ghKeySelect" class="sm-input dock-select" style="width:100%;max-width:none"></select>
        <div class="dock-row" style="margin-top:8px">
          <input id="ghKeyPath" class="sm-input" placeholder="粘贴完整私钥内容，或点「浏览…」选私钥文件" style="width:100%;max-width:none" />
          <button class="mini-btn" id="ghBrowseBtn" style="flex:none">浏览…</button>
        </div>
        <div class="dock-row">
          <button class="primary-btn" id="ghConnectBtn">连接</button>
          <button class="mini-btn" id="ghDetectBtn">重新检测</button>
        </div>
        <div class="dock-hint" id="ghConnectHint"></div>
      </div>`;
    const hint = () => $('#ghConnectHint');
    const loadKeys = async (withHint) => {
      try {
        const r = await api.ghDetectKeys();
        const sel = $('#ghKeySelect');
        if (!sel) return;
        const keys = (r.ok && r.keys) || [];
        sel.innerHTML = '<option value="">使用默认密钥（~/.ssh / ssh-agent）</option>' +
          keys.map((k) => `<option value="${esc(k.path)}">${esc(k.name)}（${esc(k.source)}）</option>`).join('');
        const notes = [];
        if (r.ok && r.hostsHijacked) notes.push('检测到 hosts 将 github.com 指向 127.0.0.1（本机拦截），连接会自动走 ssh.github.com:443');
        if (withHint && keys.length === 0) notes.push('没有密钥也没关系：直接点「连接」，会自动生成一把新密钥');
        if (notes.length) hint().textContent = notes.join('；');
      } catch (err) {
        hint().textContent = '检测密钥失败：' + (err && err.message ? err.message : String(err));
      }
    };
    loadKeys(false);
    $('#ghDetectBtn').onclick = () => loadKeys(true);
    $('#ghBrowseBtn').onclick = async () => {
      try {
        const r = await api.ghPickKey();
        if (r && r.ok) $('#ghKeyPath').value = r.path;
      } catch (err) {
        hint().textContent = '选择文件失败：' + (err && err.message ? err.message : String(err));
      }
    };
    $('#ghConnectBtn').onclick = async () => {
      const custom = $('#ghKeyPath').value.trim();
      const selected = $('#ghKeySelect').value || '';
      const isContent = /-----BEGIN [A-Z0-9 ]+PRIVATE KEY-----/.test(custom) || custom.includes('\n');
      const keyPath = isContent ? '' : (custom || selected);
      const keyContent = isContent ? custom : '';
      hint().textContent = '正在连接…';
      try {
        const r = await api.ghConnect({ keyPath, keyContent });
        if (r.needRegister) { renderRegisterKey(r); return; }
        if (!r.ok) {
          hint().textContent = '连接失败：' + r.error;
          return;
        }
        ghUser = r;
        renderRepos();
      } catch (err) {
        // IPC 异常（主进程网络错误等）也要落地到提示，不能卡在"正在连接…"
        hint().textContent = '连接失败：' + (err && err.message ? err.message : String(err));
      }
    };
  }

  function renderRegisterKey(r) {
    dockBody.innerHTML = `
      <div class="dock-connect">
        <div class="dock-connect-icon">🔑</div>
        <div class="dock-connect-title">已自动生成新密钥</div>
        <div class="dock-connect-desc">把下面的公钥添加到 GitHub（一次性操作，之后永远一键连接）：</div>
        <textarea id="ghPubArea" class="sm-input dock-pub" readonly>${esc(r.pub)}</textarea>
        <div class="dock-row">
          <button class="primary-btn" id="ghCopyPubBtn">复制公钥</button>
          <button class="mini-btn" id="ghOpenKeysBtn">打开 GitHub 密钥设置</button>
        </div>
        <div class="dock-row">
          <button class="mini-btn" id="ghRetryBtn">我已添加，重试连接</button>
        </div>
        <div class="dock-hint" id="ghConnectHint"></div>
      </div>`;
    $('#ghCopyPubBtn').onclick = async () => {
      try {
        await navigator.clipboard.writeText(r.pub);
        $('#ghConnectHint').textContent = '公钥已复制，去 GitHub 粘贴保存';
      } catch {
        const ta = $('#ghPubArea');
        ta.select();
        document.execCommand('copy');
        $('#ghConnectHint').textContent = '公钥已复制，去 GitHub 粘贴保存';
      }
    };
    $('#ghOpenKeysBtn').onclick = () => api.ghOpenKeysPage();
    $('#ghRetryBtn').onclick = async () => {
      $('#ghConnectHint').textContent = '正在连接…';
      try {
        const retry = await api.ghConnect({ keyPath: r.keyPath });
        if (!retry.ok) { $('#ghConnectHint').textContent = '连接失败：' + retry.error; return; }
        ghUser = retry;
        renderRepos();
      } catch (err) {
        $('#ghConnectHint').textContent = '连接失败：' + (err && err.message ? err.message : String(err));
      }
    };
  }

  function accountHeader(extra) {
    return `<div class="dock-account">
      ${ghUser && ghUser.avatar ? `<img class="dock-avatar" src="${ghUser.avatar}" alt="" />` : '<div class="dock-avatar dock-avatar-ph">🐙</div>'}
      <div class="dock-account-info">
        <div class="dock-account-name">${esc(ghUser ? ghUser.name : '')}</div>
        <div class="dock-account-login">@${esc(ghUser ? ghUser.login : '')}</div>
        ${ghUser && ghUser.sshPort === 443 ? '<div class="dock-account-mode">SSH · 443 端口（ssh.github.com）</div>' : ''}
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
    const history = r.repos || [];
    const pubs = r.public || [];
    const allRepos = r.all || [];
    const repoCard = (x, removable) => `
      <div class="dock-repo" data-url="${esc(x.url)}">
        <div class="dock-repo-name">${x.private ? '🔒 ' : '📦 '}${esc(x.name)}</div>
        <div class="dock-repo-desc">${esc(x.description || x.url)}</div>
        <div class="dock-repo-meta">${esc(x.default_branch)}${x.updated_at ? ' · ' + esc((x.updated_at || '').slice(0, 10)) : ''}</div>
        ${removable ? `<button class="mini-btn dock-repo-del" data-url="${esc(x.url)}" title="从列表移除">✕</button>` : ''}
      </div>`;
    let html = accountHeader() + `
      <div class="dock-addrepo">
        <input id="ghRepoInput" class="sm-input" placeholder="owner/repo 或 git@github.com:…" style="width:100%;max-width:none" />
        <button class="primary-btn" id="ghRepoAddBtn">添加</button>
      </div>`;
    if (r.tokenSet) {
      // 已配置只读 Token：列出全部仓库（含私有）
      const privCount = allRepos.filter((x) => x.private).length;
      if (r.all !== null) {
        html += `<div class="dock-count">我的仓库（${allRepos.length}）${privCount ? ` · 🔒 ${privCount} 个私有` : ''} <button class="mini-btn" id="ghTokenEditBtn" style="float:right">移除 Token</button></div>` +
          (allRepos.length === 0
            ? '<div class="dock-empty">这个账户下没有仓库</div>'
            : allRepos.map((x) => repoCard(x, false)).join(''));
      } else if (r.listError) {
        html += `<div class="dock-hint">仓库列表加载失败：${esc(r.listError)}<br/><button class="mini-btn" id="ghTokenEditBtn" style="margin-top:6px">移除 Token</button></div>`;
      }
    } else {
      // 无 Token：匿名列出公开仓库 + 可选开关
      if (r.public !== null) {
        html += `<div class="dock-count">公开仓库（${pubs.length}）</div>` +
          (pubs.length === 0
            ? '<div class="dock-empty">没有公开仓库<br/>私有仓库可输入 <code>owner/repo</code> 添加，或点下方开关列出全部</div>'
            : pubs.map((x) => repoCard(x, false)).join(''));
      } else if (r.listError) {
        html += `<div class="dock-hint">公开仓库加载失败：${esc(r.listError)}（不影响手动添加仓库）</div>`;
      }
      html += `<div class="dock-token-toggle"><button class="mini-btn" id="ghTokenToggleBtn">🔑 让私有仓库也自动显示（可选）</button></div>`;
    }
    html += `<div class="dock-count">最近浏览（${history.length}）</div>` +
      (history.length === 0
        ? '<div class="dock-empty">私有仓库输入 <code>owner/repo</code> 或 <code>git@github.com:…</code> 即可添加</div>'
        : history.map((x) => repoCard(x, true)).join(''));
    dockBody.innerHTML = html;
    bindAccountActions();
    const tokenToggle = $('#ghTokenToggleBtn');
    if (tokenToggle) {
      tokenToggle.onclick = () => {
        let box = $('#ghTokenBox');
        if (box) { box.remove(); return; }
        tokenToggle.insertAdjacentHTML('afterend', `
          <div class="dock-token-box" id="ghTokenBox">
            <div class="dock-token-desc">在 github.com → Settings → Developer settings → Personal access tokens 生成一个 Token（勾选 <code>repo</code> 读取权限），粘贴到下面。仅用于列出私有仓库，连接仍是 SSH key。</div>
            <input id="ghTokenInput" class="sm-input" type="password" placeholder="ghp_…" style="width:100%;max-width:none" />
            <div class="dock-row">
              <button class="primary-btn" id="ghTokenSaveBtn">保存</button>
              <button class="mini-btn" id="ghTokenCancelBtn">取消</button>
            </div>
            <div class="dock-hint" id="ghTokenHint"></div>
          </div>`);
        $('#ghTokenCancelBtn').onclick = () => { const b = $('#ghTokenBox'); if (b) b.remove(); };
        $('#ghTokenSaveBtn').onclick = async () => {
          const t = $('#ghTokenInput').value.trim();
          const hintEl = $('#ghTokenHint');
          if (!t) { hintEl.textContent = '请先粘贴 Token'; return; }
          const btn = $('#ghTokenSaveBtn');
          btn.disabled = true;
          btn.textContent = '验证中…';
          try {
            const r = await api.ghSetListToken(t);
            if (!r.ok) {
              hintEl.textContent = '保存失败：' + r.error;
              btn.disabled = false;
              btn.textContent = '保存';
              return;
            }
            renderRepos();
          } catch (err) {
            hintEl.textContent = '保存失败：' + (err && err.message ? err.message : String(err));
            btn.disabled = false;
            btn.textContent = '保存';
          }
        };
      };
    }
    const tokenEdit = $('#ghTokenEditBtn');
    if (tokenEdit) {
      tokenEdit.onclick = async () => {
        await api.ghClearListToken();
        renderRepos();
      };
    }
    $('#ghRepoAddBtn').onclick = async () => {
      const input = $('#ghRepoInput').value.trim();
      if (!input) return;
      const btn = $('#ghRepoAddBtn');
      btn.disabled = true;
      btn.textContent = '验证中…';
      try {
        const r = await api.ghAddRepo(input);
        if (!r.ok) {
          dockBody.insertAdjacentHTML('beforeend', `<div class="dock-hint">${esc(r.error)}</div>`);
          btn.disabled = false;
          btn.textContent = '添加';
          return;
        }
        const url = r.repo.url;
        const name = url.replace(/^git@github\.com:/, '').replace(/\.git$/, '');
        ghNav = { url, owner: name.split('/')[0], repo: name.split('/')[1], defaultBranch: r.repo.default_branch };
        renderBranches();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = '添加';
        dockBody.insertAdjacentHTML('beforeend', `<div class="dock-hint">添加失败：${esc(err && err.message ? err.message : String(err))}</div>`);
      }
    };
    $('#ghRepoInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('#ghRepoAddBtn').click();
    });
    dockBody.querySelectorAll('.dock-repo').forEach((el) => {
      el.onclick = (e) => {
        if (e.target.closest('.dock-repo-del')) return;
        const url = el.dataset.url;
        const name = url.replace(/^git@github\.com:/, '').replace(/\.git$/, '');
        ghNav = { url, owner: name.split('/')[0], repo: name.split('/')[1], defaultBranch: null };
        renderBranches();
      };
    });
    dockBody.querySelectorAll('.dock-repo-del').forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        await api.ghRemoveRepo(btn.dataset.url);
        renderRepos();
      };
    });
  }

  async function renderBranches() {
    dockBody.innerHTML = `<div class="dock-breadcrumb">
        <button class="mini-btn" id="ghBackRepos">‹ 仓库</button>
        <span class="dock-crumb">${esc(ghNav.owner)}/${esc(ghNav.repo)}</span>
      </div><div class="dock-loading">正在读取分支…</div>`;
    $('#ghBackRepos').onclick = () => { ghNav = null; renderGithub(); };
    const r = await api.ghBranches(ghNav.url);
    if (!r.ok) { dockErr(r.error); return; }
    const branches = r.branches || [];
    ghNav.defaultBranch = r.defaultBranch || ghNav.defaultBranch;
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
      const r = await api.ghTree(ghNav.url, ghNav.branch);
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
