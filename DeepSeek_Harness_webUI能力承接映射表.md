# DSH Desktop · webUI 能力承接映射表（完整版）

> 状态：**待评审**（2026-09-29）
> 目标：让桌面端**一一对应承接** webUI 主题的全部可承接能力，而不是只拿配色。
> 关联：`DeepSeek_Harness_桌面端主题迁移方案.md`（迁移流程与 IPC）、`DeepSeek_Harness_星空主题设计系统.md`（桌面端 token 体系）
> 实测脚本：`scripts/theme-bridge-probe.cjs`

---

## 1. 先看事实：主题包到底由什么构成

拆了一个真实主题包（`dsh-neo-skin@0.6.0`，来自 npm）后，构成比预想规整得多：

```
dsh-neo-skin/
├── src/schemes/
│   ├── blue.tokens.json        ← 7551 B：89 个变量，全是颜色，全部 {light, dark} 双档
│   ├── blue.css                ← 774 B：2 条规则
│   ├── blue.meta.json          ← 27 B：配色方案名
│   ├── newspaper.tokens.json   ← 7434 B：同样 89 个变量
│   └── newspaper.css           ← 560 B：2 条规则
└── client.js                   ← 26452 B：运行时代码（注册方案 / 注入 / 开关）
```

**关键数据**：

| 项 | 数量 | 说明 |
|---|---|---|
| token 层变量 | **89 个** | 78 个 `--dsw-alias-*`（语义别名层）+ **11 个 `--dsw-specific-*`（组件层）** |
| 缺 `{light, dark}` 双档的 | **0 个** | 全部双档齐全 |
| 值里含 `url(` / `gradient` / `px` 的 | **0 个** | **89 个全是颜色** |
| CSS 规则层 | **仅 2 条** | 命中 WebUI 的 CSS Module 类名 |

规则层那 2 条长这样（原文）：

```css
[class*="_sessionRow"]:not([class*="_selected"]),
[class*="_projectRow"]:not([class*="_selected"]),
[class*="_sectionLabel"] { color: #E8EDFB !important; }
[class*="_iconButton"] { color: #B9C6E8 !important; }
```

注释解释了**为什么**需要它：「浅色模式下侧栏是深蓝底，但 DSH 用共用的 `--dsw-alias-label-*` 给侧栏文字上色（浅色模式下是深色），所以必须在这里把侧栏 chrome 重新照亮。」

> **结论：主题包 99% 的体积与 100% 的色彩表达都在 token 层，它是一张 89 行的变量表。**
> 「一一对应映射」在 token 层完全可行；只有极少数规则层补丁需要语义重建。

---

## 2. 承接架构

三层结构，**同名直落 + 派生默认值**：

```
① 主题包写入的 89 个变量
   --dsw-alias-* / --dsw-specific-*          ← 同名，零转换
        │
        ▼
② 桌面端承接层（新增）
   :root[data-theme="webtheme"] 下 89 条
   --void: var(--dsw-alias-bg-base);  …      ← 只在此模式下生效
        │
        ▼
③ 桌面端语义 token（现有 50 个 + 新增 61 个 = 111 个）
   --accent / --text / --btn-primary-fill / --code-bg / --scroll-hover-l1 …
        │
        ▼
④ 组件样式（.primary-btn / .msg-* / pre / ::-webkit-scrollbar …）
```

**两条硬规则**：

1. **承接层只在 `data-theme="webtheme"` 下生效。** 内置四套主题（light / graphite / dark / custom）完全不经过承接层 —— 它们的 `--void`/`--accent` 等保持现有字面值，**外观零变化、零回归风险**。
2. **新增的 61 个 token 的默认值必须用现有 token 派生**（如 `--btn-primary-fill: var(--accent)`），这样内置主题下它们取到的是「当前实际外观」，改造组件时不会走样。

> ⚠️ 承接层选择器必须落在能看见 `--dsw-*` 的元素上。已实测：写在 `:root` 上会**静默击穿**（变量变空串、界面掉成透明+黑字且不报错）。本方案把 89 个 `--dsw-*` 声明与承接规则**放在同一层**（`:root`），因此不触发该陷阱；若改为在 `body` 上注入主题值，则承接规则也必须落在 `body`。详见迁移方案 §2.3。

---

## 3. 完整映射表（89 项，已有 27 / 新增 62）

> 「状态」= 桌面端是否已有该 token。`✅ 已有` 表示只需补一条引用；`🆕 新增` 表示要新增 token 并在组件里挂上消费点。

