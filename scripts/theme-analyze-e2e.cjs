/* theme-analyze-e2e.cjs —— 模型精修链路的端到端验证（不花钱）
 *
 * 「用模型解析主题包源码」这条路径要验证的东西很多：提示词是否带够了事实、
 * 请求形状对不对、模型返回的 CSS / token 会不会被正确净化、分析结果是否真的
 * 落进主题库。真调一次用户配置的模型要花用户的钱，所以这里起一个**本地假端点**
 * 扮演模型：它按真实 OpenAI 兼容格式回一个精心构造的响应，里面故意混进
 * 应该被丢弃的内容（不存在的选择器 / position:fixed / 非法 token 名 / url()）。
 *
 * 于是这条测试同时证明两件事：
 *   ① 管路是通的（请求发出去了、响应解析了、结果写库了）
 *   ② 净化是真的在拦（坏东西没进主题库）
 *
 * 另外顺带验证 theme:routes 的路由解析（用桩 RPC 喂它一份 settings.describe + llm.models）。
 *
 * 跑法（cwd 必须是仓库根）：
 *   env -u ELECTRON_RUN_AS_NODE node node_modules/electron/cli.js scripts/theme-analyze-e2e.cjs
 * 输出：%TEMP%\theme-analyze-e2e.json
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

app.disableHardwareAcceleration();
['no-sandbox', 'disable-gpu', 'disable-software-rasterizer', 'in-process-gpu']
  .forEach((s) => app.commandLine.appendSwitch(s));

const ROOT = process.env.DESKTOP_ROOT || 'D:/DS_harness';
const DSH_HOME = path.join(os.homedir(), '.dsh');
const STORE_FILE = path.join(DSH_HOME, 'desktop-themes.json');
const RESULT = path.join(os.tmpdir(), 'theme-analyze-e2e.json');
const THEME_ID = 'dsh-neo-skin:newspaper:light';

const { registerThemeIpc } = require(path.join(ROOT, 'lib', 'theme-ipc.js'));

const failures = [];
const steps = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 假模型端点 ----------
// 刻意混入 4 处应被丢弃的内容：
//   · .no-such-class   —— 桌面端不存在的类名
//   · position:fixed   —— 禁用声明
//   · tokens 里的 --bad-token 与 url(...) —— 非法 token 名 / 禁用值
const FAKE_ANALYSIS = {
  accent: 'rgb(163, 74, 53)',
  accentReason: '源主题 newspaper/light 的 brand-primary 是灰阶，从它自己的暖色族派生',
  tokens: { '--dsw-alias-brand-primary': 'rgb(163, 74, 53)', '--bad-token': 'red', '--dsw-alias-x': 'url(http://evil)' },
  css: [
    '.chat-session { color: #4A3A28 !important; }',
    '.no-such-class { color: red; }',
    '.card { position: fixed; border-color: #4A3A28; }',
    'body { font-family: Georgia, serif; }',
  ].join('\n'),
  behavior: [
    { feature: '开 / 关开关', verdict: 'native', detail: '桌面端主题下拉本身就是开关语义' },
    { feature: '方案切换', verdict: 'carried', detail: '每个方案档位已展开成独立下拉项' },
    { feature: '把设置行注册进 WebUI 的通用设置', verdict: 'unavailable', detail: '桌面端设置页是自有 DOM，插件无法注入' },
  ],
  unmapped: ['_badge 在桌面端最接近 .mk-badge，但语义是通用徽标，未强行映射'],
  confidence: 'high',
};

let serverUrl = '';
let seenRequest = null;

function startFakeModel() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch { /* 记原文 */ }
        seenRequest = {
          method: req.method,
          url: req.url,
          auth: req.headers.authorization || '',
          body: parsed,
          rawLength: body.length,
        };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'fake-1',
          object: 'chat.completion',
          model: 'fake-model',
          choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(FAKE_ANALYSIS) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1234, completion_tokens: 567, total_tokens: 1801 },
        }));
      });
    });
    srv.listen(0, '127.0.0.1', () => {
      serverUrl = `http://127.0.0.1:${srv.address().port}/v1`;
      resolve(srv);
    });
  });
}

