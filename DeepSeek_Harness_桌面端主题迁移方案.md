# DSH Desktop · 桌面端主题迁移方案（设计稿）

> 状态：**待评审**（2026-09-29，含一轮实测修正）
> 目标读者：项目作者
> 关联文档：`DeepSeek_Harness_星空主题设计系统.md`（桌面端 token 体系）
>
> **修正记录**：初稿假设「必须调模型做语义迁移」。补做一次离线实测后（§2.5）确认存在一条**免费、离线、零模型调用**的主路径 —— 桥接表 + CSS 级联（§2.2 路 A），模型降级为可选精修。同时实测暴露了两个会导致静默掉色的陷阱（§2.3），已写成硬约束。

---

## 1. 要解决的问题

市场里的 152 款社区主题只作用于 **Harness Web 界面（webUI）**，对桌面端（Electron）界面没有任何效果。原因已实测确认：

- 这些主题的 `package.json` 声明 `dsh.client = { platform: "web", inject: ["@deepseek-ai/dsh-client-ui-theme"] }`，覆盖的是 Web 端的 `--dsw-alias-*` 设计 token；
- 桌面端是独立的 Electron 界面，用自己那套 `light / graphite / dark / custom` 主题与 `--*` token，**两者之间没有任何样式通道**（桌面端全仓零条 CSS 规则引用 `--dsw-*`，已实测）。

期望结果：**用户装上社区主题后，能再走一步「迁移到桌面端」，把它的配色搬到桌面端界面上**，让插件市场对桌面端也有意义。

好消息是：**通道是可以架起来的**，而且不需要每次都动模型 —— 架设方式与实测依据见 §2。

---

## 2. 两条实现路径（含实测依据）

> 本节结论来自一次离线实测：Electron 加载桌面端**真实的** `renderer/styles.css`，逐步注入并观察 token 解析结果与真实渲染值。原始数据见 §2.5。
>
> ⚠️ **本轮实测修正了初稿的一个隐含前提**：初稿默认「必须调模型翻译」。实测后确认存在一条**免费、离线、零模型调用**的主路径（§2.2 路 A），模型降级为可选的精修环节。

### 2.1 先确认边界：两套命名空间零交叉

| | WebUI（引擎 :3080） | 桌面端（Electron） |
|---|---|---|
| token 体系 | **354 个** `--dsw-*`，其中 **80 个** `--dsw-alias-*` 语义别名 | **50 个**自有 token（`--accent` / `--void` / `--text` …） |
| 定义位置 | `design-platform.css`，挂在 `body` / `body[data-ds-dark-theme]` | `renderer/styles.css`，挂在 `:root` / `:root[data-theme=…]` |
| 消费方 | WebUI 自己的组件 | 桌面端自己的组件 |
| 交叉引用 | — | **零条 CSS 规则读 `--dsw-*`**（全仓仅 `market.js` 一行注释提及） |

实证（§2.5 的 B0 步）：把整份 `design-platform.css` + 一份模拟主题覆盖注入桌面端页面后 ——

```
body  --dsw-alias-brand-primary: rgb(200, 60, 40)          ← 值确实进来了
body  --dsw-static-neutral-bluish-00: rgb(255, 255, 255)   ← 调色板层也自包含
root  --accent: #00d4aa                                    ← 桌面端纹丝不动
渲染  按钮底色: rgb(0, 212, 170)                            ← 界面完全没变
```

**结论：「把主题的 CSS 原样注入桌面端」单独做是无效的** —— 变量被定义了，但没有任何规则去读它。（顺带确认：官方 `design-platform.css` 只有 338 行，调色板层与别名层、浅色档与深色档**四段全在同一份文件里且都挂在 `body` 上**，是一个自包含、可直接注入的单元 —— 但正如上面所示，注入它对桌面端毫无用处。）

### 2.2 两条路，建议叠加使用

**路 A · 桥接层（主力；免费、离线、零模型调用、零延迟）**

在桌面端加一段固定的桥接规则，把 web 的 `--dsw-alias-*` 接到桌面端自己的 token 上：

