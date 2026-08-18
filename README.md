# DeepSeek Harness 桌面端（DSH Desktop）

基于 Electron 的 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) 桌面端 UI——「深空观测站」。

用一套星际主题界面把 harness 的 Web 服务（`pnpm dsh web`）封装成桌面应用：一键启停、实时日志、会话对话、使用统计、GitHub 仓库浏览，以及完整的**工作区**支持。

## 功能

- **一键启停**：自动启动 / 接管 `pnpm dsh web`（`:3080`），无需命令行
- **实时信号流**：harness 启动日志实时滚动查看
- **星际对话**：并发会话、流式输出、模型选择、思考等级、图片粘贴发送
- **工作区**：
  - 左侧历史会话按工作区分组（分组可折叠，未归属会话归入「未分组」）
  - 「＋ 新会话」可选择电脑上的任意文件夹作为工作区（原生目录选择器）
  - 工具栏工作区菜单：筛选视图 / 添加工作区
- **星图档案**：会话数据目录浏览
- **GitHub 侧边栏**：SSH 密钥连接（`git@github.com`），添加仓库 / 分支 / 文件树浏览
- **MCP / 技能**：harness 组合文件中的 MCP 服务器与技能列表
- **设置**：主题（深空 / 极光 / 彗星金 / 自定义）、Agent preset、模型配置、API 密钥管理
- **动态星空背景**：星空粒子 + 星云动画主题

## 快速开始

前置要求：

- Node.js ≥ 18（含 npm）
- DeepSeek Harness 源码目录（默认为 `C:\Users\mjsx\DeepSeek-Harness`，可用环境变量 `DSH_HARNESS_DIR` 覆盖）
- 可选：`pnpm`（harness 启动需要，或由 harness 目录自身的安装方式提供）

```sh
npm install
npm start
```

## 目录结构

```
main.js             Electron 主进程：harness 启停、对话/工作区/设置 RPC 桥、GitHub 与原生目录选择器
preload.js          渲染进程安全桥（contextBridge）
renderer/           渲染层（原生 HTML/JS/CSS）
  index.html        页面骨架（仪表盘 / 对话 / 日志 / 结果 / 设置）
  chat.js           对话页：并发会话、流式渲染、工作区分组与选择
  app.js            页面切换与全局状态
  dashboard.js      仪表盘：服务状态与使用统计
  dock.js           侧边栏：GitHub / MCP / 技能
  settings.js       设置页
  styles.css        星际主题样式
  starfield.js      星空背景粒子
  bg-animated.mp4   动态星云背景（可选删减，删除后回落为静态背景）
```

## 说明

- GitHub 连接使用本机 SSH 密钥（`git@github.com`），仅在 `~/.dsh/.github-ssh.json` 记录密钥路径与登录名，不保存密钥材料；仓库浏览通过 git over SSH 完成。22 端口不通时自动回退 `ssh.github.com:443`（SSH over HTTPS）。
- GitHub 请求使用 Electron `net.fetch`（系统证书库），兼容本地 TLS 拦截环境。
- 对话会话数据与工作区注册表由 harness 持久化在 `~/.dsh/` 下，桌面端本身不存业务数据。
- 动态背景视频约 45MB；不需要动画背景时可直接删除 `renderer/bg-animated.mp4`。


## 一键安装包（发行版）

运行 `scripts/build-dist.ps1` 生成两类产物（正常安装器模式，引擎不塞进安装包）：

- `dist/DSH-Desktop-v<版本>.zip` 与自解压 `DSH-Desktop-v<版本>-Setup.exe`：仅桌面端 UI + Electron 运行时 + 一键安装器（约 100MB，与普通 Electron 应用相当）；
- `dist/DSH-Harness-bundle-v<版本>.zip`：DeepSeek Harness 引擎载荷（源码 + node_modules + 内置 Node），安装时从 GitHub Releases 联网下载一次（约 500-700MB），支持本地离线包优先。

使用者：解压（或运行 Setup.exe）→ 双击 `setup.bat` → 自动安装到 `%LOCALAPPDATA%\DSH`、
写入 `~/.dsh/settings.yaml`（首次安装，不覆盖已有配置）、下载并解压 Harness 引擎、创建桌面快捷方式。
安装包不含任何 API 密钥；模型密钥在应用「设置 → 模型」填写，GitHub 用 SSH 密钥连接。
