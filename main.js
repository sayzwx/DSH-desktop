const { app, BrowserWindow, ipcMain, shell, dialog, net, nativeTheme } = require('electron');
const { Tray, Menu, nativeImage, Notification } = require('electron');
const { spawn, spawnSync, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { probeModelCapabilities, ENGINE_LEVELS, WIRE_CANDIDATES } = require('./lib/model-probe.js');
const { registerThemeIpc } = require('./lib/theme-ipc.js');
const { downloadToFile, pickWritableDir, isPeFile } = require('./lib/download.js');

// 分发安装布局：app（含 DSH.exe）与 harness、tools/node 同级（默认 %LOCALAPPDATA%\DSH\{app,harness,tools}）。
// harness 引擎不再写死某个路径：点击启动时自动探测本机已有安装（可用 DSH_HARNESS_DIR 显式指定源码目录），
// 探测不到就自动安装官方发行包/运行 installer/setup.ps1 -EngineOnly 拉取官方引擎。
// 安装根目录 = 应用自身所在位置向上推导（打包形态 {root}\app\resources\app → {root}）：
// 用户只要把「安装位置」选到任意目录，app / harness / tools 都会落在该目录下，自动适配，绝不绑开发者本机路径。
function getLayoutRoot() {
  if (process.defaultApp) return __dirname; // dev 形态（npm start）：__dirname 即仓库根
  return path.resolve(__dirname, '..', '..', '..'); // 打包形态
}
const LAYOUT_ROOT = getLayoutRoot();
// 安装根目录（旧版固定布局兼容 + 引擎/工具的默认落点）：按平台解析。
// 打包形态优先用 app 相对推导的 LAYOUT_ROOT；DSH_ROOT 是次级兜底与历史固定布局，
// 各平台都只作为"候选"参与探测（存在性逐一校验），不存在就跳过，绝不绑开发者本机路径。
function resolveDshRoot() {
  if (process.platform === 'win32') {
    return process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'DSH') : '';
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'DSH');
  }
  // linux / 其他 POSIX：遵循 XDG 数据目录约定
  const xdg = process.env.XDG_DATA_HOME;
  return path.join(xdg || path.join(os.homedir(), '.local', 'share'), 'DSH');
}
const DSH_ROOT = resolveDshRoot();
const DSH_HOME = path.join(os.homedir(), '.dsh');
const PORT = 3080;
const LOG_LIMIT = 5000;

// 解析 Node 可执行文件：显式 DSH_NODE_EXE → 安装布局 tools/node（安装根目录）→ 与 app 同级 tools/node → PATH 上的 node
// node 二进制名按平台取（Windows 是 node.exe，mac/linux 是 node）。
function resolveNodeExe() {
  const bin = process.platform === 'win32' ? 'node.exe' : 'node';
  const cands = [
    process.env.DSH_NODE_EXE || '',
    path.join(LAYOUT_ROOT, 'tools', 'node', bin),
    DSH_ROOT ? path.join(DSH_ROOT, 'tools', 'node', bin) : '',
  ];
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  return 'node';
}

// 首启兜底：确保桌面快捷方式存在（安装器已创建；这里防止安装器异常/手改布局后缺失时补上）。
// 仅打包形态（DSH.exe）执行，dev 运行（electron .）跳过。实现走独立 ps1 文件（-File 传参，
// 避免 -Command 内嵌引号被 Windows 命令行解析破坏）。
function ensureShortcut() {
  if (process.platform !== 'win32' || process.defaultApp) return;
  try {
    const script = path.join(__dirname, 'ensure-shortcut.ps1');
    if (!fs.existsSync(script)) return;
    const exe = process.execPath;
    const dir = path.dirname(exe);
    const ico = path.join(dir, 'DSH.ico');
    spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-ExePath', exe, '-WorkingDir', dir, '-IconPath', ico], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
  } catch { /* 非 Windows/无桌面会话等环境忽略 */ }
}

// 当前实际使用的 harness 目录（用于插件目录扫描等路径逻辑；启动后动态刷新）
let HARNESS_DIR = '';

let mainWindow = null;
let harnessProc = null;
let harnessState = 'stopped';
let startDeadline = 0;
let webUpAt = 0; // 本次启动进程是否曾就绪（用于区分“崩溃”与“正常退出”）
const logBuffer = [];

// ---------- 后台驻留：托盘 / 关闭窗口不杀服务 / 单实例 ----------
// 需求 #4：关闭窗口/重启应用不要断掉 harness 服务（除非用户主动停止）。
// 方案：窗口关闭时隐藏到托盘（不退出进程、不杀 harness），单实例锁保证再次启动时
// 只是唤回已存在的托盘窗口；只有用户从托盘/UI 明确选择「停止 Harness 并退出」才真正退出。
let tray = null;
let isQuitting = false; // 用户主动退出（含更新安装），此时才触发真正退出
let winWasVisible = false; // 窗口关闭前是否可见（判断是否被用户刚关闭）

function createTray() {
  if (tray || process.platform !== 'win32') return;
  let icon;
  try {
    const ico = path.join(__dirname, 'DSH.ico');
    icon = fs.existsSync(ico) ? nativeImage.createFromPath(ico) : null;
  } catch { /* ignore */ }
  tray = new Tray(icon || nativeImage.createEmpty());
  tray.setToolTip('DSH Desktop — 后台服务运行中');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => showMainWindow() },
    { type: 'separator' },
    {
      label: harnessState === 'running' ? '停止 Harness 服务' : '启动 Harness',
      click: () => {
        if (harnessState === 'running' || harnessProc) stopHarness();
        else startHarness();
        refreshTrayMenu();
      },
    },
    { type: 'separator' },
    {
      label: '退出（停止 Harness 并退出）',
      click: () => {
        isQuitting = true;
        try { if (harnessProc) stopHarness(); } catch { /* ignore */ }
        app.quit();
      },
    },
  ]));
  tray.on('click', () => showMainWindow());
  updateTrayState();
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => showMainWindow() },
    { type: 'separator' },
    { label: harnessState === 'running' || harnessProc ? '停止 Harness 服务' : '启动 Harness', click: () => {
      if (harnessState === 'running' || harnessProc) stopHarness();
      else startHarness();
      refreshTrayMenu();
    } },
    { type: 'separator' },
    { label: '退出（停止 Harness 并退出）', click: () => {
      isQuitting = true;
      try { if (harnessProc || harnessState === 'running') stopHarness(); } catch { /* ignore */ }
      app.quit();
    } },
  ]));
}

function updateTrayState() {
  if (!tray) return;
  tray.setToolTip(`DSH Desktop — ${harnessState === 'running' ? '服务运行中' : harnessState === 'installing' ? '正在安装引擎' : harnessState === 'starting' ? '启动中' : '服务已停止'}`);
}

function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

// 开发实例隔离：单实例锁按 userData 路径判定，开发副本与已安装的正式版共用同一 userData 时，
// 从仓库启动的实例拿不到锁会立即退出并聚焦到正式版窗口——"改的是开发副本、测的是正式版"，
// 且不会报任何错。设 DSH_DEV_INSTANCE=<tag> 把 userData 指到同级独立目录，两者即可并存。
// 必须在 requestSingleInstanceLock 之前设置才生效。
if (process.env.DSH_DEV_INSTANCE) {
  const prodUserData = app.getPath('userData');
  app.setPath('userData', `${prodUserData}-dev-${process.env.DSH_DEV_INSTANCE}`);
}

// 单实例：再次双击 DSH.exe / 快捷方式时唤回既有窗口，而不是开第二个进程
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
}

function pushLog(stream, text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  for (const line of lines) {
    logBuffer.push({ t: Date.now(), stream, line });
    if (logBuffer.length > LOG_LIMIT) logBuffer.shift();
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('harness:log', lines.map((line) => ({ t: Date.now(), stream, line })));
  }
}

function setState(state) {
  harnessState = state;
  if (state === 'running') openChatStreams();
  if (state === 'stopped') closeChatStreams();
  updateTrayState();
  if (state === 'running' || state === 'stopped') refreshTrayMenu();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('harness:state', state);
  }
}

// ---------- Harness 引擎发现：不再写死路径，按优先级探测本机已有安装 ----------
// 支持两种形态：
//   1) 源码目录：apps/cli/lib/bin.js（安装器布局 %LOCALAPPDATA%\DSH\harness 或环境变量 DSH_HARNESS_DIR 指定）
//   2) 发行包：@deepseek-ai/dsh/lib/bin.js（npm 全局安装或 npx 缓存里的官方发行版）
// npm 调用统一走「捆绑 Node 的 npm-cli.js」（随安装包分发，目标机无需系统 Node/npm）：
//   node <tools\node>\node_modules\npm\bin\npm-cli.js <args>
// 捆绑 node 不可用时才回退系统 npm（Windows 上 npm 只有 .cmd，经 cmd.exe 包一层）。
function npmCmd() {
  const nodeExe = resolveNodeExe();
  if (!nodeExe || nodeExe === 'node') return null;
  const cli = path.join(path.dirname(nodeExe), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (fs.existsSync(cli)) return { nodeExe, cli };
  return null;
}
function npmSpawnSync(args, opts = {}) {
  const n = npmCmd();
  if (n) return spawnSync(n.nodeExe, [n.cli, ...args], { windowsHide: true, encoding: 'utf8', ...opts });
  const win = process.platform === 'win32';
  const cmd = win ? 'cmd.exe' : 'npm';
  const params = win ? ['/c', 'npm', ...args] : args;
  return spawnSync(cmd, params, { windowsHide: true, encoding: 'utf8', ...opts });
}
function npmSpawn(args, opts = {}) {
  const n = npmCmd();
  if (n) return spawn(n.nodeExe, [n.cli, ...args], { windowsHide: true, ...opts });
  const win = process.platform === 'win32';
  const cmd = win ? 'cmd.exe' : 'npm';
  const params = win ? ['/c', 'npm', ...args] : args;
  return spawn(cmd, params, { windowsHide: true, ...opts });
}
// 不绑定任何本地路径：仅扫「安装根同级」与「环境变量」指定的引擎位置（用户选什么目录都适配）。
// 历史教训：扫盘符根/用户目录会绑定开发者本机路径（如 D:\DeepSeek-Harness），换机器就失效。
function commonEngineCandidatePaths() {
  const out = [];
  try {
    // 安装根同级的 harness（便携/打包布局：app 与 harness 同级）
    if (DSH_ROOT) out.push(path.join(DSH_ROOT, 'harness'));
    // app 同级（dev 形态 __dirname/../harness）
    out.push(path.join(__dirname, '..', 'harness'));
  } catch { /* ignore */ }
  return out;
}

// 引擎完整性检测：bin.js 存在只是“外壳”，依赖安装中断（pnpm 链接失效/空目录）时启动必崩
// （典型报错 ERR_MODULE_NOT_FOUND）。这里检查 @deepseek-ai 核心包是否真实存在且非空目录。
function checkHarnessIntegrity(dir, kind) {
  const missing = [];
  // 关键包白名单：必须覆盖引擎运行时实际 require 的核心 cordis 插件 + 应用层服务。
  // 历史教训：0.5.3 只列 dsh-app-boot / cordis-plugin-loader，结果 npx 缓存里的 dist 形态
  // 只装了这两个，cordis-plugin-timer / dsh-llm / dsh-session 等运行时插件完全没装，
  // 完整性检查放行 → 启动崩 ERR_MODULE_NOT_FOUND。这里把已知必装的全部列入。
  // 注意（v0.6.2 实测修正）：dsh-typert-loader / dsh-typert-registry 是 rc.7 及更早的包名，
  // rc.8 里无人依赖、无链接（typert 整合进 packages/typert 子目录，仅构建期用），列入只会
  // 误报「依赖不完整」把完整源码引擎拒掉。rc.8 启动链路的真实必需包以 apps/cli 实际链接为准：
  // dsh-app-boot / cordis-plugin-loader / cordis-plugin-timer / dsh-llm / dsh-session /
  // dsh-base / dsh-web-app（后两者是 web profile 的 bundle 层，缺失时 web 起不来）。
  const keyPkgs = [
    'dsh-app-boot',
    'cordis-plugin-loader',
    'cordis-plugin-timer',
    'dsh-llm',
    'dsh-session',
    'dsh-base',
    'dsh-web-app',
  ];
  if (kind === 'source' && !fs.existsSync(path.join(dir, 'apps', 'web', 'dist', 'index.html'))) {
    missing.push('web 前端 dist 缺失');
  }
  // 依赖作用域：源码形态在仓库内 node_modules（pnpm workspace 链接）；发行包形态
  // 依赖可能与其同级、或被 npm hoist 到上级 node_modules 根（全局安装典型场景），全部覆盖。
  const scopes = kind === 'dist'
    ? [
        path.join(dir, 'node_modules', '@deepseek-ai'),   // 嵌套安装（包自带 node_modules）
        path.join(dir, '..', '@deepseek-ai'),             // 与 dsh 同级（@deepseek-ai 目录内）
        path.join(dir, '..', '..', '@deepseek-ai'),       // npm 全局 hoist 到 node_modules 根
      ]
    : [
        path.join(dir, 'node_modules', '@deepseek-ai'),
        path.join(dir, 'apps', 'cli', 'node_modules', '@deepseek-ai'),
        path.join(dir, 'apps', 'web', 'node_modules', '@deepseek-ai'),
      ];
  let hitScope = false;
  // 任一 scope 独立判定：该 scope 下 keyPkgs 全部存在且非空即为该引擎的依赖位置。
  // 修正（v0.6.2）：pnpm workspace（源码形态）的 keyPkgs 分散在根/apps/cli/apps/web 各自的
  // node_modules，旧逻辑「只看第一个命中的 scope」会把完整源码引擎误判为残缺（根 node_modules
  // 的 @deepseek-ai 只含少量直接依赖）。改为「任一 scope 全齐即通过」。
  let scopeOk = false;
  for (const scope of scopes) {
    if (!fs.existsSync(scope)) continue;
    hitScope = true;
    let scopeMissing = 0;
    for (const pkg of keyPkgs) {
      const p = path.join(scope, pkg);
      if (!fs.existsSync(p)) { scopeMissing++; continue; }
      let n = 0;
      try { n = fs.readdirSync(p).length; } catch { n = 0; }
      if (n === 0) scopeMissing++;
    }
    if (scopeMissing === 0) { scopeOk = true; break; }
  }
  if (!hitScope) missing.push('未找到 @deepseek-ai 依赖目录');
  else if (!scopeOk) missing.push('@deepseek-ai 核心包不全（任一依赖 scope 均缺 keyPkgs）');
  // 兜底启发式：发行包形态（dist）必须至少有 N 个非空 @deepseek-ai 子包；过少视为残缺
  // （如 npx 缓存里只装了 2~3 个核心包就放行，导致运行时缺链上插件）。
  if (scopeOk && kind === 'dist') {
    try {
      const base = scopes[0];
      const subs = fs.readdirSync(base).filter((s) => {
        try { return fs.statSync(path.join(base, s)).isDirectory() && fs.readdirSync(path.join(base, s)).length > 0; }
        catch { return false; }
      });
      // 必须至少有 6 个非空子包（dsh-app-boot / cordis-plugin-loader / cordis-plugin-timer /
      // dsh-llm / dsh-session / dsh-base / dsh-web-app ...），少于则视为残缺
      if (subs.length < 6) missing.push(`@deepseek-ai 仅 ${subs.length} 个非空子包，依赖明显不完整`);
    } catch { /* 忽略 */ }
  }
  // ========== 关键修正（v0.6.2）：dist 引擎的 profile 判据 ==========
  // 历史：曾要求 ~/.dsh/profiles/web/node_modules/@deepseek-ai/ 含核心包，但实测（v0.6.2）证明
  // 这是误判——rc.8 引擎通过 healProfilesModuleFallback 把 profile 缺失的 peer 依赖
  // fallback 到引擎自身 node_modules（profiles/node_modules 链接），profile 里只需装插件
  // （如 dshmarket），@deepseek-ai/* 完全不需要出现在 profile 中。Web 启动 + dshmarket 加载
  // 均验证通过。真正要防的是「profile 未初始化」（cordis 没有组合目标），改为检查：
  //   1) profile 目录存在且 package.json 含 dsh.profile.bundles（已初始化）
  //   2) bundles 里声明的 @deepseek-ai/* 层在引擎依赖 scope 中可解析（keyPkgs 已覆盖 dsh-base/dsh-web-app）
  if (kind === 'dist') {
    const profDirs = [
      path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'profiles', 'web'),
      path.join(os.homedir(), '.dsh', 'profiles', 'web'),
    ];
    let profileInit = false;
    for (const pd of profDirs) {
      const pj = path.join(pd, 'package.json');
      if (!fs.existsSync(pj)) continue;
      try {
        const m = JSON.parse(fs.readFileSync(pj, 'utf8'));
        const bundles = m?.dsh?.profile?.bundles;
        if (Array.isArray(bundles) && bundles.length > 0) profileInit = true;
        break;
      } catch { /* 损坏的 manifest 视为未初始化 */ }
    }
    if (!profileInit) missing.push('profile 未初始化（~/.dsh/profiles/web 缺 bundle 层）——dist 引擎不可用，请用 Setup 引擎或运行 setup.ps1 -EngineOnly');
  }
  return { ok: missing.length === 0, missing };
}

