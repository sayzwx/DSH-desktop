# DSH Desktop v0.6.1 — 环境预检修复（Inno 直接调 powershell，不再 exit 1）

## 🎯 修复 v0.6.0 实测问题

### ① 安装器环境预检「退出码 1」——已修复
- 根因：Inno Setup 用 `cmd.exe /c "powershell" ... -File "..."` **嵌套引号**调用——
  `cmd /c` 对以引号开头的命令行有剥引号规则（剥掉第一个引号和最后一个引号），
  导致 powershell 收到的参数错乱 → 预检脚本启动异常 → 显示「退出码 1」。
- 修复：Inno `Exec()` 改为**直接启动 `powershell.exe`**（自身处理参数引号，不经过 cmd 包装层）。
- 附带：`check-env.ps1 -Report` 加异常兜底——任何内部错误输出 JSON 兜底并 exit 0，
  安装器只解析 JSON 字段，不再因脚本内部小异常而整页报错。

### ② 引擎源码下载慢/像卡死——已优化
- 根因：源码下载把**官方 GitHub 直连放第一位**（国内常超时，120s×2 才轮到镜像），
  用户看到长时间 "downloading harness source" 以为卡死。
- 修复：**国内镜像优先**（ghfast.top / ghproxy.net / gh-proxy.com / gh.ddlc.top），
  官方直连放最后兜底；单次超时 120s → 45s，快速失败快速切换。

### ③ 引擎探测自愈（v0.6.0 起生效，本版保持）
- dist 引擎（如 npx 缓存残留）完整性校验增加 **profile 依赖检查**
  （cordis 从 `~/.dsh/profiles/web` 解析，与引擎自身 node_modules 无关）→
  残缺引擎被拒 → 自动触发 `setup.ps1 -EngineOnly -DestDir <用户安装根>`，
  引擎装进**用户所选安装目录**的 `harness\` 子目录，全程动态推导、零路径绑定。

## 📦 安装

- **Setup.exe（推荐）**：双击 → UAC 提权 → 选目录 → 环境预检 → 安装（自动拉取引擎 + 内置市场）→ 启动应用，装完即可直接用 Harness。
- **zip**：解压后以管理员身份运行 `setup.bat`。

> 手动下载加速：`https://ghfast.top/https://github.com/sayzwx/DSH-desktop/releases/download/v0.6.1/DSH-Desktop-v0.6.1-Setup.exe`
