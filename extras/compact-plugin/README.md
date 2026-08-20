# compact：会话压缩插件（/compact 形态）

一个与 opencode `/compact`（别名 `/summarize`）同款能力的会话压缩插件，
复用引擎 **rc.8 内置的 compaction 服务**（与 Web 界面内建 `/compact` 命令同一实现）。

## 背景：引擎本身已内置什么

- **手动压缩**：引擎已注册 `/compact` 命令（`packages/compaction/command-compact`），
  在 Web 界面输入框直接输入 `/compact` 即可压缩（Usage: `/compact (no arguments)`）。
- **自动压缩**：引擎按压力/上下文溢出策略自动触发（本会话开头的 `<compacted-summary>`
  checkpoint 就是自动压缩的产物）。
- 压缩原理与 opencode 一致：把早期历史交给模型生成
  「摘要 + 未完成任务 + 关键约束」→ 替换为摘要节点，后续请求只携带摘要 + 最近消息。

## 本插件补什么

| 缺口 | 插件提供 |
|---|---|
| 模型无法主动触发压缩（Web/桌面端聊天说「压缩一下」没有对应工具） | **Host `compact` 工具**：任何界面一句话触发，等价 `/compact` |
| 输入栏没有可见入口 | **Client「压缩」按钮**：会话输入栏左侧，点击即压缩（显示压缩条数/节省 token） |

## 安装（会话内动态插件）

在支持动态插件的会话中：

1. Host 半/Client 半分别粘贴 `compact.host.js` / `compact.client.js` 的函数体
   （文件内容即为动态插件的 `code.host` / `code.client` 代码，plain JavaScript，
   无 import/JSX）。
2. 定义后运行并批准。需要先加载 `cordis-plugin-development` 技能按标准流程 define/run。

## 行为与约束

- 压缩成功后，较早消息被摘要替换，**已压缩内容无法原样找回**（与 /compact 一致）。
- 压缩期间会话须处于空闲；忙时会返回明确错误（对应引擎 `ManualCompactionError` 的
  busy/cancelled/changed/summary/commit/persistence）。
- 自动压缩不受本插件影响（引擎策略始终在跑）。