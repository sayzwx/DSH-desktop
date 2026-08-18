#!/usr/bin/env sh
# DSH Desktop 开发环境一键 setup（macOS / Linux）。
# 检查 Node.js（>= 18），按 package-lock.json 用 `npm ci` 安装依赖
# （Electron + ws），然后提示如何启动/打包。
# 最终用户安装请使用 Windows 下的 installer/setup.bat。
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

NO_INSTALL=0
case "${1:-}" in
    --no-install) NO_INSTALL=1 ;;
    -h|--help)
        echo "DSH Desktop 开发环境一键 setup（macOS / Linux）"
        echo ""
        echo "用法：./setup.sh [选项]"
        echo ""
        echo "选项："
        echo "  --no-install   只检查 Node.js 环境，不安装依赖"
        echo "  -h, --help     显示本帮助"
        echo ""
        echo "功能：检查 Node.js（>= 18）→ npm ci 按锁定的版本安装依赖 → 提示如何启动/打包"
        exit 0
        ;;
esac

if ! command -v node >/dev/null 2>&1; then
    echo "[setup] 未检测到 Node.js。请先安装 Node.js >= 18（https://nodejs.org 或 nvm），再重新运行。"
    exit 1
fi
NODE_VERSION=$(node -v 2>/dev/null || true)
MAJOR=$(printf '%s' "$NODE_VERSION" | sed -E 's/^v?([0-9]+).*/\1/')
if [ -z "$MAJOR" ] || [ "$MAJOR" -lt 18 ]; then
    echo "[setup] Node.js 版本过低：${NODE_VERSION:-未知}（需要 >= 18）。请升级后重试。"
    exit 1
fi
echo "[setup] Node.js $NODE_VERSION 就绪"

if [ "$NO_INSTALL" -eq 0 ]; then
    if [ -f "$ROOT/package-lock.json" ]; then
        echo "[setup] 安装依赖（npm ci，按 package-lock.json 锁定版本）..."
        (cd "$ROOT" && npm ci)
    else
        echo "[setup] 缺少 package-lock.json（从未 npm install 过？），改用 npm install ..."
        (cd "$ROOT" && npm install)
    fi
    echo "[setup] 依赖安装完成。"
else
    echo "[setup] 已跳过依赖安装（--no-install）。"
fi

echo "[setup] "
echo "[setup] DSH Desktop 开发环境就绪："
echo "[setup]   - 开发运行（推荐，带日志）：npm start"
echo "[setup]   - 构建分发包：scripts/build-dist.ps1 为 Windows 专用（依赖 robocopy/7-Zip）；"
echo "[setup]     macOS / Linux 可用 electron-builder 等自行打包（项目当前未内置）"
echo "[setup]   - Harness 源码目录可用环境变量 DSH_HARNESS_DIR 覆盖（默认见 README）"
