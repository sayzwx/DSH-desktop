# DSH Desktop v0.5.4 — 安装器修复 + 内置插件市场

## 🎯 核心：真正开箱即用

v0.5.4 修掉三个阻塞问题，让「装完即用」名副其实：

### ① 安装器环境预检页报「check-env.ps1 未就位」——已修复
- 根因：`dsh-installer.iss` 里 `check-env.ps1` 以 `dontcopy` 标记释放，但 `ExtractTemporaryFile` 只在向导页触发时才调用，时机过晚，第一次进入环境预检页必然提取不到。
- 修复：`InitializeWizard` 末尾提前 `ExtractCheckEnv`，确保向导页加载前文件已就位。
- 附带：「重新检测」按钮不再被禁用，用户可随时复查环境。

### ② 启动 Harness 报 ERR_MODULE_NOT_FOUND（缺 cordis 插件链）——已修复
- 根因：`main.js` 的 `checkHarnessIntegrity` 只校验 `dsh-app-boot` + `cordis-plugin-loader` 两个包，漏检运行时插件（cordis-plugin-timer / dsh-llm / dsh-session / dsh-typert-*），npx 缓存里的残缺 dsh 发行包被放行 → 启动即崩。
- 修复：`keyPkgs` 扩到 7 个 + dist 形态兜底启发式（`@deepseek-ai` 非空子包 < 6 个视为残缺）。
- 效果：残缺引擎会被正确判失败，触发自动修复（`setup.ps1 -EngineOnly -DestDir <安装根>`）拉取完整官方引擎。

### ③ 插件市场真正内置（不再依赖远程 npm 拉 dshmarket）——已实现
- 新增 `extras/dsh-market-bundle/`：把 dshmarket 官方 tarball（含 SHA256 manifest）打进 Setup.exe。
- 安装器 `setup.ps1`：优先从本地 tarball 安装 dshmarket（校验 SHA256），不走 npm registry；tarball 缺失/校验失败才回退远程。
- 应用内 `marketEnsure`：同样优先本地 tarball，UI 上显示「📦 本地内置 v1.18.0」或「☁️ 远程 npm」。
- 拉包工具：`scripts/fetch-dshmarket.ps1 -Version 1.18.0`（多镜像 + SHA256 校验 + 写 manifest）。

## 🔧 工程化

- **编码规范补全**：`dsh-installer.iss` 历史遗留的 UTF-8 BOM 已去除（Inno Setup 6.3+ 官方支持无 BOM UTF-8 脚本）；`check-encoding.ps1` 把 `.iss` 纳入「禁 BOM」规则，打包前强制检查。

## 📦 安装

- **Setup.exe（推荐）**：双击 → UAC 提权 → 选目录 → 环境预检 → 安装（自动拉取引擎 + 内置市场）→ 启动应用。
- **zip**：解压后以管理员身份运行 `setup.bat`。

> 手动下载加速：`https://ghfast.top/https://github.com/sayzwx/DSH-desktop/releases/download/v0.5.4/DSH-Desktop-v0.5.4-Setup.exe`
