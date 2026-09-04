# DSH Desktop v0.7.0 发布说明

基线 v0.6.3 → v0.7.0。分支 `feat/p0-p1-p2-completion`。产物：
`dist/DSH-Desktop-v0.7.0-Setup.exe`（Inno 一键安装，157 MB）、`dist/DSH-Desktop-v0.7.0.zip`（201 MB）。

## 新增功能（P0/P1/P2 缺口补全）

### 对话与渲染
- **工具卡片按宿主展示视图分流**：terminal / diff（LCS 行级比对 + 增删统计 + 新建文件提示）/ search（截断横幅带 total+shown）/ read（行号沟槽）/ web（来源列表 / fetch 状态码）/ generic 兜底；未知 card 值回落通用卡不抛错。
- **Markdown 增强**：代码块高亮（vendored highlight.js）+ 复制按钮 + 语言标签、KaTeX 行内/块级公式（vendored）、任务列表、嵌套列表；修复行内代码双重转义与列表吞并后续内容两个既有 bug。
- **状态事件可见性**：llm 重试进度、上下文压缩、hook、权限/沙箱/审批变更回显、workflow、code-dispatch；其余未分类事件进可开关的「原始事件」抽屉（不再静默丢弃）。
- **上下文面板（context dock）**：Todo 清单、Goal 条（编辑/暂停/恢复/清除，带 CAS）、队列可视化（可撤销单条）、后台任务、本回合产出文件行；Plan 模式芯片。

### 会话管理
- 会话重命名 / 全文搜索（未启用时给降级面板与一键复制配置）/ 分叉 / 右键菜单。
- 工作区重命名 / 删除（带确认，说明只移除分组）/ 分组与会话拖拽排序。
- **会话导出 Markdown**（右键菜单；正文按 user/assistant 分节，工具调用折叠进附录）。

### 子 agent 与轨迹
- **会话透视抽屉**：子 agent 目录树（健康项带 mode/activity/hasChildren，诊断项可读但禁用）、子会话转录、continuable 可中断/续聊；事件轨迹台账（按回合分组）+ 行检查器（seq/时间/token/输入/输出/原始 JSON）。

### 引用与反馈
- **@文件 / @会话 引用**：输入 `@` 弹候选（文件排前、会话排后，各自独立降级），目录可继续下钻，含空格路径自动加引号；语法与引擎 `dsh-file-reference/grammar` 一致。
- **消息赞/踩**：走 `messageFeedback` typert Remote（per-message CAS，version-conflict 回填不自动重试）。

### 桌面产品能力
- 系统通知（回合结束、仅窗口隐藏时、点击聚焦跳转）+ 设置页开关。
- 应用菜单与全套快捷键（Ctrl+K/N/W/,、F5、DevTools）。
- **引擎诊断面板**：应用/Electron/Node/Chromium 版本、端口、服务状态、引擎目录、host.describe（引擎版本/cwd/已挂载会话/canOpenPath）、工具卡降级计数；附「备份 ~/.dsh」「打开开发者工具」。

### 命令面板修复
- 修复 `commands/execute` 漏传必填 `images` 导致**所有斜杠命令静默失败**（与官方 ui-commands 的 `execute(sessionId, line, images=[])` 对齐）。
- 修复同一条命令出现两个重复框（去掉本地乐观气泡，command/run 为唯一渲染源）。
- 需要参数的命令（/goal、/permission、/feedback）选中后填入 `/name ` 待补参数，不再裸执行；面板显示参数占位提示。

### 内置插件商店修复
- 修复一键安装后商店未自动配置：setup.ps1 在捆绑 node 不在固定路径时回退已解析 node（此前整段跳过）；应用启动引擎就绪后自动跑一次 marketEnsure 自我配置。
- 插件安装/更新/卸载/启停后提示「已直接生效」或「需重启生效」，需重启时确认后自动重启 Harness。

## 跨平台（Phase 3）
- 路径可移植化：`resolveDshRoot()`（win=%LOCALAPPDATA%\DSH、mac=~/Library/Application Support/DSH、linux=$XDG_DATA_HOME/DSH）、`resolveNodeExe()` 按平台取 node 二进制。
- POSIX 引导：`installer/setup.sh`（zip 优先→镜像多跳→git clone 兜底→corepack pnpm 构建）、`check-env.sh`、`dsh.desktop`。
- electron-builder 配置（mac dmg+zip arm64/x64、linux AppImage+deb）+ `.github/workflows/release.yml` 三平台矩阵。
- `.gitattributes` 强制 `.sh`/`.desktop` 用 LF（避免 CRLF 破坏 shebang）。
- 冒烟测试跨平台化（Electron 路径与进程清理按平台解析）。

## 验证
- 静态门：`node --check` 全部受版控 JS、`check-encoding.ps1`（92 文件）、`bash -n` POSIX 脚本。
- 回放层：`scripts/smoke-renderer.cjs` 以 DSH_DEV_INSTANCE 启动真实 Electron 走 CDP，对活引擎真实历史验证全部渲染面 + 三组 typert 只读探针 + RPC 桥暴露面 + 启动无错误。
- 实时层（改文件验 diff、派子 agent、排队、通知等）需人工在场执行，见计划文档 Phase 4 清单。

## 已知限制
- macOS/Linux 产物由 CI runner 产出验证，Windows 本地无法验证。
- 引擎自动升级/回滚、quick-ask 全局浮窗暂缓（见计划文档「明确缓做」）。
- 存量中文 i18n 全量抽取（0.2b）未完成：新增文案已全部走 t()（246 键中英对齐），存量硬编码待抽取，语言切换入口在其完成后暴露。