// ---------- 前置状态备份 ----------
const storeExisted = fs.existsSync(STORE_FILE);
const storeBackup = storeExisted ? fs.readFileSync(STORE_FILE, 'utf8') : null;

// ---------- 真实主题 IPC：RPC 桩里喂一条"已配置的路由" ----------
const themeApi = registerThemeIpc({
  ipcMain,
  dshHome: DSH_HOME,
  appDir: ROOT,
  discoverHarness: () => ({ dir: 'D:/DSH/harness' }),
  // 假模型端点不需要真密钥；这里给个引用名，验证 hasKey 的判定链路
  readCredentialPlaintext: (ref) => (ref === 'FAKE_KEY' ? 'sk-fake-plaintext' : undefined),
  rpcCall: async (method) => {
    if (method === 'settings.describe') {
      return {
        ok: true,
        value: {
          writable: true,
          namespaces: [{
            ns: 'llm-pi-ai',
            value: {
              providers: {
                'fake-route': {
                  baseURL: serverUrl,
                  apiKeyEnv: 'FAKE_KEY',
                  models: [{ id: 'fake-model' }],
                  displayName: '假模型路由',
                },
                'no-endpoint-route': { models: [{ id: 'x' }] },   // 没端点 → 应被过滤
              },
            },
          }],
        },
      };
    }
    if (method === 'llm.models') {
      return {
        ok: true,
        value: {
          groups: [
            { id: 'fake-route', name: '假模型路由', models: [{ id: 'fake-model', name: 'Fake' }] },
            { id: 'dangling', name: '无端点的组', models: [{ id: 'y' }] },   // 没端点 → 应被过滤
          ],
          failures: [],
        },
      };
    }
    if (method === 'credentials.describe') {
      return { ok: true, value: { credentials: { FAKE_KEY: { configured: true, writable: true } } } };
    }
    return { ok: false, error: 'stub(' + method + ')' };
  },
  revealPath: async () => '',
  showInFolder: () => {},
});

