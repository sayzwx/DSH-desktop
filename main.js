const { app, BrowserWindow, ipcMain, shell, dialog, net } = require('electron');
const { spawn, spawnSync, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// 分发安装布局：app（含 DSH.exe）与 harness、tools/node 同级（%LOCALAPPDATA%\DSH\{app,harness,tools}）。
// harness 引擎不再写死某个路径：点击启动时自动探测本机已有安装（可用 DSH_HARNESS_DIR 显式指定源码目录），
// 探测不到就自动安装官方发行包/运行 installer/setup.ps1 -EngineOnly 拉取官方引擎。
const DSH_ROOT = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'DSH') : '';
const DSH_HOME = path.join(os.homedir(), '.dsh');
const PORT = 3080;
const LOG_LIMIT = 5000;

// 解析 Node 可执行文件：显式 DSH_NODE_EXE → 安装布局 tools\node → 与 app 同级 tools\node → PATH 上的 node
function resolveNodeExe() {
  const cands = [
    process.env.DSH_NODE_EXE || '',
    DSH_ROOT ? path.join(DSH_ROOT, 'tools', 'node', 'node.exe') : '',
    path.join(__dirname, '..', 'tools', 'node', 'node.exe'),
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
const logBuffer = [];

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
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('harness:state', state);
  }
}

