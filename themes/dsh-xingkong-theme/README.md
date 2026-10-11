# dsh-xingkong-theme · Nebula Core 星空主题

DeepSeek Harness WebUI 主题。**深色 = 深空观测站**，**浅色 = 黎明星云**，两套都是完整设计，
不是「深色换个底色」。

## 预览

**浅色 · 黎明星云** —— 正文白字 + 柔和深影，压在壁纸上也读得清；任务面板与状态条同族淡蓝：

![浅色模式](docs/screenshots/light.jpg)

**深色 · 深空观测站** —— 同一套布局与排版，不是换个底色：

![深色模式](docs/screenshots/dark.jpg)

**模型检验面板（v1.11.0 起）** —— 官方「设置 → 模型」页里识别真实可用的模型、
真实上下文窗口与端点真正接受的推理等级：

![模型检验面板](docs/screenshots/model-probe.jpg)

## 特性（v1.13.0）

- **文字压在照片上的三件套（v1.13.0 重做）**：浅色对话正文改为**白字 + 模糊深影**。
  此前用深色墨色，但墨色与壁纸中段撞亮度（实测同为 ≈0.19，对比度只有 1.9–2.6:1）；
  改白字后同一片区域约 4.4:1。**刻意不用字形描边**——`-webkit-text-stroke` 是居中描边，
  向内也吃一半宽度，15px 中文「口/日/回」的内白格只有约 2px，0.55px 描边就会糊成一坨；
  `paint-order: stroke fill` 只能保证填充不被吃瘦，解决不了内白格变小。
- **中蓝不再出现在深蓝上（v1.13.0）**：底部状态条（轮次 / tok/s / 缓存命中）与每条消息的
  操作行（复制 / 点赞 / 点踩 / 分享 + 时间戳）原先用 tertiary 中蓝，落在壁纸的中深蓝带
  （实测 p90 110–135）上几乎同色。两者改为白字 + 柔和投影；SVG 图标另配 `drop-shadow`
  （SVG 不接受 `text-shadow`）。
- **深色模式的白膜修复（v1.13.0）**：应用根 frame 与侧边栏底部面板的白色规则此前**没有
  light 前缀**，于是深色下整窗蒙了一层 22% 白。改为按模式分色，并加了一条通用审计
  （凡「浅色背景且无 light 前缀」的规则一律报错），避免同类问题再回来。
- **浅色壁纸调色（v1.13.0）**：可见的壁纸层是**视频**而非 JPEG（`readyState 4`，poster
  只在首帧到达前显示），因此给视频加了 `brightness(0.93) contrast(1.07)`；JPEG 另做真实
  USM 锐化 + 压暗（供 poster 与无视频兜底），细节量提升约 1.49×。

- **模型检验面板（v1.11.0）**：在官方「设置 → 模型」页的每个 pi-ai 提供商卡片里，
  通过官方为第三方插件保留的扩展席位（`settings.models.provider-card`）渲染一个探测面板。
  官方页面自身无法回答的三件事，这里都能回答：
  - **哪些模型真的可用**——每个模型发一次 `max_tokens:1` 的最小请求，区分
    「可用 / 未开通（product not activated）/ 额度耗尽 / 非对话模型 / 其它拒绝」；
  - **上下文窗口与输出上限**——优先读厂商目录（`{origin}/api/v1/models`，一次请求覆盖全部模型），
    端点没有目录时用「超界 max_tokens」从 400 报错里读输出上限；
  - **推理等级**（官方 README 明确写了"推理等级刻意不在可编辑字段之列"）——逐档实测
    `reasoning_effort`（off→none / minimal / low / medium / high / xhigh / max），
    只显示端点真正接受的档位。
  探测在 **host 半身**执行（模型端点没有 CORS 头；密钥按官方设计从不进入渲染进程），
  浏览器半身只负责 UI 与 1s 轮询。两种模式：「快速筛查」（每模型 1 请求）与
  「完整检验」（存活 + 输出上限 + 逐档，每存活模型最多 9 个请求）。

- **动态星云壁纸**：24s 无缝循环视频（host 半身通过 HTTP 路由供给，支持 Range 请求）。
  深色用 `nebula.mp4`，浅色用 `nebula-light.mp4`；静态 JPEG 做 poster / 兜底。
  视频每 1s 一个关键帧，循环回卷瞬间解码，不卡顿。
- **浅色是一等公民**：浅色有专门的 4K 黎明星云壁纸（程序化生成：长石蓝紫天空 +
  青色电离核心 + 品红致密区 + 尘埃暗带 + 星场），**不是**把深色图去饱和。
- **浮层随明暗联动**：设置弹窗 / 菜单 / Popover / Toast 走 `--dshx-float-*` 变量，
  带真正的 `{light,dark}` 双值。v1.2.0 曾把这些**硬编码成深色**，导致浅色下弹窗仍是黑板——
  现在两种模式都正确。
