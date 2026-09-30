/* theme-studio.js —— 主题工作室：把插件市场里的 WebUI 主题包迁移成桌面端主题
 *
 * 为什么需要这个界面：插件市场里的主题包都是**面向 WebUI** 的（覆盖 Web 端的
 * --dsw-* 设计 token、选择器写的是 WebUI 的 CSS-Module 类名）。桌面端是独立的
 * Electron 界面，有自己的 styles.css 与 --accent 等变量，两者原本没有任何样式通道，
 * 所以「装了但桌面端没反应」是必然的，不是装失败。
 *
 * 这里给出两条路径，都落在市场页的「主题」标签下：
 *   ① 免费确定性迁移 —— 主进程静态解析主题包（token 双档 + 结构层形状意图 +
 *      可验证的类名翻译），不调用任何模型。
 *   ② 可选的模型精修 —— 用用户已配置的模型分析主题包源码，补译翻译表没收录的规则、
 *      在档位语义错配时派生可用的强调色、并给出行为层「哪些能承接 / 哪些不能」的结论。
 *      这一步会产生模型费用，所以由用户逐个方案自行决定。
 *
 * 渲染层只做显示与选择；解析、映射、净化全在主进程（lib/web-themes.js、
 * lib/theme-analysis.js），密钥以「引用名」形式传递，明文不回渲染进程。
 */