```css
/* renderer/styles.css —— 写一次，约 43 条 */
:root[data-theme="webtheme"] body {
  --void:     var(--dsw-alias-bg-base);
  --accent:   var(--dsw-alias-brand-primary);
  --text:     var(--dsw-alias-label-primary);
  --text-dim: var(--dsw-alias-label-secondary);
  --border:   var(--dsw-alias-border-l2);
  /* … 其余颜色键 */
}
```

之后每个主题只需三步（全是字符串操作，不需要「理解」任何东西）：

1. 读主题包 CSS，取出它声明的 `--dsw-alias-*` 覆盖值
2. 注入一个 `<style>`（CSP 已允许 `style-src 'unsafe-inline'`）
3. 给 `body` 挂 `data-ds-dark-theme`（浅/深档）+ 给 `html` 挂 `data-theme="webtheme"`

桌面端 50 个 token 通过 **CSS 级联自动拿到值**。实测（§2.5 的 B2 步）传导成立：

```
body  --accent: rgb(200, 60, 40)                                        ✅
body  --void:   rgb(250, 249, 245)                                      ✅
渲染  背景 rgb(200,60,40) / 文字 rgb(28,25,23) / 边框 rgba(28,25,23,0.12)  ✅
```

**路 B · 语义修正（可选，用模型；只处理桥接表覆盖不到的部分）**

模型只在两种情况下被需要：

- 主题改了桥接表**没有映射**的 `--dsw-*` → 让模型建议新增映射；
- 需要**语义判断**：这个主题偏暖还是偏冷？深色档下强调色该不该提亮？

⚠️ 语义判断不是「锦上添花」，而是真实需求 —— 实测发现 web 的 `brand-primary` 在**深色档下是 `rgb(249,250,251)`（近白）**，因为它的语义是「深色底上的高亮文字色」；而桌面端 `--accent` 是**当填充色用**的（按钮底色、边框、发光）。机械对接会得到**白底白字**。所以桥接表**必须按档位分别设计**，这一步需要判断，不能纯字符串搬运。

### 2.3 两个必须避开的陷阱（实测发现）

**陷阱一：桥接表写在 `:root` 上会「静默击穿」整个界面**

```
B1 步（桥接写在 :root[data-theme="webtheme"] 上）实测：
  --accent: ""            ← 空
  --void:   ""            ← 空
  --text:   ""            ← 空
  --glow:   ""            ← 空
  渲染：背景 rgba(0,0,0,0)（透明）、文字 rgb(0,0,0)（黑）
```

原因：`--dsw-*` 定义在 **`body`** 上，而 `:root`（`html`）是 body 的**父元素** —— CSS 变量只向下继承，html 上看不到 body 的变量，`var()` 解析失败 → 自定义属性变 guaranteed-invalid → **所有引用它的地方一起失效**。而且**不报错**，界面只是悄悄掉成透明+黑字。

> **硬约束：桥接规则必须落在定义 `--dsw-*` 的那个元素（`body`）上。**
> 若出于一致性也要写一份到 `:root`，必须带 fallback：`var(--dsw-alias-brand-primary, var(--cyan))` —— 否则整站掉色。

**陷阱二：档位特异性会盖掉主题**

实测 C 步（给 body 挂 `data-ds-dark-theme` 后）：主题写在无档位 `body{}` 里的覆盖，被官方 `body[data-ds-dark-theme]`（特异性更高）**整个盖掉**：

```
--dsw-alias-brand-primary: rgb(249, 250, 251)   ← 官方 dark 档赢了，主题声明的 rgb(200,60,40) 没了
```

这证实官方双档机制真实在跑（也正是官方注释要求「两档都填」的原因）。**读主题 token 时不能只贪图「它声明的那些值」**：必须区分主题是在哪个档位声明的，并明确我们要取哪一档。

### 2.4 桥接层的两种落地形态

**模式 1（推荐）：迁移时求值 → 固化成桌面端主题 JSON**

- 本地读主题 CSS → 按桥接表取值（字面值直接用；若是 `var(--dsw-static-*)` 引用，去 `design-platform.css` 的调色板层查表）→ 产出桌面端 token JSON；
- 落盘成**普通桌面端主题**，运行时零特殊逻辑，不需要往页面注入任何 CSS；
- 天然可预览、可手改、可导出，与阶段一（§10）的主题仓库完全复用同一套；
- 纯本地字符串处理，**毫秒级、零成本、可离线**。

