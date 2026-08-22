# DSH Desktop v0.5.5 — 安装器预检修复 + 插件市场「需重启」提示 + 星图档案视图优化

## 🎯 本版修复（v0.5.4 实测反馈）

### ① 安装器环境预检「未产生输出（exit 1）」——已修复
- 根因：PowerShell 5.1 的 `Write-Host` 输出为 **UTF-16 LE**，Inno 的 `LoadStringsFromFile` 按 ANSI 读 → 全乱码 → 找不到 JSON → 显示「未产生输出」。
- 修复：`check-env.ps1` 新增 `-ReportFile` 参数直写 **UTF-8 no BOM** 文件；`dsh-installer.iss` 改用该参数，并从 JSON 提取 Node/网络/磁盘字段组装清晰的预检报告（不再依赖 stdout 重定向）。

### ② 插件市场「vundefined」——已修复
- 根因：dshmarket 已装到 `~/.dsh/profiles/web/`，但 **cordis 加载器只在 harness 启动时组合插件**——已运行的 harness 不加载新插件，`/dsh-market/*` 被 fallback 到 HTML 主页（这就是导出日志是 index.html 的原因）。
- 修复：
  - `main.js` 检测 status 响应是 HTML/无 version → 判定「已装未加载」，并探测 `dshmarket/package.json` 实际安装版本
  - `renderer/market.js` 明确提示「⚠️ 已装 v1.18.0（harness 未加载，请重启 DSH Desktop）」
  - 修复后**重启一次应用**，插件市场即可正常加载（catalog 实时拉取）

### ③ 星图档案视图优化
- 修复「文件/目录」badge 竖排（补 `white-space:nowrap` + 列宽）
- 新增「说明」列：按文件名自动标注用途（settings.yaml / zen-ua-proxy.mjs / storages / sessions 等）
- 路径列等宽字体 + 溢出省略 + hover 显示完整路径
- 行点击 / 复制按钮复制完整路径（带 ✓ 反馈）
- 窄窗口横向滚动

## 📦 安装

- **Setup.exe（推荐）**：双击 → UAC 提权 → 选目录 → 环境预检 → 安装（自动拉取引擎 + 内置市场）→ 启动应用。
- **zip**：解压后以管理员身份运行 `setup.bat`。

> 手动下载加速：`https://ghfast.top/https://github.com/sayzwx/DSH-desktop/releases/download/v0.5.5/DSH-Desktop-v0.5.5-Setup.exe`
