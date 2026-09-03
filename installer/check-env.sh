#!/usr/bin/env bash
# DSH Desktop —— POSIX 环境预检（macOS / Linux），对应 Windows 的 installer/check-env.ps1。
# 只读体检：逐项检查 Node / git / curl|wget / unzip / 磁盘空间 / 端口占用，打印结论，不改动系统。
# 退出码：0 = 关键项齐备；1 = 缺少关键依赖（Node）。
set -uo pipefail

NODE_MIN_MAJOR="${NODE_MIN_MAJOR:-22}"
PORT="${PORT:-3080}"
ok=0; warn=0; bad=0
good() { printf '  [ OK ] %s\n' "$*"; ok=$((ok+1)); }
warnk() { printf '  [WARN] %s\n' "$*"; warn=$((warn+1)); }
badk() { printf '  [FAIL] %s\n' "$*"; bad=$((bad+1)); }

echo "DSH 环境预检（$(uname -s) $(uname -m)）"

# Node
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$major" -ge "$NODE_MIN_MAJOR" ]; then good "Node $(node -v)（>= v${NODE_MIN_MAJOR}）";
  else badk "Node $(node -v) 低于要求的 v${NODE_MIN_MAJOR}"; fi
else
  badk "未找到 Node.js（需要 >= v${NODE_MIN_MAJOR}）"
fi

# corepack（随 Node 分发，构建引擎要用）
if command -v corepack >/dev/null 2>&1; then good "corepack 可用"; else warnk "未找到 corepack（构建引擎需要，随 Node >= 16.9 分发）"; fi

# git（zip 失败时的兜底）
if command -v git >/dev/null 2>&1; then good "git $(git --version | awk '{print $3}')"; else warnk "未找到 git（zip 下载失败时无兜底）"; fi

# 下载工具
if command -v curl >/dev/null 2>&1; then good "curl 可用";
elif command -v wget >/dev/null 2>&1; then good "wget 可用";
else badk "curl 与 wget 均不可用（无法下载引擎）"; fi

# unzip
if command -v unzip >/dev/null 2>&1; then good "unzip 可用"; else warnk "未找到 unzip（解压引擎归档需要）"; fi

# 磁盘空间（安装根目录所在卷，需 ~2GB 余量）
ROOT="${DEST_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/DSH}"
[ "$(uname -s)" = "Darwin" ] && ROOT="${DEST_DIR:-$HOME/Library/Application Support/DSH}"
avail_kb="$(df -Pk "$(dirname "$ROOT")" 2>/dev/null | awk 'NR==2{print $4}')"
if [ -n "${avail_kb:-}" ]; then
  avail_mb=$((avail_kb / 1024))
  if [ "$avail_mb" -ge 2048 ]; then good "磁盘余量 ${avail_mb} MB（>= 2048 MB）";
  else warnk "磁盘余量仅 ${avail_mb} MB（建议 >= 2048 MB）"; fi
fi

# 端口占用（引擎默认 :3080）
if command -v lsof >/dev/null 2>&1; then
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then warnk "端口 :$PORT 已被占用（可能已有引擎在跑）";
  else good "端口 :$PORT 空闲"; fi
else
  warnk "无 lsof，跳过端口 :$PORT 占用检查"
fi

echo "小结：OK $ok · WARN $warn · FAIL $bad"
[ "$bad" -eq 0 ] || exit 1
exit 0
