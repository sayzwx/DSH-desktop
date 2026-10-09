/**
 * 内置浏览器（**真·内嵌**，不是 iframe）。
 *
 * 为什么不用 iframe：桌面端的 CSP 是 `default-src 'self'`，没有 `frame-src`，
 * 外部 URL 进 iframe 会被直接拦掉；而放宽 CSP 又会让整个渲染层能吃外部资源。
 * Electron 33 有 `WebContentsView`（30+ 引入，替代已废弃的 BrowserView）——
 * 它是**独立的 webContents**，挂在主窗口的内容视图上，不受页面 CSP 约束，
 * 也能自己处理弹窗/权限，是最干净的做法。
 *
 * 约定：渲染层负责"留出位置"（把聊天区缩窄）并回报矩形（`browser:setBounds`），
 * 主进程只负责把这个视图放到那个矩形上。窗口缩放时渲染层用 ResizeObserver 重报。
 */
const { WebContentsView, shell } = require('electron');

const ALLOWED_PROTOCOLS = /^(https?|file):/i;

/** 把用户输入规整成可加载的 URL（"example.com" → https://example.com） */
function normalizeUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (/^(https?|file):\/\//i.test(raw)) return raw;
  // 主机名[:端口] 形态（localhost:3080 / 127.0.0.1:8080 / example.com:8080）——要在
  // "其它 scheme 一律拒绝"之前判断，否则 `localhost:3080` 会被当成 scheme 拒掉。
  if (/^localhost([:/]|$)/i.test(raw)) return 'http://' + raw;
  if (/^\d{1,3}(\.\d{1,3}){3}([:/]|$)/.test(raw)) return 'http://' + raw;
  if (/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*:\d{1,5}([/?#]|$)/.test(raw)) return 'http://' + raw;
  // 其它带 scheme 的（javascript: / data: / vbscript: …）一律拒绝
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return '';
  return 'https://' + raw;
}

function registerBrowserIpc({ ipcMain, getWindow, onEvent, prefix = 'browser', homeUrl = null } = {}) {
  // prefix：通道前缀（内嵌浏览器是 'browser'；「官方界面」宿主是 'frontend'，
  //         用同一套 WebContentsView 机制把引擎自带 WebUI 嵌进我们布局的一块面板）。
  // homeUrl：宿主首页（官方界面 = 引擎 WebUI 地址，含一次性 token）。
  let view = null;
  let bounds = { x: 0, y: 0, width: 0, height: 0 };
  let lastUrl = '';

  const send = (payload) => {
    try {
      if (typeof onEvent === 'function') onEvent(payload);
      else {
        const win = typeof getWindow === 'function' ? getWindow() : null;
        if (win && !win.isDestroyed()) win.webContents.send(`${prefix}:event`, payload);
      }
    } catch { /* 窗口已销毁 */ }
  };

  function attach(win) {
    if (view || !win || win.isDestroyed()) return view;
    view = new WebContentsView({
      webPreferences: {
        // 内嵌浏览器是"外部网页"，隔离到极致：不给 preload、不给 node、独立分区
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition: 'persist:dsh-embedded-browser',
      },
    });
    try { win.contentView.addChildView(view); } catch { /* 老版本回退 */ }
    view.setBounds(bounds);
    view.setVisible?.(false);

    const wc = view.webContents;
    const push = () => send({
      type: 'state',
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack(),
      canGoForward: wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward(),
      loading: wc.isLoading(),
      open: true,
    });
    ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated'].forEach((ev) => {
      wc.on(ev, push);
    });
    wc.on('did-fail-load', (_e, code, desc, url) => {
      if (code === -3) return;   // 用户主动中止，不报
      send({ type: 'error', url, error: `加载失败（${desc || code}）` });
      push();
    });
    // 外部链接/弹窗：一律交给系统浏览器，不在内嵌视图里叠窗口
    wc.setWindowOpenHandler(({ url }) => {
      if (ALLOWED_PROTOCOLS.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    // 权限一律拒绝（摄像头/麦克风/定位/通知…）—— 内嵌浏览器只用来"看"
    try {
      wc.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    } catch { /* ignore */ }
    push();
    return view;
  }

  function destroy() {
    if (!view) return;
    try { view.webContents.removeAllListeners(); } catch { /* ignore */ }
    try {
      const win = typeof getWindow === 'function' ? getWindow() : null;
      if (win && !win.isDestroyed()) win.contentView.removeChildView(view);
    } catch { /* ignore */ }
    try { view.webContents.close(); } catch { /* ignore */ }
    view = null;
    send({ type: 'state', open: false });
  }

  ipcMain.handle(`${prefix}:open`, async (_e, args = {}) => {
    const win = typeof getWindow === 'function' ? getWindow() : null;
    if (!win || win.isDestroyed()) return { ok: false, error: '窗口不可用' };
    attach(win);
    if (args.bounds) {
      bounds = { ...bounds, ...args.bounds };
      try { view.setBounds(bounds); } catch { /* ignore */ }
    }
    view.setVisible?.(true);
    // homeUrl（官方界面宿主）：渲染层不给 url 时用宿主首页；引擎重启换了 token 也能重新取
    const want = args.url || (typeof homeUrl === 'function' ? homeUrl() : homeUrl) || 'https://www.bing.com';
    const url = normalizeUrl(want);
    if (url && url !== lastUrl) {
      lastUrl = url;
      try { await view.webContents.loadURL(url); } catch { /* 失败经 did-fail-load 上报 */ }
    }
    const wc = view.webContents;
    return {
      ok: true,
      url: wc.getURL() || url,
      title: wc.getTitle(),
      canGoBack: wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack(),
      canGoForward: wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward(),
    };
  });

  ipcMain.handle(`${prefix}:setBounds`, async (_e, args = {}) => {
    bounds = {
      x: Math.max(0, Math.round(args.x || 0)),
      y: Math.max(0, Math.round(args.y || 0)),
      width: Math.max(0, Math.round(args.width || 0)),
      height: Math.max(0, Math.round(args.height || 0)),
    };
    if (view) {
      try { view.setBounds(bounds); } catch { /* ignore */ }
      // 高度为 0 视作"面板收起"：隐藏视图但保留状态
      view.setVisible?.(bounds.width > 0 && bounds.height > 0);
    }
    return { ok: true, bounds };
  });

  ipcMain.handle(`${prefix}:navigate`, async (_e, args = {}) => {
    if (!view) return { ok: false, error: '内置浏览器未打开' };
    const url = normalizeUrl(args.url);
    if (!url) return { ok: false, error: '地址不支持（只允许 http / https / file）' };
    lastUrl = url;
    try {
      await view.webContents.loadURL(url);
      return { ok: true, url };
    } catch (e) {
      return { ok: false, error: (e && e.message) || '加载失败' };
    }
  });

  ipcMain.handle(`${prefix}:nav`, async (_e, args = {}) => {
    if (!view) return { ok: false, error: '内置浏览器未打开' };
    const wc = view.webContents;
    const act = args.action;
    const hist = wc.navigationHistory;
    try {
      if (act === 'back') { hist ? hist.goBack() : wc.goBack(); }
      else if (act === 'forward') { hist ? hist.goForward() : wc.goForward(); }
      else if (act === 'reload') wc.reload();
      else if (act === 'stop') wc.stop();
      else if (act === 'home') { lastUrl = 'https://www.bing.com'; await wc.loadURL(lastUrl); }
      else return { ok: false, error: `未知动作 ${act}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e && e.message) || '操作失败' };
    }
  });

  ipcMain.handle(`${prefix}:close`, async () => {
    destroy();
    return { ok: true };
  });

  ipcMain.handle(`${prefix}:openExternal`, async (_e, args = {}) => {
    const url = normalizeUrl(args.url || (view ? view.webContents.getURL() : ''));
    if (!url) return { ok: false, error: '地址不支持' };
    try { await shell.openExternal(url); return { ok: true, url }; } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle(`${prefix}:state`, async () => {
    if (!view) return { ok: true, open: false };
    const wc = view.webContents;
    return {
      ok: true,
      open: bounds.width > 0,
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack(),
      canGoForward: wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward(),
      loading: wc.isLoading(),
    };
  });

  return { destroy, normalizeUrl, isOpen: () => !!view };
}

module.exports = { registerBrowserIpc, normalizeUrl };