**模式 2（备选）：运行时注入 + 常驻桥接 CSS**

- 保留 `--dsw-*` 的动态性，主题包更新时自动跟随；
- 代价：需在渲染进程注入任意 CSS、需自己处理两档切换与级联顺序、调试面更大。

> 推荐模式 1：它与桌面端现有「主题 = 一组 token 值」的架构同构，且把风险收敛在迁移时一次。

**关键点：「桥接」本身不花钱。** 花钱的只有路 B 的语义修正，而它完全可以做成可选。

### 2.5 原始实测数据

- 脚本：`%TEMP%/bridge-test/probe.cjs`（Electron offscreen，加载真实 `renderer/styles.css`）
- 输出：`%TEMP%/bridge-test/result.json`
- 步骤：A 基线 → B0 注入原 CSS 无桥接 → B1 桥接在 `:root` → B2 桥接在 `body` → C 切深色档 → C2 摘掉深色档（验证可逆）

> `%TEMP%` 是临时路径，若要长期保留请把脚本移入 `scripts/`。测试用的模拟主题覆盖写的是**无档位**的 `body{}`，这正是陷阱二被触发的原因。

---

## 3. 数据契约

### 3.1 输入（源语言）

来源优先级：

| 优先级 | 来源 | 说明 |
|---|---|---|
| 1 | **主题包注入的 CSS 文本**（`--dsw-alias-*` 覆盖规则） | **路 A 的主输入**。直接可解析，无需模型；若值是 `var(--dsw-static-*)` 引用，去 `design-platform.css` 的调色板层查表还原 |
| 2 | 主题包内的声明式源码 | `src/*.ts` / `*.json` / `schemes.json` 之类，最干净最便宜 |
| 3 | 构建产物 `client.js` 里的 `tokens` 字面量 | 已确认 `dsh-neo-skin` 的 `SCHEMES` 是纯 JSON 字面量（`{"--dsw-alias-bg-base":{"light":"#F3EFE6","dark":"#0D111C"}, …}`），可直接用正则截取 |
| 4 | 截断后的源码片段直接交给模型抽取 | 兜底。限制体积（≤64 KB） |

> 来源 1 与 2/3 是**互补**的：CSS 给的是「最终生效的字面值」，声明式源码给的是「作者意图 + 双档结构」。路 A 优先取 1，取不到再退到 2/3。

读取路径：`{DSH_HOME}/profiles/web/node_modules/{pkg}/`（Windows 下 `{DSH_HOME}` 即 `%USERPROFILE%\.dsh`）。

**源 token 全集**：`--dsw-alias-*` 共 **80 个**（来自 `packages/client/ui-theme`）：

| 分组 | 个数 | 示例 |
|---|---|---|
| `button-*` | 15 | `button-primary-fill`、`button-floating-hover` |
| `bg-*` | 13 | `bg-base`、`bg-layer-1..3`、`bg-overlay`、`bg-mask-1..3` |
| `state-*` | 11 | `state-success-primary`、`state-warn-tertiary`、`state-error-primary` |
| `label-*` | 9 | `label-primary`、`label-secondary`、`label-dimmed`、`label-primary-foreground` |
| `markdown-*` | 8 | `markdown-code-block`、`markdown-inline-code` |
| `border-*` | 7 | `border-l1..l4`、`border-inverted` |
| `scrollbar-*` | 5 | `scrollbar-bg-l1`、`scrollbar-hover-l1` |
| `interactive-*` | 5 | `interactive-bg-hover`、`interactive-bg-active` |
| `brand-*` | 4 | `brand-primary`、`brand-text` |
| `toast-bg` / `tooltip-bg` | 2 | |

### 3.2 输出（目标语言）

桌面端 `:root` 共 **50 个 token**（`renderer/styles.css` 首块，`:root` 与 `data-theme="dark"` 共用）。分为：

