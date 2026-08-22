# DSH Desktop v0.6.2

修复「引擎安装/启动链路」三个真实阻塞，全部经用户机器实机验证通过（源码构建 → pnpm install → build → `dsh --profile web` 启动 → `/dsh-market` 市场加载均成功）。

## 1. 引擎依赖安装：pnpm install 必崩的两个原生模块

- **koffi**：`pnpm-workspace.yaml` 的 `allowBuilds: koffi: true` 允许跑 `cnoke.cjs --prebuild`。它在 pnpm 隔离布局下 `checkPrebuild` 失败 → 回退源码编译 → 用户机器没有 **CMake** → `[ELIFECYCLE] exit 1` → 4 个镜像重试全部同因失败。
- **esbuild**：`install.js` 在 pnpm 隔离布局下找不到 `@esbuild/win32-x64` 平台包 → 走 npm fallback 下载 → 网络慢时卡死数十分钟。

**修复**：`installer/setup.ps1` 在 pnpm install 前自动打补丁，把 `esbuild`/`koffi` 的 allowBuilds 改为 `false`——prebuilt 二进制已随 optionalDependencies（`@koromix/koffi-win32-x64`、`@esbuild/win32-x64`）分发，运行时 require 直接可用（已实测 require OK），跳过 CMake 与 npm fallback。实测 pnpm install 29.6s 通过（935 包）。

## 2. 构建被第三方 shim 劫持（WorkBuddy 等 IDE 场景）

WorkBuddy 等 IDE 通过 `NODE_OPTIONS` 注入 `safe-delete` shim（`genie-safe-delete.cjs`），劫持 node 子进程的文件删除 → pnpm 清理临时目录时报 `SAFE_DELETE_BULK_CONFIRM_REQUIRED` 直接崩溃，且不可恢复。

**修复**：`setup.ps1` 在 pnpm 构建前清除 `NODE_OPTIONS`。实测清空后 pnpm install 从「必崩」变「29.6s 通过」。

## 3. zip 源码无 .git → build 取 commit hash 崩

引擎源码以 zip 形式解压，没有 `.git` 目录；`scripts/build.ts` 用 `git rev-parse HEAD` 取提交号 → `Command failed: git rev-parse HEAD` → build 失败。

**修复**：引擎官方支持 `DSH_CLIENT_COMMIT_HASH` 环境变量绕过 git（须 7-40 位 hex）。`setup.ps1` 设置该变量为发行 tag `dsh-v0.1.0-rc.8` 的真实 commit hash（`141eb6fef83422698aef7a981029e843e8161534`）。实测 build 成功（200 个 client artifact）。

## 4. 桌面端引擎完整性检查判据修正（main.js）

实机验证发现原检查两处误判，会把「完整可用的源码引擎」拒掉：

- **keyPkgs 修正**：`dsh-typert-loader` / `dsh-typert-registry` 是 rc.7 及更早的包名，rc.8 里无人依赖、无链接（typert 整合进 `packages/typert` 子目录，仅构建期使用）。替换为 rc.8 真实启动必需：`dsh-base` / `dsh-web-app`（web profile 的 bundle 层）。
- **scope 判定修正**：pnpm workspace（源码形态）的依赖分散在根 / `apps/cli` / `apps/web` 各自的 node_modules，旧逻辑「只看第一个命中的 scope」会把完整源码引擎误判为残缺。改为「任一 scope 下 keyPkgs 全齐即通过」。
- **profile 判据修正**：实测证明 rc.8 通过 `healProfilesModuleFallback` 把 profile 缺失的 peer 依赖 fallback 到引擎自身 node_modules——profile 里只需装插件（如 dshmarket），`@deepseek-ai/*` 无需出现在 profile。dist 引擎的 profile 检查改为「profile 目录已初始化（package.json 含 dsh.profile.bundles）」。

## 验证记录（用户机器 D:\DSH 实机）

```
pnpm install --frozen-lockfile  →  EXIT=0（29.6s，935 包）
pnpm build                     →  BUILD_EXIT=0（200 client artifacts，web dist 11MB）
node bin.js --profile web      →  dsh web: http://127.0.0.1:3080（HTTP 200）
/dsh-market/status             →  {"version":"1.18.0","channel":"stable","restart":true,...}
/dsh-market/installed          →  dshmarket state: live / hot（已热加载）
/dsh-market/registry           →  1884 个插件
```

下载：`https://github.com/sayzwx/DSH-desktop/releases/download/v0.6.2/DSH-Desktop-v0.6.2-Setup.exe`
国内加速：`https://ghfast.top/https://github.com/sayzwx/DSH-desktop/releases/download/v0.6.2/DSH-Desktop-v0.6.2-Setup.exe`
