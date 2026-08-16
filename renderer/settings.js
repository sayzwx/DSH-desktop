/**
 * 设置页：插件（agent preset）管理与模型配置
 * - 插件列表：名称 / 说明（解释）/ 信任级别 / 内容预览 / 打开文件 / 用户注释（本地保存）
 * - 模型配置：提供商目录 + 模型分组（来自 harness llm.providers / llm.models）
 */
(function () {
  const api = window.api;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const NOTES_KEY = 'dsh-plugin-notes';
  let notes = {};
  try { notes = JSON.parse(localStorage.getItem(NOTES_KEY) || '{}'); } catch (e) { notes = {}; }
  const saveNotes = () => localStorage.setItem(NOTES_KEY, JSON.stringify(notes));

  // ---------------- 插件列表 ----------------
  async function refreshPresets() {
    const list = $('#presetList');
    const r = await api.getPresets();
    if (!r.ok) {
      list.innerHTML = `<div class="empty">插件目录获取失败：${esc(r.error)}</div>`;
      return;
    }
    const presets = r.presets || [];
    if (presets.length === 0) {
      list.innerHTML = '<div class="empty">harness 未挂载任何插件</div>';
      return;
    }
    list.innerHTML = presets
      .map((p) => {
        const note = notes[p.id] || '';
        return `<div class="preset-card" data-id="${esc(p.id)}">
          <div class="preset-head">
            <strong class="preset-name">${esc(p.name || p.id)}</strong>
            <span class="badge trust-${esc(p.trust)}">${p.trust === 'system' ? '内置' : '用户'}</span>
            ${p.isDefault ? '<span class="badge trust-default">默认</span>' : ''}
            ${p.broken ? `<span class="badge trust-broken" title="${esc(p.broken)}">异常</span>` : ''}
            <code class="preset-id">${esc(p.id)}</code>
          </div>
          <div class="preset-desc">${esc(p.description || '（该插件没有内置说明）')}</div>
          <details class="preset-content">
            <summary>查看插件内容（组合文件）</summary>
            <pre class="preset-content-pre"></pre>
          </details>
          <div class="preset-note-row">
            <label>我的注释</label>
            <textarea class="preset-note" rows="2" placeholder="记录这个插件的用途、注意事项…（保存于本机）">${esc(note)}</textarea>
            <span class="preset-note-saved"></span>
          </div>
          <div class="preset-actions">
            <button class="mini-btn preset-open" type="button">打开文件</button>
          </div>
        </div>`;
      })
      .join('');

    list.querySelectorAll('.preset-card').forEach((card) => {
      const id = card.dataset.id;
      const details = card.querySelector('.preset-content');
      const pre = card.querySelector('.preset-content-pre');
      details.addEventListener('toggle', async () => {
        if (!details.open || pre.dataset.loaded) return;
        pre.textContent = '加载中…';
        const r = await api.readPreset(id);
        if (r.ok) {
          pre.textContent = r.content || '（空）';
          pre.dataset.loaded = '1';
        } else {
          pre.textContent = '读取失败：' + (r.error || 'unknown');
        }
      });
      card.querySelector('.preset-open').addEventListener('click', async () => {
        const r = await api.openPresetDoc(id);
        if (!r.ok && !r.opened) (window.__modal ? window.__modal.alert('打开文件失败：' + (r.error || 'unknown'), '提示') : alert('打开文件失败：' + (r.error || 'unknown')));
      });
      const ta = card.querySelector('.preset-note');
      const saved = card.querySelector('.preset-note-saved');
      let timer = null;
      ta.addEventListener('input', () => {
        saved.textContent = '…';
        clearTimeout(timer);
        timer = setTimeout(() => {
          notes[id] = ta.value;
          saveNotes();
          saved.textContent = '已保存 ✓';
          setTimeout(() => { saved.textContent = ''; }, 1800);
        }, 500);
      });
    });
  }

  // ---------------- 模型配置 ----------------
  let modelGroupsAll = [];
  let providerNames = {};

  async function refreshModels() {
    const stats = $('#providerStats');
    const sel = $('#providerSelect');
    const groups = $('#modelGroupList');
    const lp = await api.getLlmProviders();
    const lm = await api.getLlmModels();
    if (!lp.ok && !lm.ok) {
      sel.innerHTML = '<option value="">（获取失败）</option>';
      stats.innerHTML = `<div class="empty">模型目录获取失败：${esc(lp.error || lm.error)}</div>`;
      groups.innerHTML = '';
      return;
    }
    const providers = lp.ok ? lp.providers || [] : [];
    providerNames = {};
    for (const p of providers) providerNames[p.provider] = p.displayName || p.provider;
    const active = providers.filter((p) => p.active);
    modelGroupsAll = lm.ok ? lm.groups || [] : [];
    const current = sel.value;
    sel.innerHTML = ['', ...modelGroupsAll.map((g) => g.id)]
      .map((id) => `<option value="${esc(id)}">${id ? esc(providerNames[id] || id) : '全部提供商'}</option>`)
      .join('');
    if (modelGroupsAll.some((g) => g.id === current)) sel.value = current;
    renderModelGroups();
    stats.innerHTML = `<span class="pstat">${providers.length} 个提供商</span>
      <span class="pstat ok">${active.length} 个已启用</span>
      <span class="pstat">${modelGroupsAll.length} 个模型分组</span>`;
  }

  function renderModelGroups() {
    const selVal = $('#providerSelect').value;
    const groups = modelGroupsAll.filter((g) => !selVal || g.id === selVal);
    $('#modelGroupList').innerHTML = groups.length === 0
      ? '<div class="empty">该提供商暂无可用模型</div>'
      : groups
          .map(
            (grp) => `<div class="model-group">
            <div class="mg-head"><span class="mg-name">${esc(grp.name || grp.id)}</span><code class="mg-id">${esc(grp.id)}</code></div>
            <div class="mg-models">${(grp.models || []).map((m) => `<span class="mg-chip" title="${esc(m.id)}">${esc(m.name || m.id)}</span>`).join('') || '<span class="empty">（空）</span>'}</div>
          </div>`
          )
          .join('');
  }

  // ---------------- 插件配置域（settings.describe namespaces + 功能备注） ----------------
  const NS_NOTES = {
    'agent-presets': '默认 Agent 预设管理（当前默认：cordis 创造模式）',
    'agent-loop': 'Agent 主循环参数（如最大并行工具调用数）',
    'llm-deepseek': 'DeepSeek 官方模型路由（模型、密钥、推理参数）',
    'llm-pi-ai': '聚合模型提供商（opencode-go / openai / anthropic 等三十余家）',
    'web-search-deepseek': '网页搜索插件配置',
    shell: 'Shell 执行环境（超时、输出上限、工作目录）',
    permission: '文件操作权限策略（只读 / 工作区写 / 全权限）',
    locale: '界面语言（zh / en）',
    'ui-theme': 'Web 界面主题',
    'ui-conversation': '对话交互配置（发送模式等）',
    'ui-onboarding': '首次使用引导配置',
  };
  const NS_ICONS = {
    'agent-presets': '🤖', 'agent-loop': '🌀', 'llm-deepseek': '🟦', 'llm-pi-ai': '🟣',
    'web-search-deepseek': '🔎', shell: '💻', permission: '🛡', locale: '🌐',
    'ui-theme': '🎨', 'ui-conversation': '💬', 'ui-onboarding': '🚀',
  };

  async function refreshPluginNs() {
    const el = $('#pluginNsList');
    const r = await api.getSettingsDescribe();
    if (!r.ok) {
      el.innerHTML = `<div class="empty">插件配置域获取失败：${esc(r.error)}</div>`;
      return;
    }
    const namespaces = r.namespaces || [];
    if (namespaces.length === 0) {
      el.innerHTML = '<div class="empty">本部署没有开放任何插件设置</div>';
      return;
    }
    el.innerHTML = namespaces
      .map((n) => {
        const value = n.value && typeof n.value === 'object' ? JSON.stringify(n.value) : String(n.value ?? '');
        return `<div class="ns-card">
          <div class="ns-head"><span class="ns-icon">${NS_ICONS[n.ns] || '🔌'}</span>
            <code class="ns-name">${esc(n.ns)}</code>
            <span class="ns-note">${esc(NS_NOTES[n.ns] || '插件配置域（无内置备注，可自行添加注释）')}</span>
          </div>
          ${value && value !== '{}' ? `<div class="ns-value" title="当前配置">${esc(value.slice(0, 160))}</div>` : ''}
        </div>`;
      })
      .join('');
  }

  // ---------------- 默认 Agent 模式选择 ----------------
  async function refreshDefaultPreset() {
    const sel = $('#defaultPresetSelect');
    const r = await api.getPresets();
    const cur = await api.getPresetDefault();
    const presets = r.ok ? r.presets || [] : [];
    if (presets.length === 0) {
      sel.innerHTML = '<option value="">（无预设）</option>';
      return;
    }
    sel.innerHTML = presets
      .map((p) => `<option value="${esc(p.id)}">${esc(p.name || p.id)}${p.isDefault ? '（默认）' : ''}</option>`)
      .join('');
    if (cur.ok && cur.default) sel.value = cur.default;
  }

  // ---------------- 完整插件目录 ----------------
  let catalogAll = [];
  let catalogShown = 40;

  const PKG_NOTES = {
    '@deepseek-ai/dsh': 'dsh CLI：配置启动、插件管理、浏览器 UI 别名',
    '@deepseek-ai/dsh-acp': 'ACP 自动化服务器：JSON-RPC 驱动 Harness Agent',
    '@deepseek-ai/dsh-acp-demo': 'ACP 自动化演示应用（Agent 主干 + JSONL 持久化 + ACP 传输）',
    '@deepseek-ai/dsh-acp-snapshot': 'ACP 测试套件（子进程启动器、快照场景、输出归一化）',
    '@deepseek-ai/dsh-agent': 'Agent 接口、注册表、发起作用域与事件词汇',
    '@deepseek-ai/dsh-agent-default-model': 'Agent 入口共享的默认模型选择',
    '@deepseek-ai/dsh-agent-instructions': '工作区上下文加载器（AGENTS.md / CLAUDE.md 指令文件）',
    '@deepseek-ai/dsh-agent-loop': 'Agent 主循环插件（思考→工具调用循环）',
    '@deepseek-ai/dsh-agent-loop-testkit': 'Agent 主循环测试的共享环境挂载',
    '@deepseek-ai/dsh-agent-presets': '按会话从 cordis.yml 预设组装 Agent 组成',
    '@deepseek-ai/dsh-agent-spine-demo': '无执行器/无 UI 的默认 Agent 主干（回退标题、按提供商重试）',
    '@deepseek-ai/dsh-agent-tool-presentation': 'Agent 工具展示选择器（Code Mode / 原生 / 两者）',
    '@deepseek-ai/dsh-anonymous-user-id': '遥测与反馈关联的匿名用户身份',
    '@deepseek-ai/dsh-api-gateway': 'Typert 远端方法分发器与客户端 API 端点',
    '@deepseek-ai/dsh-api-remotes': '远端 BFF 组装与 Host Agent/会话查找策略',
    '@deepseek-ai/dsh-app-boot': '应用入口共享启动胶水（.env 加载、Loader 守卫、配置解析）',
    '@deepseek-ai/dsh-atomic-write': '零依赖原子文件替换（临时文件 + 改名）',
    '@deepseek-ai/dsh-attachment': '持久不可变附件存储抽象',
    '@deepseek-ai/dsh-attachment-local': 'DSH_HOME 内容寻址附件存储实现',
    '@deepseek-ai/dsh-base': '共享 dsh 核心：每个 profile 的第一层补丁，插入基础插件行',
    '@deepseek-ai/dsh-bash-local': 'bash 执行器本地子进程实现',
    '@deepseek-ai/dsh-bash-sandbox': 'bash 执行器沙箱实现（每条命令经沙箱约束）',
    '@deepseek-ai/dsh-brand': '类型级 Branded<> 名义类型原语',
    '@deepseek-ai/dsh-client-connection': '浏览器连接层：HTTP 上 / WebSocket 下、双流重连',
    '@deepseek-ai/dsh-client-hmr': '开发期客户端热重载驱动（SSE 重建帧 → 失效/预取）',
    '@deepseek-ai/dsh-client-locale': '语言环境插件（中/英偏好、快照、类型化字典）',
    '@deepseek-ai/dsh-client-modules': '客户端模块系统（node 半面组装 __DSH_BOOT__ 入口图）',
    '@deepseek-ai/dsh-client-runtime': '客户端核心服务（SlotRegistry、SessionRuntime 作用域树）',
    '@deepseek-ai/dsh-client-schema-form': '设置编辑器 schema/草稿模型层',
    '@deepseek-ai/dsh-client-test-runtime': 'jsdom slot 测试运行环境',
    '@deepseek-ai/dsh-client-ui-agent-preset': 'Agent 预设界面（默认/当前会话/组合编辑器）',
    '@deepseek-ai/dsh-client-ui-attachment': 'Web UI 附件原子组件（图片草稿条、消息图库、原图灯箱）',
    '@deepseek-ai/dsh-client-ui-commands': '客户端命令界面（"/" 命令目录、三类命令 UI）',
    '@deepseek-ai/dsh-client-ui-conversation': '对话域：顺序聊天流、输入器（busy-Enter 偏好）',
    '@deepseek-ai/dsh-client-ui-cordis': 'Cordis 动态插件定义卡片（cordis_define 工具行）',
    '@deepseek-ai/dsh-client-ui-deliverables': '产物文件回合尾部与可点击文件引用',
    '@deepseek-ai/dsh-client-ui-directory-picker-browse': '应用内目录浏览界面',
    '@deepseek-ai/dsh-client-ui-directory-picker-native': '原生目录选择界面',
    '@deepseek-ai/dsh-client-ui-goal': '会话目标界面（GoalBar 停靠于输入器上方）',
    '@deepseek-ai/dsh-client-ui-input-trigger': '输入触发管线（"/" 与 "@" 检测、候选菜单）',
    '@deepseek-ai/dsh-client-ui-jobs': '会话头部后台任务列表',
    '@deepseek-ai/dsh-client-ui-layout': '外壳插件：三栏 AppFrame、拖拽手柄、导航/面板状态',
    '@deepseek-ai/dsh-client-ui-message-feedback': '消息反馈控件（评分/备注）',
    '@deepseek-ai/dsh-client-ui-model-selection': '模型选择界面（/model 弹出选择）',
    '@deepseek-ai/dsh-client-ui-permission-presets': '权限预设界面（新会话默认权限）',
    '@deepseek-ai/dsh-client-ui-plan': '计划模式输入器控件（/plan 命令）',
    '@deepseek-ai/dsh-client-ui-primitives': 'Web UI 纯 React 原子组件（控件、图标、markdown、JSON 检视器）',
    '@deepseek-ai/dsh-client-ui-settings': '设置域基础插件（命名空间作用域服务）',
    '@deepseek-ai/dsh-client-ui-settings-general': '通用设置与产品引导',
    '@deepseek-ai/dsh-client-ui-settings-models': '模型设置与产品引导对话框',
    '@deepseek-ai/dsh-client-ui-settings-plugin-inventory': 'Web 插件设置中的只读 Loader 清单页',
    '@deepseek-ai/dsh-client-ui-settings-plugins': '插件设置区块（功能页签 + 可配置插件卡片）',
    '@deepseek-ai/dsh-client-ui-sidebar': '侧边栏插件（会话多级树、搜索、分组、状态点）',
    '@deepseek-ai/dsh-client-ui-skill': 'Web 技能引用与技能工具行',
    '@deepseek-ai/dsh-client-ui-slots': 'Slot 注册表纯核心（SlotMap 声明合并）',
    '@deepseek-ai/dsh-client-ui-subagent': '子代理会话目录、延续路由与 "@" 引用',
    '@deepseek-ai/dsh-client-ui-theme': '主题插件（亮/暗/系统状态，DOM 无关 ThemeRuntime）',
    '@deepseek-ai/dsh-client-ui-tool': '客户端工具调用树渲染器',
    '@deepseek-ai/dsh-client-ui-trajectory': '轨迹事件台账与交互式时序总览',
    '@deepseek-ai/dsh-client-ui-user-questions': 'Web 提问功能（主机工具挂载 + 提问 UI）',
    '@deepseek-ai/dsh-client-ui-workflow-run': '持久 workflow 运行对话节点',
    '@deepseek-ai/dsh-client-ui-workspace': '工作区选择器插件（侧边栏 + 空状态槽位）',
    '@deepseek-ai/dsh-client-web': 'Web 外壳内核（bootWebShell 两阶段启动）',
    '@deepseek-ai/dsh-client-web-react': '外壳侧 React 胶水（Slot 渲染器、会话 Provider）',
    '@deepseek-ai/dsh-cmdline': '不可变命令行交接（dsh 启动器 → 应用插件）',
    '@deepseek-ai/dsh-code-runtime': '抽象代码执行抽象层（ctx.codeRuntime）',
    '@deepseek-ai/dsh-code-runtime-worker-thread': '代码执行 worker 线程实现',
    '@deepseek-ai/dsh-command-compact': '面向人的会话压缩斜杠命令',
    '@deepseek-ai/dsh-command-feedback': '仅日志的会话反馈与斜杠命令',
    '@deepseek-ai/dsh-command-goal': '面向人的同会话目标斜杠命令',
    '@deepseek-ai/dsh-commands': '插件拥有的命令注册表',
    '@deepseek-ai/dsh-compaction': '抽象压缩服务抽象层（ctx.compaction）',
    '@deepseek-ai/dsh-compaction-basic': 'token 驱动的压缩策略与 LLM 摘要后端',
    '@deepseek-ai/dsh-compaction-tool-result-pruner': '工具结果节点的免模型裁剪',
    '@deepseek-ai/dsh-cordis-client-runner': '动态双半插件的浏览器半边（事件订阅、闭包求值）',
    '@deepseek-ai/dsh-cordis-host-runner': '动态插件包定义注册表与宿主半边沙箱',
    '@deepseek-ai/dsh-credentials': '抽象凭据抽象层（设置引用密钥、提供商持有值）',
    '@deepseek-ai/dsh-credentials-local': '文件凭据提供器（$DSH_HOME/.env）',
    '@deepseek-ai/dsh-e2b': 'E2B 沙箱共享生命周期（提供商适配器）',
    '@deepseek-ai/dsh-fs': '抽象文件系统能力抽象层（ctx.fs）',
    '@deepseek-ai/dsh-fs-e2b': 'E2B 文件系统实现',
    '@deepseek-ai/dsh-fs-local': '本地文件系统实现',
    '@deepseek-ai/dsh-fs-observation-policy': '文件观察策略（先读后写、版本守卫）',
    '@deepseek-ai/dsh-fs-sandbox': '沙箱文件系统实现（按调用沙箱围栏约束写/编辑）',
    '@deepseek-ai/dsh-goal': '事件源同会话目标状态与生命周期服务',
    '@deepseek-ai/dsh-goal-round-driver': '竞态防护的同会话目标轮次驱动器',
    '@deepseek-ai/dsh-headless': 'dsh 一次性捆绑：无 Host/HTTP/浏览器的直接核心运行器',
    '@deepseek-ai/dsh-home-paths': 'DSH 主目录路径助手',
    '@deepseek-ai/dsh-hook-protocol': 'Claude Code / Codex hook 线协议（匹配器、编解码、多 hook 合并）',
    '@deepseek-ai/dsh-hooks-claude-code': '桥接插件：运行 Claude Code hooks 配置',
    '@deepseek-ai/dsh-hooks-codex': '桥接插件：运行 Codex hooks 配置',
    '@deepseek-ai/dsh-host-apiproxy': 'API 网关：RPC 代理与事件流（会话/模型/设置接口）',
    '@deepseek-ai/dsh-host-directory-picker': '工作区目录选择抽象层（web GUI 宿主）',
    '@deepseek-ai/dsh-host-directory-picker-auto': '目录选择器自适应实现（启动时自动选原生/浏览）',
    '@deepseek-ai/dsh-host-directory-picker-browse': '目录选择的应用内浏览后端',
    '@deepseek-ai/dsh-host-directory-picker-native': '目录选择的原生系统选择器后端',
    '@deepseek-ai/dsh-host-frontend-static': 'Web 外壳 SPA 静态资源服务',
    '@deepseek-ai/dsh-host-plugin-inventory': '当前 Cordis Loader 插件状态的只读远端投影',
    '@deepseek-ai/dsh-host-webserver': 'Web 路由注册插件（HTTP 与升级路由、静态回退）',
    '@deepseek-ai/dsh-invariants': '包所有运行时不变量的注册服务',
    '@deepseek-ai/dsh-jobs': '后台任务注册表（ctx.jobs）：共享 id、拥有者隔离、取消',
    '@deepseek-ai/dsh-jobs-local': '后台任务注册表的进程本地实现',
    '@deepseek-ai/dsh-launch-environment': '不可变启动环境（记录每层来源）',
    '@deepseek-ai/dsh-llm': '提供商无关的 LLM 服务接口',
    '@deepseek-ai/dsh-llm-deepseek': 'DeepSeek chat-completions 适配器',
    '@deepseek-ai/dsh-llm-mock-server': '可脚本化 OpenAI 兼容 HTTP/SSE 故障服务器（LLM 恢复测试）',
    '@deepseek-ai/dsh-llm-pi-ai': 'pi-ai 支持的 DeepSeek 适配器（聚合提供商层）',
    '@deepseek-ai/dsh-llm-replay': '回放 LLM：从录制的会话 JSONL 重建模型输出',
    '@deepseek-ai/dsh-llm-retry': '按提供商路由的 LLM 请求重试策略',
    '@deepseek-ai/dsh-loader-smoke': '无密钥真实 Loader 冒烟测试环境',
    '@deepseek-ai/dsh-lsp': '抽象 LSP 能力抽象层（语言服务器注册表）',
    '@deepseek-ai/dsh-lsp-stdio': '通用 stdio 语言服务器提供器',
    '@deepseek-ai/dsh-mcp-client': 'MCP 客户端桥：连接 MCP 服务器并注册其工具',
    '@deepseek-ai/dsh-message-feedback': '生命周期绑定的消息评分与备注伴生',
    '@deepseek-ai/dsh-native-command': '零依赖无 shell execFile 运行器（原生 OS 集成）',
    '@deepseek-ai/dsh-output-retention': '零依赖有界保留原语（ItemRetainer/TextRetainer）',
    '@deepseek-ai/dsh-permission-presets': '面向用户的权限预设（ctx.permissionPresets）',
    '@deepseek-ai/dsh-persona': '组合撰写的部署角色（persona）区块',
    '@deepseek-ai/dsh-plan-mode': '每 agent 计划模式（斜杠命令 + 用户复核退出）',
    '@deepseek-ai/dsh-pwsh-local': 'PowerShell 执行器本地实现',
    '@deepseek-ai/dsh-pwsh-sandbox': 'PowerShell 执行器沙箱实现',
    '@deepseek-ai/dsh-repeat-tool-reminder': '重复工具调用守卫（循环提醒）',
    '@deepseek-ai/dsh-sandbox': '抽象进程沙箱抽象层（ctx.sandbox）',
    '@deepseek-ai/dsh-sandbox-local': '本地沙箱后端（bwrap、landlock-run、Windows ACL）',
    '@deepseek-ai/dsh-sandbox-policy': '按调用沙箱策略解析器与当前模型上下文',
    '@deepseek-ai/dsh-sandbox-windows-acl': 'Windows ACL 写限制沙箱后端',
    '@deepseek-ai/dsh-schedule': '会话事件日志上的持久定时提醒（after/at/固定频率）',
    '@deepseek-ai/dsh-scope': '作用域上下文注册原语（作用域标签、过滤事件分发）',
    '@deepseek-ai/dsh-sdk-client': 'TypeScript 客户端 SDK（stdio JSON-RPC 驱动子进程运行）',
    '@deepseek-ai/dsh-sdk-jsonrpc-demo': '启动外部 Cordis 配置的 stdio JSON-RPC 演示',
    '@deepseek-ai/dsh-sdk-jsonrpc-server': '进程外 SDK 客户端的 stdio JSON-RPC 服务器插件',
    '@deepseek-ai/dsh-sdk-protocol': 'SDK 运行时共享线协议（换行分隔 JSON-RPC）',
    '@deepseek-ai/dsh-session': '事件源会话存储',
    '@deepseek-ai/dsh-session-checkpoint-policy': '模型请求与工具副作用前的语义持久检查点',
    '@deepseek-ai/dsh-session-log-export': 'Web 会话日志导出命令与下载对话框',
    '@deepseek-ai/dsh-session-persistence': '抽象持久会话存储抽象层',
    '@deepseek-ai/dsh-session-persistence-jsonl': 'JSONL 持久会话存储后端',
    '@deepseek-ai/dsh-session-persistence-sqlite': 'SQLite 持久会话存储后端',
    '@deepseek-ai/dsh-session-projection': '会话投影抽象层（可合并扩展投影类型表）',
    '@deepseek-ai/dsh-session-projection-cache': '持久化投影缓存',
    '@deepseek-ai/dsh-session-query': '组合会话查询服务（读取、轨迹、过滤）',
    '@deepseek-ai/dsh-session-query-sqlite': 'SQLite FTS5 搜索会话查询后端',
    '@deepseek-ai/dsh-session-reference': '跨会话快照引用与不可信模型上下文',
    '@deepseek-ai/dsh-session-stats': '全日志对话计数与耗时投影（sessionStats）',
    '@deepseek-ai/dsh-session-telemetry': '会话遥测后端抽象层（事件采集、投影、脱敏）',
    '@deepseek-ai/dsh-session-telemetry-otel': 'OpenTelemetry 遥测后端',
    '@deepseek-ai/dsh-session-title': '日志支持的会话标题服务与提供器注册表',
    '@deepseek-ai/dsh-session-title-all-prompts-llm': '基于全部用户消息的 LLM 标题提供器',
    '@deepseek-ai/dsh-session-title-first-prompt-llm': '基于首条消息的 LLM 标题提供器',
    '@deepseek-ai/dsh-session-title-llm': '标题生成共享 LLM 策略',
    '@deepseek-ai/dsh-settings': '抽象用户设置抽象层（ctx.settings）',
    '@deepseek-ai/dsh-settings-file': '文件设置提供器（settings.yaml）',
    '@deepseek-ai/dsh-shell': '抽象 bash 执行器抽象层（ctx.shell）',
    '@deepseek-ai/dsh-shell-env': '工具无关的 DSH_* shell 环境注册表',
    '@deepseek-ai/dsh-skill': 'Agent 技能提供器注册表',
    '@deepseek-ai/dsh-skill-badge': '内置 dsh 徽章技能提供器',
    '@deepseek-ai/dsh-skill-filesystem': '本地文件系统技能提供器',
    '@deepseek-ai/dsh-spill': '抽象溢出存储抽象层（超大工具文本）',
    '@deepseek-ai/dsh-spill-local': '本地文件溢出存储实现（会话私有文件）',
    '@deepseek-ai/dsh-spill-policy': '工具结果溢出策略（超大文本 → 保留引用）',
    '@deepseek-ai/dsh-storage': '存储枢纽（ctx.storage）：命名后端注册表',
    '@deepseek-ai/dsh-storage-domain': '域数据形式（schema 校验、事件发射 KV 域）',
    '@deepseek-ai/dsh-storage-json': 'JSON 文件 KV 存储后端',
    '@deepseek-ai/dsh-storage-sqlite': 'SQLite 存储后端（kv 面）',
    '@deepseek-ai/dsh-subagent': '抽象子代理抽象层（委托子 agent 的命名提供器注册表）',
    '@deepseek-ai/dsh-subagent-acp': '进程外 ACP 子代理后端',
    '@deepseek-ai/dsh-subagent-claude-code': 'Claude Code 一次性子代理提供器（官方 Agent SDK）',
    '@deepseek-ai/dsh-subagent-codex': 'Codex 一次性子代理提供器',
    '@deepseek-ai/dsh-subagent-dsh-sdk': '进程外 SDK 子代理后端',
    '@deepseek-ai/dsh-subagent-fork-in-process': '进程内 fork 子代理后端（带前缀日志种子）',
    '@deepseek-ai/dsh-subagent-in-process-driver': '进程内子代理运行驱动器',
    '@deepseek-ai/dsh-subagent-spawn-in-process': '进程内 spawn 子代理后端',
    '@deepseek-ai/dsh-subprocess': '子进程抽象层（管理进程组、有界输出）',
    '@deepseek-ai/dsh-subprocess-e2b': 'E2B 子进程实现',
    '@deepseek-ai/dsh-subprocess-local': '本地子进程实现',
    '@deepseek-ai/dsh-system-prompt': '系统提示词组装注册表',
    '@deepseek-ai/dsh-terminal': '持久 PTY 会话抽象层（拥有者作用域 id、后端注册表）',
    '@deepseek-ai/dsh-terminal-bash': '持久 shell PTY 后端',
    '@deepseek-ai/dsh-time-context': '可选持久每步上下文（当前时间与耗时）',
    '@deepseek-ai/dsh-timeout': '零依赖超时/期限原语',
    '@deepseek-ai/dsh-tmux-context': '可选持久每步上下文（tmux 窗格位置）',
    '@deepseek-ai/dsh-token-meter': '回放感知的 token 计量服务（ctx.tokenMeter）',
    '@deepseek-ai/dsh-tool-ask-user': '面向模型的提问工具（ask_user_question）',
    '@deepseek-ai/dsh-tool-bash': '面向模型的 bash 工具（可选后台任务与沙箱升级）',
    '@deepseek-ai/dsh-tool-bash-persistent': '面向模型的持久 Bash 工具（PTY 服务支撑）',
    '@deepseek-ai/dsh-tool-call-timeout-policy': '工具调用超时策略（按工具期限包装）',
    '@deepseek-ai/dsh-tool-cordis': 'Cordis 工具集：检视实时运行时、挂载/卸载模型编写的插件',
    '@deepseek-ai/dsh-tool-fs': '面向模型的文件系统工具（read/write/edit）',
    '@deepseek-ai/dsh-tool-fs-search': '面向模型的文件发现工具（glob、grep，内置 ripgrep）',
    '@deepseek-ai/dsh-tool-goal': '面向模型的同会话目标工具（执行期权限校验）',
    '@deepseek-ai/dsh-tool-jobs': '面向模型的后台任务控制工具（job_output/list/kill）',
    '@deepseek-ai/dsh-tool-lsp': '面向模型的 lsp 工具（只读、goToDef）',
    '@deepseek-ai/dsh-tool-pwsh': '面向模型的 pwsh 工具（bash 执行器抽象层）',
    '@deepseek-ai/dsh-tool-ralph': '面向模型的 fresh-agent Ralph 循环工具',
    '@deepseek-ai/dsh-tool-session-query': '工作区授权的会话历史搜索/轨迹/事件读取工具',
    '@deepseek-ai/dsh-tool-skill': '面向模型的技能加载工具',
    '@deepseek-ai/dsh-tool-str-replace-editor': '面向模型的视图/创建/字面替换/行插入工具',
    '@deepseek-ai/dsh-tool-subagent': '面向模型的子代理委派工具',
    '@deepseek-ai/dsh-tool-subagent-control': 'send_message / interrupt_agent / list_agents 工具',
    '@deepseek-ai/dsh-tool-subagent-report': '子代理作用域 report 工具',
    '@deepseek-ai/dsh-tool-terminal': '六个面向模型的持久 PTY 工具',
    '@deepseek-ai/dsh-tool-todo': '面向模型的 todo_write 工具',
    '@deepseek-ai/dsh-tool-web': '面向模型的 web 工具（web_search、web_fetch）',
    '@deepseek-ai/dsh-tool-workflow': '面向模型的 workflow 工具（JavaScript 编排脚本）',
    '@deepseek-ai/dsh-tools': '工具注册表与执行管线',
    '@deepseek-ai/dsh-typert-generator': 'TypeScript 项目分析器与 Typert 产物生成器',
    '@deepseek-ai/dsh-typert-loader': '生成的 Typert 包贡献的 Loader 集成',
    '@deepseek-ai/dsh-typert-protocol': '编译器无关的 Remote 元数据与 Typert 提供器协议',
    '@deepseek-ai/dsh-typert-registry': '生成包反射与 Zod schema 的运行时注册表',
    '@deepseek-ai/dsh-user-approval': '用户审批抽象层（一次性权限决策）',
    '@deepseek-ai/dsh-user-questions': '向人类提问的抽象层（agent 运行期间）',
    '@deepseek-ai/dsh-web': '抽象网络能力抽象层（搜索/抓取提供器注册表）',
    '@deepseek-ai/dsh-web-app': 'dsh 浏览器面捆绑（web 补丁层 + 运行时胶水）',
    '@deepseek-ai/dsh-web-fetch-http': '匿名公共 HTTP(S) 抓取提供器',
    '@deepseek-ai/dsh-web-frontend': 'Web 应用入口（vite 构建，dist/ 由 apps/cli 服务）',
    '@deepseek-ai/dsh-web-search-deepseek': 'DeepSeek 搜索提供器（原生 web_search）',
    '@deepseek-ai/dsh-web-search-exa': 'Exa 搜索提供器',
    '@deepseek-ai/dsh-web-search-perplexity': 'Perplexity 搜索提供器',
    '@deepseek-ai/dsh-workflow': 'workflow 能力抽象层（ctx.workflowEngine）',
    '@deepseek-ai/dsh-workflow-worker-thread': 'worker 线程 workflow 引擎（离线执行编排脚本）',
    '@deepseek-ai/dsh-workspace': '工作区实体注册表（持久工作区记录 + 会话挂接校验）',
  };

  async function refreshPluginCatalog() {
    const count = $('#pluginCatalogCount');
    const list = $('#pluginCatalogList');
    const r = await api.getPluginCatalog();
    if (!r.ok) {
      count.textContent = '读取失败';
      list.innerHTML = `<div class="empty">插件目录获取失败：${esc(r.error)}</div>`;
      return;
    }
    catalogAll = r.plugins || [];
    count.textContent = String(catalogAll.length);
    renderPluginCatalog();
  }

  function renderPluginCatalog() {
    const list = $('#pluginCatalogList');
    const q = ($('#pluginSearch').value || '').trim().toLowerCase();
    const filtered = q
      ? catalogAll.filter(
          (p) => p.id.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q) || (PKG_NOTES[p.id] || '').toLowerCase().includes(q)
        )
      : catalogAll;
    const slice = filtered.slice(0, catalogShown);
    const more = $('#pluginCatalogMore');
    more.hidden = filtered.length <= catalogShown;
    more.textContent = `显示更多（${filtered.length - catalogShown}）`;
    list.innerHTML = slice.length === 0
      ? '<div class="empty">没有匹配的插件</div>'
      : slice
          .map(
            (p) => `<div class="pkg-card">
            <div class="pkg-head"><code class="pkg-name">${esc(p.id)}</code>${p.version ? `<span class="pkg-ver">v${esc(p.version)}</span>` : ''}</div>
            <div class="pkg-desc">${esc(PKG_NOTES[p.id] || '（暂无备注，可在代码中补充中文说明）')}</div>
          </div>`
          )
          .join('');
  }

  function bind() {
    $('#providerSelect').addEventListener('change', renderModelGroups);
    $('#refreshModelsBtn').addEventListener('click', refreshModels);
    $('#applyDefaultPresetBtn').addEventListener('click', async () => {
      const sel = $('#defaultPresetSelect');
      const r = await api.setPresetDefault(sel.value);
      if (r.ok) {
        if (window.__modal) window.__modal.alert('已保存默认 Agent 模式：' + sel.selectedOptions[0].textContent, '已保存');
        refreshDefaultPreset();
      } else {
        if (window.__modal) window.__modal.alert('保存失败：' + r.error, '保存失败');
      }
    });
    $('#pluginSearch').addEventListener('input', () => { catalogShown = 40; renderPluginCatalog(); });
    $('#pluginCatalogMore').addEventListener('click', () => { catalogShown += 60; renderPluginCatalog(); });
    $('#openSettingsDocBtn').addEventListener('click', async () => {
      const r = await api.openSettingsDoc();
      if (!r.ok && !r.opened) (window.__modal ? window.__modal.alert('打开配置文档失败：' + (r.error || 'unknown'), '提示') : alert('打开配置文档失败：' + (r.error || 'unknown')));
    });
  }

  function bindModules() {
    document.querySelectorAll('.settings-module-head').forEach((head) => {
      head.addEventListener('click', () => {
        const mod = head.closest('.settings-module');
        const wasOpen = mod.classList.contains('open');
        document.querySelectorAll('.settings-module').forEach((m) => m.classList.remove('open'));
        if (!wasOpen) mod.classList.add('open');
      });
    });
  }

  function init() {
    bind();
    bindModules();
    api.onState((s) => {
      if (s === 'running') {
        refreshPresets();
        refreshDefaultPreset();
        refreshModels();
        refreshPluginNs();
        refreshPluginCatalog();
      }
    });
    api.getStatus().then((st) => {
      if (st.state === 'running' || st.webUp) {
        refreshPresets();
        refreshDefaultPreset();
        refreshModels();
        refreshPluginNs();
        refreshPluginCatalog();
      }
    });
  }

  init();
})();
