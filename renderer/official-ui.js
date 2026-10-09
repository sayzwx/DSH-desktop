/**
 * 官方界面宿主（Phase 1）：把**引擎自带的 WebUI** 嵌进我们界面的一个面板。
 *
 * 为什么需要它（用户 2026-10-09 的核心诉求）：
 *   社区为 WebUI 写的 UI 插件（@deepseek-ai/dsh-client-ui-*）与主题，只认 harness 自己的前端；
 *   我们自研界面承接不了那些 UI 面（工具/技能/MCP 等引擎能力早已承接）。
 *   把官方前端嵌进来 = 那些插件/主题**零改动直接生效**，同时我们自己的界面构造原样保留
 *   （官方桌面端就是这么做的：dsh-desktop-client-ui 作为一个 client 插件挂在官方前端上）。
 *
 * 机制：视图由主进程的 WebContentsView 承载（复用内置浏览器那套），
 *       渲染层只负责「留位置 + 报矩形 + 开关」——和我们给内置浏览器做的一模一样。
 * 目标形态（Phase 2）：把我们的界面逐步改写成 cordis client 插件，跑在同一个前端运行时的插槽体系里。
 */
(() => {
  const api = window.api;
  const page = document.getElementById('page-official');
  const host = document.getElementById('officialHost');
  const placeholder = document.getElementById('officialPlaceholder');
  const placeholderText = document.getElementById('officialPlaceholderText');
  const hint = document.getElementById('officialHint');
  if (!page || !host) return;

  let open = false;
  let retryTimer = null;

  const setPlaceholder = (text, show = true) => {
    if (!placeholder) return;
    placeholder.hidden = !show;
    if (placeholderText && text) placeholderText.textContent = text;
  };

  /** 把宿主面板的矩形报给主进程（WebContentsView 按这个矩形贴上去） */
  async function sendBounds() {
    if (!open) return;
    const r = host.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return;
    await api.frontendSetBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
  }

  async function show() {
    if (open) return;
    open = true;
    await new Promise((res) => requestAnimationFrame(res));
    await sendBounds();
    const r = await api.frontendOpen().catch((e) => ({ ok: false, error: e.message }));
    if (!r || !r.ok) {
      open = false;
      setPlaceholder(`打不开官方界面：${(r && r.error) || '未知原因'}\n（先「启动 Harness」再回到这里）`);
      return false;
    }
    if (r.url) setPlaceholder('', false);
    return true;
  }

  async function hide() {
    open = false;
    try { await api.frontendClose(); } catch { /* ignore */ }
    setPlaceholder('正在连接引擎…', true);
  }

  /** 引擎没起来时：先把状态问清楚再决定是"开视图"还是"给明确指引" */
  async function tryShow() {
    const st = await api.getStatus().catch(() => null);
    const up = !!(st && (st.state === 'running' || st.webUp));
    if (!up) {
      setPlaceholder('引擎未运行 —— 先点右下角「启动 Harness」，就绪后本页会自动加载');
      if (hint) hint.textContent = '引擎未运行（本页承载引擎自带 WebUI）';
      // 等引擎就绪后自动加载
      if (retryTimer) clearInterval(retryTimer);
      retryTimer = setInterval(async () => {
        if (!page.classList.contains('active')) { clearInterval(retryTimer); retryTimer = null; return; }
        const s2 = await api.getStatus().catch(() => null);
        if (s2 && (s2.state === 'running' || s2.webUp)) {
          clearInterval(retryTimer); retryTimer = null;
          if (hint) hint.textContent = '引擎自带 WebUI（社区 UI 插件与主题在此零改动生效）';
          await show();
        }
      }, 2500);
      return;
    }
    if (hint) hint.textContent = '引擎自带 WebUI（社区 UI 插件与主题在此零改动生效）';
    await show();
  }

  // 页面激活/离开：我们的左栏切页是给 section 加 .active，这里跟着开/关视图
  const observer = new MutationObserver(() => {
    const active = page.classList.contains('active');
    if (active && !open) tryShow();
    else if (!active && open) hide();
  });
  observer.observe(page, { attributes: true, attributeFilter: ['class'] });

  // 窗口尺寸变化 → 重报矩形（视图是绝对定位的，不会自己跟着页面布局走）
  window.addEventListener('resize', () => { sendBounds(); });
  const ro = window.ResizeObserver ? new ResizeObserver(() => sendBounds()) : null;
  if (ro) ro.observe(host);

  document.getElementById('officialReload')?.addEventListener('click', async () => {
    if (!open) { tryShow(); return; }
    setPlaceholder('正在刷新…', true);
    await api.frontendOpen().catch(() => null);
    await sendBounds();
  });
  document.getElementById('officialExternal')?.addEventListener('click', async () => {
    const st = await api.frontendState().catch(() => null);
    const url = (st && st.url) || '';
    if (url) await api.frontendOpenExternal(url);
  });

  // 引擎换了 token / 重启：主进程会带新地址，重新贴一次
  if (api.onFrontendEvent) {
    api.onFrontendEvent((e) => {
      if (e && e.type === 'error') setPlaceholder(`官方界面加载失败：${e.error || ''}`);
    });
  }

  // 首屏若已在官方界面页（记住上次停留的页面时会这样）
  if (page.classList.contains('active')) tryShow();
})();
