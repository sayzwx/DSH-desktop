# DSH Desktop v0.5.2 — 全面面向用户 + 一键装完即用

## 🎯 核心目标：一个 Setup.exe 装完启动即可用

v0.5.1 在部分机器上仍出现「装完点启动报依赖不完整」——根因是检测逻辑绑定了开发者本地路径、发行包依赖 scope 判错、以及安装器未提权导致部分机器写不进。v0.5.2 彻底重构为「面向用户」：

### 安装器（Setup.exe）

- **管理员权限启动**：双击即触发 UAC 提权，确保能写入任意所选目录、设置环境、拉取引擎。无管理员权限的机器会明确提示。
- **路径全程跟随用户选择**：app / harness / tools 全部落在用户在向导里选的目录下，绝不绑定任何本地路径。
- **环境预检页增强**：进入即检测 CPU 架构 / 网络 / 磁盘 / Node.js / **PowerShell 脚本执行策略**；若执行策略为 Restricted/AllSigned 会明确告警并给出修复指引。
- **脚本执行策略防呆**：若机器策略禁止脚本且 `-ExecutionPolicy Bypass` 被覆盖，安装器立即给出管理员修复命令（`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`），不再静默失败。
- **安装失败绝不卡死**：引擎拉取失败时不再因隐藏 `pause` 卡住安装器；错误写入 `install.log` 并给出 100% 可成功的手动办法。

### 应用内引擎探测（main.js）

- **安装根动态推导**：应用从自身 `DSH.exe` 路径推导安装根（`<安装目录>\app\DSH.exe` → 安装根），用户选什么目录都自适应，不再写死 `%LOCALAPPDATA%\DSH`。
- **依赖检测 scope 修复**：发行包形态（npm 全局 / npx 缓存的 `@deepseek-ai/dsh`）依赖现在覆盖三种位置——包内嵌套、`@deepseek-ai` 同级、**npm 全局 hoist 到 `node_modules` 根**——彻底解决「npm 装完仍报依赖不完整」的误判。
- **去本地路径绑定**：引擎探测不再扫描盘符根目录/用户目录（避免绑定开发者本机的 `D:\DeepSeek-Harness` 这类路径），只扫「安装根同级 harness」与「环境变量 `DSH_HARNESS_DIR`」。
- **捆绑 Node 自洽**：应用内所有 npm/npx 调用走捆绑 Node 的 `npm-cli.js`（`<安装根>\tools\node`），目标机无需系统 Node。

### 保底手动指引（面向用户，无本地路径）

所有自动获取失败时，日志给出三种通用办法：① `setx DSH_HARNESS_DIR "你的引擎源码目录"`；② 浏览器下载引擎 zip 解压到 `<安装目录>\harness`（附官方+加速镜像）；③ 管理员 cmd 运行 `npm install -g @deepseek-ai/dsh`。任选其一重启即可。

## 🛠 沿用 v0.5.1 的修复

- 引擎完整性检测（空目录/缺包识别，损坏引擎自动跳过）
- 启动崩溃自动检测 + 自动修复
- 自定义提供商（对齐官方 webUI）
- 打包排除 `.workbuddy` / `DSH` 安装产物（隐私 + 体积）
- 编码防线覆盖隐藏配置文件（.gitignore 等）

## 安装

- **Setup.exe（推荐）**：双击 → UAC 提权 → 选择安装目录 → 环境预检 → 安装 → 自动拉取引擎 / 建快捷方式 → 启动应用，装完即可直接用 Harness。
- **zip**：解压后以管理员身份运行 `setup.bat`。

> 手动下载加速：`https://ghfast.top/https://github.com/sayzwx/DSH-desktop/releases/download/v0.5.2/DSH-Desktop-v0.5.2-Setup.exe`