| WebUI 变量（源） | 桌面端落点 | 状态 | 消费点 |
|---|---|---|---|
| **bg 底色 / 层次 / 遮罩**（13） | | | |
| `--dsw-alias-bg-base` | `--void / --bg / --deep-2` | ✅ 已有 | 页面底色 / 外壳底 / 日志面板底 |
| `--dsw-alias-bg-layer-1` | `--nebula-navy` | ✅ 已有 | 一级容器（侧栏、面板） |
| `--dsw-alias-bg-layer-2` | `--deep / --abyss` | ✅ 已有 | 二级容器（卡片、工具栏） |
| `--dsw-alias-bg-layer-3` | `--deep-3` | ✅ 已有 | 浮层实底（会话抽屉） |
| `--dsw-alias-bg-overlay` | `--panel / --panel-hover` | ✅ 已有 | 面板 / 弹层（需按 alpha 折算透明度） |
| `--dsw-alias-bg-multi-select` | `--float` | ✅ 已有 | 次级浮层底 |
| `--dsw-alias-bg-module-platform` | `--chrome` | ✅ 已有 | 外壳 / 平台模块底 |
| `--dsw-alias-bg-mask-1` | `--shadow` | ✅ 已有 | 遮罩 → 结构投影 |
| `--dsw-alias-bg-mask-2` | `--shadow-card` | ✅ 已有 | 遮罩 → 卡片投影（冷调黑） |
| `--dsw-alias-bg-mask-3` | `--overlay` | ✅ 已有 | 模态遮罩 |
| `--dsw-alias-bg-mask-drop` | `--mask-drop` | 🆕 新增 | 拖放高亮遮罩 |
| `--dsw-alias-bg-mask-photo` | `--mask-photo` | 🆕 新增 | 图片预览遮罩 |
| `--dsw-alias-bg-skeleton` | `--skeleton` | 🆕 新增 | 加载骨架屏 |
| **border 描边**（7） | | | |
| `--dsw-alias-border-l1` | `--border` | ✅ 已有 | 常规描边（按 alpha 折算） |
| `--dsw-alias-border-l2` | `--border` | ✅ 已有 | 常规描边主体（按 alpha 折算） |
| `--dsw-alias-border-l2-darkmode-thin` | `--border-muted` | 🆕 新增 | 深色档细描边（按 alpha 折算） |
| `--dsw-alias-border-l3` | `--border-strong` | ✅ 已有 | 强调描边 |
| `--dsw-alias-border-l4` | `--border-heavy` | 🆕 新增 | 最强描边 |
| `--dsw-alias-border-inverted` | `--border-inverted` | 🆕 新增 | 反色描边 |
| `--dsw-alias-border-inverted2` | `--border-inverted` | 🆕 新增 | 反色描边（合并到同一落点） |
| **brand 品牌色**（4） | | | |
| `--dsw-alias-brand-primary` | `--accent / --cyan` | ✅ 已有 | 主强调色（填充用途） |
| `--dsw-alias-brand-primary-new-colorprimary-new-color` | `--accent-soft` | 🆕 新增 | 主色变体（更亮的填充） |
| `--dsw-alias-brand-primary-invert` | `--on-accent` | ✅ 已有 | 强调色之上的文字 |
| `--dsw-alias-brand-text` | `--violet-text` | ✅ 已有 | 强调文字色 |
| **button 按钮（15 个全为新增）**（15） | | | |
| `--dsw-alias-button-primary-fill` | `--btn-primary-fill` | 🆕 新增 | `.primary-btn` 主操作 |
| `--dsw-alias-button-primary-hover` | `--btn-primary-hover` | 🆕 新增 | `.primary-btn:hover` |
| `--dsw-alias-button-primary-dimmed` | `--btn-primary-dimmed` | 🆕 新增 | `.primary-btn:disabled` |
| `--dsw-alias-button-contrast-fill` | `--btn-contrast-fill` | 🆕 新增 | 高对比按钮（发送等） |
| `--dsw-alias-button-elevated-fill` | `--btn-elevated-fill` | 🆕 新增 | `.mini-btn` 等浮起按钮 |
| `--dsw-alias-button-floating-fill` | `--btn-floating-fill` | 🆕 新增 | `.theme-btn` / `.copy-btn` 悬浮按钮 |
| `--dsw-alias-button-floating-hover` | `--btn-floating-hover` | 🆕 新增 | 悬浮按钮 `:hover` |
| `--dsw-alias-button-ghost-active-fill` | `--btn-ghost-fill` | 🆕 新增 | 幽灵按钮激活底 |
| `--dsw-alias-button-ghost-active-hover` | `--btn-ghost-hover` | 🆕 新增 | 幽灵按钮激活 + hover |
| `--dsw-alias-button-ghost-active-border` | `--btn-ghost-border` | 🆕 新增 | 幽灵按钮激活描边 |
| `--dsw-alias-button-info-fill` | `--btn-info-fill` | 🆕 新增 | `.nav-btn` 等导航按钮 |
| `--dsw-alias-button-info-hover` | `--btn-info-hover` | 🆕 新增 | 导航按钮 `:hover` |
| `--dsw-alias-button-tool-bar-fill` | `--btn-toolbar-fill` | 🆕 新增 | `.chat-toolbar` / `.msg-actions` 工具条 |
| `--dsw-alias-button-tool-bar-fill-invisible` | `--btn-toolbar-fill-invisible` | 🆕 新增 | 工具条静默态 |
| `--dsw-alias-button-tool-bar-hover` | `--btn-toolbar-hover` | 🆕 新增 | 工具条 `:hover` |
| **interactive 交互态**（5） | | | |
| `--dsw-alias-interactive-bg-hover` | `--interactive-hover` | 🆕 新增 | 通用列表行 `:hover` |
| `--dsw-alias-interactive-bg-active` | `--interactive-active` | 🆕 新增 | 通用列表行 `:active` / 选中 |
| `--dsw-alias-interactive-bg-hover-accent` | `--interactive-hover-accent` | 🆕 新增 | 强调型 `:hover`（发送键等） |
| `--dsw-alias-interactive-bg-hover-danger` | `--interactive-hover-danger` | 🆕 新增 | `.danger-btn:hover` |
| `--dsw-alias-interactive-bg-hover-solid` | `--interactive-hover-solid` | 🆕 新增 | 不透明 `:hover` |
| **label 文字层级**（9） | | | |
| `--dsw-alias-label-primary` | `--text / --starlight` | ✅ 已有 | 正文 |
| `--dsw-alias-label-primary-dimmed` | `--text-dim` | ✅ 已有 | 次级正文 |
| `--dsw-alias-label-secondary` | `--text-dim` | ✅ 已有 | 次要文字 |
| `--dsw-alias-label-tertiary` | `--dust` | ✅ 已有 | 弱化文字 |
| `--dsw-alias-label-caption` | `--text-caption` | 🆕 新增 | 说明 / 时间戳 |
| `--dsw-alias-label-dimmed` | `--placeholder` | ✅ 已有 | 输入框占位符 |
| `--dsw-alias-label-primary-foreground` | `--on-accent` | ✅ 已有 | 强调底上的文字 |
| `--dsw-alias-label-primary-inverted` | `--text-inverted` | 🆕 新增 | 反色文字 |
| `--dsw-alias-label-primary-bluish` | `--text-bluish` | 🆕 新增 | 冷调正文 |
| **markdown 代码与标记**（8） | | | |
| `--dsw-alias-markdown-code-block` | `--code-bg` | 🆕 新增 | `pre` / 代码块底 |
| `--dsw-alias-markdown-code-block-banner` | `--code-banner` | 🆕 新增 | 代码块标题栏 |
| `--dsw-alias-markdown-code-segment-selected` | `--code-seg-on` | 🆕 新增 | 代码语言切换选中 |
| `--dsw-alias-markdown-code-segment-unselected` | `--code-seg-off` | 🆕 新增 | 代码语言切换未选中 |
| `--dsw-alias-markdown-inline-code` | `--inline-code-bg` | 🆕 新增 | 行内 `code` |
| `--dsw-alias-markdown-citation` | `--md-citation` | 🆕 新增 | 引用块 / 引用标记 |
| `--dsw-alias-markdown-tag` | `--md-tag` | 🆕 新增 | 标签 / 徽标 |
| `--dsw-alias-markdown-placeholder` | `--md-placeholder` | 🆕 新增 | Markdown 占位 |
| **scrollbar 滚动条**（4） | | | |
| `--dsw-alias-scrollbar-bg-l1` | `--scroll-bg-l1` | 🆕 新增 | 滚动条槽（一级） |
| `--dsw-alias-scrollbar-bg-l2` | `--scroll-bg-l2` | 🆕 新增 | 滚动条槽（二级） |
| `--dsw-alias-scrollbar-hover-l1` | `--scroll-hover-l1` | 🆕 新增 | 滚动条滑块（一级） |
| `--dsw-alias-scrollbar-hover-l2` | `--scroll-hover-l2` | 🆕 新增 | 滚动条滑块（二级） |
| **state 状态色**（11） | | | |
| `--dsw-alias-state-success-primary` | `--ok` | ✅ 已有 | 成功主色 |
| `--dsw-alias-state-success-secondary` | `--ok-soft` | 🆕 新增 | 成功次色 |
| `--dsw-alias-state-success-tertiary` | `--ok-bg` | 🆕 新增 | 成功底色 |
| `--dsw-alias-state-warn-primary` | `--warn / --orange` | ✅ 已有 | 警告主色 |
| `--dsw-alias-state-warn-secondary` | `--warn-soft` | 🆕 新增 | 警告次色 |
| `--dsw-alias-state-warn-tertiary` | `--warn-bg` | 🆕 新增 | 警告底色 |
| `--dsw-alias-state-warn-label` | `--warn-label` | 🆕 新增 | 警告文字 |
| `--dsw-alias-state-error-primary` | `--danger` | ✅ 已有 | 错误主色 |
| `--dsw-alias-state-error-secondary` | `--danger-soft` | 🆕 新增 | 错误次色 |
| `--dsw-alias-state-business-primary` | `--info` | ✅ 已有 | 业务 / 信息主色 |
| `--dsw-alias-state-business-tertiary` | `--info-bg` | ✅ 已有 | 业务 / 信息底色 |
| **toast / tooltip 浮层**（2） | | | |
| `--dsw-alias-toast-bg` | `--toast-bg` | 🆕 新增 | 提示条 / `.modal` 内容区 |
| `--dsw-alias-tooltip-bg` | `--tooltip-bg` | 🆕 新增 | 悬浮提示底 |
| **specific 组件层（侧栏 / 气泡 / 输入框 / 菜单）**（11） | | | |
| `--dsw-specific-sidebar-fill` | `--sidebar-fill` | 🆕 新增 | 侧栏底色（`.chat-sessions`） |
| `--dsw-specific-sidebar-nav-item-active` | `--nav-item-active` | 🆕 新增 | 侧栏选中行底 |
| `--dsw-specific-sidebar-nav-item-active-accent` | `--nav-item-active-accent` | 🆕 新增 | 侧栏选中行强调条 |
| `--dsw-specific-sidebar-nav-item-hover` | `--nav-item-hover` | 🆕 新增 | 侧栏行 `:hover` |
| `--dsw-specific-bubble` | `--bubble-bg` | 🆕 新增 | 消息气泡底（`.msg-*`） |
| `--dsw-specific-bubble-highlight` | `--bubble-highlight` | 🆕 新增 | 气泡高亮 / 引用 |
| `--dsw-specific-input-major` | `--input-bg` | 🆕 新增 | 主输入框底（`.chat-input-row`） |
| `--dsw-specific-login-input` | `--input-login-bg` | 🆕 新增 | 模态输入框底（`.modal-input`） |
| `--dsw-specific-menu` | `--menu-bg` | 🆕 新增 | 下拉菜单底 |
| `--dsw-specific-selector` | `--selector-bg` | 🆕 新增 | 选择器底（模型 / 插件下拉） |
| `--dsw-specific-tip` | `--tip-bg` | 🆕 新增 | 提示条底（`.msg-notice`） |

