# DeepSeek Harness 桌面端（DSH Desktop）

基于 Electron 的 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) 桌面端 UI——「深空观测站」。

> 当前版本：**v0.4.0**

用一套星际主题界面把 harness 的 Web 服务（`pnpm dsh web`）封装成桌面应用：一键启停、实时日志、会话对话、使用统计、GitHub 仓库浏览，以及完整的**工作区**支持。

## v0.4.0 更新日志

- **更新即装即用**：应用内"一键更新"下载完成后，自动运行安装包、关闭旧版并启动新版——不再需要手动解压 / 删除旧目录；配置、会话、引擎均保留在 `%LOCALAPPDATA%\DSH` 与 `~/.dsh`，更新后重启即最新版。
- **首次配置引导**：检测到未配置任何模型 / API 密钥时，模型配置页顶部显示引导卡（推荐 DeepSeek 官方 API，并提供其它提供商入口），引导用户先配置模型。
- **OpenCode Zen 免费模型 429 修复**：设置 → 模型 → opencode 卡片新增「⚡ 免费模型（UA 代理）」——一键启用本地 UA 重写代理（127.0.0.1:8790 → opencode.ai/zen,UA 改写为 opencode/0.1.0），解决免费模型 deepseek-v4-flash-free 因 DSH 归因 UA 被识别为非官方客户端而返回 429 FreeUsageLimitError 的问题；同时写好开机自启。
- **更新体验**：更新进度显示实时速率（MB/s）与命中镜像；下载期间按钮禁用，防止重复点击重置下载；优先走国内加速镜像（ghfast.top / ghproxy.net / gh-proxy.com / gh.ddlc.top），失败自动回源 GitHub。
- **打包修复**：`frontend dist not built` 已修复——引擎安装时使用捆绑 Node 工具链并强制校验 web 前端 dist，缺失自动补 `build:web`；安装包内置便携 Node，目标机器无需任何 Node 环境。

## v0.3.1 更新日志

- **原生插件市场**：发现 / 已安装 / 主题 / 备份恢复页面
- **会话压缩插件**：compact 工具 + 输入栏压缩按钮
- **权限审批卡片可视化**、修复确认弹窗按钮文案
- **引擎升级 rc.8**、捆绑工具链构建、强制校验 web 前端 dist
- **修复**：`.env` 不再注入 harness 环境（凭据服务恢复可写）；紫月主题缺视频修复

## v0.2.1 更新日志

- **对话界面排版**：助手回答按 Markdown 渲染（标题 / 粗体 / 斜体 / 行内代码 / 代码块 / 列表 / 表格 / 链接 / 引用 / 分隔线），流式打字期间保持纯文本、完成后一键排版，向 webUI 看齐。
- **工具调用卡片化**：每次工具调用渲染为一张可折叠卡片（`🔧 名称 ✓ 完成`），按 `callId` 配对、重复投递不重复堆叠；修复此前"每次 call/result 各占一行、结果无名字显示成 `🔧 tool`"的重复乱序问题。卡片含可展开的工具输出与 exit code。
- **模型编辑面板（webUI 同款）**：已启用的提供商卡片现在也显示「编辑提供商配置 / 删除提供商」；编辑面板顶部含 **API 密钥（改 key）** 区块（已配置——输入新值可替换、测试连接），`自定义设置`可折叠，内含 API 协议（**从 schema 动态枚举**，不硬编码）、API 地址（提供方默认/自定义）、模型目录（添加模型 / 获取可用模型 / 删除模型）。
- **工具栏精简**：推理强度、权限预设、发送模式（排队/插话）从平铺分段按钮改为紧凑下拉选择框，风格统一。
- **模型面板状态提示**：未打开会话时提示"请先打开或新建一个会话"，加载中/加载失败显示真实原因，不再误导显示"未连接 harness"。

## v0.2.0 更新日志

