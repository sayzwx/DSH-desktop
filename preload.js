const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  startHarness: () => ipcRenderer.invoke('harness:start'),
  stopHarness: () => ipcRenderer.invoke('harness:stop'),
  getStatus: () => ipcRenderer.invoke('harness:status'),
  // 引擎版本与官方更新检测（P0 配套：知道官方发到哪个版本，npm 形态可一键升级）
  engineVersions: (force) => ipcRenderer.invoke('engine:versions', { force: !!force }),
  engineUpgrade: (version) => ipcRenderer.invoke('engine:upgrade', { version }),
  getLogs: () => ipcRenderer.invoke('harness:logs'),
  openWeb: () => ipcRenderer.invoke('harness:openWeb'),
  setNativeTheme: (mode) => ipcRenderer.invoke('app:nativeTheme', mode),
  listResults: () => ipcRenderer.invoke('results:list'),
  getUsageStats: () => ipcRenderer.invoke('stats:usage'),
  ghStatus: () => ipcRenderer.invoke('github:status'),
  ghDetectKeys: () => ipcRenderer.invoke('github:detectKeys'),
  ghPickKey: () => ipcRenderer.invoke('github:pickKey'),
  ghConnect: (opts) => ipcRenderer.invoke('github:connect', opts),
  ghOpenKeysPage: () => ipcRenderer.invoke('github:openKeysPage'),
  ghLogout: () => ipcRenderer.invoke('github:logout'),
  ghRepos: () => ipcRenderer.invoke('github:repos'),
  ghAddRepo: (input) => ipcRenderer.invoke('github:addRepo', input),
  ghRemoveRepo: (url) => ipcRenderer.invoke('github:removeRepo', url),
  ghListTokenStatus: () => ipcRenderer.invoke('github:listTokenStatus'),
  ghSetListToken: (token) => ipcRenderer.invoke('github:setListToken', token),
  ghClearListToken: () => ipcRenderer.invoke('github:clearListToken'),
  ghBranches: (url) => ipcRenderer.invoke('github:branches', { url }),
  ghTree: (url, branch) => ipcRenderer.invoke('github:tree', { url, branch }),
  mcpList: () => ipcRenderer.invoke('mcp:list'),
  skillsList: (sessionId) => ipcRenderer.invoke('skills:list', sessionId),
  onLog: (cb) => ipcRenderer.on('harness:log', (_e, lines) => cb(lines)),
  onState: (cb) => ipcRenderer.on('harness:state', (_e, state) => cb(state)),
  chatConnect: () => ipcRenderer.invoke('chat:connect'),
  chatDisconnect: () => ipcRenderer.invoke('chat:disconnect'),
  chatList: () => ipcRenderer.invoke('chat:list'),
  chatCreate: (opts) => ipcRenderer.invoke('chat:create', opts || null),
  chatWorkspaces: () => ipcRenderer.invoke('chat:workspaces'),
  pickWorkspaceDir: () => ipcRenderer.invoke('chat:pickWorkspaceDir'),
  addWorkspace: (path) => ipcRenderer.invoke('chat:addWorkspace', path),
  chatArchiveSession: (sessionId) => ipcRenderer.invoke('chat:archiveSession', sessionId),
  chatHistory: (sessionId) => ipcRenderer.invoke('chat:history', sessionId),
  chatSend: (sessionId, text, images, files, mode) => {
    const content = [];
    if (text) content.push({ type: 'text', text });
    for (const img of images || []) {
      content.push({ type: 'image', mediaType: img.mediaType, data: img.data, name: img.name });
    }
    return ipcRenderer.invoke('chat:send', { sessionId, content, files: files || [], mode: mode || 'queue' });
  },
  pickFiles: () => ipcRenderer.invoke('chat:pickFiles'),
  chatAnswerQuestion: (rpcId, sessionId, answers) =>
    ipcRenderer.invoke('chat:answerQuestion', { rpcId, sessionId, answers }),
  answerApproval: (rpcId, sessionId, approvalId, outcome) =>
    ipcRenderer.invoke('chat:answerApproval', { rpcId, sessionId, approvalId, outcome }),
  marketGet: (path) => ipcRenderer.invoke('market:get', path),
  marketPost: (path, body) => ipcRenderer.invoke('market:post', { path, body }),
  marketBackup: () => ipcRenderer.invoke('market:backup'),
  marketPickBackup: () => ipcRenderer.invoke('market:pickBackup'),
  marketLogExport: () => ipcRenderer.invoke('market:logExport'),
  marketEnsure: () => ipcRenderer.invoke('market:ensure'),
  marketCheck: () => ipcRenderer.invoke('market:check'),
  relaunchApp: () => ipcRenderer.invoke('app:relaunch'),
  listWindows: () => ipcRenderer.invoke('windows:list'),
  hideToTray: () => ipcRenderer.invoke('app:hideToTray'),
  showWindow: () => ipcRenderer.invoke('app:showWindow'),
  quitWithService: () => ipcRenderer.invoke('app:quitWithService'),
  quitBackgroundOnly: () => ipcRenderer.invoke('app:quitBackgroundOnly'),
  onWindowsChanged: (cb) => ipcRenderer.on('windows:changed', (_e, list) => cb(list)),
  chatAttachment: (sessionId, attachmentId) =>
    ipcRenderer.invoke('chat:attachment', { sessionId, attachmentId }),
  chatCancel: (sessionId) => ipcRenderer.invoke('chat:cancel', sessionId),
  chatCommandsExecute: (sessionId, line) => ipcRenderer.invoke('chat:commandsExecute', { sessionId, line }),
  chatCommandsList: (sessionId) => ipcRenderer.invoke('chat:commandsList', { sessionId }),
  chatModels: (sessionId) => ipcRenderer.invoke('chat:models', sessionId),
  chatSelectModel: (sessionId, provider, model, reasoningEffort) =>
    ipcRenderer.invoke('chat:selectModel', { sessionId, provider, model, reasoningEffort }),
  chatPermissionSet: (sessionId, preset) => ipcRenderer.invoke('chat:permissionSet', { sessionId, preset }),
  getPresets: () => ipcRenderer.invoke('settings:presets'),
  readPreset: (agentPreset) => ipcRenderer.invoke('settings:presetRead', agentPreset),
  openPresetDoc: (agentPreset) => ipcRenderer.invoke('settings:presetOpen', agentPreset),
  selectPreset: (sessionId, agentPreset) => ipcRenderer.invoke('settings:presetSelect', { sessionId, agentPreset }),
  getLlmProviders: () => ipcRenderer.invoke('settings:llmProviders'),
  getLlmModels: () => ipcRenderer.invoke('settings:llmModels'),
  describeCredentials: (refs) => ipcRenderer.invoke('credentials:describe', refs),
  setCredential: (ref, value) => ipcRenderer.invoke('credentials:set', { ref, value }),
  unsetCredential: (ref) => ipcRenderer.invoke('credentials:unset', ref),
  mutateSettings: (ns, ops, expectedRevision) => ipcRenderer.invoke('settings:mutate', { ns, ops, expectedRevision }),
  // api / baseURL 是「草稿探测」用的：自定义提供商在写入配置之前还没有 profile，
  // 引擎只能靠这两个字段去读端点的 GET /models（pi-ai 没内置该 provider 的 catalog 时）。
  discoverModels: (settingsNs, provider, apiKey, api, baseURL) =>
    ipcRenderer.invoke('llm:discoverModels', { settingsNs, provider, apiKey, api, baseURL }),
  // 模型能力探测：现场问出上下文窗口 / 输出上限 / 可用思考档位。
  // 只传凭据的**引用名**（apiKeyEnv），明文密钥由主进程在本机读取后用于出站请求，不跨 IPC。
  // payload.aliveOnly=true 时只判死活（每个模型一次 max_tokens=1 的请求）—— 全量刷新
  // 在几百个候选里筛出能用的那几个用这个轻量模式，存活的少数再做一次完整探测补齐档位。
  probeCapabilities: (payload) => ipcRenderer.invoke('llm:probeCapabilities', payload),
  // 引擎档位名 + 线上拼写映射，供「配置仓库」画出思考档位点选控件。
  // 单一事实来源是主进程的 lib/model-probe.js，界面不另抄一份。
  reasoningLevels: () => ipcRenderer.invoke('llm:reasoningLevels'),
  // 探测过程的逐行进度。注册前先清掉旧监听，避免反复打开编辑器造成监听堆积。
  onProbeProgress: (cb) => {
    ipcRenderer.removeAllListeners('llm:probeProgress');
    ipcRenderer.on('llm:probeProgress', (_e, line) => cb(line));
  },
  getSettingsDescribe: () => ipcRenderer.invoke('settings:describe'),
  getPluginCatalog: () => ipcRenderer.invoke('settings:pluginCatalog'),
  getPresetDefault: () => ipcRenderer.invoke('settings:presetDefault'),
  setPresetDefault: (preset) => ipcRenderer.invoke('settings:setPresetDefault', preset),
  openSettingsDoc: () => ipcRenderer.invoke('settings:openDoc'),
  onChatFrame: (cb) => ipcRenderer.on('chat:frame', (_e, msg) => cb(msg)),
  checkUpdate: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: (url) => ipcRenderer.invoke('updater:download', url),
  installUpdate: (exePath) => ipcRenderer.invoke('updater:install', exePath),
  onUpdaterProgress: (cb) => ipcRenderer.on('updater:progress', (_e, p) => cb(p)),
  onUpdaterResult: (cb) => ipcRenderer.on('updater:result', (_e, p) => cb(p)),
  getApiKey: () => ipcRenderer.invoke('settings:getApiKey'),
  setApiKey: (key) => ipcRenderer.invoke('settings:setApiKey', key),
  zenuaStatus: () => ipcRenderer.invoke('zenua:status'),
  zenuaEnable: () => ipcRenderer.invoke('zenua:enable'),
  zenuaDisable: () => ipcRenderer.invoke('zenua:disable'),

  // ---- 以下为表驱动 RPC 桥（见 main.js 的 RPC_BRIDGE）----
  // 返回值统一：成功 { ok:true, value }，失败 { ok:false, error, code }。
  // code 是引擎错误码（title-invalid / fork-unavailable / workspace-name-conflict 等），
  // 调用方据此给出可理解的提示，不要把裸码抛给用户。
  // 会话
  chatRename: (sessionId, title) => ipcRenderer.invoke('chat:rename', { sessionId, title }),
  chatSearch: (query) => ipcRenderer.invoke('chat:search', { query }),
  chatFork: (sessionId, atSeq) => ipcRenderer.invoke('chat:fork', { sessionId, atSeq }),
  chatUpdateQueue: (sessionId, itemId, action) => ipcRenderer.invoke('chat:updateQueue', { sessionId, itemId, action }),
  // Goal（六个变更动词都要带上当前投影里的 CAS ref）
  goalCreate: (sessionId, objective, maxGoalRounds) => ipcRenderer.invoke('goal:create', { sessionId, objective, maxGoalRounds }),
  goalEdit: (sessionId, ref, objective, maxGoalRounds) => ipcRenderer.invoke('goal:edit', { sessionId, ref, objective, maxGoalRounds }),
  goalPause: (sessionId, ref) => ipcRenderer.invoke('goal:pause', { sessionId, ref }),
  goalResume: (sessionId, ref) => ipcRenderer.invoke('goal:resume', { sessionId, ref }),
  goalComplete: (sessionId, ref) => ipcRenderer.invoke('goal:complete', { sessionId, ref }),
  goalClear: (sessionId, ref) => ipcRenderer.invoke('goal:clear', { sessionId, ref }),
  // 子 agent（addr = { parentSessionId, childSessionId, mode }；
  // mode 'one-shot' 是只读执行记录，'continuable' 才能续聊与中断）
  subagentList: (parentSessionId) => ipcRenderer.invoke('subagent:list', { parentSessionId }),
  subagentHistory: (addr, beforeSeq, maxMessages) =>
    ipcRenderer.invoke('subagent:history', { ...addr, beforeSeq, maxMessages }),
  subagentPrompt: (addr, content, clientTimeZone) =>
    ipcRenderer.invoke('subagent:prompt', { ...addr, content, clientTimeZone }),
  subagentInterrupt: (addr) => ipcRenderer.invoke('subagent:interrupt', addr),
  // 工作区（delete 只删注册表，目录与会话日志不动，会话随之变为未分组）
  chatRenameWorkspace: (workspaceId, title) => ipcRenderer.invoke('chat:renameWorkspace', { workspaceId, title }),
  chatDeleteWorkspace: (workspaceId) => ipcRenderer.invoke('chat:deleteWorkspace', { workspaceId }),
  chatMoveWorkspace: (workspaceId, beforeWorkspaceId) => ipcRenderer.invoke('chat:moveWorkspace', { workspaceId, beforeWorkspaceId }),
  chatMoveSession: (workspaceId, sessionId, beforeSessionId) =>
    ipcRenderer.invoke('chat:moveSession', { workspaceId, sessionId, beforeSessionId }),
  // Agent 预设（copy: from=源 id，agentPreset=新 id）
  copyPreset: (from, agentPreset, name) => ipcRenderer.invoke('settings:presetCopy', { from, agentPreset, name }),
  removePreset: (agentPreset) => ipcRenderer.invoke('settings:presetRemove', { agentPreset }),
  // 设置
  replaceSettings: (ns, section, expectedRevision) => ipcRenderer.invoke('settings:replace', { ns, section, expectedRevision }),
  // Host（openPath 受 host.describe 返回的 canOpenPath 门控，调用前先读它）
  hostDescribe: () => ipcRenderer.invoke('host:describe'),
  hostOpenPath: (path) => ipcRenderer.invoke('host:openPath', { path }),
  // 产物卡片：在文件夹中显示 / 取体积与时间（主进程只 stat，不读内容）
  hostShowInFolder: (path) => ipcRenderer.invoke('host:showInFolder', { path }),
  filesStat: (paths) => ipcRenderer.invoke('files:stat', { paths }),

  // ---- typert Remote：@引用候选（只读）与消息反馈（per-message CAS）----
  // 引用：agentId=当前会话，query=@ 之后的文本；两域各自独立降级
  fileRefs: (agentId, query) => ipcRenderer.invoke('chat:fileRefs', { agentId, query }),
  sessionRefs: (agentId, query) => ipcRenderer.invoke('chat:sessionRefs', { agentId, query }),
  // 反馈：list 只读；put/delete 带 ifVersion 做乐观并发，version-conflict 时返回权威 current
  feedbackList: (sessionId) => ipcRenderer.invoke('feedback:list', { sessionId }),
  feedbackPut: (sessionId, messageId, rating, note, ifVersion) =>
    ipcRenderer.invoke('feedback:put', { sessionId, messageId, rating, note, ifVersion }),
  feedbackDelete: (sessionId, messageId, ifVersion) =>
    ipcRenderer.invoke('feedback:delete', { sessionId, messageId, ifVersion }),

  // ---- 应用菜单 / 快捷键 / 系统通知 ----
  // 菜单项与快捷键在主进程，页面跳转这类动作转发给渲染层执行，主进程不操作 DOM
  onMenuAction: (cb) => ipcRenderer.on('app:menu', (_e, action) => cb(action)),
  // 回合结束时调用：渲染层知道会话标题，主进程知道窗口可见性，由主进程决定是否真的通知
  notifyTurnEnd: (title) => ipcRenderer.invoke('notify:turnEnd', title),
  getNotifyPrefs: () => ipcRenderer.invoke('notify:getPrefs'),
  setNotifyPrefs: (patch) => ipcRenderer.invoke('notify:setPrefs', patch),

  // ---- 轨道 G：引擎诊断 / 备份 ~/.dsh / 会话导出 Markdown ----
  getDiagnostics: () => ipcRenderer.invoke('diagnostics:get'),
  backupDsh: () => ipcRenderer.invoke('diagnostics:backupDsh'),
  exportMarkdown: (defaultName, markdown) => ipcRenderer.invoke('chat:exportMarkdown', { defaultName, markdown }),
  openDevTools: () => ipcRenderer.invoke('app:openDevTools'),

  // ---- 主题工作室：WebUI 主题包 → 桌面端主题 ----
  // 迁移逻辑（解析、映射、净化）全在主进程的 lib/web-themes.js 与 lib/theme-analysis.js，
  // 渲染层只负责显示与选择；密钥只以「引用名」形式传下去，明文不回渲染进程。
  themeScan: () => ipcRenderer.invoke('theme:scan'),
  themeMigrate: (pluginId, schemeId, tone) => ipcRenderer.invoke('theme:migrate', { pluginId, schemeId, tone }),
  themeAnalyze: (payload) => ipcRenderer.invoke('theme:analyze', payload),
  themeRoutes: () => ipcRenderer.invoke('theme:routes'),
  themeInstall: (migrations, analysis) => ipcRenderer.invoke('theme:install', { migrations, analysis }),
  themeList: () => ipcRenderer.invoke('theme:list'),
  themeRemove: (id) => ipcRenderer.invoke('theme:remove', id),
  themeClear: () => ipcRenderer.invoke('theme:clear'),
  themeRevealPlugin: (pluginId) => ipcRenderer.invoke('theme:revealPlugin', pluginId),
  themeRevealStore: () => ipcRenderer.invoke('theme:revealStore'),
  // 手动添加 / 移除插件扫描目录（插件装在扫描根之外时用；持久化在主题库里）
  themeAddScanRoot: () => ipcRenderer.invoke('theme:addScanRoot'),
  themeRemoveScanRoot: (path) => ipcRenderer.invoke('theme:removeScanRoot', { path }),
  onThemeAnalysisProgress: (cb) => ipcRenderer.on('theme:analysisProgress', (_e, line) => cb(line)),

  // ---------------- Git（工作区级别的本地仓库）----------------
  // 全部在主进程执行（spawn git，不拼 shell）；渲染层只传目录与分支名，
  // 分支名在白名单校验不过会被拒。
  gitWorkspaceDir: () => ipcRenderer.invoke('git:workspaceDir'),
  gitStatus: (dir) => ipcRenderer.invoke('git:status', { dir }),
  gitRemoteUrl: (dir) => ipcRenderer.invoke('git:remoteUrl', { dir }),
  gitCheckout: (dir, branch) => ipcRenderer.invoke('git:checkout', { dir, branch }),
  gitCreateBranch: (dir, name, from) => ipcRenderer.invoke('git:createBranch', { dir, name, from }),
  gitInit: (dir) => ipcRenderer.invoke('git:init', { dir }),
  gitDiff: (dir, file) => ipcRenderer.invoke('git:diff', { dir, file }),
  gitOpenTerminal: (dir) => ipcRenderer.invoke('git:openTerminal', { dir }),

  // ---------------- 内置浏览器（WebContentsView，独立 webContents）----------------
  browserOpen: (url, bounds) => ipcRenderer.invoke('browser:open', { url, bounds }),
  browserSetBounds: (bounds) => ipcRenderer.invoke('browser:setBounds', bounds || {}),
  browserNavigate: (url) => ipcRenderer.invoke('browser:navigate', { url }),
  browserNav: (action) => ipcRenderer.invoke('browser:nav', { action }),
  browserClose: () => ipcRenderer.invoke('browser:close'),
  browserOpenExternal: (url) => ipcRenderer.invoke('browser:openExternal', { url }),
  // 官方界面宿主（Phase 1）：把我们界面里的一个面板变成引擎自带 WebUI 的容器
  frontendOpen: () => ipcRenderer.invoke('frontend:open', {}),
  frontendSetBounds: (bounds) => ipcRenderer.invoke('frontend:setBounds', bounds || {}),
  frontendClose: () => ipcRenderer.invoke('frontend:close'),
  frontendState: () => ipcRenderer.invoke('frontend:state'),
  frontendOpenExternal: (url) => ipcRenderer.invoke('frontend:openExternal', { url }),
  onFrontendEvent: (cb) => ipcRenderer.on('frontend:event', (_e, payload) => cb(payload)),
  browserState: () => ipcRenderer.invoke('browser:state'),
  onBrowserEvent: (cb) => ipcRenderer.on('browser:event', (_e, data) => cb(data)),
});
