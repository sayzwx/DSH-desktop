# dsh-xingkong-theme · Nebula Core 星空主题

DeepSeek Harness WebUI 主题（走**官方 token 体系**，纯 token 主题：不改界面结构）。

- **深色 = 深空**：Void `#030508` / Navy `#0A0E1A` / Abyss `#0D1B2A`，极光青 `#00D4AA`，
  星云紫 `#7B61FF`，彗星金 `#FFD700`，星光白 `#E8F4F8`，星际尘埃 `#6B7B8D`
- **浅色 = 星云白昼**：同一色相语言，强调色加深到 `#009E82`（白底约 4.6:1 对比）
- 覆盖官方语义层 **全部 110 个 token**（`alias-*` 99 + `specific-*` 11，含侧边栏三兄弟
  `specific-sidebar-fill` / `-nav-item-hover` / `-nav-item-active` / `-active-accent`）

设计语言出自仓库根目录的 `DeepSeek_Harness_星空主题设计系统.md`（Nebula Core · 深空观测站）。

## 结构（与官方主题包同构）

```
package.json        dsh.bundle.patch + dsh.client{platform:web,immediately}
cordis.patch.yml    insert: xingkong-theme → dsh-xingkong-theme
bundle/host.js      host 半身（纯 token 主题无需资源路由，只留一行日志）
bundle/client.js    浏览器半身：ctx.theme.overrideTokens('xingkong', {...110 个 token})
```

## 安装（profile = web）

```powershell
cd $env:USERPROFILE\.dsh\profiles\web
pnpm add file:D:\DS_harness\themes\dsh-xingkong-theme
```

然后在该目录 `package.json` 的 `dsh.profile.bundles` 数组里加入 `"dsh-xingkong-theme"`，
**退出并重开桌面端**（引擎重启后装载新 bundle）。

## 卸载

```powershell
cd $env:USERPROFILE\.dsh\profiles\web
pnpm remove dsh-xingkong-theme
```

并从 `dsh.profile.bundles` 移除该行。

## 设计约束（改主题时遵守）

1. 只覆盖 token，不写死组件选择器（唯一例外：文本选中色与滚动条圆角，见 client.js 注释）。
2. 浅色档的颜色必须过对比度：正文 ≥ 4.5:1、次要文字 ≥ 3:1（`#009E82` / `#007A66` 即为此选值）。
3. 发光/渐变属于「深空」专属表达，不做进通用 token —— 需要时另开 specific 层。
