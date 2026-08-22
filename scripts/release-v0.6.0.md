# DSH Desktop v0.6.0 — 引擎自愈修复（装完即用，不再"死循环重试"）

## 🎯 核心目标：下载即一键装完即用

v0.6.0 修复「启动 Harness 永远报 ERR_MODULE_NOT_FOUND / 一直提示请重试」的**根本原因**——
引擎检查判据查错了位置，导致残缺引擎被放行、死循环。

### 根因（v0.5.5 实测复现）

- 引擎启动后 cordis 插件加载器从 `~/.dsh/profiles/web/` 解析 `@deepseek-ai/*` 依赖，
  **与引擎自身 node_modules 无关**。
- 用户机器上 `{安装根}\harness` 不存在（引擎未装进用户所选目录）时，
  应用探测跌到 **npx 缓存残留**（npm-cache\_npx），其自身 node_modules 有 195 个子包，
  旧完整性检查只看引擎自身 node_modules → 放行 → 启动崩 → 死循环「请再次点击重试」。

### 修复

- **完整性检查查对位置**：dist 形态引擎必须同时校验
  `~/.dsh/profiles/web/node_modules/@deepseek-ai/` 依赖位（cordis 实际解析处）。
  npx 缓存残缺引擎 profile 0 依赖 → 判不完整 → 被跳过。
- **自动装到用户目录**：探测不到完整引擎时自动触发
  `setup.ps1 -EngineOnly -DestDir <用户安装根>`，引擎装进**用户所选安装目录**的
  `harness\` 子目录，全程不绑定任何固定路径（LAYOUT_ROOT 动态推导）。
- **绝不绑定开发者路径**：检测/兜底不再出现任何开发机路径。

## 📦 安装

- **Setup.exe（推荐）**：双击 → UAC 提权 → 选目录 → 环境预检 → 安装（自动拉取引擎 + 内置市场）→ 启动应用，装完即可直接用 Harness。
- **zip**：解压后以管理员身份运行 `setup.bat`。

> 手动下载加速：`https://ghfast.top/https://github.com/sayzwx/DSH-desktop/releases/download/v0.6.0/DSH-Desktop-v0.6.0-Setup.exe`