// ---------- 其余通道桩 ----------
const preloadSrc = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
const channels = [...new Set([...preloadSrc.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((m) => m[1]))];
for (const ch of channels) {
  if (ch.startsWith('theme:')) continue;
  ipcMain.handle(ch, async () => ({
    ok: false, error: 'stub(' + ch + ')', items: [], list: [], namespaces: [], providers: [], models: [], sessions: [], presets: [], plugins: [], themes: [],
  }));
}

(async () => {
  const report = { ok: false, failures, steps };
  const watchdog = setTimeout(() => {
    try { fs.writeFileSync(RESULT, JSON.stringify({ ...report, error: 'watchdog' }, null, 2)); } catch (e) {}
    app.exit(3);
  }, 120000);

  await app.whenReady();
  const srv = await startFakeModel();

  const win = new BrowserWindow({
    show: false, width: 900, height: 600,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  await wait(2200);

  const call = (expr) => win.webContents.executeJavaScript(expr, true);

  // ---------- 1. 路由解析 ----------
  const routes = await call('window.api.themeRoutes()');
  steps.push({ step: '1 · theme:routes 路由解析', detail: routes });
  if (!routes || !routes.ok) failures.push(`theme:routes 失败：${JSON.stringify(routes)}`);
  else {
    const ids = routes.routes.map((r) => r.provider);
    if (!ids.includes('fake-route')) failures.push(`应解析出 fake-route，实际 ${ids.join(',') || '(空)'}`);
    if (ids.includes('no-endpoint-route')) failures.push('没端点的路由不该出现（no-endpoint-route）');
    if (ids.includes('dangling')) failures.push('没端点的模型分组不该出现（dangling）');
    const r = routes.routes.find((x) => x.provider === 'fake-route');
    if (!r || r.baseURL !== serverUrl) failures.push(`baseURL 解析错误：${r && r.baseURL}`);
    if (!r || r.apiKeyEnv !== 'FAKE_KEY') failures.push(`apiKeyEnv 解析错误：${r && r.apiKeyEnv}`);
    if (!r || r.hasKey !== true) failures.push(`hasKey 应为 true（凭据已配置），实际 ${r && r.hasKey}`);
    if (!r || r.models.indexOf('fake-model') < 0) failures.push('模型清单缺失');
  }

  // ---------- 2. 模型精修 ----------
  const analysis = await call(`window.api.themeAnalyze(${JSON.stringify({
    pluginId: 'dsh-neo-skin', schemeId: 'newspaper', tone: 'light',
    baseURL: serverUrl, apiKeyEnv: 'FAKE_KEY', model: 'fake-model',
  })})`);
  steps.push({
    step: '2 · theme:analyze 返回',
    detail: {
      ok: analysis && analysis.ok,
      有密钥: analysis && analysis.hadKey,
      置信度: analysis && analysis.analysis && analysis.analysis.confidence,
      强调色: analysis && analysis.analysis && analysis.analysis.accent,
      修正token数: analysis && analysis.analysis ? Object.keys(analysis.analysis.tokens || {}).length : 0,
      净化丢弃: (analysis && analysis.dropped) || [],
      usage: analysis && analysis.usage,
    },
  });
  if (!analysis || !analysis.ok) failures.push(`分析失败：${JSON.stringify(analysis)}`);

  // 请求侧：确认提示词与形状
  const req = seenRequest || {};
  const sentSystem = req.body && req.body.messages && req.body.messages[0] ? req.body.messages[0].content : '';
  const sentUser = req.body && req.body.messages && req.body.messages[1] ? req.body.messages[1].content : '';
  steps.push({
    step: '3 · 发出去的请求',
    detail: {
      方法: req.method, 路径: req.url,
      带鉴权头: !!req.auth,
      模型: req.body && req.body.model,
      温度: req.body && req.body.temperature,
      json模式: !!(req.body && req.body.response_format),
      提示词字节: sentSystem.length + sentUser.length,
      提示词含桌面端类名清单: /chat-session/.test(sentUser),
      提示词含主题事实: /--dsw-alias-bg-base/.test(sentUser),
      提示词含未映射线索: /免费路径/.test(sentUser),
    },
  });
  if (req.method !== 'POST') failures.push('应为 POST');
  if (!/\/chat\/completions$/.test(req.url || '')) failures.push(`路径应以 /chat/completions 结尾，实际 ${req.url}`);
  if (!req.auth) failures.push('没有带上 Authorization 头（密钥没从凭据库取到）');
  if (req.body && req.body.model !== 'fake-model') failures.push('请求里的模型名不对');
  if (!(req.body && req.body.response_format && req.body.response_format.type === 'json_object')) failures.push('没有要求 JSON 输出');
  if (sentSystem.length + sentUser.length < 3000) failures.push(`提示词太短（${sentSystem.length + sentUser.length}），可能没带够事实`);
  if (!/chat-session/.test(sentUser)) failures.push('提示词里没给桌面端可用类名清单');
  if (!/--dsw-alias-bg-base/.test(sentUser)) failures.push('提示词里没给主题包的变量事实');

  // 净化侧：坏东西必须被拦下
  const a = (analysis && analysis.analysis) || {};
  steps.push({
    step: '4 · 净化结果',
    detail: {
      保留的CSS: a.css,
      保留的token: a.tokens,
      丢弃明细: analysis && analysis.dropped,
      行为层: a.behavior,
      无法承接: a.unmapped,
    },
  });
  if (!/@?\.no-such-class/.test(FAKE_ANALYSIS.css) === false) { /* 源里确实有，见下断言 */ }
  if (/no-such-class/.test(a.css || '')) failures.push('不存在的选择器没被丢弃（.no-such-class 进库了）');
  if (/position\s*:\s*fixed/.test(a.css || '')) failures.push('禁用声明 position:fixed 没被丢弃');
  if (!/\.chat-session/.test(a.css || '')) failures.push('合法的 .chat-session 规则被误丢');
  if (!/body\s*\{/.test(a.css || '')) failures.push('合法的 body 规则被误丢');
  if (Object.prototype.hasOwnProperty.call(a.tokens || {}, '--bad-token')) failures.push('非法 token 名没被丢弃');
  if (Object.prototype.hasOwnProperty.call(a.tokens || {}, '--dsw-alias-x')) failures.push('含 url() 的 token 没被丢弃');
  if ((a.tokens || {})['--dsw-alias-brand-primary'] !== 'rgb(163, 74, 53)') failures.push('合法的 brand-primary 修正被误丢');
  if ((analysis && analysis.dropped || []).length !== 4) failures.push(`应丢弃 4 处，实际 ${((analysis && analysis.dropped) || []).length}：${JSON.stringify((analysis && analysis.dropped) || [])}`);
  if (!a.behavior || a.behavior.length !== 3) failures.push('行为层结论没解析出来');

  // ---------- 5. 安装（免费迁移 + 模型分析合并）----------
  const mig = await call(`window.api.themeMigrate('dsh-neo-skin','newspaper','light')`);
  if (!mig || !mig.ok) failures.push('迁移失败，无法验证合并');
  else {
    const inst = await call(`window.api.themeInstall(${JSON.stringify(mig.migrations)}, ${JSON.stringify(a)})`);
    steps.push({ step: '5 · 合并写库', detail: inst });
    if (!inst || !inst.ok) failures.push('写库失败');
    const stored = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')).themes.find((t) => t.id === THEME_ID);
    steps.push({
      step: '6 · 落盘的条目',
      detail: stored ? {
        id: stored.id, label: stored.label,
        accentOverride: stored.accentOverride,
        brandPrimary: stored.tokens['--dsw-alias-brand-primary'],
        css末尾: (stored.css || '').slice(-120),
        notes: stored.notes,
        analysisConfidence: stored.analysis && stored.analysis.confidence,
      } : '(未找到)',
    });
    if (!stored) failures.push('落盘的条目没找到');
    else {
      if (stored.accentOverride !== 'rgb(163, 74, 53)') failures.push(`accentOverride 未写入：${stored.accentOverride}`);
      if (stored.tokens['--dsw-alias-brand-primary'] !== 'rgb(163, 74, 53)') failures.push('模型派生的 brand-primary 没覆盖值');
      if (!/color: #4A3A28/.test(stored.css || '')) failures.push('模型补译的 CSS 没合并进主题的 css');
      if (!(stored.notes || []).some((n) => /模型派生强调色/.test(n))) failures.push('notes 里没记录派生强调色');
      if (!(stored.notes || []).some((n) => /_badge/.test(n))) failures.push('notes 里没记录"无法承接"项');
      if (!(stored.notes || []).some((n) => /净化丢弃 4 处/.test(n))) failures.push('notes 里没记录被净化丢弃的数量');
      if (!stored.analysis || stored.analysis.confidence !== 'high') failures.push('analysis 没落盘');
    }
    await call(`window.api.themeRemove(${JSON.stringify(THEME_ID)})`);
  }

  // ---------- 收尾 ----------
  if (storeExisted) fs.writeFileSync(STORE_FILE, storeBackup, 'utf8');
  else if (fs.existsSync(STORE_FILE)) fs.unlinkSync(STORE_FILE);
  report.storeRestored = true;

  clearTimeout(watchdog);
  report.ok = failures.length === 0;
  fs.writeFileSync(RESULT, JSON.stringify(report, null, 2), 'utf8');
  process.stdout.write(`result -> ${RESULT}\n`);
  srv.close();
  app.exit(report.ok ? 0 : 5);
})().catch((err) => {
  try { fs.writeFileSync(RESULT, JSON.stringify({ ok: false, failures, steps, error: String((err && err.stack) || err) }, null, 2)); } catch (e) {}
  try {
    if (storeExisted) fs.writeFileSync(STORE_FILE, storeBackup, 'utf8');
    else if (fs.existsSync(STORE_FILE)) fs.unlinkSync(STORE_FILE);
  } catch (e) { /* 还原失败也要报主错误 */ }
  app.exit(4);
});