**颜色 / 层次（约 26 个）**
`--void` `--nebula-navy` `--abyss` `--deep` `--deep-2` `--deep-3` `--chrome` `--bg` `--panel` `--panel-hover` `--float` `--text` `--text-dim` `--placeholder` `--border` `--border-strong` `--overlay` `--shadow` `--shadow-card` `--on-accent` `--violet-text` `--starlight` `--dust` `--cyan` `--violet` `--gold` `--orange`

**语义状态（5 个）**
`--accent` `--accent-2` `--accent-3` `--warn` `--ok` `--danger` `--info` `--info-bg`

**发光（5 个）**
`--glow` `--glow-2` `--glow-3` `--glow-warn` `--glow-danger`

**渐变（3 个）**
`--gradient-nebula` `--gradient-aurora` `--gradient-horizon`

**非颜色（7 个）**
`--font-sans` `--font-display` `--font-mono` `--ease-light` `--ease-orbit` `--ease-space` `--ease-warp`

> 对比：现有 light / graphite 两套主题各覆盖 **42 个**，dark 覆盖 50 个 —— 即一份完整主题不需要填满全部 50 个，缺的键回落到基础值即可。

---

## 4. 桥接表（路 A 的核心资产）

`--dsw-alias-*` → 桌面端 token 的对照。这张表写死在代码里，**是免费路径的全部「智能」所在** —— 它的质量直接决定迁移保真度，而且写一次即可复用于所有主题。

> 与初稿的差别：初稿把它定位成「覆盖八成的启发式打底，剩下两成交给模型」。实测后改为 **「它就是主路径，模型只补它没覆盖到的新 token 与档位语义判断」**。

**这张表必须按档位分列**（浅/深各一套），原因见 §2.2 路 B 的白底白字问题：Web 的 `brand-primary` 在浅档是**可作填充的品牌色**、在深档却是**近白的高亮文字色**，两者在桌面端的落点不同。下表合并展示，实现时应拆成两个结构（或在意向不同的行标注 `浅档→X / 深档→Y`）。

| Web 端（源） | 桌面端（目标） | 备注 |
|---|---|---|
| `bg-base` | `--void` `--bg` `--deep-2` | 页面底色 |
| `bg-layer-1` | `--nebula-navy` | 一层容器 |
| `bg-layer-2` | `--deep` `--chrome` | 二层容器 |
| `bg-layer-3` | `--deep-3` | 三层容器 |
| `bg-overlay` | `--panel` | 面板/弹层（源为不透明色，需按 alpha 折算透明度） |
| `bg-multi-select` / `bg-module-platform` | `--float` | 浮层/次级底 |
| `bg-mask-1..3` | `--shadow` `--shadow-card` | 遮罩 → 阴影色 |
| `label-primary` | `--text` `--starlight` | 正文 |
| `label-secondary` | `--text-dim` | 次要文字 |
| `label-tertiary` / `label-caption` | `--dust` | 弱化文字 |
| `label-dimmed` | `--placeholder` | 占位符 |
| `label-primary-foreground` / `brand-primary-invert` | `--on-accent` | 强调色上的文字 |
| `border-l2` / `border-l1` | `--border` `--border-strong` | 描边（按 alpha 折算） |
| `brand-primary` | `--accent` `--cyan` | 主强调色。**⚠️ 档位语义不同**：浅档可当填充色直接接 `--accent`；深档是近白的高亮文字色（实测 `rgb(249,250,251)`），直接接会白底白字，需改接 `--text` / `--violet-text` 或降亮度后使用 |
| `brand-text` | `--violet-text` | 强调文字 |
| `state-success-primary` | `--ok` | |
| `state-warn-primary` | `--warn` `--orange` | |
| `state-error-primary` | `--danger` | |
| `state-business-primary` | `--info` | |
| `state-business-tertiary` | `--info-bg` | |
| （无直接对应） | `--accent-2` `--accent-3` `--violet` `--gold` | **需模型判断**：从整体色相里挑两个辅助色 |
| （无直接对应） | `--glow*` | **需模型判断**：深色背景下是否给霓虹；浅色主题一律置 `transparent` |
| `markdown-*` / `scrollbar-*` / `button-*` / `interactive-*` | — | 桌面端没有对应组件，忽略 |
| 主题声明的字体族（若有） | `--font-sans` `--font-display` `--font-mono` | 只在源里明确声明时才迁移 |

