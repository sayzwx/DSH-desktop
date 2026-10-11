#!/usr/bin/env bash
# deploy.sh — deploy dsh-xingkong-theme into the DSH Desktop 'web' profile.
#
# WHY THIS EXISTS
#   The theme is a LOCAL package (no registry). DSH's plugin manager installs
#   registry packages into .generations/<name>+<ver>+<hash>/ and then junctions
#   them into profiles/web/node_modules/. A hand-copied bare directory in
#   node_modules/ is NOT picked up by the client-module registry and produces no
#   [xingkong-theme] log line — the plugin simply never loads.
#
#   So we replicate the official layout:
#     1. mirror the package into .generations/live/dsh-xingkong-theme+<ver>+local/
#     2. junction profiles/web/node_modules/dsh-xingkong-theme -> that dir
#     3. register the plugin row in profiles/web/cordis.patch.yml (idempotent)
#
#   Because step 2 is a junction, re-running this script is how you *update*:
#   edit the source, re-run, restart DSH.
#
# USAGE   bash deploy.sh            # deploy/refresh
#         bash deploy.sh --check    # verify only, change nothing
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say() { printf '%s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*" >&2; }
note() { printf '      %s\n' "$*"; }

# ── rival patterns ───────────────────────────────────────────────────────────
# Declared UP HERE, not next to the deploy loop, because `--check` (which runs
# and exits early, above the deploy section) consumes RIVAL_RE. With `set -u`
# an unset reference there aborts the whole check mid-profile — which is
# exactly what happened: profile 1 printed its verdict, then the script died
# on profile 2 with "RIVAL_RE: unbound variable".
#
#   RIVALS    — the QUARANTINE set (deploy step 4 renames anything matching).
#               Includes our own name and the market so a half-installed
#               leftover of either is swept too.
#   RIVAL_RE  — the DETECTOR used by `--check`. Deliberately EXCLUDES
#               `dsh-xingkong-theme` (we are the thing being checked) and
#               `dshmarket` (the market host is expected to be present).
RIVALS='dsh-kimino-theme|dsh-plugin-wallpaper-engine|dsh-claude-style|dsh-xingkong-theme|dshmarket'
RIVAL_RE='dsh-kimino-theme|dsh-plugin-wallpaper-engine|dsh-claude-style|wallpaper-engine'

# VERSION is read from package.json HERE, not beside the deploy loop, for the
# same reason as RIVAL_RE above: `--check` runs and exits above that point, and
# under `set -u` referencing an unset name aborts the whole run mid-profile.
VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SRC/package.json" | head -1)"
[ -n "$VERSION" ] || VERSION="0.0.0-unknown"

# ── profile roots ────────────────────────────────────────────────────────────
# There is more than one place DSH keeps profiles, and they are NOT the same
# installation:
#
#   ~/.dsh/profiles/                                  ← canonical harness home
#   %APPDATA%/dsh-desktop/harness/profiles/           ← the Desktop app's OWN
#
# WHICH ONE THE APP BOOTS (verified from app.asar/lib/main.js):
#
#   function resolveDesktopPaths(dshHome = resolveDshHome()) {
#     return { profile: join(dshHome, "profiles", "desktop"),
#              lock:    join(dshHome, "profiles", "desktop", "lock") };
#   }
#
# with `resolveDshHome()` precedence: explicit config, then $DSH_HOME, then
# `~/.dsh`. So the Electron desktop app reads ~/.dsh/profiles/desktop — NOT the
# Roaming root. The Roaming root is used when the app imports a pre-existing
# `.dsh` install as its `web` profile, which is recorded in
#   %APPDATA%/dsh-desktop/harness/.web-import-decision.json
# (here: {"decision":"imported","source":"C:\\Users\\mjsx\\.dsh", ...}).
#
# We deploy to EVERY root that exists so neither installation can be missed.
DSH_ROOTS="${DSH_PROFILE_ROOTS:-$HOME/.dsh/profiles $HOME/AppData/Roaming/dsh-desktop/harness/profiles}"

VER="$(grep -m1 '"version"' "$SRC/package.json" | sed 's/.*: *"\(.*\)".*/\1/')"
if [ -z "$VER" ]; then
  fail "could not read version from $SRC/package.json"; exit 1
fi

CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

# discover_profiles <root> — prints one absolute profile dir per line.
# A directory qualifies when it has a cordis.patch.yml (that file is what the
# loader actually reads; node_modules alone can exist as an empty husk).
discover_profiles() {
  root="$1"
  [ -d "$root" ] || return 0
  for d in "$root"/*/; do
    [ -d "$d" ] || continue
    [ -f "$d/cordis.patch.yml" ] || continue
    # strip the trailing slash so paths compare/print cleanly
    printf '%s\n' "${d%/}"
  done
}

say "source   : $SRC"
say "version  : $VER"

PROFILES="$(for r in $DSH_ROOTS; do discover_profiles "$r"; done)"
if [ -z "$PROFILES" ]; then
  fail "no DSH profile found under: $DSH_ROOTS"
  fail "set DSH_PROFILE_ROOTS to override"
  exit 1
fi
say "profiles :"
printf '  - %s\n' $PROFILES
say ""

# ── 0. sanity: source files exist ─────────────────────────────────────────────
for f in bundle/client.js bundle/host.js bundle/probe-core.js bundle/assets/nebula.jpg \
         bundle/assets/nebula-web.mp4 bundle/assets/nebula-light.jpg \
         bundle/assets/nebula-light.mp4 package.json cordis.patch.yml; do
  [ -f "$SRC/$f" ] || { fail "missing source file: $f"; exit 1; }
done

# ── 1. syntax check ──────────────────────────────────────────────────────────
if command -v node >/dev/null 2>&1; then
  node --check "$SRC/bundle/client.js" && say "syntax   : client.js OK"
  node --check "$SRC/bundle/host.js"   && say "syntax   : host.js OK"
  node --check "$SRC/bundle/probe-core.js" && say "syntax   : probe-core.js OK"
else
  say "syntax   : node not on PATH, skipped"
fi

if [ "$CHECK" = "1" ]; then
  say ""
  say "── check mode: verifying every discovered profile ──"
  rc=0
  for PROFILE in $PROFILES; do
    NM="$PROFILE/node_modules"
    PATCH="$PROFILE/cordis.patch.yml"
    DST="$NM/dsh-xingkong-theme"
    say ""
    say "[$PROFILE]"

    # a plain directory is the silent failure mode: it looks deployed, the
    # bytes can even be current once, but nothing resyncs it when the source
    # changes — the profile drifts back into the past without any error.
    if [ -L "$DST" ]; then
      say "  link     : junction OK"
    elif [ -d "$DST" ]; then
      fail "  $DST is a PLAIN DIRECTORY (not a junction) — will drift out of date"; rc=1
    else
      fail "  not deployed at $DST"; rc=1
      continue
    fi

    for f in client.js host.js probe-core.js; do
      cmp -s "$SRC/bundle/$f" "$DST/bundle/$f" && say "  $f MATCHES" || { fail "  $f DIFFERS"; rc=1; }
    done
    asset_ok=1
    for f in nebula.jpg nebula-web.mp4 nebula-light.jpg nebula-light.mp4; do
      cmp -s "$SRC/bundle/assets/$f" "$DST/bundle/assets/$f" || { fail "  asset $f DIFFERS"; asset_ok=0; rc=1; }
    done
    [ $asset_ok -eq 1 ] && say "  assets   : all MATCH (4/4)"

    # Registration form. MEASURED TRUTH (not an assumption):
    #   * a bare `name: dsh-xingkong-theme` DOES resolve, because the loader's
    #     locatePkgJson() takes the non-path branch and calls
    #     createRequire(baseUrl).resolve('<name>/package.json') — which succeeds
    #     for any package present in <profile>/node_modules.
    #   * a `file:///…/bundle/host.js` URL also resolves, via nearestPackage().
    # Both reach the same parseDshClient + clientExportOf contract.
    # So the form is NOT the failure mode. What actually fails is the LINK: if
    # node_modules/<name> is missing, or is a hand-copied PLAIN DIRECTORY pinned
    # at an old version, the loader happily loads whatever bytes are there —
    # and the UI silently never changes. That is precisely the bug that cost
    # several rounds here (a stale plain-dir v1.2.0 kept being loaded while
    # v1.3–v1.10 were deployed into generations nobody linked to).
    # Therefore: accept both forms (url preferred, and required by the writer
    # step below for a stable, explicit target), and put the hard assertion on
    # the link instead.
    if grep -q "name: 'file:///.*dsh-xingkong-theme/bundle/host\.js'" "$PATCH" 2>/dev/null; then
      say "  registered in cordis.patch.yml (url form)"
    elif grep -qE "name: *'?dsh-xingkong-theme'? *$" "$PATCH" 2>/dev/null; then
      say "  registered in cordis.patch.yml (bare name — resolves via node_modules)"
    else
      fail "  NOT registered in cordis.patch.yml"; rc=1
    fi

    # 🔴 THE REAL GATE: the junction must exist, must be a link, and must point
    # into .generations/live at the CURRENT version. A git-less directory copy
    # is the silent-failure shape: it looks deployed and can even be correct
    # once, then freezes forever while the source moves on.
    if [ -L "$DST" ]; then
      LTARGET=$(readlink "$DST" 2>/dev/null || true)
      case "$LTARGET" in
        *".generations/live/"*)
          GENID=$(printf '%s' "$LTARGET" | sed -n 's#.*/\.generations/live/\([^/]*\)/.*#\1#p')
          [ -n "$GENID" ] || GENID="(unparsed) $LTARGET"
          say "  junction : -> $GENID"
          case "$GENID" in
            "dsh-xingkong-theme+$VERSION+"*) : ;;
            *) fail "  junction generation is not v$VERSION: $GENID"; rc=1 ;;
          esac
          ;;
        *) fail "  junction points OUTSIDE .generations/live: $LTARGET"; rc=1 ;;
      esac
    fi

    # A leftover `dsh-xingkong-theme.<anything>` plain directory in node_modules
    # is a loaded-version hazard: resolution order is not guaranteed to prefer
    # the junction form, and a stale one is indistinguishable from a live one.
    for ghost in "$NM"/dsh-xingkong-theme.*; do
      [ -e "$ghost" ] || continue
      case "$(basename "$ghost")" in
        dsh-xingkong-theme.*.bak|dsh-xingkong-theme.STALE*|*.disabled*) continue ;;
      esac
      fail "  stray package dir in node_modules: $(basename "$ghost")"; rc=1
    done

    # STRUCTURAL check — a grep for the name passes even when the YAML is
    # malformed. We shipped a literal `/n` instead of a newline once (a
    # rewrite helper escaped it wrongly); the name was still on the line, so
    # every textual check said "registered" while the loader parsed nothing.
    # Assert the actual shape: the `- id: xingkong-theme` line must be INDENTED
    # under an `- insert:` line, i.e. it begins with spaces.
    if grep -q 'id: xingkong-theme' "$PATCH" 2>/dev/null; then
      if grep -qE '^- insert:/' "$PATCH" 2>/dev/null; then
        fail "  MALFORMED YAML: literal '/n' instead of a newline near '- insert:'"; rc=1
      fi
      if grep -qE '^[[:space:]]+- id: xingkong-theme' "$PATCH" 2>/dev/null; then
        say "  yaml shape: id is a nested list item (OK)"
      else
        fail "  id: xingkong-theme is not indented under an insert list"; rc=1
      fi
    fi
    # exclusivity: no rival visual plugin may still be mounted.
    #
    # TWO independent channels can mount a rival, and the first version of this
    # check missed BOTH:
    #
    #  (a) MARKET HOT FILES. `.dsh-market/hot-<n>.yml` are the hot-mount
    #      inputs. The loader's matcher is /^hot-\d+\.yml$/ (see
    #      dshmarket/lib/hot.js), so a file renamed to
    #      `hot-2.yml.disabled-xingkong` is correctly IGNORED. The old glob
    #      here was `hot-*.yml`, which matches NEITHER the live form when a
    #      suffix is present NOR the disabled form — so the loop ran zero
    #      times and reported a clean bill of health unconditionally. Now we
    #      glob `hot-*` (any suffix) and only flag entries that actually match
    #      the loader's pattern.
    #  (b) PLAIN DIRECTORIES IN node_modules. A hand-copied package (not a
    #      junction) is invisible to a junction-only verify but may still be
    #      discovered by the harness. Any rival present as a real directory
    #      is flagged, and so is a rival junction.
    live_rival=0
    for hot in "$PROFILE"/.dsh-market/hot-*; do
      [ -f "$hot" ] || continue
      base=$(basename "$hot")
      # Only the loader's exact pattern is live; `.disabled-*` etc. are inert.
      case "$base" in
        hot-*.yml.disabled*|hot-*.yml.bak*) continue ;;
      esac
      grep -Eq "$RIVAL_RE" "$hot" || continue
      fail "  rival visual plugin mounted via market: $base"; live_rival=1; rc=1
    done
    for nm in "$PROFILE"/node_modules/*; do
      [ -e "$nm" ] || continue
      base=$(basename "$nm")
      case "$base" in
        dsh-xingkong-theme|dshmarket|argparse|js-yaml|undici|.bin|.pnpm) continue ;;
        dsh-xingkong-theme.*) continue ;;   # our own STALE backups
      esac
      grep -Eq "$RIVAL_RE" <<<"$base" || continue
      if [ -L "$nm" ]; then
        fail "  rival theme present in node_modules: $base (junction)"; live_rival=1; rc=1
      else
        fail "  rival theme present in node_modules: $base (PLAIN DIR — hand-copied)"
        live_rival=1; rc=1
      fi
    done
    [ $live_rival -eq 0 ] && say "  exclusive: no rival theme present"
  done
  say ""
  [ $rc -eq 0 ] && say "ALL PROFILES VERIFIED" || say "SOME PROFILES FAILED"
  exit $rc
fi

# ── 2. mirror the source into a generation dir (once) ────────────────────────
# One shared generation per (version) is correct: every profile's junction can
# point at the same immutable payload, exactly like the official installer.
FIRST_ROOT="$(printf '%s\n' $PROFILES | head -1)"
GEN_ROOT="$(dirname "$FIRST_ROOT")/.generations/live"
GEN="$GEN_ROOT/dsh-xingkong-theme+${VER}+local"
PKG="$GEN/node_modules/dsh-xingkong-theme"

mkdir -p "$GEN/node_modules"
rm -rf "$PKG"
mkdir -p "$PKG"
cp -r "$SRC/bundle" "$PKG/bundle"
for f in package.json cordis.patch.yml README.md README.en.md; do
  [ -f "$SRC/$f" ] && cp "$SRC/$f" "$PKG/"
done
printf '{\n  "pluginName": "dsh-xingkong-theme",\n  "version": "%s"\n}\n' "$VER" > "$GEN/generation.json"
printf 'node-linker=hoisted\n' > "$GEN/.npmrc"
printf '{\n  "name": "dsh-generation",\n  "private": true,\n  "version": "0.0.0",\n  "dependencies": {\n    "dsh-xingkong-theme": "%s"\n  }\n}\n' "$VER" > "$GEN/package.json"
say "generation: mirrored -> $GEN"
say ""

# ── prune stale generations of OUR OWN plugin ────────────────────────────────
# Every deploy under a NEW version number used to leave the previous generation
# behind forever: `.dsh/profiles/.generations/live/` had accumulated 1.3.0,
# 1.4.0, 1.6.0, 1.7.0, 1.8.0, 1.9.0 alongside 1.10.0. That is not just untidy —
# it is a live hazard. If any profile's junction ever points at an old
# generation (which is exactly how a theme appears "not to change" while every
# deploy reports success), the stale payload is still sitting there ready to be
# served. Prune every dsh-xingkong-theme generation that is NOT the current one.
#
# XK_KEEP_OLD_GEN=1 skips the prune. It is a SAFETY VALVE, not a requirement:
# measured 2026-10-11, a running app keeps serving wallpaper assets through the
# junction path it was loaded with (the old generation was removed by the app's
# own profile maintenance while the app was live, and /xingkong-bg/* still
# answered 200/206 — so asset resolution follows the junction dynamically).
# Keep the flag when deploying mid-session anyway: it costs nothing, and a
# future path form could resolve to a fixed generation instead.
if [ "${XK_KEEP_OLD_GEN:-0}" = "1" ]; then
  note "keeping previous generations (XK_KEEP_OLD_GEN=1) — prune after the app restarts"
else
for GR in $(printf '%s\n' $PROFILES | while read -r p; do dirname "$p"; done | sort -u); do
  LIVE="$GR/.generations/live"
  [ -d "$LIVE" ] || continue
  for old in "$LIVE"/dsh-xingkong-theme+*; do
    [ -e "$old" ] || continue
    [ "$old" = "$GEN" ] && continue
    rm -rf "$old" && note "pruned stale generation: $(basename "$old")"
  done
done
fi

# Git-Bash hands /c/... paths to PowerShell, which then reads them as
# D:\c\... — so convert both sides to native backslash form first.
win() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"
  else printf '%s' "$1" | sed -e 's|^/\([a-zA-Z]\)/|\1:\\|' -e 's|/|\\|g'
  fi
}

# RIVALS / RIVAL_RE are declared at the top of the script — see the note there.


RC=0
for PROFILE in $PROFILES; do
  NM="$PROFILE/node_modules"
  PATCH="$PROFILE/cordis.patch.yml"
  DST="$NM/dsh-xingkong-theme"
  say "[$PROFILE]"

  # ── 3. junction into node_modules ──────────────────────────────────────────
  if [ -e "$DST" ] && [ ! -L "$DST" ]; then
    say "  note     : $DST was a plain directory (never resynced); backing it up"
    mv "$DST" "$DST.STALE.bak"
  fi
  if [ -L "$DST" ]; then rm -f "$DST"; fi
  mkdir -p "$NM"

  WPAIR="$(win "$PKG")"
  WLINK="$(win "$DST")"
  if command -v powershell >/dev/null 2>&1; then
    powershell -NoProfile -Command "New-Item -ItemType Junction -Path '$WLINK' -Target '$WPAIR' | Out-Null" || true
  fi
  if [ -L "$DST" ]; then
    say "  junction : OK"
  else
    fail "  junction was not created at $DST"; RC=1; continue
  fi

  # ── 4. register in cordis.patch.yml (idempotent) ───────────────────────────
  #
  # 🔴 THE `name` MUST BE A file:/// URL, NOT A BARE PACKAGE NAME.
  #
  # This was the bug that made 10 releases of work look like nothing happened.
  # We used to append:
  #     - insert:
  #         - id: xingkong-theme
  #           name: dsh-xingkong-theme            <-- bare specifier
  #
  # A bare specifier is resolved by Node from the loader's base URL against
  # `dsh.profile.bundles` + `dependencies`. Every OTHER bare name in the
  # profile patch is a @deepseek-ai/* package that arrives via a bundle layer
  # (or dshmarket, which is in BOTH dependencies and bundles). Our package is
  # in neither, so the specifier resolved to nothing and the entry was dropped
  # SILENTLY — no error, no log, just a stock-looking UI.
  #
  # By contrast every third-party plugin that actually mounted used a URL:
  #   - id: 'mkt-kimino-theme'
  #     name: 'file:///C:/.../node_modules/dsh-kimino-theme/bundle/host.js'
  #   - id: 'mkt-wallpaper-engine'
  #     name: 'file:///C:/.../dsh-plugin-wallpaper-engine/lib/index.js'
  #   - id: 'mkt-ui-skin-claude-style'
  #     name: 'file:///C:/.../dsh-claude-style/lib/host/index.js'
  #
  # The URL form is also what the Desktop app itself uses for its own plugins
  # in desktop-host-sources.patch.yml. Use it here too. Path is built from the
  # profile dir being patched ($DST), so each profile points at its own copy.
  #
  # Why this still worked for the HOST half: the host is loaded by the Node
  # side from the package if it can find it, and /xingkong-bg/* DID serve
  # (HTTP 200) while the client module never composed. The client-modules
  # registry resolves independently and needs the URL to locate the package.
  HOST_URL="file:///$(win "$DST/bundle/host.js" | sed 's|\\|/|g')"
  if grep -q "name: 'file:///.*dsh-xingkong-theme/bundle/host.js'" "$PATCH" 2>/dev/null; then
    say "  register : already present (url form)"
  elif grep -q 'name: dsh-xingkong-theme' "$PATCH" 2>/dev/null; then
    # Bare-name form left by an older deploy — rewrite it in place.
    cp "$PATCH" "$PATCH.bak-barename-$(date +%s)"
    sed -i "s|^\( *\)name: dsh-xingkong-theme *$|\1name: '$HOST_URL'|" "$PATCH"
    say "  register : REWRITTEN bare name -> url form"
  else
    cp "$PATCH" "$PATCH.bak-$(date +%s)"
    {
      printf '\n# Nebula Core (星空主题) —— animated nebula wallpaper + full light/dark palette.\n'
      printf '# Registered by URL, not by bare package name: a bare specifier is\n'
      printf '# resolved against dsh.profile.bundles/dependencies, which do not list\n'
      printf '# this local package, so it would be dropped silently (client never loads).\n'
      printf -- "- insert:\n    - id: xingkong-theme\n      name: '%s'\n" "$HOST_URL"
    } >> "$PATCH"
    say "  register : appended to cordis.patch.yml (url form)"
  fi

  # ── 5. VISUAL EXCLUSIVITY ──────────────────────────────────────────────────
  # Rival visual plugins must not be co-mounted with this theme. Several of them
  # (dsh-kimino-theme, dsh-plugin-wallpaper-engine) declare dsh.client.immediately
  # = true, so they mount ahead of the normal activation queue and claim the
  # canvas plus the --dsw-alias-* token namespace before we get a turn. When two
  # or more themes both call ctx.theme.overrideTokens the loader reconciles them
  # per token, so whichever wins last *for that token* decides — producing a
  # patchwork UI (some settings cards light, others still dark) and a frosted
  # overlay that hides the nebula canvas completely.
  for hot in "$PROFILE"/.dsh-market/hot-*.yml; do
    [ -f "$hot" ] || continue
    if grep -Eq "$RIVALS" "$hot"; then
      mv "$hot" "$hot.disabled-xingkong"
      say "  market   : disabled visual competitor $(basename "$hot")"
    fi
  done
  # A rival can also re-enter through the profile's own bundle list.
  if grep -q 'dsh-kimino-theme' "$PROFILE/package.json" 2>/dev/null; then
    say "  market   : NOTE dsh-kimino-theme is still listed in profile package.json"
  fi

  # ── 6. verify bytes for THIS profile ───────────────────────────────────────
  vrc=0
  cmp -s "$SRC/bundle/client.js" "$DST/bundle/client.js" || { fail "  client.js DIFFERS"; vrc=1; }
  cmp -s "$SRC/bundle/host.js"   "$DST/bundle/host.js"   || { fail "  host.js DIFFERS";   vrc=1; }
  cmp -s "$SRC/bundle/probe-core.js" "$DST/bundle/probe-core.js" || { fail "  probe-core.js DIFFERS"; vrc=1; }
  for f in nebula.jpg nebula-web.mp4 nebula-light.jpg nebula-light.mp4; do
    cmp -s "$SRC/bundle/assets/$f" "$DST/bundle/assets/$f" || { fail "  asset $f DIFFERS"; vrc=1; }
  done
  if [ $vrc -eq 0 ]; then
    say "  verify   : client.js + host.js + probe-core.js + assets(4/4) MATCH"
  else
    RC=1
  fi
  say ""
done

say "DONE. Fully quit and relaunch DeepSeek Harness (check the tray icon —"
say "the process often stays resident) for the theme to be picked up."
say "Themes are read from the profile the app actually mounts; both known"
say "roots were deployed. A healthy boot logs:"
say "  [xingkong-theme] host half active (4/4 asset routes registered)"
exit $RC
