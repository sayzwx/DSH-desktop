# DSH Desktop v0.6.3

修复「DSH Desktop 启动后用 npx 缓存残缺引擎 → ERR_MODULE_NOT_FOUND 死循环」的核心问题。

## 根因（实机日志定位）

用户装 v0.6.2 后 D:\DSH\harness 不存在（安装阶段引擎没装上），但 DSH Desktop 启动时 `discoverHarness` 扫到 **npx 缓存里的旧 dist 引擎**（`npm-cache\_npx\...\@deepseek-ai\dsh`）：

- npx 缓存引擎**自身 node_modules 看起来齐全**（keyPkgs 都在）→ 通过完整性检查 → 被选中启动
- 但 cordis 加载器从 `~/.dsh/profiles/web/` 解析依赖，`healProfilesModuleFallback` 链接到 npx 缓存的 node_modules，而那里缺 `dsh-client-ui-*` / `cordis-plugin-timer` 等 client 包 → 启动必崩 `ERR_MODULE_NOT_FOUND`
- 崩溃后 exit 回调重新 `discoverHarness` 又选中同一个 npx 缓存引擎 → **死循环「请再次点击重试」**，永远走不到自动安装

## 修复（main.js）

**去掉 discoverHarness 的 npx 缓存候选**。npx 缓存是 npm 的临时下载残留，不是用户主动安装的引擎——它表面完整但实际启动必崩，且会导致死循环。去掉后：

1. D:\DSH\harness 不存在 → `discoverHarness` 返回 null → **触发 autoInstallHarness**
2. autoInstall 调 `setup.ps1 -EngineOnly -DestDir <用户安装根>`（v0.6.2 的 setup.ps1 已含全部修复：NODE_OPTIONS 清理 + koffi/esbuild 跳过编译 + DSH_CLIENT_COMMIT_HASH 兜底）
3. 引擎装到用户所选目录的 `harness` 子目录 → 装完自动启动 → 成功

## 验证（v0.6.2 setup.ps1 实机已验证）

```
setup.ps1 -EngineOnly -DestDir D:\DSH
  → pnpm install 29.6s（935 包，koffi/esbuild 跳过编译）
  → pnpm build 成功（200 client artifacts）
  → dsh --profile web HTTP 200
  → /dsh-market/status {"version":"1.18.0"} + installed live/hot
  → /dsh-market/registry 1884 个插件
```

下载：`https://github.com/sayzwx/DSH-desktop/releases/download/v0.6.3/DSH-Desktop-v0.6.3-Setup.exe`
国内加速：`https://ghfast.top/https://github.com/sayzwx/DSH-desktop/releases/download/v0.6.3/DSH-Desktop-v0.6.3-Setup.exe`