### 模型真正该干的三件事

桥接表覆盖不到的地方，才是模型的价值所在。按优先级：

1. **档位语义判断**（最实在的一项）—— 同一个 `brand-primary` 在浅/深档是两种性质的颜色，该落到桌面端哪个键、要不要调整明度，需要判断「这个值当前是当填充用还是当文字用」。
2. **补桥接表没覆盖的 token** —— 主题声明了表外的新 `--dsw-*`，让模型建议落点（长期可把结论沉淀回桥接表，下次就免费了）。
3. **无对应键位的推断项** —— 桌面端比 web 多出「辅助强调色」（`--accent-2` / `--accent-3`）和「发光强度」（`--glow*`）两类概念，源语言里没有对应 token。确定性逻辑给安全兜底（由主色推导同族色 / 浅色主题一律 `transparent`），模型可读主题描述判断「暖纸感还是冷科技感」给出更贴的值。

注意 1 和 2 都是**一次性投入**：判断结论可以写回桥接表，之后同类主题不再需要模型。这也是把「桥接表」当核心资产的另一个理由。

---

## 5. 处理流水线

```
[1] 定位     列出 profiles/web/node_modules 下 category=theme 的已装包
              ↓
[2] 取源     按 §3.1 优先级读 token 覆盖表（≤80 键 × {light,dark}）
              ↓
[2.5] 桥接   路 A：查桥接表（按目标档位分别取值）→ 得到桌面端 token 草稿
             ★ 免费、离线、毫秒级。走到这一步已经产出可用主题。
              ↓
[3] 修正     路 B（可选，默认整体跳过）：
                仅在 [2.5] 有未覆盖的 token / 档位语义存疑 / 需要推断辅助色与发光时才走
                输入 = 主题名 + 描述 + 源 token 表 + 桌面端 token 语义 + [2.5] 的草稿
                输出 = 严格 JSON（只含白名单键）
              ↓（可跳过）
[4] 校验     白名单 + 值格式校验；模型缺的键用 [2.5] 补齐；非法项丢弃并记录
              ↓
[5] 预览     并排展示「应用前 / 应用后」缩略对比，可切换浅色/深色版
              ↓
[6] 落地     写入桌面端主题仓库（JSON），刷新主题管理列表
```

> 关键：**默认路径不含模型调用**。[2.5] → [4] → [5] → [6] 就是一条完整的、不花钱的迁移。用户在向导里主动勾选「使用模型精修」时才插入 [3]。

### 校验规则（硬性）

- 键：必须命中 50 个白名单 token 之一，其余一律丢弃。
- 值：仅接受这些形状 ——
  - 颜色：`#rgb` / `#rrggbb` / `#rrggbbaa` / `rgb()` / `rgba()` / `hsl()` / `hsla()` / `color-mix(...)` / `transparent`
  - 渐变：`linear-gradient(...)` / `radial-gradient(...)`，内部颜色同样校验
  - 字体：字母 / 数字 / 空格 / 逗号 / 引号 / 连字符，长度 ≤ 200
  - 缓动：`cubic-bezier(...)` / `ease` / `ease-in-out` / `linear` / `steps(...)`