- **输入框不穿透**：composer 底座原本靠 `--dsw-alias-bg-base` 做不透明截止色；
  壁纸模式下 base 透明导致消息穿透，现已用每模式变量恢复正常。
- **不框限阅读区**：解除官方 `clamp(680px, …*0.64, 920px)` 的 920px 上限，放宽到 `min(1180px, 100%-96px)`。
- **排版与对比度**：正文 15px / 行高 1.75，标题加 letter-spacing，文字叠柔和投影（浅色用亮晕）
  保证压在星云上可读。

## 结构（与官方主题包同构）

```
package.json            dsh.bundle.patch + dsh.client{platform:web,immediately}
cordis.patch.yml        insert: xingkong-theme → dsh-xingkong-theme
deploy.sh               一键部署 + 字节校验（见下）
bundle/host.js          host 半身：4 条资源路由（深/浅 × 图/视频，Range/206）
                        + 模型探测 API（/xingkong-model/ping|probe/start|probe/status|probe/cancel）
bundle/probe-core.js    探测引擎：目录/存活/输出上限/推理档位（零依赖，fetch 可注入）
bundle/client.js        浏览器半身：ctx.theme.overrideTokens('xingkong', {74 token})
                        + overrideTokens('xingkong-float', {7 个浮层变量})
                        + 动态壁纸 <video> + 浅深切换
                        + 模型检验面板（settings.models.provider-card 席位，key: llm-pi-ai）
bundle/assets/          随包发布的 4 个资源
source/                 未随包发布的制作源文件（原始 47MB 视频等）
```

## 明暗切换机制

官方 `dsh-client-ui-theme` 的权威接口：

- **`ctx.theme.getTheme().active.colorScheme`** → `"light"` / `"dark"`
  （注意：**不是** `getTheme().colorScheme`，顶层没有这个字段）
- `ctx.on("theme/change", handler)` → 主题变化事件
- `ctx.theme.overrideTokens(source, table)` → table 的值按 `{light, dark}` 分别取用

本主题优先订阅 `theme/change`；再用 MutationObserver 监听 `data-ds-theme-source` /
`data-ds-dark-theme` 等启动脚本信号做兜底；最后退回 `matchMedia` 探测系统。

## 部署（重要）

主题是**本地包**（不走 registry）。DSH 的插件管理器把 registry 包装进
`.generations/<name>+<ver>+<hash>/`，再 **junction** 到 `<profile>/node_modules/`。

### ⚠️ 为什么「改了源码却没效果」

这是本项目实际踩过的最深的一个坑，**实测结论**（不是推测）：

加载器的 `locatePkgJson()` 对**裸包名**和 **`file:///` URL** 走的是**两条不同的分支**，
但**两条都能成功**：

| `name:` 写法 | 解析路径 | 结果 |
|---|---|---|
| `dsh-xingkong-theme` | `createRequire(baseUrl).resolve('<name>/package.json')` | ✅ 只要 `node_modules/` 里有就成功 |
| `file:///…/bundle/host.js` | `nearestPackage(fileURLToPath(url))`，逐级向上找 `package.json` | ✅ |
| `C:\…\bundle\host.js` | 同上（先 `pathToFileURL`） | ✅ |

`startsWith("file:")` 这道门**只在 `nearestPackage()` 内部**，而 `nearestPackage` **只被
path-like 说明符走到**。所以**注册形式不是失败点** —— 三种形式都解析得到。

**真正的失败点是链接状态**：如果 `node_modules/dsh-xingkong-theme` 是一个**手抄的普通目录**
（不是 junction），它会被正常加载，但**永远停在抄写那一刻的版本**。

> 实际发生过的故障：`node_modules/` 里躺着一个手抄的 **v1.2.0** 普通目录
> （`client.js` 24,553 字节，当前 66,029 字节）。因为裸包名能解析，加载器**每次开机都老实加载
> v1.2.0**；而 v1.3.0 → v1.10.0 全部被部署进了**没有任何 junction 指向**的 `.generations/live/`，
> **一次都没被执行过**。表象就是「改了十几版，界面一点变化没有」。
>
> 教训：**依赖树部署的真实性 = 链接状态的真实性。** 源码树上的单元测试全绿、
> `grep` 到「已注册」，都不能证明 app 加载的是这份字节。

### 正确做法

用 `deploy.sh` 复刻官方布局，**不要手工往 `node_modules/` 里放目录**：

```bash
bash deploy.sh          # 部署 / 更新
bash deploy.sh --check  # 只校验，不改动
bash verify.sh          # 五道门禁：语法 / CSS / 单元 / 部署链 / profile
```

