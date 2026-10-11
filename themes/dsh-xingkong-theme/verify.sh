#!/usr/bin/env bash
# verify.sh — 一次性跑完全部验证：语法 / CSS 结构 / 单元测试 / 部署链健康度。
#
# 为什么需要它：本项目历史上出现过多次「以为改好了其实没生效」的情况，
# 而每一次的表层现象都是「界面一点变化没有」。经验教训是——
#   · 单元测试全绿 不等于 部署链是通的；
#   · 部署链看起来对 不等于 加载器真的会加载到这份字节；
#   · 「已注册」的文本匹配 不等于 YAML 真的能被解析。
# 所以这里把四类检查串成一个门禁，任何一环失败即非零退出。
#
#   bash verify.sh
set -uo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE="${NODE:-C:/Users/mjsx/.workbuddy/binaries/node/versions/22.22.2-6/node.exe}"
WORK="$(cd "$SRC/../.." && pwd)/.workbuddy"

RC=0
say()  { printf '%s\n' "$*"; }
hdr()  { say ""; say "═══ $* ═══"; }
ok()   { say "  ok   $*"; }
bad()  { say "  FAIL $*"; RC=1; }

# ── 1. CSS 结构 ─────────────────────────────────────────────────────────────
hdr "1/5 CSS 结构"
if [ -f "$WORK/_cssprobe.js" ]; then
  OUT="$("$NODE" "$WORK/_cssprobe.js" "$SRC/bundle/client.js" 2>&1)"
  say "$OUT" | sed 's/^/  /'
  printf '%s' "$OUT" | grep -q "BALANCED" && ok "大括号平衡" || bad "大括号不平衡"
else
  say "  (跳过：找不到 _cssprobe.js)"
fi

# ── 2. 语法 ─────────────────────────────────────────────────────────────────
hdr "2/5 语法"
for f in bundle/client.js bundle/host.js bundle/probe-core.js; do
  if "$NODE" --check "$SRC/$f" 2>/dev/null; then ok "$f"; else bad "$f 语法错误"; fi
done
bash -n "$SRC/deploy.sh" && ok "deploy.sh" || bad "deploy.sh 语法错误"

# ── 3. 单元测试 ─────────────────────────────────────────────────────────────
hdr "3/5 单元测试"
for t in _test_client.js _test_host.js _test_probe_core.mjs; do
  if [ -f "$WORK/$t" ]; then
    ARG="$SRC/bundle/client.js"; case "$t" in *_host*) ARG="$SRC/bundle/host.js" ;; *_probe_core*) ARG="$SRC/bundle/probe-core.js" ;; esac
    R="$("$NODE" "$WORK/$t" "$ARG" 2>&1)"; N="$(printf '%s' "$R" | grep -c '^PASS')"
    printf '%s' "$R" | grep -q "ALL CHECKS PASSED" && ok "$t  ($N PASS)" || { bad "$t"; printf '%s\n' "$R" | tail -20 | sed 's/^/     /'; }
  else
    say "  (跳过：找不到 $t)"
  fi
done

# ── 4. 部署链健康度 ─────────────────────────────────────────────────────────
hdr "4/5 部署链"
for t in _test_registration.mjs _test_link_health.mjs _test_http.mjs; do
  if [ -f "$WORK/$t" ]; then
    R="$("$NODE" "$WORK/$t" 2>&1)"; N="$(printf '%s' "$R" | grep -c '^PASS')"
    if printf '%s' "$R" | grep -qE '^[0-9]+ PASS / 0 FAIL$'; then ok "$t  ($N PASS)"
    else bad "$t"; printf '%s\n' "$R" | grep '^FAIL' | sed 's/^/     /'; fi
  else
    say "  (跳过：找不到 $t)"
  fi
done

# ── 5. deploy.sh --check ────────────────────────────────────────────────────
hdr "5/5 profile 校验"
CHK="$(bash "$SRC/deploy.sh" --check 2>&1)"; CE=$?
printf '%s\n' "$CHK" | grep -qE "^\[" | sed 's/^/  /'
printf '%s' "$CHK" | grep -q "ALL PROFILES VERIFIED" && ok "ALL PROFILES VERIFIED" || { bad "profile 校验未通过"; printf '%s\n' "$CHK" | grep -iE 'fail|not ' | sed 's/^/     /'; }
[ "$CE" -eq 0 ] || bad "deploy.sh --check 退出码 $CE"

say ""
if [ "$RC" -eq 0 ]; then say "★ 全部通过"; else say "✗ 存在失败项"; fi
exit "$RC"
