/**
 * 简体中文语言包 —— 唯一真值源。
 *
 * 键名用 `域.动作` 或 `域.动作.细节` 分层，与功能轨道对应，便于抽取与查漏。
 * 占位符统一 `{name}` 形式，由 t(key, params) 替换。
 * 存量界面文案的抽取见 Phase 0.2b；本文件当前只含新增功能的键。
 */
window.__dshLocales = window.__dshLocales || {};
window.__dshLocales['zh-CN'] = {
  // ---- 会话行右键菜单 / 行内操作 ----
  'session.action.rename': '重命名',
  'session.action.fork': '从此处分叉',
  'session.action.delete': '删除',
  'session.action.showInFolder': '在文件夹中显示',
  'session.showInFolder.noCwd': '该会话没有记录工作目录',

  // ---- 会话行标记 ----
  'session.blank.title': '空白新会话',
  'session.blank.badge': '新',
  'session.running': '运行中',
  'session.delete.title': '删除该历史会话',
  'session.list.empty': '暂无会话',
  'session.list.emptyHint': '点击「＋ 新会话」开始',

  // ---- 工作区分组 ----
  'workspace.unnamed': '未命名工作区',
  'workspace.ungrouped': '未分组',

  // ---- 重命名 ----
  'session.rename.empty': '名称不能为空',
  'session.rename.failed': '重命名失败：{error}',

  // ---- 全文搜索 ----
  'session.search.placeholder': '搜索会话内容…',
  'session.search.clear': '清除搜索',
  'session.search.empty': '没有匹配的会话',
  'session.search.truncated': '结果已截断（最多 {n} 个会话），请细化关键词',
  'session.search.failed': '搜索失败：{error}',
  'session.search.resultCount': '{n} 个会话命中',
  'session.search.disabled.title': '全文搜索未启用',
  'session.search.disabled.body': '会话全文搜索是引擎侧的可选能力，默认关闭，桌面端无法从界面打开。把下面这段追加到 ~/.dsh/profiles/web/cordis.patch.yml（替换文件里现有的空数组 []），保存后重启 Harness 即可生效。',
  'session.search.disabled.copy': '复制配置片段',
  'session.search.disabled.copied': '已复制',
  'session.search.disabled.copyFailed': '复制失败，请手动选中',

  // ---- 分叉 ----
  'session.fork.menuTitle': '从最后一个已完成的回合分叉出一个新会话，原会话不受影响',
  'session.fork.done': '已从「{title}」分叉出新会话',
  'session.fork.unavailable': '该会话还没有完成的回合，无法分叉',
  'session.fork.notFound': '会话不存在或已被删除',
  'session.fork.failed': '分叉失败：{error}',

  // ---- Markdown 代码块 ----
  'md.copy': '复制',
  'md.copied': '已复制',
  'md.copyFailed': '复制失败',

  // ---- 打开路径（host.openPath，受 canOpenPath 门控）----
  'host.openPath.failed': '打开失败：{error}',
  'host.openPath.unavailable': '当前引擎部署不支持从界面打开本地路径',

  // ---- 工具卡片：状态 ----
  'tool.card.pending': '调用中…',
  'tool.card.done': '✓ 完成',
  'tool.card.error': '⚠ 出错',
  'tool.card.noOutput': '（无输出）',
  'tool.card.output': '查看输出（{n} 字符）',
  'tool.card.outputFull': '展开全部（{n} 字符）',
  'tool.card.outputCollapse': '收起',
  'tool.card.rawInput': '查看入参',
  'tool.card.openFile': '打开',

  // ---- 工具卡片：terminal ----
  'tool.card.exit': 'exit {code}',
  'tool.card.signal': '被信号 {signal} 终止',

  // ---- 工具卡片：diff ----
  'tool.card.newFile': '新建文件（无原内容可比对）',
  'tool.card.diffTooLarge': '文件过大（{old} 行 → {new} 行，逐行比对上限 {cap} 行），已改为显示新内容全文',
  'tool.card.diffGap': '⋯ {n} 行未改动 ⋯',

  // ---- 工具卡片：search ----
  // 契约要求不能把截断结果当完整结果呈现，所以截断时必须同时给出总数与已显示数
  'tool.card.searchTotal': '共 {total} 处命中',
  'tool.card.searchTruncated': '共 {total} 处命中，已截断显示 {shown} 处',
  'tool.card.searchFileCount': '{n} 处',
  'tool.card.pathsTotal': '共 {total} 个路径',
  'tool.card.pathsTruncated': '共 {total} 个路径，已截断显示 {shown} 个',

  // ---- 工具卡片：read ----
  'tool.card.readRange': '第 {from}–{to} 行 / 共 {total} 行',

  // ---- 工具卡片：web ----
  'tool.card.webSources': '{n} 个来源',
  'tool.card.webSourcesTruncated': '{n} 个来源（已按上限截断）',
  'tool.card.fetchTruncated': '内容已截断',

  // ---- 通用 ----
  'common.save': '保存',
  'common.cancel': '取消',

  // ---- 上下文面板：Todo ----
  'panel.todo.title': '任务清单',
  'panel.todo.progress': '已完成 {done} / {total}',

  // ---- 上下文面板：Goal ----
  'panel.goal.title': '当前目标',
  'panel.goal.meta': '阶段 {phase} · 第 {round} / {max} 轮',
  'panel.goal.blocked': '受阻：{reason}',
  'panel.goal.edit': '编辑',
  'panel.goal.pause': '暂停',
  'panel.goal.resume': '继续',
  'panel.goal.complete': '标记完成',
  'panel.goal.clear': '清除',
  'goal.phase.active': '进行中',
  'goal.phase.paused': '已暂停',
  'goal.phase.blocked': '受阻',
  'goal.phase.complete': '已完成',
  'goal.actionFailed': '{op}目标失败：{error}',
  'goal.edit.title': '编辑目标',
  'goal.edit.label': '目标描述（Ctrl+Enter 保存，Esc 取消）',
  'goal.edit.empty': '目标描述不能为空',

  // ---- 上下文面板：队列 ----
  'panel.queue.title': '待处理消息（{n}）',
  'queue.placement.queued': '排队',
  'queue.placement.steering': '插话',
  'queue.action.steer': '提前',
  'queue.action.steerHint': '把这条排队的消息改为插话，直接转向当前回合',
  'queue.action.remove': '撤销',
  'queue.actionFailed': '队列操作失败：{error}',
  'queue.item.nonText': '（{n} 个非文本内容块）',

  // ---- 上下文面板：后台任务 ----
  'panel.jobs.title': '后台任务',
  'panel.jobs.titleActive': '后台任务（{n} 个运行中）',
  'job.status.running': '运行中',
  'job.status.stopping': '停止中',
  'job.status.completed': '已完成',
  'job.status.killed': '已终止',
  'job.status.failed': '失败',

  // ---- 上下文面板：产出文件 ----
  'panel.files.title': '本回合产出的文件（{n}）',
  'panel.files.more': '+{n} 个文件',
  'panel.files.showInFolder': '在文件夹中显示',

  // ---- Plan 模式 ----
  'plan.chip': '计划中 ✕',
  'plan.chipHint': '计划模式已开启，点击退出',
  'plan.placeholder': '描述你的任务以生成计划…',
  'plan.exitFailed': '退出计划模式失败：{error}',

  // ---- 状态事件可见性 ----
  // 重试提示要让用户明白界面没坏、是在等上游，此前这里只是静默卡住
  'event.retry': '{provider} 请求失败，{attempt}，{seconds}s 后重试…',
  'event.retry.attempt': '第 {n}/{max} 次重试',
  'event.retry.attemptNoMax': '第 {n} 次重试',
  'event.compaction.start': '上下文压缩开始…',
  'event.compaction.summary': '上下文已生成压缩摘要',
  'event.compaction.end': '上下文压缩完成',
  'event.compaction.prune': '已裁剪较早的工具结果以腾出上下文',
  'event.hook.invoked': '触发 hook：{name}',
  'event.hook.result': 'hook 返回：{name}',
  // 权限/沙箱/审批策略变更必须回显：静默改权限是安全问题
  'event.permission.changed': '权限预设已变更为「{value}」',
  'event.sandbox.changed': '沙箱模式已变更为「{value}」',
  'event.approval.changed': '审批策略已变更为「{value}」',
  'event.agentPreset.changed': 'Agent 模式已切换为「{value}」',
  'event.subagent.descriptor': '子 agent：{name}',
  'event.workflow.runStart': '工作流开始：{name}',
  'event.workflow.runEnd': '工作流结束：{name}',
  'event.workflow.agent': '工作流成员 {phase} {name}',
  'event.codeDispatch': 'Code Mode 派发',
  'event.streamError': '事件流错误：{error}',

  // ---- 原始事件调试抽屉 ----
  'raw.toggle': '原始事件',
  'raw.drawerTitle': '原始事件（未单独渲染的事件类型，排查用）',
  'raw.empty': '本会话暂无未分类事件',

  // ---- 轨道 F：工作区管理 ----
  'workspace.action.rename': '重命名工作区',
  'workspace.action.delete': '删除工作区',
  'workspace.action.showInFolder': '在文件夹中显示',
  'workspace.more': '工作区操作',
  'workspace.rename.empty': '工作区名称不能为空',
  'workspace.rename.failed': '重命名工作区失败：{error}',
  'workspace.nameConflict': '已有同名工作区',
  'workspace.delete.confirm': '删除工作区「{title}」？\n\n仅从列表移除这个分组：磁盘上的目录、文件与会话历史都不会被删除，其中的会话会变为「未分组」。',
  'workspace.delete.okText': '删除工作区',
  'workspace.delete.failed': '删除工作区失败：{error}',
  'workspace.delete.done': '已删除工作区「{title}」',
  'workspace.move.failed': '调整顺序失败：{error}',
  'workspace.noPath': '该工作区没有记录目录路径',

  // ---- 轨道 F：消息反馈（赞 / 踩）----
  'feedback.like': '有帮助',
  'feedback.dislike': '无帮助',
  'feedback.liked': '已标记为有帮助',
  'feedback.disliked': '已标记为无帮助',
  'feedback.remove': '撤销评价',
  'feedback.removed': '已撤销评价',
  'feedback.notePlaceholder': '补充说明（可选，Ctrl+Enter 提交）',
  'feedback.notePrompt': '补充说明',
  'feedback.failed': '提交反馈失败：{error}',
  'feedback.conflict': '该消息的评价已被更新，已同步为最新状态',
  'feedback.unavailable': '当前会话暂不支持消息评价',

  // ---- 轨道 F：@文件 / @会话 引用 ----
  'ref.fileSection': '文件',
  'ref.sessionSection': '会话',
  'ref.empty': '无匹配项',
  'ref.loading': '加载中…',
  'ref.hint': '↑↓ 选择 · Tab/Enter 插入 · Esc 关闭',

  // ---- 轨道 F：Agent 预设 copy / remove ----
  'preset.copy': '复制为新预设',
  'preset.copy.title': '复制预设',
  'preset.copy.idLabel': '新预设 ID（小写字母 / 数字 / 连字符）',
  'preset.copy.nameLabel': '显示名称（可选）',
  'preset.copy.done': '已复制为「{id}」，可在预设文件中继续编辑',
  'preset.copy.failed': '复制预设失败：{error}',
  'preset.copy.idEmpty': '请填写新预设 ID',
  'preset.copy.notAuthorable': '当前引擎部署没有可写的预设目录，无法新建预设',
  'preset.remove': '删除预设',
  'preset.remove.confirm': '删除自建预设「{id}」？此操作不可撤销。',
  'preset.remove.okText': '删除预设',
  'preset.remove.builtin': '内置预设不可删除',
  'preset.remove.done': '已删除预设「{id}」',
  'preset.remove.failed': '删除预设失败：{error}',

  // ---- 轨道 E：会话透视（子 agent 目录 / 事件轨迹）----
  'inspect.toggle': '透视',
  'inspect.title': '会话透视（子 agent 目录 · 事件轨迹）',
  'inspect.tab.subagent': '子 agent',
  'inspect.tab.trajectory': '轨迹',

  'subagent.loading': '加载中…',
  'subagent.empty': '本会话没有子 agent',
  'subagent.listFailed': '子 agent 目录获取失败：{error}',
  'subagent.mode.oneShot': '一次性',
  'subagent.mode.continuable': '可续聊',
  'subagent.activity.running': '运行中',
  'subagent.activity.inactive': '空闲',
  'subagent.hasChildren': '含下级子 agent',
  'subagent.diagnostic.corrupt': '记录损坏，无法读取',
  'subagent.diagnostic.unsupported': '引擎版本不支持该子会话',
  'subagent.diagnostic.unavailable': '子会话暂不可用',
  'subagent.viewTranscript': '查看转录',
  'subagent.back': '← 返回目录',
  'subagent.interrupt': '中断',
  'subagent.interruptDone': '已请求中断（子 agent 可能短暂仍显示运行中）',
  'subagent.interruptFailed': '中断失败：{error}',
  'subagent.prompt': '续聊',
  'subagent.promptPlaceholder': '向该子 agent 发送消息…（Enter 发送）',
  'subagent.promptSent': '已投递到子 agent 收件箱',
  'subagent.promptFailed': '续聊失败：{error}',
  'subagent.historyFailed': '转录读取失败：{error}',
  'subagent.historyEmpty': '（无转录内容）',
  'subagent.parentUnavailable': '父会话当前不可用，续聊与中断可能失败',
  'subagent.readOnly': '一次性子 agent 为只读执行记录',

  'trajectory.empty': '本会话暂无事件轨迹',
  'trajectory.turn': '回合 {n}',
  'trajectory.noTurn': '回合外事件',
  'trajectory.rows': '{n} 条事件',
  'trajectory.inspectorHint': '点击左侧事件查看详情',
  'trajectory.seq': '序号',
  'trajectory.type': '类型',
  'trajectory.time': '时间',
  'trajectory.tokens': 'tokens',
  'trajectory.duration': '耗时',
  'trajectory.input': '输入',
  'trajectory.output': '输出',
  'trajectory.detail': '详情',
};
