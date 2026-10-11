// Nebula Core (星空主题) — browser half of the dsh-xingkong-theme bundle.
// Registered with the web module loader via the package's ./client export;
// the cordis loader adopts `exports` (apply/inject) as the plugin object.
//
// v1.13.0 changes
//   · TYPE ON A PHOTOGRAPH, REBUILT. Light-mode body copy is white ink with a
//     blurred dark shadow. Dark ink failed structurally, not chromatically: it
//     landed on the wallpaper's mid-tones at nearly the same luminance (measured
//     ≈0.19 for both, 1.9:1–2.6:1) while white reaches ≈4.4:1 there. NO glyph
//     outline anywhere — `-webkit-text-stroke` is a centred stroke that eats half
//     its width inward, and a 15px CJK counter is only ~2px across, so even
//     0.55px closes it up. `paint-order: stroke fill` keeps the fill from
//     thinning but cannot save the counters.
//   · NO MID-BLUE ON MID-BLUE. The status strip and each message's action row
//     were painted in the tertiary label token, which sat on the wallpaper's
//     dark band (measured p90 110–135) at almost the same value. Both are now
//     white with a soft shadow; SVG icons take a drop-shadow instead, because
//     SVG ignores text-shadow.
//   · DARK-MODE FILM REMOVED. The app root frame and the sidebar's bottom
//     panels carried white rules with NO light-mode prefix, so dark mode wore a
//     22% white sheet over the whole window. Painted per scheme now, plus a
//     standing audit that fails any "light background without the light prefix".
//   · LIGHT WALLPAPER GRADED. The visible wallpaper layer is the video, not the
//     JPEG (readyState 4 — a poster only shows before the first frame), so the
//     video gets brightness/contrast; the JPEG additionally gets a real unsharp
//     mask for the poster and the no-video fallback.
//
// v1.11.0 changes
//   · MODEL PROBE PANEL. The official Models page can add custom providers and
//     list their models, but it cannot tell which models actually answer, nor
//     show context windows or thinking levels (the official README states
//     reasoning levels are deliberately not editable). This release adds a
//     probe panel inside every pi-ai provider card, through the two extension
//     seats the official page declares for out-of-tree plugins
//     (settings.models.provider-card / settings.models.footer). The panel is
//     registered under key llm-pi-ai, reads the provider profile from the
//     official settings mirror (configForms), and talks to this plugin's own
//     host route (/xingkong-model/*) where the probing actually runs — model
//     endpoints send no CORS headers and the API key never reaches the
//     renderer. The probing engine lives in ./probe-core.js.
//     Everything in this section is OPTIONAL and defended: missing React, a
//     missing slots/configForms service, or a missing host route only logs a
//     warning; the theme itself is never affected.
//
// v1.10.0 changes
//   · THE COMPOSER BOUNDARY NOW FADES INSTEAD OF CLIPPING. The transcript
//     scrolls UNDER a floating composer card, and the previous mitigation was
//     a 14px gradient strip below the seat. 14px is far shorter than the
//     ~72px card, so lines between 14px and 72px still ran into the card's
//     rounded corners and 1px border — the user's "底部又跟输入框穿模了".
//     The card is now preceded by a real mask fade on the MESSAGE AREA.
//     Target choice matters: verified against the official
//     dsh-client-ui-conversation bundle,
//       .Dc7zOa_root[data-conversation-content]
//         └ .Dc7zOa_body
//             └ .Dc7zOa_scrollBody[data-conversation-scroll]
//                 ├ [data-slot="conversation.session"] > .Dc7zOa_viewArea
//                 └ .Dc7zOa_composerSeat[data-composer-seat]
//     the composer seat is a SIBLING of the message area INSIDE the scroll
//     container. Masking [data-conversation-scroll] would therefore fade the
//     input box too; we mask [class*="viewArea"] instead. A @supports
//     fallback paints a blurred dissolve above the card for engines without
//     CSS masking.
//
// v1.9.0 changes
//   · THE CONVERSATION PANE IS NOW COMPLETELY CLEAR. v1.8.0 fixed the glyph
//     halo but replaced it with a translucent radial SCRIM parked behind the
//     reading column. That still dimmed the wallpaper under the whole pane,
//     and the user rejected it: "背景不是还是被遮住的吗，对话框的背景可以
//     高清一点清晰一点，不用遮住". The scrim is gone entirely.
//     Legibility is now carried by INK ALONE: label tiers pushed to genuine
//     dark/bright values and a body weight that is a real variable-font
//     instance. The only remaining effect on body copy is a single 1px
//     DOWNWARD-offset shadow — which never enters a glyph counter, unlike
//     the v1.7 outline — so light glyphs do not dissolve into bright cloud.
//     No scrim, no backdrop-filter, no halo anywhere on the pane.
//   · LIGHT WALLPAPER RE-ENCODED AT HIGHER RESOLUTION. The light loop was
//     authored at 1600x900 while the dark one and the 4K poster were both
//     larger; on a 1920x1080+ display the light wallpaper was therefore
//     being upscaled every frame, which reads as soft/糊. Re-encoded with a
//     Lanczos resample so the light scheme is as crisp as the dark one.
//
// v1.8.0 changes
//   · KILLED THE WHITE GLYPH HALO. v1.5.0–v1.7.0 made text readable by
//     painting a four-direction 1px text-shadow outline around every glyph.
//     That instrument is built for SHORT text at LARGE optical size; at 15px
//     Chinese sizes the ring eats the counters of 口/日/回/国 (often only ~2px
//     of interior), so the ink floods inward and the text looks smeared and
//     cheap — the user's "加字体背部底部白色拖影…还有点劣质". Removed
//     everywhere, and replaced with a single soft downward text-shadow.
//     (v1.8.0 also briefly added a backdrop scrim; v1.9.0 removed it again —
//     see above.)
//
// v1.7.0 changes
//   · TYPOGRAPHY REBUILT. The official stylesheet declares
//     body{font-family:var(--dsw-font-family, -apple-system, "Segoe UI",
//     "PingFang SC", "Microsoft YaHei", …)} and NEVER DEFINES the variable —
//     so on Windows the literal fallback rendered Segoe UI + Microsoft YaHei,
//     two unrelated designs on one line with YaHei's cramped counters and
//     NO real 500 weight (the browser was synthesising bold). That is the
//     "字体真的很难看很丑" report. The theme now supplies the missing variable
//     with: Montserrat (the app's own bundled brand font) for Latin, then
//     Noto Sans SC — installed locally as a VARIABLE font with a continuous
//     100..900 axis, so 450/460/620 render as honest instances. Metrics were
//     re-tuned for the new faces (line-height 1.75 -> 1.82, tabular numerals,
//     separate Latin vs CJK tracking).
//   · SIDEBAR IS NOW MID-STRENGTH FROSTED GLASS. It was fully transparent, so
//     small grey labels sat raw on a moving video — unreadable. Now it has a
//     translucent fill + backdrop blur + hairline, so the wallpaper still
//     reads through while text regains a calm surface.
//   · The bottom-left settings entry is an explicit CARD: visible border,
//     its own glass fill, hover state — no longer melting into the rail.
//
// v1.6.0 changes
//   · LOOP NO LONGER REVERSES DIRECTION. The v1.4.0 asset was a PING-PONG
//     (forward, then the same frames reversed). On a rotating sun-disc that
//     reads as the footage spinning backwards at the turnaround — the user's
//     "开始的时候接着图片的那一段有点倒放/逆流/逆向" report. Measured proof:
//     cosine(forward_motion, reverse_motion) = -1.000, i.e. a mathematically
//     exact mirror. The asset is now a SAME-DIRECTION CROSS-DISSOLVE: the body
//     plays forward and the wrap dissolves the tail into the head, so
//     corr(last, first) = +0.9989 and the motion cosine stays +0.993. The
//     reverse() filter must never come back.
//
// v1.5.0 changes
//   · KILLED THE WHITE-GLASS FOG. The canvas panels painted
//     --dsw-alias-bg-layer-1/2/3/4 at rgba(255,255,255,0.62…0.86) plus a
//     near-solid composer seat slab. Over a pale wallpaper that is a milk
//     veil: it desaturates the artwork, lifts the black level, and is exactly
//     the "像白色玻璃一样的雾感" the user reported. Every canvas-level surface
//     (conversation pane, cards, chips, sidebar, bubbles, settings cards) is
//     now fully transparent; only genuinely floating chrome (dialogs, menus,
//     tooltips, the composer card) stays opaque.
//   · REBUILT TEXT LEGIBILITY WITHOUT ANY SURFACE. With the fog gone the
//     contrast has to come from ink + halo. Every text tier now gets a
//     four-direction 1px outline (not a single soft shadow) so glyph edges
//     hold up against a moving cloud field, and the light palette's label
//     tiers are pushed to genuinely dark values (#0B1420 … #24384F).
//     Code blocks opt OUT of the halo and use a solid fill instead.
//   · Composer: the sticky seat's bleed-stop is now a 14px shadow-height
//     gradient beneath the card instead of a 36px full-width mist band.
//
// v1.4.0 changes
//   · SEAMLESS WALLPAPER LOOP (asset superseded in v1.6.0 — see above; the
//     ping-pong described here was replaced because it reversed direction).
//     The residual issue v1.4.0 solved and that is STILL live: the client
//     pre-empts the native `loop` seek (which is what causes the "顿挫感"):
//     a requestVideoFrameCallback watcher rewinds currentTime to 0 within the
//     final frame, before the decoder runs dry. Falls back to the native loop
//     attribute wherever the API is unavailable, so it is never worse than
//     the baseline.
//
// v1.3.0 changes
//   · LIGHT THEME REBUILT AS A FIRST-CLASS SURFACE SYSTEM. The previous build
//     only ever changed --dsw-alias-* colours, so in light mode the app kept
//     its stock white canvas and the only themed thing visible was the
//     composer — "现在浅色如图只有输入框是白色，很诡异". Light is now a full
//     palette: a cool "dawn mist" canvas, translucent frosted cards, and
//     OPAQUE floating surfaces — not a white box on a white page.
//   · The modal override is no longer hardcoded dark. It used to clamp
//     --dsw-alias-bg-layer-1/2/3 to rgba(12,20,36,…) with no light branch,
//     which is exactly why the settings dialog rendered as a black slab in
//     light mode. Floating surfaces are now driven by dedicated
//     --dshx-float-* variables that carry real {light,dark} values, so the
//     dialog, menus, popovers and toasts all follow the active scheme.
//   · Floating surfaces stay OPAQUE (the settings window must be readable),
//     while the canvas and conversation panels stay translucent so the
//     wallpaper reads through. That split is the core design rule.
//   · Wallpaper motion is smooth: no more scale() ken-burns (which resamples a
//     1280x720 frame every tick and judders). A pure translate3d drift on a
//     slightly-oversized layer keeps the GPU on the compositor only.
//   · The video is re-encoded with a 1s keyframe interval so the loop wrap
//     decodes instantly (the old 8.3s GOP was the visible "一颤一颤").
//   · Dark = deep-space observatory; Light = pale dawn nebula (the user's own
//     "Fate 白洞穿越天际" footage, upscaled 1:1 with NO colour grading).
//
// Structural notes (verified against the official frontend bundles):
//   · Token semantics: bg-base = app canvas; bg-layer-1/2/3/4 = cards, chips,
//     panels, dialogs, inputs; bg-mask-1 = modal scrim; mask-blur = scrim blur;
//     elevation-* = shadows. dsh-client-ui-theme defines these per light/dark.
//   · Modal DOM: ._root_o6lrb_6 > ._mask_o6lrb_18 > ._dialog_o6lrb_33.
//   · selectors [data-composer-seat]/[data-composer-card]/[data-composer-input]
//     and class .Dc7zOa_body are real; data-chat-flow is NOT (kimino-only).
window.__ModuleLoader__.load({
  id: 'dsh-xingkong-theme',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const inject = ['theme'];

    const apply = (ctx) => {
      const L = (v) => ({ light: v, dark: v });

      // ── 1. token layer ────────────────────────────────────────────────────
      // Two palettes share one token list. Dark = deep-space observatory;
      // Light = pale dawn nebula with ink labels on frosted white.
      //
        // IMPORTANT split of concerns:
        //   · Canvas / conversation surfaces are FULLY transparent so the
        //     wallpaper is the canvas — completely clear, at full brightness.
        //   · Floating surfaces (overlays, menus, toasts, tooltips) stay HIGH-alpha
        //     so their content is readable regardless of what is behind them.
        //
        // There are only these two states. A "slightly translucent" canvas
        // surface is the worst of both worlds: it does not hide the wallpaper
        // (so it does not help readability) but it does dim and desaturate it
        // (so it ruins the artwork). That is what the user rejected twice —
        // first as 白色玻璃雾感, then as 背景被遮住.
      const dispose = ctx.theme.overrideTokens('xingkong', {
        // ── canvas + content panels ──────────────────────────────────────────
        // The canvas is fully transparent so the wallpaper is the canvas.
        //
        // The content panels must ALSO be transparent — this is the fix for
        // the "白色玻璃一样的雾感". bg-layer-1/2/3/4 are what the conversation
        // pane, its cards and its chips paint, and a translucent WHITE over a
        // pale wallpaper is a milk veil: it desaturates the artwork and lifts
        // the black level, so text contrast drops and the whole surface reads
        // as cheap frosted plastic. Ink is carried by the label tokens, NOT by
        // tinting the surface. (The official .Dc7zOa_root rule paints
        // background:var(--dsw-alias-bg-base), so a zero-alpha bg-base is what
        // makes the whole conversation pane clear.)
        '--dsw-alias-bg-base': { light: 'rgba(244,248,255,0)', dark: 'rgba(3,5,8,0)' },
        '--dsw-alias-bg-layer-1': { light: 'rgba(255,255,255,0)', dark: 'rgba(8,14,26,0)' },
        '--dsw-alias-bg-layer-2': { light: 'rgba(255,255,255,0)', dark: 'rgba(10,18,32,0)' },
        '--dsw-alias-bg-layer-3': { light: 'rgba(255,255,255,0)', dark: 'rgba(12,22,40,0)' },
        '--dsw-alias-bg-layer-4': { light: 'rgba(255,255,255,0)', dark: 'rgba(16,28,50,0)' },
        // ── floating surfaces (OPAQUE so settings/menus are legible) ─────────
        '--dsw-alias-bg-overlay': { light: 'rgba(252,253,255,0.985)', dark: 'rgba(9,14,26,0.985)' },
        // modal scrim: dim the page but do not hide the dialog
        '--dsw-alias-bg-mask-1': { light: 'rgba(20,32,52,0.34)', dark: 'rgba(2,4,9,0.62)' },
        '--dsw-alias-bg-mask-2': { light: 'rgba(20,32,52,0.20)', dark: 'rgba(2,4,9,0.36)' },
        '--dsw-alias-bg-mask-3': { light: 'rgba(20,32,52,0.44)', dark: 'rgba(2,4,9,0.74)' },
        '--dsw-mask-blur': L('blur(3px)'),
        // menu + toast + tooltip surfaces (opaque-ish)
        '--dsw-menu-surface-fill': { light: 'rgba(255,255,255,0.97)', dark: 'rgba(14,22,40,0.97)' },
        '--dsw-menu-backdrop-filter': L('blur(40px) saturate(150%)'),
        '--dsw-hovercard-bg': { light: '#FFFFFFF7', dark: '#161C2CF7' },
        '--dsw-alias-toast-bg': { light: 'rgba(30,42,64,0.96)', dark: 'rgba(14,22,40,0.97)' },
        '--dsw-alias-toast-label': { light: '#F4F8FF', dark: '#EAF6FF' },
        '--dsw-alias-tooltip-bg': { light: 'rgba(30,42,64,0.96)', dark: 'rgba(10,16,30,0.97)' },
        '--dsw-alias-tooltip-key-bg': { light: 'rgba(255,255,255,0.16)', dark: 'rgba(120,220,255,0.14)' },
        // elevation / stroke
        '--dsw-elevation-stroke-color': { light: 'rgba(40,80,130,0.16)', dark: 'rgba(120,220,255,0.16)' },
        // ── borders ──────────────────────────────────────────────────────────
        '--dsw-alias-border-l1': { light: 'rgba(50,90,140,0.14)', dark: 'rgba(120,220,255,0.14)' },
        '--dsw-alias-border-l2': { light: 'rgba(50,90,140,0.22)', dark: 'rgba(120,220,255,0.22)' },
        '--dsw-alias-border-l3': { light: 'rgba(50,90,140,0.30)', dark: 'rgba(120,220,255,0.30)' },
        '--dsw-alias-border-l4': { light: 'rgba(50,90,140,0.36)', dark: 'rgba(120,220,255,0.36)' },
        '--dsw-alias-border-l2-darkmode-thin': { light: 'rgba(50,90,140,0.16)', dark: 'rgba(120,220,255,0.16)' },
        // ── brand + buttons ──────────────────────────────────────────────────
        '--dsw-alias-brand-primary': { light: '#2E93D9', dark: '#5AD6FF' },
        '--dsw-alias-button-elevated-fill': { light: 'rgba(46,147,217,0.10)', dark: 'rgba(120,220,255,0.08)' },
        '--dsw-alias-button-floating-fill': { light: 'rgba(46,147,217,0.12)', dark: 'rgba(120,220,255,0.10)' },
        '--dsw-alias-button-floating-hover': { light: 'rgba(46,147,217,0.20)', dark: 'rgba(120,220,255,0.17)' },
        '--dsw-alias-button-primary-dimmed': { light: 'rgba(46,147,217,0.20)', dark: 'rgba(90,214,255,0.18)' },
        '--dsw-alias-button-primary-fill': { light: '#2E93D9', dark: '#3FB6E8' },
        '--dsw-alias-button-primary-hover': { light: '#2482C4', dark: '#5AD6FF' },
        '--dsw-alias-button-ghost-active-fill': { light: 'rgba(46,147,217,0.16)', dark: 'rgba(90,214,255,0.16)' },
        '--dsw-alias-button-ghost-active-hover': { light: 'rgba(46,147,217,0.24)', dark: 'rgba(90,214,255,0.24)' },
        '--dsw-alias-button-ghost-active-border': { light: 'rgba(46,147,217,0.55)', dark: 'rgba(90,214,255,0.52)' },
        '--dsw-alias-button-tool-bar-fill': { light: 'rgba(46,147,217,0.12)', dark: 'rgba(120,220,255,0.10)' },
        '--dsw-alias-button-tool-bar-hover': { light: 'rgba(46,147,217,0.20)', dark: 'rgba(120,220,255,0.17)' },
        // ── interactive ──────────────────────────────────────────────────────
        '--dsw-alias-interactive-bg-hover': { light: 'rgba(46,147,217,0.09)', dark: 'rgba(120,220,255,0.08)' },
        '--dsw-alias-interactive-bg-active': { light: 'rgba(46,147,217,0.16)', dark: 'rgba(90,214,255,0.16)' },
        '--dsw-alias-interactive-bg-hover-danger': { light: 'rgba(214,60,80,0.13)', dark: 'rgba(255,110,130,0.14)' },
        // ── labels (ink on light, ice on dark) ───────────────────────────────
        '--dsw-alias-label-primary': { light: '#131C29', dark: '#EAF6FF' },
        '--dsw-alias-label-primary-foreground': { light: '#FFFFFF', dark: '#0A1420' },
        '--dsw-alias-label-secondary': { light: '#394B62', dark: '#B9D4E8' },
        '--dsw-alias-label-tertiary': { light: '#1F7FC4', dark: '#5AD6FF' },
        '--dsw-alias-label-caption': { light: '#5A6E86', dark: '#7C93AB' },
        '--dsw-alias-label-dimmed': { light: '#77879B', dark: '#8FA6BC' },
        '--dsw-alias-label-shimmer': { light: 'rgba(19,28,41,0.28)', dark: 'rgba(234,246,255,0.05)' },
        '--dsw-alias-link': { light: '#1668AC', dark: '#7CE0FF' },
        '--dsw-alias-label-error': { light: '#B32B3F', dark: '#FF6E82' },
        // ── markdown ─────────────────────────────────────────────────────────
        '--dsw-alias-markdown-inline-code': { light: 'rgba(46,147,217,0.14)', dark: 'rgba(90,214,255,0.13)' },
        '--dsw-alias-markdown-code-block': { light: 'rgba(255,255,255,0.94)', dark: 'rgba(4,10,20,0.72)' },
        '--dsw-alias-markdown-code-block-banner': { light: 'rgba(46,147,217,0.09)', dark: 'rgba(90,214,255,0.08)' },
        '--dsw-alias-markdown-tag': { light: 'rgba(46,147,217,0.12)', dark: 'rgba(90,214,255,0.11)' },
        // ── states ───────────────────────────────────────────────────────────
        '--dsw-alias-state-error-primary': { light: '#B32B3F', dark: '#FF6E82' },
        '--dsw-alias-state-success-primary': { light: '#0F7A60', dark: '#6EE7C7' },
        '--dsw-alias-state-success-tertiary': { light: 'rgba(15,122,96,0.15)', dark: 'rgba(110,231,199,0.14)' },
        '--dsw-alias-state-warn-primary': { light: '#9C6A0F', dark: '#FFCB6B' },
        '--dsw-alias-state-warn-tertiary': { light: 'rgba(156,106,15,0.15)', dark: 'rgba(255,203,107,0.14)' },
        '--dsw-alias-state-business-primary': { light: '#2E93D9', dark: '#5AD6FF' },
        '--dsw-alias-state-idle-primary': { light: '#77879B', dark: '#7C93AB' },
        // ── sidebar / specific ───────────────────────────────────────────────
        // The sidebar is mid-strength frosted glass: translucent, NOT opaque
        // (that would hide the wallpaper) and NOT fully transparent (that
        // leaves small grey labels raw on a moving video). The blur that
        // makes it read as glass is applied in the CSS layer.
        '--dsw-specific-sidebar-fill': { light: 'rgba(255,255,255,0.60)', dark: 'rgba(6,12,24,0.56)' },
        '--dsw-specific-nav-item-hover': { light: 'rgba(46,147,217,0.10)', dark: 'rgba(120,220,255,0.09)' },
        '--dsw-specific-nav-item-active': { light: 'rgba(46,147,217,0.17)', dark: 'rgba(90,214,255,0.16)' },
        '--dsw-specific-input-major': { light: 'rgba(255,255,255,0.97)', dark: 'rgba(6,14,28,0.88)' },
        '--dsw-specific-bubble': { light: 'rgba(255,255,255,0)', dark: 'rgba(10,20,38,0)' },
        '--dsw-specific-tip': { light: 'rgba(255,255,255,0.94)', dark: 'rgba(4,10,20,0.82)' },
        '--dsw-specific-menu': { light: 'rgba(255,255,255,0.97)', dark: 'rgba(12,30,58,0.96)' },
        '--dsw-specific-selector': { light: 'rgba(46,147,217,0.10)', dark: 'rgba(120,220,255,0.10)' },
        // settings card (official: settings-card-fill = bg-layer-2)
        '--dsw-alias-settings-card-fill': { light: 'rgba(255,255,255,0)', dark: 'rgba(10,18,32,0)' },
        '--dsw-alias-settings-card-stroke': { light: 'rgba(50,90,140,0.18)', dark: 'rgba(120,220,255,0.20)' },
        // misc
        '--dsw-alias-switch-thumb': { light: '#FFFFFF', dark: '#EAF6FF' },
        '--dsw-alias-scrollbar-bg-l2': { light: 'rgba(46,147,217,0.32)', dark: 'rgba(90,214,255,0.30)' },
        '--dsw-alias-scrollbar-hover-l2': { light: 'rgba(46,147,217,0.58)', dark: 'rgba(90,214,255,0.55)' },
        '--dsw-shadow-lv2': { light: '0 8px 28px rgba(30,60,100,0.18)', dark: '0 8px 28px rgba(0,0,0,0.42)' },
        '--dsw-shadow-lv3': { light: '0 12px 36px rgba(30,60,100,0.22)', dark: '0 12px 36px rgba(0,0,0,0.52)' },
        '--dsw-focus-ring-color': { light: 'rgba(46,147,217,0.85)', dark: 'rgba(90,214,255,0.85)' },
      });
      ctx.effect(() => dispose);

      // ── 1a. floating-surface variable layer ───────────────────────────────
      // The official modal paints with --dsw-alias-bg-layer-2, menus with
      // --dsw-menu-surface-fill, and so on. Those tokens MUST stay translucent
      // for the canvas but MUST be opaque for a dialog — one variable cannot be
      // both. So we introduce our own --dshx-float-* variables carrying real
      // {light,dark} values, and point the floating surfaces at them by scope
      // instead of hardcoding colours in CSS. This is what makes the settings
      // window legible in BOTH schemes (it used to be hardcoded dark).
      const floatVars = {
        '--dshx-float-1': { light: 'rgba(255,255,255,0.985)', dark: 'rgba(12,20,36,0.985)' },
        '--dshx-float-2': { light: 'rgba(255,255,255,0.985)', dark: 'rgba(14,22,40,0.985)' },
        '--dshx-float-3': { light: 'rgba(246,250,255,0.985)', dark: 'rgba(18,28,50,0.985)' },
        '--dshx-float-menu': { light: 'rgba(255,255,255,0.985)', dark: 'rgba(14,22,40,0.985)' },
        '--dshx-float-inset': { light: 'rgba(240,246,254,0.92)', dark: 'rgba(6,12,24,0.66)' },
        '--dshx-float-stroke': { light: 'rgba(50,90,140,0.18)', dark: 'rgba(120,220,255,0.20)' },
        '--dshx-float-shadow': {
          light: '0 18px 48px rgba(28,54,92,0.20), 0 2px 8px rgba(28,54,92,0.10)',
          dark: '0 18px 48px rgba(0,0,0,0.58), 0 2px 8px rgba(0,0,0,0.36)',
        },
      };
      const disposeFloat = ctx.theme.overrideTokens('xingkong-float', floatVars);
      ctx.effect(() => disposeFloat);

      // marker attributes for CSS scoping / debugging
      document.documentElement.setAttribute('data-xingkong-theme', 'on');
      ctx.effect(() => () => document.documentElement.removeAttribute('data-xingkong-theme'));

      // ── 1b. animated wallpaper ────────────────────────────────────────────
      // The host half serves /xingkong-bg/nebula.mp4 (dark) and
      // /xingkong-bg/nebula-light.mp4 (light). Both are seamless loops with a
      // 1s keyframe interval so the wrap decodes instantly, and BOTH are now
      // encoded at the native 1920x1080 so nothing is upscaled on a 1080p+
      // display. The light one is a same-direction cross-dissolve (see the
      // loop note below) — never a ping-pong.
      const DARK_VIDEO = '/xingkong-bg/nebula.mp4';
      const DARK_POSTER = '/xingkong-bg/nebula.jpg';
      const LIGHT_VIDEO = '/xingkong-bg/nebula-light.mp4';
      const LIGHT_POSTER = '/xingkong-bg/nebula-light.jpg';

      const bgVideo = document.createElement('video');
      bgVideo.id = 'xingkong-bg-video';
      bgVideo.muted = true;
      bgVideo.loop = true;
      bgVideo.autoplay = true;
      bgVideo.playsInline = true;
      bgVideo.setAttribute('muted', '');
      bgVideo.setAttribute('playsinline', '');
      bgVideo.setAttribute('aria-hidden', 'true');
      bgVideo.setAttribute('data-plugin', 'dsh-xingkong-theme');
      document.body.prepend(bgVideo);

      // Authoritative light/dark source.
      //
      // Verified contract (dsh-client-ui-theme):
      //   · Runtime service: ctx.theme.getTheme() returns
      //       { preference, fontSize, active, themes, revision }
      //     and the ACTIVE COLOR SCHEME lives at `snapshot.active.colorScheme`
      //     ("light" | "dark").  There is NO top-level `.colorScheme`.
      //   · The boot script (lib/types/boot-theme.js) writes two DOM signals:
      //       document.documentElement.dataset.dsThemeSource = preference
      //       document.body.toggleAttribute('data-ds-dark-theme', dark)
      //
      // We consult all three, most authoritative first.
      const readScheme = () => {
        // 1) runtime service — the composed active theme
        try {
          const snap = ctx.theme && ctx.theme.getTheme && ctx.theme.getTheme();
          const cs = snap && snap.active && snap.active.colorScheme;
          if (cs === 'light' || cs === 'dark') return cs;
        } catch (_) { /* fall through */ }

        const b = document.body;
        const h = document.documentElement;
        const has = (el, a) => !!(el && el.hasAttribute && el.hasAttribute(a));
        const get = (el, a) => (el && el.getAttribute ? el.getAttribute(a) : null);

        // 2) the raw preference marker written by the boot script. This is the
        //    most specific signal because it also resolves "system".
        const src = get(h, 'data-ds-theme-source') || get(b, 'data-ds-theme-source');
        if (src === 'light' || src === 'dark') return src;
        if (src === 'system') {
          try {
            if (typeof matchMedia === 'function') {
              return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
            }
          } catch (_) { /* ignore */ }
        }

        // 3) the resolved boolean attributes
        if (has(b, 'data-ds-dark-theme') || has(h, 'data-ds-dark-theme')) return 'dark';
        if (has(b, 'data-ds-light-theme') || has(h, 'data-ds-light-theme')) return 'light';
        const attr = get(b, 'data-ds-theme') || get(h, 'data-ds-theme');
        if (attr === 'light' || attr === 'dark') return attr;
        // 4) last resort: the OS scheme, then dark (the app's ship default).
        try {
          if (typeof matchMedia === 'function') {
            return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
          }
        } catch (_) { /* ignore */ }
        return 'dark';
      };

      const srcFor = (dark) => (dark
        ? { src: DARK_VIDEO, poster: DARK_POSTER }
        : { src: LIGHT_VIDEO, poster: LIGHT_POSTER });

      const kickVideo = () => {
        const p = bgVideo.play();
        if (p && p.catch) p.catch(() => {});
      };

      // ── Seamless loop ────────────────────────────────────────────────────
      // TWO mechanisms, because they solve two different problems:
      //
      //  (a) CONTENT seam — solved in the ASSET. Both clips are authored as
      //      same-direction cross-dissolves: the body plays forward, and the
      //      wrap segment dissolves the tail into the head so that the last
      //      frame IS the frame the loop restarts on.
      //      Measured on the encoded assets (see _verify_loop.py):
      //        light 3.40s: seam 1.170 vs mean delta 0.830; clip max 1.319
      //        dark 20.53s: seam 1.356 vs mean delta 0.188; clip max 1.220
      //      Both wraps are at or below the clip's OWN worst normal frame-to-
      //      frame change, i.e. the wrap is indistinguishable from ordinary
      //      motion. Motion direction cosine stays +0.99 on both.
      //
      //      NOTE: an earlier build used a PING-PONG (forward then reversed).
      //      It measured well on the seam (cos = -1.000 means the second half
      //      was an exact mirror) but that is precisely the bug the user
      //      reported: for a rotating disc the footage visibly SPINS
      //      BACKWARDS at the turnaround — 视频倒放/逆流/逆向. Motion direction
      //      must never flip. Do NOT reintroduce reverse().
      //
      //  (b) PLAYER seam — solved here. The native `loop` attribute seeks back
      //      to 0 only AFTER the last frame is presented, which can cost a
      //      frame or two: the "顿挫感". So we take over the wrap: watch
      //      presentation frames and, within one frame of the end, set
      //      currentTime to 0 before the decoder runs dry.
      //
      // Declared before syncWallpaper() on purpose: syncWallpaper re-arms this
      // state when it swaps the video source, so the definitions must exist.
      let vfcHandle = null;
      let wrapArmed = false;
      const LOOP_LEAD = 1 / 30;          // one frame at the asset's 30 fps

      function onFrame(_now, _meta) {
        const dur = bgVideo.duration;
        if (isFinite(dur) && dur > 0) {
          const t = bgVideo.currentTime;
          const remaining = dur - t;
          // Arm only once we are past the halfway mark, so a stray early
          // callback near t=0 cannot trigger an immediate rewind loop.
          if (t > dur * 0.5) wrapArmed = true;
          if (wrapArmed && remaining > 0 && remaining <= LOOP_LEAD) {
            wrapArmed = false;
            try {
              bgVideo.currentTime = 0;
              kickVideo();
            } catch (_) { /* fall back to the native loop */ }
          }
        }
        scheduleFrameWatch();
      }

      function scheduleFrameWatch() {
        if (!bgVideo || typeof bgVideo.requestVideoFrameCallback !== 'function') return;
        if (vfcHandle !== null) return;   // already queued
        vfcHandle = bgVideo.requestVideoFrameCallback((now, meta) => {
          vfcHandle = null;
          onFrame(now, meta);
        });
      }

      function stopFrameWatch() {
        if (vfcHandle !== null && typeof bgVideo.cancelVideoFrameCallback === 'function') {
          try { bgVideo.cancelVideoFrameCallback(vfcHandle); } catch (_) { /* ignore */ }
        }
        vfcHandle = null;
      }

      let lastMode = null;
      const syncWallpaper = (force) => {
        const scheme = readScheme();
        if (!force && scheme === lastMode) return;
        lastMode = scheme;
        const s = srcFor(scheme === 'dark');
        bgVideo.poster = s.poster;
        if (bgVideo.getAttribute('src') !== s.src) {
          bgVideo.setAttribute('src', s.src);
          bgVideo.load();
        }
        document.documentElement.setAttribute('data-xingkong-mode', scheme);
        // Re-arm the manual wrap for the (possibly new) source: load() resets
        // currentTime, so a stale wrapArmed === true would rewind immediately.
        wrapArmed = false;
        stopFrameWatch();
        scheduleFrameWatch();
        kickVideo();
      };

      // Only engage the manual wrap where the API exists. Everywhere else the
      // native `loop` attribute (still set on the element above) remains the
      // behaviour, so this can never be worse than the baseline.
      if (typeof bgVideo.requestVideoFrameCallback === 'function') {
        scheduleFrameWatch();
        bgVideo.addEventListener('play', scheduleFrameWatch);
        bgVideo.addEventListener('seeked', scheduleFrameWatch);
        ctx.effect(() => () => {
          stopFrameWatch();
          bgVideo.removeEventListener('play', scheduleFrameWatch);
          bgVideo.removeEventListener('seeked', scheduleFrameWatch);
        });
      }

      syncWallpaper(true);

      // Preferred path: subscribe to the theme service's change event.
      if (ctx.on) ctx.on('theme/change', () => syncWallpaper(false));
      // Belt-and-braces: also watch the DOM signals the boot script / presenter
      // writes — `data-ds-dark-theme` on <body>, `data-ds-theme-source` on <html>.
      const mo = new MutationObserver(() => syncWallpaper(false));
      const moOpts = {
        attributes: true,
        attributeFilter: [
          'data-ds-dark-theme', 'data-ds-light-theme',
          'data-ds-theme', 'data-ds-theme-source',
        ],
      };
      if (document.body) mo.observe(document.body, moOpts);
      if (document.documentElement) mo.observe(document.documentElement, moOpts);
      ctx.effect(() => () => mo.disconnect());

      // A user can also flip the OS scheme while preference === "system".
      let mediaQuery = null;
      const onMediaChange = () => syncWallpaper(false);
      try {
        if (typeof matchMedia === 'function') {
          mediaQuery = matchMedia('(prefers-color-scheme: dark)');
          if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', onMediaChange);
          else if (mediaQuery.addListener) mediaQuery.addListener(onMediaChange);
        }
      } catch (_) { /* ignore */ }
      ctx.effect(() => () => {
        try {
          if (mediaQuery) {
            if (mediaQuery.removeEventListener) mediaQuery.removeEventListener('change', onMediaChange);
            else if (mediaQuery.removeListener) mediaQuery.removeListener(onMediaChange);
          }
        } catch (_) { /* ignore */ }
      });

      // Autoplay can be rejected until a gesture; retry on first interaction.
      const onGesture = () => { kickVideo(); window.removeEventListener('pointerdown', onGesture); };
      window.addEventListener('pointerdown', onGesture, { once: true });
      ctx.effect(() => () => {
        window.removeEventListener('pointerdown', onGesture);
        bgVideo.pause();
        bgVideo.removeAttribute('src');
        bgVideo.load();
        bgVideo.remove();
      });

      // ── 2. visual layer ───────────────────────────────────────────────────
      const styleEl = document.createElement('style');
      styleEl.id = 'xingkong-theme';
      styleEl.setAttribute('data-plugin', 'dsh-xingkong-theme');
      styleEl.textContent = `
/* Keep the root transparent so the wallpaper layer shows through the canvas. */
html { background-color: transparent !important; }

/* ── Animated wallpaper layer ─────────────────────────────────────────────
   SHARPNESS (measured 2026-10-10). The previous build used
       inset: -3vmax; width: calc(100vw + 6vmax); height: calc(100vh + 6vmax)
   plus a 72s "alternate" drift. That oversizing forced object-fit:cover to
   DOWNSCALE a 1920x1080 source into a box ~6vmax larger than the viewport,
   then resample again on every animation tick. Result, measured against the
   source asset rendered at the same on-screen size:
       right-middle wallpaper   0.67x as sharp
       upper-right wallpaper    0.87x as sharp
   i.e. the video was visibly softer than its own source — the user's
   "整个背景依旧不是清晰的".
   Fix: the layer is now EXACTLY the viewport (no oversize, so cover maps 1:1
   with no extra downscale), and the drift is gone. A moving background can
   never be perfectly sharp anyway — every tick resamples — and the user has
   already rejected the motion twice ("一颤一颤的不流畅", "应该一直顺时针转下去").
   A still, full-resolution frame is both sharper AND calmer. The --sharp
   class is what actually wins the detail back. */
#xingkong-bg-video {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  object-fit: cover;
  object-position: center center;
  z-index: -2;
  pointer-events: none;
  display: block;
  /* Pull maximum detail out of the frame. "high-quality" is a real hint to
     the compositor; without it Chromium defaults to a cheaper filter for
     scaled video layers. */
  image-rendering: -webkit-optimize-contrast;
  image-rendering: auto;
  transform: translate3d(0, 0, 0);
  /* No animation: see the note above. Denoised motion is not worth the
     resolution loss on a wallpaper that is mostly static cloud. */
  will-change: auto;
  backface-visibility: hidden;
}
@media (prefers-reduced-motion: reduce) {
  #xingkong-bg-video { animation: none; }
}

/* ── Light wallpaper grade: deeper, more dimensional ───────────────────────
   Request: "浅色的背景图亮度可以调暗一点，锐度调高一点显得更立体清晰".

   ⚠️ THE VISIBLE LAYER IS THE VIDEO, NOT THE JPEG. Verified on the live app:
   readyState 4 with currentTime 5.42s, so the element is showing a decoded
   FRAME — a poster only ever appears before the first frame arrives. Grading
   nebula-light.jpg therefore only fixes the no-video fallback; this filter is
   what actually changes the wallpaper the user is looking at.

   CSS cannot sharpen, so the "锐度" half of the request is carried by
   contrast() — it lifts micro-contrast, which is what reads as crispness on a
   soft cloud field. The JPEG gets a REAL unsharp mask as well (see
   _grade_light_wallpaper.py); the two recipes are matched so the fallback and
   the video agree.

   The filter is safe on this element: it is its own fixed, z-index:-2 layer,
   so nothing else is affected, and a filter does not move it in the stack.
   Dark mode is deliberately NOT filtered — it was not reported as flat, and
   the dark nebula wants its full range. */
html[data-xingkong-mode="light"] #xingkong-bg-video {
  filter: brightness(0.93) contrast(1.07) saturate(1.03);
}

/* ── Task panel in the composer seat: tint it to match the theme ───────────
   Request: "这个任务框换成淡蓝的吧，符合主题".

   It ships as rgba(255,255,255,0.97) — a near-opaque WHITE card, which is the
   one surface in the light build that does not belong: the whole palette is
   blue-on-blue, and next to the composer card (whose blue is borrowed from the
   wallpaper showing through 60% white) this one reads as a foreign white box.

   ⚠️ [data-composer-seat] section IS SPECIFIC HERE — verified that the seat
   contains exactly ONE <section> (the task panel). The panel's own class is
   build-hashed (aSus8q_root), so the element type plus the seat is the stable
   way in; the surrounding divs are display:contents and cannot be painted.

   The panel's text is dark (--dsw-alias-label-primary #131C29 for the label,
   tertiary for the count) and stays dark — the white-ink tier for the
   conversation body never reaches it, because those elements set their own
   colour directly. So tinting the surface needs no ink change; only the
   tertiary count is nudged darker, because mid-blue #1F7FC4 on a pale blue
   panel lands at ~3.7:1 and this is 13px text. */
html[data-xingkong-mode="light"] [data-composer-seat] section {
  --dsw-alias-label-tertiary: #15639F;
  color: var(--dsw-alias-label-primary) !important;
  background-color: rgba(226, 239, 252, 0.94) !important;
  border: 1px solid rgba(60, 110, 165, 0.20) !important;
  -webkit-text-stroke-width: 0;
  text-shadow: none !important;
}
/* ⚠️ TINTING THE PANEL EXPOSED A BUG INTRODUCED THE SAME DAY. The white-ink
   tier (white fill + soft dark shadow) exists for text sitting DIRECTLY on the
   wallpaper. The task panel paints its own pale surface, so it must opt out —
   otherwise its list items inherit white from the conversation root and seven
   of them (li / body / glyph / content) turn white-on-pale-blue, i.e. invisible.
   Verified by counting white leaf nodes inside the panel: 7 before this rule.

   Two hops are needed because both of my own rules reach in:
     · the container rule paints [data-conversation-content], so the panel needs
       its OWN colour or the whole subtree inherits white;
     · the tier also targets li/p/td/th/strong by name, which outranks an
       inherited value — hence the explicit reset, with [data-conversation-scroll]
       in the selector purely to win on specificity.
   The count badge ("7 已完成") is a span and keeps its own tertiary colour. */
html[data-xingkong-mode="light"] [data-conversation-scroll] [data-composer-seat] section li,
html[data-xingkong-mode="light"] [data-conversation-scroll] [data-composer-seat] section p,
html[data-xingkong-mode="light"] [data-conversation-scroll] [data-composer-seat] section td,
html[data-xingkong-mode="light"] [data-conversation-scroll] [data-composer-seat] section th,
html[data-xingkong-mode="light"] [data-conversation-scroll] [data-composer-seat] section strong {
  color: inherit !important;
  -webkit-text-stroke-width: 0;
  text-shadow: none !important;
}

/* Static fallback: if the video is absent/blocked, the poster JPEG covers it.
   Light vs dark pick different wallpapers via [data-xingkong-mode]. */
body {
  background-color: #030508 !important;
  background-image: url('/xingkong-bg/nebula.jpg') !important;
  background-size: cover !important;
  background-position: center center !important;
  background-attachment: fixed !important;
  background-repeat: no-repeat !important;
  -webkit-font-smoothing: antialiased !important;
  -moz-osx-font-smoothing: grayscale !important;
  text-rendering: optimizeLegibility !important;
  /* 450 is a REAL instance of Noto Sans SC's variable axis (100–900), so it
     renders as an honest weight rather than a synthesised one. The old 500
     was chosen for YaHei, which has no 500 at all — the browser was faking
     it, and faked weight is a big part of why the text read as cheap. */
  font-weight: 450 !important;
  letter-spacing: 0.01em !important;
}
html[data-xingkong-mode="light"] body {
  background-color: #dfe9f7 !important;
  background-image: url('/xingkong-bg/nebula-light.jpg') !important;
  background-size: cover !important;
  background-position: center center !important;
  /* One notch heavier than dark. Dark ink over a BRIGHT, busy field reads
     lighter than the same ink on a dark field — the eye judges stroke weight
     against the surround — so light mode carries a little more stroke. (This
     used to be explained by "the white halo eats the weight"; the halo is
     gone as of 2026-10-11, but the extra stroke still measures better.) */
  font-weight: 460 !important;
}

/* ── TYPOGRAPHY ───────────────────────────────────────────────────────────
   THE PROBLEM. The official stylesheet declares

     body { font-family: var(--dsw-font-family, -apple-system,
            BlinkMacSystemFont, "Segoe UI", "PingFang SC",
            "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", …) }

   and NEVER DEFINES --dsw-font-family anywhere. So the literal fallback list
   is what actually renders, and on Windows that resolves to:
       Latin/numerals -> Segoe UI
       Chinese        -> Microsoft YaHei
   Segoe UI mixed with YaHei at weight 500 is the "很难看很丑" report: two
   unrelated designs on one line, mismatched x-height, YaHei's cramped
   counters, and faux-bold smearing because YaHei has no real 500.

   THE FIX. Define the variable the app forgot, with a stack that pairs a
   quality geometric sans for Latin with a quality CJK face:
       Montserrat      — already bundled by the app (300/400/500). Geometric,
                         modern, and it is the app's own brand font, so the
                         UI suddenly looks intentional instead of assembled.
       Noto Sans SC    — installed on this machine as a VARIABLE font
                         (NotoSansSC-VF.ttf, 100–900). Real weight axis, so
                         450/500/560 render as true instances instead of
                         synthesised bold. This is the single biggest win.
       PingFang / HarmonyOS / MiSans — good CJK faces on other platforms.
       Microsoft YaHei — last-resort fallback only.

   Note the ORDER: Montserrat first, then the CJK faces. Latin glyphs are
   taken from Montserrat and CJK from Noto; the browser walks the stack per
   glyph, not per element, so this is exactly the pairing we want. */
:root, body {
  --dsw-font-family:
    "Montserrat",
    "Noto Sans SC",
    "PingFang SC",
    "HarmonyOS Sans SC",
    "MiSans",
    "Hiragino Sans GB",
    "Microsoft YaHei",
    -apple-system, BlinkMacSystemFont, "Segoe UI",
    "Helvetica Neue", Helvetica, Arial, sans-serif !important;
}
/* Monospace stays monospace — but pick faces that survive a busy wallpaper
   and are actually present on Windows. */
:root, body {
  --dsw-font-markdown-code-font-family:
    "JetBrains Mono", "Cascadia Code", "Cascadia Mono",
    "SF Mono", "Consolas", "Liberation Mono", Menlo, Courier, monospace !important;
}
/* Apply the stack to the layout containers that carry body copy, so surfaces
   which set a literal font-family (rather than var()) also pick it up. We do
   NOT use a universal selector: that would clobber <code>/<pre>, which are
   re-asserted separately below. We also deliberately do not touch the brand
   wordmark or icon glyphs — they are intentionally their own faces. */
[data-conversation-content],
[data-conversation-scroll],
[class*="sidebar" i], [data-dsh-sidebar],
[role="dialog"][aria-modal="true"],
[role="menu"], [role="listbox"], [role="tooltip"] {
  font-family: var(--dsw-font-family) !important;
}
/* Keep code and math on their own stacks. */
[data-conversation-content] code,
[data-conversation-content] pre,
[data-conversation-content] kbd,
[data-conversation-content] samp {
  font-family: var(--dsw-font-markdown-code-font-family) !important;
}

/* ── SIDEBAR: mid-strength frosted glass ─────────────────────────────────
   Until v1.6.0 the sidebar was fully transparent, so its labels sat raw on
   the video — small grey text over a moving cloud field is unreadable, which
   is the "侧边栏" complaint. But making it OPAQUE would hide the wallpaper,
   which the user explicitly did not want either.

   So: real frosted glass. Translucent fill + backdrop blur + a hairline on
   the right edge. The blur is what makes it read as glass rather than as a
   tinted rectangle — it keeps the wallpaper's colour and glow while
   dissolving its detail, so text regains a calm surface to sit on without
   the panel looking like a solid slab.

   Tuned as "中度磨砂" (the user's choice): the wallpaper stays clearly
   visible, text is comfortably legible. */
[class*="sidebar" i], [data-dsh-sidebar] {
  background-color: rgba(6, 12, 24, 0.48) !important;
  backdrop-filter: blur(24px) saturate(150%) !important;
  -webkit-backdrop-filter: blur(24px) saturate(150%) !important;
  border-right: 1px solid rgba(120, 220, 255, 0.16) !important;
  box-shadow: 1px 0 0 rgba(0, 0, 0, 0.28), 8px 0 32px rgba(0, 0, 0, 0.30) !important;
  /* NO text-shadow here. The backdrop-filter already provides the calm
     surface, so a glyph halo on top of it is redundant ink — and it was the
     same 拖影 the conversation pane had. Glass needs no outline on its
     contents; that is the whole point of glass. */
}
html[data-xingkong-mode="light"] [class*="sidebar" i],
html[data-xingkong-mode="light"] [data-dsh-sidebar] {
  background-color: rgba(255, 255, 255, 0.40) !important;
  backdrop-filter: blur(26px) saturate(150%) brightness(1.05) !important;
  -webkit-backdrop-filter: blur(26px) saturate(150%) brightness(1.05) !important;
  border-right-color: rgba(50, 90, 140, 0.22) !important;
  box-shadow: 1px 0 0 rgba(255, 255, 255, 0.55), 8px 0 30px rgba(28, 54, 92, 0.16) !important;
}

/* ── SIDEBAR VEIL, PART 2: kill the two white layers UNDERNEATH ours ───────
   Measured on the live renderer via CDP, the sidebar is not one panel but
   FOUR stacked layers between the wallpaper and the text:

     video (z=-2)                      <- the wallpaper
     .BynINW_frame          a = 0.60   <- official root fill
     .BynINW_sidebarCol     a = 0.40   <- ours (blur lives here)
     ._2H3hWW_root          a = 0.60   <- OFFICIAL sidebar panel, on TOP
     ._2H3hWW_footerActions a = 0.72   <- official footer card
     ._2H3hWW_settingsArea  a = 0.72   <- official footer card

   Cumulative transmission of the wallpaper: 0.40 x 0.40 x 0.40 = 9.6%.
   That is why the sidebar still measured as a white slab (b-r of -3 at
   y=548) no matter how far our own alpha was lowered: we were only ever
   editing ONE of the four layers, and the two 0.60/0.72 official fills
   dominate the result.

   Two structural problems, not tuning problems:
     1. The official panel's class is _2H3hWW_root — it does NOT contain the
        substring "sidebar", so [class*="sidebar" i] never matched it. Every
        earlier attempt was editing an element that the veil did not live on.
     2. Our backdrop-filter sat UNDERNEATH two opaque-ish official fills, so
        the "backdrop" it sampled was already white. Glass cannot read as
        glass when it is blur-ing a white sheet.

   The fix is to make ours the TOP layer and stop the whites underneath:
     - put the official inner panel to transparent so our glass is the surface
       the user actually sees (fill + blur together, on one element);
     - drop the frame fill to nothing over the sidebar column only, so the
       wallpaper is no longer multiplied down to a tenth of its light.

   _2H3hWW_* are build-hashed class names, so every rule below is also
   anchored on [class*="sidebarCol" i] / [class*="sidebar" i], and the JS
   refresher re-asserts them if a rebuild renames the hashes. */
[class*="sidebar" i] [class*="_root"],
[class*="sidebarCol" i] [class*="_root"] {
  background-color: transparent !important;
}
/* ⚠️ THESE TWO RULES USED TO PAINT WHITE IN **BOTH** SCHEMES — the dark-mode
   leak the user reported as "深色的背景有一层白膜一样的东西". A light surface is
   only ever correct on the light scheme; on the dark one it is a film of white
   over the wallpaper. Both are now explicitly per-scheme, and an audit script
   (see _audit_dark.js in the build notes) scans this stylesheet for any other
   "light background without the light prefix" rule so this class of bug cannot
   come back silently. */
[class*="sidebarCol" i] > [class*="_root"],
[class*="sidebar" i] [class*="_footerActions"],
[class*="sidebar" i] [class*="_settingsArea"] {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
html[data-xingkong-mode="light"] [class*="sidebarCol" i] > [class*="_root"],
html[data-xingkong-mode="light"] [class*="sidebar" i] [class*="_footerActions"],
html[data-xingkong-mode="light"] [class*="sidebar" i] [class*="_settingsArea"] {
  background-color: rgba(255, 255, 255, 0.34) !important;
}
/* Dark: the same panels, as frosted glass one step lighter than the rail —
   never white. */
html:not([data-xingkong-mode="light"]) [class*="sidebarCol" i] > [class*="_root"],
html:not([data-xingkong-mode="light"]) [class*="sidebar" i] [class*="_footerActions"],
html:not([data-xingkong-mode="light"]) [class*="sidebar" i] [class*="_settingsArea"] {
  background-color: rgba(14, 26, 44, 0.55) !important;
}
/* The app FRAME (the element that fills the whole window and sits behind both
   columns) needs its 0.60 white dropped to 0.22, or the wallpaper is multiplied
   down to nothing.

   ⚠️ THIS WAS WRITTEN AS [class*="frame" i] AND THAT WAS A BUG (2026-10-11).
   A class-substring match is not a selector for "the app frame": it also hit
   .xz4KEq_frame, which is the MESSAGE COLUMN's own container (988x3888, the
   whole transcript). The result was a 22% white veil painted over every
   conversation — and because that element IS the content, the veil scrolled up
   and down together with the text. The user reported exactly that: "这个白罩是
   文字自带的底部因为我上下移动的时候那个也会跟着移动".

   Keyed structurally instead: the frame is the element that DIRECTLY contains
   the sidebar column, which no message element ever does.

   ⚠️ AND IT MUST BE PER-SCHEME. Written unprefixed this painted 22% WHITE in
   dark mode too, on the one element that spans the entire window — i.e. a
   milky film over the whole dark UI ("深色的背景有一层白膜一样的东西").
   Light wants a white lift (the stock 0.60 washed the wallpaper out); dark
   wants a shallow dark scrim that deepens the wallpaper without hiding it. */
html[data-xingkong-mode="light"] *:has(> [class*="sidebarCol" i]) {
  background-color: rgba(255, 255, 255, 0.22) !important;
}
html:not([data-xingkong-mode="light"]) *:has(> [class*="sidebarCol" i]) {
  /* Same 0.22 magnitude as the light tier, as a dark scrim instead of a white
     lift — enough to seat the columns, not enough to read as a veil. The
     wallpaper stays plainly visible, which is the point of this theme. */
  background-color: rgba(3, 7, 14, 0.22) !important;
}

/* ── SETTINGS / BOTTOM-LEFT CONTROL: a distinct card, not a wallflower ────
   The bottom-left settings affordance used to melt into the sidebar. It now
   gets an explicit card treatment — visible border, its own glass fill,
   rounded corners — so it reads as a discrete control the way a proper
   desktop app's settings entry does. Hover brightens the fill and the
   stroke, giving it affordance without needing an icon change. */
[class*="sidebar" i] [class*="setting" i],
[class*="sidebar" i] [class*="account" i],
[class*="sidebar" i] [class*="footer" i],
[class*="sidebar" i] [class*="bottom" i],
[data-dsh-sidebar] [class*="setting" i],
[data-dsh-sidebar] [class*="account" i] {
  border-radius: 10px;
  border: 1px solid rgba(120, 220, 255, 0.22);
  background-color: rgba(14, 26, 46, 0.62);
  backdrop-filter: blur(12px) saturate(130%);
  -webkit-backdrop-filter: blur(12px) saturate(130%);
  transition: background-color 140ms ease, border-color 140ms ease;
}
[class*="sidebar" i] [class*="setting" i]:hover,
[class*="sidebar" i] [class*="account" i]:hover,
[data-dsh-sidebar] [class*="setting" i]:hover,
[data-dsh-sidebar] [class*="account" i]:hover {
  background-color: rgba(22, 40, 68, 0.78);
  border-color: rgba(120, 220, 255, 0.42);
}
html[data-xingkong-mode="light"] [class*="sidebar" i] [class*="setting" i],
html[data-xingkong-mode="light"] [class*="sidebar" i] [class*="account" i],
html[data-xingkong-mode="light"] [class*="sidebar" i] [class*="footer" i],
html[data-xingkong-mode="light"] [class*="sidebar" i] [class*="bottom" i],
html[data-xingkong-mode="light"] [data-dsh-sidebar] [class*="setting" i],
html[data-xingkong-mode="light"] [data-dsh-sidebar] [class*="account" i] {
  border-color: rgba(50, 90, 140, 0.28);
  background-color: rgba(255, 255, 255, 0.72);
}
html[data-xingkong-mode="light"] [class*="sidebar" i] [class*="setting" i]:hover,
html[data-xingkong-mode="light"] [class*="sidebar" i] [class*="account" i]:hover,
html[data-xingkong-mode="light"] [data-dsh-sidebar] [class*="setting" i]:hover,
html[data-xingkong-mode="light"] [data-dsh-sidebar] [class*="account" i]:hover {
  background-color: rgba(255, 255, 255, 0.90);
  border-color: rgba(46, 147, 217, 0.50);
}

/* Wallpaper stays SHARP: no page-wide blur. */
body::before { content: none; }

/* ── Floating surfaces must be OPAQUE ─────────────────────────────────────
   The official dialog paints --dsw-alias-bg-layer-2; menus use
   --dsw-menu-surface-fill; toasts/tooltips their own tokens. Those tokens are
   set to translucent wallpaper values so the page reads through — but a modal
   must NOT be see-through. Re-point them at the --dshx-float-* variables,
   which carry real {light,dark} values, so BOTH schemes stay legible.
   Modal DOM: ._root_o6lrb_6 > ._mask_o6lrb_18 > ._dialog_o6lrb_33 */
[role="dialog"][aria-modal="true"] {
  --dsw-alias-bg-layer-1: var(--dshx-float-1);
  --dsw-alias-bg-layer-2: var(--dshx-float-2);
  --dsw-alias-bg-layer-3: var(--dshx-float-3);
  --dsw-alias-bg-layer-4: var(--dshx-float-3);
  --dsw-alias-settings-card-fill: var(--dshx-float-1);
  --dsw-alias-settings-card-stroke: var(--dshx-float-stroke);
  --dsw-menu-surface-fill: var(--dshx-float-menu);
}
/* Every floating layer the app puts on top of the canvas, not just dialogs. */
[data-dsw-portal], [role="menu"], [role="listbox"], [role="tooltip"],
[data-radix-popper-content-wrapper], [data-dsw-popover] {
  --dsw-alias-bg-layer-1: var(--dshx-float-1);
  --dsw-alias-bg-layer-2: var(--dshx-float-2);
  --dsw-alias-bg-layer-3: var(--dshx-float-3);
  --dsw-menu-surface-fill: var(--dshx-float-menu);
}
/* The dialog's own card/inset chrome (settings sections, code panes inside). */
[role="dialog"][aria-modal="true"] {
  border: 1px solid var(--dshx-float-stroke) !important;
  box-shadow: var(--dshx-float-shadow) !important;
}

/* ── HARD FALLBACK for floating surfaces ────────────────────────────────────
   The variable route above depends on --dshx-float-* inheriting into the
   portal subtree. A React portal mounted on document.body is outside the
   element that carries those custom properties, so var() can resolve to
   nothing and the dialog keeps whatever dark literal it inherited — which is
   exactly the "settings window is still black in light mode" report, and why
   only SOME settings cards picked up the light palette (the ones whose own
   tokens happened to resolve).
   This block paints the surfaces directly from the scheme-scoped literals, so
   it works whether or not the custom properties reach the subtree. Values are
   duplicated deliberately: a fallback that depends on the thing it is backing
   up is not a fallback. */
html[data-xingkong-mode="light"] [role="dialog"][aria-modal="true"],
html[data-xingkong-mode="light"] [data-dsw-portal],
html[data-xingkong-mode="light"] [role="menu"],
html[data-xingkong-mode="light"] [role="listbox"],
html[data-xingkong-mode="light"] [role="tooltip"],
html[data-xingkong-mode="light"] [data-dsw-popover] {
  background-color: #ffffff !important;
  --dsw-alias-bg-layer-1: #ffffff;
  --dsw-alias-bg-layer-2: #ffffff;
  --dsw-alias-bg-layer-3: #f6faff;
  --dsw-alias-bg-layer-4: #f6faff;
  /* DO NOT assign --dsw-alias-bg-base here.
     bg-base is the APPLICATION CANVAS colour, not a floating-surface colour.
     The official conversation CSS paints the composer seat with
         background: linear-gradient(180deg,
           color-mix(in srgb, var(--dsw-alias-bg-base) 0%, transparent) 0px,
           var(--dsw-alias-bg-base) 36px);
     i.e. an opaque 36px band along the bottom of the transcript, into which
     the last lines of text dissolve. That is exactly the fade-out the user
     asked for — but it only works while bg-base is TRANSPARENT. Overwriting
     bg-base with an opaque white here (this block matches a very broad set of
     portal-ish ancestors) turns that band into a solid white bar: the
     "对话框背景被一层白色罩着" + "底部穿模" report, both from one cause.
     Floating surfaces stay opaque via the background-color declaration above,
     which is scoped to the surface itself and cannot leak down the ancestor
     chain. */
  --dsw-alias-settings-card-fill: #ffffff;
  --dsw-alias-settings-card-stroke: rgba(50, 90, 140, 0.18);
  --dsw-alias-bg-mask-1: rgba(28, 54, 92, 0.34);
  --dsw-menu-surface-fill: #ffffff;
  color-scheme: light;
}
html:not([data-xingkong-mode="light"]) [role="dialog"][aria-modal="true"],
html:not([data-xingkong-mode="light"]) [data-dsw-portal],
html:not([data-xingkong-mode="light"]) [role="menu"],
html:not([data-xingkong-mode="light"]) [role="listbox"],
html:not([data-xingkong-mode="light"]) [role="tooltip"],
html:not([data-xingkong-mode="light"]) [data-dsw-popover] {
  background-color: #0c1424 !important;
  --dsw-alias-bg-layer-1: #0c1424;
  --dsw-alias-bg-layer-2: #0e1628;
  --dsw-alias-bg-layer-3: #121c32;
  --dsw-alias-bg-layer-4: #16223a;
  /* See the light block above: --dsw-alias-bg-base must stay transparent. */
  --dsw-alias-settings-card-fill: #0e1628;
  --dsw-alias-settings-card-stroke: rgba(120, 220, 255, 0.20);
  --dsw-alias-bg-mask-1: rgba(2, 5, 12, 0.62);
  --dsw-menu-surface-fill: #0e1628;
  color-scheme: dark;
}
/* Any inner panel that still asserts its own dark literal gets lifted. */
html[data-xingkong-mode="light"] [role="dialog"][aria-modal="true"] [class*="card"],
html[data-xingkong-mode="light"] [role="dialog"][aria-modal="true"] [class*="panel"],
html[data-xingkong-mode="light"] [role="dialog"][aria-modal="true"] [class*="section"] {
  background-color: transparent;
}

/* ── Composer / input must be OPAQUE (verified selectors) ────────────────
   dsh-client-ui-conversation paints the sticky seat with
   linear-gradient(180deg, color-mix(bg-base 0%, transparent) 0px, bg-base 36px).
   With a transparent bg-base that gradient loses its opaque stop and messages
   bleed through the input box.

   The fix used to be "make the whole seat an opaque slab", but that slab is
   what the user read as 白色玻璃一样的雾感: a 36px-high milky band across the
   full width, parked under the input, washing out the wallpaper behind it.
   The gradient's ONLY job is to stop text from scrolling through the crisp
   input card. So we keep the gradient but make it much shorter and much
   lower-alpha, and let the composer CARD (which is genuinely opaque and has
   its own border + shadow) carry the separation. Result: no fog band, and
   still no bleed-through, because the card itself is opaque. */
/* ── Composer card opacity: WHY IT WAS 0.97 AND WHY THAT WAS THE BUG ────────
   The user asked "输入框的玻璃质感为什么还在这个为什么修了10几次修不好是原视频
   就这样了吗" — i.e. the card has looked like flat paper through a dozen
   attempts. The wallpaper was never the cause. The card was declared at 97%
   opacity:
       --dshx-card: rgba(255,255,255,0.97)
   At 0.97 alpha the backdrop-filter has only 3% of the wallpaper to sample,
   so blur(18px) had nothing to work with and the panel rendered as a flat
   near-opaque sheet. No amount of blur tuning can fix an almost-opaque
   background; the alpha itself is the instrument.

   Real glass needs a genuinely translucent fill. Values chosen so the
   wallpaper still reads through while the ink stays legible:
     light  rgba(255,255,255,0.60)  — bright scene, needs more opacity for
           dark ink, and the blur does the rest
     dark   rgba(9,16,30,0.58)      — the wallpaper is already dark, so a
           lighter fill would kill contrast
   Paired with a stronger backdrop blur and a saturate lift so the glass has
   visible depth rather than reading as a flat wash. */
body { --dshx-seat: rgba(4,9,18,0); --dshx-card: rgba(9,16,30,0.58); }
html[data-xingkong-mode="light"] body {
  --dshx-seat: rgba(233,241,252,0);
  --dshx-card: rgba(255,255,255,0.60);
}
/* The composer seat floats OVER the scrolling transcript (it is position:
   absolute / sticky at the bottom of .Dc7zOa_scrollBody). With a transparent
   canvas the text therefore runs UNDER the input card and reappears at the
   rounded corners — the "穿模" the user reported.
   A 14px gradient strip is NOT enough: it only covers the last 14px, while
   the card is ~72px tall, so everything between 14px and 72px still collides
   with the card's rounded corners and its 1px border.
   The correct instrument is a FADE-OUT MASK on the transcript itself so text
   dissolves BEFORE it reaches the card. Nothing is painted over the
   wallpaper — only the text is masked away — so the pane stays perfectly
   clear.
   CRITICAL — which element to mask. Verified DOM (dsh-client-ui-conversation):
       .Dc7zOa_root[data-conversation-content]
         └ .Dc7zOa_body
             └ .Dc7zOa_scrollBody[data-conversation-scroll]
                 ├ [data-slot="conversation.session"] > .Dc7zOa_viewArea  <- messages
                 └ .Dc7zOa_composerSeat[data-composer-seat]              <- input
   The composer seat is a SIBLING of the message area INSIDE the scroll
   container, so masking [data-conversation-scroll] would fade the input box
   too. We must mask ONLY the .Dc7zOa_viewArea (the messages).

   TWO layers of defence, because either one alone has failed in practice:

   (1) THE OFFICIAL FADE. dsh-client-ui-conversation paints the composer seat
       with an opaque band into which the transcript dissolves:
         .Dc7zOa_root[data-phase=active] .Dc7zOa_composerSeat {
           background: linear-gradient(180deg,
             color-mix(in srgb, var(--dsw-alias-bg-base) 0%, transparent) 0px,
             var(--dsw-alias-bg-base) 36px);
           position: sticky; bottom: 0; }
       With a TRANSPARENT bg-base this band does nothing (gradient from
       transparent to transparent) and the layout still reserves the space, so
       text scrolls clear of the card. Keep bg-base transparent — never assign
       an opaque value to it (see the floating-surface block above).

   (2) OUR MASK, on the message area.
       LAYOUT FACT that dictates the whole design: .Dc7zOa_scrollBody is the
       scroller (overflow-y:auto) and .Dc7zOa_viewArea inside it is
       flex: 1 0 auto, i.e. viewArea is as TALL AS ITS CONTENT, not as tall
       as the viewport. Therefore a percentage in viewArea's mask resolves
       against the FULL SCROLL HEIGHT: calc(100% - 132px) sits 132px above
       the very last line of the whole transcript, which on a long
       conversation is thousands of pixels below the fold. That is why a
       bottom-only mask appeared to work (the end of the document does pass
       under the composer) while a top fade could never work at all — nothing
       masks the region that is actually on screen.

       So the two ends need two different instruments:
         · BOTTOM: keep the mask on viewArea. It is exactly right there — the
           last line of the document is what the composer card would collide
           with, and viewArea's bottom edge IS the document's bottom edge.
         · TOP: a sticky pseudo-element on the scroll container. It has to be
           a viewport-relative box, and only a sticky element has one. It must
           NOT paint a colour (that would veil the wallpaper); it BLURS what
           passes under it and dissolves that blur with a mask, so the
           wallpaper still reads through — the content just loses focus. */
/* ── WHY viewArea CANNOT CARRY THE FADE (measured, 2026-10-10) ────────────
   The previous build put the bottom fade on [class*="viewArea"] as
   calc(100% - Npx). That is anchored to viewArea's CONTENT height (it is
   flex: 1 0 auto), i.e. the end of the WHOLE document — thousands of pixels
   below the fold. Pixel proof from the live app: the composer card's top edge
   sits at y=651, yet the transcript still shows a FULL-CONTRAST line at
   y=762..773 (row spread 175, undimmed). Nothing on screen was being faded;
   what looked like "opacity" was only the composer card's own glass sitting
   over the text. The user's report — "这一行渐隐是假的，根本就是被调了透明度,
   继续往下滑动不会消失" — is correct.
   So the bottom fade moves to a viewport-sized box exactly like the top melt:
   a sticky child of the scroll container. Same instrument, mirrored. */
/* Keep the seat a transparent sticky box; never paint into it. */
.Dc7zOa_root[data-phase="active"] .Dc7zOa_composerSeat,
.Dc7zOa_embeddedBody[data-content-phase="active"] .Dc7zOa_composerSeat {
  background: none !important;
}
/* Safety net for engines without CSS masking: paint a soft backdrop-free
   dissolve above the card using the wallpaper-independent transparent stop,
   so text still fades instead of colliding. */
@supports not ((mask-image: linear-gradient(#000, transparent)) or (-webkit-mask-image: linear-gradient(#000, transparent))) {
  [data-composer-seat]::before {
    content: "";
    position: absolute;
    left: 0; right: 0; bottom: 100%;
    height: 48px;
    pointer-events: none;
    z-index: 1;
    backdrop-filter: blur(3px);
    -webkit-backdrop-filter: blur(3px);
    -webkit-mask-image: linear-gradient(180deg, transparent 0, #000 100%);
    mask-image: linear-gradient(180deg, transparent 0, #000 100%);
  }
}
/* ── NO TOP TREATMENT ────────────────────────────────────────────────────
   There was a "top melt" here that blurred the first ~96px of the
   transcript. The user rejected it outright: "顶部正常显示，顶部那里加模糊
   干嘛？" — and they are right. Nothing needs to happen at the top edge; the
   header hairline already separates the tab strip from the content, and the
   content below it should read at full sharpness. Removed entirely. */
/* ── BOTTOM MELT ─────────────────────────────────────────────────────────
   The mirror of TOP MELT, and the real fix for "文字穿模到输入框".
   WHY NOT STICKY (the first attempt, which failed): the node was appended
   after the composer seat, which is itself "position: sticky; bottom: 0".
   A zero-height sticky element placed AFTER another bottom-sticky sibling has
   no room to be pushed, so it collapsed and painted nothing — confirmed by
   pixels: the transcript still showed a full-contrast line (row spread 175)
   at y=762..773 while the composer card top was at y=651.
   WHY NOT THE viewArea MASK (the original attempt): viewArea is
   "flex: 1 0 auto", so its height is the WHOLE DOCUMENT and its percentage
   stops resolved thousands of pixels below the fold. Same failure — nothing
   on screen was faded.
   WHAT THE USER ACTUALLY WANTS (stated plainly, and they are right):
     "我要的是对话文字在这里就消失而不是穿到底部才消失，渐消是文字有部分
      过线后做的过渡效果，而不是加模糊"
   So: the text must be GONE by the time it reaches the composer card's top
   edge, and the transition is a pure ALPHA ramp on the text itself — NOT a
   blur, and NOT an overlay. A blur was the wrong instrument twice over: it
   softens the text the user is still trying to read, and it does not make the
   text disappear at the line.
   HOW: a real mask on the transcript content, ramping to zero alpha exactly
   ON the composer card's top edge. The long history of WHERE that mask has
   lived is recorded at the rule below — it is the single most failure-prone
   decision in this theme, because the seat is a SIBLING of the messages but a
   CHILD of the scroller. */
/* ── THE FADE: an alpha mask on the MESSAGE COLUMN ─────────────────────────
   ⚠️ WHY IT MUST NOT BE ON .Dc7zOa_scrollBody — this shipped broken and the
   user caught it: "输入框整体消失，你就是这样乱改的？"
   The composer seat is a CHILD of the scroller:
       .Dc7zOa_scrollBody
         ├ [data-slot="conversation.session"] > .Dc7zOa_viewArea  <- messages
         └ .Dc7zOa_composerSeat[data-composer-seat]              <- INPUT BOX
   A mask applies to an element AND everything inside it. Masking the scroller
   therefore drove alpha to 0 across the very band where the input box lives,
   and the card was erased by our own fade. Measured in the user's 1920x1030
   screenshot: from y=820 down to the window floor (212px) the row uniformity
   NEVER exceeded 64%, where a live card reads 90%+. No input box on screen.

   ⚠️ AND WHY NOT ON .Dc7zOa_viewArea either — it is flex: 1 0 auto, so its
   height is the whole document and percentage stops resolve thousands of px
   below the fold. That was the original v1 bug ("这一行渐隐是假的").

   ⚠️ AND WHY NOT ON THE SLOT ITSELF (v6, which shipped as a NO-OP and the user
   caught it again: "原来的底部渐消又没了，字体又能穿下去"):
   [data-slot="conversation.session"] is display: CONTENTS. It generates no
   box, so getBoundingClientRect() is 0x0 — and mask-origin defaults to
   border-box, meaning the gradient is painted into a ZERO-SIZED area. It
   paints nothing. The element is not "faded a little", it is not faded AT ALL.
   The live probe that proved it: slot top=0 bottom=0 h=0 w=0, while
   computed mask-image still reported a perfectly valid gradient, which is
   why the bug survived a screenshot check — the CSS looked right and the mask
   simply had no area to draw in.

   So the mask goes on the slot's CHILD, which is the real message column
   (.Dc7zOa_viewArea): it has a box, and it contains messages only — never the
   seat, so the input box can never be erased by our own fade.

   The stops are PIXEL OFFSETS written by JS from live geometry rather than
   percentages:
       --dshx-fade-h = where the dissolve ENDS   (the composer's top edge)
       --dshx-fade-a = where the dissolve BEGINS
   Both are recomputed on scroll / resize / mutation by syncMelt().
   Falls back to "no mask at all" until JS has measured once (the huge px
   fallbacks put the fully-transparent end far below any real content). */
.Dc7zOa_root[data-phase="active"] [data-slot="conversation.session"] > *,
.Dc7zOa_embeddedBody[data-content-phase="active"] [data-slot="conversation.session"] > * {
  --dshx-fade-h: 99999px;   /* JS overwrites; effectively disables the mask */
  --dshx-fade-a: 99999px;
  -webkit-mask-image: linear-gradient(180deg,
    #000 0,
    #000 var(--dshx-fade-a),
    rgba(0, 0, 0, 0.90) calc(var(--dshx-fade-a) + (var(--dshx-fade-h) - var(--dshx-fade-a)) * 0.22),
    rgba(0, 0, 0, 0.72) calc(var(--dshx-fade-a) + (var(--dshx-fade-h) - var(--dshx-fade-a)) * 0.44),
    rgba(0, 0, 0, 0.48) calc(var(--dshx-fade-a) + (var(--dshx-fade-h) - var(--dshx-fade-a)) * 0.63),
    rgba(0, 0, 0, 0.26) calc(var(--dshx-fade-a) + (var(--dshx-fade-h) - var(--dshx-fade-a)) * 0.79),
    rgba(0, 0, 0, 0.10) calc(var(--dshx-fade-a) + (var(--dshx-fade-h) - var(--dshx-fade-a)) * 0.91),
    rgba(0, 0, 0, 0.02) calc(var(--dshx-fade-a) + (var(--dshx-fade-h) - var(--dshx-fade-a)) * 0.97),
    rgba(0, 0, 0, 0) var(--dshx-fade-h));
  mask-image: linear-gradient(180deg,
    #000 0,
    #000 var(--dshx-fade-a),
    rgba(0, 0, 0, 0.90) calc(var(--dshx-fade-a) + (var(--dshx-fade-h) - var(--dshx-fade-a)) * 0.22),
    rgba(0, 0, 0, 0.72) calc(var(--dshx-fade-a) + (var(--dshx-fade-h) - var(--dshx-fade-a)) * 0.44),
    rgba(0, 0, 0, 0.48) calc(var(--dshx-fade-a) + (var(--dshx-fade-h) - var(--dshx-fade-a)) * 0.63),
    rgba(0, 0, 0, 0.26) calc(var(--dshx-fade-a) + (var(--dshx-fade-h) - var(--dshx-fade-a)) * 0.79),
    rgba(0, 0, 0, 0.10) calc(var(--dshx-fade-a) + (var(--dshx-fade-h) - var(--dshx-fade-a)) * 0.91),
    rgba(0, 0, 0, 0.02) calc(var(--dshx-fade-a) + (var(--dshx-fade-h) - var(--dshx-fade-a)) * 0.97),
    rgba(0, 0, 0, 0) var(--dshx-fade-h));
}
[data-composer-seat] {
  position: relative;
  background: transparent !important;
  /* The seat is a SIBLING of the messages but a CHILD of .Dc7zOa_scrollBody,
     so any mask applied to the scroller erases the input box along with the
     text. The fade therefore lives on the message column (the slot's child)
     and never reaches this element. These declarations are the second line of
     defence: should any future mask reach the scroller, the card still keeps
     its own stacking context so it stays composited above the fade. */
  z-index: 8;
  isolation: isolate;
}
[data-composer-card] {
  /* Must be genuinely translucent for the glass to read. At 0.97 it was
     effectively an opaque panel, which is why the card looked like flat paper
     instead of glass no matter how the blur was tuned. */
  background: var(--dshx-card) !important;
  /* A larger blur plus a saturation lift is what makes a low-alpha fill read
     as glass instead of a wash. saturate() is the part people omit: without it
     a translucent white panel just looks like fog rather than glass. */
  backdrop-filter: blur(26px) saturate(165%) brightness(1.04) !important;
  -webkit-backdrop-filter: blur(26px) saturate(165%) brightness(1.04) !important;
  border: 1px solid var(--dshx-float-stroke) !important;
  box-shadow: var(--dshx-float-shadow) !important;
  position: relative;
  z-index: 1;
}
[data-composer-input] {
  background: transparent !important;
  color: var(--dsw-alias-label-primary) !important;
}
/* Everything layered on the seat (chips, docks) inherits the opaque fill. */
[data-composer-seat] > *:not([data-composer-card]) {
  --dsw-alias-bg-base: var(--dshx-seat);
}

/* ── Status strip under the composer: LIGHT ink, because it sits on DARK ────
   Request: "底下这几个字也优化一下颜色".

   The strip (轮次 / 步数 / tok/s / 累计 token / 缓存命中 / 24%) is painted with
   --dsw-alias-label-tertiary, which is #1F7FC4 in light mode. Measured against
   the wallpaper it actually sits on, that is unusable:

       background under the strip   p10 80   p50 94   (with a bright patch, p90 191)
       #1F7FC4 on that             1.17:1 .. 2.6:1     ← far below any threshold

   The tint is not the problem — the polarity is. That band of the light
   wallpaper is a DARK blue (the city-lights horizon), so a mid-blue label on it
   has almost no separation. Light ink gives 4.3:1 .. 8.5:1 there.

   ⚠️ SCOPE. The token is re-pointed on [data-slot="conversation.composer.bar"],
   a stable data attribute (not one of the build-hashed class names). Verified
   that only THREE leaf elements inside that slot consume the tertiary token —
   both "·" separators and the "24%" readout — all of them part of this strip,
   so the composer card's own text is untouched.

   ⚠️ THE BRIGHT PATCH. The left end of the strip runs under a pale patch of sky
   (measured p90 191), where light ink alone would drop to 1.4:1. So the strip
   gets the same soft dark shadow the conversation body uses — blurred, never a
   hard edge. The dock's icons are SVG and cannot take a text-shadow, so they get
   an equivalent drop-shadow; there are only four of them and they are tiny.

   Dark mode is deliberately untouched: its tertiary is #5AD6FF, a bright cyan
   that already reads on a dark wallpaper. Every rule below is therefore behind
   the light-mode attribute — an unprefixed version would silently repaint the
   dark strip too, which is the same class of bug as the white frame film. */
html[data-xingkong-mode="light"] [data-slot="conversation.composer.bar"] {
  --dsw-alias-label-tertiary: #FFFFFF;
}
html[data-xingkong-mode="light"] [data-slot="conversation.composer.bar"] [class*="dock" i],
html[data-xingkong-mode="light"] [data-slot="conversation.composer.bar"] [class*="dock" i] * {
  text-shadow: 0 0.5px 1.1px rgba(3, 10, 20, 0.62);
}
html[data-xingkong-mode="light"] [data-slot="conversation.composer.bar"] [class*="dock" i] svg {
  filter: drop-shadow(0 0.5px 1px rgba(3, 10, 20, 0.55));
}

/* ── Message action row (copy / like / dislike / share + timestamp) ─────────
   Request: "底部的这几个也换成白色".

   Same failure as the status strip, and for the same reason — a mid-blue on a
   mid-blue band. Measured behind the row (light mode): background p90 110..135,
   current ink #1F7FC4 lands at luminance ~0.19 as well, so the pairing scores
   1.9:1..2.6:1 — the text and the wallpaper are the same value. White ink
   reaches ~4.4:1 on that band.

   The icons need no special handling for colour: their shapes carry
   stroke="currentColor", so re-pointing the token inside the row repaints them
   too. They do need a drop-shadow, because SVG takes no text-shadow.

   Anchor: [data-conversation-content] [class*="_actions" i] — three matches in
   the live DOM, all message action rows. The transcript virtualises, so only
   the handful on screen carry these filters.

   Light-only: dark mode's tertiary (#5AD6FF) already reads on a dark band. */
html[data-xingkong-mode="light"] [data-conversation-content] [class*="_actions" i] {
  --dsw-alias-label-tertiary: #FFFFFF;
}
html[data-xingkong-mode="light"] [data-conversation-content] [class*="_actions" i],
html[data-xingkong-mode="light"] [data-conversation-content] [class*="_actions" i] * {
  text-shadow: 0 0.5px 1px rgba(3, 10, 20, 0.55);
}
html[data-xingkong-mode="light"] [data-conversation-content] [class*="_actions" i] svg {
  filter: drop-shadow(0 0.5px 1px rgba(3, 10, 20, 0.5));
}

/* ── Un-cap the reading column ───────────────────────────────────────────
   Dc7zOa_body caps the chat at clamp(680px, column*0.64, 920px). Drop the
   ceiling so the conversation uses the full pane; keep a comfortable gutter. */
.Dc7zOa_body {
  --dsh-chat-user-width: min(1180px, calc(100% - 96px)) !important;
  --dsh-chat-content-width: min(1180px, calc(100% - 96px)) !important;
  --dsh-composer-card-max-width: min(1180px, calc(100% - 96px)) !important;
}

/* ── Text legibility: ink contrast, NOT a veil over the wallpaper ─────────
   HISTORY OF THIS BLOCK — three instruments, two of them wrong:
     1. v1.5–v1.7  four-direction 1px text-shadow OUTLINE around every glyph.
        Wrong. An outline is built for SHORT text at LARGE optical size
        (logos, captions, video titles). At 15px, Chinese glyphs have very
        small counters — the enclosed negative spaces inside 口 / 日 / 回.
        A 1px ring on all four sides eats a counter that may only be 2px
        across, so the interior fills with ink and the text reads as a grey
        smear with a white cloud behind it. That was the 拖影.
     2. v1.8.0    a BACKDROP SCRIM — a viewport-fixed radial vignette parked
        behind the reading column. It fixed the ink bloom, but it DIMMED the
        wallpaper under the entire conversation pane, and the user rejected
        it: "背景不是还是被遮住的吗，对话框的背景可以高清一点清晰一点，
        不用遮住".
     3. v1.9.0    THIS — no veil at all. The wallpaper is left completely
        clear and full-brightness across the whole pane. Legibility is
        carried ENTIRELY by ink: the label tiers are pushed to genuinely
        dark values (light) / bright values (dark) and the body runs at a
        real mid weight instead of a synthesised one. That is how a
        magazine sets type over a photograph — you choose a heavy enough
        ink, you do not put a translucent sheet over the picture.

   The single soft downward shadow on body copy stays. It is 1px, offset
   downward, very low alpha — it never enters a glyph counter (that is the
   whole difference from an outline) and it is what keeps a light glyph
   from dissolving into a bright patch of cloud. There is NO scrim, NO
   backdrop-filter, and NO halo on the conversation pane.

   NOTE: [data-conversation-scroll] still gets NO position property. The
   official module styles it as .Dc7zOa_scrollBody and nothing here may turn
   it into a containing block. */
[data-conversation-content] {
  /* DARK MODE'S OWN SHADOW — must stay byte-identical. Light mode overrides
     this below; the two schemes do not share a text treatment. */
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.28);
}
/* ⚠️ LIGHT MODE HAD A WHITE SHADOW AND THAT WAS BACKWARDS — 2026-10-11.
   It shipped as 0 1px 1px rgba(255,255,255,0.62) and the user reported
   "类似泛白光的奇怪效果" plus "字体有些不明显". One cause, both symptoms.

   The rationale for a shadow flips with the polarity of the ink:
     dark mode  = LIGHT glyphs on a dark field -> a dark shadow separates them
     light mode = DARK glyphs on a bright field -> a WHITE shadow is a halo
                  painted between the glyph and the page. It lightens the very
                  edge pixels that make a stroke look crisp, so every glyph
                  gains a soft white fringe: the text reads as embossed and
                  hazy, and apparent contrast DROPS.
   Verified at 4x on the live renderer: with the white shadow the heading
   "四、必须告知你的副作用" carried a visible white fringe on every stroke;
   with it removed (or replaced by a dark one) the same glyphs are solid and
   crisp. Numbers do not show this — the effect is a ring of intermediate
   pixels around each stroke, and antialiasing already produces plenty of
   those, so a whole-pane average stays flat. LOOK AT A 4x CROP INSTEAD.

   The replacement is NO SHADOW AT ALL. A second round of feedback settled it:
   the user called the result "越黑反而看的越难受" and pointed at the inline
   code chips as the part that looks RIGHT — and those carry text-shadow:none.
   The 0.5px dark shadow was adding a trace of stroke weight, which is exactly
   the density that made the page feel heavy. Dark ink on a light ground needs
   no separator; it only needed one when it was light ink on a dark ground. */
html[data-xingkong-mode="light"] [data-conversation-content] {
  text-shadow: none;
}

/* ── Light scheme: WHITE INK, SEPARATED BY A SOFT SHADOW ─────────────────
   The tier has been through four designs; this one is the user's direction
   ("换成高亮白色加黑色描边") with one correction they immediately caught:
   "这个黑边加上整个字像是坨了".

   That correction is correct and it is geometric, not a matter of taste. A
   stroke expands INWARD as well as outward — half its width on every side. At
   15px a CJK glyph's counters (the enclosed spaces in 口/日/回/验) are only
   about 2px across, so even a 0.55px stroke eats a quarter of every counter
   and the character closes up into a blob. Larger type survives it; body copy
   does not. There is no stroke width that both separates the glyph and leaves
   the counters open.

   A SOFT SHADOW has no such problem: it is painted behind the glyph, it is
   blurred rather than offset sharply, and it never draws a hard edge inside a
   counter. So the recipe keeps the white fill the user asked for and swaps the
   outline for the classic caption treatment:
     · a short downward shadow  -> guarantees the silhouette over the bright
       cloud, where a white fill has no contrast of its own
     · a very small all-round halo -> keeps the glyph readable over the mid-blue
       cloud as well, without the ring ever becoming a visible edge
   Note this halo is the OPPOSITE case to the white text-shadow that was removed
   from this pane earlier: a white halo behind DARK ink reduces contrast, a dark
   halo behind WHITE ink increases it.

   ⚠️ EVERY TEXT TIER IS LISTED EXPLICITLY. The app paints its own colours from
   the token table (--dsw-alias-label-primary -> #131C29) directly onto p/li/
   td/th, and a DIRECT rule always beats an INHERITED one — so setting colour on
   the container alone left the body copy dark while the headings went white,
   which is exactly the mixed state this produced the first time round. */
html[data-xingkong-mode="light"] [data-conversation-content],
html[data-xingkong-mode="light"] [data-conversation-content] p,
html[data-xingkong-mode="light"] [data-conversation-content] li,
html[data-xingkong-mode="light"] [data-conversation-content] td,
html[data-xingkong-mode="light"] [data-conversation-content] th {
  color: #FFFFFF !important;
  -webkit-text-stroke-width: 0 !important;
  text-shadow:
    0 0.6px 1.2px rgba(4, 12, 24, 0.80),
    0 0 0.6px rgba(4, 12, 24, 0.50) !important;
}
html[data-xingkong-mode="light"] [data-conversation-content] strong,
html[data-xingkong-mode="light"] [data-conversation-content] b {
  color: #FFFFFF !important;
  /* A slightly firmer shadow than the body, so a bold run separates from its
     neighbours by silhouette rather than by colour. */
  text-shadow:
    0 0.7px 1.3px rgba(4, 12, 24, 0.88),
    0 0 0.7px rgba(4, 12, 24, 0.55) !important;
}
html[data-xingkong-mode="light"] [data-conversation-content] h1,
html[data-xingkong-mode="light"] [data-conversation-content] h2,
html[data-xingkong-mode="light"] [data-conversation-content] h3,
html[data-xingkong-mode="light"] [data-conversation-content] h4,
html[data-xingkong-mode="light"] [data-conversation-content] h5,
html[data-xingkong-mode="light"] [data-conversation-content] h6 {
  color: #FFFFFF !important;
  /* MUST be explicit: the generic heading rule sets a DARK downward shadow for
     dark mode and headings would inherit whatever it says. Display sizes take
     a deeper shadow than body copy — they sit on more of the bright cloud. */
  text-shadow:
    0 1px 2px rgba(4, 12, 24, 0.72),
    0 0 1px rgba(4, 12, 24, 0.45) !important;
}
/* CODE AND PRE OPT OUT ENTIRELY. They paint their own near-solid chip, so white
   ink on them would be invisible and a glyph shadow would only muddy the
   monospace stems. The chip tier was explicitly approved by the user
   ("这个部分挺好的不需要改"). */
html[data-xingkong-mode="light"] [data-conversation-content] code,
html[data-xingkong-mode="light"] [data-conversation-content] pre,
html[data-xingkong-mode="light"] [data-conversation-content] pre * {
  -webkit-text-stroke-width: 0;
  text-shadow: none !important;
}
html[data-xingkong-mode="light"] [data-conversation-content] a {
  color: #0A5590 !important;
  text-underline-offset: 2px;
}
/* Inline code sits on its own chip, so the soft shadow would double up.
   The chip must also be GENUINELY solid in light mode. The stock fill is
   rgba(46,147,217,0.14) with mid-blue ink — and the wallpaper behind this pane
   is ALSO bright blue, so the chip barely separates from the cloud and the
   filename inside reads washed out. That is the "字体有些不明显" the user
   pointed at in the 序/结果 table. Dark mode already paints its own chip fill
   from the token table, so this stays light-only. */
html[data-xingkong-mode="light"] [data-conversation-content] code:not(pre code) {
  color: #0B3557 !important;
  background-color: rgba(240, 246, 253, 0.92) !important;
  border: 1px solid rgba(50, 90, 140, 0.18) !important;
  text-shadow: none !important;
}
/* Dark scheme: same logic in reverse. On a fully clear deep-space wallpaper
   the ink must be bright enough to hold its own against starfields. */
html:not([data-xingkong-mode="light"]) [data-conversation-content] {
  color: #F2F6FC !important;
}
html:not([data-xingkong-mode="light"]) [data-conversation-content] p,
html:not([data-xingkong-mode="light"]) [data-conversation-content] li,
html:not([data-xingkong-mode="light"]) [data-conversation-content] td,
html:not([data-xingkong-mode="light"]) [data-conversation-content] th {
  color: #E6EDF8 !important;
}
html:not([data-xingkong-mode="light"]) [data-conversation-content] strong,
html:not([data-xingkong-mode="light"]) [data-conversation-content] b {
  color: #FFFFFF !important;
}

/* ── Sidebar: a soft frosted rail, not a raw hole in the wallpaper ────────
   The official sidebar is a flat fill; over a wallpaper it needs a hint of
   its own material or it reads as "unfinished". Keep it weak so the nebula
   still shows, but give it a top highlight and a hairline separator. */
[class*="sidebar" i], [data-dsh-sidebar] {
  border-right: 1px solid var(--dshx-float-stroke);
}
html[data-xingkong-mode="light"] [class*="sidebar" i] {
  border-right-color: rgba(60,100,150,0.16);
}

/* ── Headings ───────────────────────────────────────────────────────────
   (size / weight / tracking live in TYPOGRAPHY METRICS below.)
   Headings no longer carry an outline either. They sit directly on the
   wallpaper like the body copy, and because they are larger and heavier they
   need even less help — a single soft downward offset keeps them from
   floating, and that is all. Outlining display sizes is what made them look
   embossed and cheap. */
[data-conversation-content] h1, [data-conversation-content] h2,
[data-conversation-content] h3, [data-conversation-content] h4,
[data-conversation-content] h5, [data-conversation-content] h6 {
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.34);
}
/* Light-mode headings are handled with the rest of the white-ink tier above
   (colour + per-tier stroke width). No duplicate rule here — a later rule with
   equal specificity would silently win the cascade and undo the white fill. */
[data-conversation-content] code,
[data-conversation-content] pre,
[data-conversation-content] kbd {
  font-variant-ligatures: none !important;
}
/* Code blocks must stay readable in BOTH schemes. The block paints its own
   token fill, so it does NOT need the glyph halo — a halo on top of a solid
   chip just smears the monospace stems. */
[data-conversation-content] pre {
  border: 1px solid var(--dshx-float-stroke) !important;
  box-shadow: none !important;
}
[data-conversation-content] pre,
[data-conversation-content] pre * {
  text-shadow: none !important;
}
/* Light: give the code block a genuinely solid, high-contrast fill rather
   than a 4%-off-white chip floating on the video. */
html[data-xingkong-mode="light"] [data-conversation-content] pre {
  background-color: rgba(252, 253, 255, 0.96) !important;
  border-color: rgba(50, 90, 140, 0.22) !important;
}
html[data-xingkong-mode="light"] [data-conversation-content] pre code {
  color: #0F1B29 !important;
}

/* ── TYPOGRAPHY METRICS ──────────────────────────────────────────────────
   Now that the stack is Montserrat + Noto Sans SC, the old metrics can be
   tightened. The previous values were chosen defensively for Segoe UI/YaHei
   (where 500 was the lightest weight that survived the halo, and 0.01em
   tracking compensated for YaHei's loose default fit).

   With real weights available the rules change:
     · Noto Sans SC has a TRUE 100–900 axis, so 450 body / 620 bold are real
       instances, not synthesised. Synthesised bold on YaHei was a large part
       of why text looked "丑" — it smears the strokes and thickens the
       already-cramped counters.
     · Montserrat is geometric with an even, generous fit, so CJK tracking
       must be re-tuned: Chinese glyphs want a touch MORE tracking than the
       old 0.01em to stop dense paragraphs reading as a grey block, while
       Latin wants slightly less so it does not drift apart.
     · Line-height gets a slight increase because Noto has a taller x-height
       and deeper descenders than YaHei; 1.75 starts to collide at 15px. */
[data-conversation-content] {
  font-size: 15px !important;
  line-height: 1.82 !important;
  /* Tracking is Latin-tuned; the CJK block below adds its own increment. */
  letter-spacing: 0.006em !important;
  font-weight: 450 !important;
}
[data-conversation-content] p,
[data-conversation-content] li {
  line-height: 1.82 !important;
  font-weight: 450 !important;
}
/* Chinese runs want more air than the 0.006em Latin value. Applied via the
   lang attribute when the app sets it, which is the reliable signal. */
[data-conversation-content]:lang(zh),
[data-conversation-content] :lang(zh) {
  letter-spacing: 0.022em !important;
}
[data-conversation-content] strong,
[data-conversation-content] b {
  font-weight: 620 !important;
}
/* Headings: heavier and tighter, so the hierarchy reads as designed. */
[data-conversation-content] h1, [data-conversation-content] h2,
[data-conversation-content] h3, [data-conversation-content] h4,
[data-conversation-content] h5, [data-conversation-content] h6 {
  letter-spacing: -0.004em !important;
  line-height: 1.38 !important;
  font-weight: 640 !important;
}
[data-conversation-content] h1 { font-size: 25px !important; font-weight: 660 !important; }
[data-conversation-content] h2 { font-size: 21px !important; }
[data-conversation-content] h3 { font-size: 18px !important; }
[data-conversation-content] h4 { font-size: 16px !important; }
/* Numerals: Montserrat's tabular figures keep tables and stats from shifting
   as digits change width. */
[data-conversation-content] table,
[data-conversation-content] td,
[data-conversation-content] th {
  font-variant-numeric: tabular-nums !important;
}
/* Inline code and code blocks: render on the mono stack at a size that
   optically matches the 450-weight body copy. */
[data-conversation-content] code,
[data-conversation-content] pre,
[data-conversation-content] kbd {
  font-size: 13.5px !important;
  letter-spacing: 0 !important;
}
/* UI chrome (sidebar labels, menu items, buttons) sits at a slightly
   tighter tracking and a real medium weight. */
[class*="sidebar" i], [data-dsh-sidebar],
[role="menu"], [role="listbox"], [role="tooltip"] {
  letter-spacing: 0.012em !important;
}

/* Aurora-cyan focus accents */
*:focus-visible {
  outline-color: var(--dsw-focus-ring-color, #5AD6FF) !important;
}

/* Frosted scrollbars (WebKit/Electron + Firefox fallback) */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-scrollbar-bg-l2, rgba(90,214,255,0.42)) rgba(6,14,28,0.30);
}
*::-webkit-scrollbar { width: 10px !important; height: 10px !important; }
*::-webkit-scrollbar-track { background: rgba(6,14,28,0.28) !important; border-radius: 5px !important; }
*::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-scrollbar-bg-l2, rgba(90,214,255,0.40)) !important;
  border: 2px solid rgba(6,14,28,0.45) !important;
  border-radius: 5px !important;
  background-clip: padding-box !important;
}
*::-webkit-scrollbar-thumb:hover {
  background: var(--dsw-alias-scrollbar-hover-l2, rgba(90,214,255,0.62)) !important;
}
*::-webkit-scrollbar-corner { background: transparent !important; }
html[data-xingkong-mode="light"] *::-webkit-scrollbar-track { background: rgba(120,150,190,0.20) !important; }
html[data-xingkong-mode="light"] *::-webkit-scrollbar-thumb { border-color: rgba(255,255,255,0.75) !important; }
`;
      document.head.append(styleEl);
      ctx.effect(() => () => styleEl.remove());

      // ── The bottom fade: TWO numbers on the MESSAGE COLUMN ───────────────
      // No nodes. No overlays. No blur. The entire treatment is a mask on the
      // message column (see `[data-slot="conversation.session"] > *` above),
      // and all JavaScript does is tell that mask where the composer's top edge
      // is and how deep the dissolve should be.
      //
      // Three separate failures are recorded in the CSS comment above; the
      // lesson that matters here is that the mask must live on an element with
      // a REAL BOX. The slot is display:contents, so masking it painted a
      // valid-looking gradient into a 0x0 area and faded exactly nothing.
      //
      // --dshx-fade-h = the composer's top edge, in the column's own pixel
      //                 space (the space the mask gradient resolves in).
      // --dshx-fade-a = where the dissolve begins, always ABOVE fade-h.
      //
      // Both are viewport rects subtracted from each other, so the result is
      // exact regardless of how far the content has been scrolled. There is no
      // percentage anywhere: percentages would resolve against the COLUMN's
      // height (the whole conversation), which was the original v1 bug.
      const seatEl = () => document.querySelector('[data-composer-seat]');
      const msgEl = () => {
        const slot = document.querySelector('[data-slot="conversation.session"]');
        return slot ? slot.firstElementChild : null;
      };
      const RAMP = 150;      // deepest the dissolve may get, in px
      const MIN_DEPTH = 2;   // shallower than this = park the mask (nothing hidden)
      // Read the CURRENT inline values instead of remembering what we last
      // wrote. Remembering is cheaper on paper but it LATCHES: the moment
      // anything else touches these two properties the theme stops correcting
      // them and the fade stays stuck at a stale offset. Reading an inline
      // style string costs no layout, so this dedupes and self-heals for free.
      const writeStops = (el, a, h) => {
        if (!el || !el.style) return;
        if (el.style.getPropertyValue('--dshx-fade-a') === a &&
            el.style.getPropertyValue('--dshx-fade-h') === h) return;
        el.style.setProperty('--dshx-fade-a', a);
        el.style.setProperty('--dshx-fade-h', h);
      };
      const syncMelt = () => {
        const msg = msgEl();
        // Nothing to fade against: park the stops far below any content so the
        // mask is effectively off (hero view, or a transcript scrolled all the
        // way down, where nothing is hidden behind the composer).
        const park = () => writeStops(msg, '99999px', '99999px');
        try {
          if (!msg || !msg.style) return;
          const seat = seatEl();
          const scroller = document.querySelector('.Dc7zOa_scrollBody');
          // Nothing to fade against: park the stops far below any content so
          // the mask is effectively off (hero / empty conversation state).
          if (!scroller || !seat) { park(); return; }

          const mb = msg.getBoundingClientRect();
          const seatTop = seat.getBoundingClientRect().top;

          const end = Math.round(seatTop - mb.top);

          // HOW MUCH OF THE TRANSCRIPT IS ACTUALLY HIDDEN BEHIND THE COMPOSER.
          //
          // This is the number that makes the fade safe. At the bottom of the
          // scroll the column ENDS exactly on the composer's top edge: nothing
          // is covered, so nothing should fade — and a fixed 150px ramp
          // anchored to the composer would otherwise eat the final 150px of
          // text, i.e. the newest message the user is reading, and render it
          // half-transparent. Measured: the last line of text sits 18px above
          // the column's bottom, so ANY fixed-depth ramp swallows it.
          //
          // Tying the depth to `hidden` also makes the dissolve grow naturally
          // as you scroll up: 0px at the bottom, full RAMP once 150px of
          // content has slid under the composer.
          const hidden = mb.bottom - seatTop;
          const depth = Math.min(RAMP, Math.max(0, hidden));

          if (!isFinite(end) || end <= 0 || depth < MIN_DEPTH) { park(); return; }
          const begin = Math.max(0, Math.round(end - depth));
          writeStops(msg, begin + 'px', end + 'px');
        } catch { /* ignore */ }
      };
      // ── WHEN IT RE-MEASURES ───────────────────────────────────────────────
      // The stops are in the COLUMN's pixel space, and the column scrolls — so
      // they must be rewritten on every scroll or the ramp stays behind while
      // the text moves through it. (That failure mode is exactly what the user
      // described as "这个白罩…会跟着移动".)
      //
      // ⚠️ The scroll listener is on WINDOW, IN THE CAPTURE PHASE, and that is
      // deliberate. A direct listener on .Dc7zOa_scrollBody dies silently the
      // moment the app re-creates that node (a resize, a session switch, a
      // re-render). Verified against the live app: after a maximize the stops
      // were frozen at the parked value while `hidden` had grown to 200px. The
      // capture phase is the only way to observe scroll from an element that is
      // not yet / no longer the one we queried — scroll does not bubble, but it
      // does propagate through capture.
      let rafId = 0;
      const scheduleMelt = () => {
        // Coalesce: streaming fires the observer dozens of times a second and
        // each pass costs two getBoundingClientRect. rAF still runs BEFORE the
        // frame is painted, so the ramp stays in step with the scroll.
        if (rafId) return;
        try {
          rafId = requestAnimationFrame(() => { rafId = 0; syncMelt(); });
        } catch { rafId = 0; }
      };
      const listen = (el, type, fn, opts) => {
        try { el.addEventListener(type, fn, opts || { passive: true }); } catch { /* ignore */ }
      };
      listen(window, 'resize', scheduleMelt);
      listen(window, 'scroll', scheduleMelt, { passive: true, capture: true });
      let observer = null;
      try {
        syncMelt();
        // The seat's height changes as the composer grows (multi-line input,
        // attachments), and the conversation remounts on session switch, so
        // re-measure cheaply from the observer rather than trusting one read.
        observer = new MutationObserver(() => {
          // Fires for the whole document subtree, so it must be cheap and must
          // never throw: a throw here surfaces as an uncaught error on every
          // DOM change in the app. That is why this schedules instead of
          // measuring inline.
          scheduleMelt();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        // A few settling re-reads: the conversation flips data-phase
        // hero -> active shortly after mount and the card lands then.
        for (const ms of [120, 400, 1200, 2600]) setTimeout(syncMelt, ms);
      } catch {
        /* the fade is cosmetic; never let it break the theme */
      }
      ctx.effect(() => () => {
        try { observer?.disconnect(); } catch { /* ignore */ }
        try { if (rafId) cancelAnimationFrame(rafId); } catch { /* ignore */ }
        try {
          window.removeEventListener('scroll', scheduleMelt, { capture: true });
          window.removeEventListener('resize', scheduleMelt);
        } catch { /* ignore */ }
        try {
          const msg = msgEl();
          if (msg && msg.style) {
            msg.style.removeProperty('--dshx-fade-h');
            msg.style.removeProperty('--dshx-fade-a');
          }
        } catch { /* ignore */ }
      });

      // ── model probe panel (v1.11.0) ────────────────────────────────────────
      // A third-party extension living inside the OFFICIAL Models settings page.
      // The official page declares two extension seats for out-of-tree plugins
      // (settings.models.provider-card / settings.models.footer) precisely so a
      // plugin can render inside each provider card without touching official
      // code. We register one keyed entry for the pi-ai namespace ("llm-pi-ai"),
      // so every hand-declared provider card (the user's 自定义模型 API entries)
      // gets our probe panel.
      //
      // What the panel adds, none of which the official page offers:
      //   · liveness  — a max_tokens:1 request tells 可用 / 未开通 / 额度耗尽 apart
      //   · context   — the vendor catalog (/api/v1/models) answers context_window
      //                 and max_output_tokens for every model in one request
      //   · thinking  — the official README says reasoning levels are deliberately
      //                 not editable; we probe each level live and display the set
      // Probes run in the host half (no CORS on model endpoints, key never reaches
      // the renderer). This half is pure UI + polling.
      //
      // Hard rule: EVERYTHING here is optional and defended. If React, the slots
      // service, the settings service, or the HTTP channel is missing, we log a
      // warning and the theme itself keeps working exactly as before.
      const installModelProbePanel = (rootCtx) => {
        const XKMP_API = '/xingkong-model';
        const React = require('react');
        if (!React || typeof React.createElement !== 'function' || typeof React.useState !== 'function') {
          console.warn('[xingkong-theme] model probe: React instance unusable, panel skipped');
          return;
        }
        const h = React.createElement;

        const xkmpStyles = [
          '.xkmp-root{margin-top:10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:10px;background:var(--dsw-alias-bg-overlay,#ffffff);overflow:hidden;font-size:12px;line-height:1.5}',
          '.xkmp-head{display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;background:transparent;border:0;cursor:pointer;color:var(--dsw-alias-label-primary,inherit);font:inherit;text-align:left}',
          '.xkmp-head:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08))}',
          '.xkmp-title{font-weight:600}',
          '.xkmp-badge{padding:1px 8px;border-radius:999px;background:var(--dsw-alias-button-elevated-fill,rgba(127,127,127,.14));color:var(--dsw-alias-label-secondary,inherit);font-size:11px}',
          '.xkmp-chev{margin-left:auto;opacity:.6;font-size:11px}',
          '.xkmp-body{padding:0 12px 12px;display:flex;flex-direction:column;gap:8px}',
          '.xkmp-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
          '.xkmp-btn{padding:3px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));background:var(--dsw-alias-button-elevated-fill,rgba(127,127,127,.10));color:var(--dsw-alias-label-primary,inherit);cursor:pointer;font:inherit;font-size:12px}',
          '.xkmp-btn:hover{background:var(--dsw-alias-button-floating-hover,rgba(127,127,127,.18))}',
          '.xkmp-btn:disabled{opacity:.45;cursor:default}',
          '.xkmp-btn-danger{color:var(--dsw-alias-state-error-primary,#c0392b);border-color:var(--dsw-alias-state-error-primary,#c0392b)}',
          '.xkmp-meta{color:var(--dsw-alias-label-caption,inherit);font-size:11px}',
          '.xkmp-warn{color:var(--dsw-alias-state-warn-primary,#b7791f);font-size:11px}',
          '.xkmp-err{color:var(--dsw-alias-state-error-primary,#c0392b);font-size:11px}',
          '.xkmp-progress{height:4px;border-radius:2px;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16));overflow:hidden}',
          '.xkmp-progress>i{display:block;height:100%;background:var(--dsw-alias-brand-primary,#3b82f6);transition:width .3s}',
          '.xkmp-sum{display:flex;gap:12px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary,inherit);font-size:11px}',
          '.xkmp-sum b{font-weight:600;color:var(--dsw-alias-label-primary,inherit)}',
          '.xkmp-filter{display:flex;gap:6px}',
          '.xkmp-tab{padding:1px 10px;border-radius:999px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-caption,inherit);cursor:pointer;font:inherit;font-size:11px}',
          '.xkmp-tab-on{border-color:var(--dsw-alias-border-l3,rgba(127,127,127,.4));background:var(--dsw-alias-button-elevated-fill,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,inherit)}',
          '.xkmp-list{max-height:290px;overflow:auto;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));border-radius:8px}',
          '.xkmp-row{display:grid;grid-template-columns:14px minmax(110px,1.5fr) 62px 62px 104px minmax(60px,1fr);gap:8px;align-items:center;padding:4px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.1))}',
          '.xkmp-row:last-child{border-bottom:0}',
          '.xkmp-dot{width:8px;height:8px;border-radius:50%;background:#9aa4ad}',
          '.xkmp-dot-ok{background:#2fbf71}',
          '.xkmp-dot-off{background:#9aa4ad}',
          '.xkmp-dot-quota{background:#e0a800}',
          '.xkmp-dot-bad{background:#d9534f}',
          '.xkmp-id{font-family:var(--dsw-font-markdown-code-font-family,ui-monospace,Consolas,monospace);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.xkmp-cell{white-space:nowrap;color:var(--dsw-alias-label-secondary,inherit);font-size:11px}',
          '.xkmp-msg{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-caption,inherit);font-size:11px}',
        ].join('\n');
        let stylesInstalled = false;
        const installStyles = () => {
          if (stylesInstalled) return;
          stylesInstalled = true;
          try {
            if (document.getElementById('xkmp-styles')) return;
            const el = document.createElement('style');
            el.id = 'xkmp-styles';
            el.textContent = xkmpStyles;
            (document.head || document.documentElement).appendChild(el);
          } catch { /* style is cosmetic */ }
        };

        const fmtNum = (n) => {
          if (typeof n !== 'number' || !isFinite(n) || n <= 0) return '—';
          if (n >= 1000000) {
            const m = n / 1000000;
            return (m >= 10 ? Math.round(m) : Math.round(m * 10) / 10) + 'M';
          }
          if (n >= 1000) return Math.round(n / 1000) + 'K';
          return String(n);
        };
        const fmtEfforts = (r) => {
          if (r.efforts === undefined || r.efforts === null) return r.error ? '未知' : '—';
          if (r.efforts === false) return '不思考';
          const keys = Object.keys(r.efforts);
          return keys.length === 0 ? '不思考' : keys.join('·');
        };
        const dotClassOf = (r) => {
          if (r.alive === true) return 'xkmp-dot xkmp-dot-ok';
          if (r.kind === 'not-activated') return 'xkmp-dot xkmp-dot-off';
          if (r.kind === 'quota') return 'xkmp-dot xkmp-dot-quota';
          if (r.kind === 'error' || r.kind === 'rejected' || r.kind === 'non-chat') return 'xkmp-dot xkmp-dot-bad';
          return 'xkmp-dot';
        };
        const shortMsg = (r) => {
          if (r.kind === 'ok') return '';
          if (r.message) return String(r.message).replace(/\s+/g, ' ').slice(0, 160);
          if (r.error) return String(r.error).slice(0, 160);
          return '';
        };

        // ── why the panel writes settings at all ──────────────────────────────
        // A hand-declared route is invisible to pi-ai's catalog, so
        // resolveModelReasoning() resolves it to reasoning:false and the
        // composer's model picker offers that model NO thinking level, while an
        // official or catalog-backed route keeps its levels. Declaring
        // "reasoningEfforts" on the model entry is the only supported way to
        // change that, and the official editor deliberately hides the field.
        //
        // v1.12.0 — the levels are read straight off the endpoint: one request
        // with a deliberately invalid effort makes the endpoint enumerate every
        // level it accepts (measured: 400 "must be one of: 'none', 'minimal',
        // 'low', 'medium', 'high', 'xhigh', 'max'"). So there is nothing to
        // pick and nothing to confirm: the probe answers it, and the panel
        // writes the answer back. No presets, no per-row ticks, no typing ids.

        const Panel = (ownerProps) => {
          const provider = (ownerProps && ownerProps.provider) || {};
          const providerId = typeof provider.provider === 'string' ? provider.provider : '';
          const svc = ownerProps && ownerProps.svc;
          const writer = ownerProps && ownerProps.writer;

          const [open, setOpen] = React.useState(false);
          const [profile, setProfile] = React.useState(null);
          const [profileError, setProfileError] = React.useState(null);
          const [backend, setBackend] = React.useState(null);
          const [job, setJob] = React.useState(null);
          const [busy, setBusy] = React.useState(false);
          const [notice, setNotice] = React.useState(null);
          const [filter, setFilter] = React.useState('all');
          // Config-writing surface (v1.11.1). cfgMeta carries the USER-layer
          // model array (settings mutate addresses the stored/user section),
          // the optimistic-lock revision, and writability — all read from the
          // same settings mirror the profile itself comes from.
          const [cfgMeta, setCfgMeta] = React.useState(null);
          const [confirmClean, setConfirmClean] = React.useState(false);
          // v1.12.0 — auto-apply. The user asked for the reasoning levels to
          // simply appear, not for a second form to fill in. This remembers the
          // job we already wrote back so re-renders (and a poll tick landing
          // late) cannot write twice.
          const autoAppliedRef = React.useRef('');

          const loadProfile = React.useCallback(async () => {
            try {
              const mirror = svc && typeof svc.describe === 'function' ? svc.describe() : null;
              if (!mirror) {
                setProfileError('设置服务不可用（configForms 未就绪）');
                return;
              }
              if (typeof mirror.ensure === 'function') await mirror.ensure();
              const snap = typeof mirror.getSnapshot === 'function' ? mirror.getSnapshot() : null;
              const namespaces = (snap && snap.view && Array.isArray(snap.view.namespaces)) ? snap.view.namespaces : [];
              const ns = namespaces.find((v) => v && v.ns === 'llm-pi-ai');
              const prof = ns && ns.value && ns.value.providers ? ns.value.providers[providerId] : undefined;
              if (!prof) {
                setProfile(null);
                setCfgMeta(null);
                setProfileError('在 llm-pi-ai 配置里找不到提供商 ' + (providerId || '?'));
                return;
              }
              setProfile(prof);
              // The write surface reads the USER layer: settings mutate
              // addresses the stored section, while value/base are merged
              // views that must never become the target of a write.
              const userProf = ns && ns.user && ns.user.providers ? ns.user.providers[providerId] : undefined;
              setCfgMeta({
                revision: ns && typeof ns.revision === 'number' ? ns.revision : undefined,
                writable: !!(snap && snap.view && snap.view.writable === true),
                userModels: userProf && Array.isArray(userProf.models) ? userProf.models : null,
              });
              setProfileError(null);
            } catch (e) {
              setProfile(null);
              setProfileError('读取配置失败：' + String((e && e.message) || e));
            }
          }, [providerId, svc]);

          React.useEffect(() => {
            if (!open) return undefined;
            installStyles();
            let alive = true;
            (async () => {
              try {
                const res = await fetch(XKMP_API + '/ping');
                const data = await res.json();
                if (alive) setBackend(data);
              } catch (e) {
                if (alive) setBackend({ ok: false, error: String((e && e.message) || e) });
              }
              if (alive) await loadProfile();
            })();
            return () => { alive = false; };
          }, [open, loadProfile]);

          React.useEffect(() => {
            if (!job || job.state !== 'running' || !job.jobId) return undefined;
            const timer = setTimeout(async () => {
              try {
                const res = await fetch(XKMP_API + '/probe/status?id=' + encodeURIComponent(job.jobId));
                const data = await res.json();
                setJob((prev) => (prev ? Object.assign({}, data, { jobId: prev.jobId }) : prev));
              } catch { /* keep polling; the job lives in the host */ }
            }, 1000);
            return () => clearTimeout(timer);
          }, [job]);

          const models = profile && Array.isArray(profile.models) ? profile.models : [];
          const modelIds = models.map((m) => (m && typeof m.id === 'string' ? m.id : '')).filter(Boolean);
          const hasEndpoint = !!(profile && typeof profile.baseURL === 'string' && profile.baseURL.length > 0);

          const startProbe = async (mode) => {
            if (!profile || busy) return;
            if (!hasEndpoint) { setNotice('该提供商未配置 baseURL，无法探测'); return; }
            if (modelIds.length === 0) { setNotice('该提供商还没有配置任何模型'); return; }
            setBusy(true);
            setNotice(null);
            try {
              const res = await fetch(XKMP_API + '/probe/start', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  provider: providerId,
                  baseURL: profile.baseURL,
                  api: profile.api,
                  apiKeyEnv: profile.apiKeyEnv,
                  models: modelIds,
                  mode,
                }),
              });
              const data = await res.json();
              if (!data || data.ok !== true) {
                setNotice((data && data.error) || '启动失败');
                return;
              }
              const snap = await (await fetch(XKMP_API + '/probe/status?id=' + encodeURIComponent(data.jobId))).json();
              setJob(Object.assign({}, snap, { jobId: data.jobId }));
            } catch (e) {
              setNotice(String((e && e.message) || e));
            } finally {
              setBusy(false);
            }
          };
          const cancelProbe = async () => {
            if (!job || !job.jobId) return;
            try {
              await fetch(XKMP_API + '/probe/cancel', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ id: job.jobId }),
              });
            } catch { /* the host stops on its own timeout anyway */ }
          };

          const results = job && Array.isArray(job.results) ? job.results : [];
          const groups = { ok: 0, off: 0, quota: 0, bad: 0, idle: 0 };
          for (const r of results) {
            if (r.alive === true) groups.ok += 1;
            else if (r.kind === 'not-activated') groups.off += 1;
            else if (r.kind === 'quota') groups.quota += 1;
            else if (r.alive === false) groups.bad += 1;
            else groups.idle += 1;
          }
          const running = !!(job && job.state === 'running');
          const pct = job && job.total > 0 ? Math.round((job.finished / job.total) * 100) : 0;
          const visible = results.filter((r) => {
            if (filter === 'ok') return r.alive === true;
            if (filter === 'bad') return r.alive === false;
            return true;
          }).slice(0, 400);
          // ── config-writing actions (v1.11.1) ─────────────────────────────
          // Both write through the official settings seam as ONE by-value set
          // of the provider's models array — exactly what the official editor
          // does for model-list edits, and it sidesteps index-shift hazards a
          // series of per-index ops would have to manage.
          const deadResults = results.filter((r) => r.alive === false);
          const canWrite = !!(cfgMeta && cfgMeta.userModels && cfgMeta.writable === true);
          const reloadProfile = async () => {
            const mirror = svc && typeof svc.describe === 'function' ? svc.describe() : null;
            if (mirror && typeof mirror.load === 'function') {
              try { await mirror.load(); } catch { /* a stale view is gracefully replaced on the next load */ }
            }
            await loadProfile();
          };
          const writeUserModels = async (nextModels) => {
            const w = typeof writer === 'function' ? writer() : null;
            if (!w || typeof w.mutate !== 'function') {
              const tried = resolveWriter.lastAttempts ? resolveWriter.lastAttempts.join(' | ') : '';
              return '写入服务不可用（remote.settings 未就绪' + (tried ? '：' + tried : '') + '）';
            }
            try {
              const res = await w.mutate(
                'llm-pi-ai',
                [{ op: 'set', path: ['providers', providerId, 'models'], value: nextModels }],
                cfgMeta ? cfgMeta.revision : undefined,
              );
              if (res && res.ok === true) return null;
              const err = res && res.error;
              if (err && err.code === 'settings/conflict') return '配置刚被其他改动更新，已刷新，请重试';
              return (err && err.message) || '写入被拒绝';
            } catch (e) {
              return String((e && e.message) || e);
            }
          };
          /**
           * 把这次检验的结论写回模型配置 —— 上下文窗口、输出上限、推理档位。
           *
           * v1.12.0: no mode, no scope, no options. Every live model gets its
           * measured capabilities; every field the user already filled in is
           * left alone (same rule the official discover picker uses). The
           * reasoning levels come from the endpoint itself, so there is nothing
           * to pick — that is the whole point of the endpoint-level probe.
           */
          const applyCapabilities = async () => {
            if (!canWrite) {
              setNotice(cfgMeta && !cfgMeta.userModels
                ? '该提供商的模型清单不由本页管理（用户层没有 models），无法写入'
                : '配置为只读或读取中，无法写入');
              return null;
            }
            const byId = new Map(results.map((r) => [r.id, r]));
            let touched = 0;
            let fields = 0;
            let effortsWritten = 0;
            const next = cfgMeta.userModels.map((m) => {
              const id = m && typeof m.id === 'string' ? m.id : '';
              const r = byId.get(id);
              // Only models the probe confirmed alive — declaring capabilities
              // for a model the endpoint refuses would advertise levels that
              // can only fail when the user picks them.
              if (!r || r.alive !== true) return m;
              const out = Object.assign({}, m);
              let changed = false;
              if (out.contextWindow === undefined && typeof r.contextWindow === 'number' && r.contextWindow > 0) { out.contextWindow = r.contextWindow; changed = true; fields += 1; }
              if (out.maxTokens === undefined && typeof r.maxTokens === 'number' && r.maxTokens > 0) { out.maxTokens = r.maxTokens; changed = true; fields += 1; }
              if (out.reasoningEfforts === undefined) {
                if (r.efforts && typeof r.efforts === 'object' && !Array.isArray(r.efforts) && Object.keys(r.efforts).length > 0) {
                  out.reasoningEfforts = r.efforts;
                  changed = true; fields += 1; effortsWritten += 1;
                } else if (r.efforts === false) {
                  // The endpoint answered "these models do not think". Saying so
                  // explicitly is better than leaving the model looking like a
                  // catalog route whose levels simply were not checked.
                  out.reasoningEfforts = false;
                  changed = true; fields += 1;
                }
              }
              if (changed) touched += 1;
              return out;
            });
            if (touched === 0) {
              if (results.length === 0) setNotice('先跑一次检验');
              return null;
            }
            const err = await writeUserModels(next);
            if (err) { setNotice('写入失败：' + err); return null; }
            let msg = '已为 ' + touched + ' 个可用模型写入 ' + fields + ' 项能力值';
            if (effortsWritten > 0) msg += '（含 ' + effortsWritten + ' 个模型的推理档位）';
            setNotice(msg + '。现在到对话里选这些模型，推理等级即可选。');
            await reloadProfile();
            return touched;
          };
          const cleanUnusable = async () => {
            setConfirmClean(false);
            if (!canWrite) { setNotice('该提供商的模型清单不由本页管理，无法清理'); return; }
            if (deadResults.length === 0) { setNotice('没有不可用的模型可清理'); return; }
            const dead = new Set(deadResults.map((r) => r.id));
            const next = cfgMeta.userModels.filter((m) => !(m && typeof m.id === 'string' && dead.has(m.id)));
            if (next.length === 0) {
              setNotice('清理后将不剩任何模型，已取消：models 为空会让该提供商解析不到模型');
              return;
            }
            setBusy(true);
            setNotice(null);
            const err = await writeUserModels(next);
            setBusy(false);
            if (err) { setNotice('清理失败：' + err); return; }
            setNotice('已移除 ' + (cfgMeta.userModels.length - next.length) + ' 个不可用模型，剩余 ' + next.length + ' 个');
            await reloadProfile();
          };

          // The one gesture the user makes: press the probe button. Everything
          // downstream — reading the levels off the endpoint and writing them
          // into the model entries so the composer can offer them — happens here
          // without a second click.
          React.useEffect(() => {
            if (!job || job.state !== 'done' || !canWrite || !cfgMeta || !cfgMeta.userModels) return;
            const stamp = job.jobId || ('done@' + job.finished + '/' + job.total);
            if (autoAppliedRef.current === stamp) return;
            autoAppliedRef.current = stamp;
            (async () => {
              setBusy(true);
              await applyCapabilities();
              setBusy(false);
            })();
          }, [job, canWrite, cfgMeta]);

          const children = [];
          children.push(h('button', {
            key: 'head',
            type: 'button',
            className: 'xkmp-head',
            onClick: () => setOpen(!open),
          }, [
            h('span', { key: 't', className: 'xkmp-title' }, '模型检验'),
            h('span', { key: 'b', className: 'xkmp-badge' }, modelIds.length > 0 ? modelIds.length + ' 个模型' : '读取中…'),
            running ? h('span', { key: 's', className: 'xkmp-meta' }, '检验中 ' + job.finished + '/' + job.total) : null,
            h('span', { key: 'c', className: 'xkmp-chev' }, open ? '▾' : '▸'),
          ]));

          if (open) {
            const actionBar = h('div', { key: 'acts', className: 'xkmp-actions' }, [
              h('button', {
                key: 'fast', type: 'button', className: 'xkmp-btn',
                disabled: busy || running || !hasEndpoint || modelIds.length === 0,
                title: '每个模型发一次最小请求确认可用性，并从端点读出推理档位；完成后自动写入配置，对话里即可选择推理等级',
                onClick: () => startProbe('alive'),
              }, running ? '检验中…' : (job && job.state === 'done' ? '重新检验' : '开始检验')),
              h('button', {
                key: 'full', type: 'button', className: 'xkmp-btn',
                disabled: busy || running || !hasEndpoint || modelIds.length === 0,
                title: '存活检测 + 输出上限 + 逐档探测推理等级（每个存活模型最多 9 次小请求）',
                onClick: () => startProbe('full'),
              }, '逐档复核'),
              running ? h('button', { key: 'stop', type: 'button', className: 'xkmp-btn xkmp-btn-danger', onClick: cancelProbe }, '停止') : null,
              h('button', { key: 're', type: 'button', className: 'xkmp-btn', disabled: busy || running, onClick: loadProfile }, '刷新配置'),
              confirmClean
                ? h('span', { key: 'cc', className: 'xkmp-actions' }, [
                    h('span', { key: 'q', className: 'xkmp-warn' }, '移除 ' + deadResults.length + ' 个不可用模型？（未开通 ' + groups.off + ' / 额度不足 ' + groups.quota + ' / 其它 ' + groups.bad + '）'),
                    h('button', { key: 'y', type: 'button', className: 'xkmp-btn xkmp-btn-danger', disabled: busy, onClick: cleanUnusable }, '确认移除'),
                    h('button', { key: 'n', type: 'button', className: 'xkmp-btn', disabled: busy, onClick: () => setConfirmClean(false) }, '取消'),
                  ])
                : h('button', {
                    key: 'clean', type: 'button', className: 'xkmp-btn',
                    disabled: busy || running || deadResults.length === 0 || !canWrite,
                    title: '从该提供商的配置里移除所有检验为不可用（未开通 / 额度不足 / 其它异常）的模型；未开通与额度不足可能是暂时状态',
                    onClick: () => {
                      if (!canWrite) { setNotice('该提供商的模型清单不由本页管理，无法清理'); return; }
                      if (deadResults.length === 0) { setNotice(results.length === 0 ? '先跑一次检验，再清理' : '本次检验没有不可用的模型'); return; }
                      setConfirmClean(true);
                    },
                  }, deadResults.length > 0 ? '清理不可用（' + deadResults.length + '）' : '清理不可用'),
              backend && backend.ok === true ? h('span', { key: 'bk', className: 'xkmp-meta' }, '后端 v' + backend.version) : null,
              backend && backend.ok !== true ? h('span', { key: 'be', className: 'xkmp-err' }, '后端不可达：' + String((backend.error || '').slice(0, 80))) : null,
            ]);

            const infoLines = [];
            if (profileError) infoLines.push(h('div', { key: 'pe', className: 'xkmp-err' }, profileError));
            if (notice) infoLines.push(h('div', { key: 'no', className: 'xkmp-err' }, notice));
            if (job && job.error) infoLines.push(h('div', { key: 'je', className: 'xkmp-err' }, '探测错误：' + job.error));
            if (job && job.catalog && job.catalog.loaded) infoLines.push(h('div', { key: 'cat', className: 'xkmp-meta' }, '厂商目录已命中：' + job.catalog.count + ' 个模型（上下文窗口与输出上限为厂商声明值）'));
            if (job && job.catalog && !job.catalog.loaded) infoLines.push(h('div', { key: 'cat2', className: 'xkmp-meta' }, '该端点没有可读的厂商目录，输出上限改用现场探测'));
            if (job && job.state === 'done') infoLines.push(h('div', { key: 'auto', className: 'xkmp-meta' }, '上下文窗口、输出上限与推理档位已自动写入配置 —— 现在到对话里选这些模型即可设置推理等级'));

            const progress = job ? h('div', { key: 'pg', className: 'xkmp-progress' }, [
              h('i', { key: 'f', style: { width: pct + '%' } }),
            ]) : null;

            const summary = job ? h('div', { key: 'sum', className: 'xkmp-sum' }, [
              h('span', { key: 'a' }, ['完成 ', h('b', { key: '1' }, job.finished + '/' + job.total)]),
              h('span', { key: 'b' }, ['可用 ', h('b', { key: '2' }, String(groups.ok))]),
              h('span', { key: 'c' }, ['未开通 ', h('b', { key: '3' }, String(groups.off))]),
              h('span', { key: 'd' }, ['额度不足 ', h('b', { key: '4' }, String(groups.quota))]),
              h('span', { key: 'e' }, ['其它异常 ', h('b', { key: '5' }, String(groups.bad))]),
              groups.idle > 0 ? h('span', { key: 'f' }, ['待检 ', h('b', { key: '6' }, String(groups.idle))]) : null,
            ]) : null;

            const filterBar = results.length > 0 ? h('div', { key: 'fb', className: 'xkmp-filter' }, [
              h('button', { key: 'all', type: 'button', className: 'xkmp-tab' + (filter === 'all' ? ' xkmp-tab-on' : ''), onClick: () => setFilter('all') }, '全部'),
              h('button', { key: 'ok', type: 'button', className: 'xkmp-tab' + (filter === 'ok' ? ' xkmp-tab-on' : ''), onClick: () => setFilter('ok') }, '仅可用'),
              h('button', { key: 'bad', type: 'button', className: 'xkmp-tab' + (filter === 'bad' ? ' xkmp-tab-on' : ''), onClick: () => setFilter('bad') }, '仅异常'),
            ]) : null;

            const rows = visible.map((r) => h('div', {
              key: r.id,
              className: 'xkmp-row',
            }, [
              h('span', { key: 'd', className: dotClassOf(r), title: r.kind || '' }),
              h('span', { key: 'i', className: 'xkmp-id', title: r.id }, r.id),
              h('span', { key: 'c1', className: 'xkmp-cell', title: '上下文窗口' }, fmtNum(r.contextWindow)),
              h('span', { key: 'c2', className: 'xkmp-cell', title: '最大输出' }, fmtNum(r.maxTokens)),
              h('span', { key: 'c3', className: 'xkmp-cell', title: '可用推理档位' }, fmtEfforts(r)),
              h('span', { key: 'm', className: 'xkmp-msg', title: shortMsg(r) }, shortMsg(r)),
            ]));
            const list = results.length > 0 ? h('div', { key: 'list', className: 'xkmp-list' }, rows) : null;

            children.push(h('div', { key: 'body', className: 'xkmp-body' }, [
              actionBar,
              ...infoLines,
              progress,
              summary,
              filterBar,
              list,
            ]));
          }

          return h('div', { className: 'xkmp-root' }, children);
        };

        // Service wiring: both are OPTIONAL. ctx.inject() runs its callback only
        // once every named service is available, so a profile without the
        // official settings UI simply never mounts the panel — the theme is
        // untouched. The slot itself is injected by ui-settings-models; if that
        // page is absent, registrations never fire either.
        //
        // v1.11.3 — the settings WRITER. MEASURED FAILURE this replaces: with a
        // nested slotsCtx.inject(['remote.settings'], ...) the callback NEVER
        // fired, so every write came back "写入服务不可用（remote.settings 未就绪）".
        // Cause: "remote.*" is a Service-chain, not a flat service name — the
        // official plugins reach it by declaring it in the plugin's TOP-LEVEL
        // inject array and then reading ctx.remote.settings as a property.
        // A nested ctx.inject() asks the already-injected child context for a
        // name that only resolves on the root fiber, so it waits forever.
        // Since the theme's top-level inject must stay ['theme'] (a missing
        // dependency there would stop the whole theme from loading), we take
        // the property route and resolve it LAZILY at click time, trying every
        // shape the service can legitimately take.
        let settingsSvc = null;
        const resolveWriter = (baseCtx) => {
          const attempts = [];
          const tryOne = (label, fn) => {
            try {
              const value = fn();
              if (value && typeof value.mutate === 'function') return value;
              attempts.push(label + ' -> ' + (value === undefined ? 'undefined' : typeof value));
            } catch (error) {
              attempts.push(label + ' threw ' + ((error && error.message) || error));
            }
            return null;
          };
          const found = tryOne('ctx.remote.settings', () => baseCtx.remote && baseCtx.remote.settings)
            || tryOne('ctx.get("remote.settings")', () => typeof baseCtx.get === 'function' ? baseCtx.get('remote.settings') : null)
            || tryOne('ctx.get("remote")', () => {
              const r = typeof baseCtx.get === 'function' ? baseCtx.get('remote') : null;
              return r && r.settings;
            })
            || tryOne('bootstrapped remote', () => {
              const r = baseCtx.__xingkongRemote;
              return r && r.settings;
            });
          if (found) return found;
          resolveWriter.lastAttempts = attempts;
          return null;
        };
        rootCtx.inject(['slots'], (slotsCtx) => {
          slotsCtx.inject(['configForms'], (settingsCtx) => {
            settingsSvc = settingsCtx.configForms;
            const writer = () => resolveWriter(rootCtx);
            // ctx.remote only exists if "remote" was declared in a top-level
            // inject, which the theme cannot do (a missing dependency there
            // would stop the WHOLE theme from loading, wallpaper included).
            // So bootstrap it here, on our own fiber only: declaring it on the
            // ROOT would be wrong, declaring it here is exactly what the loader
            // does for the plugin's own dependencies, and it costs the theme
            // nothing when the settings UI is absent.
            if (typeof rootCtx.inject === 'function') {
              try {
                rootCtx.inject(['remote'], (remoteCtx) => {
                  rootCtx.__xingkongRemote = remoteCtx.remote || (remoteCtx.get && remoteCtx.get('remote')) || null;
                });
              } catch (error) {
                console.warn('[xingkong-theme] model probe: remote bootstrap skipped:', (error && error.message) || error);
              }
            }
            slotsCtx.slots.inject('settings.models.provider-card', () => {
              try {
                slotsCtx.slots.register({
                  name: 'settings.models.provider-card',
                  key: 'llm-pi-ai',
                }, (ownerProps) => h(Panel, Object.assign({}, ownerProps, { svc: settingsSvc, writer })));
              } catch (error) {
                console.warn('[xingkong-theme] model probe: slot registration failed:', (error && error.message) || error);
              }
            });
          });
        });
      };
      try {
        installModelProbePanel(ctx);
      } catch (panelError) {
        console.warn('[xingkong-theme] model probe panel unavailable:', (panelError && panelError.message) || panelError);
      }

    };

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
