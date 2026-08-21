# DSH Desktop v0.5.3 — 零环境装完即用（后安装路线）

## 🎯 核心目标：小白零环境装完即用

v0.5.3 确认采用**后安装路线**（引擎不打包进安装包，避免包体膨胀到 GB 级），但把「安装时自动拉取引擎」做到可靠、零失败：

- 安装包内置**完整便携 Node**（含 corepack/pnpm 全套工具链），目标机器不需要任何 Node.js 环境。
- 安装时 `setup.ps1` 自动拉取官方 Harness 引擎（源码多镜像下载 → `pnpm install --frozen-lockfile`（npm 多镜像重试）→ 构建 → web 前端校验），一次性完成，**装完点「启动 Harness」即可用**。
- 应用内「未检测到引擎 → 自动安装」与安装器走同一条修复路径，且已修复**自定义安装目录下 corepack 找不到**的致命问题。

## 🛠 修复 v0.5.2 的致命问题

### ① `未找到 corepack` 导致引擎装不上 —— 已修复
- 根因：main.js 调 `setup.ps1 -EngineOnly` 时没传 `-DestDir`，setup.ps1 默认去 `%LOCALAPPDATA%\DSH` 找捆绑 node；用户装在自定义目录（如 `D:\DSH`）→ 找错目录 → 报 corepack 缺失。
- 修复：main.js 现在传 `-DestDir` 为用户实际安装目录（从应用自身路径动态推导，不绑定任何路径）。

### ② 安装日志中文乱码 —— 已修复
- 根因：中文 Windows 的 PowerShell 控制台默认 GBK 输出，main.js 按 UTF-8 收集 → 乱码。
- 修复：`setup.ps1` 开头强制 `[Console]::OutputEncoding = UTF8`，所有日志中文正常。

### ③ 安装器/应用路径全面面向用户
- 安装根目录动态推导（`<安装根>\app\DSH.exe` → 安装根），用户选什么目录都自适应。
- 引擎完整性检测不再绑定本地路径，自动扫描依赖；检测覆盖 npm 全局 hoist 等三种依赖位置。
- 手动兜底指引去掉所有开发者本地路径，全部以用户视角描述。

## 📦 安装器能力（Setup.exe）

- 管理员权限启动（UAC 提权，确保可写任意目录 + 设环境）
- 可选安装目录（app / harness / tools 全部跟随用户选择）
- 环境预检页（架构 / 网络 / 磁盘 / Node / 脚本执行策略）
- 脚本执行策略防呆（Restricted/AllSigned 时明确提示修复命令）
- 安装失败不卡死（错误写 `install.log` + 100% 可成功的手动指引）

## ✨ 功能（沿用）

- 一键启停 / 接管 Harness（:3080），实时日志
- 并发会话、流式输出、Markdown 排版、工作区、GitHub 浏览
- 30+ 内置提供商 + 自定义提供商（OpenAI/Anthropic 兼容）
- 插件市场（dsh-market）开箱即连
- 系统托盘常驻

## 安装

- **Setup.exe（推荐）**：双击 → UAC 提权 → 选目录 → 环境预检 → 安装（自动拉取引擎）→ 启动应用，装完即可直接用 Harness。
- **zip**：解压后以管理员身份运行 `setup.bat`。

> 手动下载加速：`https://ghfast.top/https://github.com/sayzwx/DSH-desktop/releases/download/v0.5.3/DSH-Desktop-v0.5.3-Setup.exe`
