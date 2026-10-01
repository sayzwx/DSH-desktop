/**
 * 对话页上下文面板（context dock）：Todo / Plan / Goal / 队列 / 后台任务 / 产出文件。
 *
 * 这些状态都由 chat.js 从会话事件与 mux 帧里累积（见 handleSessionEvent 与 handleFrame），
 * 本模块只负责渲染与把用户动作回调出去，不自己订阅任何数据源——单一数据流向，
 * 避免面板与 chat.js 各持一份状态而对不上。
 *
 * 数据来源与语义：
 * - todos：`todo/write` 事件，全量快照 { todos:[{content,status}] }，最新写入覆盖旧的，
 *   因此回放历史与实时到达得到同一结果。
 * - planActive：`plan/mode` 事件的 { active }。
 * - goal：`goal/change` 事件。非 clear 的载荷是 { operation, goal, roundsStarted }，
 *   goal 为 { id, revision, objective, phase, blockedReason?, maxGoalRounds }；
 *   clear 的载荷是墓碑 { operation:'clear', cleared, clearedAt }，此时目标为空。
 *   所有变更动词都要带上当前 ref（CAS），冲突时用服务端返回的权威 ref 重试。
 * - queue：`session/queue` 帧的权威全量快照 { items:[{id,placement,message}] }。
 *   placement 决定渲染面：queued 进队列面板，steering 在会话尾部，context 在被认领前不可见。
 * - jobs：`session/jobs` 帧的全量快照。缺键表示空集，但"变空"这一次仍会推 []。
 * - turnFiles：上一个已完成回合里成功的文件变更，识别依据是渲染意图而不是工具名
 *   （diff 卡，或 kind 为 edit/delete/move 的 generic 卡），与官方 ui-deliverables 一致。
 *
 * 对外接口：window.__panels = { init, render }
 */