- **发送模式**：对话工具栏新增「排队 / 插话」切换（对应 Web UI 的 busy Enter 偏好）。排队 = agent 忙时自动排队跟进；插话 = 直接向正在运行的回合插入指令（`session.prompt mode: steer`）。偏好本机记忆，并尽量与 Web 端 `ui-conversation.busyEnter` 同步。
- **模型管理增强**：提供商配置卡片新增「编辑提供商配置」（API 协议 / baseURL / 模型列表增删）与「删除提供商」（仅限用户在此应用里新增的提供商，同时清理其 API 密钥引用）。
- **修复消息重复渲染**：聊天窗口偶发"用户消息 / 思考过程出现两个框"的问题。补上 mux `session/subscribed` 重同步、按消息身份去重、流式增量补全，重连/切换会话不再产生重复气泡。
- **修复检查更新 401**：此前 `~/.dsh/.github-token` 一旦存了失效令牌会导致更新检查报 `GitHub API 401`。现在会自动检测无效令牌格式并在 401/403 时清除后改用匿名检查。
- **隐私修复**：安装包不再打包开发者本机的 `~/.dsh/settings.yaml` / `zen-ua-proxy.mjs`。发行版默认配置改为仓库内置的纯净模板（`config/settings.yaml`），不会把开发者的模型路由 / 提供商 / 密钥引用泄露给使用者。
- **一键安装 / 引擎自动获取**：安装器新增环境预检（`check-env.ps1`），首次启动自动探测本机 Node.js；缺失或版本过低时**优先用 winget 安装最新 Node LTS**，失败再回退官方 zip 下载，环境合格后才拉取 harness 引擎（详见上文"快速开始"）。

## 功能

- **一键启停**：自动启动 / 接管 `dsh web`（`:3080`），无需命令行
- **实时信号流**：harness 启动日志实时滚动查看（含引擎自动获取、环境预检进度）
- **星际对话**：并发会话、流式输出、模型选择、思考等级、图片粘贴发送、**排队/插话发送模式**
- **工作区**：
  - 左侧历史会话按工作区分组（分组可折叠，未归属会话归入「未分组」）
  - 「＋ 新会话」可选择电脑上的任意文件夹作为工作区（原生目录选择器）
  - 工具栏工作区菜单：筛选视图 / 添加工作区
- **星图档案**：会话数据目录浏览
- **GitHub 侧边栏**：SSH 密钥连接（`git@github.com`），添加仓库 / 分支 / 文件树浏览
- **MCP / 技能**：harness 组合文件中的 MCP 服务器与技能列表
- **设置**：主题（深空 / 极光 / 彗星金 / 自定义）、Agent preset、模型配置（含提供商编辑/删除）、API 密钥管理、软件更新检查
- **动态星空背景**：星空粒子 + 星云动画主题

## 快速开始

前置要求：

- Node.js ≥ 18（含 npm）（没有也可运行，桌面端会自动在 `%LOCALAPPDATA%\DSH\tools\node` 安装官方 Node）
- Harness 引擎：**不需要手动准备**。点击应用内「启动 Harness」时自动探测本机已有的引擎（按优先级：环境变量 `DSH_HARNESS_DIR` → `%LOCALAPPDATA%\DSH\harness` 源码目录 → 与 app 同级的 harness → npm 全局安装的 `@deepseek-ai/dsh` → npx 缓存里的官方发行版），找到即直接启动；找不到则自动获取（先尝试 npm 官方发行包，失败则运行 `installer/setup.ps1 -EngineOnly` 拉取官方源码并构建，一次性）。也可手动用 `npx @deepseek-ai/dsh web` 先启动，桌面端会自动接管 `:3080` 已运行的实例。
- 可选：`pnpm`（仅源码构建流程需要）

### 一键 setup（开发，推荐）

克隆本仓库后，运行对应平台的 setup 脚本——自动检查 Node.js（≥ 18）、按 `package-lock.json`
锁定版本安装依赖，最后给出启动与打包指引：

```sh
# Windows（PowerShell）
.\setup.ps1

# macOS / Linux
./setup.sh
```

也可以手动执行（与脚本等效）：

```sh
npm ci      # 或 npm install
npm start
```

## 目录结构

```
main.js             Electron 主进程：harness 启停、对话/工作区/设置 RPC 桥、GitHub 与原生目录选择器
preload.js          渲染进程安全桥（contextBridge）
renderer/           渲染层（原生 HTML/JS/CSS）
  index.html        页面骨架（仪表盘 / 对话 / 日志 / 结果 / 设置）
  chat.js           对话页：并发会话、流式渲染、工作区分组与选择
  app.js            页面切换与全局状态
  dashboard.js      仪表盘：服务状态与使用统计
  dock.js           侧边栏：GitHub / MCP / 技能
  settings.js       设置页
  styles.css        星际主题样式
  starfield.js      星空背景粒子
  bg-animated.mp4   动态星云背景（可选删减，删除后回落为静态背景）
```

## 说明