// ---------- Harness 引擎发现：不再写死路径，按优先级探测本机已有安装 ----------
// 支持两种形态：
//   1) 源码目录：apps/cli/lib/bin.js（安装器布局 %LOCALAPPDATA%\DSH\harness 或环境变量 DSH_HARNESS_DIR 指定）
//   2) 发行包：@deepseek-ai/dsh/lib/bin.js（npm 全局安装或 npx 缓存里的官方发行版）
// npm 在 Windows 上只有 npm.cmd，spawn 无法直接执行，统一经 cmd.exe 包一层
function npmSpawnSync(args, opts = {}) {
  const win = process.platform === 'win32';
  const cmd = win ? 'cmd.exe' : 'npm';
  const params = win ? ['/c', 'npm', ...args] : args;
  return spawnSync(cmd, params, { windowsHide: true, encoding: 'utf8', ...opts });
}
function npmSpawn(args, opts = {}) {
  const win = process.platform === 'win32';
  const cmd = win ? 'cmd.exe' : 'npm';
  const params = win ? ['/c', 'npm', ...args] : args;
  return spawn(cmd, params, { windowsHide: true, ...opts });
}
function discoverHarness() {
  const candidates = [];
  const push = (p) => { if (typeof p === 'string' && p && !candidates.includes(p)) candidates.push(p); };
  // 1) 显式环境变量（用户/管理员指定，优先级最高）
  push(process.env.DSH_HARNESS_DIR);
  // 2) 安装器布局 %LOCALAPPDATA%\DSH\harness
  if (DSH_ROOT) push(path.join(DSH_ROOT, 'harness'));
  // 3) 与 app 同级的 harness（打包/便携布局）
  push(path.join(__dirname, '..', 'harness'));
  // 4) npm 全局安装的官方发行包
  try {
    const g = npmSpawnSync(['root', '-g']);
    const line = (g.stdout || '').split(/\r?\n/).find((l) => l.trim());
    if (line) push(path.join(line.trim(), '@deepseek-ai', 'dsh'));
  } catch { /* npm 不可用/未安装 */ }
  // 5) npx 缓存目录（npm-cache\_npx\* 与 ~/.npm/_npx/*）
  for (const base of [
    path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx'),
    path.join(os.homedir(), '.npm', '_npx'),
  ]) {
    try {
      if (!fs.existsSync(base)) continue;
      for (const sub of fs.readdirSync(base)) {
        push(path.join(base, sub, 'node_modules', '@deepseek-ai', 'dsh'));
      }
    } catch { /* 忽略不可读缓存 */ }
  }
  for (const dir of candidates) {
    const srcBin = path.join(dir, 'apps', 'cli', 'lib', 'bin.js');   // 源码形态
    if (fs.existsSync(srcBin)) return { dir, bin: srcBin, kind: 'source' };
    const distBin = path.join(dir, 'lib', 'bin.js');                  // 发行包形态
    if (fs.existsSync(distBin)) return { dir, bin: distBin, kind: 'dist' };
  }
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

function launchHarness(found) {
  HARNESS_DIR = found.dir;
  setState('starting');
  startDeadline = Date.now() + 90 * 1000;
  // 构建子进程环境：父进程环境 + ~/.dsh/.env。但由 .env 托管的密钥（DEEPSEEK_API_KEY）
  // 不注入启动环境——否则 harness 的 credentials-local 视其为「启动环境只读」（source:'env',
  // writable:false），credentials.set/setApiKey 的实时同步会被拒（"supplied read-only by the
  // launching environment"）。harness 会自己读 ~/.dsh/.env 与 ~/.dsh/.credentials.yaml，
  // 路由不受影响，且凭据服务恢复可写。
  const harnessEnv = loadDotEnv();
  const env = { ...process.env, ...harnessEnv, DSH_HOME };
  if (harnessEnv.DEEPSEEK_API_KEY) delete env.DEEPSEEK_API_KEY;
  const nodeExe = resolveNodeExe();
  harnessProc = spawn(nodeExe, [found.bin, 'web'], {
    cwd: found.dir,
    env,
    windowsHide: true,
  });
  pushLog('stdout', `[启动 harness: ${nodeExe} ${found.bin} web (${found.kind})]`);
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
    harnessProc = null;
    startDeadline = 0;
    setState('stopped');
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
    const res = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Report'], { windowsHide: true, encoding: 'utf8', timeout: 60000 });
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
  const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Fix', '-NodeMinMajor', '22'], { windowsHide: true, env: { ...process.env } });
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
      else { pushLog('stderr', '[安装完成但未找到引擎，请查看上方日志]'); setState('stopped'); }
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
      setState('stopped');
      return;
    }
    pushLog('stdout', `[运行引擎安装: ${script} -EngineOnly（下载官方源码+Node，多镜像自动重试，首次需数分钟）]`);
    const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-EngineOnly'], { windowsHide: true, env: { ...process.env } });
    p.stdout.on('data', (d) => pushLog('stdout', d.toString()));
    p.stderr.on('data', (d) => pushLog('stderr', d.toString()));
    p.on('error', (err) => { pushLog('stderr', `[脚本启动失败] ${err.message}`); setState('stopped'); });
    p.on('close', (code) => {
      if (code !== 0) { pushLog('stderr', `[引擎安装失败 code=${code}，请检查网络后重试]`); setState('stopped'); return; }
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
      setState('stopped');
      return;
    }
    if (report.issues && report.issues.length) {
      for (const i of report.issues) pushLog('stdout', `[预检] ${i}`);
    }
    // 2) Node 不合格 → 先修复，修复后再复查一次
    if (!report.nodeOk) {
      fixNodeEnv((ok) => {
        if (!ok) { pushLog('stderr', '[Node.js 安装失败，请检查网络/winget 后重试]'); setState('stopped'); return; }
        const re = readEnvReport();
        if (re && !re.nodeOk) { pushLog('stderr', '[Node.js 修复后仍不满足要求，请手动安装 Node.js >= 22]'); setState('stopped'); return; }
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

async function rpcCall(method, payload) {
  const rpcId = `rpc-${++chatRpcCounter}`;
  const res = await fetch(`http://127.0.0.1:${PORT}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload: payload || {} }),
    signal: AbortSignal.timeout(12000),
  });
  const body = await res.json();
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
  const res = await fetch(`http://127.0.0.1:${PORT}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json();
  if (!body || body.type !== 'server-response') {
    return { ok: false, error: { message: `bad envelope: HTTP ${res.status}` } };
  }
  if (!body.result || !body.result.ok) {
    return { ok: false, error: body.result?.error || { message: 'unknown rpc error' } };
  }
  return { ok: true, value: body.result.value };
}

function openStream(kind) {
  if (harnessState !== 'running') return;
  const existing = kind === 'mux' ? chatWs : chatWsHost;
  if (existing && existing.readyState === 1) return; // OPEN
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
  if (kind === 'mux') chatWs = socket;
  else chatWsHost = socket;
  chatStreams.add(socket);
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
    try { socket.close(); } catch { /* ignore */ }
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
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => (mainWindow = null));
}

ipcMain.handle('harness:start', () => startHarness());
ipcMain.handle('harness:stop', () => stopHarness());
ipcMain.handle('harness:status', async () => {
  const webUp = await checkWebUp();
  if (webUp) {
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
  return { ok: true, connected: !!chatWs || !!chatWsHost };
});
ipcMain.handle('chat:disconnect', () => {
  closeChatStreams();
  return { ok: true };
});
ipcMain.handle('chat:list', async () => {
  const r = await rpcCall('session.list', {});
  if (!r.ok) return { ok: false, error: r.error?.message || 'session.list failed' };
  const items = (r.value?.items || []).map((it) => ({
    sessionId: it.sessionId,
    title: it.projections?.values?.title || '新会话',
    running: !!it.running,
    blank: !!it.blank,
    updatedAt: it.updatedAt,
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
  return { ok: true, items: r.value?.items || [], archivedSessionIds: r.value?.archivedSessionIds || [] };
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
ipcMain.handle('chat:permissionSet', async (_e, { sessionId, preset }) => {
  const r = await rpcCallTypert('commands/execute', { agentId: sessionId, line: `/permission ${preset}` });
  if (!r.ok) return { ok: false, error: r.error?.message || 'commands/execute failed' };
  return { ok: true, command: r.value?.result || null };
});

// 通用斜杠命令执行：支持 /compact 等任意 harness 命令
ipcMain.handle('chat:commandsExecute', async (_e, { sessionId, line }) => {
  const r = await rpcCallTypert('commands/execute', { agentId: sessionId, line });
  if (!r.ok) return { ok: false, error: r.error?.message || 'commands/execute failed' };
  return { ok: true, command: r.value?.result || null };
});

// 获取可用命令列表（用于命令面板自动补全）
ipcMain.handle('chat:commandsList', async (_e, { sessionId }) => {
  const r = await rpcCallTypert('commands/list', { agentId: sessionId });
  if (!r.ok) return { ok: false, error: r.error?.message || 'commands/list failed' };
  return { ok: true, commands: r.value || [] };
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
ipcMain.handle('llm:discoverModels', async (_e, { settingsNs, provider, apiKey }) => {
  const payload = { settingsNs, provider };
  if (typeof apiKey === 'string' && apiKey.length > 0) payload.apiKey = apiKey;
  const r = await rpcCall('llm.discoverModels', payload);
  if (!r.ok) return { ok: false, error: r.error?.message || 'llm.discoverModels failed' };
  return { ok: true, models: r.value?.models || [] };
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
// 幂等：已就绪直接返回；未就绪则跑 `node <harness>/apps/cli/lib/bin.js plugin --profile web add dshmarket`，
// 完成后提示重启让引擎重新组合。
async function marketStatusOk() {
  try {
    const r = await marketFetchJSON('/dsh-market/status');
    return r.ok && r.status === 200;
  } catch { return false; }
}
ipcMain.handle('market:ensure', async () => {
  if (await marketStatusOk()) return { ok: true, status: 'ready' };
  const nodeExe = resolveNodeExe();
  const harness = discoverHarness();
  const cli = harness && harness.dir ? path.join(harness.dir, 'apps', 'cli', 'lib', 'bin.js') : null;
  if (!cli || !fs.existsSync(cli)) {
    return { ok: false, status: 'no-harness', error: '未定位到 harness 引擎，无法安装市场插件' };
  }
  pushLog('stdout', '[市场] 未检测到 dshmarket 插件，自动安装…');
  const p = spawn(nodeExe, [cli, 'plugin', '--profile', 'web', 'add', 'dshmarket'], { cwd: harness.dir, windowsHide: true, env: { ...process.env } });
  p.stdout.on('data', (d) => pushLog('stdout', d.toString()));
  p.stderr.on('data', (d) => pushLog('stderr', d.toString()));
  return new Promise((resolve) => {
    p.on('error', (err) => resolve({ ok: false, status: 'install-error', error: err.message }));
    p.on('close', async (code) => {
      const ready = await marketStatusOk();
      resolve({ ok: ready, status: ready ? 'ready' : `install-finished-${code}`, code, needsRestart: !ready });
    });
  });
});
ipcMain.handle('market:check', async () => ({ ok: true, ready: await marketStatusOk() }));

ipcMain.handle('app:relaunch', async () => {
  app.relaunch();
  app.exit(0);
  return { ok: true };
});

// ---------- 更新安装：下载完成后运行 Setup.exe 自解压安装，随后重启 ----------
// Setup.exe 为 7-Zip SFX：自解压到 %LOCALAPPDATA%\DSH\stage 并执行 setup.bat，
// setup.bat → setup.ps1 覆盖安装到同一 %LOCALAPPDATA%\DSH（配置/引擎/数据都在）。
// 这里把下载好的 exe 交给 shell 启动（不加参数，SFX 自带 RunProgram=setup.bat），
// 应用立即退出，让出文件锁；setup 完成后由 setup.ps1 启动新版 DSH。
let updaterInstalling = false;
ipcMain.handle('updater:install', async (_e, exePath) => {
  if (!exePath) return { ok: false, error: '缺少安装包路径' };
  if (!fs.existsSync(exePath)) return { ok: false, error: `安装包不存在: ${exePath}` };
  try {
    updaterInstalling = true;
    // windowsHide:false 但 SFX 自带 GUI（GUIMode=1）；detached 让安装器独立于本进程存活
    const child = spawn(exePath, [], { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    pushLog('stdout', `[更新] 已启动安装器: ${exePath}`);
    // 等 1.2s 让安装器接管后再退出本进程（避免过早关窗导致安装器未被接受）
    setTimeout(() => {
      if (harnessProc) { try { harnessProc.kill(); } catch { /* ignore */ } }
      app.exit(0);
    }, 1200);
    return { ok: true };
  } catch (err) {
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
  const dir = path.join(os.tmpdir(), 'DSH-update');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, name);
  let startedAt = 0;
  let lastAt = 0;
  let lastRecv = 0;

  // 下载候选序列：加速镜像优先，最后回源 GitHub（国内环境经镜像明显更快）
  const candidates = mirrorOf(url, { github: url });

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    const via = cand !== url ? `（镜像 ${i + 1}/${candidates.length - 1}）` : '（GitHub 官方）';
    pushLog('stdout', `[下载] ${name} ${via}: ${cand}`);
    sendUpdaterProgress({ received: 0, total: 0, pct: 0, phase: 'downloading', name, via, speed: 0 });
    startedAt = Date.now(); lastAt = Date.now(); lastRecv = 0;
    try {
      const res = await net.fetch(cand, { headers: { 'User-Agent': 'dsh-desktop' }, signal: AbortSignal.timeout(120000) });
      if (!res.ok) {
        pushLog('stderr', `[下载] ${cand} HTTP ${res.status}，切换下一跳…`);
        continue;
      }
      const total = Number(res.headers.get('content-length')) || 0;
      const reader = res.body.getReader();
      const ws = fs.createWriteStream(target);
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        ws.write(value);
        const now = Date.now();
        const dt = now - lastAt;
        if (dt >= 250) {
          const speed = ((received - lastRecv) / 1024 / 1024) / (dt / 1000); // MB/s
          lastAt = now; lastRecv = received;
          sendUpdaterProgress({
            received, total, pct: total ? Math.min(100, Math.round((received / total) * 100)) : 0,
            phase: 'downloading', name, via, speed,
          });
        }
      }
      ws.end();
      await new Promise((resolve) => ws.on('finish', resolve));
      const speedAvg = startedAt ? (received / 1024 / 1024) / ((Date.now() - startedAt) / 1000) : 0;
      sendUpdaterProgress({ received, total, pct: 100, phase: 'done', name, via, speed: speedAvg });
      // 完成后：若为 Setup.exe 则自动触发安装并重启（正常软件更新体验），否则打开所在目录
      const isExe = /\.exe$/i.test(name);
      pushLog('stdout', `[下载] 完成 ${name} (${(received / 1048576).toFixed(1)} MB, ${speedAvg.toFixed(2)} MB/s)；${isExe ? '即将安装并重启' : '已就绪'}`);
      if (isExe) {
        sendUpdaterResult({ ok: true, path: target, name, via, autoInstall: true });
        return { ok: true, path: target, name, via, autoInstall: true };
      }
      try { shell.openPath(target); } catch { /* ignore */ }
      sendUpdaterResult({ ok: true, path: target, name, via });
      return { ok: true, path: target, name, via };
    } catch (err) {
      pushLog('stderr', `[下载] ${cand} 失败：${err.message}，切换下一跳…`);
      // 清掉可能写坏的半截文件，下一跳覆盖写
      try { fs.rmSync(target, { force: true }); } catch { /* ignore */ }
    }
  }
  sendUpdaterResult({ ok: false, error: '所有下载源均失败（GitHub 及加速镜像不可达），请稍后重试' });
  return { ok: false, error: '所有下载源均失败（GitHub 及加速镜像不可达）' };
});

app.whenReady().then(() => {
  createWindow();
  ensureShortcut();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // 正在执行更新安装时：不杀 harness（harness 是安装器 setup.ps1 会用到的引擎，
  // 且安装完成后 setup.ps1 会启动新版 DSH），直接退出应用进程
  if (!updaterInstalling && harnessProc) stopHarness();
  app.quit();
});