function discoverHarness() {
  const candidates = [];
  const push = (p) => { if (typeof p === 'string' && p && !candidates.includes(p)) candidates.push(p); };
  // 1) 显式环境变量（用户/管理员指定，优先级最高）
  push(process.env.DSH_HARNESS_DIR);
  // 2) 安装器布局（安装根目录，默认 %LOCALAPPDATA%\DSH）：因素 1 在自定义安装目录时也正确适配
  push(path.join(LAYOUT_ROOT, 'harness'));
  if (DSH_ROOT && DSH_ROOT !== LAYOUT_ROOT) push(path.join(DSH_ROOT, 'harness'));
  // 3) 与 app 同级的 harness（打包/便携布局）
  push(path.join(__dirname, '..', 'harness'));
  // 3.5) 常见用户目录 / 盘符根目录里的引擎源码（手工解压/克隆的 DeepSeek-Harness）
  for (const p of commonEngineCandidatePaths()) push(p);
  // 4) npm 全局安装的官方发行包
  try {
    const g = npmSpawnSync(['root', '-g']);
    const line = (g.stdout || '').split(/\r?\n/).find((l) => l.trim());
    if (line) push(path.join(line.trim(), '@deepseek-ai', 'dsh'));
  } catch { /* npm 不可用/未安装 */ }
  // 注意（v0.6.3 修正）：不再扫 npx 缓存目录（npm-cache\_npx\* / ~/.npm/_npx/*）。
  // npx 缓存是 npm 的临时下载残留，不是用户主动安装的引擎——它的 @deepseek-ai/dsh 自身
  // node_modules 看起来「齐全」（keyPkgs 都在），但 cordis 加载器从 ~/.dsh/profiles/web/
  // 解析依赖时，healProfilesModuleFallback 链接到 npx 缓存的 node_modules，而那里缺
  // dsh-client-ui-* / cordis-plugin-timer 等 client 包 → 启动必崩 ERR_MODULE_NOT_FOUND。
  // 更致命的是：discoverHarness 选中它就不会触发 autoInstall，exit 回调又重新选中它 →
  // 死循环「请再次点击重试」。去掉 npx 候选后，源码引擎不存在时 discoverHarness 返回 null
  // → autoInstall 触发 setup.ps1 -EngineOnly -DestDir LAYOUT_ROOT 装到用户所选目录。
  // 先收集所有候选形态，再做完整性过滤：不完整的引擎跳过（依赖缺包启动必崩），
  // 只返回第一个完整可用的引擎；全部不完整则返回 null → 触发自动获取/手动指引。
  const found = [];
  for (const dir of candidates) {
    const srcBin = path.join(dir, 'apps', 'cli', 'lib', 'bin.js');   // 源码形态
    if (fs.existsSync(srcBin)) found.push({ dir, bin: srcBin, kind: 'source' });
    const distBin = path.join(dir, 'lib', 'bin.js');                  // 发行包形态
    if (fs.existsSync(distBin) && !found.some((f) => f.dir === dir)) found.push({ dir, bin: distBin, kind: 'dist' });
  }
  for (const f of found) {
    const chk = checkHarnessIntegrity(f.dir, f.kind);
    if (chk.ok) return f;
    pushLog('stderr', `[引擎 ${f.dir} 依赖不完整（${chk.missing.join('、')}），已跳过]`);
  }
  if (found.length > 0) pushLog('stderr', '[本机引擎均不完整，将尝试自动修复/给出手动指引]');
  return null;
}

// 让 chat/上传等默认工作区落到一个真实存在的目录
function defaultWorkspaceDir() {
  return HARNESS_DIR || DSH_HOME || os.homedir();
}

async function startHarness() {
  if (harnessProc) return { ok: false, error: 'already running' };
  if (await checkWebUp()) {
    pushLog('stdout', '[检测到 :3080 已有实例在运行，已直接接管，无需再次启动]');
    setState('running');
    return { ok: true, adopted: true };
  }
  const found = discoverHarness();
  if (!found) {
    // 本机没有可用的 harness 引擎 → 自动获取（npm 官方发行包优先，失败则源码安装）
    pushLog('stdout', '[未检测到本机 harness 引擎，自动安装官方发行包…]');
    setState('installing');
    autoInstallHarness();
    return { ok: true, installing: true };
  }
  return launchHarness(found);
}

/**
 * 该引擎是否支持 `web --no-open`（启动后不自动打开系统默认浏览器）。
 *
 * 引擎默认 openBrowser=true：:3080 就绪后会自己弹一个浏览器窗口打开 WebUI
 * （packages/bundle/web-app 里 openBrowser z.boolean().default(true)，会打一行
 * "dsh web: opening the default browser; pass --no-open to disable"）。
 * 桌面端已经有「打开 Web 端」按钮，不需要引擎再弹一个 —— 用户 2026-09-29 反馈
 * 「启动应用还是会跳出 web 端」就是指它。
 *
 * 但**不能无条件传**：不支持该开关的引擎（老版本）会让 commander 因 unknown option
 * 直接退出，把「少弹一个窗口」变成「引擎起不来」。所以先探测，探测不到就不传。
 */
function engineSupportsNoOpen(dir) {
  if (!dir) return false;
  const cands = [
    path.join(dir, 'packages', 'bundle', 'web-app', 'lib', 'startup.js'),
    path.join(dir, 'packages', 'bundle', 'web-app', 'src', 'startup.ts'),
    path.join(dir, 'node_modules', '@deepseek-ai', 'dsh-bundle-web-app', 'lib', 'startup.js'),
  ];
  // 发行包形态：@deepseek-ai 下任何 *web-app* 包
  try {
    const scope = path.join(dir, 'node_modules', '@deepseek-ai');
    for (const n of fs.readdirSync(scope)) {
      if (/web-app/.test(n)) {
        cands.push(path.join(scope, n, 'lib', 'startup.js'), path.join(scope, n, 'dist', 'startup.js'));
      }
    }
  } catch { /* 没有该 scope 目录 */ }
  for (const f of cands) {
    try {
      if (fs.readFileSync(f, 'utf8').includes('no-open')) return true;
    } catch { /* 文件不存在，继续找 */ }
  }
  return false;
}

function launchHarness(found) {
  HARNESS_DIR = found.dir;
  setState('starting');
  startDeadline = Date.now() + 90 * 1000;
  webUpAt = 0;
  // 构建子进程环境：父进程环境 + ~/.dsh/.env。但由 .env 托管的密钥（DEEPSEEK_API_KEY）
  // 不注入启动环境——否则 harness 的 credentials-local 视其为「启动环境只读」（source:'env',
  // writable:false），credentials.set/setApiKey 的实时同步会被拒（"supplied read-only by the
  // launching environment"）。harness 会自己读 ~/.dsh/.env 与 ~/.dsh/.credentials.yaml，
  // 路由不受影响，且凭据服务恢复可写。
  const harnessEnv = loadDotEnv();
  const env = { ...process.env, ...harnessEnv, DSH_HOME };
  if (harnessEnv.DEEPSEEK_API_KEY) delete env.DEEPSEEK_API_KEY;
  const nodeExe = resolveNodeExe();
  // 静默启动：不让引擎自己弹浏览器（桌面端有「打开 Web 端」按钮按需打开）
  const noOpen = engineSupportsNoOpen(found.dir);
  const webArgs = [found.bin, 'web'].concat(noOpen ? ['--no-open'] : []);
  harnessProc = spawn(nodeExe, webArgs, {
    cwd: found.dir,
    env,
    windowsHide: true,
  });
  pushLog('stdout', `[启动 harness: ${nodeExe} ${found.bin} web${noOpen ? ' --no-open' : ''} (${found.kind})]`);
  if (!noOpen) {
    pushLog('stderr', '[本次未传 --no-open（该引擎不支持）：WebUI 就绪后它可能自己打开系统浏览器]');
  }
  harnessProc.stdout.on('data', (d) => pushLog('stdout', d.toString()));
  harnessProc.stderr.on('data', (d) => pushLog('stderr', d.toString()));
  harnessProc.on('error', (err) => {
    pushLog('stderr', `[spawn error] ${err.message}`);
    harnessProc = null;
    startDeadline = 0;
    setState('stopped');
  });
  harnessProc.on('exit', (code, signal) => {
    pushLog('stderr', `[harness exited] code=${code} signal=${signal}`);
    const everUp = !!webUpAt;
    harnessProc = null;
    startDeadline = 0;
    setState('stopped');
    // 启动后从未就绪就退出：多半是引擎不完整（ERR_MODULE_NOT_FOUND / plugin tree failed）。
    // 给出明确提示与修复指引，不自动重装（避免死循环，用户可点启动触发自动修复）。
    if (!everUp && code !== 0) {
      pushLog('stderr', '[引擎未能就绪：可能依赖不完整。正在检测本机引擎完整性…]');
      const found = discoverHarness();
      if (!found) {
        pushLog('stderr', '[未找到完整引擎，自动尝试修复…]');
        setState('installing');
        autoInstallHarness();
      } else {
        pushLog('stderr', `[检测到可用引擎 ${found.dir}（${found.kind}），请再次点击「启动 Harness」重试]`);
        setState('stopped');
      }
    }
  });
  return { ok: true };
}

// ---------- 环境预检与自动获取引擎 ----------
// 流程：先体检（架构/网络/磁盘/Node 版本），不合格先修复 Node（winget LTS 优先，回退官方 zip），
//       环境合格后才去拉取引擎（npm 官方发行包优先，失败则官方源码构建）。
function envCheckScript() {
  return path.join(__dirname, 'installer', 'check-env.ps1');
}

// 只读体检：spawnSync 解析最后一行 JSON；失败返回 null
function readEnvReport() {
  const script = envCheckScript();
  if (!fs.existsSync(script)) return null;
  try {
    const res = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Report', '-DestDir', LAYOUT_ROOT], { windowsHide: true, encoding: 'utf8', timeout: 60000 });
    const out = (res.stdout || '');
    const lines = out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l);
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].startsWith('{')) {
        try { return JSON.parse(lines[i]); } catch { /* 取下一行 */ }
      }
    }
  } catch (err) { pushLog('stderr', `[环境预检失败] ${err.message}`); }
  return null;
}

// 修复 Node：spawn 流式日志，完成后回调 ok/errored
function fixNodeEnv(onDone) {
  const script = envCheckScript();
  if (!fs.existsSync(script)) { pushLog('stderr', `[缺少环境预检脚本 ${script}]`); onDone(false); return; }
  pushLog('stdout', '[Node.js 缺失或版本过低，正在自动安装最新 LTS（winget 优先）…]');
  const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Fix', '-NodeMinMajor', '22', '-DestDir', LAYOUT_ROOT], { windowsHide: true, env: { ...process.env } });
  p.stdout.on('data', (d) => pushLog('stdout', d.toString()));
  p.stderr.on('data', (d) => pushLog('stderr', d.toString()));
  p.on('error', (err) => { pushLog('stderr', `[Node 修复脚本启动失败] ${err.message}`); onDone(false); });
  p.on('close', (code) => { onDone(code === 0); });
}

function autoInstallHarness() {
  const afterInstall = () => {
    setTimeout(() => {
      const found = discoverHarness();
      if (found) { launchHarness(found); }
      else { manualFallbackGuide(); }
    }, 1500);
  };
  // 源码安装是否可用：依赖同目录（打包后 %LOCALAPPDATA%\DSH\app\resources\app\installer\setup.ps1）
  const installFromSourceAvailable = () => fs.existsSync(path.join(__dirname, 'installer', 'setup.ps1'));
  const NPM_MIRRORS = [
    'https://registry.npmmirror.com',
    'https://mirrors.cloud.tencent.com/npm/',
    'https://registry.npmjs.org',
  ];
  const installViaNpm = () => {
    // 逐镜像尝试，任一成功即继续
    let mirrorIndex = 0;
    const tryMirror = () => {
      if (mirrorIndex >= NPM_MIRRORS.length) {
        pushLog('stderr', '[npm 多镜像均失败，回退官方源码安装…]');
        installFromSource();
        return;
      }
      const reg = NPM_MIRRORS[mirrorIndex++];
      pushLog('stdout', `[npm install -g @deepseek-ai/dsh (镜像 ${reg})]`);
      const p = npmSpawn(['install', '-g', '@deepseek-ai/dsh', '--registry', reg], { env: { ...process.env } });
      p.stdout.on('data', (d) => pushLog('stdout', d.toString()));
      p.stderr.on('data', (d) => pushLog('stderr', d.toString()));
      p.on('error', () => tryMirror());
      p.on('close', (code) => {
        if (code === 0) afterInstall();
        else { pushLog('stderr', `[npm 镜像 ${reg} 失败 code=${code}，尝试下一个镜像…]`); tryMirror(); }
      });
    };
    tryMirror();
  };
  const installFromSource = () => {
    const script = path.join(__dirname, 'installer', 'setup.ps1');
    if (!fs.existsSync(script)) {
      pushLog('stderr', `[缺少安装脚本：${script}，无法自动获取引擎。请手动运行安装器或设置 DSH_HARNESS_DIR]`);
      manualFallbackGuide();
      return;
    }
    pushLog('stdout', `[运行引擎安装: ${script} -EngineOnly（下载官方源码+Node，多镜像自动重试，首次需数分钟）]`);
    // -DestDir 必须指向应用安装根（LAYOUT_ROOT 动态推导），否则 setup.ps1 会用默认
    // %LOCALAPPDATA%\DSH——用户装在自定义目录时会去错地方找捆绑 node 导致 corepack 缺失。
    const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-EngineOnly', '-DestDir', LAYOUT_ROOT], { windowsHide: true, env: { ...process.env } });
    p.stdout.on('data', (d) => pushLog('stdout', d.toString()));
    p.stderr.on('data', (d) => pushLog('stderr', d.toString()));
    p.on('error', (err) => { pushLog('stderr', `[脚本启动失败] ${err.message}`); manualFallbackGuide(); });
    p.on('close', (code) => {
      if (code !== 0) { pushLog('stderr', `[引擎安装失败 code=${code}，请检查网络后重试]`); manualFallbackGuide(); return; }
      afterInstall();
    });
  };
  const proceed = () => {
    // 默认先尝试源码安装到「安装根目录」（%LOCALAPPDATA%\DSH\harness，与 app 同根，符合分发布局）；
    // 源码安装失败或脚本缺失时，再回退到 npm 全局发行包（兜底，装到系统全局）。
    if (!installFromSourceAvailable()) return installViaNpm();
    installFromSource();
  };

  // 1) 环境体检
  const report = readEnvReport();
  if (report) {
    const fatal = (report.issues || []).filter((i) => !/Node\.js/.test(i));
    if (fatal.length > 0) {
      for (const i of fatal) pushLog('stderr', `[环境不满足] ${i}`);
      pushLog('stderr', '[请修复上述环境问题后重试（如联网、换 64 位系统、清理磁盘）]');
      manualFallbackGuide();
      return;
    }
    if (report.issues && report.issues.length) {
      for (const i of report.issues) pushLog('stdout', `[预检] ${i}`);
    }
    // 2) Node 不合格 → 先修复，修复后再复查一次
    if (!report.nodeOk) {
      fixNodeEnv((ok) => {
        if (!ok) { pushLog('stderr', '[Node.js 安装失败，请检查网络/winget 后重试]'); manualFallbackGuide(); return; }
        const re = readEnvReport();
        if (re && !re.nodeOk) { pushLog('stderr', '[Node.js 修复后仍不满足要求，请手动安装 Node.js >= 22]'); manualFallbackGuide(); return; }
        proceed();
      });
      return;
    }
    proceed();
  } else {
    // 体检脚本缺失时退回旧逻辑：有 npm 就发行包，否则源码安装
    proceed();
  }
}

// 保底指引：所有自动获取途径失败时，给出 100% 可成功的手动安装办法（面向用户，不绑定任何本地路径）。
function manualFallbackGuide() {
  const harnessDir = DSH_ROOT ? path.join(DSH_ROOT, 'harness') : '<安装目录>\\harness';
  const lines = [
    '==================================================',
    '[手动安装指引（100% 可成功的办法）] 自动获取引擎均失败，请任选其一：',
    `  办法 1（最快）：若你本机已有 DeepSeek-Harness 源码目录，设环境变量指向它后重启应用：`,
    `      setx DSH_HARNESS_DIR "你的引擎源码目录"`,
    `  办法 2：浏览器手动下载引擎源码压缩包（任一链接）：`,
    `    官方: https://github.com/deepseek-ai/DeepSeek-Harness/archive/refs/tags/dsh-v0.1.0-rc.8.zip`,
    `    镜像: https://ghfast.top/https://github.com/deepseek-ai/DeepSeek-Harness/archive/refs/tags/dsh-v0.1.0-rc.8.zip`,
    `    解压后把整个仓库目录放到: ${harnessDir}`,
    `    若该目录没有 node_modules（源码缺依赖），以管理员身份在 cmd 中执行：`,
    `      cd /d "${harnessDir}"`,
    `      corepack pnpm install --frozen-lockfile`,
    `      corepack pnpm build`,
    `  办法 3：以管理员身份运行 cmd，安装官方发行包：`,
    `      npm install -g @deepseek-ai/dsh --registry https://registry.npmmirror.com`,
    '完成后重启本应用，点「启动 Harness」即可。',
    '==================================================',
  ];
  for (const l of lines) pushLog('stderr', l);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('harness:manual-guide', { lines });
  }
  setState('stopped');
}

function findListenerPid() {
  try {
    const res = spawnSync('netstat', ['-ano'], { windowsHide: true, encoding: 'utf8' });
    for (const line of res.stdout.split(/\r?\n/)) {
      const m = line.trim().match(/^(?:TCP|UDP)\s+\S+:3080\s+\S+\s+LISTENING\s+(\d+)/);
      if (m) return Number(m[1]);
    }
  } catch (err) {
    pushLog('stderr', `[netstat error] ${err.message}`);
  }
  return 0;
}

function stopHarness() {
  if (harnessProc) {
    const pid = harnessProc.pid;
    pushLog('stderr', '[stopping harness...]');
    try {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    } catch (err) {
      pushLog('stderr', `[stop error] ${err.message}`);
    }
    return { ok: true };
  }
  const pid = findListenerPid();
  if (pid) {
    pushLog('stderr', `[stopping external harness pid=${pid}]`);
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    return { ok: true };
  }
  return { ok: false, error: 'not running' };
}

function checkWebUp() {
  return new Promise((resolve) => {
    const http = require('node:http');
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 1500 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

// ================= 对话桥：HTTP RPC + WebSocket 事件流 =================
// harness 的 /api/events.mux|host 是 WebSocket 下行（GET 会被 426 拒绝并要求升级），
// 帧格式: { type:'server-request', rpcId, method, payload }。
let chatReconnectTimer = null;
let chatRpcCounter = 0;
const chatStreams = new Set(); // live WebSockets
let chatWs = null;
let chatWsHost = null;

function broadcastChat(msg) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('chat:frame', msg);
  }
}

/** 引擎不可达时的人话错误：区分超时与连不上，避免把裸 fetch 异常漏给渲染层。 */
function engineUnreachableMessage(err) {
  const name = err && err.name;
  if (name === 'TimeoutError' || name === 'AbortError') return '引擎无响应（:3080 超时）';
  return `无法连接引擎（:3080）：${err && err.message ? err.message : String(err)}`;
}

async function rpcCall(method, payload) {
  const rpcId = `rpc-${++chatRpcCounter}`;
  let res;
  let body;
  try {
    res = await fetch(`http://127.0.0.1:${PORT}/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: payload || {} }),
      signal: AbortSignal.timeout(12000),
    });
    body = await res.json();
  } catch (err) {
    // 引擎未启动 / 端口不通 / 超时：统一成 {ok:false}，不让异常冒到渲染层
    return { ok: false, error: { message: engineUnreachableMessage(err) } };
  }
  if (!body || body.type !== 'server-response') {
    return { ok: false, error: { message: `bad envelope: HTTP ${res.status}` } };
  }
  if (!body.result || !body.result.ok) {
    return { ok: false, error: body.result?.error || { message: 'unknown rpc error' } };
  }
  return { ok: true, value: body.result.value };
}

/**
 * Typert RPC 调用（commands/* 等生成式端点）：
 * 与 Web 客户端同一约定 —— POST /api/<ns>/<method>，payload 包一层 args。
 */
async function rpcCallTypert(method, args) {
  const rpcId = `rpc-${++chatRpcCounter}`;
  let res;
  let body;
  try {
    res = await fetch(`http://127.0.0.1:${PORT}/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }),
      signal: AbortSignal.timeout(15000),
    });
    body = await res.json();
  } catch (err) {
    return { ok: false, error: { message: engineUnreachableMessage(err) } };
  }
  if (!body || body.type !== 'server-response') {
    return { ok: false, error: { message: `bad envelope: HTTP ${res.status}` } };
  }
  if (!body.result || !body.result.ok) {
    return { ok: false, error: body.result?.error || { message: 'unknown rpc error' } };
  }
  return { ok: true, value: body.result.value };
}

