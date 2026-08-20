## v0.4.1

### 🎉 全新一键安装向导（Inno Setup）
`Setup.exe` 从"自解压压缩包"升级为**真正的 Windows 安装向导**：
双击 → 下一步 → 自动安装到 `%LOCALAPPDATA%\DSH` → 自动拉取引擎 / 建快捷方式 / 启动应用。
**不再需要手动解压、运行 setup.bat 或删除旧目录。**

- 安装包内置**便携 Node**（目标机器无需任何 Node 环境）。
- 修复 `frontend dist not built`：引擎使用捆绑 Node 工具链构建，强制校验 web 前端 dist，缺失自动补 `build:web`。

### 📁 harness 统一到安装根目录
- 自动检测 / 下载的 harness 默认安装在 `%LOCALAPPDATA%\DSH\harness`（与 `app` 同根），不再散落到系统全局 npm。
- 卸载仅移除 app / tools / config，会话与引擎数据保留。

### ⚡ 上一版新增（沿用自 v0.4.0）
- **更新即装即用**：应用内更新下载完自动安装并重启，配置/会话/引擎保留。
- **实时速率 + 国内加速镜像**（ghfast.top / ghproxy.net / gh-proxy.com / gh.ddlc.top）。
- **首次配置引导**：未配置模型/密钥时显示引导卡（推荐 DeepSeek 官方 API）。
- **OpenCode Zen 免费模型 429 修复**：设置 → 模型 → opencode「⚡ 免费模型（UA 代理）」。

## 安装

- **Setup.exe（推荐）**：双击引导安装，装完自动启动。
- **zip**：解压后运行 `setup.bat`。

> 手动下载也可加速：官方链接前加镜像前缀，如 `https://ghfast.top/https://github.com/sayzwx/DSH-desktop/releases/download/v0.4.1/DSH-Desktop-v0.4.1-Setup.exe`