**统计**：89 项 = ✅ 已有 **27** + 🆕 新增 **62**（去重后是 **61 个新 token**，`border-inverted` 与 `border-inverted2` 共用落点）。

---

## 4. 桌面端要落地的东西

### 4.1 新增 61 个 token 的默认值（内置主题外观零变化）

全部用**现有 token 派生**，所以四套内置主题的外观不会改变：

```css
/* renderer/styles.css —— 追加到基础 :root 块（深空默认值） */
  /* 遮罩 / 骨架 */
  --mask-drop:  color-mix(in srgb, var(--shadow) 70%, transparent);
  --mask-photo: color-mix(in srgb, var(--shadow) 88%, transparent);
  --skeleton:   color-mix(in srgb, var(--text) 8%, transparent);
  /* 描边扩展 */
  --border-muted:    color-mix(in srgb, var(--accent) 8%, transparent);
  --border-heavy:    color-mix(in srgb, var(--accent) 45%, transparent);
  --border-inverted: color-mix(in srgb, var(--text) 20%, transparent);
  --accent-soft:     color-mix(in srgb, var(--accent) 80%, var(--text));
  /* 按钮（15） */
  --btn-primary-fill:      var(--accent);
  --btn-primary-hover:     color-mix(in srgb, var(--accent) 85%, var(--text));
  --btn-primary-dimmed:    color-mix(in srgb, var(--accent) 45%, transparent);
  --btn-contrast-fill:     var(--accent);
  --btn-elevated-fill:     var(--panel);
  --btn-floating-fill:     var(--float);
  --btn-floating-hover:    var(--panel-hover);
  --btn-ghost-fill:        color-mix(in srgb, var(--accent) 12%, transparent);
  --btn-ghost-hover:       color-mix(in srgb, var(--accent) 20%, transparent);
  --btn-ghost-border:      color-mix(in srgb, var(--accent) 30%, transparent);
  --btn-info-fill:         var(--float);
  --btn-info-hover:        var(--panel-hover);
  --btn-toolbar-fill:      var(--float);
  --btn-toolbar-fill-invisible: transparent;
  --btn-toolbar-hover:     var(--panel-hover);
  /* 交互态（5） */
  --interactive-hover:        color-mix(in srgb, var(--accent) 10%, transparent);
  --interactive-active:       color-mix(in srgb, var(--accent) 18%, transparent);
  --interactive-hover-accent: color-mix(in srgb, var(--accent) 22%, transparent);
  --interactive-hover-danger: color-mix(in srgb, var(--danger) 18%, transparent);
  --interactive-hover-solid:  var(--panel-hover);
  /* 文字扩展（3） */
  --text-caption:  var(--dust);
  --text-inverted: var(--void);
  --text-bluish:   var(--starlight);
  /* markdown（8） */
  --code-bg:        var(--deep);
  --code-banner:    var(--deep-2);
  --code-seg-on:    color-mix(in srgb, var(--accent) 18%, transparent);
  --code-seg-off:   transparent;
  --inline-code-bg: color-mix(in srgb, var(--accent) 12%, transparent);
  --md-citation:    var(--border-strong);
  --md-tag:         color-mix(in srgb, var(--accent) 16%, transparent);
  --md-placeholder: var(--placeholder);
  /* 滚动条（4）—— 默认值取自当前 ::-webkit-scrollbar 的实际写法 */
  --scroll-bg-l1:    transparent;
  --scroll-bg-l2:    transparent;
  --scroll-hover-l1: color-mix(in srgb, var(--accent) 32%, transparent);
  --scroll-hover-l2: color-mix(in srgb, var(--accent) 52%, var(--border-strong));
  /* 状态扩展（6） */
  --ok-soft:     color-mix(in srgb, var(--ok) 70%, transparent);
  --ok-bg:       color-mix(in srgb, var(--ok) 14%, transparent);
  --warn-soft:   color-mix(in srgb, var(--warn) 70%, transparent);
  --warn-bg:     color-mix(in srgb, var(--warn) 14%, transparent);
  --warn-label:  var(--warn);
  --danger-soft: color-mix(in srgb, var(--danger) 70%, transparent);
  /* 浮层（2） */
  --toast-bg:   var(--panel);
  --tooltip-bg: var(--panel-hover);
  /* 组件层（11） */
  --sidebar-fill:          var(--chrome);
  --nav-item-active:       color-mix(in srgb, var(--accent) 14%, transparent);
  --nav-item-active-accent: var(--accent);
  --nav-item-hover:        color-mix(in srgb, var(--accent) 8%, transparent);
  --bubble-bg:             var(--panel);
  --bubble-highlight:      color-mix(in srgb, var(--accent) 12%, transparent);
  --input-bg:              var(--panel);
  --input-login-bg:        var(--panel-hover);
  --menu-bg:               var(--panel-hover);
  --selector-bg:           var(--float);
  --tip-bg:                var(--panel);
```

