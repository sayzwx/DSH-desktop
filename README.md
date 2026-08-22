# DSH Desktop

DeepSeek Harness 的 Windows 桌面端外壳——零环境安装，装完即用。

## Download

从 [GitHub Releases](https://github.com/sayzwx/DSH-desktop/releases) 下载最新版：

- **Setup.exe（推荐）**：双击 → 选择安装目录 → 环境预检 → 安装 → 自动拉取 Harness 引擎 → 建快捷方式 → 启动应用。装完即可直接用，无需任何 Node.js 环境。
- **zip**：解压后以管理员身份运行 `setup.bat`。

应用启动后自动检查更新（每 6 小时一次），更新包经国内加速镜像下载，完成后一键重启升级。

> 国内下载加速：官方链接前加镜像前缀，如 `https://ghfast.top/https://github.com/sayzwx/DSH-desktop/releases/download/v0.6.1/DSH-Desktop-v0.6.1-Setup.exe`

## Community

遇到问题或想交流，欢迎通过 [GitHub Issues](https://github.com/sayzwx/DSH-desktop/issues) 反馈与讨论。

## Why this project exists

DeepSeek Harness 已提供完整的 Agent 运行时与 Web UI。DSH Desktop 不重新实现 Harness，而是补齐桌面产品所需的宿主能力：

- 无需手动启动 CLI 或记忆端口/命令，一键启停 `dsh web`（`:3080`）
- 零环境安装：安装包内置便携 Node，目标机器不需要任何 Node.js/npm/pnpm
- 引擎自动获取：安装时自动拉取官方 Harness 源码并构建，失败有日志与保底手动指引
- 关闭窗口不中断：最小化到托盘，服务后台常驻，再次打开自动接管

## Features

- 一键启动 / 停止 / 接管 Harness（Web 界面 http://127.0.0.1:3080）
- 实时显示 harness 启动日志与引擎获取进度
- 并发会话、流式输出、Markdown 排版、模型选择与思考等级
- 工作区支持：会话按文件夹分组，原生目录选择器
- GitHub 仓库浏览（SSH 密钥连接，22 端口失败自动回退 443）
- 模型配置：30+ 内置提供商 + 自定义提供商（OpenAI / Anthropic 兼容端点）
- 插件市场（dsh-market）开箱即连
- 原生插件管理：MCP / 技能 / Agent 预设
- 系统托盘：显示主窗口 / 启停 Harness / 退出

## Friends

- [DeepSeek-Harness](https://github.com/deepseek-ai/DeepSeek-Harness) — 引擎本体：DeepSeek 官方 Agent 运行时与 Web UI
- [dsh-market](https://github.com/dsh-market/dsh-market) — Harness 插件市场：浏览与搜索社区插件

## Quick start

### Requirements

- Windows x64（Windows 10 / 11）
- 无需 Node.js（安装包内置便携 Node 22）

### 用户安装

下载 `Setup.exe` 双击即可，详见 [Download](#download)。

### Local development

```sh
git clone https://github.com/sayzwx/DSH-desktop.git
cd DSH-desktop
npm install
npm start
```

`npm start` 以开发模式启动（`electron .`）。开发模式下引擎仍需本机有 Node ≥ 22（或点击应用内「启动 Harness」自动获取）。

### Quality checks

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-encoding.ps1
```

编码防线：所有文本文件 UTF-8（`.ps1/.txt` 带 BOM，`.bat/.cmd` 无 BOM，其余无 BOM），打包前自动强制检查。

### Packaging

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-dist.ps1 -Version 0.6.0
```

产出 `dist\DSH-Desktop-v0.6.1.zip` 与 `DSH-Desktop-v0.6.1-Setup.exe`（Inno Setup 一键安装向导）。引擎不打包进安装包，由安装器自动从官方源拉取构建。

## Runtime architecture

```
┌─────────────────────────────────────────────┐
│  DSH Desktop (Electron)                     │
│  app\DSH.exe  ── renderer/ (原生 UI)        │
└──────────────┬──────────────────────────────┘
               │ IPC (preload contextBridge)
               ▼
        main.js (主进程)
               │ spawn / 接管
               ▼
   Harness 引擎 (dsh web → 127.0.0.1:3080)
   {安装根}\harness  ── ~/.dsh（配置/会话/密钥）
```

引擎优先使用安装目录捆绑的便携 Node（`{安装根}\tools\node`），目标机器不依赖系统 Node。

## Project structure

```
main.js             Electron 主进程：harness 启停、RPC 桥、GitHub、更新器
preload.js          渲染进程安全桥（contextBridge）
renderer/           渲染层（原生 HTML/JS/CSS）
installer/          Inno Setup 脚本 + setup.ps1/setup.bat/check-env.ps1
config/             纯净默认配置模板（不含任何个人密钥）
scripts/            打包、编码检查、发布工具
extras/             可选插件（compact 会话压缩等）
```

## Current validation status

- **Windows x64**: 已验证（安装向导、引擎自动获取、对话、更新链路）
- **macOS / Linux**: 暂不提供安装包（Electron 跨平台，但分发与引擎链路仅验证 Windows）

## Upstream version and patches

引擎锁定官方 `deepseek-ai/DeepSeek-Harness` **dsh-v0.1.0-rc.8**，安装时自动拉取并构建；不维护私有补丁。升级引擎：

1. 修改 `installer/setup.ps1` 的 `HarnessSource / HarnessBranch / NodeVersion`
2. 重新打包发布

## Contributing

Issues and pull requests are welcome. 提交前请至少运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-encoding.ps1
```

**不要在 issue、日志、截图或测试数据中包含真实 API 密钥。**

## License

本项目基于 [MIT License](https://github.com/sayzwx/DSH-desktop/blob/main/LICENSE) 开源。

DeepSeek Harness 及其依赖遵循各自上游许可证与商标政策。DSH Desktop 是独立的社区桌面封装。