(() => {
  const api = window.api;
  const $ = (s) => document.querySelector(s);

  /** 状态：扫描结果 / 已迁移清单 / 可选模型路由 */
  const S = {
    scan: null,
    routes: [],
    route: '',
    model: '',
    installed: [],
    busy: false,
    migrated: null,     // 最后一次免费迁移的产物（预览用）
    lastAnalysis: null,
  };

  const MODEL_KEY = 'dsh-theme-studio-model';
  const ROUTE_KEY = 'dsh-theme-studio-route';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** 本地绝对路径 → file:// URL（skin 预览图是插件目录里的绝对路径，直接放 src 会失效）。 */
  function escAttrUrl(p) {
    const u = String(p == null ? '' : p).replace(/\\/g, '/');
    return 'file:///' + encodeURI(u).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function toast(msg, kind) {
    if (window.__modal && kind === 'error') { window.__modal.alert(msg, '主题工作室'); return; }
    let el = document.getElementById('tsToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tsToast';
      el.className = 'ts-toast';
      document.body.appendChild(el);
    }
    el.className = 'ts-toast' + (kind ? ' ts-toast-' + kind : '');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(el.__t);
    el.__t = setTimeout(() => { el.hidden = true; }, 4200);
  }

  function confirmBox(msg, title, okLabel) {
    return window.__modal
      ? window.__modal.confirm(msg, title, okLabel)
      : Promise.resolve(window.confirm(msg));
  }

  // ---------------------------------------------------------------- 数据

  async function loadAll(force) {
    const [scan, routes, list] = await Promise.all([
      api.themeScan(),
      S.routes.length && !force ? Promise.resolve({ ok: true, routes: S.routes }) : api.themeRoutes(),
      api.themeList(),
    ]);
    S.scan = scan && scan.ok ? scan : { ok: false, plugins: [], skipped: [], error: scan && scan.error };
    S.installed = (list && list.ok && Array.isArray(list.themes)) ? list.themes : [];
    if (routes && routes.ok) S.routes = routes.routes || [];
    S.routesError = routes && !routes.ok ? routes.error : null;
    // 恢复上次选的模型 / 路由
    S.route = localStorage.getItem(ROUTE_KEY) || (S.routes[0] && S.routes[0].provider) || '';
    if (!S.routes.some((r) => r.provider === S.route)) S.route = (S.routes[0] && S.routes[0].provider) || '';
    S.model = localStorage.getItem(MODEL_KEY) || '';
  }

  function routeOf(id) { return S.routes.find((r) => r.provider === id); }

  function installedIdsOf(pluginId) {
    return new Set(S.installed
      .filter((t) => t.origin && t.origin.plugin === pluginId)
      .map((t) => `${t.origin.scheme}:${t.origin.tone}`));
  }

  // ---------------------------------------------------------------- 渲染

  function render() {
    const box = $('#tsBody');
    if (!box) return;
    if (!S.scan || !S.scan.ok) {
      box.innerHTML = `<div class="empty">扫描失败：${esc((S.scan && S.scan.error) || '未知错误')}</div>`;
      return;
    }
    const plugins = S.scan.plugins || [];
    if (plugins.length === 0) {
      box.innerHTML = `<div class="empty">本机已安装的插件里没有可识别的主题包。<br>
        <span class="meta">两条路：① 到「主题」标签的卡片上点「迁移到桌面端」（会自动先安装再迁移）；
        ② 先在「发现」标签安装主题（例如 <code>dsh-neo-skin</code>），装完回到这里点「重新扫描」。</span></div>`
        + renderSkipped();
      return;
    }
    box.innerHTML = renderModelBar()
      + `<div class="ts-store-meta">已迁移到桌面端：<b>${S.installed.length}</b> 个主题`
      + (S.installed.length ? ` · <a href="#" id="tsRevealStore">打开主题库文件</a>` : '')
      + ` · 插件扫描目录：<code>${esc((S.scan.roots || []).join(' | '))}</code></div>`
      + plugins.map(renderPlugin).join('')
      + renderSkipped();
  }

  function renderModelBar() {
    if (S.routes.length === 0) {
      return `<div class="ts-modelbar ts-modelbar-warn">
        <span>可选：用模型做兼容精修 —— 需要先有可用的模型路由。</span>
        <span class="meta">${esc(S.routesError || '未读取到「端点地址 + 模型」都齐全的已配置路由；请到「设置 → 模型配置」添加并启用一个提供商，并启动 Harness。')}</span>
      </div>`;
    }
    const r = routeOf(S.route);
    const models = (r && r.models) || [];
    if (!S.model || models.indexOf(S.model) < 0) S.model = models[0] || '';
    const opts = (sel, list) => list.map((v) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');
    return `<div class="ts-modelbar">
      <span class="ts-modelbar-label">模型精修用的模型</span>
      <select id="tsRoute" class="ct-inline-select">${opts(S.route, S.routes.map((x) => x.provider))}</select>
      <select id="tsModelSel" class="ct-inline-select">${opts(S.model, models)}</select>
      <span class="meta">${r && r.hasKey === false
        ? '<b class="ts-warn">该路由的密钥引用未配置</b> —— 精修会失败'
        : (r && r.hasKey ? '密钥已配置 ✓' : '无需密钥')}</span>
    </div>`;
  }

  function renderPlugin(p) {
    const done = installedIdsOf(p.id);
    const isSkin = p.kind === 'skin';
    // 三种形态：token 型（有变量表，免费迁移）/ skin 型（官方皮肤生态）/ 通用型（扫不出变量表，
    // 只能靠「模型全文承接」）。写法差异很大（SCHEMES 字面量 / src/schemes / overrideTokens 调用 /
    // skin.json + 整段 CSS），但界面上要能一眼看出是哪种、以及从哪个文件读到的。
    const isGeneric = p.kind === 'generic';
    const entry = p.clientEntry || '';
    const sourceLabel = isSkin ? 'skin.json'
      : (entry ? `读 ${entry}` : (p.source === 'src/schemes' ? '读 src/schemes' : p.source || '未知来源'));
    const rows = [];
    for (const sch of p.schemes) {
      for (const tone of (sch.tones && sch.tones.length ? sch.tones : ['light', 'dark'])) {
        const key = `${sch.id}:${tone}`;
        const isDone = done.has(key);
        // skin 型给的是「全文承接」：模型读整包结构摘要（配色分布 / 形状语言 / 资源表 /
        // 规则样本）后用桌面端自己的类名与变量重新表达，并能引用皮肤自带的图片资源。
        // token 型仍是「模型精修」：只补译免费路径没翻译动的选择器。
        const refineBtn = (isSkin || isGeneric)
          ? `<button type="button" class="mini-btn ts-refine" data-plugin="${esc(p.id)}" data-scheme="${esc(sch.id)}" data-tone="${tone}" title="让模型通读整个主题包（自动压缩成结构摘要）后，用桌面端的类名与变量重新表达它的配色/形状/纹理，并可引用皮肤自带的图片资源。会产生模型费用。">模型全文承接…</button>`
          : `<button type="button" class="mini-btn ts-refine" data-plugin="${esc(p.id)}" data-scheme="${esc(sch.id)}" data-tone="${tone}" title="用模型解析源码后补译未映射规则、派生强调色、并给出行为层结论（会产生模型费用）">模型精修…</button>`;
        rows.push(`<div class="ts-row">
          <span class="ts-row-label">${esc(sch.label)} <span class="ts-tone ts-tone-${tone}">${tone === 'light' ? '浅色' : '深色'}</span></span>
          <span class="meta ts-row-meta">${isSkin
            ? (p.skin && p.skin.accent ? `强调色 ${esc(p.skin.accent)}` : '未声明强调色')
            : (isGeneric ? '无变量表 · 需模型承接' : `${sch.tokenCount} 个变量`)}</span>
          <span class="ts-row-actions">
            <button type="button" class="mini-btn ts-install" data-plugin="${esc(p.id)}" data-scheme="${esc(sch.id)}" data-tone="${tone}">${isDone ? '重新安装' : '安装'}</button>
            ${refineBtn}
            ${isDone ? '<span class="ts-ok">已迁移 ✓</span>' : ''}
          </span>
        </div>`);
      }
    }
    // skin 型自带浅/深预览图（skin.json 的 preview 字段），比文字描述直观得多
    const previewHtml = isSkin && p.skin && (p.skin.previewLight || p.skin.previewDark)
      ? `<div class="ts-skin-preview">${['previewLight', 'previewDark'].map((k) => p.skin[k]
        ? `<figure class="ts-skin-fig"><img src="${escAttrUrl(p.skin[k])}" alt="" /><figcaption class="meta">${k === 'previewLight' ? '浅色' : '深色'}预览（WebUI 实际观感）</figcaption></figure>`
        : '').join('')}</div>`
      : '';
    const shape = p.shapePolicy || {};
    const shapeDesc = isSkin
      ? 'skin 型：结构层不在迁移范围（整段 CSS 是 WebUI 专属选择器）'
      : ([
        shape.zeroRadius ? '圆角清零' : '',
        shape.borderWidth ? `边框 ${shape.borderWidth}px` : '',
        shape.hardShadow ? `硬阴影 ${shape.hardShadow.dx}/${shape.hardShadow.dy}px` : '',
        shape.press ? `按压位移` : '',
      ].filter(Boolean).join(' · ') || '无结构层');
    const b = p.behavior || {};
    const feats = [
      b.toggle ? '开关' : '', b.schemeSwitch ? '方案切换' : '', b.structureLayer ? '结构层' : '',
      b.settingsRow ? '设置行' : '', b.persistence ? '持久化' : '',
      (b.resourceHints && (b.resourceHints.backgroundImage || b.resourceHints.backgroundVideo)) ? '背景资源' : '',
      (b.resourceHints && b.resourceHints.font) ? '字体' : '',
    ].filter(Boolean).join(' / ') || '无';

    const kindBadge = isSkin
      ? '<span class="mk-badge" title="官方皮肤生态：skin.json + bodyAttr + 整段 CSS，不含 --dsw-* token">skin 型（官方皮肤生态）</span>'
      : isGeneric
        ? '<span class="mk-badge mk-badge-self" title="本机扫不出变量表（既不是 SCHEMES 字面量，也没有 skin.json），免费路径只能给强调色与命名；真正的观感需要「模型全文承接」">通用型（需模型承接）</span>'
        : `<span class="mk-badge" title="变量表来源：${esc(sourceLabel)}">token 型 · ${esc(sourceLabel)}</span>`;

    return `<div class="ts-card" data-plugin="${esc(p.id)}">
      <div class="ts-card-head">
        <div>
          <div class="ts-card-name">${esc(p.id)} ${p.version ? `<span class="meta">v${esc(p.version)}</span>` : ''}</div>
          <div class="ts-card-desc">${esc(p.description || '（无描述）')}</div>
        </div>
        <div class="ts-card-tags">
          <span class="mk-badge${p.enabled ? ' ts-on' : ''}">${p.enabled ? 'WebUI 已启用' : 'WebUI 已停用'}</span>
          <span class="mk-badge">${p.schemes.length} 个方案</span>
          ${kindBadge}
        </div>
      </div>
      ${isSkin && p.skin ? `<div class="meta ts-skin-note">skin「${esc(p.skin.name)}」${p.skin.tagline ? ' · ' + esc(p.skin.tagline) : ''}。免费迁移承接<strong>强调色与命名</strong>（底色沿用官方浅/深档）；整段皮肤 CSS 是 WebUI 专属选择器，完整观感请在 WebUI 里启用该皮肤。</div>` : ''}
      ${previewHtml}
      <div class="ts-facts">
        <span>结构层：${esc(shapeDesc)}</span>
        <span>行为层：${esc(feats)}</span>
      </div>
      <div class="ts-rows">${rows.join('')}</div>
      <div class="ts-card-foot">
        <button type="button" class="primary-btn ts-install-all" data-plugin="${esc(p.id)}"${isGeneric ? ' title="通用型没有变量表：免费安装只会承接强调色与命名，观感请用「模型全文承接」"' : ''}>全部免费安装（${p.schemes.length * 2} 个）</button>
        ${(isSkin || isGeneric)
          ? `<button type="button" class="mini-btn ts-refine-all" data-plugin="${esc(p.id)}">全部档位全文承接（${p.schemes.length * 2} 次调用）</button>`
          : `<button type="button" class="mini-btn ts-refine-all" data-plugin="${esc(p.id)}">全部模型精修（${p.schemes.length * 2} 次调用）</button>`}
        <button type="button" class="mini-btn ts-reveal" data-plugin="${esc(p.id)}">定位主题包目录</button>
      </div>
      <div class="ts-preview" id="tsPreview-${esc(p.id)}"></div>
    </div>`;
  }

  function renderSkipped() {
    const sk = (S.scan && S.scan.skipped) || [];
    if (!sk.length) return '';
    const themes = sk.filter((s) => /主题变量|scheme/.test(s.reason));
    const plain = sk.length - themes.length;
    return `<details class="ts-skipped"><summary>另有 ${sk.length} 个 WebUI 插件不含主题能力（已跳过${themes.length ? `；其中 ${themes.length} 个解析异常需关注` : ''}）</summary>
      <div class="meta">扫描了 ${S.scan.scanned} 个包。跳过原因一览：</div>
      <ul class="ts-skipped-list">${sk.slice(0, 60).map((s) => `<li>${esc(s.id)} — ${esc(s.reason)}</li>`).join('')}</ul>
      ${plain > 0 ? `<div class="meta">（${plain} 个是纯功能插件，本来就不带主题变量）</div>` : ''}
    </details>`;
  }

  // ---------------------------------------------------------------- 操作

  async function doInstall(pluginId, schemeId, tone, analysis) {
    const m = await api.themeMigrate(pluginId, schemeId, tone);
    if (!m || !m.ok || !m.migrations || !m.migrations.length) {
      throw new Error((m && m.error) || (m && m.errors && m.errors.join('；')) || '迁移失败');
    }
    S.migrated = m;
    const r = await api.themeInstall(m.migrations, analysis || null);
    if (!r || !r.ok) throw new Error((r && r.error) || '写入主题库失败');
    // 刷新主界面的主题下拉，并**直接应用**刚迁移的这个：
    // 用户是在为"这一个主题"点安装，装完还要再去设置里找一遍是多余的。
    if (window.__dshThemes) {
      await window.__dshThemes.refresh();
      window.__dshThemes.apply(m.migrations[0].id);
    }
    return { migrations: m.migrations, result: r };
  }

  function showPreview(pluginId, migrations) {
    const box = document.getElementById('tsPreview-' + pluginId);
    if (!box || !migrations.length) return;
    const m = migrations[0];
    box.innerHTML = `
      <div class="ts-preview-title">迁移结果预览 · ${esc(m.label)}</div>
      <div class="ts-preview-css"><pre>${esc(m.css || '（该主题没有额外的 CSS 规则）')}</pre></div>
      <ul class="ts-preview-notes">
        ${(m.notes || []).map((n) => `<li>${esc(n)}</li>`).join('') || '<li class="meta">无附加说明</li>'}
      </ul>`;
    box.hidden = false;
  }

  async function handleInstall(btn) {
    const { plugin, scheme, tone } = btn.dataset;
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '迁移中…';
    try {
      const { migrations, result } = await doInstall(plugin, scheme, tone);
      showPreview(plugin, migrations);
      const rep = (result.replaced || []).includes(migrations[0].id) ? '（覆盖旧版本）' : '';
      toast(`已迁移并应用「${migrations[0].label}」${rep}；也可随时在「设置 → 星域主题」里切换`, 'ok');
      await refresh();
      render();
    } catch (e) {
      toast('迁移失败：' + ((e && e.message) || e), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  async function handleInstallAll(btn) {
    const pluginId = btn.dataset.plugin;
    const p = (S.scan.plugins || []).find((x) => x.id === pluginId);
    if (!p) return;
    const n = p.schemes.length * 2;
    const ok = await confirmBox(
      `将把「${p.id}」的全部 ${n} 个方案档位迁移到这个桌面端（免费、不调用模型）。\n\n`
      + '迁移后可在「设置 → 星域主题」的下拉里选择它们。继续？', '迁移到桌面端', `迁移 ${n} 个`);
    if (!ok) return;
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '迁移中…';
    try {
      const all = [];
      const errors = [];
      for (const sch of p.schemes) {
        for (const tone of (sch.tones && sch.tones.length ? sch.tones : ['light', 'dark'])) {
          try {
            const m = await api.themeMigrate(pluginId, sch.id, tone);
            if (m && m.ok && m.migrations) all.push(...m.migrations);
            else errors.push(`${sch.id}/${tone}: ${(m && m.error) || '失败'}`);
          } catch (e) { errors.push(`${sch.id}/${tone}: ${e.message}`); }
        }
      }
      if (!all.length) throw new Error(errors.join('；') || '没有任何可迁移的方案');
      const r = await api.themeInstall(all, null);
      if (!r || !r.ok) throw new Error((r && r.error) || '写入失败');
      if (window.__dshThemes) {
        await window.__dshThemes.refresh();
        window.__dshThemes.apply(all[0].id);
      }
      showPreview(pluginId, all);
      toast(`已迁移 ${all.length} 个主题到桌面端（已应用第一个）${errors.length ? `，${errors.length} 个失败` : ''}`, 'ok');
      await refresh();
      render();
    } catch (e) {
      toast('批量迁移失败：' + ((e && e.message) || e), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  /** 模型精修成本提示：把「会发生什么」说清楚，让用户自己决定是否花钱。 */
  async function confirmRefine(count) {
    if (!S.routes.length) {
      toast('没有可用的模型路由：请先到「设置 → 模型配置」添加并启用一个提供商的端点与模型。', 'error');
      return false;
    }
    const r = routeOf(S.route);
    if (!r) { toast('请先在下方选择用于精修的模型路由', 'error'); return false; }
    if (r.hasKey === false) {
      toast(`路由「${r.provider}」的密钥引用 ${r.apiKeyEnv || '(未设置)'} 在本机未配置，精修会失败。请先到「设置 → 模型配置」填入密钥。`, 'error');
      return false;
    }
    return confirmBox(
      `将调用模型 ${r.provider} / ${S.model} 分析主题包源码，做 ${count} 次请求。\n\n`
      + '精修会做的事：\n'
      + ' · 补译免费路径翻译不动的选择器（例如 WebUI 独有的类名）\n'
      + ' · 在档位语义错配时从主题自己的色族派生一个可用的强调色\n'
      + ' · 给出行为层结论（哪些功能桌面端天然就有、哪些无法承接）\n\n'
      + '这会消耗你的模型额度（每次约 1 万字符输入）。费用由你的模型提供商结算，是否继续？',
      '模型兼容精修', `继续（${count} 次调用）`);
  }

  async function refineOne(btn) {
    const { plugin, scheme, tone } = btn.dataset;
    if (!(await confirmRefine(1))) return;
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '分析中…';
    try {
      const r = await api.themeAnalyze({
        pluginId: plugin, schemeId: scheme, tone,
        baseURL: (routeOf(S.route) || {}).baseURL,
        apiKeyEnv: (routeOf(S.route) || {}).apiKeyEnv,
        model: S.model,
      });
      if (!r || !r.ok) throw new Error((r && r.error) || '分析失败');
      S.lastAnalysis = { plugin, scheme, tone, ...r };
      const got = await doInstall(plugin, scheme, tone, r.analysis);
      showAnalysis(plugin, r);
      // 如实汇报：模型可能"跑了但什么都没带进来"（产出被净化全丢）。原来无论有没有产出都提示
      // "完成并已应用"，用户看到界面没变化只会以为功能坏了（实测踩到：14 条桌面端变量被全丢）。
      const a = (r && r.analysis) || {};
      const added = Object.keys(a.tokens || {}).length + ((a.css || '').trim() ? 1 : 0);
      const droppedN = (a.dropped || []).length;
      if (added === 0) {
        toast(`模型没有产出可用内容（被净化丢弃 ${droppedN} 处）：${(a.dropped || [])[0] || '见下方分析详情'}`, 'error');
      } else if (added <= 2) {
        toast(`精修内容很少（tokens ${Object.keys(a.tokens || {}).length} 条 / css ${(a.css || '').trim() ? '有' : '无'}，丢弃 ${droppedN} 处），效果可能不明显：${r.migrations ? '' : ''}见下方分析详情`, 'ok');
      } else {
        toast(`模型精修完成并已应用：${got.migrations[0].label}`, 'ok');
      }
      await refresh();
      render();
    } catch (e) {
      toast('模型精修失败：' + ((e && e.message) || e), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  async function refineAll(btn) {
    const pluginId = btn.dataset.plugin;
    const p = (S.scan.plugins || []).find((x) => x.id === pluginId);
    if (!p) return;
    const pairs = [];
    for (const sch of p.schemes) {
      for (const tone of (sch.tones && sch.tones.length ? sch.tones : ['light', 'dark'])) pairs.push([sch.id, tone]);
    }
    if (!(await confirmRefine(pairs.length))) return;
    btn.disabled = true;
    const old = btn.textContent;
    let done = 0;
    const fails = [];
    try {
      for (const [scheme, tone] of pairs) {
        btn.textContent = `分析中 ${done + 1}/${pairs.length}…`;
        try {
          const r = await api.themeAnalyze({
            pluginId, schemeId: scheme, tone,
            baseURL: (routeOf(S.route) || {}).baseURL,
            apiKeyEnv: (routeOf(S.route) || {}).apiKeyEnv,
            model: S.model,
          });
          if (!r || !r.ok) throw new Error(r && r.error);
          await doInstall(pluginId, scheme, tone, r.analysis);
          done++;
        } catch (e) {
          fails.push(`${scheme}/${tone}: ${(e && e.message) || e}`);
        }
      }
      toast(`模型精修完成：成功 ${done} / ${pairs.length}${fails.length ? `，失败 ${fails.length}` : ''}`, fails.length ? 'error' : 'ok');
      await refresh();
      render();
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  function showAnalysis(pluginId, r) {
    const box = document.getElementById('tsPreview-' + pluginId);
    if (!box) return;
    const a = r.analysis || {};
    const verdict = { carried: '已承接', native: '桌面端原生具备', unavailable: '无法承接' };
    box.innerHTML = `
      <div class="ts-preview-title">模型精修结果 · ${esc(a.confidence ? `置信度 ${a.confidence}` : '')}</div>
      ${a.accent ? `<div class="ts-preview-line">派生强调色：<code>${esc(a.accent)}</code> <span class="meta">${esc(a.accentReason || '')}</span></div>` : ''}
      ${Object.keys(a.tokens || {}).length ? `<div class="ts-preview-line">修正变量 ${Object.keys(a.tokens).length} 条</div>` : ''}
      ${a.css ? `<div class="ts-preview-css"><pre>${esc(a.css)}</pre></div>` : '<div class="meta">没有补译出新的 CSS 规则</div>'}
      ${(a.behavior || []).length ? `<div class="ts-preview-title">行为层结论</div><ul class="ts-preview-notes">${
        a.behavior.map((b) => `<li><b>${esc(b.feature)}</b> — ${esc(verdict[b.verdict] || b.verdict)}：${esc(b.detail)}</li>`).join('')}</ul>` : ''}
      ${(a.unmapped || []).length ? `<div class="ts-preview-title">仍无法承接</div><ul class="ts-preview-notes">${
        a.unmapped.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>` : ''}
      ${(r.dropped || []).length ? `<div class="meta">净化丢弃 ${r.dropped.length} 处：${esc(r.dropped.slice(0, 4).join('；'))}</div>` : ''}`;
    box.hidden = false;
  }

  /** 键盘/鼠标事件统一委托——卡片是 innerHTML 重建的，逐个绑定会漏。 */
  function bind(box) {
    box.addEventListener('click', async (e) => {
      const t = e.target.closest('button, a');
      if (!t) return;
      if (t.id === 'tsRevealStore' || t.classList.contains('ts-reveal-store')) {
        e.preventDefault();
        const r = await api.themeRevealStore();
        if (r && !r.ok) toast(r.error || '打开失败', 'error');
        return;
      }
      if (t.id === 'tsRefresh') { await refresh(); render(); return; }
      if (t.classList.contains('ts-reveal')) {
        const r = await api.themeRevealPlugin(t.dataset.plugin);
        if (r && !r.ok) toast(r.error || '打开失败', 'error');
        return;
      }
      if (t.classList.contains('ts-install')) { await handleInstall(t); return; }
      if (t.classList.contains('ts-install-all')) { await handleInstallAll(t); return; }
      if (t.classList.contains('ts-refine')) { await refineOne(t); return; }
      if (t.classList.contains('ts-refine-all')) { await refineAll(t); return; }
      if (t.classList.contains('ts-uninstall')) {
        const id = t.dataset.id;
        const ok = await confirmBox(`从桌面端移除迁移主题「${id}」？\n\n这只会删除桌面端的迁移副本，不影响装在 WebUI 里的插件本身。`, '移除迁移主题', '移除');
        if (!ok) return;
        const r = await api.themeRemove(id);
        if (!r || !r.ok) { toast((r && r.error) || '移除失败', 'error'); return; }
        if (window.__dshThemes) await window.__dshThemes.refresh();
        await refresh();
        render();
      }
    });
    box.addEventListener('change', async (e) => {
      if (e.target.id === 'tsRoute') {
        S.route = e.target.value;
        localStorage.setItem(ROUTE_KEY, S.route);
        S.model = '';
        render();
      } else if (e.target.id === 'tsModelSel') {
        S.model = e.target.value;
        localStorage.setItem(MODEL_KEY, S.model);
      }
    });
  }

  async function refresh() {
    if (S.busy) return;
    S.busy = true;
    try {
      await loadAll(true);
    } finally {
      S.busy = false;
    }
  }

  // 已迁移清单（独立区块，放在插件卡下面，便于删除）
  function installedSection() {
    if (!S.installed.length) return '';
    return `<div class="ts-installed">
      <div class="ts-installed-head">已迁移到桌面端（${S.installed.length}）</div>
      <ul class="ts-installed-list">${S.installed.map((t) => `<li>
        <span>${esc(t.label || t.id)}</span>
        <span class="meta">${esc(t.id)} · ${Object.keys(t.tokens || {}).length} 变量${t.analysis ? ' · 含模型精修' : ''}</span>
        <button type="button" class="mini-btn ts-apply" data-id="${esc(t.id)}">应用</button>
        <button type="button" class="mini-btn ts-uninstall" data-id="${esc(t.id)}">移除</button>
      </li>`).join('')}</ul>
    </div>`;
  }

  let inited = false;
  window.__themeStudio = {
    /** 市场页切到「主题」标签时调用。 */
    async mount() {
      const panel = document.getElementById('tsPanel');
      const box = document.getElementById('tsBody');
      if (!panel || !box) return;   // 静态结构缺失（老版本 index.html）时静默跳过
      if (!inited) {
        inited = true;
        bind(panel);
        panel.addEventListener('click', async (e) => {
          const a = e.target.closest('.ts-apply');
          if (!a) return;
          if (window.__dshThemes) {
            window.__dshThemes.apply(a.dataset.id);
            toast('已应用，可在「设置 → 星域主题」看到当前选择', 'ok');
          }
        });
      }
      // 注意：占位必须写进 #tsBody，不能写 #tsPanel —— #tsBody / #tsInstalled
      // 都是 #tsPanel 的子节点，写父节点会把它们一起清掉（踩过）。
      box.innerHTML = '<div class="empty">正在扫描本机的 WebUI 主题插件…</div>';
      try {
        await loadAll(true);
        render();
        // 已迁移清单单独一块（#tsInstalled 是 #tsBody 的兄弟节点，render() 不碰它）
        const inst = document.getElementById('tsInstalled');
        if (inst) inst.innerHTML = installedSection();
      } catch (e) {
        box.innerHTML = `<div class="empty">加载失败：${esc((e && e.message) || e)}</div>`;
      }
    },
    refresh: async () => { await refresh(); render(); },
    /** 市场变更后的联动刷新：只有工作室真的挂载过才刷（没挂载时面板是隐藏的，刷了也看不见）。 */
    refreshIfMounted: async () => {
      if (!inited) return;
      try {
        await refresh();
        render();
        const inst = document.getElementById('tsInstalled');
        if (inst) inst.innerHTML = installedSection();
      } catch { /* 显示层刷新失败不影响主流程 */ }
    },
    /**
     * 供市场「主题」标签的一键迁移调用：扫描（必要时）→ 全部方案档位免费迁移 → 刷新下拉并应用。
     * 返回 { ok, migrated, appliedId, error }。不弹确认框（调用方已确认过）。
     */
    migrateAll: async (pluginId) => {
      try {
        if (!S.scan || !(S.scan.plugins || []).some((p) => p.id === pluginId)) await refresh();
        const p = (S.scan.plugins || []).find((x) => x.id === pluginId);
        if (!p) return { ok: false, error: `本机没有找到插件「${pluginId}」—— 安装可能还没完成，稍后点「重新扫描」再试` };
        const all = [];
        const errors = [];
        for (const sch of p.schemes) {
          for (const tone of (sch.tones && sch.tones.length ? sch.tones : ['light', 'dark'])) {
            try {
              const m = await api.themeMigrate(pluginId, sch.id, tone);
              if (m && m.ok && m.migrations) all.push(...m.migrations);
              else errors.push(`${sch.id}/${tone}: ${(m && m.error) || '失败'}`);
            } catch (e) { errors.push(`${sch.id}/${tone}: ${e.message}`); }
          }
        }
        if (!all.length) throw new Error(errors.join('；') || '没有任何可迁移的方案');
        const r = await api.themeInstall(all, null);
        if (!r || !r.ok) throw new Error((r && r.error) || '写入主题库失败');
        if (window.__dshThemes) {
          await window.__dshThemes.refresh();
          window.__dshThemes.apply(all[0].id);
        }
        await refresh();
        render();
        const inst = document.getElementById('tsInstalled');
        if (inst) inst.innerHTML = installedSection();
        return { ok: true, migrated: all.length, appliedId: all[0].id };
      } catch (e) {
        return { ok: false, error: (e && e.message) || String(e) };
      }
    },
  };
})();