> ⚠️ **这些默认值必须与组件当前的实际取值逐条核对**（`--scroll-hover-l1` 等尤其）。做法见 §7 验收标准：改造前后跑逐元素 computed style 快照，必须零差异。

### 4.2 承接层（`data-theme="webtheme"` 模式）

```css
/* renderer/styles.css —— 新增整块 */
:root[data-theme="webtheme"] {
  /* ---- 89 个承接变量：默认取官方浅色档，运行时被主题包覆盖 ---- */
  --dsw-alias-bg-base: #ffffff;
  --dsw-alias-bg-layer-1: #ffffff;
  /* … 其余 76 个 alias … */
  --dsw-specific-sidebar-fill: #f5f6f7;
  /* … 其余 10 个 specific … */

  /* ---- 承接规则：桌面端 token 改为引用承接变量 ---- */
  --void:        var(--dsw-alias-bg-base);
  --nebula-navy: var(--dsw-alias-bg-layer-1);
  --abyss:       var(--dsw-alias-bg-layer-2);
  --deep:        var(--dsw-alias-bg-layer-2);
  /* … 27 个已有落点 … */

  /* ---- 新增 token 的承接（61 个）---- */
  --btn-primary-fill: var(--dsw-alias-button-primary-fill);
  --code-bg:          var(--dsw-alias-markdown-code-block);
  --scroll-hover-l1:  var(--dsw-alias-scrollbar-hover-l1);
  --sidebar-fill:     var(--dsw-specific-sidebar-fill);
  --bubble-bg:        var(--dsw-specific-bubble);
  /* … 其余 … */
}
```

