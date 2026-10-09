# dsh-xingkong-theme · Nebula Core (星空主题)

A **deep-space observatory** theme for the DeepSeek Harness Web GUI. Pure token theme —
it swaps the official `--dsw-*` design tokens and touches nothing else (no wallpaper, no neon
diffusion, no structural CSS).

- **Dark = 深空 (Deep Space)**: Void Black `#030508` · Nebula Navy `#0A0E1A` · Abyss Blue `#0D1B2A`,
  aurora-cyan accent `#00D4AA`, nebula violet `#7B61FF`, comet gold `#FFD700`,
  starlight white text `#E8F4F8`, interstellar dust `#6B7B8D`
- **Light = 星云白昼 (Nebula Daylight)**: same hue language on light surfaces, accent darkened
  to `#009E82` for ~4.6:1 contrast on white
- **Coverage: all 110 semantic tokens** of the official system (`alias-*` × 99 + `specific-*` × 11),
  including the sidebar trio `specific-sidebar-fill` / `-nav-item-hover` / `-nav-item-active(-accent)`

Design language: `DeepSeek_Harness_星空主题设计系统.md` (Nebula Core).

## Bundle layout (same shape as official themes)

```
package.json        dsh.bundle.patch + dsh.client{platform:web,immediately}
cordis.patch.yml    insert: xingkong-theme → dsh-xingkong-theme
bundle/host.js      host half (pure token theme needs no asset routes)
bundle/client.js    browser half: ctx.theme.overrideTokens('xingkong', {…110 tokens})
```

## Install

```powershell
cd $env:USERPROFILE\.dsh\profiles\web
pnpm add file:D:\path\to\dsh-xingkong-theme
```

Then add `"dsh-xingkong-theme"` to `dsh.profile.bundles` in that folder's `package.json`
and restart the desktop app (the engine reloads bundles on start).

## Uninstall

```powershell
cd $env:USERPROFILE\.dsh\profiles\web
pnpm remove dsh-xingkong-theme
```

and remove the line from `dsh.profile.bundles`.

## Design rules (when editing)

1. Override tokens only — no hard-coded component selectors (the single exception is text
   selection colour and scrollbar radius, noted in `bundle/client.js`).
2. Light-scheme colours must pass contrast: body text ≥ 4.5:1, secondary ≥ 3:1.
3. Glow/gradient belongs to the "Deep Space" expression and stays out of shared tokens.