(function () {
  let ctx = null;

  function init(c) { ctx = c; }
  const esc = (s) => ctx.esc(s);
  const t = (key, params) => ctx.t(key, params);

  const TODO_ICON = { pending: '○', in_progress: '◐', completed: '●' };
  const JOB_STATUS_ICON = { running: '▶', stopping: '◼', completed: '✓', killed: '✕', failed: '⚠' };

  /** 目标 phase 的本地化标签；未知值原样显示，不编造翻译。 */
  function phaseLabel(phase) {
    const known = ['active', 'paused', 'blocked', 'complete', 'completed'];
    return known.includes(phase) ? t(`goal.phase.${phase === 'completed' ? 'complete' : phase}`) : String(phase || '');
  }

  /** 队列项的一行摘要：取消息里第一段文本。 */
  function queuePreview(message) {
    const content = message && Array.isArray(message.content) ? message.content : [];
    for (const b of content) {
      if (b && b.type === 'text' && b.text) return String(b.text).replace(/\s+/g, ' ').slice(0, 140);
    }
    return content.length > 0 ? t('queue.item.nonText', { n: content.length }) : '';
  }

  function elapsedText(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }

  function section(titleText, bodyEl, extraClass) {
    const box = document.createElement('div');
    box.className = 'cd-section' + (extraClass ? ` ${extraClass}` : '');
    const head = document.createElement('div');
    head.className = 'cd-head';
    head.textContent = titleText;
    box.appendChild(head);
    box.appendChild(bodyEl);
    return box;
  }

  function renderTodos(host, todos) {
    const done = todos.filter((x) => x.status === 'completed').length;
    const body = document.createElement('div');
    body.className = 'cd-todos';
    const progress = document.createElement('div');
    progress.className = 'cd-todo-progress';
    progress.textContent = t('panel.todo.progress', { done, total: todos.length });
    body.appendChild(progress);
    for (const item of todos) {
      const row = document.createElement('div');
      row.className = `cd-todo st-${item.status || 'pending'}`;
      row.innerHTML = `<span class="cd-todo-ic">${TODO_ICON[item.status] || TODO_ICON.pending}</span>`;
      const text = document.createElement('span');
      text.className = 'cd-todo-text';
      text.textContent = item.content || '';
      row.appendChild(text);
      body.appendChild(row);
    }
    host.appendChild(section(t('panel.todo.title'), body));
  }

  function renderGoal(host, goal) {
    const body = document.createElement('div');
    body.className = 'cd-goal';
    const obj = document.createElement('div');
    obj.className = 'cd-goal-objective';
    obj.textContent = goal.objective || '';
    body.appendChild(obj);
    const meta = document.createElement('div');
    meta.className = 'cd-goal-meta';
    meta.textContent = t('panel.goal.meta', {
      phase: phaseLabel(goal.phase),
      round: goal.roundsStarted || 0,
      max: goal.maxGoalRounds,
    });
    body.appendChild(meta);
    if (goal.blockedReason && goal.blockedReason.message) {
      const why = document.createElement('div');
      why.className = 'cd-goal-blocked';
      why.textContent = t('panel.goal.blocked', { reason: goal.blockedReason.message });
      body.appendChild(why);
    }
    const actions = document.createElement('div');
    actions.className = 'cd-actions';
    const ref = { id: goal.id, revision: goal.revision };
    const mk = (label, op, danger) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mini-btn' + (danger ? ' danger-btn' : '');
      b.textContent = label;
      b.onclick = () => ctx.onGoal(op, ref);
      actions.appendChild(b);
    };
    const paused = goal.phase === 'paused';
    mk(t('panel.goal.edit'), 'edit');
    mk(paused ? t('panel.goal.resume') : t('panel.goal.pause'), paused ? 'resume' : 'pause');
    mk(t('panel.goal.complete'), 'complete');
    mk(t('panel.goal.clear'), 'clear', true);
    body.appendChild(actions);
    host.appendChild(section(t('panel.goal.title'), body));
  }

  function renderQueue(host, items) {
    // placement 'context' 在被 agent 认领前对用户不可见，不进面板
    const visible = items.filter((it) => it.placement === 'queued' || it.placement === 'steering');
    if (visible.length === 0) return;
    const body = document.createElement('div');
    body.className = 'cd-queue';
    for (const item of visible) {
      const row = document.createElement('div');
      row.className = `cd-queue-item pl-${item.placement}`;
      const tag = document.createElement('span');
      tag.className = 'cd-queue-tag';
      tag.textContent = item.placement === 'steering' ? t('queue.placement.steering') : t('queue.placement.queued');
      row.appendChild(tag);
      const text = document.createElement('span');
      text.className = 'cd-queue-text';
      text.textContent = queuePreview(item.message);
      row.appendChild(text);
      const steer = document.createElement('button');
      steer.type = 'button';
      steer.className = 'mini-btn';
      steer.textContent = t('queue.action.steer');
      steer.title = t('queue.action.steerHint');
      steer.disabled = item.placement === 'steering';
      steer.onclick = () => ctx.onQueue(item.id, { kind: 'steer' });
      row.appendChild(steer);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'mini-btn danger-btn';
      del.textContent = t('queue.action.remove');
      del.onclick = () => ctx.onQueue(item.id, { kind: 'remove' });
      row.appendChild(del);
      body.appendChild(row);
    }
    host.appendChild(section(t('panel.queue.title', { n: visible.length }), body));
  }

  /**
   * 任务状态标签。生产者插件可以通过声明合并扩展状态集，所以这不是闭集：
   * 已知五种走 i18n，未知值原样显示而不是编一个翻译。
   */
  const JOB_STATUS_KNOWN = ['running', 'stopping', 'completed', 'killed', 'failed'];
  function jobStatusLabel(status) {
    return JOB_STATUS_KNOWN.includes(status) ? t(`job.status.${status}`) : String(status || '');
  }

  function renderJobs(host, jobs) {
    if (!jobs || jobs.length === 0) return;
    const body = document.createElement('div');
    body.className = 'cd-jobs';
    // 运行中的在前（按开始时间升序），已结束的在后（按结束时间降序）
    const live = jobs.filter((j) => j.status === 'running' || j.status === 'stopping');
    const settled = jobs.filter((j) => j.status !== 'running' && j.status !== 'stopping');
    const ordered = [
      ...live.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0)),
      ...settled.sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0)),
    ];
    const now = Date.now();
    for (const job of ordered) {
      const isLive = job.status === 'running' || job.status === 'stopping';
      const row = document.createElement('div');
      row.className = `cd-job ${isLive ? 'live' : 'settled'}`;
      row.innerHTML = `<span class="cd-job-ic">${JOB_STATUS_ICON[job.status] || '·'}</span>`
        + `<span class="cd-job-kind">${esc(job.kind || '')}</span>`;
      const label = document.createElement('span');
      label.className = 'cd-job-label';
      label.textContent = job.label || '';
      row.appendChild(label);
      const status = document.createElement('span');
      status.className = 'cd-job-status';
      // 生产者给出的 detail（如 "exit code: 3"）比通用状态词更具体，有就优先用它
      status.textContent = job.detail || jobStatusLabel(job.status);
      row.appendChild(status);
      const dur = document.createElement('span');
      dur.className = 'cd-job-dur';
      const end = isLive ? now : (job.finishedAt || now);
      dur.textContent = elapsedText(end - (job.startedAt || end));
      row.appendChild(dur);
      body.appendChild(row);
    }
    const liveCount = live.length;
    host.appendChild(section(
      liveCount > 0 ? t('panel.jobs.titleActive', { n: liveCount }) : t('panel.jobs.title'),
      body,
    ));
  }

  /** 文件类型 → 图标与配色类别（WorkBuddy 那套"图标 + 名字 + 体积"的卡片观感） */
  const FILE_KIND = [
    [/\.(png|jpe?g|webp|gif|bmp|svg|avif|ico)$/i, '🖼', 'img'],
    [/\.(mp4|mov|webm|mkv|avi)$/i, '🎬', 'vid'],
    [/\.(mp3|wav|flac|m4a|ogg)$/i, '🎵', 'aud'],
    [/\.(pdf)$/i, '📕', 'pdf'],
    [/\.(docx?|wps|odt|rtf)$/i, '📄', 'doc'],
    [/\.(xlsx?|csv|tsv|ods)$/i, '📊', 'sheet'],
    [/\.(pptx?|key)$/i, '📽', 'slide'],
    [/\.(zip|rar|7z|tar|gz|tgz)$/i, '🗜', 'zip'],
    [/\.(js|mjs|cjs|ts|tsx|jsx|css|scss|html|htm|json|ya?ml|toml|py|ps1|sh|bat|cmd|c|h|cpp|go|rs|java|rb|php|sql)$/i, '📜', 'code'],
    [/\.(md|txt|log|ini|conf)$/i, '📝', 'text'],
    [/\.(exe|msi|dmg|appimage|deb|rpm)$/i, '⚙', 'bin'],
  ];
  function fileMeta(name) {
    for (const [re, icon, kind] of FILE_KIND) if (re.test(name)) return { icon, kind };
    return { icon: '📄', kind: 'file' };
  }
  function humanSize(bytes) {
    if (typeof bytes !== 'number' || !isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1024) return bytes + ' B';
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = bytes / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return (v >= 100 ? Math.round(v) : v.toFixed(1)) + ' ' + units[i];
  }

  /**
   * 本回合产出的文件：**卡片**（图标 + 文件名 + 体积 + 操作），对齐 WorkBuddy 的产物样式。
   * 之前是一排纯文字小胶囊 + 一个"在文件夹中显示"，看不出是什么文件、多大、能干什么。
   * 体积是异步补的（主进程 stat），补不到就不显示那行 —— 不编造。
   */
  function renderTurnFiles(host, files) {
    if (!files || files.length === 0) return;
    const body = document.createElement('div');
    body.className = 'cd-files';
    const list = document.createElement('div');
    list.className = 'cd-file-list';
    body.appendChild(list);

    const cards = new Map();
    for (const p of files) {
      const name = String(p).split(/[\\/]/).pop();
      const meta = fileMeta(name);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'cd-file-card';
      card.dataset.path = p;
      card.title = p;
      card.innerHTML = `<span class="cd-file-icon kind-${meta.kind}">${meta.icon}</span>`
        + `<span class="cd-file-main"><b class="cd-file-name">${esc(name)}</b>`
        + `<small class="cd-file-meta"></small></span>`
        + `<span class="cd-file-acts">`
        + `<span class="cd-file-act" data-act="folder" title="${esc(t('panel.files.showInFolder'))}">↗</span>`
        + `<span class="cd-file-act" data-act="copy" title="${esc(t('panel.files.copyPath'))}">⧉</span>`
        + '</span>';
      card.onclick = async (e) => {
        const act = e.target.closest('[data-act]');
        if (act && act.getAttribute('data-act') === 'folder') { e.stopPropagation(); showInFolder(p); return; }
        if (act && act.getAttribute('data-act') === 'copy') { e.stopPropagation(); copyPath(p); return; }
        ctx.openPath(p);
      };
      // 右键：打开 / 打开文件夹 / 复制路径（与 WorkBuddy 的产物右键菜单一致的语义）
      card.oncontextmenu = (e) => {
        e.preventDefault();
        if (!window.__ctxMenu) return;
        window.__ctxMenu.open(e.clientX, e.clientY, [
          { label: t('panel.files.open'), onSelect: () => ctx.openPath(p) },
          { label: t('panel.files.showInFolder'), disabled: !canReveal(), onSelect: () => showInFolder(p) },
          { label: t('panel.files.copyPath'), onSelect: () => copyPath(p) },
          { separator: true },
          { label: t('panel.files.addToComposer'), title: t('panel.files.addToComposerHint'), onSelect: () => addToComposer(p) },
        ]);
      };
      list.appendChild(card);
      cards.set(p, card);
    }

    // 体积/时间异步补进来（失败就留空，不显示假数据）
    if (window.api && typeof window.api.filesStat === 'function') {
      const wanted = files.slice(0, 50);
      window.api.filesStat(wanted).then((r) => {
        for (const it of (r && r.items) || []) {
          const card = cards.get(it.path);
          if (!card) continue;
          const metaEl = card.querySelector('.cd-file-meta');
          if (!metaEl) continue;
          if (!it.ok) { metaEl.textContent = t('panel.files.missing'); card.classList.add('is-missing'); continue; }
          const when = it.mtime ? new Date(it.mtime) : null;
          const hhmm = when ? `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}` : '';
          metaEl.textContent = [humanSize(it.size), hhmm].filter(Boolean).join(' · ');
        }
      }).catch(() => { /* 补不到就不显示 */ });
    }

    const actions = document.createElement('div');
    actions.className = 'cd-files-actions';
    const folder = document.createElement('button');
    folder.type = 'button';
    folder.className = 'mini-btn cd-files-folder';
    folder.textContent = t('panel.files.showInFolder');
    folder.disabled = !ctx.sessionCwd || !ctx.canOpenPath;
    folder.onclick = () => ctx.openPath(ctx.sessionCwd);
    actions.appendChild(folder);
    body.appendChild(actions);
    host.appendChild(section(t('panel.files.title', { n: files.length }), body));
  }

  function canReveal() {
    return !!(window.api && typeof window.api.hostShowInFolder === 'function');
  }
  function showInFolder(p) {
    if (!canReveal()) { ctx.openPath(p.replace(/[\\/][^\\/]*$/, '')); return; }
    window.api.hostShowInFolder(p);
  }
  function copyPath(p) {
    try { navigator.clipboard?.writeText(p); } catch { /* ignore */ }
  }
  function addToComposer(p) {
    // 把产物路径塞进输入框（"添加到对话框"）：走 chat.js 暴露的引用注入
    const input = document.getElementById('chatInput');
    if (!input) return;
    input.value = (input.value ? input.value.replace(/\s*$/, ' ') : '') + p;
    input.focus();
    try { input.setSelectionRange(input.value.length, input.value.length); } catch { /* ignore */ }
  }

  /**
   * 渲染整个 dock。所有分区都为空时隐藏 dock 本身——不给用户一个空框。
   * @param state - { todos, planActive, goal, queue, jobs, turnFiles }
   */
  function render(state) {
    const host = ctx && ctx.host;
    if (!host) return;
    host.innerHTML = '';
    const s = state || {};
    if (s.todos && s.todos.length > 0) renderTodos(host, s.todos);
    if (s.goal) renderGoal(host, s.goal);
    if (s.queue && s.queue.length > 0) renderQueue(host, s.queue);
    if (s.jobs && s.jobs.length > 0) renderJobs(host, s.jobs);
    if (s.turnFiles && s.turnFiles.length > 0) renderTurnFiles(host, s.turnFiles);
    host.hidden = host.children.length === 0;
  }

  window.__panels = { init, render, phaseLabel };
})();
