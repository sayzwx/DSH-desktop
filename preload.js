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
  ghLogin: (token) => ipcRenderer.invoke('github:login', token),
  ghLogout: () => ipcRenderer.invoke('github:logout'),
  ghOpenTokenPage: () => ipcRenderer.invoke('github:openTokenPage'),
  ghRepos: () => ipcRenderer.invoke('github:repos'),
  ghBranches: (owner, repo) => ipcRenderer.invoke('github:branches', { owner, repo }),
  ghTree: (owner, repo, branch) => ipcRenderer.invoke('github:tree', { owner, repo, branch }),
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
  chatSend: (sessionId, text, images) => {
    const content = [];
    if (text) content.push({ type: 'text', text });
    for (const img of images || []) {
      content.push({ type: 'image', mediaType: img.mediaType, data: img.data, name: img.name });
    }
    return ipcRenderer.invoke('chat:send', { sessionId, content });
  },
  chatAttachment: (sessionId, attachmentId) =>
    ipcRenderer.invoke('chat:attachment', { sessionId, attachmentId }),
  chatCancel: (sessionId) => ipcRenderer.invoke('chat:cancel', sessionId),
  chatModels: (sessionId) => ipcRenderer.invoke('chat:models', sessionId),
  chatSelectModel: (sessionId, provider, model, reasoningEffort) =>
    ipcRenderer.invoke('chat:selectModel', { sessionId, provider, model, reasoningEffort }),
  getPresets: () => ipcRenderer.invoke('settings:presets'),
  readPreset: (agentPreset) => ipcRenderer.invoke('settings:presetRead', agentPreset),
  openPresetDoc: (agentPreset) => ipcRenderer.invoke('settings:presetOpen', agentPreset),
  selectPreset: (sessionId, agentPreset) => ipcRenderer.invoke('settings:presetSelect', { sessionId, agentPreset }),
  getLlmProviders: () => ipcRenderer.invoke('settings:llmProviders'),
  getLlmModels: () => ipcRenderer.invoke('settings:llmModels'),
  getSettingsDescribe: () => ipcRenderer.invoke('settings:describe'),
  getPluginCatalog: () => ipcRenderer.invoke('settings:pluginCatalog'),
  getPresetDefault: () => ipcRenderer.invoke('settings:presetDefault'),
  setPresetDefault: (preset) => ipcRenderer.invoke('settings:setPresetDefault', preset),
  openSettingsDoc: () => ipcRenderer.invoke('settings:openDoc'),
  onChatFrame: (cb) => ipcRenderer.on('chat:frame', (_e, msg) => cb(msg)),
  getApiKey: () => ipcRenderer.invoke('settings:getApiKey'),
  setApiKey: (key) => ipcRenderer.invoke('settings:setApiKey', key),
});