`deploy.sh` 做四件事：① 镜像到 generation 目录；② junction 进 `node_modules`；
③ 在 `cordis.patch.yml` 注册（幂等，URL 形式）；④ 清理 `.dsh-market/hot-*.yml` 里的重复登记
（否则会报 `resolves from multiple active Loader sources`）。

`--check` 会**硬断言**这几条（任何一条失败即非零退出）：

- `node_modules/dsh-xingkong-theme` **必须是 symlink**（普通目录 = 失败）；
- junction target **必须落在 `.generations/live/` 下**，且解析出的 generation id  **必须以 `dsh-xingkong-theme+<当前版本>+` 开头**（防止指向旧版本）；
- **不允许**残留 `node_modules/dsh-xingkong-theme.*` 幽灵普通目录；
- `cordis.patch.yml` 里的 `- id: xingkong-theme` 必须**缩进在 `- insert:` 之下**
  （纯文本匹配会漏掉 YAML 结构损坏，比如把换行写成了字面 `/n`）。

因为是 junction，**改完源码重跑 `deploy.sh` 再重启 DSH 即可更新**。

### 验证生效

启动后查 `%APPDATA%\dsh-desktop\logs\harness.log`，应出现：

```
[xingkong-theme] host half active (4/4 asset routes registered)
```

更快的办法：`bash verify.sh`。它会真正 `import` 一次部署产物、真正起一次 host 的 HTTP 服务，
并断言部署的 `client.js` 与源码**逐字节相同**。

### 怎么确认「浏览器半边真的执行了」（DevTools 被禁时）

DSH 的页面跑在自定义协议 `dsh-app://app/` 下，F12 常被禁、root 路由需要内存态 token，
外部拿不到 CDP。三条可用通道（按可靠性排序）：

1. **host 侧进程内写文件** —— 在 `host.js` 的 `apply(ctx)` 里 `writeFile` 一个 JSON，
   记录 `import.meta.url`、`ctx.loader.entries()`、`clientModules.table` / `.graph()`。
   这是唯一能证明「加载器从哪个字节加载了这个包」的手段。
   ⚠️ **`clientModules.table` 以 packageName 为 key**，查存在性要用 `dsh-xingkong-theme`，
   不是 `xingkong-theme`。查错了会得到"插件不在表里"的假象，然后白查一整轮。

2. **client 侧写 `localStorage`**，再直接读 Chromium 的 LevelDB 日志：
   ```
   %APPDATA%\@deepseek-ai\dsh-desktop\Local Storage\leveldb\00000*.log
   ```
   用 Node `readFileSync` + `indexOf('xingkong.beacon')` 就能把 JSON 原样捞出来
   （key 前缀是 `_dsh-app://app`）。**不需要 CDP，也不需要 DevTools。**

3. **旁证**：`%APPDATA%\@deepseek-ai\dsh-desktop\Code Cache\js\*` 里出现含 `xingkong`
   的文件，说明 V8 **确实编译执行过**这个脚本。

一次真实的存活记录长这样（`status:"ok"` = `apply()` 完整跑完、没有抛异常）：

```json
{"at":"2026-10-10T12:35:12.287Z","href":"dsh-app://app/","version":"1.10.0",
 "status":"ok","hasTheme":true,"inject":["theme"],"doneAt":"2026-10-10T12:35:12.515Z"}
```

另外确认注入链路正常：host beacon 里的 `clientModules.graph().batches[]` 应有一条
`application` 批次的 URL 含 `plugins/??dsh-xingkong-theme/client.js`。这说明浏览器
**会被要求加载**这个 bundle —— 若它不在里面，改 `client.js` 是没有意义的。

## 卸载

删掉 `profiles/web/cordis.patch.yml` 里的 `xingkong-theme` insert 行，
移除 `node_modules/dsh-xingkong-theme` junction 与对应 generation 目录，重启。

## 设计约束（改主题时遵守）

1. **画布/内容面板保持半透明**（让壁纸透出来），**浮层保持不透明**（保证可读）。
   两类分开设值，不要一刀切。浮层颜色必须走 `--dshx-float-*`，**禁止硬编码**。
2. **浅色面板透明度要高于深色**：浅色壁纸是彩色星云，可读性要靠面板承载，
   不能靠把壁纸压平。当前 `bg-layer-1/2/3` = .62/.70/.78。
3. 壁纸动画只用 `translate3d`，不要用 `scale()`（每帧重采样会抖）。
4. 视频编码：`yuv420p` + `bt709` + 限制范围，`-g 30`（1s 关键帧），`+faststart`。
5. 浅色档必须过对比度：正文 ≥ 4.5:1、次要文字 ≥ 3:1（`_test_client.js` 有断言）。
6. 改完必须跑：`node --check` → `_test_client.js` → `_test_host.js` → `deploy.sh`。