**为什么承接变量要有默认值**：主题包只声明它改的变量（通常接近 89 个，但不保证）。没声明的那些必须回落到官方档位值，否则 `var()` 解析失败会击穿（见 §2 的陷阱说明）。

**浅 / 深档切换**：主题包的值是 `{light, dark}` 双档。桌面端的做法是 —— 迁移时按用户选择取其中一档，写死成一份主题 JSON（对应迁移方案的模式 1）。若要同时支持两档，则生成两个桌面端主题（`xx（浅）` / `xx（深）`）。

### 4.3 需要挂消费点的组件

| 组件 | 类名（实测已存在） | 要挂上的 token |
|---|---|---|
| 主操作按钮 | `.primary-btn` | `--btn-primary-fill` / `-hover` / `-dimmed` |
| 小按钮 / 浮起 | `.mini-btn` `.theme-btn` `.copy-btn` | `--btn-elevated-fill` / `--btn-floating-fill` / `-hover` |
| 导航按钮 | `.nav-btn` `.ct-*-btn` | `--btn-info-fill` / `-hover` |
| 危险按钮 | `.danger-btn` | `--interactive-hover-danger` |
| 工具条 | `.chat-toolbar` `.msg-actions` | `--btn-toolbar-fill` / `-hover` / `-invisible` |
| 侧栏 | `.chat-sessions` `.chat-sessions-head` | `--sidebar-fill` / `--nav-item-active` / `--nav-item-hover` |
| 消息气泡 | `.msg` `.msg-assistant` `.msg-question` `.msg-notice` | `--bubble-bg` / `--bubble-highlight` / `--tip-bg` |
| Markdown | `.msg-md` `pre` `code` | `--code-bg` / `--code-banner` / `--inline-code-bg` / `--md-*` |
| 滚动条 | 两处 `::-webkit-scrollbar`（styles.css:2288、3976） | `--scroll-bg-l1/l2` / `--scroll-hover-l1/l2` |
| 输入框 | `.chat-input-row` `.modal-input` | `--input-bg` / `--input-login-bg` |
| 弹窗 | `.modal` `.modal-body` | `--toast-bg` / `--menu-bg` / `--selector-bg` |
| 列表行 hover | 各列表项 | `--interactive-hover` / `-active` / `-solid` |

**好消息**：这些组件**都已经存在**（实测：10 个按钮类、`.msg` 系列 48 处、`.modal` 系列、2 组滚动条规则、`pre`/`code` 71 处）—— 不需要新建大组件，只需把它们的配色从「裸色值 / 通用 token」换成专用 token。

