# DeepSeek Harness 桌面端（DSH Desktop）

基于 Electron 的 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) 桌面端 UI——「深空观测站」。

用一套星际主题界面把 harness 的 Web 服务（`pnpm dsh web`）封装成桌面应用：一键启停、实时日志、会话对话、使用统计、GitHub 仓库浏览，以及完整的**工作区**支持。

## 功能

- **一键启停**：自动启动 / 接管 `pnpm dsh web`（`:3080`），无需命令行
- **实时信号流**：harness 启动日志实时滚动查看
- **星际对话**：并发会话、流式输出、模型选择、思考等级、图片粘贴发送
- **工作区**：
  - 左侧历史会话按工作区分组（分组可折叠，未归属会话归入「未分组」）
  - 「＋ 新会话」可选择电脑上的任意文件夹作为工作区（原生目录选择器）
  - 工具栏工作区菜单：筛选视图 / 添加工作区
- **星图档案**：会话数据目录浏览
- **GitHub 侧边栏**：SSH 密钥连接（`git@github.com`），添加仓库 / 分支 / 文件树浏览
- **MCP / 技能**：harness 组合文件中的 MCP 服务器与技能列表
- **设置**：主题（深空 / 极光 / 彗星金 / 自定义）、Agent preset、模型配置、API 密钥管理
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


## 一键安装包（发行版）

运行 `scripts/build-dist.ps1` 生成小体积安装器（引擎不打包、不托管）：

- `dist/DSH-Desktop-v<版本>.zip` 与自解压 `DSH-Desktop-v<版本>-Setup.exe`：仅桌面端 UI + Electron 运行时 + 一键安装器（约 220MB，与普通 Electron 应用相当）；
- Harness 引擎不在安装包内：安装时由安装器从官方源自动拉取（`deepseek-ai/DeepSeek-Harness` 源码 + nodejs.org 官方 Node），在本机完成依赖安装与构建（一次性）。

使用者：双击 `Setup.exe`（或解压 zip 后运行 `setup.bat`）→ 自动安装到 `%LOCALAPPDATA%\DSH`、
写入 `~/.dsh/settings.yaml`（首次安装，不覆盖已有配置）、从官方拉取并构建 Harness 引擎、创建桌面快捷方式。
网络受限时可用 `-NpmRegistry https://registry.npmmirror.com` 指定 npm 镜像，或 `-SkipHarness` 跳过引擎（之后手动配置 `DSH_HARNESS_DIR`）。
安装包不含任何 API 密钥；模型密钥在应用「设置 → 模型」填写，GitHub 用 SSH 密钥连接。

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