- **拒绝**任何含 `url(` `@import` `expression(` `;` `}` `\` `<` `>` 的值。
- 校验失败不阻断流程：丢弃该项并回落到映射器结果，预览页标注哪几个键被替换。

---

## 6. IPC 契约（新增）

全部在 `main.js` 注册、`preload.js` 暴露。**只读 + 白名单是硬约束。**

### 6.1 `theme:listWebThemes` → 列出可迁移的已装主题

```
出参: [{ pkg, displayName, version, sourceUrl, hasTokens, lightDarkPairs, migrated: { lightId, darkId } | null }]
```
实现：读 `profiles/web/package.json` 的 `dependencies` + `dsh.profile.bundles`，对每个包读自己的 `package.json` 判断 `dsh.client.platform === 'web'`。

### 6.2 `theme:readWebThemeTokens { pkg }` → 取 token 覆盖表

```
入参: { pkg: string }
出参: { ok, source: 'src'|'client.js'|'raw', tokens: { '--dsw-alias-bg-base': { light, dark }, ... }, rawSize }
```
**路径约束**：拼出的绝对路径必须在 `{DSH_HOME}/profiles/web/node_modules/` 之下且 `path.relative()` 结果不以 `..` 开头；文件名禁 `..`、禁绝对路径；只读文本扩展名（`.js .mjs .cjs .json .ts .mts .css`）；单文件上限 512 KB。违反任一条件直接返回 `{ ok:false, error }`。

### 6.3 `theme:migrate { pkg, useModel, provider, baseURL, apiKeyEnv, model }` → 执行迁移

```
出参: {
  ok,
  usedModel: boolean,
  modelNote: string,               // 例如「模型未配置，已使用内置映射」
  themes: [ { id, label, tokens, replacedKeys: [], invalidKeys: [] }, ... ]
}
```
主进程内：取源 → 打底 → （可选）调模型 → 校验 → 返回。**不落盘**，由渲染层预览确认后再调 `theme:saveDesktopTheme`。

调模型复用现有基建 —— 但有一个**前置小改动**：`lib/model-probe.js` 里的两个工具函数目前是模块内部的，`module.exports` 只导出了 `probeModelCapabilities` / `ENGINE_LEVELS` / `WIRE_CANDIDATES`：

- `joinUrl(baseURL, suffix)`（第 59 行）
- `request(url, { method, apiKey, headers, body, timeoutMs })`（第 64 行，返回 `{ status, text, ok }`，不抛网络异常）

建议**把这两个函数抽到新的 `lib/llm-call.js`**，并新增一个语义化包装：

```js
// lib/llm-call.js
async function chatOnce({ baseURL, apiKey, model, messages, maxTokens = 4096, temperature = 0, jsonMode = true })
//   → POST {baseURL}/chat/completions
//   → 返回 { ok, text, status, error }
```

然后 `model-probe.js` 改为从这个新模块引入（纯重构，行为不变），迁移逻辑也用它。这样「单次补全」成为一处可复用的能力，而不是散在探测代码里。

密钥解析用 main.js:1503 的 `readCredentialPlaintext(apiKeyEnv)` 读 `~/.dsh/.credentials.yaml`，与 `llm:probeCapabilities`（main.js:1525）完全同一条路径 —— 密钥不回渲染进程。

参数建议：`temperature: 0`、`stream: false`、`max_tokens: 4096`、`response_format: { type: 'json_object' }`（端点不支持时去掉该字段重试一次）。

### 6.4 `theme:saveDesktopTheme { id, label, tokens }` / `theme:deleteDesktopTheme { id }`

写入 `{userData}/desktop-themes/{id}.json`（与现有 `notify-prefs.json` 同一目录，已有写入先例）。同样走白名单 + 值校验。

---

## 7. 桌面端渲染层改动

### 7.1 主题管理（新增设置模块）

放在设置页「外观」模块下方，列出：

- 内置主题：浅色 / 深色 / 深空 / 自定义
- 迁移来的主题：`Neo 蓝统治（浅）`、`Neo 蓝统治（深）` …（每项带「删除」「导出 JSON」）
- 「导入主题 JSON」按钮

`setTheme()` 需要从「编译期常量」改成「动态注册表」：`THEMES` 常量换成运行时集合，`<select>` 的选项动态生成。这一步是必要的地基。

### 7.2 自定义主题升级

现状：2 个颜色选择器（主色 + 背景），只写 5 个变量。
改为：完整 token 编辑器（按分组折叠：层次 / 文字 / 强调 / 状态 / 发光 / 字体）+ JSON 导入导出。

### 7.3 市场「已安装」页新增「桌面端主题」分区

只列 `category === 'theme'` 的已装插件，每项两态：

- **WebUI 已生效**（`activation.state === 'live'`）+ `尚未迁移到桌面端` → 显示「迁移到桌面端」按钮
- 已迁移 → 显示「已迁移（浅/深）」+「重新迁移」「删除桌面端主题」

点击「迁移到桌面端」的流程：

1. 提示框：说明**迁移后才会在桌面端生效**，且需要调用模型做兼容性迁移、**会产生费用**（附带一句大致量级说明）。
2. 让用户选「使用哪个已配置的模型」或「不用模型（用内置映射）」。
3. 执行 → 预览对比 → 应用。

---

## 8. 降级与安全

| 场景 | 行为 |
|---|---|
| 未配置任何模型 | **这不是降级，是默认路径**。桥接层照常产出主题，向导里「使用模型精修」选项置灰并说明原因 |
| 模型调用失败 / 额度用尽 / 超时 | 直接使用桥接层结果（本来就已经产出且可用），只提示「精修未生效」，不影响任何功能 |
| 模型返回非法 JSON | 尝试一次修复（去掉 markdown 代码块包围、截取第一个最外层 `{}`）；仍失败则用桥接层结果 |
| 主题声明的 token 全是 `var(--dsw-static-*)` 引用而非字面值 | 去 `design-platform.css` 的调色板层查表还原；查不到则记录该键并回落桌面端基础值 |
| 桥接表未覆盖某 token | 记录到「未映射清单」，界面提示「有 N 个 token 未映射，可选用模型补全」，不阻断 |
| 读不到 token 表 | 报明确原因（包未装 / 无 token 声明 / 文件超限），不做静默兜底 |
| 注入的 CSS（模式 2 才涉及） | 只写 token 值，不引入任何 `url()` / `@import`；CSP 已有 `style-src 'self' 'unsafe-inline'`，无需改动 |
| 落盘的主题 JSON | 白名单 + 值格式双重校验；拒绝含 `url(` `@import` `expression(` `;` `}` `\` `<` `>` 的值 |
| 磁盘读取 | 限定目录 + 扩展名白名单 + 体积上限 + 禁 `..` |

---

## 9. 已知限制（必须对用户讲明）

**迁移得到的是配色，不是皮肤。** 这不是实现偷懒，而是**目标格式的表达力上限** —— 出口只有 50 个键位，其中 43 个是颜色。原因逐层展开：

1. **两套命名空间零交叉**（§2.1）：桌面端零条 CSS 规则读 `--dsw-*`，所以「把原主题 CSS 注入桌面端」本身不产生任何效果（已实测）。
2. **能通过的只有 43 个颜色键 + 5 个发光键 + 3 个字族键 + 4 个缓动键**。
3. **被挡在门外的是**：圆角 / 边框粗细 / 阴影模糊 / 间距（桌面端**没有形状 token**，`.card` 里的 `border-radius: 14px` 是硬编码的）、背景图与纹理（没有「背景图」token 位，且 CSP 的 `img-src` 不含 `file:`）、布局结构（由 HTML 决定）、主题自带的 JS 行为（桌面端不加载主题包的 `client.js`）。

因此：

| 主题 | 迁得动 | 迁不动 |
|---|---|---|
| `dsh-neo-skin` | 黑白撞色 + 硬朗边框的**配色** | 2px 硬边框、锐角、按下反馈 |
| `ikun-theme-skin` | 星蓝昼/夜配色 | 全屏壁纸轮播、音乐盒、发送语音效 |
| `dsh-paper-position` | 纸感色温 | 纸纹、衬线字排版（字体族可迁，排版不行） |
| `dsh-cyber-particle` | 青蓝配色 | 粒子动效背景 |

**所以 UI 上必须说成「迁移主题配色」，而不是「把主题搬到桌面端」**，否则用户迁完会觉得「不像」。

> 反过来说：**配色恰恰是用户感知最强的部分**（换色 = 换了个应用）。把口径说清楚，用户对「像不像」的预期就会对齐。

### 若要拿到结构感（可选的第三阶段）

给桌面端补一批**形状 token**：`--radius-card` `--radius-btn` `--border-width` `--shadow-blur` `--shadow-offset` 等，把现在硬编码在 `.card` / `.btn` 里的值提出来。这样迁移产物就能表达「硬边框 + 锐角」这类特征。

代价：改动面较大（需要把组件里散落的 `border-radius` / `border-width` / `box-shadow` 全部提出成变量），且有回归风险，建议单独一轮做，并用逐元素 computed style 快照比对验收（本项目已有这套工具）。

---

## 10. 分阶段任务

### 阶段一 · 容器（不依赖模型，先做）

1. 设置页新增「主题管理」模块（列出 / 切换 / 删除 / 导入导出）
2. `THEMES` 从编译期常量改为运行时注册表，`<select>` 动态生成
3. 「自定义」升级为完整 token 编辑器 + JSON 导入导出
4. 新增 `theme:listDesktopThemes` / `theme:saveDesktopTheme` / `theme:deleteDesktopTheme` / `theme:importDesktopTheme`
5. 验收：能导入一份手写的主题 JSON，切换后界面整体换色；删除后回落内置主题；主题下拉项动态正确

### 阶段二 · 迁移（本方案核心）

6. `theme:listWebThemes` + `theme:readWebThemeTokens`（含路径 / 体积约束）
7. **桥接表**（§4）：拆浅 / 深两套结构，先覆盖 `--dsw-alias-*` 主体；实现取值逻辑（字面值直用 / `var(--dsw-static-*)` 去调色板层查表还原）
8. `theme:migrate`：取源 → 桥接求值 → 校验。**这条路完全不涉及模型，先跑通并独立交付**
9. 抽出 `lib/llm-call.js`（迁 `joinUrl` / `request`，新增 `chatOnce`），`model-probe.js` 改为引用它（纯重构，行为不变，改完跑一次模型能力探测回归）
10. 接入可选的路 B（模型精修）：`temperature 0` / JSON 输出 / 一次修复重试 + 校验合并 + 「未映射清单」回显
11. 市场「已安装」页新增「桌面端主题」分区 + 迁移向导（先免费迁移；「用模型精修」作为可选第二步，含费用提示与模型选择）
12. 验收：
    - 拿 3 个真实主题（`dsh-neo-skin` 硬朗、`ikun-theme-skin` 高饱和、`dsh-paper-position` 低饱和暖色）各迁一次，出浅 / 深两版，人工看配色是否协调；
    - **色值保真度核对**：产物里每个键的色值，应与主题包 CSS 里声明的值（或调色板层查表结果）**逐字节一致**。桥接路径是「取值」不是「生成」，不该有偏差 —— 这条断言能一次性证明桥接表的实现是对的；
    - 断网 / 未配模型两种场景各走一次（预期：完全正常，因为默认路径不用网络也不用模型）；
    - 用「逐元素 computed style 快照」确认应用主题后桌面端**无元素掉色**（专门防 §2.3 陷阱一的静默击穿）。

### 阶段三 · 结构感（可选）

13. 补形状 token（第 9 节），把散落的 `border-radius` / `border-width` / `box-shadow` 提成变量
14. 迁移产物支持写形状 token；用快照比对验收无回归

---

## 11. 待确认问题

1. **桥接层用模式 1 还是模式 2？**（§2.4）推荐模式 1（迁移时求值、固化成普通主题 JSON）：与现有「主题 = 一组 token 值」架构同构，运行时零特殊逻辑，风险收敛在迁移那一刻。代价是主题包升级后需重新迁移。若你更看重新增主题零操作、主题更新自动跟随，就选模式 2。
2. **费用提示怎么写才既诚实又不吓人？** 现在默认路径**不花钱**，所以提示口径可以改成：先告诉用户「可以直接免费迁移」，再把「用模型精修」摆成可选升级项（说明它擅长什么、为什么不免费）。实测输入约 80 键 × 2 档（几 KB），输出一份 JSON，属于结构化映射任务，用便宜模型即可 —— 是否给出「约等于一次普通对话」的量级说明？
3. **迁移产物的命名**：`{主题名}（浅）` / `{主题名}（深）` —— 是否够清楚？
4. **是否允许用户手改迁移结果？** 预览页给一个「微调」入口（复用阶段一的 token 编辑器）会更完整，但也会拉长阶段二的界面工作量。
5. **阶段三（结构感）要不要做？** 不做的话，所有迁移结果都只是「换色」，宣传口径必须相应克制（§9）。这是「门」的问题 —— 无论用不用模型都得做才能突破。
