## v0.4.0

### 🚀 更新即装即用（不再手动解压/删旧版）
- 应用内「一键更新」下载完成后，**自动运行安装包并重启为最新版**；配置、会话、引擎全部保留（`%LOCALAPPDATA%\DSH` + `~/.dsh`）。
- 更新进度显示**实时速率（MB/s）** 与命中镜像；下载期间按钮禁用，防止重复点击重置下载。
- 优先走**国内加速镜像**（ghfast.top / ghproxy.net / gh-proxy.com / gh.ddlc.top），失败自动回源 GitHub。

### 🎯 首次配置引导
- 未配置任何模型 / API 密钥时，模型配置页显示引导卡：**推荐 DeepSeek 官方 API**，并提供其它提供商入口，引导用户先配置模型。

### ⚡ OpenCode Zen 免费模型 429 修复
- 免费模型 `deepseek-v4-flash-free` 因 DSH 归因 UA 被识别为非官方客户端，返回 `429 FreeUsageLimitError`。
- 设置 → 模型 → opencode 卡片新增「⚡ 免费模型（UA 代理）」：一键启用本地 UA 重写代理（127.0.0.1:8790 → opencode.ai/zen，UA 改写为 opencode/0.1.0），并写入 opencode 路由 baseURL 与开机自启。

### 📦 安装体验
- 内置**便携 Node**（随包分发，目标机器无需任何 Node 环境）。
- 修复 `frontend dist not built`：引擎安装时使用捆绑 Node 工具链，**强制校验 web 前端 dist**，缺失自动补构建 `build:web`。

## 安装

- **Setup.exe（推荐）**：双击后自动解压并安装到 `%LOCALAPPDATA%\DSH`，装完自动启动 DSH。
- **zip**：解压后运行 `setup.bat`。

> 现在下载链路更快：应用内更新优先走国内加速镜像；手动下载也可在官方链接前加镜像前缀（如 `https://ghfast.top/https://github.com/...`）。
