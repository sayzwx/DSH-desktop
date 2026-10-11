# 星空主题 · 官方端生效验证流程

> 目标：确认 `dsh-xingkong-theme` 在官方 DSH Desktop（D:/dsh-office）里真实生效。
> 工具沙箱起不来官方应用（进程被清），所以「启动/重启」由石岩在桌面做。

## 一、启动前检查（我已做完）

- [x] 挂载点文件存在：`%APPDATA%\dsh-desktop\harness\profiles\web\node_modules\dsh-xingkong-theme\bundle\{host,client}.js`
- [x] 两份文件与仓库源**逐字节一致**（diff 通过）
- [x] 市场登记：`.dsh-market\hot-4.yml` → `mkt-xingkong-theme` → `file:///.../bundle/host.js`
- [x] `cordis.patch.yml` 无 xingkong 残留（上次已还原，避免第三个来源）
- [ ] 官方应用当前**未运行**（需石岩启动）

## 二、石岩操作（桌面）

1. 双击开始菜单「DeepSeek Harness」启动官方应用
2. 等界面完全加载（约 30–60s，引擎要起）
3. **切到深色主题**（关键！浅色档星空感几乎看不出）
   - 设置 → 外观/主题 → 深色（或跟随系统且系统为深色）
4. 观察：整体底色应变深空黑（#030508 系），侧边栏更深，强调色变极光青（#00D4AA）

## 三、我做的验证（应用启动后）

- 读引擎日志 `%APPDATA%\dsh-desktop\logs\harness.log`：
  - 期望出现 `[xingkong-theme] host half active` → 证明 host 半身加载
  - 期望无 `dsh-xingkong-theme resolves from multiple active Loader sources`
- 读页面真实计算样式（CDP 或让石岩 F12 执行）：
  - `getComputedStyle(document.documentElement).getPropertyValue('--dsw-alias-bg-base')`
  - 期望深色档 = `#030508`（若仍是官方默认值 → 未生效）

## 四、若未生效的排查顺序

1. 日志有无 `[xingkong-theme] host half active`？
   - 无 → host 半身没加载：检查 hot-4.yml 是否被 profile 维护清理（对比 `log.ndjson`）
   - 有 → 进第 2 步
2. 页面 token 是否被覆盖？
   - `--dsw-alias-bg-base` 仍是默认 → client 半身没 apply（`ctx.theme.overrideTokens` 签名/时序问题）
3. 是否被官方主题 `preference: light` 覆盖？
   - 浅色档本来就不是深空感 → 深色档再判

## 五、离线可做的替代验证（不依赖官方应用）

用自有壳（DSH.exe）或 electron 直接跑一个最小 harness 环境，验证 `overrideTokens` 契约：
- 检查官方 `@deepseek-ai/dsh-client-ui-theme` 的 `theme.overrideTokens` 签名
- 确认 `{light, dark}` 双档表格式正确（官方是否接受字符串/对象）
