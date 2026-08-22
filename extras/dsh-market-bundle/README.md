# extras/dsh-market-bundle/

DSH Desktop 的**真正内置插件市场**包：把 dshmarket 的 npm tarball + manifest 打进 Setup.exe，
安装时 setup.ps1 直接从本地 tarball 装到 harness web profile，不走 npm registry，
**首次安装即可开箱使用插件市场**，不再依赖外网。

## 目录约定

| 文件 | 入库？ | 说明 |
|---|---|---|
| `manifest.json` | ✅ 入库 | 记录包名、版本、SHA256、registry URL、下载时间；setup.ps1 安装前会校验 SHA256 |
| `dshmarket-<version>.tgz` | ❌ 不入库（已在 `.gitignore`） | 从 npm registry 拉取的 dshmarket 官方 tarball；由 `scripts/fetch-dshmarket.ps1` 生成 |

## 维护流程

### 首次拉取（或升级 dshmarket 时）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fetch-dshmarket.ps1 -Version 1.18.0
```

会从国内 npm 镜像（默认 `https://registry.npmmirror.com`，可用 `-Registry` 覆盖）拉 `dshmarket-1.18.0.tgz`，
写 `manifest.json`，校验 SHA256。

### 升级 DSH Desktop 发行版时

跑完上面的 fetch 后，跑：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-dist.ps1 -Version 0.5.4
```

`build-dist.ps1` 会把 `manifest.json` + `dshmarket-*.tgz` 一起复制到 stage\app\extras\dsh-market-bundle\，
随 Setup.exe 安装到 `{用户安装根}\app\extras\dsh-market-bundle\`。

### 安装时（setup.ps1 + main.js 协作）

- setup.ps1：检测 `{Dest}\app\extras\dsh-market-bundle\manifest.json` 存在 → 校验 SHA256 →
  调 `dsh plugin --profile web add <tarball>` 从本地 tarball 安装到 web profile → 跳过远程 npm 拉取。
- main.js `marketEnsure`：检测 `{LAYOUT_ROOT}\app\extras\dsh-market-bundle\*.tgz` 存在 → 走本地路径；不存在 → fallback 远程 `dsh plugin add dshmarket`。
- renderer/market.js：UI 上显示市场源（"本地内置 v1.18.0" vs "远程 npm"），用户一眼看出是不是真内置。

## 设计取舍

- **不直接复制到 `{安装根}/harness/extensions/dshmarket/`**：dshmarket 必须通过 harness 的 cordis
  加载器扫描 profile 安装（`dsh plugin add` 是唯一官方入口，extensions/ 目录约定不存在）。
  从本地 tarball 装是等效但完全离线的方案。
- **不缓存 catalog**：dshmarket 项目明确反对"打包 stale catalog"（"a stale answer is not a
  degraded one but a wrong one"），所以这里只打包插件市场应用本身，catalog 仍在 harness
  启动后实时拉 `awesome-dsh-plugin.com/plugins.json`（首次需联网，已通过 npm 镜像解决）。

## 离线/网络受限场景

- **拉 tarball 时网络不可达**：临时用 `DSHM_REGISTRY_URL=https://your-mirror/plugins.json`
  环境变量指向任意 `plugins.json` 镜像（dshmarket 文档支持的官方方案）。
- **运行时不连外网**：catalog 拉取失败 → dshmarket 在 UI 显示具体原因和 Retry 按钮（上游行为），
  桌面端不做额外缓存（避免误导用户看到过期插件列表）。