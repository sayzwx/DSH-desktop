## v0.4.1

### 🎉 全新一键安装向导（Inno Setup）
`Setup.exe` 从"自解压压缩包"升级为**真正的 Windows 安装向导**：
双击 → 下一步 → 自动安装到 `%LOCALAPPDATA%\DSH` → 自动拉取引擎 / 建快捷方式 / 启动应用。
**不再需要手动解压、运行 setup.bat 或删除旧目录。**

- 安装包内置**便携 Node**（目标机器无需任何 Node 环境）。
- 修复 `frontend dist not built`：引擎使用捆绑 Node 工具链构建，强制校验 web 前端 dist，缺失自动补 `build:web`。

### 🔁 下载链路多镜像自动回退（修复依赖安装不完整）
- **修复 `ERR_MODULE_NOT_FOUND`（@deepseek-ai/dsh-app-boot 缺失）**：根因是依赖安装时网络波动导致文件不完整。
  现在 **pnpm install 在 npmmirror → 腾讯云 → npm 官方 多镜像间自动重试**，任一成功即继续，大大降低因网络中断导致依赖缺文件。
- **引擎源码 zip** / **Node.js zip** 下载均支持多镜像（npmmirror / 腾讯云 / 华为云 / ghfast.top 等），自动逐源尝试。
- **全部镜像失败不"死掉"**：打印**可复制的手动下载指引**（官方 + 镜像地址 + 解压/安装命令），用户可稍后手动完成。

### 🛍 插件市场自动补装（dshmarket）
- 市场服务（`/dsh-market/*`）若未随引擎加载，**应用自动执行 `dsh plugin --profile web add dshmarket`** 补装；
  安装器也内置了安装步骤。装完重启桌面端即可使用插件市场。
- 市场插件仓库：https://github.com/dsh-market/dsh-market

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