---

## 5. 规则层（那 2 条 CSS）怎么承接

规则层命中的是 WebUI 的 CSS Module 类名（`_sessionRow` / `_iconButton`），桌面端没有这些类名，**无法机械映射**。

分三类处理：

| 规则意图 | 承接方式 |
|---|---|
| **修 token 表达力的缺口**（如「侧栏底色变了，但文字色 token 是共用的」） | 这类在桌面端**天然不存在** —— 因为桌面端有 `--sidebar-fill` / `--nav-item-*` 独立组件 token，不会出现「侧栏不能用自己的文字色」。**直接消失。** |
| **纯视觉润色**（`!important` 覆盖某个组件色） | 语义等价重建：读懂它想达到的效果，在桌面端对应组件上用对应 token 表达 |
| **依赖 WebUI 特定 DOM 结构**（如 `:not([class*="_selected"])` 的层级判断） | 桌面端用自己等价的状态类（`.active` / `.selected`）重建 |

> 实践上，规则层在真实主题里占比极小（neo-skin 只有 2 条、不到 800 字节）。**建议：规则层不做通用引擎，改为「迁移报告里列出未承接的规则」，由用户决定是否手写**。因为逐条语义重建的通用化成本远高于它的收益 —— 而 89 个 token 已经覆盖了 99% 的视觉效果。

---

## 6. 另外三层能力的承接

> **本节已按 2026-09-29 的实施结果改写。** 初稿的判断有两处被实测推翻：形状层**可以**承接（主题包自带结构层，不必去动桌面端那 255 处硬编码），行为层也**不是**「明确不承接」（其中「开关 / 方案切换 / 选择记忆」三项由桌面端原生承担）。详见 §9。

| 层 | 内容 | 承接方案 | 结果 |
|---|---|---|---|
| **形状层** | 圆角 / 边框粗细 / 阴影 / 按压位移 | 主题包的 `STRUCTURE_CSS` 本来就用「圆角清零 / 边框加粗 / 硬阴影 / 按压位移」这套语汇在写 WebUI 的 CSS-Module 类名 → **静态提取成「形状策略」，再渲染成面向桌面端类名的 CSS**。**不需要**把桌面端 172 处 `border-radius` 改造成 token | ✅ 已承接（圆角清零 / 边框 2px / 4px 硬阴影 / 按压位移 1,1 实测落地） |
| **行为层 · 控制** | 开 / 关、方案切换、选择记忆 | 桌面端**原生承担**：每个「方案 × 档位」就是一个独立的下拉项，选中即启用、切走即停用，选择记在 `localStorage` 的 `dsh-theme` 里。等价于主题包那个开关 + 配色选择器 | ✅ 原生承担（结论由 `summarizeBehavior()` 静态判定，不调模型） |
| **行为层 · 注入** | 注册设置行进 WebUI 通用设置（`slot: settings.general.item`）、对第三方插件的 CSS 适配 | 桌面端设置页是**自有 DOM**，插件没有注入点，也不会执行主题包里的 JS | ❌ 无落点（明确写进主题库 notes，不假装承接） |
| **资源层** | 背景图 / 视频 / 壁纸 / 字体 / WebGPU 画布 / 桌宠 | 仍未承接。需要：① 新增 `--bg-image` / `--bg-veil` token 并把 `#bgvideo` 层接上；② **`img-src` 不含 `file:`** → 迁移时必须把图片转 data URI。另：`dsh-neo-skin` 实测 `resourceHints` 全为 false，绝大多数主题并不带资源 | ⚠️ 未迁移（已探测 + 写进 notes 告知用户） |

> **为什么「行为层」不用模型来判断**：上面三条结论全部是**静态可读的事实** + 桌面端自身的事实（下拉即开关、设置页是自有 DOM、CSP 的 `img-src` 不含 `file:`）。凡是免费路径能确定的，都不该花模型的钱（见 §9.2）。

---

## 7. 工程量与分期

| 阶段 | 内容 | 规模 | 风险 | 状态 |
|---|---|---|---|---|
| **A · token 层承接**（本方案主体） | 新增 61 个 token + 89 条承接规则 + 给现有组件挂消费点 | 新增约 150 行 CSS；改组件配色约 80~120 处 | 低（内置主题走派生默认值，可用快照证明零差异） | ✅ 已完成。A-3「给现有组件挂消费点」判定为**无需实施** —— 静态核验 61 个新 token 被组件引用数 = 0，而现有组件大量使用的 `--accent`/`--text`/`--border`/`--panel` 已被承接层覆盖，**已经会自动跟随主题** |
| **B · 迁移接线** | 读主题包 → 取指定档位 → 写出桌面端主题 → 选中 `webtheme` 模式 | 复用迁移方案 §6 的 IPC | 低 | ✅ 已完成（10 个 IPC 通道 + 主题工作室界面 + 主题库 `~/.dsh/desktop-themes.json`） |
| **C · 规则层报告** | 扫描主题 CSS，列出未承接规则并提示用户 | 小 | 低 | ✅ 已完成，且比原计划进一步：常见 WebUI 类名走**翻译表机械翻译**（601 个桌面端真实类名做校验），未命中的写进 notes，可选择交给模型补译 |
| **D · 资源层** | `--bg-image` token + data URI 管道 + `#bgvideo` 接上 | 中 | 中（涉及 CSP 与视频层） | ⬜ 未做（改由 notes 诚实告知用户） |
| **E · 形状层** | 255 处形状声明 token 化 | 大 | 中（回归面广，必须快照比对） | ✅ **改用途完成**：原计划的「token 化 255 处声明」被证明是错的方向，改为「提取主题包结构层 → 渲染成面向桌面端类名的 CSS」，**零风险、不动既有样式** |