- GitHub 连接使用本机 SSH 密钥（`git@github.com`），仅在 `~/.dsh/.github-ssh.json` 记录密钥路径与登录名，不保存密钥材料；仓库浏览通过 git over SSH 完成。22 端口不通时自动回退 `ssh.github.com:443`（SSH over HTTPS）。
- GitHub 请求使用 Electron `net.fetch`（系统证书库），兼容本地 TLS 拦截环境。
- 对话会话数据与工作区注册表由 harness 持久化在 `~/.dsh/` 下，桌面端本身不存业务数据。
- 动态背景视频约 45MB；不需要动画背景时可直接删除 `renderer/bg-animated.mp4`。
- **隐私**：发行版不携带任何开发者的个人配置（模型路由、API 密钥、`~/.dsh` 文件都不会进安装包）。首次安装写入的 `~/.dsh/settings.yaml` 来自仓库内置纯净模板，用户已有配置永不被覆盖。
- **更新检查令牌**：如需用私有令牌提高 GitHub API 配额，可把有效 PAT 放到 `~/.dsh/.github-token`；失效令牌会被自动识别并清除，不影响匿名检查。


## 一键安装包（发行版）

运行 `scripts/build-dist.ps1` 生成小体积安装器（引擎不打包、不托管）：

- `dist/DSH-Desktop-v<版本>.zip` 与自解压 `DSH-Desktop-v<版本>-Setup.exe`：仅桌面端 UI + Electron 运行时 + 一键安装器（约 220MB，与普通 Electron 应用相当）；
- Harness 引擎不在安装包内：安装时由安装器从官方源自动拉取（`deepseek-ai/DeepSeek-Harness` 源码 + nodejs.org 官方 Node），在本机完成依赖安装与构建（一次性）。

### 下载加速（国内用户）

GitHub Releases 直连在国内可能较慢，可用以下任一方式：

- **应用内更新**：v0.2.1 起「设置 → 检查更新 → 下载」会自动按 **加速镜像优先 → GitHub 官方回源** 的顺序下载（内置 ghfast.top / ghproxy.net / gh-proxy.com / gh.ddlc.top），无需手动处理。
- **手动下载加速链**：把官方下载链接前面拼上镜像前缀即可。例如官方链接
  `https://github.com/sayzwx/DSH-desktop/releases/download/v0.3.1/DSH-Desktop-v0.3.1-Setup.exe`，
  加速后为
  `https://ghfast.top/https://github.com/sayzwx/DSH-desktop/releases/download/v0.3.1/DSH-Desktop-v0.3.1-Setup.exe`
  （`ghfast.top` / `ghproxy.net` / `gh-proxy.com` / `gh.ddlc.top` 均可，任选其一）。

> 镜像为第三方加速服务，若某天不可用，请回退 GitHub 官方直链或换其它镜像。

使用者：双击 `Setup.exe`（或解压 zip 后运行 `setup.bat`）→ 自动安装到 `%LOCALAPPDATA%\DSH`、
写入纯净的默认 `~/.dsh/settings.yaml`（首次安装，不覆盖已有配置）、从官方拉取并构建 Harness 引擎、创建桌面快捷方式。
安装器内置环境预检：Node.js 缺失或版本过低时**优先用 winget 安装最新 LTS**，winget 不可用则下载官方 Node 到 `%LOCALAPPDATA%\DSH\tools\node`。
网络受限时可用 `-NpmRegistry https://registry.npmmirror.com` 指定 npm 镜像，或 `-SkipHarness` 跳过引擎（之后手动配置 `DSH_HARNESS_DIR`）。
安装包不含任何 API 密钥及个人配置；模型密钥在应用「设置 → 模型」填写，GitHub 用 SSH 密钥连接。

## 编码约定（全局防线）

本项目约定所有文本文件为 UTF-8，避免中文乱码 / 脚本解析崩溃：

| 类型 | 规则 | 原因 |
|---|---|---|
| `.ps1` | UTF-8 **带 BOM** | Windows PowerShell 5.1 对无 BOM 文件按 ANSI/GBK 解析，中文字节可能混入引号字节导致语法崩溃 |
| `.txt` | UTF-8 **带 BOM** | 中文 Windows 记事本把无 BOM 的 UTF-8 当 ANSI 显示，用户看到乱码 |
| `.bat` / `.cmd` | 无 BOM（内容最好纯 ASCII） | cmd 会把 BOM 字节当命令执行报错 |
| 其余文本（`.js .json .md .yml ...`） | UTF-8 无 BOM | Node/JSON 对 BOM 敏感 |

强制手段：
- `scripts\check-encoding.ps1`：仓库级审计（`-Fix` 自动补/去 BOM）；
- `scripts\build-dist.ps1`：打包前强制执行，不过不放行；
- `.github\workflows\encoding-check.yml`：每次 push / PR 自动检查；
- `.gitattributes`：统一行尾（CRLF/LF）与二进制标记。

新增或编辑文本文件后，运行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-encoding.ps1 -Fix` 即可自检自愈。
