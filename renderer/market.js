/* ============================================================
 * 星际插件市场（原生桌面页面）
 * 镜像 dshmarket 的 Web 端结构：发现 / 已安装 / 主题 / 备份与恢复。
 * 直连本机 Harness 的 /dsh-market/* HTTP 路由（loopback + Origin 校验
 * 由 main.js 的 market:* IPC 处理）。
 * 不跳转 Web UI —— 全部在桌面端内完成。
 * ============================================================ */
(function () {
  const page = document.getElementById('page-market');
  if (!page) return;
  const api = window.api;
  const $ = (s) => page.querySelector(s);
  const $$ = (s) => [...page.querySelectorAll(s)];

  const esc = (v) => String(v == null ? '' : v)
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------- 元素 ----------------
  const el = {
    subtitle: $('#mkSubtitle'),
    meta: $('#mkMeta'),
    channel: $('#mkChannel'),
    refresh: $('#mkRefresh'),
    exportLog: $('#mkExportLog'),
    progress: $('#mkProgress'),
    progressLabel: $('#mkProgressLabel'),
    progressFill: $('#mkProgressFill'),
    progressLine: $('#mkProgressLine'),
    cancel: $('#mkCancel'),
    restartBanner: $('#mkRestartBanner'),
    restartText: $('#mkRestartText'),
    restartApp: $('#mkRestartApp'),
    buildBanner: $('#mkBuildBanner'),
    buildText: $('#mkBuildText'),
    approveBuilds: $('#mkApproveBuilds'),
    errorBanner: $('#mkErrorBanner'),
    errorText: $('#mkErrorText'),
    errorClose: $('#mkErrorClose'),
    notReady: $('#mkNotReady'),
    notReadyText: $('#mkNotReadyText'),
    notReadyRetry: $('#mkNotReadyRetry'),
    tabs: $('#mkTabs'),
    body: $('#mkBody'),
    search: $('#mkSearch'),
    cats: $('#mkCats'),
    count: $('#mkCount'),
    grid: $('#mkGrid'),
    instCount: $('#mkInstCount'),
    updateAll: $('#mkUpdateAll'),
    instList: $('#mkInstList'),
    themeNote: $('#mkThemeNote'),
    themeGrid: $('#mkThemeGrid'),
    backupCols: $('#mkBackupCols'),
  };

  const S = {
    status: null,      // /dsh-market/status
    registry: null,    // /dsh-market/registry
    installed: null,   // /dsh-market/installed
    updates: null,     // /dsh-market/updates
    search: '',
    category: 'all',
    tab: 'discover',
    busy: false,
    restartNeeded: false,
    pendingBuild: null, // { type: 'install' | 'update', entry?, name?, force? }
    booted: false,
    pollTimer: null,
  };

  const modal = () => (window.__modal ? window.__modal : null);
  const alertBox = (msg, title) => (modal() ? modal().alert(msg, title) : window.alert(msg));
  const confirmBox = (msg, title, okText) => (modal() ? modal().confirm(msg, title, okText ? { okText } : undefined) : window.confirm(msg));

  const STATE_TXT = {
    live: { cls: 'ok', t: '已加载' },
    restart: { cls: 'warn', t: '重启后生效' },
    inert: { cls: 'dim', t: '普通依赖' },
    broken: { cls: 'danger', t: '异常' },
    missing: { cls: 'danger', t: '缺失' },
    disabled: { cls: 'dim', t: '已停用' },
  };

  const CAT_TXT = (code) => {
    const c = S.registry && S.registry.categories && S.registry.categories[code];
    if (!c) return code;
    return c.zh || c.en || code;
  };

  const descOf = (entry) => {
    if (!entry || !entry.description) return '';
    const d = entry.description;
    if (typeof d === 'string') return d;
    return d.zh || d.en || Object.values(d)[0] || '';
  };

  const instKey = (entry) => (entry && (entry.npm || entry.name)) || '';
  const installedOf = (entry) => {
    const k = instKey(entry);
    return (S.installed && k && S.installed.installed[k]) !== undefined;
  };
  const updateOf = (name) => (S.updates && S.updates[name]) || null;

  // ---------------- HTTP 层 ----------------
  async function get(path) {
    try { return await api.marketGet(path); } catch (e) { return { ok: false, error: e.message }; }
  }
  async function post(path, body) {
    try { return await api.marketPost(path, body || {}); } catch (e) { return { ok: false, error: e.message }; }
  }

  // ---------------- 状态 / 启停轮询 ----------------
  function setBusy(active, label) {
    S.busy = active;
    if (!active) {
      el.progress.hidden = true;
      if (S.pollTimer) { clearInterval(S.pollTimer); S.pollTimer = null; }
      return;
    }
    el.progress.hidden = false;
    if (label) el.progressLabel.textContent = label;
    el.progressFill.style.width = '0%';
    el.progressFill.classList.toggle('indet', true);
    el.progressLine.textContent = '';
    if (S.pollTimer) clearInterval(S.pollTimer);
    S.pollTimer = setInterval(pollProgress, 1200);
  }

  async function pollProgress() {
    const r = await get('/dsh-market/status');
    if (!r.ok || !r.data) return;
    const st = r.data;
    S.status = st;
    if (st.active) {
      const pct = st.total > 0 ? Math.min(100, Math.round((st.done / st.total) * 100)) : 0;
      el.progressFill.style.width = pct + '%';
      el.progressFill.classList.toggle('indet', !(st.total > 0));
      let line = st.lastLine || '';
      if (st.currentPackage) line = `${st.currentPackage}${line ? ' — ' + line : ''}`;
      el.progressLine.textContent = line;
      if (st.phase === 'install') el.progressLabel.textContent = '安装中…';
      else if (st.phase === 'update') el.progressLabel.textContent = '更新中…';
      else if (st.phase === 'uninstall') el.progressLabel.textContent = '卸载中…';
      else el.progressLabel.textContent = '操作进行中…';
    } else if (!st.busy && S.busy) {
      // 操作完成（route 返回后 post-processing 结束）
      setBusy(false);
    }
  }

  async function waitIdle(timeoutMs = 30000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const r = await get('/dsh-market/status');
      if (r.ok && r.data && !r.data.active && !r.data.busy) return true;
      await new Promise((r2) => setTimeout(r2, 1200));
    }
    return false;
  }

  // ---------------- 加载 ----------------
  async function probeMarket() {
    const hs = await api.getStatus().catch(() => null);
    const harnessRunning = !!(hs && (hs.state === 'running' || hs.webUp));
    const r = await get('/dsh-market/status');
    if (!harnessRunning) return { ok: false, reason: '请先启动 Harness 引擎。' };
    if (!r.ok) {
      if (r.status === 404) {
        // 市场插件未随引擎加载（dshmarket 缺失）→ 自动补装，装完需重启桌面端让引擎重新组合
        try {
          const ensure = await api.marketEnsure();
          if (ensure && ensure.ok) {
            return { ok: false, reason: '已自动安装市场插件（dshmarket）——请重启桌面端让引擎重新加载后使用。' };
          }
          if (ensure && ensure.needsRestart) {
            return { ok: false, reason: '市场插件已安装，需要重启桌面端后生效（设置 → 插件市场）。' };
          }
          return { ok: false, reason: '市场插件自动安装未完成：' + ((ensure && ensure.error) || '未知原因') + '，请检查网络后重试。' };
        } catch (e) {
          return { ok: false, reason: '市场插件自动安装出错：' + (e && e.message) };
        }
      }
      return { ok: false, reason: '市场服务应答异常：' + (r.error || ('HTTP ' + r.status)) };
    }
    return { ok: true, status: r.data };
  }

  async function loadAll(initial) {
    if (S.busy) return;
    el.meta.textContent = '正在同步市场…';
    try {
      const [st, reg, inst, up] = await Promise.all([
        get('/dsh-market/status'),
        get('/dsh-market/registry'),
        get('/dsh-market/installed'),
        get('/dsh-market/updates'),
      ]);
      if (!st.ok || !reg.ok || !inst.ok) {
        throw new Error((st.error || reg.error || inst.error) || '市场接口不可用');
      }
      S.status = st.data;
      S.registry = reg.data.registry || null;
      S.installed = inst.data || null;
      S.updates = (up.ok && up.data && up.data.updates) ? up.data.updates : {};
      el.meta.textContent = `市场 v${S.status.version} · profile「${S.status.profile || 'web'}」 · ${S.registry ? S.registry.count : 0} 个插件`;
      el.subtitle.textContent = `浏览 / 搜索 / 一键安装社区插件 · 管理已装插件与主题 · 备份恢复配置（市场服务 v${S.status.version}, 更新通道 ${S.status.channel}）`;
      el.channel.value = S.status.channel || 'stable';
      computeRestart();
      renderTabs();
      renderDiscover();
      renderInstalled();
      renderThemes();
      renderBackup();
    } catch (e) {
      showError(e.message || String(e));
    } finally {
      if (initial) hydrateBackup();
    }
  }

  function computeRestart() {
    let need = false;
    if (S.installed && S.installed.activation) {
      for (const k of Object.keys(S.installed.activation)) {
        if (S.installed.activation[k].state === 'restart') need = true;
      }
    }
    S.restartNeeded = need;
    el.restartBanner.hidden = !need;
  }

  function renderTabs() {
    el.tabs.hidden = false;
    el.body.hidden = false;
    $$('.mk-tab').forEach((b) => b.classList.toggle('active', b.dataset.mktab === S.tab));
    $$('.mk-panel').forEach((p) => p.classList.toggle('active', p.dataset.mkpanel === S.tab));
  }

  // ---------------- 发现页 ----------------
  function filteredEntries() {
    const list = (S.registry && S.registry.plugins) || [];
    const q = S.search.trim().toLowerCase();
    return list.filter((e) => {
      if (S.category !== 'all' && e.category !== S.category) return false;
      if (!q) return true;
      const hay = [e.name, e.npm, e.owner, descOf(e)].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function renderCats() {
    let html = `<button type="button" class="mk-cat${S.category === 'all' ? ' active' : ''}" data-cat="all">全部</button>`;
    const cats = (S.registry && S.registry.categories) || {};
    const counts = {};
    for (const p of S.registry.plugins || []) counts[p.category] = (counts[p.category] || 0) + 1;
    for (const code of Object.keys(cats)) {
      html += `<button type="button" class="mk-cat${S.category === code ? ' active' : ''}" data-cat="${esc(code)}" title="${esc(cats[code].en)}">${esc(cats[code].zh || cats[code].en || code)}${counts[code] != null ? ' ' + counts[code] : ''}</button>`;
    }
    el.cats.innerHTML = html;
    el.cats.querySelectorAll('.mk-cat').forEach((b) => b.addEventListener('click', () => {
      S.category = b.dataset.cat;
      renderCats();
      renderDiscover();
    }));
  }

  function renderDiscover() {
    if (!S.registry) return;
    renderCats();
    const list = filteredEntries();
    el.count.textContent = `共 ${list.length} 个插件${S.category !== 'all' ? '（' + CAT_TXT(S.category) + '）' : ''}`;
    if (list.length === 0) {
      el.grid.innerHTML = '<div class="empty" style="grid-column:1/-1">没有匹配的插件</div>';
      return;
    }
    let html = '';
    for (const e of list) {
      const key = instKey(e);
      const installed = installedOf(e);
      const upd = installed ? updateOf(key) : null;
      const hasUpd = !!(installed && upd && upd.updateAvailable);
      const catName = CAT_TXT(e.category);
      const stars = e.stars ? `<span class="mk-badge mk-badge-star">★ ${e.stars}</span>` : '';
      const dl = e.downloads ? `<span class="mk-badge">⬇ ${e.downloads}</span>` : '';
      html += `<div class="mk-card" data-key="${esc(key)}">
        <div class="mk-card-head">
          <div class="mk-card-name">${esc(e.name)}</div>
          <div class="mk-card-owner">@${esc(e.owner)}</div>
        </div>
        <div class="mk-card-desc">${esc(descOf(e) || '（无描述）')}</div>
        <div class="mk-card-tags"><span class="mk-badge">${esc(catName)}</span>${stars}${dl}${hasUpd ? '<span class="mk-badge mk-badge-up">↑ 有新版本</span>' : ''}</div>
        <div class="mk-card-actions">
          ${installed
            ? `<span class="mk-installed-tag">✓ 已安装</span>${hasUpd ? `<button type="button" class="primary-btn mk-btn-upd" data-name="${esc(key)}">更新</button>` : '<button type="button" class="mini-btn mk-btn-ver" disabled>' + esc((upd && upd.version) || '') + '</button>'}`
            : `<button type="button" class="primary-btn mk-btn-inst" data-url="${esc(e.url)}">安装</button>`}
        </div>
      </div>`;
    }
    el.grid.innerHTML = html;
    el.grid.querySelectorAll('.mk-btn-inst').forEach((b) => b.addEventListener('click', () => installByUrl(b.dataset.url, b)));
    el.grid.querySelectorAll('.mk-btn-upd').forEach((b) => b.addEventListener('click', () => updateByName(b.dataset.name, b)));
  }

  // ---------------- 已安装页 ----------------
  function renderInstalled() {
    if (!S.installed) return;
    const installed = S.installed.installed || {};
    const names = Object.keys(installed);
    const updatable = names.filter((n) => { const u = S.updates && S.updates[n]; return u && u.updateAvailable; });
    el.instCount.textContent = `已安装 ${names.length} 个包 · ${updatable.length} 个可更新`;
    el.updateAll.disabled = updatable.length === 0;
    if (names.length === 0) {
      el.instList.innerHTML = '<div class="empty">尚未安装任何社区插件</div>';
      return;
    }
    let html = '';
    for (const name of names.sort()) {
      const spec = installed[name];
      const act = (S.installed.activation && S.installed.activation[name]) || null;
      const st = act ? (STATE_TXT[act.state] || { cls: 'dim', t: act.state }) : { cls: 'dim', t: '未知' };
      const u = S.updates && S.updates[name];
      const ver = (u && u.version) || spec;
      const isSelf = name === 'dshmarket' || name === 'dsh-market';
      const off = (act && act.state === 'disabled') || (S.installed.disabled || []).includes(name)
        || (S.installed.patchDisabled || []).includes(name);
      const canToggle = !isSelf;
      const updAvailable = !!(u && u.updateAvailable);
      const channelNote = u && u.channelSwitch ? `（通道切换：${u.channelSwitch}）` : '';
      html += `<div class="mk-row" data-name="${esc(name)}">
        <div class="mk-row-main">
          <div class="mk-row-name">${esc(name)} ${isSelf ? '<span class="mk-badge mk-badge-self">市场本体</span>' : ''}</div>
          <div class="mk-row-meta">${esc(spec)} · v${esc(ver || '?')} <span class="mk-state mk-state-${st.cls}">${esc(st.t)}</span>${channelNote}</div>
        </div>
        <div class="mk-row-actions">
          ${canToggle ? `<label class="mk-switch" title="${off ? '启用' : '停用'} ${esc(name)}"><input type="checkbox" data-toggle="${esc(name)}" ${off ? '' : 'checked'} /><span></span></label>` : ''}
          ${updAvailable ? `<button type="button" class="primary-btn mk-btn-upd" data-name="${esc(name)}">更新</button>` : ''}
          ${!isSelf ? `<button type="button" class="mini-btn mk-btn-rem" data-name="${esc(name)}">卸载</button>` : ''}
        </div>
      </div>`;
    }
    el.instList.innerHTML = html;
    el.instList.querySelectorAll('.mk-btn-upd').forEach((b) => b.addEventListener('click', () => updateByName(b.dataset.name, b)));
    el.instList.querySelectorAll('.mk-btn-rem').forEach((b) => b.addEventListener('click', () => uninstallByName(b.dataset.name, b)));
    el.instList.querySelectorAll('input[data-toggle]').forEach((cb) => cb.addEventListener('change', () => togglePlugin(cb.dataset.toggle, cb.checked)));
  }

  // ---------------- 主题页 ----------------
  function renderThemes() {
    if (!S.registry) return;
    const themes = S.registry.plugins.filter((p) => p.category === 'theme');
    el.themeNote.textContent = `共 ${themes.length} 款社区主题；已安装的主题可直接「启用 / 停用」（同一时间仅一款主题生效）。`;
    if (themes.length === 0) { el.themeGrid.innerHTML = '<div class="empty">目录中暂无主题</div>'; return; }
    let html = '';
    for (const e of themes) {
      const key = instKey(e);
      const installed = installedOf(e);
      const act = installed && S.installed.activation && S.installed.activation[key];
      const live = !!(act && act.state === 'live');
      html += `<div class="mk-card">
        <div class="mk-card-head"><div class="mk-card-name">${esc(e.name)}</div><div class="mk-card-owner">@${esc(e.owner)}</div></div>
        <div class="mk-card-desc">${esc(descOf(e) || '（无描述）')}</div>
        <div class="mk-card-tags"><span class="mk-badge">主题</span>${e.stars ? `<span class="mk-badge mk-badge-star">★ ${e.stars}</span>` : ''}</div>
        <div class="mk-card-actions">
          ${installed
            ? (live ? '<button type="button" class="mini-btn mk-btn-themeoff" data-name="' + esc(key) + '">停用</button>'
                   : '<button type="button" class="primary-btn mk-btn-themeon" data-name="' + esc(key) + '">启用</button>')
            : `<button type="button" class="primary-btn mk-btn-inst" data-url="${esc(e.url)}">安装</button>`}
        </div>
      </div>`;
    }
    el.themeGrid.innerHTML = html;
    el.themeGrid.querySelectorAll('.mk-btn-inst').forEach((b) => b.addEventListener('click', () => installByUrl(b.dataset.url, b)));
    el.themeGrid.querySelectorAll('[data-name]').forEach((b) => b.addEventListener('click', () => togglePlugin(b.dataset.name, b.classList.contains('mk-btn-themeon'))));
  }

  // ---------------- 备份与恢复页 ----------------
  function backupSummary(b) {
    if (!b) return '';
    const files = (b.files || []).length;
    return `profile「${b.profile || '?'}」· ${files} 个文件 · 创建于 ${b.createdAt ? new Date(b.createdAt).toLocaleString('zh-CN', { hour12: false }) : '?'}`;
  }

  async function restoreBackup(backup, srcLabel) {
    if (!backup || typeof backup !== 'object') { alertBox('备份内容无效。', '恢复'); return; }
    const ok = await confirmBox(`即将从「${srcLabel}」恢复插件配置：${backupSummary(backup)}\n\n恢复会与当前 profile 合并（同名依赖以备份为准，其余保留），随后自动执行安装。确认继续？`, '恢复确认', '确认恢复');
    if (!ok) return;
    await runOp('恢复中…', async () => {
      const r = await post('/dsh-market/restore', { backup });
      if (!r.ok) throw new Error((r.data && r.data.error) || r.error || ('HTTP ' + r.status));
      await waitIdle();
      const rr = r.data;
      if (rr.errors && rr.errors.length) alertBox(`恢复完成，但 ${rr.errors.length} 个包安装失败：\n` + rr.errors.map((x) => `${x.name}: ${x.error}`).slice(0, 8).join('\n'), '恢复结果');
      else alertBox(`恢复完成：${rr.files || 0} 个文件已就位。`, '恢复结果');
    });
  }

  function renderBackup() {
    const card = (title, body) => `<div class="mk-backup-card"><div class="mk-backup-title">${title}</div>${body}</div>`;
    let html = '';
    html += card('💾 本地文件', `<div class="meta">导出当前 profile 的插件与配置清单；或从备份文件导入（导入后会先预览再确认恢复）。</div>
      <div class="mk-bk-actions">
        <button type="button" class="primary-btn" id="mkBkLocalExport">导出备份</button>
        <button type="button" class="mini-btn" id="mkBkLocalImport">导入并预览</button>
      </div>`);
    html += card('☁️ WebDAV', `<div class="meta">备份 / 恢复走 WebDAV（如坚果云）：填 URL 与账号密码即可。</div>
      <div class="mk-bk-field"><input id="mkBkDavUrl" type="text" placeholder="https://dav…/path" spellcheck="false" /></div>
      <div class="mk-bk-field"><input id="mkBkDavUser" type="text" placeholder="用户名" /></div>
      <div class="mk-bk-field"><input id="mkBkDavPass" type="password" placeholder="密码" /></div>
      <div class="mk-bk-actions">
        <button type="button" class="primary-btn" id="mkBkDavPush">备份上传</button>
        <button type="button" class="mini-btn" id="mkBkDavPreview">预览远程并恢复</button>
      </div>`);
    html += card('🐙 GitHub Gist', `<div class="meta">备份 / 恢复走 Gist：填 GitHub Token（选填，留空用环境凭据）与 Gist ID。</div>
      <div class="mk-bk-field"><input id="mkBkGistToken" type="password" placeholder="GitHub Token（可为空）" /></div>
      <div class="mk-bk-field"><input id="mkBkGistId" type="text" placeholder="Gist ID（新建时留空）" spellcheck="false" /></div>
      <div class="mk-bk-actions">
        <button type="button" class="primary-btn" id="mkBkGistPush">导出到 Gist</button>
        <button type="button" class="mini-btn" id="mkBkGistPreview">从 Gist 预览</button>
      </div>`);
    el.backupCols.innerHTML = html;

    const $bk = (id) => document.getElementById(id);
    $bk('mkBkLocalExport').addEventListener('click', async () => {
      const r = await api.marketBackup();
      if (r && r.ok) alertBox(`已导出备份：${r.path}`, '导出备份');
      else alertBox((r && r.error) || '导出失败（若已取消则忽略）。', '导出备份');
    });
    $bk('mkBkLocalImport').addEventListener('click', async () => {
      const r = await api.marketPickBackup();
      if (!r || !r.ok) return;
      await restoreBackup(r.data, r.path);
    });
    const dav = () => ({ url: ($bk('mkBkDavUrl').value || '').trim(), username: ($bk('mkBkDavUser').value || '').trim(), password: $bk('mkBkDavPass').value || '' });
    $bk('mkBkDavPush').addEventListener('click', async () => {
      const d = dav();
      if (!d.url) { alertBox('请填写 WebDAV 地址。', 'WebDAV'); return; }
      await runOp('备份上传中…', async () => {
        const r = await post('/dsh-market/webdav', { action: 'backup', ...d });
        if (!r.ok) throw new Error((r.data && r.data.error) || r.error || ('HTTP ' + r.status));
      });
    });
    $bk('mkBkDavPreview').addEventListener('click', async () => {
      const d = dav();
      if (!d.url) { alertBox('请填写 WebDAV 地址。', 'WebDAV'); return; }
      const r = await post('/dsh-market/webdav', { action: 'restore', ...d });
      if (!r.ok) { alertBox((r.data && r.data.error) || r.error || '无法获取远程备份。', 'WebDAV'); return; }
      await restoreBackup(r.data && r.data.backup, 'WebDAV');
    });
    $bk('mkBkGistPush').addEventListener('click', async () => {
      const token = $bk('mkBkGistToken').value.trim() || undefined;
      const gistId = $bk('mkBkGistId').value.trim();
      const r = await post('/dsh-market/gist', { action: 'export', token, gistId, includeConfig: false });
      if (!r.ok) { alertBox((r.data && (r.data.error || r.data.reason)) || r.error || '导出失败。', 'Gist'); return; }
      alertBox(`已导出到 Gist：${r.data.gistUrl}`, 'Gist');
    });
    $bk('mkBkGistPreview').addEventListener('click', async () => {
      const token = $bk('mkBkGistToken').value.trim() || undefined;
      const gistId = $bk('mkBkGistId').value.trim();
      if (!gistId) { alertBox('请填写 Gist ID。', 'Gist'); return; }
      const r = await post('/dsh-market/gist', { action: 'import', token, gistId });
      if (!r.ok) { alertBox((r.data && (r.data.error || r.data.reason)) || r.error || '无法读取 Gist。', 'Gist'); return; }
      await restoreBackup(r.data && r.data.backup, `Gist ${gistId.slice(0, 8)}`);
    });
  }

  // 初次打开时才渲染备份表单，避免未渲染时绑定 DOM 不存在（renderBackup 每次重建监听）
  function hydrateBackup() { /* renderBackup 已重建绑定；保留钩子便于未来扩展 */ }

  // ---------------- 变更操作 ----------------
  function showError(msg) {
    el.errorText.textContent = msg || '未知错误';
    el.errorBanner.hidden = false;
  }

  async function runOp(label, fn) {
    if (S.busy) { alertBox('已有操作进行中，请稍候。', '插件市场'); return; }
    setBusy(true, label);
    try {
      await fn();
    } catch (e) {
      const msg = (e && e.message) || String(e);
      const handled = handleOpFailure(msg);
      if (handled) showError(msg);
    } finally {
      setBusy(false);
      S.pendingBuild = null;
      hideBuildBanner();
      await reloadAll();
    }
  }

  function handleOpFailure(msg) { return true; }

  function handleOpResult(r, actionLabel) {
    // 处理操作响应中的阻塞构建 / 错误提示
    const data = r.data;
    if (!r.ok) {
      const err = ((data && data.error) || r.error || ('HTTP ' + r.status)) + '';
      throw new Error(err.length > 700 ? err.slice(0, 700) + '…' : err);
    }
    if (Array.isArray(data && data.ignoredBuilds) && data.ignoredBuilds.length) {
      const pkgs = data.ignoredBuilds;
      el.buildText.textContent = `${actionLabel}：以下依赖包需要构建（默认被 pnpm 拦截）：${pkgs.join(', ')}。点「允许构建并重试」即可放行，然后重新点「安装 / 更新」。`;
      el.buildBanner.hidden = false;
      S.pendingBuild = pkgs;
    }
    if (data && data.errors && data.errors.length) {
      alertBox(data.errors.map((x) => `${x.name}: ${x.error}`).slice(0, 8).join('\n'), actionLabel + '（部分失败）');
    }
    if (data && data.restart) S.restartNeeded = true;
    return data;
  }

  function hideBuildBanner() { el.buildBanner.hidden = true; }

  async function installByUrl(url, btn) {
    if (S.busy) return;
    await runOp('安装中…', async () => {
      btn && (btn.disabled = true);
      const r = await post('/dsh-market/install', { url });
      handleOpResult(r, '安装');
      if (r.data && r.data.ok) await waitIdle();
    });
  }

  async function updateByName(name, btn, force) {
    if (S.busy) return;
    await runOp('更新中…', async () => {
      btn && (btn.disabled = true);
      const r = await post('/dsh-market/update', { name, force: !!force });
      const data = r.data;
      if (data && data.stale) {
        // pnpm 对新发布版本默认等满一天（安全窗口）：给「立即更新」选项（202 之外的 502 也带着 stale 标记）
        const again = await confirmBox(`${data.error}\n\n是否立即更新（跳过安全等待）？`, '更新', '立即更新');
        await waitIdle();
        if (again) await doForceUpdate(name);
        return;
      }
      handleOpResult(r, `更新 ${name}`);
      if (data && data.ok) await waitIdle();
    });
  }

  async function doForceUpdate(name) {
    const r = await post('/dsh-market/update', { name, force: true });
    handleOpResult(r, `更新 ${name}（强制）`);
    if (r.data && r.data.ok) await waitIdle();
  }

  async function uninstallByName(name, btn) {
    if (S.busy) return;
    const ok = await confirmBox(`卸载插件「${name}」？\n将从 profile 移除并停止加载。`, '卸载', '确认卸载');
    if (!ok) return;
    await runOp('卸载中…', async () => {
      btn && (btn.disabled = true);
      const r = await post('/dsh-market/uninstall', { name });
      const data = handleOpResult(r, `卸载 ${name}`);
      if (data && data.ok) await waitIdle();
    });
  }

  async function togglePlugin(name, enabled) {
    if (S.busy) return;
    await runOp(enabled ? '启用中…' : '停用中…', async () => {
      const r = await post('/dsh-market/toggle', { name, enabled });
      const data = handleOpResult(r, `${enabled ? '启用' : '停用'} ${name}`);
      if (data && data.restart) S.restartNeeded = true;
    });
  }

  async function updateAll() {
    if (S.busy) return;
    const names = Object.keys(S.updates || {}).filter((n) => { const u = S.updates && S.updates[n]; return u && u.updateAvailable; });
    if (names.length === 0) { alertBox('当前没有可更新的插件。', '全部更新'); return; }
    const okc = await confirmBox(`将按顺序更新 ${names.length} 个插件：\n${names.join('、')}\n\n继续？`, '全部更新', '开始更新');
    if (!okc) return;
    setBusy(true, '全部更新中…');
    try {
      for (const name of names) {
        if (!(S.updates[name] && S.updates[name].updateAvailable)) continue;
        el.progressLabel.textContent = `更新 ${name}…`;
        try {
          const r = await post('/dsh-market/update', { name });
          const data = r.data;
          if (data && data.stale) { alertBox(`${data.error}\n\n本次跳过该插件，可稍后单独更新。`, '全部更新'); continue; }
          handleOpResult(r, `更新 ${name}`);
          await waitIdle();
        } catch (e) {
          showError(`更新 ${name} 失败：${e.message}`);
          break;
        }
        await reloadQuiet('updates');
      }
    } finally {
      setBusy(false);
      await reloadAll();
    }
  }

  async function reloadQuiet(what) {
    if (what === 'updates') {
      const up = await get('/dsh-market/updates');
      if (up.ok && up.data && up.data.updates) S.updates = up.data.updates;
    }
  }

  async function reloadAll() {
    const inst = await get('/dsh-market/installed');
    if (inst.ok && inst.data) S.installed = inst.data;
    const up = await get('/dsh-market/updates');
    if (up.ok && up.data && up.data.updates) S.updates = up.data.updates;
    computeRestart();
    renderDiscover();
    renderInstalled();
    renderThemes();
  }

  // ---------------- 事件绑定 ----------------
  function bindEvents() {
    // 标签页
    $$('.mk-tab').forEach((b) => b.addEventListener('click', () => {
      S.tab = b.dataset.mktab;
      renderTabs();
      if (S.tab === 'backup') renderBackup();
      if (S.tab === 'discover') renderDiscover();
    }));
    el.search.addEventListener('input', () => {
      S.search = el.search.value;
      renderDiscover();
    });
    el.refresh.addEventListener('click', async () => {
      el.meta.textContent = '正在刷新…';
      await loadAll(false);
      if (S.tab === 'backup') renderBackup();
    });
    el.cancel.addEventListener('click', async () => {
      const r = await post('/dsh-market/cancel', {});
      if (r.ok) alertBox('已请求取消当前操作。', '插件市场');
      else alertBox((r.data && r.data.error) || r.error || '取消失败。', '插件市场');
    });
    el.restartApp.addEventListener('click', async () => {
      const ok = await confirmBox('重启将关闭并重新启动桌面端应用，当前对话会话会短暂中断。继续？', '重启桌面端', '立即重启');
      if (!ok) return;
      try { await api.relaunchApp(); } catch (e) { alertBox('重启失败：' + (e && e.message), '重启桌面端'); }
    });
    el.approveBuilds.addEventListener('click', async () => {
      if (!S.pendingBuild || !S.pendingBuild.length) return;
      const pkgs = S.pendingBuild;
      hideBuildBanner();
      const r = await post('/dsh-market/approve-builds', { packages: pkgs });
      if (!r.ok) { showError((r.data && r.data.error) || r.error || '允许构建失败。'); return; }
      // 重新执行挂起的安装/更新（能自动重试的入口）
      alertBox(`已放行：${pkgs.join(', ')}。请再次点击对应的「安装 / 更新」按钮重试。`, '允许构建');
    });
    el.errorClose.addEventListener('click', () => { el.errorBanner.hidden = true; });
    el.notReadyRetry.addEventListener('click', () => boot());
    el.exportLog.addEventListener('click', async () => {
      const r = await api.marketLogExport();
      if (r && r.ok) alertBox(`已导出日志：${r.path}`, '导出日志');
      else alertBox((r && r.error) || '导出失败。', '导出日志');
    });
    el.channel.addEventListener('change', async () => {
      const ch = el.channel.value;
      const r = await post('/dsh-market/channel', { channel: ch });
      if (r.ok) {
        el.meta.textContent = `市场更新通道已设为 ${ch}`;
        const up = await get('/dsh-market/updates');
        if (up.ok && up.data && up.data.updates) S.updates = up.data.updates;
        renderInstalled();
      } else {
        alertBox((r.data && r.data.error) || r.error || '设置通道失败。', '更新通道');
        el.channel.value = (S.status && S.status.channel) || 'stable';
      }
    });
  }

  // ---------------- 启动 ----------------
  async function boot() {
    const p = await probeMarket();
    if (!p.ok) {
      el.notReady.hidden = false;
      el.notReadyText.textContent = p.reason;
      el.tabs.hidden = true;
      el.body.hidden = true;
      return;
    }
    el.notReady.hidden = true;
    el.tabs.hidden = false;
    el.body.hidden = false;
    await loadAll(!S.booted);
    S.booted = true;
  }

  // 页面切到市场时自动加载
  const navMarket = document.getElementById('navMarket');
  navMarket && navMarket.addEventListener('click', () => {
    if (el.notReady.hidden === false || S.status === null || S.registry === null) boot();
    else if (S.tab === 'backup') renderBackup();
  });

  bindEvents();
  boot();
})();