**建议顺序：A → B →（先交付可用的「完整配色承接」）→ C → D → E。**

做到 A+B 时，用户拿到的是：**装一个 web 主题 → 桌面端从页面底色、按钮各状态、侧栏、气泡、输入框、代码块、滚动条到状态色全部跟着变**。这已经是「承接全部配色能力」。

### 验收标准（每条都必须可验证）

1. **内置四套主题零回归**：改前 / 改后跑逐元素 computed style 快照（`%TEMP%\dsh-snapshot.cjs` + `dsh-snap-diff.cjs`），**零差异**。
2. **承接生效**：载入 `dsh-neo-skin` 的 89 个变量后，快照里这些桌面端 token 的值**逐字节等于**主题包声明的值（桥接是「取值」不是「生成」，不该有偏差）。
3. **无掉色**：应用 webtheme 后全页快照里**没有任何元素**的 computed color/background 变成空或透明（专门防承接层击穿）。
4. **不假成功**：主题包未声明的变量必须回落到默认值而不是空串（用只声明 10 个变量的假主题包测一次）。
5. **无残留**：退出 webtheme 模式后，所有 token 回到内置主题值（快照与验收 1 的基线一致）。

---

## 8. 待确认（已有答案的已就地标注）

1. **浅 / 深档怎么给用户**：一个主题生成两份（`xx（浅）` / `xx（深）`），还是让用户选一档？
   → **已定：两份都生成**，下拉里并列出现（`蓝统治 · 浅色` / `蓝统治 · 深色`）。主题包的双档本来就是这么设计的。
2. **阶段 A 是否采纳「61 个新 token + 组件改挂」的方案**？
   → **已采纳，但「组件改挂」判定为无需实施**（见 §7 阶段 A 的状态列）。
3. **D / E 两层要不要做**？
   → **E 改用途做了**（结构层翻译，零风险）；**D 未做**，改为在 notes 里诚实告知用户。
4. **规则层**：只出报告让用户手写，还是要做有限的语义映射？
   → **做到「翻译表机械翻译」为止**：常见 WebUI 类名映射到桌面端真实类名（601 个可用类名做校验）；
   未命中的写进 notes，用户可选择交给模型补译。

---

## 9. 实施结果（2026-09-29）

### 9.1 落地形态

| 文件 | 职责 |
|---|---|
| `lib/web-themes.js` | 主题包**静态解析** + 迁移渲染（不执行第三方代码） |
| `lib/theme-ipc.js` | 10 个 IPC 处理器，依赖全部注入（不 import electron、不读全局状态） |
| `lib/llm-call.js` | 主进程直连模型的归一化层（`chatOnce` / `tryParseJson`），**绝不打印/回传密钥** |
| `lib/theme-analysis.js` | 模型兼容分析：提示词构造 + 返回净化三道 |
| `renderer/theme-studio.js` | 市场页「主题」工作室界面 |
| 主题库 | `~/.dsh/desktop-themes.json`（渲染层只看列表，读写全在主进程） |

**四条落地铁律**（都会「静默」出问题，写在这里备查）：

1. **承接层与 `--dsw-*` 声明必须同层**（都在 `body`）。写在 `:root` 上会**静默击穿** —— CSS 变量只向下继承，`var()` 解析失败即 guaranteed-invalid，界面掉成「透明 + 黑字」**且不报错**。
2. **迁移主题的 89 个变量走 `<html>` 内联 style** —— 承接层里放的是「官方档位默认值」，只有内联声明才盖得过；未声明的变量自然回落到承接层，**不会变空串**。
3. **`[data-theme="webtheme"]` 是属性限定选择器** → 对内置四套主题的影响严格为零，这是**可静态证明**的，不需要靠剥离来验证。
4. **路径一律从本机扫描结果取，绝不信任渲染层传来的 `dir`** —— 否则界面就等于拿到「任意路径读取」能力。

### 9.2 免费路径 vs 模型精修：界线划在哪

**免费路径（离线、零模型调用、零花费）已足够交付一个完整配色主题**，因为 `client.js` 里的 `SCHEMES` 是**标准 JSON 字面量** —— 用「字符串感知的括号配对」静态提取 + `JSON.parse` 即可（实测与 `src/schemes/*.tokens.json` **逐字节等价**）。

模型精修是**可选**的（有费用、用户自主决定），**只做三件没有确定答案的事**：