/**
 * 表驱动的 RPC 桥：把引擎的纯透传方法一次性暴露给渲染层。
 *
 * 每个条目显式挑选字段而非整体透传 —— 引擎侧用 zod 严格 schema 校验载荷，
 * 渲染层多带一个 UI 专用字段就会让整个请求被拒。可选字段留空时不写进载荷
 * （JSON 里出现 undefined 值会被 zod 当成显式传入而校验失败）。
 *
 * 返回统一为 { ok:true, value } 或 { ok:false, error, code }。code 必须透传：
 * 调用方靠 title-invalid / fork-unavailable / workspace-name-conflict 这类错误码
 * 给出可理解的提示，而不是把裸错误码抛给用户。
 *
 * 载荷契约以引擎 harness/packages/host/apiproxy/src/api/ 下的
 * SessionsApi / SubagentsApi / WorkspaceApi / HostApi / AgentPresetsApi / GoalsApi /
 * SettingsApi 为准（注册表见同目录 rpc-map.ts）。
 *
 * 有真实主进程逻辑的方法不走这张表，仍各自单独 ipcMain.handle：
 * chat:send 要 stage 上传文件、chat:history 要折叠 chunk 并截断。
 */
const RPC_BRIDGE = {
  // ---- 会话：重命名 / 全文搜索 / 分叉 / 队列变更 ----
  'chat:rename': ['session.rename', (a) => ({ sessionId: a.sessionId, title: a.title })],
  'chat:search': ['session.search', (a) => ({ query: a.query })],
  'chat:fork': ['session.fork', (a) => withOptional({ sessionId: a.sessionId }, 'atSeq', a.atSeq)],
  // action: {kind:'edit',content} | {kind:'remove'} | {kind:'steer'}
  'chat:updateQueue': ['session.updateQueue', (a) => ({ sessionId: a.sessionId, itemId: a.itemId, action: a.action })],

  // ---- Goal：目标条的六个变更动词，全部携带 CAS ref ----
  'goal:create': ['goal.create', (a) => withOptional({ sessionId: a.sessionId, objective: a.objective }, 'maxGoalRounds', a.maxGoalRounds)],
  'goal:edit': ['goal.edit', (a) => withOptional(withOptional({ sessionId: a.sessionId, ref: a.ref }, 'objective', a.objective), 'maxGoalRounds', a.maxGoalRounds)],
  'goal:pause': ['goal.pause', (a) => ({ sessionId: a.sessionId, ref: a.ref })],
  'goal:resume': ['goal.resume', (a) => ({ sessionId: a.sessionId, ref: a.ref })],
  'goal:complete': ['goal.complete', (a) => ({ sessionId: a.sessionId, ref: a.ref })],
  'goal:clear': ['goal.clear', (a) => ({ sessionId: a.sessionId, ref: a.ref })],

  // ---- 子 agent：地址是扁平的 {parentSessionId, childSessionId, mode} ----
  'subagent:list': ['subagent.list', (a) => ({ parentSessionId: a.parentSessionId })],
  'subagent:history': ['subagent.history', (a) => withOptional(withOptional(
    subagentAddress(a), 'beforeSeq', a.beforeSeq), 'maxMessages', a.maxMessages)],
  // prompt / interrupt 只对 mode:'continuable' 的子会话有效，one-shot 是只读执行记录
  'subagent:prompt': ['subagent.prompt', (a) => withOptional({ ...subagentAddress(a), content: a.content }, 'clientTimeZone', a.clientTimeZone)],
  'subagent:interrupt': ['subagent.interrupt', (a) => subagentAddress(a)],

  // ---- 工作区：重命名 / 删除 / 分组排序 / 会话排序 ----
  'chat:renameWorkspace': ['workspace.rename', (a) => ({ workspaceId: a.workspaceId, title: a.title })],
  // 只删注册表：目录、用户文件、会话日志都不动，这些会话随之变为未分组
  'chat:deleteWorkspace': ['workspace.delete', (a) => ({ workspaceId: a.workspaceId })],
  'chat:moveWorkspace': ['workspace.insertBefore', (a) => withOptional({ workspaceId: a.workspaceId }, 'beforeWorkspaceId', a.beforeWorkspaceId)],
  'chat:moveSession': ['workspace.insertSessionBefore', (a) => withOptional(
    { workspaceId: a.workspaceId, sessionId: a.sessionId }, 'beforeSessionId', a.beforeSessionId)],

  // ---- Agent 预设：copy 是唯一的授权写入路径（from=源 id，agentPreset=新 id）----
  'settings:presetCopy': ['agentPreset.copy', (a) => withOptional({ from: a.from, agentPreset: a.agentPreset }, 'name', a.name)],
  'settings:presetRemove': ['agentPreset.remove', (a) => ({ agentPreset: a.agentPreset })],

  // ---- 设置：整段替换一个命名空间（mutate 的补集）----
  'settings:replace': ['settings.replace', (a) => withOptional({ ns: a.ns, section: a.section }, 'expectedRevision', a.expectedRevision)],

  // ---- Host：诊断快照 / 打开路径 ----
  // describe 返回 { version, cwd, provider?, model?, attachedSessions, home, canOpenPath }，
  // 其中 canOpenPath 是 openPath 的能力开关，调用前应先读它。
  // 不接 host.listDirectory / host.createDirectory：两者仅在引擎组合了 browse capability 时可用，
  // 当前组合装的是 native（原生选择器），调用必定失败；桌面端主进程本就有 fs 与 Electron
  // 原生 dialog（chat:pickWorkspaceDir 已在用），比引擎的目录浏览能力更强。
  'host:describe': ['host.describe', () => ({})],
  'host:openPath': ['host.openPath', (a) => ({ path: a.path })],
};

/** 仅在值不是 undefined 时写入键，避免把 undefined 传给 zod 严格 schema。 */
function withOptional(payload, key, value) {
  if (value !== undefined) payload[key] = value;
  return payload;
}

/** 子 agent 地址：mode 决定可用动词，缺省按 one-shot 处理（只读）。 */
function subagentAddress(a) {
  return {
    parentSessionId: a.parentSessionId,
    childSessionId: a.childSessionId,
    mode: a.mode === 'continuable' ? 'continuable' : 'one-shot',
  };
}

for (const [channel, [method, toPayload]] of Object.entries(RPC_BRIDGE)) {
  ipcMain.handle(channel, async (_e, args) => {
    const r = await rpcCall(method, toPayload(args || {}));
    if (!r.ok) return { ok: false, error: r.error?.message || `${method} failed`, code: r.error?.code };
    return { ok: true, value: r.value };
  });
}

// ---------------- 系统通知 ----------------
// 本应用主打"关窗只是隐藏到托盘、Harness 后台常驻"，但此前长任务跑完没有任何提示，
// 用户只能反复切回窗口看。这里补上：回合结束且用户没在看这个窗口时通知一次。
function notifyPrefsPath() {
  return path.join(app.getPath('userData'), 'notify-prefs.json');
}

function readNotifyPrefs() {
  try {
    const raw = JSON.parse(fs.readFileSync(notifyPrefsPath(), 'utf8'));
    return { enabled: raw.enabled !== false, onlyWhenHidden: raw.onlyWhenHidden !== false };
  } catch {
    // 文件不存在或损坏都按默认值走：开启，且仅在窗口不可见时通知
    return { enabled: true, onlyWhenHidden: true };
  }
}

function writeNotifyPrefs(prefs) {
  try {
    fs.mkdirSync(path.dirname(notifyPrefsPath()), { recursive: true });
    fs.writeFileSync(notifyPrefsPath(), JSON.stringify(prefs, null, 2), 'utf8');
    return true;
  } catch (err) {
    pushLog('stderr', `[通知偏好写入失败] ${err.message}`);
    return false;
  }
}

/** 用户此刻是否正看着主窗口；看着就不打扰。 */
function userIsLookingAtWindow() {
  return !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized() && mainWindow.isFocused();
}

/**
 * 回合结束时通知。由渲染层在 turn/end 时调用——它才知道会话标题，
 * 主进程只知道窗口可见性，两边各出自己那份信息。
 * @param title - 会话标题，用于通知正文。
 * @returns 是否真的发了通知。
 */
function notifyTurnEnd(title) {
  const prefs = readNotifyPrefs();
  if (!prefs.enabled) return false;
  if (prefs.onlyWhenHidden && userIsLookingAtWindow()) return false;
  const body = title || '';
  if (Notification.isSupported()) {
    const n = new Notification({ title: 'DSH · 回合已完成', body, silent: false });
    n.on('click', () => showMainWindow());
    n.show();
  } else if (tray) {
    // 少数环境不支持系统通知，用托盘气泡兜底
    tray.displayBalloon({ title: 'DSH · 回合已完成', content: body });
  } else {
    return false;
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.flashFrame(true);
  return true;
}

function openStream(kind) {
  if (harnessState !== 'running') return;
  const existing = kind === 'mux' ? chatWs : chatWsHost;
  // 🔴 CONNECTING(0) 必须和 OPEN(1) 一样算「已经有了」。
  // openChatStreams() 会被两条独立路径触发：主进程自己的 setState('running')
  // （harness:status 轮询探测到 :3080 在线 / startHarness 就绪）与渲染层的 chat:connect
  // （onState / getStatus 拿到 running 后调）。两者相隔只有一次 IPC 往返，而到 127.0.0.1
  // 的 WebSocket 握手至少跨一个宏任务，于是第二次调用看到的是一条**握手中**的连接。
  // 旧判据只挡 readyState===1，第二次就会再建一条；两条都 OPEN 之后引擎每帧投递两遍，
  // 界面上每条消息、每条告警条、每个回合统计框都正好显示两份（用户长期反馈的重复 bug）。
  if (existing && (existing.readyState === 0 || existing.readyState === 1)) return;
  let WS;
  try {
    WS = require('ws');
  } catch (err) {
    pushLog('stderr', `[chat] ws module missing: ${err.message}`);
    return;
  }
  let socket;
  try {
    socket = new WS(`ws://127.0.0.1:${PORT}/api/events.${kind}`);
  } catch (err) {
    pushLog('stderr', `[chat] ${kind} connect failed: ${err.message}`);
    scheduleChatReconnect();
    return;
  }
  socket.dshStreamKind = kind;
  if (kind === 'mux') chatWs = socket;
  else chatWsHost = socket;
  chatStreams.add(socket);
  // 兜底不变量：同一个 kind 只允许存在一条活连接。上面那个判据已经能挡住正常时序，
  // 这里再收一次，任何异常时序（半死连接、close 事件还没派发）都不会留下第二条投递源。
  for (const other of [...chatStreams]) {
    if (other === socket || other.dshStreamKind !== kind) continue;
    if (other.readyState === 0 || other.readyState === 1) {
      pushLog('stderr', `[chat] ${kind} 事件流出现重复连接，已切断旧连接（否则界面会重复显示每条消息）`);
      try { other.terminate(); } catch { /* ignore */ }
    }
  }
  socket.on('message', (data) => {
    try {
      broadcastChat({ stream: kind, ...JSON.parse(data.toString()) });
    } catch { /* malformed frame: skip */ }
  });
  const onEnd = () => {
    chatStreams.delete(socket);
    if (kind === 'mux' && chatWs === socket) chatWs = null;
    if (kind === 'host' && chatWsHost === socket) chatWsHost = null;
    scheduleChatReconnect();
  };
  socket.on('close', onEnd);
  socket.on('error', () => {
    try { socket.close(); } catch { /* ignore */ }
  });
}

function openChatStreams() {
  openStream('mux');
  openStream('host');
}

function closeChatStreams() {
  if (chatReconnectTimer) {
    clearTimeout(chatReconnectTimer);
    chatReconnectTimer = null;
  }
  for (const socket of chatStreams) {
    // terminate 而不是 close：close 在 CONNECTING 状态下只是"请求关闭"，握手仍可能完成
    // 并开始投递帧；本地回环 socket 不需要优雅挥手，直接切掉才是确定的。
    try { socket.terminate(); } catch { /* 已关闭 / 不支持 terminate，退化为 close */ try { socket.close(); } catch { /* ignore */ } }
  }
  chatStreams.clear();
  chatWs = null;
  chatWsHost = null;
}

function scheduleChatReconnect() {
  if (chatReconnectTimer || harnessState !== 'running') return;
  chatReconnectTimer = setTimeout(() => {
    chatReconnectTimer = null;
    if (harnessState === 'running') openChatStreams();
  }, 3000);
}

function listResults() {
  const out = { home: DSH_HOME, dirs: [] };
  const candidates = [
    path.join(DSH_HOME, 'storages'),
    path.join(DSH_HOME, 'sessions'),
    path.join(DSH_HOME),
  ];
  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      out.dirs.push({
        name: e.name,
        isDir: e.isDirectory(),
        path: path.join(dir, e.name),
        mtime: fs.statSync(path.join(dir, e.name)).mtimeMs,
      });
    }
  }
  out.dirs.sort((a, b) => b.mtime - a.mtime);
  return out;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#04070F',
    icon: path.join(__dirname, 'DSH.ico'),
    title: 'DSH',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  trackWindow(mainWindow, '主窗口', 'main');
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // 外部链接一律交给系统浏览器；所有弹窗都会被自动检测并显示在「窗口」指示器上，
    // 用户始终知道发生了什么（不会出现“开了个窗口却看不到”的情况）。
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('close', (e) => {
    // 关闭窗口 ≠ 退出应用：隐藏到托盘让 harness 服务继续在后台运行。
    // 用户从托盘/设置里主动「退出」时（isQuitting），才真正关闭并停止服务。
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => {
    // 内置浏览器的 WebContentsView 必须随窗口一起销毁，否则它的 webContents 会挂着不放
    try { browserCtl.destroy(); } catch { /* ignore */ }
    mainWindow = null;
  });
}

// ---------- 窗口自动检测（需求 #3） ----------
// 记录本应用创建的所有 BrowserWindow（含子窗口/弹窗），并把它们的开闭与标题变化
// 实时广播给渲染进程（「窗口」指示器），保证任何特殊窗口都不会“开了却看不见”。
const trackedWindows = new Map(); // BrowserWindow -> {id, label, kind, title}
let winSeq = 0;
function trackWindow(win, label, kind) {
  const id = ++winSeq;
  trackedWindows.set(win, { id, label, kind, title: label });
  broadcastWindows();
  win.on('page-title-updated', (_e, title) => {
    const rec = trackedWindows.get(win);
    if (rec) rec.title = title || rec.label;
    broadcastWindows();
  });
  win.on('closed', () => {
    trackedWindows.delete(win);
    broadcastWindows();
  });
  // 子窗口（popup / window.open）创建时也纳入监控
  win.webContents.on('did-create-window', (child) => {
    if (!trackedWindows.has(child)) {
      trackWindow(child, '辅助窗口', 'child');
      // 子窗口默认展示（除非宿主标记隐藏）
      if (child.isVisible) { try { child.show(); } catch { /* ignore */ } }
    }
  });
}

function broadcastWindows() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const list = [...trackedWindows.entries()].map(([win, rec]) => ({
    id: rec.id,
    label: rec.label,
    kind: rec.kind,
    title: rec.title || '',
    visible: !!(win && !win.isDestroyed() && win.isVisible()),
  }));
  mainWindow.webContents.send('windows:changed', list);
}

ipcMain.handle('harness:start', () => startHarness());
ipcMain.handle('harness:stop', () => stopHarness());
ipcMain.handle('harness:status', async () => {
  const webUp = await checkWebUp();
  if (webUp) {
    if (!webUpAt) webUpAt = Date.now();
    if (harnessState !== 'running') setState('running');
  } else if (harnessState === 'running') {
    setState('stopped');
  } else if (harnessState === 'installing') {
    // 安装期间维持 installing，安装完成后 startHarness 会自动接管
  } else if (harnessProc && harnessState === 'starting' && startDeadline && Date.now() > startDeadline) {
    pushLog('stderr', '[启动超时] 90 秒内 :3080 未就绪，已终止进程');
    try {
      spawnSync('taskkill', ['/PID', String(harnessProc.pid), '/T', '/F'], { windowsHide: true });
    } catch (err) { /* ignore */ }
    harnessProc = null;
    startDeadline = 0;
    setState('stopped');
  }
  // 未启动/未安装时动态探测一次，让 UI 显示当前可用引擎位置（不再写死路径）
  if (!HARNESS_DIR && !harnessProc) {
    const found = discoverHarness();
    if (found) HARNESS_DIR = found.dir;
  }
  return { state: harnessState, webUp, port: PORT, harnessDir: HARNESS_DIR || '（未检测到，点击"启动 Harness"自动获取）' };
});
ipcMain.handle('harness:logs', () => logBuffer.slice(-500));
// 窗口边框（标题栏）跟随应用主题：渲染层切主题时把「浅色 / 深色」倾向同步过来。
// nativeTheme.themeSource 只影响本应用的配色倾向（含 Windows 标题栏的明暗），不动系统设置。
ipcMain.handle('app:nativeTheme', (_e, mode) => {
  const m = mode === 'light' || mode === 'dark' ? mode : 'system';
  try { nativeTheme.themeSource = m; } catch { /* 忽略：老系统不支持时标题栏保持系统外观 */ }
  return { ok: true, themeSource: nativeTheme.themeSource };
});
ipcMain.handle('harness:openWeb', async () => {
  await shell.openExternal(`http://127.0.0.1:${PORT}`);
  return { ok: true };
});
ipcMain.handle('results:list', () => listResults());
ipcMain.handle('stats:usage', async () => {
  const list = await rpcCall('session.list', {});
  if (!list.ok) return { ok: false, error: list.error?.message || 'session.list failed' };
  const items = (list.value?.items || []).slice(0, 20);
  const sessions = [];
  for (const it of items) {
    // 投影随 history 尾页返回；聚合只在主进程进行，渲染进程只收统计结果
    const r = await rpcCall('session.history', { sessionId: it.sessionId });
    if (!r.ok) continue;
    const proj = r.value?.projections?.values || {};
    const tu = proj.tokenUsage || {};
    const ss = proj.sessionStats || {};
    const title = proj.title && typeof proj.title === 'object' ? proj.title.value ?? proj.title.title : proj.title;
    sessions.push({
      sessionId: it.sessionId,
      title: typeof title === 'string' && title ? title : '（未命名会话）',
      running: !!it.running,
      updatedAt: it.updatedAt,
      turns: ss.turns || 0,
      steps: ss.steps || 0,
      llmMs: ss.llmMs || 0,
      toolMs: ss.toolMs || 0,
      ttftMs: ss.ttftMs || 0,
      decodeMs: ss.decodeMs || 0,
      decodeTokens: ss.decodeTokens || 0,
      uncachedInputTokens: tu.uncachedInputTokens || 0,
      outputTokens: tu.outputTokens || 0,
      cacheReadTokens: tu.cacheReadTokens || 0,
      cacheWriteTokens: tu.cacheWriteTokens || 0,
    });
  }
  return { ok: true, sessions };
});

