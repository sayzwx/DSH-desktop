'use strict';

/**
 * 主题工作室的 IPC 注册（Theme studio IPC）
 *
 * ## 为什么单独成模块
 *
 * 这段逻辑有两百多行，且**需要一个真实的 ipcMain 才能被验证**。留在 3000+ 行的 main.js
 * 里就只有"启动整个应用、手点界面"一种测法；抽出来后，端到端测试可以注册**同一批处理器**
 * （而不是另抄一份），于是测的就是真代码。
 *
 * 依赖全部由调用方注入（`dshHome` / 引擎 RPC / 凭据读取 / harness 探测），
 * 因此本模块不 import electron、不读全局状态，纯逻辑可单测。
 *
 * ## 通道一览
 *
 *   theme:scan           扫描本机 WebUI 插件，挑出带主题能力的（离线，不调模型）
 *   theme:migrate        免费确定性迁移（token 双档 + 结构层形状策略 + 可验证的类名翻译）
 *   theme:routes         解析「已配置的模型路由」给界面选（端点 / 密钥引用 / 模型清单）
 *   theme:analyze        可选付费：用模型解析主题包源码做兼容精修
 *   theme:install        写入本机主题库
 *   theme:list/remove/clear
 *   theme:revealPlugin / theme:revealStore
 *
 * 安全边界：只读文件的静态文本，绝不 require / eval 主题包的 client.js；
 * 模型返回的 CSS 与 token 也都要过 lib/theme-analysis.js 的净化才落盘。
 *
 * @module lib/theme-ipc
 */

const fs = require('fs');
const path = require('path');
const { TONES, scanThemePlugins, buildMigration, buildSkinMigration, buildSkinDigest } = require('./web-themes.js');
const { analyzeTheme, analyzeSkin } = require('./theme-analysis.js');

/**
 * @param {object} deps
 * @param {import('electron').IpcMain} deps.ipcMain
 * @param {string} deps.dshHome            ~/.dsh
 * @param {string} deps.appDir             app 根目录（renderer/styles.css 所在）
 * @param {() => ({dir?:string}|null)} deps.discoverHarness
 * @param {(ref:string) => string|undefined} deps.readCredentialPlaintext
 * @param {(method:string, payload:object) => Promise<{ok:boolean,value?:any,error?:any}>} deps.rpcCall
 * @param {(dir:string) => Promise<string>} [deps.revealPath]      打开目录（主进程传 shell.openPath）
 * @param {(file:string) => void} [deps.showInFolder]              在文件管理器里选中文件
 * @param {object} [deps.dialog]            Electron dialog（"手动添加扫描目录"要用原生选择器）
 * @param {() => any} [deps.getWindow]      取当前主窗口（选择器的父窗口，没有也能弹）
 */
