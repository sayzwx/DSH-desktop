# DSH Desktop v0.5.1 — 安装器自愈 + 自定义提供商

## 🛠 修复：引擎探测与安装器自愈（解决「启动不了 Harness / ERR_MODULE_NOT_FOUND」）

上一版（0.5.0）在多台机器上出现「装完点启动 Harness 报 `ERR_MODULE_NOT_FOUND`」——根因是安装器拉取引擎那一步静默失败（网络波动导致引擎源码/依赖没装上，Inno 不把它当安装失败，用户无感知），而应用又只会按固定路径找引擎，找不到就回退到 npx 缓存里的旧版引擎，最终启动崩溃。本版彻底修复：

- **探测路径大幅扩展**：除了安装目录 / npm 全局 / npx 缓存，现在还扫描用户目录与各盘符根目录下的 `DeepSeek-Harness`、`harness` 等常见位置（如 `D:\DeepSeek-Harness`），也能通过环境变量 `DSH_HARNESS_DIR` 显式指定引擎源码目录。
- **完整性检测**：找到引擎先体检——`bin.js` 存在只是"外壳"，会进一步检查核心依赖（`dsh-app-boot` / `cordis-plugin-loader`）是否真实安装且非空目录（pnpm 链接失效/安装中断会出现空目录），不完整的引擎直接跳过，绝不复用残缺引擎启动。
- **自动修复**：没有完整引擎 → 自动拉取官方引擎（源码多镜像下载 + pnpm 构建，npmmirror/腾讯云/官方自动回退）；安装器拉取失败时，日志写入 `install.log` 并给出明确指引，不再静默。
- **100% 成功的保底办法**：所有自动途径失败时，界面日志会给出三种手动方案：① `setx DSH_HARNESS_DIR` 指向已有源码目录；② 浏览器下载引擎 zip 解压到 `harness` 目录（附官方+加速镜像链接）；③ `npm install -g @deepseek-ai/dsh`。任选其一，重启应用点「启动 Harness」即可。
- **崩溃自动检测**：启动后从未就绪就退出（典型 `ERR_MODULE_NOT_FOUND` / plugin tree failed），自动重新检测引擎完整性并尝试修复，不再让用户对着报错干瞪眼。

## 📦 安装器回归 0.5.0 规则（完整一键向导）

- **可选择安装目录**：向导第一步可选任意目录（默认 `%LOCALAPPDATA%\DSH`），app / harness / tools 全部随所选目录布局。
- **内置环境预检页**：进入即自动检测 CPU 架构 / 网络 / 磁盘 / Node.js，结果实时显示，缺失项明确列出（安装阶段会自动补齐）。
- **修复安装器卡死**：引擎拉取失败时不再因隐藏的 `pause` 卡死安装器——失败信息写入 `install.log` 并给出手动指引，退出码明确。
- **全程自带便携 Node**：目标机不需要安装任何 Node.js 环境；应用内所有 npm/npx 调用（含自动获取引擎）统一走捆绑 Node 的 npm-cli.js。

## ➕ 新增：自定义提供商（对齐官方 webUI）

模型配置页新增「＋ 添加自定义提供商」：

- 填写**提供商 ID / 显示名称 / API 协议（OpenAI Completions / OpenAI Responses / Anthropic Messages）/ API 地址（baseURL）/ API 密钥 / 自定义 Headers**，保存即出现在提供商列表。
- 支持后续编辑（API 地址、协议、模型目录增删/自动发现）与删除，行为与预置提供商一致。
- 适合接入自建网关、国内中转、企业内网 LLM 服务等任意 OpenAI/Anthropic 兼容端点。

## 🚀 其他

- 打包链路强化：打包排除开发机 `.workbuddy` 工作数据与 `DSH` 安装产物目录（隐私保护 + 体积回归正常）。
- 编码防线：编码检查覆盖隐藏配置文件（.gitignore 等），中文乱码类问题打包前即拦截。
- 引擎版本：官方 `deepseek-ai/DeepSeek-Harness` dsh-v0.1.0-rc.8（自动获取）。

## 安装

- **Setup.exe（推荐）**：双击 → 选择安装目录 → 环境预检 → 安装 → 自动拉取引擎 / 建快捷方式 / 启动应用。
- **zip**：解压后运行 `setup.bat`。

> 手动下载加速：官方链接前加镜像前缀，如 `https://ghfast.top/https://github.com/sayzwx/DSH-desktop/releases/download/v0.5.1/DSH-Desktop-v0.5.1-Setup.exe`