// ---------- 对话 IPC ----------
ipcMain.handle('chat:connect', async () => {
  openChatStreams();
  // streams = 活连接数（握手中也算）。稳态恒为 2（mux + host）：同一事件流只允许一条连接，
  // 否则引擎每帧投递两遍、界面上每条消息显示两份。这个计数就是为了让那条不变量可被外部断言
  // （见 scripts/chat-stream-dedup-e2e.cjs），不是给界面用的。
  const live = [...chatStreams].filter((s) => s.readyState === 0 || s.readyState === 1).length;
  return { ok: true, connected: !!chatWs || !!chatWsHost, streams: live };
});
ipcMain.handle('chat:disconnect', () => {
  closeChatStreams();
  return { ok: true };
});
ipcMain.handle('chat:list', async () => {
  const r = await rpcCall('session.list', {});
  if (!r.ok) return { ok: false, error: r.error?.message || 'session.list failed' };
  // 🔴 cwd / agentPreset 必须带出去：引擎的 session.list **本来就给** cwd，
  //    之前这里只挑走 title/running/blank 把 cwd 丢了 —— 于是渲染层拿不到"这条会话在哪个目录"，
  //    "打开工作区/在文件夹中打开"只能回落到默认目录（引擎目录），
  //    用户看到的就变成"打开工作区却打开了 harness 源码文件夹"（真机确认过的 bug）。
  const items = (r.value?.items || []).map((it) => ({
    sessionId: it.sessionId,
    title: it.projections?.values?.title || '新会话',
    running: !!it.running,
    blank: !!it.blank,
    updatedAt: it.updatedAt,
    cwd: typeof it.cwd === 'string' ? it.cwd : '',
    agentPreset: it.agentPreset || '',
  }));
  items.sort((a, b) => b.updatedAt - a.updatedAt);
  return { ok: true, items };
});
ipcMain.handle('chat:create', async (_e, options) => {
  // options: { workspaceId }（指定工作区）或 null / 旧式字符串参数（null = 默认目录）
  const opts = typeof options === 'string'
    ? (options ? { workspaceId: options } : null)
    : options;
  const payload = opts?.workspaceId ? { workspaceId: opts.workspaceId } : { cwd: defaultWorkspaceDir() };
  const r = await rpcCall('session.create', payload);
  if (!r.ok) return { ok: false, error: r.error?.message || 'session.create failed' };
  return { ok: true, sessionId: r.value?.sessionId };
});
ipcMain.handle('chat:workspaces', async () => {
  const r = await rpcCall('workspace.list', {});
  if (!r.ok) return { ok: false, error: r.error?.message || 'workspace.list failed' };
  // defaultDir 是"没指定工作区时的兜底目录"（引擎目录）—— 渲染层用它来识别
  // 「目录落在引擎目录里的历史会话」并给出提醒（真机确认过：那种会话打开"工作区"会是源码目录）
  return { ok: true, items: r.value?.items || [], archivedSessionIds: r.value?.archivedSessionIds || [], defaultDir: defaultWorkspaceDir() };
});
ipcMain.handle('chat:pickWorkspaceDir', async () => {
  // 原生目录选择器：让用户从电脑上选一个文件夹作为工作区
  const win = BrowserWindow.getFocusedWindow()
    || (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
  const opts = {
    title: '选择工作区文件夹',
    buttonLabel: '选为工作区',
    properties: ['openDirectory', 'createDirectory'],
  };
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (res.canceled || res.filePaths.length === 0) return { ok: true, cancelled: true };
  return { ok: true, path: res.filePaths[0] };
});
ipcMain.handle('chat:addWorkspace', async (_e, path) => {
  // 注册一个电脑上的目录为工作区（重复路径幂等返回既有工作区）
  const r = await rpcCall('workspace.create', { path });
  if (!r.ok) return { ok: false, error: r.error?.message || 'workspace.create failed' };
  return { ok: true, workspace: r.value?.workspace };
});
ipcMain.handle('chat:archiveSession', async (_e, sessionId) => {
  const r = await rpcCall('workspace.archiveSession', { sessionId });
  if (!r.ok) return { ok: false, error: r.error?.message || 'workspace.archiveSession failed' };
  return { ok: true, archivedSessionIds: r.value?.archivedSessionIds || [] };
});
/**
 * 把 assistant/chunk 流折叠进 assistant/message：
 * harness 的 chunk 流常常没有 block-start（text-delta 直接到达），且最终的
 * assistant/message 的 content 为 null —— 文本只存在于 chunk 里。
 * 折叠后消息 content = 原有块 + 补全的 {type:'text'|'reasoning'} 块。
 */
function foldChunks(events) {
  const out = [];
  const blocks = new Map(); // index -> {kind, text}
  for (const entry of events || []) {
    const ev = entry.event;
    if (!ev) continue;
    if (ev.type === 'assistant/chunk') {
      const c = ev.data?.chunk;
      if (!c) continue;
      if (c.type === 'block-start') {
        if (!blocks.has(c.index)) blocks.set(c.index, { kind: c.blockType === 'reasoning' ? 'reasoning' : 'text', text: '' });
      } else if (c.type === 'text-delta' || c.type === 'reasoning-delta') {
        const b = blocks.get(c.index);
        if (b) b.text += c.text;
        else blocks.set(c.index, { kind: c.type === 'reasoning-delta' ? 'reasoning' : 'text', text: c.text });
      } else if (c.type === 'block-end') {
        const b = blocks.get(c.index);
        if (b) {
          if (c.block?.text !== undefined) b.text = c.block.text;
        } else if (c.block?.text !== undefined) {
          blocks.set(c.index, { kind: c.block.type === 'reasoning' ? 'reasoning' : 'text', text: c.block.text });
        }
      }
      continue;
    }
    if (ev.type === 'assistant/message' && blocks.size > 0) {
      const data = ev.data || {};
      const merged = Array.isArray(data.content)
        ? data.content.filter((b) => b && b.type).map((b) => ({ ...b }))
        : [];
      let hasText = merged.some((b) => b.type === 'text');
      let hasReason = merged.some((b) => b.type === 'reasoning');
      for (const [, b] of [...blocks.entries()].sort((a, c) => a[0] - c[0])) {
        if (b.kind === 'text' && !hasText && b.text) {
          merged.push({ type: 'text', text: b.text });
          hasText = true;
        } else if (b.kind === 'reasoning' && !hasReason && b.text) {
          merged.push({ type: 'reasoning', text: b.text });
          hasReason = true;
        }
      }
      out.push({ event: { ...ev, data: { ...data, content: merged } }, view: entry.view });
      blocks.clear();
      continue;
    }
    out.push(entry);
  }
  return out.slice(-300);
}

ipcMain.handle('chat:history', async (_e, sessionId) => {
  const r = await rpcCall('session.history', { sessionId, maxMessages: 30 });
  if (!r.ok) return { ok: false, error: r.error?.message || 'session.history failed' };
  // 主进程折叠 chunk 并截断：渲染进程只拿界面事件（单会话可达 10w+ 条，全量传输会卡死）
  const events = foldChunks(r.value?.events || []);
  return { ok: true, events, hasMore: !!r.value?.hasMore, projections: r.value?.projections };
});
ipcMain.handle('chat:send', async (_e, { sessionId, content, files, mode }) => {
  const blocks = Array.isArray(content) && content.length > 0
    ? content.map((b) => ({ ...b }))
    : [{ type: 'text', text: '' }];
  // 非图片附件复制进会话工作区 .uploads，模型用文件工具读取；图片走上面的 content 块。
  const staged = await stageUploadFiles(sessionId, files);
  for (const s of staged) {
    blocks.push({
      type: 'text',
      text: `[附件] ${s.name}（${s.size} 字节）已保存到 ${s.savedPath}，请用工具读取并处理。`,
    });
  }
  // 发送模式：queue = 排队（agent 忙时排队跟进）；steer = 插话（直接插入/转向当前回合）
  const r = await rpcCall('session.prompt', {
    sessionId,
    mode: mode === 'steer' ? 'steer' : 'queue',
    content: blocks,
  });
  if (!r.ok) return { ok: false, error: r.error?.message || 'session.prompt failed' };
  return { ok: true, accepted: r.value?.accepted };
});
ipcMain.handle('chat:attachment', async (_e, { sessionId, attachmentId }) => {
  const r = await rpcCall('session.attachment', { sessionId, attachmentId });
  if (!r.ok) return { ok: false, error: r.error?.message || 'session.attachment failed' };
  return { ok: true, ...r.value };
});
ipcMain.handle('chat:cancel', async (_e, sessionId) => {
  const r = await rpcCall('session.cancel', { sessionId });
  if (!r.ok) return { ok: false, error: r.error?.message || 'session.cancel failed' };
  return { ok: true, accepted: r.value?.accepted };
});
ipcMain.handle('chat:models', async (_e, sessionId) => {
  const r = await rpcCall('session.models', { sessionId });
  if (!r.ok) return { ok: false, error: r.error?.message || 'session.models failed' };
  return { ok: true, value: r.value };
});
ipcMain.handle('chat:selectModel', async (_e, { sessionId, provider, model, reasoningEffort }) => {
  const payload = { sessionId, provider, model };
  if (reasoningEffort) payload.reasoningEffort = reasoningEffort;
  const r = await rpcCall('session.selectModel', payload);
  if (!r.ok) return { ok: false, error: r.error?.message || 'session.selectModel failed' };
  return { ok: true, value: r.value };
});
// 切换会话权限预设：走 harness 的 /permission 命令（与 Web UI 同一机制）
// 注意：commands/execute 的 wire 契约是 (agentId, line, images)，images 是必填的 z.array
// （EncodedImageAttachment[]），非可选。此前漏传 images 会被 typert 严格网关整条拒绝，
// 导致所有斜杠命令 / 权限切换 /（/plan off）静默失败——面板关掉却"没效果"。桌面端命令
// 目前不带图片，固定传 []；将来若要给命令附图，从渲染层透传 images 即可。
ipcMain.handle('chat:permissionSet', async (_e, { sessionId, preset }) => {
  const r = await rpcCallTypert('commands/execute', { agentId: sessionId, line: `/permission ${preset}`, images: [] });
  if (!r.ok) return { ok: false, error: r.error?.message || 'commands/execute failed' };
  return { ok: true, command: r.value?.result || null };
});

// 通用斜杠命令执行：支持 /compact 等任意 harness 命令
ipcMain.handle('chat:commandsExecute', async (_e, { sessionId, line, images }) => {
  const r = await rpcCallTypert('commands/execute', { agentId: sessionId, line, images: Array.isArray(images) ? images : [] });
  if (!r.ok) return { ok: false, error: r.error?.message || 'commands/execute failed' };
  return { ok: true, command: r.value?.result || null };
});

// 获取可用命令列表（用于命令面板自动补全）
ipcMain.handle('chat:commandsList', async (_e, { sessionId }) => {
  const r = await rpcCallTypert('commands/list', { agentId: sessionId });
  if (!r.ok) return { ok: false, error: r.error?.message || 'commands/list failed' };
  return { ok: true, commands: r.value || [] };
});

// ---------- @文件 / @会话 引用候选（typert Remote，agent 作用域，只读）----------
// 两者都是只读查询：agentId=目标会话，query=@ 之后已输入的文本。返回单层 RemoteResult，
// 其 value 直接是候选数组（FileReferenceCandidate[] / SessionReferenceMentionCandidate[]）。
// 输入框并发拉两个域，各自独立降级：一个失败返回 { ok:false } 不影响另一个。
ipcMain.handle('chat:fileRefs', async (_e, { agentId, query }) => {
  const r = await rpcCallTypert('fileReferences/list', { agentId, query });
  if (!r.ok) return { ok: false, error: r.error?.message || 'fileReferences/list failed', code: r.error?.code };
  return { ok: true, value: r.value || [] };
});
ipcMain.handle('chat:sessionRefs', async (_e, { agentId, query }) => {
  const r = await rpcCallTypert('sessionReferenceResolver/candidates', { agentId, query });
  if (!r.ok) return { ok: false, error: r.error?.message || 'sessionReferenceResolver/candidates failed', code: r.error?.code };
  return { ok: true, value: r.value || [] };
});

// ---------- 消息反馈：赞 / 踩（typert Remote，per-message 乐观并发）----------
// 双层信封：rpcCallTypert 已拆掉传输层 RemoteResult，r.value 才是业务结果
// { ok:true, value } | { ok:false, error:{ code, current? } }。put/delete 必须把业务
// error.code 与权威 current 透出，渲染层据此做 version-conflict 回填重试（同官方客户端）。
// note 为空时不写入 request，避免把空串交给引擎 zod 严格 schema（会判 note-blank）。
ipcMain.handle('feedback:list', async (_e, { sessionId }) => {
  const r = await rpcCallTypert('messageFeedback/list', { request: { sessionId } });
  if (!r.ok) return { ok: false, error: r.error?.message || 'messageFeedback/list failed' };
  const biz = r.value;
  if (!biz || !biz.ok) return { ok: false, code: biz?.error?.code, error: biz?.error?.code || 'messageFeedback/list rejected' };
  return { ok: true, items: (biz.value && biz.value.items) || [] };
});
ipcMain.handle('feedback:put', async (_e, { sessionId, messageId, rating, note, ifVersion }) => {
  const request = { sessionId, messageId, rating, ifVersion: ifVersion ?? null };
  if (note !== undefined && note !== null && note !== '') request.note = note;
  const r = await rpcCallTypert('messageFeedback/put', { request });
  if (!r.ok) return { ok: false, error: r.error?.message || 'messageFeedback/put failed' };
  const biz = r.value;
  if (!biz || !biz.ok) return { ok: false, code: biz?.error?.code, current: biz?.error?.current ?? null };
  return { ok: true, item: biz.value };
});
ipcMain.handle('feedback:delete', async (_e, { sessionId, messageId, ifVersion }) => {
  const r = await rpcCallTypert('messageFeedback/delete', { request: { sessionId, messageId, ifVersion } });
  if (!r.ok) return { ok: false, error: r.error?.message || 'messageFeedback/delete failed' };
  const biz = r.value;
  if (!biz || !biz.ok) return { ok: false, code: biz?.error?.code, current: biz?.error?.current ?? null };
  return { ok: true };
});

// ---------- 设置：插件（agent preset）与模型配置 IPC ----------
ipcMain.handle('settings:presets', async () => {
  const r = await rpcCall('agentPreset.list', {});
  if (!r.ok) return { ok: false, error: r.error?.message || 'agentPreset.list failed' };
  return { ok: true, ...r.value };
});
ipcMain.handle('settings:presetRead', async (_e, agentPreset) => {
  const r = await rpcCall('agentPreset.read', { agentPreset });
  if (!r.ok) return { ok: false, error: r.error?.message || 'agentPreset.read failed' };
  return { ok: true, ...r.value };
});
ipcMain.handle('settings:presetOpen', async (_e, agentPreset) => {
  const r = await rpcCall('agentPreset.openDocument', { agentPreset });
  if (!r.ok) return { ok: false, error: r.error?.message || 'agentPreset.openDocument failed' };
  return { ok: true, ...r.value };
});
ipcMain.handle('settings:presetSelect', async (_e, { sessionId, agentPreset }) => {
  const r = await rpcCall('agentPreset.select', { sessionId, agentPreset });
  if (!r.ok) return { ok: false, error: r.error?.message || 'agentPreset.select failed' };
  return { ok: true, ...r.value };
});
ipcMain.handle('settings:llmProviders', async () => {
  const r = await rpcCall('llm.providers', {});
  if (!r.ok) return { ok: false, error: r.error?.message || 'llm.providers failed' };
  return { ok: true, ...r.value };
});
ipcMain.handle('settings:llmModels', async () => {
  const r = await rpcCall('llm.models', {});
  if (!r.ok) return { ok: false, error: r.error?.message || 'llm.models failed' };
  return { ok: true, ...r.value };
});
ipcMain.handle('settings:pluginCatalog', async () => {
  // 扫描部署仓库的全部插件包（packages/*/* + apps/*）
  const base = HARNESS_DIR || (discoverHarness()?.dir) || '';
  const out = [];
  if (!base) return { ok: true, plugins: out, note: '尚未定位到 harness 引擎目录' };
  const scan = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const pkgPath = path.join(dir, e.name, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          if (pkg.name && pkg.name.startsWith('@deepseek-ai/')) {
            out.push({
              id: pkg.name,
              version: pkg.version || '',
              description: pkg.description || '',
              path: path.relative(base, path.join(dir, e.name)),
            });
          }
        } catch { /* 忽略损坏的 package.json */ }
      }
    }
  };
  scan(path.join(base, 'packages', 'host'));
  scan(path.join(base, 'packages', 'client'));
  scan(path.join(base, 'packages', 'api'));
  scan(path.join(base, 'packages', 'llm'));
  scan(path.join(base, 'packages', 'core'));
  scan(path.join(base, 'packages', 'tools'));
  scan(path.join(base, 'packages', 'agent'));
  scan(path.join(base, 'packages', 'jobs'));
  scan(path.join(base, 'packages', 'skills'));
  scan(path.join(base, 'packages', 'feedback'));
  scan(path.join(base, 'packages', 'auth'));
  scan(path.join(base, 'packages', 'runtime'));
  scan(path.join(base, 'apps'));
  // 兜底：扫描 packages 下所有二级目录
  try {
    for (const g of fs.readdirSync(path.join(base, 'packages'), { withFileTypes: true })) {
      if (!g.isDirectory()) continue;
      const gp = path.join(base, 'packages', g.name);
      for (const e of fs.readdirSync(gp, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const pkgPath = path.join(gp, e.name, 'package.json');
        if (!fs.existsSync(pkgPath)) continue;
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          if (pkg.name && pkg.name.startsWith('@deepseek-ai/') && !out.some((o) => o.id === pkg.name)) {
            out.push({ id: pkg.name, version: pkg.version || '', description: pkg.description || '', path: path.relative(base, path.join(gp, e.name)) });
          }
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return { ok: true, plugins: out };
});
ipcMain.handle('settings:presetDefault', async () => {
  const r = await rpcCall('settings.describe', {});
  if (!r.ok) return { ok: false, error: r.error?.message || 'settings.describe failed' };
  const ns = (r.value?.namespaces || []).find((n) => n.ns === 'agent-presets');
  return { ok: true, default: ns?.value?.default ?? null };
});
ipcMain.handle('settings:setPresetDefault', async (_e, preset) => {
  const r = await rpcCall('settings.update', { ns: 'agent-presets', patch: { default: preset } });
  if (!r.ok) return { ok: false, error: r.error?.message || 'settings.update failed' };
  return { ok: true, value: r.value?.value?.default ?? preset };
});
ipcMain.handle('settings:describe', async () => {
  const r = await rpcCall('settings.describe', {});
  if (!r.ok) return { ok: false, error: r.error?.message || 'settings.describe failed' };
  return { ok: true, ...r.value };
});
ipcMain.handle('settings:openDoc', async () => {
  const r = await rpcCall('settings.openDocument', {});
  if (!r.ok) return { ok: false, error: r.error?.message || 'settings.openDocument failed' };
  return { ok: true, ...r.value };
});
// ---------- 模型提供商：凭据读写 + 配置写入 + 连接探测 ----------
// 与 Web UI 的 Models 页同一套 RPC：credentials.set 存密钥，
// settings.mutate 把 apiKeyEnv 写进 llm-pi-ai 的 providers.<name>，
// llm.discoverModels 用输入框里的密钥直接探测端点。
ipcMain.handle('credentials:describe', async (_e, refs) => {
  const list = Array.isArray(refs) ? refs.filter((r) => typeof r === 'string' && r.length > 0) : [];
  const r = await rpcCall('credentials.describe', { refs: list });
  if (!r.ok) return { ok: false, error: r.error?.message || 'credentials.describe failed' };
  return { ok: true, credentials: r.value?.credentials || {} };
});
ipcMain.handle('credentials:set', async (_e, { ref, value }) => {
  const r = await rpcCall('credentials.set', { ref, value });
  if (!r.ok) return { ok: false, error: r.error?.message || 'credentials.set failed' };
  return { ok: true };
});
ipcMain.handle('credentials:unset', async (_e, ref) => {
  const r = await rpcCall('credentials.unset', { ref });
  if (!r.ok) return { ok: false, error: r.error?.message || 'credentials.unset failed' };
  return { ok: true };
});
ipcMain.handle('settings:mutate', async (_e, { ns, ops, expectedRevision }) => {
  const payload = { ns, ops };
  if (typeof expectedRevision === 'number') payload.expectedRevision = expectedRevision;
  const r = await rpcCall('settings.mutate', payload);
  if (!r.ok) return { ok: false, error: r.error?.message || 'settings.mutate failed' };
  return { ok: true, ...r.value };
});
ipcMain.handle('llm:discoverModels', async (_e, { settingsNs, provider, apiKey, api, baseURL }) => {
  const payload = { settingsNs, provider };
  if (typeof apiKey === 'string' && apiKey.length > 0) payload.apiKey = apiKey;
  // 草稿探测：路由还没写进 settings 时 engine 读不到它的 api/baseURL，
  // 这两个字段让「添加自定义提供商」能在保存之前就问出端点提供哪些模型。
  // 已有 profile 的路由照旧从配置里取值，这两个字段只是覆盖。
  if (typeof api === 'string' && api.length > 0) payload.api = api;
  if (typeof baseURL === 'string' && baseURL.length > 0) payload.baseURL = baseURL;
  const r = await rpcCall('llm.discoverModels', payload);
  if (!r.ok) return { ok: false, error: r.error?.message || 'llm.discoverModels failed' };
  return { ok: true, models: r.value?.models || [] };
});

// 从 ~/.dsh/.credentials.yaml 读一个凭据引用对应的明文。
// 只在本进程内部用于出站探测请求：配置界面按设计只持有被抹密的描述符，明文绝不跨 IPC 回渲染进程。
// 读不到（没配过、文件不存在、格式不认识）就返回 undefined，探测会以未认证姿态进行，由界面提示。
function readCredentialPlaintext(ref) {
  if (typeof ref !== 'string' || !/^[A-Za-z0-9_]{1,64}$/.test(ref)) return undefined;
  try {
    const file = path.join(DSH_HOME, '.credentials.yaml');
    if (!fs.existsSync(file)) return undefined;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Za-z0-9_]{1,64})\s*:\s*(.+?)\s*$/.exec(line);
      if (!m || m[1] !== ref) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return v.length > 0 ? v : undefined;
    }
  } catch { /* 读不到就当没有：调用方会以未认证姿态探测 */ }
  return undefined;
}