function registerThemeIpc({
  ipcMain, dshHome, appDir, discoverHarness, readCredentialPlaintext, rpcCall, revealPath, showInFolder,
  dialog = null, getWindow = null,
}) {
  const THEME_STORE_FILE = path.join(dshHome, 'desktop-themes.json');
  const MARKET_STATE_FILE = path.join(dshHome, 'profiles', 'web', '.dsh-market', 'state.json');

  /** 桌面端 styles.css 全文：映射目标是否存在的唯一判据，主题迁移全程要用。 */
  function readDesktopStyles() {
    try {
      return fs.readFileSync(path.join(appDir, 'renderer', 'styles.css'), 'utf8');
    } catch {
      return '';
    }
  }

  /** 桌面端 index.html 全文：净化 #id 选择器时要确认 id 真实存在（如背景挂载点 #themeBg）。 */
  function readDesktopHtml() {
    try {
      return fs.readFileSync(path.join(appDir, 'renderer', 'index.html'), 'utf8');
    } catch {
      return '';
    }
  }

  /** 市场插件的启用状态（禁用清单存在 dshmarket 的 state.json 里）。 */
  function readMarketDisabled() {
    try {
      const st = JSON.parse(fs.readFileSync(MARKET_STATE_FILE, 'utf8'));
      return Array.isArray(st && st.disabled) ? st.disabled : [];
    } catch {
      return [];
    }
  }

  function readThemeStore() {
    try {
      const raw = JSON.parse(fs.readFileSync(THEME_STORE_FILE, 'utf8'));
      return {
        themes: Array.isArray(raw && raw.themes) ? raw.themes : [],
        // 用户手动添加的插件扫描目录：我们猜不全所有安装布局（用户报过"别人机器扫不到主题"），
        // 留一个显式出口，扫不到时自己指过去即可。
        scanRoots: Array.isArray(raw && raw.scanRoots) ? raw.scanRoots.filter((x) => typeof x === 'string') : [],
        updatedAt: (raw && raw.updatedAt) || null,
      };
    } catch {
      return { themes: [], scanRoots: [], updatedAt: null };
    }
  }

  function writeThemeStore(store) {
    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      themes: store.themes || [],
      scanRoots: Array.isArray(store.scanRoots) ? store.scanRoots : [],
    };
    fs.mkdirSync(path.dirname(THEME_STORE_FILE), { recursive: true });
    fs.writeFileSync(THEME_STORE_FILE, JSON.stringify(payload, null, 2), 'utf8');
    return payload.updatedAt;
  }

  function scanThemes() {
    const harness = discoverHarness ? discoverHarness() : null;
    const store = readThemeStore();
    const res = scanThemePlugins({
      dshHome,
      harnessDir: harness && harness.dir ? harness.dir : undefined,
      disabled: readMarketDisabled(),
      stylesCss: readDesktopStyles(),
      extraRoots: store.scanRoots,
    });
    return {
      ...res,
      harnessDir: harness && harness.dir ? harness.dir : null,
      scanRoots: store.scanRoots,          // 用户手动加的目录（界面可移除）
      storeUpdatedAt: store.updatedAt,
      installedTotal: store.themes.length,
      plugins: res.plugins.map((p) => ({
        ...p,
        // 已迁移过的档位（界面打勾用）
        installedIds: store.themes
          .filter((t) => t.origin && t.origin.plugin === p.id)
          .map((t) => t.id),
      })),
    };
  }

  /**
   * 按 id 找插件：**路径一律从本机扫描结果取，绝不信任渲染层传来的 dir**。
   * 否则界面就等于拿到了"任意路径读取"的能力。
   */
  function findThemePlugin(pluginId) {
    const scan = scanThemes();
    const plugin = scan.plugins.find((p) => p.id === pluginId);
    if (!plugin) return { ok: false, scan, error: `未找到已安装的 WebUI 主题插件「${pluginId}」` };
    return { ok: true, scan, plugin };
  }

  ipcMain.handle('theme:scan', async () => {
    try {
      return { ok: true, ...scanThemes() };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });

  // 手动添加插件扫描目录（原生目录选择器）：扫不到主题时的显式出口
  ipcMain.handle('theme:addScanRoot', async () => {
    try {
      if (!dialog) return { ok: false, error: '当前环境不支持目录选择器' };
      let win = null;
      try { win = typeof getWindow === 'function' ? getWindow() : null; } catch { win = null; }
      if (win && win.isDestroyed && win.isDestroyed()) win = null;
      const opts = {
        title: '选择插件所在目录（含 node_modules 的那一层，或直接选 node_modules）',
        buttonLabel: '加入扫描',
        properties: ['openDirectory', 'createDirectory'],
      };
      const pick = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      if (pick.canceled || !pick.filePaths.length) return { ok: true, cancelled: true };
      let dir = pick.filePaths[0];
      // 允许直接选到包所在的那一层：若其下有 node_modules 就自动进去（用户更少踩坑）
      try {
        if (fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'node_modules'))) {
          dir = path.join(dir, 'node_modules');
        }
      } catch { /* 保持原样 */ }
      const store = readThemeStore();
      const roots = [...new Set([...(store.scanRoots || []), dir])];
      writeThemeStore({ ...store, scanRoots: roots });
      return { ok: true, added: dir, ...scanThemes() };
    } catch (e) {
      return { ok: false, error: (e && e.message) || '添加失败' };
    }
  });

  ipcMain.handle('theme:removeScanRoot', async (_e, { path: target } = {}) => {
    try {
      const store = readThemeStore();
      const want = path.resolve(String(target || ''));
      const roots = (store.scanRoots || []).filter((r) => path.resolve(r) !== want);
      writeThemeStore({ ...store, scanRoots: roots });
      return { ok: true, ...scanThemes() };
    } catch (e) {
      return { ok: false, error: (e && e.message) || '移除失败' };
    }
  });

  ipcMain.handle('theme:migrate', async (_e, { pluginId, schemeId, tone } = {}) => {
    const found = findThemePlugin(pluginId);
    if (!found.ok) return { ok: false, error: found.error };
    const stylesCss = readDesktopStyles();
    const indexHtml = readDesktopHtml();
    const plugin = found.plugin;
    const wantSchemes = schemeId ? [schemeId] : plugin.schemes.map((s) => s.id);
    const wantTones = tone ? [tone] : TONES;
    const migrations = [];
    const errors = [];
    for (const sid of wantSchemes) {
      for (const t of wantTones) {
        try {
          // skin 型主题走独立构建路径（skin.json → 强调色 + 命名；整段 CSS 是 WebUI 专属，
          // 桌面端没有落点 —— 差异如实写进每条迁移的 notes）
          migrations.push(plugin.kind === 'skin' || plugin.kind === 'generic'
            ? buildSkinMigration({ plugin, tone: t, stylesCss })
            : buildMigration({ plugin, schemeId: sid, tone: t, stylesCss }));
        } catch (e) {
          errors.push(`${sid}/${t}: ${(e && e.message) || String(e)}`);
        }
      }
    }
    return {
      ok: migrations.length > 0,
      migrations,
      errors,
      plugin: { id: plugin.id, version: plugin.version, schemes: plugin.schemes },
    };
  });

  // 模型精修要「选一个已配置的模型」。渲染层拿不到 baseURL / 密钥引用——
  // llm.models 只给分组与模型名，端点地址在 llm-pi-ai 的 settings 里。
  // 所以由主进程解析成一张「可选路由表」，只返回**端点和模型都齐全**的路由。
  ipcMain.handle('theme:routes', async () => {
    const [sd, lm] = await Promise.all([rpcCall('settings.describe', {}), rpcCall('llm.models', {})]);
    if (!sd.ok && !lm.ok) {
      return { ok: false, error: '引擎未运行：无法读取已配置的模型路由' };
    }
    const nsList = (sd.ok && sd.value && sd.value.namespaces) || [];
    const pi = nsList.find((n) => n && n.ns === 'llm-pi-ai');
    const profiles = (pi && pi.value && pi.value.providers) || {};
    const groups = (lm.ok && lm.value && lm.value.groups) || [];
    const activeIds = new Set(groups.map((g) => g.id));
    const ids = [...new Set([...groups.map((g) => g.id), ...Object.keys(profiles)])];
    const out = [];
    for (const id of ids) {
      const prof = profiles[id] || {};
      const baseURL = typeof prof.baseURL === 'string' && /^https?:\/\//.test(prof.baseURL) ? prof.baseURL : '';
      const group = groups.find((g) => g.id === id);
      const models = (group && group.models ? group.models : (Array.isArray(prof.models) ? prof.models : []))
        .map((m) => (typeof m === 'string' ? m : m && m.id))
        .filter((m) => typeof m === 'string' && m);
      if (!baseURL || models.length === 0) continue;
      out.push({
        provider: id,
        label: (group && group.name) || prof.displayName || id,
        baseURL,
        apiKeyEnv: typeof prof.apiKeyEnv === 'string' ? prof.apiKeyEnv : '',
        active: activeIds.has(id),
        models,
      });
    }
    // 批量问一次每个引用是否已配置（只返回布尔与可写性，不返回明文）
    const refs = [...new Set(out.map((r) => r.apiKeyEnv).filter(Boolean))];
    let creds = {};
    if (refs.length) {
      const cr = await rpcCall('credentials.describe', { refs });
      if (cr.ok && cr.value) creds = cr.value.credentials || {};
    }
    for (const r of out) {
      const c = r.apiKeyEnv ? creds[r.apiKeyEnv] : null;
      r.hasKey = r.apiKeyEnv ? !!(c && c.configured) : null;
    }
    out.sort((a, b) => Number(b.active) - Number(a.active) || a.label.localeCompare(b.label));
    return {
      ok: true,
      routes: out,
      engineRunning: sd.ok || lm.ok,
      writable: sd.ok ? sd.value?.writable !== false : null,
    };
  });

  ipcMain.handle('theme:analyze', async (event, { pluginId, schemeId, tone, baseURL, apiKey, apiKeyEnv, model } = {}) => {
    const found = findThemePlugin(pluginId);
    if (!found.ok) return { ok: false, error: found.error };
    if (typeof model !== 'string' || !model) return { ok: false, error: '请先选择一个已配置的模型' };
    const stylesCss = readDesktopStyles();
    const onProgress = (line) => {
      try {
        if (!event.sender.isDestroyed()) event.sender.send('theme:analysisProgress', line);
      } catch { /* 窗口已关 */ }
    };
    // 密钥优先用界面上刚输入的（用户正在验证它），否则按引用名在本机读——
    // 明文绝不回渲染进程（与 llm:probeCapabilities 同一约定）。
    const typed = typeof apiKey === 'string' && apiKey.length > 0 ? apiKey : undefined;
    const key = typed || (readCredentialPlaintext ? readCredentialPlaintext(apiKeyEnv) : undefined);

    // skin / generic 型（官方皮肤生态、以及本机扫不出变量表的主题包）走「全文承接」：它不是变量表 + 可翻译类名，而是一整段
    // WebUI 专属 CSS + 自己的图片资源。这里先把整包压成结构摘要（配色分布 / 形状语言 /
    // 资源表 / 规则样本），再让模型用桌面端自己的类名与变量重新表达 —— 包括用它自己的图。
    if (found.plugin.kind === 'skin' || found.plugin.kind === 'generic') {
      let digest;
      try {
        digest = buildSkinDigest({ plugin: found.plugin });
      } catch (e) {
        return { ok: false, error: '生成结构摘要失败：' + ((e && e.message) || e) };
      }
      if (!digest || digest.sourceBytes === 0) {
        return { ok: false, error: '读不到该皮肤包的客户端源码（client.js / lib/client.js），无法做全文承接' };
      }
      try {
        const res = await analyzeSkin({
          baseURL,
          apiKey: key,
          model,
          plugin: found.plugin,
          stylesCss,
          indexHtml,
          digest,
          tone,
          onProgress,
        });
        return {
          ...res,
          hadKey: key !== undefined,
          kind: 'skin',
          // 给界面看的摘要统计（不把整份摘要回渲染层，没必要也太大）
          digestStats: {
            sourceBytes: digest.sourceBytes,
            colors: digest.colors.length,
            assets: digest.assets.length,
            assetsPresent: digest.assets.filter((a) => a.exists).length,
            rules: digest.rules.length,
          },
        };
      } catch (e) {
        return { ok: false, error: (e && e.message) || String(e) };
      }
    }

    let migration;
    try {
      migration = buildMigration({ plugin: found.plugin, schemeId, tone, stylesCss });
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
    try {
      const res = await analyzeTheme({
        baseURL,
        apiKey: key,
        model,
        plugin: { ...found.plugin, __unmapped: migration.notes },
        stylesCss,
        indexHtml,
        migration,
        onProgress,
      });
      return { ...res, hadKey: key !== undefined, migrationId: migration.id };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });

  ipcMain.handle('theme:install', async (_e, { migrations, analysis } = {}) => {
    if (!Array.isArray(migrations) || migrations.length === 0) return { ok: false, error: '没有要安装的主题' };
    const store = readThemeStore();
    const byId = new Map(store.themes.map((t) => [t.id, t]));
    const added = [];
    const replaced = [];
    for (const m of migrations) {
      if (!m || typeof m.id !== 'string' || !m.tokens) continue;
      const merged = {
        ...m,
        // 模型分析是**增量**：accent 覆盖 brand-primary（仅在分析判定需要时），
        // css 追加在免费路径的 css 之后，notes 追加。
        analysis: analysis || null,
        css: [m.css || '', (analysis && analysis.css) || ''].filter(Boolean).join('\n\n'),
        tokens: { ...m.tokens, ...((analysis && analysis.tokens) || {}) },
        notes: [
          ...(m.notes || []),
          ...((analysis && analysis.accent)
            ? [`模型派生强调色 ${analysis.accent}（${analysis.accentReason || '未说明理由'}）`]
            : []),
          ...((analysis && analysis.unmapped) || []).map((u) => `无法承接：${u}`),
          ...((analysis && analysis.dropped && analysis.dropped.length)
            ? [`模型产出被净化丢弃 ${analysis.dropped.length} 处：${analysis.dropped.slice(0, 3).join('；')}`]
            : []),
        ],
      };
      if (analysis && analysis.accent) {
        merged.tokens['--dsw-alias-brand-primary'] = analysis.accent;
        merged.accentOverride = analysis.accent;
      }
      if (byId.has(merged.id)) replaced.push(merged.id);
      else added.push(merged.id);
      byId.set(merged.id, merged);
    }
    store.themes = [...byId.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const updatedAt = writeThemeStore(store);
    return { ok: true, added, replaced, total: store.themes.length, updatedAt };
  });

  ipcMain.handle('theme:list', async () => {
    const store = readThemeStore();
    return { ok: true, ...store, file: THEME_STORE_FILE };
  });

  ipcMain.handle('theme:remove', async (_e, id) => {
    const store = readThemeStore();
    const before = store.themes.length;
    store.themes = store.themes.filter((t) => t.id !== id);
    if (store.themes.length === before) return { ok: false, error: '未找到该主题' };
    const updatedAt = writeThemeStore(store);
    return { ok: true, removed: id, total: store.themes.length, updatedAt };
  });

  ipcMain.handle('theme:clear', async () => {
    const store = readThemeStore();
    const n = store.themes.length;
    store.themes = [];
    writeThemeStore(store);
    return { ok: true, removed: n };
  });

  ipcMain.handle('theme:revealPlugin', async (_e, pluginId) => {
    const found = findThemePlugin(pluginId);
    if (!found.ok) return { ok: false, error: found.error };
    // 打开文件管理器是**副作用**，由调用方注入（主进程传 shell.openPath）；
    // 端到端测试传 no-op，就不用在测试里弹资源管理器。
    if (revealPath) {
      const err = await revealPath(found.plugin.dir);
      if (err) return { ok: false, error: String(err), dir: found.plugin.dir };
    }
    return { ok: true, dir: found.plugin.dir };
  });

  ipcMain.handle('theme:revealStore', async () => {
    if (!fs.existsSync(THEME_STORE_FILE)) return { ok: false, error: '还没有迁移过任何主题' };
    if (showInFolder) showInFolder(THEME_STORE_FILE);
    return { ok: true, file: THEME_STORE_FILE };
  });

  return { THEME_STORE_FILE, readThemeStore, scanThemes, findThemePlugin };
}

module.exports = { registerThemeIpc };
