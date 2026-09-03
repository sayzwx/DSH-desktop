#!/usr/bin/env bash
# DSH Desktop —— POSIX 引导脚本（macOS / Linux），对应 Windows 的 installer/setup.ps1。
#
# 作用：把 DeepSeek Harness 引擎拉取并构建到「安装根目录/harness」，可选附带捆绑 Node。
# 网络受限时可设 NPM_REGISTRY 指定镜像（如 https://registry.npmmirror.com）。
#
# 用法：
#   bash installer/setup.sh                 # 安装引擎到平台默认根目录
#   bash installer/setup.sh --engine-only   # 只装/修引擎（等价 setup.ps1 -EngineOnly）
#   DEST_DIR=/opt/DSH bash installer/setup.sh
#
# 说明：这是 setup.ps1 核心路径（zip 优先 → 镜像多跳 → git clone 兜底 → corepack pnpm 构建）
# 的 POSIX 移植。Windows 链路（Inno Setup + setup.ps1）保持不变；本脚本供 mac/linux 与 CI 使用。
set -euo pipefail

HARNESS_TAG="${HARNESS_TAG:-dsh-v0.1.0-rc.8}"
HARNESS_ZIP="https://github.com/deepseek-ai/DeepSeek-Harness/archive/refs/tags/${HARNESS_TAG}.zip"
HARNESS_GIT="https://github.com/deepseek-ai/DeepSeek-Harness.git"
NODE_MIN_MAJOR="${NODE_MIN_MAJOR:-22}"
NPM_REGISTRY="${NPM_REGISTRY:-}"
ENGINE_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --engine-only|-EngineOnly) ENGINE_ONLY=1 ;;
    *) echo "未知参数：$arg" >&2 ;;
  esac
done

log() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# ---- 平台与安装根目录（与 main.js resolveDshRoot 一致）----
OS="$(uname -s)"
case "$OS" in
  Darwin) DEFAULT_ROOT="$HOME/Library/Application Support/DSH" ;;
  Linux)  DEFAULT_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/DSH" ;;
  *)      die "不支持的平台：$OS（本脚本面向 macOS / Linux）" ;;
esac
DEST_DIR="${DEST_DIR:-$DEFAULT_ROOT}"
HARNESS_DIR="$DEST_DIR/harness"
log "安装根目录：$DEST_DIR"
log "引擎目录：  $HARNESS_DIR"

command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || die "需要 curl 或 wget"

fetch() { # fetch <url> <out>
  local url="$1" out="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --connect-timeout 20 --max-time 300 -o "$out" "$url"
  else
    wget -q -T 20 -t 2 -O "$out" "$url"
  fi
}

# ---- 1) 确保 Node >= NODE_MIN_MAJOR（优先系统 node，其次提示）----
ensure_node() {
  if command -v node >/dev/null 2>&1; then
    local major; major="$(node -p 'process.versions.node.split(".")[0]')"
    if [ "$major" -ge "$NODE_MIN_MAJOR" ]; then
      log "使用系统 Node $(node -v)"
      return 0
    fi
    log "系统 Node $(node -v) 低于要求的 v${NODE_MIN_MAJOR}，尝试用 corepack/nvm 或请手动升级"
  fi
  command -v node >/dev/null 2>&1 || die "未找到 Node.js（需要 >= v${NODE_MIN_MAJOR}）。请先安装 Node，或设置 DSH_NODE_EXE 指向可用 node。"
}
ensure_node

# ---- 2) 拉取引擎源码：zip 优先（官方 + 加速镜像多跳），git clone 兜底 ----
TMP_ZIP="$(mktemp)"
fetch_zip() {
  local mirrors=(
    "$HARNESS_ZIP"
    "https://ghfast.top/$HARNESS_ZIP"
    "https://ghproxy.net/$HARNESS_ZIP"
    "https://gh-proxy.com/$HARNESS_ZIP"
  )
  for url in "${mirrors[@]}"; do
    log "  尝试下载：$url"
    if fetch "$url" "$TMP_ZIP" && [ -s "$TMP_ZIP" ]; then return 0; fi
  done
  return 1
}

mkdir -p "$DEST_DIR"
if [ -d "$HARNESS_DIR/apps/cli/lib" ]; then
  log "引擎目录已存在，跳过拉取（如需重装请先删除 $HARNESS_DIR）"
else
  if fetch_zip; then
    log "  解压引擎源码…"
    command -v unzip >/dev/null 2>&1 || die "需要 unzip 解压引擎源码归档（请先安装 unzip，或改用 git 让其走 clone 兜底）。"
    rm -rf "$HARNESS_DIR"; mkdir -p "$HARNESS_DIR"
    # GitHub 归档解压出单层 DeepSeek-Harness-<tag>/ 目录，剥掉它
    local_tmp="$(mktemp -d)"
    unzip -q "$TMP_ZIP" -d "$local_tmp"
    inner="$(find "$local_tmp" -maxdepth 1 -mindepth 1 -type d | head -n 1)"
    cp -R "$inner"/. "$HARNESS_DIR"/
    rm -rf "$local_tmp"
  else
    log "  zip 下载失败（官方与镜像均失败），尝试 git clone…"
    command -v git >/dev/null 2>&1 || die "zip 与 git 均不可用：请安装 git 或检查网络后重试。"
    rm -rf "$HARNESS_DIR"
    git clone --depth 1 --branch "$HARNESS_TAG" "$HARNESS_GIT" "$HARNESS_DIR" \
      || die "git clone 失败：请检查网络或 git 配置。"
  fi
fi
rm -f "$TMP_ZIP"

# ---- 3) 构建：corepack pnpm install + build（+ web 前端），镜像失败换源重试 ----
cd "$HARNESS_DIR"
command -v corepack >/dev/null 2>&1 || die "未找到 corepack（随 Node >= 16.9 分发）。请升级 Node。"
corepack enable >/dev/null 2>&1 || true

registries=()
[ -n "$NPM_REGISTRY" ] && registries+=("$NPM_REGISTRY")
registries+=("https://registry.npmmirror.com" "https://registry.npmjs.org")

install_ok=0
for reg in "${registries[@]}"; do
  log "  通过 $reg 安装依赖（corepack pnpm install --frozen-lockfile，一次性，可能数百 MB）…"
  if COREPACK_NPM_REGISTRY="$reg" corepack pnpm install --frozen-lockfile; then install_ok=1; break; fi
  log "  该源失败，换下一个源重试…"
done
[ "$install_ok" -eq 1 ] || die "pnpm install 在多个 npm 镜像均失败（网络/磁盘/代理问题）。"

log "  构建引擎（corepack pnpm build，一次性，需数分钟）…"
corepack pnpm build || die "pnpm build 失败"
# web 前端 dist 必须构建，否则引擎启动报 “frontend dist not built”
corepack pnpm --filter @deepseek-ai/dsh-web-frontend run build || log "  WARN: web 前端构建失败，界面可能不可用"

log "引擎安装完成：$HARNESS_DIR"
if [ "$ENGINE_ONLY" -eq 0 ]; then
  log "提示：应用外壳（Electron）请通过 electron-builder 打包，或开发态运行 'npm start'。"
  log "      Linux 桌面项见 installer/dsh.desktop；把它复制到 ~/.local/share/applications/ 并按需改 Exec 路径。"
fi