// 模型能力探测：上下文窗口 / 输出上限 / 可用思考档位。
// llm-pi-ai 把这三样写死在路由配置里，而厂商会上下线模型、调整档位、放宽窗口，
// 所以必须能随时重新问一遍（详见 lib/model-probe.js 的注释）。
ipcMain.handle('llm:probeCapabilities', async (event, { baseURL, api, apiKey, apiKeyEnv, models, concurrency } = {}) => {
  const list = Array.isArray(models)
    ? models.filter((m) => typeof m === 'string' && m.length > 0).slice(0, 200)
    : [];
  if (list.length === 0) return { ok: false, error: '没有可探测的模型：请先「获取可用模型」或手动添加' };
  if (typeof baseURL !== 'string' || !/^https?:\/\//.test(baseURL)) {
    return { ok: false, error: 'API 地址无效（需以 http:// 或 https:// 开头），无法探测' };
  }
  // 密钥优先用界面上刚输入的（用户正在验证它），否则按引用名在本机读。
  // 这样「只想刷新能力」的用户不必重新粘贴一次密钥。
  const typed = typeof apiKey === 'string' && apiKey.length > 0 ? apiKey : undefined;
  const key = typed || readCredentialPlaintext(apiKeyEnv);
  try {
    const out = await probeModelCapabilities({
      baseURL,
      api,
      apiKey: key,
      models: list,
      concurrency,
      onProgress: (line) => {
        try { if (!event.sender.isDestroyed()) event.sender.send('llm:probeProgress', line); } catch { /* 窗口已关 */ }
      },
    });
    return { ok: true, hadKey: key !== undefined, ...out };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
});

// 「配置仓库」界面用它把思考档位点选控件画出来：引擎档位名（off/minimal/…/max）
// 与每个档位要写的线上拼写（off → none）。
// 之所以走 IPC 而不是在渲染层再写一份常量：这两个表是探测逻辑的一部分，
// 抄一份就会漂——探测用新拼写、界面写旧拼写，用户点出来的档位引擎不认。
// preload 处于沙箱里，require 不到本地模块，所以由主进程吐出来。
ipcMain.handle('llm:reasoningLevels', () => ({
  ok: true,
  engine: ENGINE_LEVELS,
  wire: WIRE_CANDIDATES,
}));
// 主题工作室的 IPC（扫描 WebUI 主题插件 / 免费迁移 / 模型精修 / 主题库读写）
// 逻辑在 lib/theme-ipc.js —— 它需要真实的 ipcMain 才能被端到端验证，
// 留在本文件里就只能靠手点界面测；抽出来后测试注册的是同一批处理器。
registerThemeIpc({
  ipcMain,
  dshHome: DSH_HOME,
  appDir: __dirname,
  discoverHarness,
  readCredentialPlaintext,
  rpcCall,
  revealPath: (dir) => shell.openPath(dir),
  showInFolder: (file) => shell.showItemInFolder(file),
});
// ---------- Git（工作区级）与内置浏览器 ----------
// git：让界面"知道当前在哪个仓库/分支"并能切分支、新建分支；全部 spawn(git, 数组, {cwd})，
//      不拼 shell，分支名走白名单校验；可执行范围限制在工作区目录与用户主目录之下。
// 浏览器：WebContentsView（Electron 30+），独立 webContents，不受渲染层 CSP 约束；
//      渲染层只提供"占位矩形"，视图由主进程贴上去。
const { registerGitIpc } = require('./lib/git-ipc.js');
const { registerBrowserIpc } = require('./lib/browser-ipc.js');

/** 在工作区目录打开**系统终端**（应用内终端需要 node-pty 原生依赖，另议） */
async function openSystemTerminal(dir) {
  const { spawn: spawnDetached } = require('node:child_process');
  if (process.platform === 'win32') {
    // 优先 Windows Terminal；没有就退回 cmd（start 会新开窗口，不阻塞）
    try {
      spawnDetached('wt.exe', ['-d', dir], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
      return;
    } catch { /* 没有 wt，退回 cmd */ }
    spawnDetached('cmd.exe', ['/c', 'start', 'cmd', '/K', `cd /d "${dir}"`], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    return;
  }
  if (process.platform === 'darwin') {
    spawnDetached('open', ['-a', 'Terminal', dir], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  for (const term of ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal']) {
    try {
      spawnDetached(term, ['--working-directory', dir], { detached: true, stdio: 'ignore' }).unref();
      return;
    } catch { /* 试下一个 */ }
  }
  throw new Error('没有找到可用的终端程序');
}

const gitCtl = registerGitIpc({
  ipcMain,
  resolveGitExe: () => resolveExe('git'),
  defaultWorkspaceDir,
  // 允许执行 git 的根：工作区目录 / 引擎目录 / DSH 家目录 / 用户主目录
  // 🔴 传函数（每次调用时求值）：HARNESS_DIR / DSH_HOME 是异步探测的，注册这一刻还是空串
  allowRoots: () => [defaultWorkspaceDir(), HARNESS_DIR, DSH_HOME, os.homedir()].filter(Boolean),
  // 引擎登记的工作区目录（用户真实工作区常不等于默认目录 —— 真机实测踩到过，见 lib/git-ipc.js 注释）
  listWorkspaceDirs: async () => {
    try {
      const r = await rpcCall('workspace.list', {});
      return ((r && r.ok && r.value && r.value.items) || []).map((w) => w && w.path).filter(Boolean);
    } catch { return []; }
  },
  openTerminal: openSystemTerminal,
});

const browserCtl = registerBrowserIpc({
  ipcMain,
  getWindow: () => mainWindow,
});

// ---------- 侧边栏 Dock：GitHub（SSH 密钥）/ MCP / Skills ----------
// GitHub 连接走本机 SSH 密钥（git@github.com），不保存任何密钥材料，
// 只在 ~/.dsh/.github-ssh.json 记录密钥路径与登录名；仓库浏览全部用 git over SSH。
// 可选：只读 Token 文件（~/.dsh/.github-listing-token），仅用于列出私有仓库，不参与 SSH 连接。
const GH_SSH_FILE = path.join(DSH_HOME, '.github-ssh.json');
const GH_REPOS_FILE = path.join(DSH_HOME, '.github-repos.json');
const GH_CACHE_DIR = path.join(DSH_HOME, '.gh-cache');
const GH_TOKEN_FILE = path.join(DSH_HOME, '.github-listing-token');
const SSH_DIR = path.join(os.homedir(), '.ssh');

function resolveExe(name) {
  try {
    const r = spawnSync('where', [name], { windowsHide: true, encoding: 'utf8' });
    const line = (r.stdout || '').split(/\r?\n/).find((l) => l.trim().length > 0);
    if (line) return line.trim();
  } catch { /* 找不到就用裸命令名 */ }
  return name;
}
const SSH_EXE = resolveExe('ssh');
const GIT_EXE = resolveExe('git');

function execOut(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, {
      windowsHide: true,
      encoding: 'utf8',
      timeout: opts.timeout || 20000,
      env: opts.env || process.env,
      maxBuffer: 32 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, code: err.code, killed: !!err.killed, message: err.message, stdout: stdout || '', stderr: stderr || '' });
      resolve({ ok: true, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function readGhSsh() {
  try { return JSON.parse(fs.readFileSync(GH_SSH_FILE, 'utf8')); } catch { return null; }
}
function writeGhSsh(obj) {
  fs.mkdirSync(DSH_HOME, { recursive: true });
  fs.writeFileSync(GH_SSH_FILE, JSON.stringify(obj, null, 2), 'utf8');
}
function readGhRepos() {
  try { return JSON.parse(fs.readFileSync(GH_REPOS_FILE, 'utf8')); } catch { return []; }
}
function writeGhRepos(list) {
  fs.mkdirSync(DSH_HOME, { recursive: true });
  fs.writeFileSync(GH_REPOS_FILE, JSON.stringify(list, null, 2), 'utf8');
}
function gitSshEnv() {
  const gh = readGhSsh();
  let cmd = `"${SSH_EXE}" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10`;
  if (gh && gh.keyPath && fs.existsSync(gh.keyPath)) cmd += ` -i "${gh.keyPath}"`;
  // 22 端口被防火墙拦截时回退 ssh.github.com:443（GitHub 官方支持 SSH over HTTPS）
  if (gh && gh.sshPort && gh.sshPort !== 22) cmd += ` -p ${gh.sshPort} -o HostName=${gh.sshHost || 'ssh.github.com'}`;
  return { ...process.env, GIT_SSH_COMMAND: cmd };
}
function sshErrText(r) {
  switch (r.err) {
    case 'auth': return 'SSH 认证失败：请确认该密钥已添加到 GitHub（Settings → SSH and GPG keys），且无密码短语（或已用 ssh-add 加入 ssh-agent）';
    case 'hostkey': return '主机密钥验证失败：请先手动运行 ssh -T git@github.com 确认服务器指纹';
    case 'network': return r.detail || '网络错误：无法连接 github.com（22 端口）';
    default: return r.detail || 'SSH 连接失败';
  }
}
// ssh -T git@github.com 的退出码恒为 1（GitHub 不提供 shell），只能解析 "Hi <login>!" 判断成功
async function sshHello(keyPath, mode) {
  const m = mode || { host: 'github.com', port: 22 };
  const args = ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=10', '-p', String(m.port)];
  if (m.host !== 'github.com') args.push('-o', `HostName=${m.host}`);
  if (keyPath && fs.existsSync(keyPath)) args.push('-i', keyPath);
  args.push('git@github.com');
  const r = await execOut(SSH_EXE, args, { timeout: 15000 });
  const text = (r.stdout || '') + '\n' + (r.stderr || '');
  const hit = text.match(/Hi ([A-Za-z0-9-]+)!/);
  if (hit) return { login: hit[1] };
  if (/Permission denied|publickey/i.test(text)) return { err: 'auth' };
  if (/Host key verification failed/i.test(text)) return { err: 'hostkey' };
  if (/Could not resolve hostname|Connection timed out|Connection refused|Network is unreachable/i.test(text)) return { err: 'network' };
  return { err: 'unknown', detail: text.trim().slice(0, 200) };
}
// 22 端口连不上时自动回退 ssh.github.com:443，成功后记住该模式（持久化到 ~/.dsh/.github-ssh.json）
async function sshHelloWithFallback(keyPath, saved) {
  if (saved && saved.sshPort && saved.sshPort !== 22) {
    const r = await sshHello(keyPath, { host: saved.sshHost || 'ssh.github.com', port: saved.sshPort });
    return { ...r, sshHost: saved.sshHost || 'ssh.github.com', sshPort: saved.sshPort };
  }
  const r = await sshHello(keyPath, { host: 'github.com', port: 22 });
  if (r.login) return { ...r, sshHost: 'github.com', sshPort: 22 };
  if (r.err === 'network') {
    const alt = await sshHello(keyPath, { host: 'ssh.github.com', port: 443 });
    if (alt.login) return { ...alt, sshHost: 'ssh.github.com', sshPort: 443 };
    // 443 的真实错误（如认证失败）要透传，不能笼统报"网络错误"
    if (alt.err !== 'network') return alt;
    return { err: 'network', detail: '无法连接 github.com（22 端口与 443 端口 ssh.github.com 均失败）' };
  }
  return r;
}
function detectSshKeys() {
  const keys = [];
  const sshDir = path.join(os.homedir(), '.ssh');
  const names = ['id_ed25519', 'id_ecdsa', 'id_rsa', 'id_ed25519_sk', 'id_ecdsa_sk', 'id_dsa'];
  if (fs.existsSync(sshDir)) {
    for (const n of names) {
      const p = path.join(sshDir, n);
      if (fs.existsSync(p)) keys.push({ path: p, name: n, source: '~/.ssh' });
    }
  }
  // ~/.ssh/config 中为 github.com 指定的 IdentityFile
  try {
    const cfg = fs.readFileSync(path.join(sshDir, 'config'), 'utf8');
    let inGh = false;
    for (const raw of cfg.split(/\r?\n/)) {
      const line = raw.trim();
      if (/^Host\s+/i.test(line)) inGh = /\bgithub\.com\b/i.test(line);
      else if (inGh && /^IdentityFile\s+/i.test(line)) {
        let p = line.replace(/^IdentityFile\s+/i, '').replace(/^"|"$/g, '').replace(/^~\//, os.homedir() + '/');
        if (!path.isAbsolute(p)) p = path.join(sshDir, p);
        if (fs.existsSync(p) && !keys.some((k) => k.path === p)) keys.push({ path: p, name: path.basename(p), source: 'ssh config' });
      }
    }
  } catch { /* 没有 config 文件 */ }
  return keys;
}
function ghHostsHijacked() {
  try {
    const hostsFile = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');
    const hosts = fs.readFileSync(hostsFile, 'utf8');
    return /^[ \t]*127\.0\.0\.1[ \t]+github\.com([ \t#].*)?$/m.test(hosts);
  } catch { return false; }
}
async function ghAvatarDataUrl(login) {
  try {
    // 头像不需要认证：github.com/<login>.png（8 秒超时，避免网络异常时卡住连接流程）
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    const res = await net.fetch(`https://github.com/${encodeURIComponent(login)}.png`, { headers: { 'User-Agent': 'dsh-desktop' }, signal: ac.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch { return null; }
}
function normalizeGhUrl(input) {
  let s = String(input || '').trim();
  if (!s) return { err: '仓库地址不能为空' };
  if (/^git@github\.com:/i.test(s)) {
    s = s.replace(/\.git$/i, '') + '.git';
  } else if (/^https?:\/\/github\.com\//i.test(s)) {
    const p = s.replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/g, '');
    if (!p.includes('/')) return { err: '无法识别的仓库地址（需要 owner/repo）' };
    s = 'git@github.com:' + p.replace(/\.git$/i, '') + '.git';
  } else if (/^ssh:\/\/git@github\.com\//i.test(s)) {
    s = 'git@github.com:' + s.replace(/^ssh:\/\/git@github\.com\//i, '').replace(/\.git$/i, '') + '.git';
  } else if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s)) {
    s = 'git@github.com:' + s.replace(/\.git$/i, '') + '.git';
  } else {
    return { err: '无法识别的仓库地址（支持 owner/repo、git@github.com:owner/repo.git 或 https://github.com/owner/repo）' };
  }
  return { url: s };
}
function ghUrlName(url) {
  return url.replace(/^git@github\.com:/, '').replace(/\.git$/, '');
}
function ghSshFail(r) {
  const msg = ((r.stderr || '') + ' ' + (r.message || '')).trim();
  if (/Permission denied|publickey/i.test(msg)) return 'SSH 认证失败：请先在 GitHub 面板完成 SSH 连接';
  if (/Could not resolve hostname|Connection timed out|Connection refused/i.test(msg)) return '网络错误：无法连接 github.com';
  return msg ? msg.slice(0, 200) : 'git 命令失败';
}

ipcMain.handle('github:status', async () => {
  const gh = readGhSsh();
  if (!gh || !gh.login) return { ok: true, connected: false };
  // 5 分钟内验证过就不再反复 ssh（打开面板时快速返回）
  if (!gh.verifiedAt || Date.now() - gh.verifiedAt >= 5 * 60 * 1000) {
    const v = await sshHelloWithFallback(gh.keyPath || null, gh);
    if (!v.login) {
      if (v.err === 'auth') { fs.rmSync(GH_SSH_FILE, { force: true }); return { ok: true, connected: false }; }
      return { ok: false, error: sshErrText(v) };
    }
    gh.login = v.login;
    gh.sshHost = v.sshHost;
    gh.sshPort = v.sshPort;
    gh.verifiedAt = Date.now();
    writeGhSsh(gh);
  }
  return { ok: true, connected: true, login: gh.login, name: gh.name || gh.login, keyPath: gh.keyPath || '', sshPort: gh.sshPort || 22, avatar: await ghAvatarDataUrl(gh.login) };
});
ipcMain.handle('github:detectKeys', async () => ({ ok: true, keys: detectSshKeys(), hostsHijacked: ghHostsHijacked() }));
ipcMain.handle('github:pickKey', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择 SSH 私钥文件',
    properties: ['openFile'],
    defaultPath: path.join(os.homedir(), '.ssh'),
  });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  return { ok: true, path: r.filePaths[0] };
});
ipcMain.handle('github:connect', async (_e, opts) => {
  const { keyPath, keyContent } = opts || {};
  let kp = String(keyPath || '').trim();
  const content = String(keyContent || '').trim();
  // 粘贴完整私钥内容 → 自动安装到 ~/.ssh/id_ed25519（旧文件先备份），随后自动用它连接
  if (content) {
    if (!/^-----BEGIN [A-Z0-9 ]+PRIVATE KEY-----/m.test(content)) {
      return { ok: false, error: '粘贴的不是完整私钥：应以 -----BEGIN OPENSSH PRIVATE KEY----- 开头、-----END OPENSSH PRIVATE KEY----- 结尾，请完整复制' };
    }
    fs.mkdirSync(SSH_DIR, { recursive: true });
    const target = path.join(SSH_DIR, 'id_ed25519');
    if (fs.existsSync(target)) fs.renameSync(target, `${target}.bak-${Date.now()}`);
    fs.writeFileSync(target, content.replace(/\r\n/g, '\n').trimEnd() + '\n', 'utf8');
    try {
      spawnSync('icacls', [target, '/inheritance:r', '/grant:r', `${os.userInfo().username}:F`], { windowsHide: true });
    } catch { /* 权限整理失败不影响使用 */ }
    kp = target;
  }
  if (kp && !fs.existsSync(kp)) kp = '';
  // 没有任何密钥 → 自动生成一把无密码密钥，只需用户把公钥添加到 GitHub 一次
  if (!kp && detectSshKeys().length === 0) {
    fs.mkdirSync(SSH_DIR, { recursive: true });
    const target = path.join(SSH_DIR, 'id_ed25519');
    if (fs.existsSync(target)) fs.renameSync(target, `${target}.bak-${Date.now()}`);
    const gen = spawnSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'dsh-desktop', '-f', target], { windowsHide: true, encoding: 'utf8' });
    if (gen.status !== 0) return { ok: false, error: `自动生成密钥失败：${(gen.stderr || gen.stdout || '').slice(0, 200)}` };
    kp = target;
    const pub = fs.readFileSync(`${kp}.pub`, 'utf8').trim();
    return { ok: false, needRegister: true, pub, keyPath: kp, error: '已自动生成新密钥，请把公钥添加到 GitHub 后重试连接' };
  }
  const r = await sshHelloWithFallback(kp || null, readGhSsh());
  if (!r.login) return { ok: false, error: sshErrText(r) };
  writeGhSsh({ keyPath: kp || null, login: r.login, name: r.login, sshHost: r.sshHost, sshPort: r.sshPort, verifiedAt: Date.now() });
  const avatar = await ghAvatarDataUrl(r.login);
  return { ok: true, login: r.login, name: r.login, avatar, keyPath: kp || null, sshPort: r.sshPort };
});
ipcMain.handle('github:openKeysPage', async () => {
  await shell.openExternal('https://github.com/settings/ssh/new');
  return { ok: true };
});
ipcMain.handle('github:logout', async () => {
  fs.rmSync(GH_SSH_FILE, { force: true });
  return { ok: true };
});
function readGhToken() {
  try { return fs.readFileSync(GH_TOKEN_FILE, 'utf8').trim(); } catch { return null; }
}
function writeGhToken(token) {
  fs.mkdirSync(DSH_HOME, { recursive: true });
  fs.writeFileSync(GH_TOKEN_FILE, token, 'utf8');
}
ipcMain.handle('github:listTokenStatus', async () => {
  const t = readGhToken();
  return { ok: true, set: !!t, prefix: t ? `${t.slice(0, 4)}…（${t.length} 字符）` : '' };
});
ipcMain.handle('github:setListToken', async (_e, token) => {
  const t = String(token || '').trim();
  if (!t) return { ok: false, error: 'Token 不能为空' };
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15000);
    const res = await net.fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${t}`,
        'User-Agent': 'dsh-desktop',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: ac.signal,
    });
    clearTimeout(timer);
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'Token 无效或已过期' };
    if (!res.ok) return { ok: false, error: `GitHub API ${res.status}` };
    const u = await res.json();
    writeGhToken(t);
    return { ok: true, login: u.login };
  } catch (err) {
    return { ok: false, error: `网络错误: ${err.message}` };
  }
});
ipcMain.handle('github:clearListToken', async () => {
  fs.rmSync(GH_TOKEN_FILE, { force: true });
  return { ok: true };
});
ipcMain.handle('github:repos', async () => {
  const history = readGhRepos().map((x) => ({
    url: x.url,
    name: ghUrlName(x.url),
    addedAt: x.addedAt || 0,
  }));
  // SSH 无法枚举仓库（GitHub 平台限制）。有只读 Token → 列出全部仓库（含私有）；
  // 无 Token → 匿名 API 只列公开仓库。连接始终是 SSH key，Token 仅用于列列表。
  let allRepos = null;
  let publicRepos = null;
  let listError = null;
  const gh = readGhSsh();
  const listToken = readGhToken();
  if (gh && gh.login) {
    if (listToken) {
      const r = await ghApiRepos(listToken);
      if (r.err) listError = r.err;
      else allRepos = r.repos;
    } else {
      const r = await ghPublicRepos(gh.login);
      if (r.err) listError = r.err;
      else publicRepos = r.repos;
    }
  }
  return { ok: true, repos: history, public: publicRepos, all: allRepos, listError, tokenSet: !!listToken };
});

function ghRepoMap(x) {
  return {
    url: `git@github.com:${x.full_name}.git`,
    name: x.full_name,
    description: x.description || '',
    default_branch: x.default_branch || 'main',
    private: !!x.private,
    updated_at: x.updated_at || '',
  };
}
async function ghApiRepos(token) {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15000);
    const res = await net.fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'dsh-desktop',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: ac.signal,
    });
    clearTimeout(timer);
    if (res.status === 401 || res.status === 403) return { err: 'Token 无效或已过期，请重新设置' };
    if (!res.ok) return { err: `GitHub API ${res.status}` };
    const data = await res.json();
    return { repos: data.map(ghRepoMap) };
  } catch (err) {
    return { err: `网络错误: ${err.message}` };
  }
}

async function ghPublicRepos(login) {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10000);
    const res = await net.fetch(`https://api.github.com/users/${encodeURIComponent(login)}/repos?per_page=100&sort=updated`, {
      headers: { 'User-Agent': 'dsh-desktop', Accept: 'application/vnd.github+json' },
      signal: ac.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { err: res.status === 403 ? '匿名 API 限流（60 次/小时），稍后再试' : `GitHub API ${res.status}` };
    const data = await res.json();
    return {
      repos: data.map((x) => ({
        url: `git@github.com:${x.full_name}.git`,
        name: x.full_name,
        description: x.description || '',
        default_branch: x.default_branch || 'main',
        private: !!x.private,
        updated_at: x.updated_at || '',
      })),
    };
  } catch (err) {
    return { err: `网络错误: ${err.message}` };
  }
}
ipcMain.handle('github:removeRepo', async (_e, url) => {
  writeGhRepos(readGhRepos().filter((x) => x.url !== url));
  return { ok: true };
});
ipcMain.handle('github:addRepo', async (_e, input) => {
  const norm = normalizeGhUrl(input);
  if (norm.err) return { ok: false, error: norm.err };
  // 校验可达性并读取默认分支
  const r = await execOut(GIT_EXE, ['ls-remote', '--symref', norm.url, 'HEAD'], { timeout: 20000, env: gitSshEnv() });
  if (!r.ok) return { ok: false, error: ghSshFail(r) };
  const defM = (r.stdout || '').match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m);
  const list = readGhRepos().filter((x) => x.url !== norm.url);
  list.unshift({ url: norm.url, addedAt: Date.now() });
  writeGhRepos(list.slice(0, 20));
  return { ok: true, repo: { url: norm.url, default_branch: defM ? defM[1] : null } };
});
ipcMain.handle('github:branches', async (_e, { url }) => {
  const r = await execOut(GIT_EXE, ['ls-remote', '--symref', '--heads', url, 'HEAD'], { timeout: 20000, env: gitSshEnv() });
  if (!r.ok) return { ok: false, error: ghSshFail(r) };
  const defM = (r.stdout || '').match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m);
  const branches = [];
  for (const line of (r.stdout || '').split(/\r?\n/)) {
    const m = line.match(/^[0-9a-f]{40}\trefs\/heads\/(.+)$/);
    if (m) branches.push(m[1]);
  }
  return { ok: true, branches, defaultBranch: defM ? defM[1] : null };
});
ipcMain.handle('github:tree', async (_e, { url, branch }) => {
  const r = await ghTreeFor(url, branch);
  if (r.err) return { ok: false, error: r.err };
  return { ok: true, tree: r.tree, truncated: false };
});
async function ghTreeFor(url, branch) {
  const env = gitSshEnv();
  fs.mkdirSync(GH_CACHE_DIR, { recursive: true });
  const dir = path.join(GH_CACHE_DIR, `${encodeURIComponent(url)}__${encodeURIComponent(branch)}`);
  // 缓存 10 分钟；克隆时只取树对象（--filter=blob:none --no-checkout），速度很快
  const needClone = !fs.existsSync(dir) || (Date.now() - fs.statSync(dir).mtimeMs > 10 * 60 * 1000);
  if (needClone) {
    fs.rmSync(dir, { recursive: true, force: true });
    const c = await execOut(GIT_EXE, ['clone', '--depth', '1', '--single-branch', '--branch', branch, '--no-checkout', '--filter=blob:none', url, dir], { timeout: 120000, env });
    if (!c.ok) {
      fs.rmSync(dir, { recursive: true, force: true });
      return { err: ghSshFail(c) };
    }
  }
  const t = await execOut(GIT_EXE, ['-C', dir, 'ls-tree', '-r', 'HEAD'], { timeout: 60000, env });
  if (!t.ok) return { err: `读取文件树失败：${ghSshFail(t)}` };
  const tree = [];
  for (const line of (t.stdout || '').split(/\r?\n/)) {
    const m = line.match(/^(\d{6})\s+(\S+)\s+([0-9a-f]{40})\t(.+)$/);
    if (m) tree.push({ path: m[4], type: m[2] === 'tree' ? 'tree' : 'blob' });
  }
  return { tree };
}

ipcMain.handle('mcp:list', async () => {
  // MCP 服务器在活动 profile 的组合文件（cordis.yml / cordis.patch.yml）里以 mcp-client 行声明
  const out = [];
  const dirs = [path.join(DSH_HOME, 'profiles', 'web')];
  for (const dir of dirs) {
    for (const name of ['cordis.yml', 'cordis.patch.yml']) {
      const f = path.join(dir, name);
      if (!fs.existsSync(f)) continue;
      const text = fs.readFileSync(f, 'utf8');
      const rows = text.split(/\r?\n/);
      for (let i = 0; i < rows.length; i++) {
        const line = rows[i];
        if (!/^\s*-\s*(plugin:\s*)?@?deepseek-ai\/?dsh-mcp-client\b|^\s*-\s*plugin:\s*mcp-client\b/.test(line) && !/mcp-client/.test(line)) continue;
        const block = rows.slice(i, i + 40).join('\n');
        const nameM = block.match(/serverName\s*:\s*["']?([^"'\s]+)/);
        const cmdM = block.match(/command\s*:\s*["']?([^"'\s]+)/);
        out.push({ serverName: nameM ? nameM[1] : 'mcp-server', command: cmdM ? cmdM[1] : '' });
        i += 40;
      }
    }
  }
  return { ok: true, servers: out };
});
ipcMain.handle('skills:list', async (_e, sessionId) => {
  const sid = sessionId;
  if (!sid) {
    const list = await rpcCall('session.list', {});
    const first = (list.ok ? list.value?.items?.[0]?.sessionId : null) || null;
    if (!first) return { ok: false, error: '无可用会话' };
    return skillsFor(first);
  }
  return skillsFor(sid);
});
async function skillsFor(sessionId) {
  const r = await rpcCall('skill.list', { sessionId });
  if (!r.ok) return { ok: false, error: r.error?.message || 'skill.list failed' };
  return { ok: true, skills: r.value?.skills || [] };
}

// ---------- OpenCode Zen 免费模型 UA 代理（解决免费模型 429 FreeUsageLimitError） ----------
// 根因：OpenCode Zen 免费模型 deepseek-v4-flash-free 做客户端识别，带 deepseek-harness 归因 UA
//       会返回 429；UA=opencode/0.1.0 则正常。DSH 强制附加归因 UA 且不允许 settings 覆盖，
//       因此提供本地 UA 重写代理（config/zen-ua-proxy.mjs → 127.0.0.1:8790 → opencode.ai/zen）。
let zenUaProc = null;
const ZEN_UA_SCRIPT = path.join(__dirname, 'config', 'zen-ua-proxy.mjs');
const ZEN_UA_HOME_SCRIPT = path.join(DSH_HOME, 'zen-ua-proxy.mjs');
const ZEN_UA_PORT = 8790;

function zenUaIsUp() {
  return !!zenUaProc && !zenUaProc.killed;
}
function zenUaInstallTemplate() {
  // 把内置模板拷贝到 ~/.dsh/zen-ua-proxy.mjs（供开机自启与 setup.ps1 共用）
  try {
    fs.mkdirSync(DSH_HOME, { recursive: true });
    if (fs.existsSync(ZEN_UA_SCRIPT)) fs.copyFileSync(ZEN_UA_SCRIPT, ZEN_UA_HOME_SCRIPT);
  } catch { /* ignore */ }
  return ZEN_UA_HOME_SCRIPT;
}
function startZenUaProxy() {
  if (zenUaIsUp()) return { ok: true, running: true };
  const script = fs.existsSync(ZEN_UA_HOME_SCRIPT) ? ZEN_UA_HOME_SCRIPT : (fs.existsSync(ZEN_UA_SCRIPT) ? ZEN_UA_SCRIPT : null);
  if (!script) return { ok: false, error: '缺少 zen-ua-proxy.mjs 模板' };
  const nodeExe = resolveNodeExe();
  zenUaProc = spawn(nodeExe, [script, String(ZEN_UA_PORT)], { windowsHide: true, env: { ...process.env } });
  zenUaProc.stdout?.on('data', (d) => pushLog('stdout', `[zen-ua] ${d.toString()}`));
  zenUaProc.stderr?.on('data', (d) => pushLog('stderr', `[zen-ua] ${d.toString()}`));
  zenUaProc.on('exit', () => { zenUaProc = null; });
  return { ok: true, running: true };
}
function stopZenUaProxy() {
  if (zenUaProc && !zenUaProc.killed) { try { zenUaProc.kill(); } catch { /* ignore */ } }
  zenUaProc = null;
  return { ok: true };
}
// 写开机自启（与 setup.ps1 一致：Startup 目录放 vbs）
function installZenUaAutostart() {
  try {
    const script = zenUaInstallTemplate();
    const startup = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    fs.mkdirSync(startup, { recursive: true });
    // 用启动时解析的 node（优先 %LOCALAPPDATA%\DSH\tools\node，其次系统 node）
    const nodeExe = resolveNodeExe();
    const vbsLine = `WshShell.Run """${nodeExe}"" ""${script}""", 0, False`;
    fs.writeFileSync(path.join(DSH_HOME, 'zen-ua-proxy.vbs'), [
      "' DSH zen-ua-proxy (OpenCode Zen UA rewrite) logon autostart.",
      'Set WshShell = CreateObject("WScript.Shell")',
      vbsLine,
    ].join('\r\n'), 'ascii');
    fs.copyFileSync(path.join(DSH_HOME, 'zen-ua-proxy.vbs'), path.join(startup, 'zen-ua-proxy.vbs'));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
ipcMain.handle('zenua:enable', async () => {
  // 1) 安装模板到 ~/.dsh 并写开机自启
  zenUaInstallTemplate();
  installZenUaAutostart();
  // 2) 启动本地代理
  const started = startZenUaProxy();
  // 3) 把 opencode provider 的 baseURL 指向代理（写 llm-pi-ai settings）
  try {
    const d = await rpcCall('settings.describe', {});
    const ns = d.ok ? (d.value?.namespaces || []).find((n) => n.ns === 'llm-pi-ai') : null;
    const mut = await rpcCall('settings.mutate', {
      ns: 'llm-pi-ai',
      ops: [
        { op: 'set', path: ['providers', 'opencode', 'baseURL'], value: `http://127.0.0.1:${ZEN_UA_PORT}/v1` },
        { op: 'set', path: ['providers', 'opencode', 'apiKeyEnv'], value: 'OPENCODE_API_KEY' },
      ],
      expectedRevision: ns ? ns.revision : undefined,
    });
    return { ok: started.ok && mut.ok, proxy: started, settings: mut.ok, error: started.error || (mut.ok ? undefined : mut.error?.message) };
  } catch (e) {
    return { ok: false, proxy: started, error: e.message };
  }
});
ipcMain.handle('zenua:status', () => ({ ok: true, running: zenUaIsUp(), port: ZEN_UA_PORT, script: ZEN_UA_HOME_SCRIPT }));
ipcMain.handle('zenua:disable', async () => {
  // 移除 baseURL（回到提供方默认）
  try {
    const d = await rpcCall('settings.describe', {});
    const ns = d.ok ? (d.value?.namespaces || []).find((n) => n.ns === 'llm-pi-ai') : null;
    await rpcCall('settings.mutate', { ns: 'llm-pi-ai', ops: [{ op: 'unset', path: ['providers', 'opencode', 'baseURL'] }], expectedRevision: ns ? ns.revision : undefined });
  } catch { /* ignore */ }
  stopZenUaProxy();
  return { ok: true };
});

// ---------- 凭据（API Key）IPC ----------
function loadDotEnv() {
  const file = path.join(DSH_HOME, '.env');
  const env = {};
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !m[1].startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

ipcMain.handle('settings:getApiKey', async () => {
  const dotEnv = loadDotEnv();
  const status = { configured: !!dotEnv.DEEPSEEK_API_KEY, writable: true };
  if (await checkWebUp()) {
    const r = await rpcCall('credentials.describe', { refs: ['DEEPSEEK_API_KEY'] });
    if (r.ok && r.value?.credentials?.DEEPSEEK_API_KEY) {
      status.configured = r.value.credentials.DEEPSEEK_API_KEY.configured;
      status.writable = r.value.credentials.DEEPSEEK_API_KEY.writable;
    }
  }
  return { ok: true, ...status };
});

ipcMain.handle('settings:setApiKey', async (_e, key) => {
  const value = String(key || '').trim();
  if (!value) return { ok: false, error: 'empty key' };
  const file = path.join(DSH_HOME, '.env');
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : [];
  const out = [];
  let replaced = false;
  for (const line of lines) {
    if (/^\s*DEEPSEEK_API_KEY\s*=/.test(line)) {
      out.push(`DEEPSEEK_API_KEY=${value}`);
      replaced = true;
    } else out.push(line);
  }
  if (!replaced) out.push(`DEEPSEEK_API_KEY=${value}`);
  fs.mkdirSync(DSH_HOME, { recursive: true });
  fs.writeFileSync(file, out.join('\n'), 'utf8');
  let live = null;
  if (await checkWebUp()) {
    const r = await rpcCall('credentials.set', { ref: 'DEEPSEEK_API_KEY', value });
    live = r.ok ? 'ok' : r.error?.message || 'failed';
  }
  return { ok: true, live };
});

// ---------- 附件：非图片文件落盘到会话工作区 ----------
async function resolveSessionWorkspacePath(sessionId) {
  try {
    const ws = await rpcCall('workspace.list', {});
    if (ws.ok && Array.isArray(ws.value?.items)) {
      for (const w of ws.value.items) {
        if ((w.sessionIds || []).includes(sessionId)) return w.path || null;
      }
    }
  } catch { /* ignore */ }
  return null;
}

async function stageUploadFiles(sessionId, files) {
  if (!Array.isArray(files) || files.length === 0) return [];
  const wsPath = (await resolveSessionWorkspacePath(sessionId)) || defaultWorkspaceDir();
  const dir = path.join(wsPath, '.uploads');
  fs.mkdirSync(dir, { recursive: true });
  const staged = [];
  const used = new Set();
  for (const f of files) {
    const src = f && f.path ? String(f.path) : '';
    const name = f && f.name ? path.basename(String(f.name)) : (src ? path.basename(src) : 'file');
    const safe = (name.replace(/[\\/:*?"<>|]/g, '_') || 'file').trim();
    let target = safe;
    let i = 1;
    while (used.has(target) || fs.existsSync(path.join(dir, target))) {
      const dot = safe.lastIndexOf('.');
      const base = dot > 0 ? safe.slice(0, dot) : safe;
      const ext = dot > 0 ? safe.slice(dot) : '';
      target = `${base}-${i}${ext}`;
      i += 1;
    }
    used.add(target);
    try {
      if (src && fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(dir, target));
        staged.push({ name: safe, size: fs.statSync(path.join(dir, target)).size, savedPath: path.join(dir, target) });
      }
    } catch (err) {
      pushLog('stderr', `[upload] ${safe}: ${err.message}`);
    }
  }
  return staged;
}

ipcMain.handle('chat:pickFiles', async () => {
  const win = BrowserWindow.getFocusedWindow()
    || (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
  const opts = {
    title: '选择要发送的文件（Word / PPT / PDF / 图片 / 视频等）',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '常见文件', extensions: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf', 'txt', 'md', 'csv', 'json', 'xml', 'zip', 'rar', '7z', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'mp4', 'mkv', 'avi', 'mov', 'webm', 'mp3', 'wav'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  };
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (res.canceled || res.filePaths.length === 0) return { ok: true, cancelled: true, files: [] };
  return {
    ok: true,
    cancelled: false,
    files: res.filePaths.map((p) => {
      let size = 0;
      try { size = fs.statSync(p).size; } catch { /* ignore */ }
      return { path: p, name: path.basename(p), size };
    }),
  };
});

// 智能体提问（ask_user_question）：把渲染层答案作为 client-response 发给 harness
ipcMain.handle('chat:answerQuestion', async (_e, { rpcId, sessionId, answers }) => {
  const body = {
    type: 'client-response',
    rpcId: String(rpcId),
    result: { ok: true, value: { sessionId, answer: { answers } } },
  };
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const parsed = await res.json();
    const accepted = parsed?.accepted === true;
    return { ok: accepted, accepted, reason: parsed?.reason };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// 工具权限审批（approval/requested 应答）：把渲染层决定作为 client-response 发给 harness
ipcMain.handle('chat:answerApproval', async (_e, { rpcId, sessionId, approvalId, outcome }) => {
  const body = {
    type: 'client-response',
    rpcId: String(rpcId),
    result: { ok: true, value: { sessionId, approvalId, outcome } },
  };
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const parsed = await res.json();
    const accepted = parsed?.accepted === true;
    return { ok: accepted, accepted, reason: parsed?.reason };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ---------- 插件市场（原生桌面页面：直连本机 /dsh-market/* 路由） ----------
// 变更路由要求 sameOrigin（Origin.host === Host）且 loopback 直连；Electron 主进程
// fetch 需显式带 Origin 头，且绝不能带 x-forwarded-* 等转发头。
const MARKET_BASE = () => `http://127.0.0.1:${PORT}`;

async function marketFetchJSON(pathName, { method = 'GET', body } = {}) {
  const headers = { accept: 'application/json' };
  const opts = { method, headers };
  if (method === 'POST') {
    opts.headers['content-type'] = 'application/json';
    opts.headers['origin'] = MARKET_BASE(); // sameOrigin 校验：new URL(origin).host === Host
    opts.body = JSON.stringify(body || {});
  }
  const res = await fetch(`${MARKET_BASE()}${pathName}`, opts);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

function marketError(r) {
  const d = r && r.data;
  const msg = (d && (typeof d.error === 'string' ? d.error : d.message)) || String(d || '');
  return (r.ok ? undefined : (msg || `HTTP ${r.status}`));
}

ipcMain.handle('market:get', async (_e, pathName) => {
  try {
    const r = await marketFetchJSON(String(pathName || ''));
    return { ok: r.ok, status: r.status, data: r.data, error: marketError(r) };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
});

ipcMain.handle('market:post', async (_e, { path: pathName, body } = {}) => {
  try {
    const r = await marketFetchJSON(String(pathName || ''), { method: 'POST', body });
    return { ok: r.ok, status: r.status, data: r.data, error: marketError(r) };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
});

ipcMain.handle('market:backup', async () => {
  try {
    const res = await fetch(`${MARKET_BASE()}/dsh-market/backup`, { headers: { accept: 'application/json' } });
    if (!res.ok) { const t = await res.text().catch(() => ''); return { ok: false, error: `HTTP ${res.status} ${t.slice(0, 300)}` }; }
    const data = await res.json();
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const r = await dialog.showSaveDialog(mainWindow, {
      title: '导出插件配置备份',
      defaultPath: `dsh-market-backup-${ts}.json`,
      filters: [{ name: 'JSON 备份', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(r.filePath, JSON.stringify(data, null, 2), 'utf8');
    return { ok: true, path: r.filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('market:pickBackup', async () => {
  try {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '选择备份文件',
      properties: ['openFile'],
      filters: [{ name: 'JSON 备份', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
    const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    return { ok: true, path: r.filePaths[0], data };
  } catch (err) {
    return { ok: false, error: `备份解析失败：${err.message}` };
  }
});

ipcMain.handle('market:logExport', async () => {
  try {
    const res = await fetch(`${MARKET_BASE()}/dsh-market/logs`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const text = await res.text();
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const r = await dialog.showSaveDialog(mainWindow, {
      title: '导出市场日志',
      defaultPath: `dsh-market-log-${ts}.txt`,
      filters: [{ name: '文本日志', extensions: ['txt'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(r.filePath, text, 'utf8');
    return { ok: true, path: r.filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ---------- 插件市场自动补装：探测 /dsh-market/status，缺失则用捆绑 node 安装 dshmarket ----------
// 优先路径：{LAYOUT_ROOT}\app\extras\dsh-market-bundle\manifest.json + dshmarket-*.tgz
//   → 校验 manifest.json 的 SHA256 与 tarball 一致 → 调 `dsh plugin add <tarball>` 从本地装（不走 npm）
// Fallback：本地 tarball 不存在 / 校验失败 → 远程 `dsh plugin add dshmarket`（需 npm 网络）
// 幂等：已就绪直接返回；完成后提示重启让引擎重新组合。
//
// 重要：harness 的 /dsh-market/* 路由由 dshmarket 插件提供；插件装在 ~/.dsh/profiles/web/ 后必须
// **重启 harness** 才会被 cordis 加载器组合上（plugin add 只写文件不触发 reload）。
// marketStatusOk 返回 false 时先探测 dshmarket 实际安装位置，已装但未加载 → 提示用户重启。
async function marketStatusOk() {
  try {
    const r = await marketFetchJSON('/dsh-market/status');
    // dshmarket 未加载时，harness 把这个路径 fallback 到 SPA index.html（HTML 字符串），
    // r.ok=true 但 r.data 是 HTML 文本，没 version 字段 → 视为未加载
    if (!r.ok || r.status !== 200) return { ok: false, reason: 'http' };
    const d = r.data;
    if (typeof d !== 'object' || !d || (!d.version && !d.name)) {
      return { ok: false, reason: 'not-loaded', hint: 'dshmarket 插件未加载到 harness（路由返回 HTML），需要重启应用让 harness 重新组合插件' };
    }
    return { ok: true, data: d };
  } catch (e) {
    return { ok: false, reason: 'error', hint: e.message };
  }
}
// 探测 dshmarket 在 harness web profile 里实际安装状态（manifest/package.json 存在但未加载 = 已装但需重启）
function marketInstalledOnDisk() {
  try {
    // harness web profile 把 cordis 插件装到 ~/.dsh/profiles/web/node_modules/<pkg>/
    const homes = [
      process.env.DSH_HOME,
      path.join(os.homedir(), '.dsh'),
    ].filter(Boolean);
    for (const home of homes) {
      const candidates = [
        path.join(home, 'profiles', 'web', 'node_modules', 'dshmarket', 'package.json'),
        path.join(home, 'profiles', 'web', 'cordis', 'dshmarket', 'package.json'),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          try { return { path: p, pkg: JSON.parse(fs.readFileSync(p, 'utf8')) }; } catch { /* ignore */ }
        }
      }
    }
  } catch { /* ignore */ }
  return null;
}
// 探测内置 dshmarket tarball（manifest.json + tarball），返回 {source: 'local'|'remote', tgzPath, version} 或 null
function findLocalMarketBundle() {
  try {
    const marketDir = path.join(LAYOUT_ROOT, 'app', 'extras', 'dsh-market-bundle');
    const mfstPath = path.join(marketDir, 'manifest.json');
    if (!fs.existsSync(mfstPath)) return null;
    const m = JSON.parse(fs.readFileSync(mfstPath, 'utf8'));
    if (!m || !m.tarball || !m.sha256) return null;
    const tgz = path.join(marketDir, m.tarball);
    if (!fs.existsSync(tgz)) return null;
    return { marketDir, mfstPath, tgzPath: tgz, version: m.version || 'unknown', sha256: m.sha256 };
  } catch { return null; }
}
function sha256File(p) {
  try {
    const buf = fs.readFileSync(p);
    return require('node:crypto').createHash('sha256').update(buf).digest('hex').toLowerCase();
  } catch { return ''; }
}
// dsh plugin add 会在 profile 目录里裸调 pnpm（安装/链接插件依赖）。捆绑 node 目录若不在
// PATH 上（也没有 pnpm shim），pnpm 解析失败 → 'pnpm 不是内部或外部命令' → 市场永远装不上。
// 这里补齐：① 确保 node 目录里有 pnpm.cmd shim（转发 corepack，同 setup.ps1 的做法）；
//          ② spawn 环境把该目录前置到 PATH，并关掉 corepack 首次下载的交互确认（非交互场景会卡死）。
function marketInstallEnv(nodeExe) {
  const nodeDir = path.dirname(nodeExe);
  try {
    const shim = path.join(nodeDir, 'pnpm.cmd');
    if (!fs.existsSync(shim) && fs.existsSync(path.join(nodeDir, 'corepack.cmd'))) {
      fs.writeFileSync(shim, '@echo off\r\n"%~dp0corepack.cmd" pnpm %*\r\n', 'utf8');
    }
  } catch { /* 只读目录等场景忽略：PATH 上若已有 pnpm 则不受影响 */ }
  const env = { ...process.env };
  env.PATH = nodeDir + path.delimiter + (env.PATH || '');
  env.COREPACK_ENABLE_DOWNLOAD_PROMPT = '0';
  return env;
}

ipcMain.handle('market:ensure', async () => {
  const st = await marketStatusOk();
  if (st.ok) {
    const local = findLocalMarketBundle();
    return { ok: true, status: 'ready', source: local ? 'local' : 'remote', version: local?.version, loaded: true };
  }
  // dshmarket 已装但未加载（典型：安装时/刚装完/应用启动后）→ 提示重启而非重新装
  const installed = marketInstalledOnDisk();
  if (installed) {
    return {
      ok: false,
      status: 'installed-not-loaded',
      loaded: false,
      installedVersion: installed.pkg?.version,
      installedPath: installed.path,
      hint: `dshmarket v${installed.pkg?.version || '?'} 已装到 ${installed.path}，但 harness 还未加载。请退出应用后重新打开（harness 重启会自动组合插件）。`,
      needsRestart: true,
    };
  }
  const nodeExe = resolveNodeExe();
  const harness = discoverHarness();
  const cli = harness && harness.dir ? path.join(harness.dir, 'apps', 'cli', 'lib', 'bin.js') : null;
  if (!cli || !fs.existsSync(cli)) {
    return { ok: false, status: 'no-harness', error: '未定位到 harness 引擎，无法安装市场插件' };
  }
  // 优先路径：本地内置 tarball
  const local = findLocalMarketBundle();
  let source = 'remote';
  let installArgs = [cli, 'plugin', '--profile', 'web', 'add', 'dshmarket'];
  let tgzForLog = 'dshmarket (远程 npm)';
  if (local) {
    const actualSha = sha256File(local.tgzPath);
    if (actualSha && actualSha === local.sha256.toLowerCase()) {
      source = 'local';
      installArgs = [cli, 'plugin', '--profile', 'web', 'add', local.tgzPath];
      tgzForLog = `dshmarket v${local.version} (本地内置, SHA256 已校验)`;
    } else {
      pushLog('stderr', `[市场] 本地 tarball SHA256 校验失败（期望 ${local.sha256} vs 实际 ${actualSha}），走远程 npm`);
    }
  }
  pushLog('stdout', `[市场] 未检测到 dshmarket 插件，自动安装：${tgzForLog}`);
  const p = spawn(nodeExe, installArgs, { cwd: harness.dir, windowsHide: true, env: marketInstallEnv(nodeExe) });
  p.stdout.on('data', (d) => pushLog('stdout', d.toString()));
  p.stderr.on('data', (d) => pushLog('stderr', d.toString()));
  return new Promise((resolve) => {
    p.on('error', (err) => resolve({ ok: false, status: 'install-error', error: err.message, source }));
    p.on('close', async (code) => {
      const ready = await marketStatusOk();
      // 装完返回 ready 状态 + needsRestart 让用户知道要重启应用
      resolve({
        ok: ready.ok,
        status: ready.ok ? 'ready' : `install-finished-${code}`,
        code,
        source,
        version: local?.version,
        loaded: ready.ok,
        needsRestart: !ready.ok,
        hint: ready.ok ? null : `dshmarket 已装到 ${code === 0 ? 'web profile' : '但子进程退出 ' + code}，请重启应用让 harness 加载。`,
      });
    });
  });
});
ipcMain.handle('market:check', async () => {
  const st = await marketStatusOk();
  const local = findLocalMarketBundle();
  const installed = marketInstalledOnDisk();
  return {
    ok: true,
    ready: st.ok,
    loaded: st.ok,
    source: local ? 'local' : 'remote',
    version: local?.version || installed?.pkg?.version || null,
    installed: !!installed,
    installedVersion: installed?.pkg?.version,
    reason: st.reason,
    hint: st.hint || (installed && !st.ok ? `已装 v${installed.pkg?.version}，请重启应用加载` : null),
  };
});

ipcMain.handle('app:relaunch', async () => {
  app.relaunch();
  app.exit(0);
  return { ok: true };
});

// ---------- 更新安装：下载完成后运行Setup.exe 安装到同一安装根目录，随后重启 ----------
// 需求#6：一键更新要像正常软件更新一样——
//   * 下载包存到「安装根目录\updates」（不落账户/临时路径）；
//   * 安装目标 = 当前应用安装根目录（LAYOUT_ROOT），直接覆盖旧版，不另建新文件夹；
//   * Inno 安装器会重建桌面快捷方式（指向新版 exe）；
//   * 安装完成后由 setup.ps1 自动启动新版 DSH（自动重启进新版）。
let updaterInstalling = false;
ipcMain.handle('updater:install', async (_e, exePath) => {
  if (!exePath) return { ok: false, error: '缺少安装包路径' };
  if (!fs.existsSync(exePath)) return { ok: false, error: `安装包不存在: ${exePath}` };
  // 起安装器之前先确认这真是 Windows 可执行文件。
  // 旧实现是"spawn 完 1.2 秒就 app.exit(0)"，**不检查 spawn 结果** ——
  // 一旦下载到的是个坏文件（镜像回错误页、被杀软截断），spawn 会失败，
  // 但应用照样退出 → 用户眼前一黑，应用再也起不来。这个代价太大，必须先验。
  if (/\.exe$/i.test(exePath) && !isPeFile(exePath)) {
    return { ok: false, error: '这个文件不是可执行的安装包（可能下载被中断或镜像返回了错误页），请点「一键更新」重新下载' };
  }
  const size = (() => { try { return fs.statSync(exePath).size; } catch { return 0; } })();
  if (size < 1024) return { ok: false, error: `安装包体积异常（${size} 字节），请重新下载` };
  try {
    updaterInstalling = true;
    const isInno = /\.exe$/i.test(exePath);
    // Inno Setup 安装器：以静默/极静默方式直接覆盖安装到 LAYOUT_ROOT，/DIR 指定安装根目录。
    // windowsVerbatimArguments 保证 /DIR="..." 命令段原样传给安装器（不被 Node 二次转义），
    // 路径含空格也可正确解析。
    const args = [];
    if (isInno) args.push('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', `/DIR="${LAYOUT_ROOT}"`);
    const child = spawn(exePath, args, { detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: true });
    // 等它真的被系统接受（'spawn' 事件）再决定退出。spawn 只保证进程创建动作完成，
    // 文件不可执行/被拦时是**异步**报 'error'，所以这里必须等一个 tick 而不是直接 unref 走人。
    const started = await new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      child.once('spawn', () => finish({ ok: true }));
      child.once('error', (err) => finish({ ok: false, error: (err && err.message) || String(err) }));
      setTimeout(() => finish({ ok: true }), 3000); // 兜底：没报错就认为起来了
    });
    if (!started.ok) {
      updaterInstalling = false;
      pushLog('stderr', `[更新] 启动安装器失败：${started.error}`);
      return { ok: false, error: `无法启动安装包：${started.error}（安装包已保存在 ${exePath}，可手动运行）` };
    }
    child.unref();
    pushLog('stdout', `[更新] 已启动安装器: ${exePath}${args.length ? ' （静默安装到 ' + LAYOUT_ROOT + '）' : ''}`);
    // 等 1.2s 让安装器接管后再退出本进程（避免过早关窗导致安装器未被接受）
    setTimeout(() => {
      if (harnessProc) { try { harnessProc.kill(); } catch { /* ignore */ } }
      app.exit(0);
    }, 1200);
    return { ok: true };
  } catch (err) {
    updaterInstalling = false;
    return { ok: false, error: err.message };
  }
});

// ---------- 软件更新（检查 sayzwx/DSH-desktop 的 GitHub Releases） ----------
const APP_VERSION = (() => {
  try { return require('./package.json').version; } catch { return '0.0.0'; }
})();

function sendUpdaterProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updater:progress', payload);
}
function sendUpdaterResult(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updater:result', payload);
}
function parseSemver(text) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(text || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function isNewerVersion(candidate, current) {
  const A = parseSemver(candidate);
  const B = parseSemver(current);
  if (!A || !B) return false;
  for (let i = 0; i < 3; i += 1) {
    if (A[i] !== B[i]) return A[i] > B[i];
  }
  return false;
}
async function loadGhToken() {
  try {
    const f = path.join(DSH_HOME, '.github-token');
    if (fs.existsSync(f)) {
      const t = fs.readFileSync(f, 'utf8').trim();
      // 只接受 GitHub 个人访问令牌格式（ghp_ / github_pat_ / gho_ / ghs_），旧式或损坏内容一律忽略
      if (/^(ghp_|github_pat_|gho_|ghs_|ghu_)/.test(t)) return t;
      pushLog('stderr', `[忽略无效的 ~/.dsh/.github-token（格式不符，已清空）]`);
      try { fs.rmSync(f, { force: true }); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return null;
}
function clearGhToken() {
  try { fs.rmSync(path.join(DSH_HOME, '.github-token'), { force: true }); } catch { /* ignore */ }
}

// 国内加速镜像（实测可达）：把 github.com/releases/download 的官方直链映射为镜像候选
const GH_MIRRORS = [
  'https://ghfast.top/',
  'https://ghproxy.net/',
  'https://gh-proxy.com/',
  'https://gh.ddlc.top/',
];
/**
 * 返回下载候选列表：先列出加速镜像 URL，最后是 GitHub 官方直链。
 * 仅在 url 来自 api.github.com 返回的 releases 下载地址（github.com 的 releases/download 路径）
 * 时启用镜像；其它来源（如自定义 URL）原样单候选。
 */
function mirrorOf(url, extra) {
  const isGhRelease = /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\//.test(url);
  if (!isGhRelease) {
    return Array.from(new Set([url, ...(extra && extra.github ? [extra.github] : [])])).filter(Boolean);
  }
  const list = [];
  for (const m of GH_MIRRORS) list.push(`${m}${url}`);
  list.push(url);
  return Array.from(new Set(list)).filter(Boolean);
}

async function checkGitHubRelease(useToken) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10000);
  const headers = { 'User-Agent': 'dsh-desktop', Accept: 'application/vnd.github+json' };
  if (useToken) {
    const token = await loadGhToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await net.fetch('https://api.github.com/repos/sayzwx/DSH-desktop/releases/latest', { headers, signal: ac.signal });
  clearTimeout(timer);
  return res;
}

ipcMain.handle('updater:check', async () => {
  const current = APP_VERSION;
  try {
    let res = await checkGitHubRelease(true);
    // token 失效（401）或权限问题（403）：清除失效 token 后匿名重试，避免每次都报错
    if (res.status === 401 || res.status === 403) {
      pushLog('stderr', `[GitHub API ${res.status}：本地 token 失效/无权限，已清除并改用匿名检查]`);
      clearGhToken();
      res = await checkGitHubRelease(false);
    }
    if (!res.ok) {
      return {
        ok: false,
        error: res.status === 404 ? '仓库还没有发布版本（GitHub Releases 尚无 latest）' : `GitHub API ${res.status}（可能触发匿名限流，稍后再试）`,
      };
    }
    const data = await res.json();
    const latest = String(data.tag_name || data.name || '').replace(/^v/, '');
    const hasUpdate = isNewerVersion(latest, current);
    return {
      ok: true,
      current,
      latest,
      tag: data.tag_name || '',
      name: data.name || '',
      hasUpdate,
      assets: (data.assets || [])
        .filter((a) => a.browser_download_url)
        .map((a) => {
          const url = a.browser_download_url;
          return { name: a.name, url, size: a.size || 0, mirrors: mirrorOf(url) };
        }),
    };
  } catch (err) {
    return { ok: false, error: `网络错误: ${err.message}` };
  }
});

ipcMain.handle('updater:download', async (_e, url) => {
  if (!url) return { ok: false, error: '缺少下载地址' };
  let name = 'update';
  try { name = path.basename(new URL(url).pathname) || name; } catch { /* ignore */ }
  const isExe = /\.exe$/i.test(name);

  // 下载到「应用安装根目录\updates」（需求#6）：不落在临时/账户路径，更新包随应用目录存放，
  // 安装时直接覆盖安装到同一安装根目录，绝不“下到账户路径另装一个新文件夹”。
  //
  // 但安装根**不一定可写** —— Inno 装出来的常见落点是 C://Program Files\XXX，那里要管理员
  // 权限才写得进。旧实现这里有个静默 bug：兜底目录建出来了，`target` 却仍指向创建失败的
  // 那个目录（注释写着「回退系统临时目录」，代码没回退）→ 每次写盘都失败。所以目录必须
  // 先定下来、再据此拼路径，两者不能分开算。
  const primaryDir = path.join(LAYOUT_ROOT, 'updates');
  const fallbackDir = path.join(os.tmpdir(), 'DSH-update');
  let dir;
  try {
    dir = pickWritableDir(primaryDir, fallbackDir);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  const target = path.join(dir, name === 'update' ? 'DSH-update-setup.exe' : name);
  if (dir !== primaryDir) {
    pushLog('stderr', `[下载] 安装目录不可写（${primaryDir}），改用 ${dir}`);
  }

  // 下载候选序列：加速镜像优先，最后回源 GitHub（国内环境经镜像明显更快）。
  // 真正的下载逻辑在 lib/download.js —— 停滞超时 / 长度校验 / PE 校验 / 断点续传
  // 都在那里，并有 scripts/update-download-test.cjs 逐条复现验证。
  const candidates = mirrorOf(url, { github: url });
  const r = await downloadToFile({
    candidates,
    target,
    fetchImpl: (u, o) => net.fetch(u, o),
    requirePe: isExe,
    onProgress: (p) => sendUpdaterProgress({ ...p, name }),
    log: pushLog,
  });

  if (!r.ok) {
    sendUpdaterResult({ ok: false, error: r.error, attempts: r.attempts });
    return { ok: false, error: r.error, attempts: r.attempts };
  }
  // 完成后：若为 Setup.exe 则自动触发安装并重启（正常软件更新体验），否则打开所在目录
  pushLog('stdout', `[下载] ${name} 就绪（${(r.bytes / 1048576).toFixed(1)} MB，${r.via}）`);
  if (isExe) {
    sendUpdaterResult({ ok: true, path: target, name, via: r.via, bytes: r.bytes, autoInstall: true });
    return { ok: true, path: target, name, via: r.via, bytes: r.bytes, autoInstall: true };
  }
  try { shell.openPath(target); } catch { /* ignore */ }
  sendUpdaterResult({ ok: true, path: target, name, via: r.via, bytes: r.bytes });
  return { ok: true, path: target, name, via: r.via, bytes: r.bytes };
});

/** 把渲染层动作转发过去；主进程不操作 DOM。 */
function sendMenu(action, extra) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:menu', { action, ...(extra || {}) });
  }
}

/**
 * 应用菜单与快捷键。
 * 编辑菜单全部用 role：缺了它，部分焦点场景下的复制/粘贴只能依赖 Chromium 默认行为，
 * 表现随平台漂移。F5 绑"重启 Harness"而不是刷新页面，刷新用 Ctrl+Shift+R，
 * 菜单文案写清楚以免用户按 F5 期望刷新时困惑。
 */
function buildApplicationMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '新会话', accelerator: 'CmdOrCtrl+N', click: () => sendMenu('newSession') },
        { label: '隐藏到托盘', accelerator: 'CmdOrCtrl+W', click: () => sendMenu('hideToTray') },
        { type: 'separator' },
        { label: '停止 Harness 并退出', click: () => sendMenu('quitWithService') },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '仪表盘', accelerator: 'CmdOrCtrl+1', click: () => sendMenu('navigate', { page: 'dashboard' }) },
        { label: '对话', accelerator: 'CmdOrCtrl+2', click: () => sendMenu('navigate', { page: 'chat' }) },
        { label: '实时日志', accelerator: 'CmdOrCtrl+3', click: () => sendMenu('navigate', { page: 'logs' }) },
        { label: '结果查看', accelerator: 'CmdOrCtrl+4', click: () => sendMenu('navigate', { page: 'results' }) },
        { label: '设置与主题', accelerator: 'CmdOrCtrl+,', click: () => sendMenu('navigate', { page: 'settings' }) },
        { label: '插件市场', accelerator: 'CmdOrCtrl+5', click: () => sendMenu('navigate', { page: 'market' }) },
        { type: 'separator' },
        { role: 'reload', label: '重新加载页面', accelerator: 'CmdOrCtrl+Shift+R' },
        { role: 'toggleDevTools', label: '开发者工具', accelerator: 'CmdOrCtrl+Shift+I' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
      ],
    },
    {
      label: '会话',
      submenu: [
        { label: '搜索会话内容', accelerator: 'CmdOrCtrl+K', click: () => sendMenu('focusSearch') },
      ],
    },
    {
      label: '引擎',
      submenu: [
        { label: '启动 Harness', click: () => sendMenu('startHarness') },
        { label: '重启 Harness（不是刷新页面）', accelerator: 'F5', click: () => sendMenu('restartHarness') },
        { label: '停止 Harness', click: () => sendMenu('stopHarness') },
        { type: 'separator' },
        { label: '打开 Web UI (:3080)', click: () => sendMenu('openWeb') },
      ],
    },
    { role: 'windowMenu', label: '窗口' },
    {
      role: 'help',
      label: '帮助',
      submenu: [
        { label: 'DSH Desktop 仓库', click: () => shell.openExternal('https://github.com/sayzwx/DSH-desktop') },
        { label: 'DeepSeek Harness 仓库', click: () => shell.openExternal('https://github.com/deepseek-ai/DeepSeek-Harness') },
        { type: 'separator' },
        {
          label: '关于 DSH Desktop',
          click: () => sendMenu('about', { version: app.getVersion(), engine: HARNESS_DIR || '' }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// 应用启动即自动拉起 Harness（2026-09-29 用户要求：启动应用端就自动启动，不要每次手动点）。
// startHarness 本身幂等：:3080 已有实例就接管（adopted）；本机没有引擎走自动获取（installing）；
// 全程只写日志、不弹窗不打扰，失败时用户仍可手动点「启动 Harness」重试。
function autoStartHarness() {
  // 测试/自动化可显式关闭：scripts/smoke-renderer.cjs 等以开发实例启动，
  // 端口空闲时不希望「启动流程」顺带触发引擎自动安装（那会让测试变成装机）。
  if (process.env.DSH_NO_AUTOSTART === '1') {
    pushLog('stdout', '[应用启动：DSH_NO_AUTOSTART=1，跳过自动启动]');
    return;
  }
  startHarness()
    .then((r) => {
      if (r && r.ok) {
        pushLog('stdout', r.adopted
          ? '[应用启动：检测到 :3080 已有服务在运行，已接管（无需启动）]'
          : r.installing
            ? '[应用启动：未检测到本机引擎，已开始自动获取…]'
            : '[应用启动：已自动启动 Harness]');
      } else {
        pushLog('stderr', `[应用启动：自动启动未执行：${(r && r.error) || 'unknown'}]`);
      }
    })
    .catch((e) => pushLog('stderr', `[应用启动：自动启动失败：${e && e.message ? e.message : e}]`));
}

app.whenReady().then(() => {
  buildApplicationMenu();
  createWindow();
  createTray();
  ensureShortcut();
  autoStartHarness();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showMainWindow();
  });
});

// 关闭全部窗口：不退出应用、不杀 harness（后台驻留，托盘可唤回）。
// 只有用户主动退出（isQuitting，来自托盘/设置「停止并退出」或更新安装）才真正结束。
app.on('window-all-closed', () => {
  if (!isQuitting) {
    // 保持进程存活，harness 服务继续运行
    return;
  }
  if (harnessProc) { try { stopHarness(); } catch { /* ignore */ } }
  app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
});

// IPC：窗口列表 / 用户主动退出（停止 Harness） / 隐藏到托盘 / 唤回主窗口
ipcMain.handle('windows:list', () => ({
  ok: true,
  windows: [...trackedWindows.entries()].map(([win, rec]) => ({
    id: rec.id, label: rec.label, kind: rec.kind, title: rec.title || '', visible: !!(win && !win.isDestroyed() && win.isVisible()),
  })),
}));
ipcMain.handle('notify:getPrefs', () => ({ ok: true, ...readNotifyPrefs() }));
ipcMain.handle('notify:setPrefs', (_e, patch) => {
  const next = { ...readNotifyPrefs(), ...(patch || {}) };
  const ok = writeNotifyPrefs(next);
  return { ok, ...next };
});
// 渲染层在 turn/end 时调用：它知道会话标题，主进程知道窗口可见性
ipcMain.handle('notify:turnEnd', (_e, title) => ({ ok: true, notified: notifyTurnEnd(title) }));

// ---------- 轨道 G：引擎诊断 / 备份 / 会话导出 ----------
// 诊断快照：把主进程已知的运行时事实收敛成结构化数据，供设置页「引擎诊断」模块展示。
// 引擎侧的 host.describe（version/cwd/home/attachedSessions/canOpenPath）由渲染层另调 hostDescribe。
ipcMain.handle('diagnostics:get', () => ({
  ok: true,
  appVersion: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  electron: process.versions.electron,
  node: process.versions.node,
  chrome: process.versions.chrome,
  port: PORT,
  dshHome: DSH_HOME,
  harnessDir: HARNESS_DIR || '',
  nodeExe: (() => { try { return resolveNodeExe(); } catch { return ''; } })(),
  state: harnessState,
  devInstance: process.env.DSH_DEV_INSTANCE || '',
}));

// 备份 ~/.dsh 到同级时间戳目录（升级 / 回滚前的安全网）：纯复制，绝不动原目录。
ipcMain.handle('diagnostics:backupDsh', async () => {
  try {
    if (!fs.existsSync(DSH_HOME)) return { ok: false, error: '找不到 ~/.dsh 目录' };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = `${DSH_HOME}.backup-${stamp}`;
    await fs.promises.cp(DSH_HOME, dest, { recursive: true });
    return { ok: true, path: dest };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

// 会话导出：渲染层把整段会话拼成 Markdown 交来，主进程只管选路径与落盘（不经过引擎）。
ipcMain.handle('chat:exportMarkdown', async (_e, { defaultName, markdown }) => {
  const win = BrowserWindow.getFocusedWindow()
    || (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
  const opts = {
    title: '导出会话为 Markdown',
    buttonLabel: '导出',
    defaultPath: defaultName || 'session.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  };
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (res.canceled || !res.filePath) return { ok: true, cancelled: true };
  try {
    await fs.promises.writeFile(res.filePath, String(markdown || ''), 'utf8');
    return { ok: true, path: res.filePath };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

// 设置页「引擎诊断」里的 DevTools 按钮：与菜单项 / 快捷键同一入口，聚焦窗口优先
ipcMain.handle('app:openDevTools', () => {
  const win = BrowserWindow.getFocusedWindow()
    || (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
  if (win) win.webContents.openDevTools({ mode: 'detach' });
  return { ok: !!win };
});

ipcMain.handle('app:hideToTray', () => {
  winWasVisible = true;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  return { ok: true };
});
ipcMain.handle('app:showWindow', () => { showMainWindow(); return { ok: true }; });
ipcMain.handle('app:quitWithService', () => {
  isQuitting = true;
  try { if (harnessProc || harnessState === 'running') stopHarness(); } catch { /* ignore */ }
  app.quit();
  return { ok: true };
});
ipcMain.handle('app:quitBackgroundOnly', () => {
  // 退出应用但保留后台 harness 服务继续运行（下次启动自动接管 :3080）
  isQuitting = true;
  app.quit();
  return { ok: true };
});