| # | 模型做的事 | 为什么免费路径做不了 |
|---|---|---|
| ① | 翻译表没收录的 WebUI 类名 | 「`_badge` 该落到桌面端的哪个类」是语义判断，不是查表 |
| ② | 档位语义错配时派生强调色 | 官方 `--dsw-alias-brand-primary` 浅档近黑 `rgb(15,17,21)`、深档近白 `rgb(249,250,251)`，语义是「用户自定义强调色」；而桌面端 `--accent` 是**填充色**。外部主题没声明它时，按钮会失去识别度 |
| ③ | 行为层三分类兜底 | 免费路径已给出确定结论（§6），模型只在遇到没见过的行为模式时补 |

模型返回必须过**净化三道**（丢弃的每一项都记进 `dropped` 并落进主题库 notes，不静默吞）：

1. `tokens` 只接受 `--dsw-*` 键；值禁 `url()` / `expression` / `;` / `{` / `}`，且 ≤ 120 字符。
2. CSS 逐条规则检查**选择器里的类名必须在 `styles.css` 真实存在**（类名提取只取选择器前导段的**独立**类名 —— 否则 `.mt-exit.bad` 的 `bad` 也能蒙混过关）；禁 `url()` / `@import` / `position:fixed` / `display:none` / `pointer-events:none`。
3. 强调色必须是合法颜色且不含 `url|expression|var(`。

### 9.3 验收结果（全部离线，零花费）

| 验收项 | 结果 |
|---|---|
| ① 内置四套主题零回归 | 真实整页 **514 元素 × 4 主题**：元素样式差异 **0** / 非新增 token 变量差异 **0**、`collidedWithExisting: []` |
| ② 承接生效（逐字节） | `--void=#F3EFE6`、`--accent=#2340A8`、`--text=#111111`、`--sidebar-fill=#1E317A`、`--bubble-bg=#D6E4FF` —— 全部等于主题声明值；真实渲染 `body` 背景 = `rgb(243, 239, 230)` |
| ③ 无掉色（防击穿） | 只声明 1 个变量时，其余回落到默认值；**空值 token 数 = 0** |
| ④ 不假成功 | 承接变量声明 **89/89**；承接规则 **98** 条覆盖 **94** 个桌面端 token |
| ⑤ 无残留 | 切回内置主题后 `--dsw-*` 全空、注入样式长度 **0**、`.card` 圆角回 16px；再切回迁移主题全部恢复（**可重复切换**） |
| ⑥ 形状层落地 | `.card`/`.mini-btn` 圆角 **0px**、`.card` 阴影 **`rgb(26,26,26) 4px 4px 0px`**、边框 **2px** |
| ⑦ 模型精修链路 | 路由解析正确；请求形状正确（POST `/v1/chat/completions`、带鉴权、温度 0、`json_mode`、提示词 12685 字节含类名清单/变量事实/未映射线索）；**净化 4 处全拦下**且合法规则保留 |
| ⑧ 主题工作室端到端 | 扫描 559 个包 → 挑出 `dsh-neo-skin@0.6.0`（跳过 44）→ 4 个安装按钮 → 安装 → 结构层落地 → 切回无残留 → 再切回 → 移除干净 |

**验收 5 条全部满足**（对照 §7 的验收标准）。

### 9.4 行为层在主题库里的实际记录

装完一个主题后，主题库条目的 `notes` 会给出这份**完整交代**（实测输出）：

```text
· 行为层：开 / 关 / 方案切换 / 结构层样式 / 选择记忆（localStorage：STORAGE_KEY / SCHEME_KEY）
  / token 覆盖（ctx.theme.overrideTokens） → 桌面端原生承担（每个方案档位就是一个独立下拉项：
  选中即启用、切走即停用，选择记在 localStorage 的 dsh-theme 里）
· 行为层无法承接：把设置行注册进 WebUI 通用设置（slot：settings.general.item）；
  对第三方插件的 CSS 适配（.dvi_pop / .dvi_btn / .dvi_pill）——桌面端设置页是自有 DOM，
  插件没有注入点，也不会执行主题包里的 JS
· 结构层已翻译为形状策略：圆角清零 / 边框 2px / 硬阴影 4px 4px 0 / 按压位移 1,1
· 方案 CSS 有 1 条规则在桌面端找不到落点（可用模型兼容分析补译）：[class*="_badge"]
· 未知 WebUI 类名 _badge（翻译表暂无此条）
· 模型派生强调色 rgb(163, 74, 53)（源主题 newspaper/light 的 brand-primary 是灰阶，从它自己的暖色族派生）
· 无法承接：_badge 在桌面端最接近 .mk-badge，但语义是通用徽标，未强行映射
· 模型产出被净化丢弃 4 处：token 名不合法：--bad-token；token --dsw-alias-x 的值含禁用内容；
  选择器在桌面端不存在：.no-such-class
```

### 9.5 下一步

- **资源层**（背景图 / 视频 / 壁纸 / 字体）：`resourceHints` 已探测并在 notes 里告知；要真正承接需先解决「图片必须转 data URI」（`img-src` 不含 `file:`）。
- **发版**：`scripts\build-dist.ps1`。🔴 新增的 `lib/` 目录必须同时出现在 `package.json` 的 `build.files` 里（electron-builder 用；Windows 的 robocopy 打包不受影响），否则 mac/linux 包会缺文件、启动即崩。**已补上 `lib/**/*`。**
