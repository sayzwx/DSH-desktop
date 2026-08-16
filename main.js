const { app, BrowserWindow, ipcMain, shell, dialog, net } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HARNESS_DIR = process.env.DSH_HARNESS_DIR || 'C:\\Users\\mjsx\\DeepSeek-Harness';
const DSH_HOME = path.join(os.homedir(), '.dsh');
const PORT = 3080;
const LOG_LIMIT = 5000;

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

async function startHarness() {
  if (harnessProc) return { ok: false, error: 'already running' };
  if (!fs.existsSync(path.join(HARNESS_DIR, 'package.json'))) {
    return { ok: false, error: `harness 目录不存在: ${HARNESS_DIR}` };
  }
  if (await checkWebUp()) {
    pushLog('stdout', '[检测到 :3080 已有实例在运行，已直接接管，无需再次启动]');
    setState('running');
    return { ok: true, adopted: true };
  }
  setState('starting');
  startDeadline = Date.now() + 90 * 1000;
  const env = { ...process.env, ...loadDotEnv(), DSH_HOME };
  harnessProc = spawn('cmd.exe', ['/c', 'pnpm dsh web'], {
    cwd: HARNESS_DIR,
    env,
    windowsHide: true,
  });
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
    icon: path.join(__dirname, 'icon-planet.ico'),
    title: 'DeepSeek Harness 桌面端',
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
  } else if (harnessProc && harnessState === 'starting' && startDeadline && Date.now() > startDeadline) {
    pushLog('stderr', '[启动超时] 90 秒内 :3080 未就绪，已终止进程');
    try {
      spawnSync('taskkill', ['/PID', String(harnessProc.pid), '/T', '/F'], { windowsHide: true });
    } catch (err) { /* ignore */ }
    harnessProc = null;
    startDeadline = 0;
    setState('stopped');
  }
  return { state: harnessState, webUp, port: PORT, harnessDir: HARNESS_DIR };
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
  const payload = opts?.workspaceId ? { workspaceId: opts.workspaceId } : { cwd: HARNESS_DIR };
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
ipcMain.handle('chat:send', async (_e, { sessionId, content }) => {
  const blocks = Array.isArray(content) && content.length > 0
    ? content
    : [{ type: 'text', text: '' }];
  const r = await rpcCall('session.prompt', {
    sessionId,
    mode: 'queue',
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
  const out = [];
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
              path: path.relative(HARNESS_DIR, path.join(dir, e.name)),
            });
          }
        } catch { /* 忽略损坏的 package.json */ }
      }
    }
  };
  scan(path.join(HARNESS_DIR, 'packages', 'host'));
  scan(path.join(HARNESS_DIR, 'packages', 'client'));
  scan(path.join(HARNESS_DIR, 'packages', 'api'));
  scan(path.join(HARNESS_DIR, 'packages', 'llm'));
  scan(path.join(HARNESS_DIR, 'packages', 'core'));
  scan(path.join(HARNESS_DIR, 'packages', 'tools'));
  scan(path.join(HARNESS_DIR, 'packages', 'agent'));
  scan(path.join(HARNESS_DIR, 'packages', 'jobs'));
  scan(path.join(HARNESS_DIR, 'packages', 'skills'));
  scan(path.join(HARNESS_DIR, 'packages', 'feedback'));
  scan(path.join(HARNESS_DIR, 'packages', 'auth'));
  scan(path.join(HARNESS_DIR, 'packages', 'runtime'));
  scan(path.join(HARNESS_DIR, 'apps'));
  // 兜底：扫描 packages 下所有二级目录
  try {
    for (const g of fs.readdirSync(path.join(HARNESS_DIR, 'packages'), { withFileTypes: true })) {
      if (!g.isDirectory()) continue;
      const gp = path.join(HARNESS_DIR, 'packages', g.name);
      for (const e of fs.readdirSync(gp, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const pkgPath = path.join(gp, e.name, 'package.json');
        if (!fs.existsSync(pkgPath)) continue;
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          if (pkg.name && pkg.name.startsWith('@deepseek-ai/') && !out.some((o) => o.id === pkg.name)) {
            out.push({ id: pkg.name, version: pkg.version || '', description: pkg.description || '', path: path.relative(HARNESS_DIR, path.join(gp, e.name)) });
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

// ---------- 侧边栏 Dock：GitHub / MCP / Skills ----------
const GH_TOKEN_FILE = path.join(DSH_HOME, '.github-token');

function readGhToken() {
  try { return fs.readFileSync(GH_TOKEN_FILE, 'utf8').trim(); } catch { return null; }
}

async function ghFetch(pathname, token, init = {}) {
  let res;
  try {
    // 用 Electron 的 net.fetch（Chromium 网络栈，信任 Windows 系统证书库）：
    // 全局 fetch 走 Node 自带证书库，在本地 TLS 拦截环境下会报 unable to verify the first certificate。
    res = await net.fetch(`https://api.github.com${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'dsh-desktop',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.headers || {}),
      },
    });
  } catch (err) {
    // 网络异常（DNS / 连接被重置 / 超时）不能让登录流程挂死，转成可读错误
    return { err: `网络错误: ${err.message}` };
  }
  if (res.status === 401 || res.status === 403) {
    return { err: 'unauthorized' };
  }
  if (!res.ok) return { err: `GitHub API ${res.status}: ${(await res.text()).slice(0, 200)}` };
  return { data: await res.json() };
}

async function ghAvatarDataUrl(avatarUrl, token) {
  try {
    const res = await net.fetch(avatarUrl, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'dsh-desktop' } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch { return null; }
}

ipcMain.handle('github:status', async () => {
  const token = readGhToken();
  if (!token) return { ok: true, connected: false };
  const r = await ghFetch('/user', token);
  if (r.err) {
    if (r.err === 'unauthorized') { fs.rmSync(GH_TOKEN_FILE, { force: true }); return { ok: true, connected: false }; }
    return { ok: false, error: r.err };
  }
  const u = r.data;
  const avatar = await ghAvatarDataUrl(u.avatar_url, token);
  return { ok: true, connected: true, login: u.login, name: u.name || u.login, avatar };
});
ipcMain.handle('github:login', async (_e, token) => {
  const t = String(token || '').trim();
  if (!t) return { ok: false, error: 'token 不能为空' };
  const r = await ghFetch('/user', t);
  if (r.err) return { ok: false, error: r.err === 'unauthorized' ? 'Token 无效或已过期' : r.err };
  const u = r.data;
  fs.mkdirSync(DSH_HOME, { recursive: true });
  fs.writeFileSync(GH_TOKEN_FILE, t, 'utf8');
  const avatar = await ghAvatarDataUrl(u.avatar_url, t);
  return { ok: true, login: u.login, name: u.name || u.login, avatar };
});
ipcMain.handle('github:logout', async () => {
  fs.rmSync(GH_TOKEN_FILE, { force: true });
  return { ok: true };
});
ipcMain.handle('github:openTokenPage', async () => {
  await shell.openExternal('https://github.com/settings/tokens');
  return { ok: true };
});
ipcMain.handle('github:repos', async () => {
  const token = readGhToken();
  if (!token) return { ok: false, error: '未连接 GitHub' };
  const r = await ghFetch('/user/repos?per_page=100&sort=updated', token);
  if (r.err) return { ok: false, error: r.err };
  return {
    ok: true,
    repos: r.data.map((x) => ({
      full_name: x.full_name,
      name: x.name,
      description: x.description || '',
      default_branch: x.default_branch,
      private: !!x.private,
      updated_at: x.updated_at,
    })),
  };
});
ipcMain.handle('github:branches', async (_e, { owner, repo }) => {
  const token = readGhToken();
  if (!token) return { ok: false, error: '未连接 GitHub' };
  const r = await ghFetch(`/repos/${owner}/${repo}/branches?per_page=100`, token);
  if (r.err) return { ok: false, error: r.err };
  return { ok: true, branches: r.data.map((b) => b.name) };
});
ipcMain.handle('github:tree', async (_e, { owner, repo, branch }) => {
  const token = readGhToken();
  if (!token) return { ok: false, error: '未连接 GitHub' };
  const r = await ghFetch(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, token);
  if (r.err) return { ok: false, error: r.err };
  const tree = (r.data.tree || []).filter((t) => t.type === 'blob' || t.type === 'tree').map((t) => ({ path: t.path, type: t.type }));
  return { ok: true, tree, truncated: !!r.data.truncated };
});

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

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (harnessProc) stopHarness();
  app.quit();
});
