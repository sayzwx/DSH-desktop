const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  startHarness: () => ipcRenderer.invoke('harness:start'),
  stopHarness: () => ipcRenderer.invoke('harness:stop'),
  getStatus: () => ipcRenderer.invoke('harness:status'),
  getLogs: () => ipcRenderer.invoke('harness:logs'),
  openWeb: () => ipcRenderer.invoke('harness:openWeb'),
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
  discoverModels: (settingsNs, provider, apiKey) => ipcRenderer.invoke('llm:discoverModels', { settingsNs, provider, apiKey }),
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
});
