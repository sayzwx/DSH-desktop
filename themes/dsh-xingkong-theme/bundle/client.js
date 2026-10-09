// dsh-xingkong-theme —— 浏览器半身（官方架构：window.__ModuleLoader__.load + ctx.theme.overrideTokens）
//
// 设计语言：Nebula Core「星云核心」—— 深空观测站
//   · 深空黑基底（Void Black #030508）→ 星云蓝层次（Navy #0A0E1A / Abyss #0D1B2A）
//   · 极光青强调（Stellar Cyan #00D4AA）· 星云紫次强调（Nebula Violet #7B61FF）
//   · 彗星金高亮（Comet Gold #FFD700）· 地平线橙告警（Horizon Orange #FF6B35）
//   · 文字：星光白（Starlight White #E8F4F8）/ 星际尘埃灰（Dust Gray #6B7B8D）
//
// 覆盖范围：官方 token 体系的**全部语义层**——alias-* 99 个 + specific-* 11 个
// （含侧边栏三兄弟 specific-sidebar-*）。浅色档走「星云白昼」变体：同一色相语言，
// 强调色加深到满足对比度（#009E82 on white ≈ 4.6:1）。
// 纯 token 主题：不引入壁纸/霓虹扩散，不改官方界面结构 —— 只换配色语言。
window.__ModuleLoader__.load({
  id: 'dsh-xingkong-theme',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const inject = ['theme'];

    // token → [浅色(星云白昼), 深色(深空)]
    const T = {
      // ---------- 背景层次 ----------
      '--dsw-alias-bg-base': ['#F6F8FB', '#030508'],
      '--dsw-alias-bg-layer-1': ['#FFFFFF', '#0A0E1A'],
      '--dsw-alias-bg-layer-2': ['#FFFFFF', '#0D1B2A'],
      '--dsw-alias-bg-layer-3': ['#EEF3F8', '#13233A'],
      '--dsw-alias-bg-overlay': ['rgba(246,248,251,0.94)', 'rgba(3,5,8,0.92)'],
      '--dsw-alias-bg-module-platform': ['#FFFFFF', '#0D1B2A'],
      '--dsw-alias-bg-multi-select': ['rgba(0,158,130,0.12)', 'rgba(0,212,170,0.16)'],
      '--dsw-alias-bg-skeleton': ['rgba(10,14,26,0.06)', 'rgba(232,244,248,0.06)'],
      '--dsw-alias-bg-document-preview': ['#FFFFFF', '#0D1B2A'],
      '--dsw-alias-bg-mask-1': ['rgba(10,14,26,0.12)', 'rgba(3,5,8,0.40)'],
      '--dsw-alias-bg-mask-2': ['rgba(10,14,26,0.24)', 'rgba(3,5,8,0.58)'],
      '--dsw-alias-bg-mask-3': ['rgba(10,14,26,0.36)', 'rgba(3,5,8,0.74)'],
      '--dsw-alias-bg-mask-drop': ['rgba(10,14,26,0.18)', 'rgba(0,0,0,0.55)'],
      '--dsw-alias-bg-mask-photo': ['rgba(246,248,251,0.85)', 'rgba(3,5,8,0.86)'],

      // ---------- 文字 ----------
      '--dsw-alias-label-primary': ['#0A0E1A', '#E8F4F8'],
      '--dsw-alias-label-primary-bluish': ['#14243A', '#CDE3EC'],
      '--dsw-alias-label-primary-dimmed': ['rgba(10,14,26,0.62)', 'rgba(232,244,248,0.60)'],
      '--dsw-alias-label-primary-foreground': ['#F6F8FB', '#04211C'],
      '--dsw-alias-label-primary-inverted': ['#F6F8FB', '#030508'],
      '--dsw-alias-label-secondary': ['#46586B', '#A9BFCF'],
      '--dsw-alias-label-tertiary': ['#6B7B8D', '#6B7B8D'],
      '--dsw-alias-label-caption': ['#8A99A8', '#55677A'],
      '--dsw-alias-label-dimmed': ['rgba(10,14,26,0.45)', 'rgba(232,244,248,0.45)'],
      '--dsw-alias-label-document-preview': ['#46586B', '#A9BFCF'],

      // ---------- 边框 ----------
      '--dsw-alias-border-l1': ['rgba(10,14,26,0.10)', 'rgba(232,244,248,0.08)'],
      '--dsw-alias-border-l2': ['rgba(10,14,26,0.14)', 'rgba(232,244,248,0.12)'],
      '--dsw-alias-border-l2-darkmode-thin': ['rgba(10,14,26,0.08)', 'rgba(232,244,248,0.06)'],
      '--dsw-alias-border-l3': ['rgba(10,14,26,0.20)', 'rgba(232,244,248,0.18)'],
      '--dsw-alias-border-l4': ['rgba(10,14,26,0.28)', 'rgba(232,244,248,0.26)'],
      '--dsw-alias-border-inverted': ['rgba(10,14,26,0.24)', 'rgba(232,244,248,0.20)'],
      '--dsw-alias-border-inverted2': ['rgba(10,14,26,0.16)', 'rgba(232,244,248,0.14)'],

      // ---------- 品牌 / 强调（极光青） ----------
      '--dsw-alias-brand-primary': ['#009E82', '#00D4AA'],
      '--dsw-alias-brand-primary-invert': ['#7B61FF', '#7B61FF'],
      '--dsw-alias-brand-primary-new-colorprimary-new-color': ['#009E82', '#00D4AA'],
      '--dsw-alias-brand-text': ['#007A66', '#22E0BC'],
      '--dsw-alias-link': ['#007A66', '#22E0BC'],

      // ---------- 按钮 ----------
      '--dsw-alias-button-primary-fill': ['#009E82', '#00D4AA'],
      '--dsw-alias-button-primary-hover': ['#00B694', '#22E0BC'],
      '--dsw-alias-button-primary-dimmed': ['rgba(0,158,130,0.38)', 'rgba(0,212,170,0.38)'],
      '--dsw-alias-button-contrast-fill': ['#0A0E1A', '#E8F4F8'],
      '--dsw-alias-button-floating-fill': ['#FFFFFF', '#0D1B2A'],
      '--dsw-alias-button-floating-hover': ['#F1F5FA', '#16283F'],
      '--dsw-alias-button-elevated-fill': ['#FFFFFF', '#13233A'],
      '--dsw-alias-button-ghost-active-fill': ['rgba(0,158,130,0.12)', 'rgba(0,212,170,0.14)'],
      '--dsw-alias-button-ghost-active-hover': ['rgba(0,158,130,0.18)', 'rgba(0,212,170,0.20)'],
      '--dsw-alias-button-ghost-active-border': ['rgba(0,158,130,0.35)', 'rgba(0,212,170,0.40)'],
      '--dsw-alias-button-info-fill': ['#7B61FF', '#7B61FF'],
      '--dsw-alias-button-info-hover': ['#8F79FF', '#8F79FF'],
      '--dsw-alias-button-tool-bar-fill': ['#FFFFFF', '#0D1B2A'],
      '--dsw-alias-button-tool-bar-hover': ['#F1F5FA', '#16283F'],
      '--dsw-alias-button-tool-bar-fill-invisible': ['transparent', 'transparent'],

      // ---------- 交互态 ----------
      '--dsw-alias-interactive-bg-hover': ['rgba(0,158,130,0.07)', 'rgba(0,212,170,0.08)'],
      '--dsw-alias-interactive-bg-hover-solid': ['#EEF3F8', '#13233A'],
      '--dsw-alias-interactive-bg-active': ['rgba(0,158,130,0.14)', 'rgba(0,212,170,0.16)'],
      '--dsw-alias-interactive-bg-hover-accent': ['rgba(0,158,130,0.16)', 'rgba(0,212,170,0.20)'],
      '--dsw-alias-interactive-bg-hover-danger': ['rgba(255,107,53,0.14)', 'rgba(255,107,53,0.18)'],

      // ---------- Markdown ----------
      '--dsw-alias-markdown-inline-code': ['rgba(0,158,130,0.10)', 'rgba(0,212,170,0.12)'],
      '--dsw-alias-markdown-code-block': ['#F1F5F9', '#070C16'],
      '--dsw-alias-markdown-code-block-banner': ['#E6EDF4', '#0D1B2A'],
      '--dsw-alias-markdown-tag': ['rgba(123,97,255,0.14)', 'rgba(123,97,255,0.20)'],
      '--dsw-alias-markdown-citation': ['rgba(0,158,130,0.12)', 'rgba(0,212,170,0.14)'],
      '--dsw-alias-markdown-placeholder': ['#8A99A8', '#55677A'],
      '--dsw-alias-markdown-code-segment-selected': ['rgba(0,158,130,0.16)', 'rgba(0,212,170,0.18)'],
      '--dsw-alias-markdown-code-segment-unselected': ['rgba(10,14,26,0.05)', 'rgba(232,244,248,0.06)'],

      // ---------- 滚动条 ----------
      '--dsw-alias-scrollbar-bg-l1': ['rgba(10,14,26,0.12)', 'rgba(232,244,248,0.10)'],
      '--dsw-alias-scrollbar-bg-l2': ['rgba(10,14,26,0.18)', 'rgba(232,244,248,0.16)'],
      '--dsw-alias-scrollbar-hover-l1': ['rgba(0,158,130,0.45)', 'rgba(0,212,170,0.40)'],
      '--dsw-alias-scrollbar-hover-l2': ['rgba(0,158,130,0.55)', 'rgba(0,212,170,0.52)'],

      // ---------- 设置卡 / 提示 ----------
      '--dsw-alias-settings-card-fill': ['#FFFFFF', '#0D1B2A'],
      '--dsw-alias-settings-card-stroke': ['rgba(10,14,26,0.10)', 'rgba(232,244,248,0.10)'],
      '--dsw-alias-toast-bg': ['#0A0E1A', '#0D1B2A'],
      '--dsw-alias-toast-label': ['#F6F8FB', '#E8F4F8'],
      '--dsw-alias-tooltip-bg': ['#0A0E1A', '#13233A'],
      '--dsw-alias-tooltip-key-bg': ['rgba(0,212,170,0.16)', 'rgba(0,212,170,0.16)'],
      '--dsw-alias-menu-icon': ['#46586B', '#A9BFCF'],

      // ---------- 状态色 ----------
      '--dsw-alias-state-success-primary': ['#128A5B', '#34D399'],
      '--dsw-alias-state-success-secondary': ['rgba(18,138,91,0.14)', 'rgba(52,211,153,0.18)'],
      '--dsw-alias-state-success-tertiary': ['rgba(18,138,91,0.08)', 'rgba(52,211,153,0.12)'],
      '--dsw-alias-state-warn-primary': ['#B08900', '#FFD700'],
      '--dsw-alias-state-warn-secondary': ['rgba(176,137,0,0.14)', 'rgba(255,215,0,0.18)'],
      '--dsw-alias-state-warn-tertiary': ['rgba(176,137,0,0.08)', 'rgba(255,215,0,0.12)'],
      '--dsw-alias-state-warn-label': ['#7A5F00', '#FFE45C'],
      '--dsw-alias-state-error-primary': ['#C62828', '#F25A5A'],
      '--dsw-alias-state-error-secondary': ['rgba(198,40,40,0.14)', 'rgba(242,90,90,0.18)'],
      '--dsw-alias-state-idle-primary': ['#8A99A8', '#55677A'],
      '--dsw-alias-state-business-primary': ['#5A45C9', '#7B61FF'],
      '--dsw-alias-state-business-secondary': ['rgba(90,69,201,0.14)', 'rgba(123,97,255,0.18)'],
      '--dsw-alias-state-business-tertiary': ['rgba(90,69,201,0.08)', 'rgba(123,97,255,0.12)'],

      // ---------- 代码差异 ----------
      '--dsw-alias-code-diff-added': ['#128A5B', '#34D399'],
      '--dsw-alias-code-diff-deleted': ['#C2410C', '#FF6B35'],
      '--dsw-alias-file-diff-added-bg': ['rgba(18,138,91,0.10)', 'rgba(52,211,153,0.12)'],
      '--dsw-alias-file-diff-added-gutter': ['rgba(18,138,91,0.20)', 'rgba(52,211,153,0.24)'],
      '--dsw-alias-file-diff-added-marker': ['#128A5B', '#34D399'],
      '--dsw-alias-file-diff-deleted-bg': ['rgba(194,65,12,0.10)', 'rgba(255,107,53,0.12)'],
      '--dsw-alias-file-diff-deleted-gutter': ['rgba(194,65,12,0.20)', 'rgba(255,107,53,0.24)'],
      '--dsw-alias-file-diff-deleted-marker': ['#C2410C', '#FF6B35'],

      // ---------- 引导 ----------
      '--dsw-alias-onboarding-accent': ['#009E82', '#00D4AA'],
      '--dsw-alias-onboarding-card-fill': ['#FFFFFF', '#0D1B2A'],
      '--dsw-alias-onboarding-checkbox-border': ['rgba(0,158,130,0.45)', 'rgba(0,212,170,0.50)'],
      '--dsw-alias-onboarding-secondary-fill': ['#EEF3F8', '#13233A'],

      // ---------- specific：组件级落点（含侧边栏） ----------
      '--dsw-specific-sidebar-fill': ['#EFF3F8', '#070C16'],
      '--dsw-specific-sidebar-nav-item-hover': ['rgba(0,158,130,0.08)', 'rgba(0,212,170,0.08)'],
      '--dsw-specific-sidebar-nav-item-active': ['rgba(0,158,130,0.14)', 'rgba(0,212,170,0.14)'],
      '--dsw-specific-sidebar-nav-item-active-accent': ['#009E82', '#00D4AA'],
      '--dsw-specific-bubble': ['#FFFFFF', '#0D1B2A'],
      '--dsw-specific-bubble-highlight': ['rgba(0,158,130,0.08)', 'rgba(0,212,170,0.10)'],
      '--dsw-specific-input-major': ['#FFFFFF', '#0D1B2A'],
      '--dsw-specific-login-input': ['#FFFFFF', '#0D1B2A'],
      '--dsw-specific-menu': ['#FFFFFF', '#0D1B2A'],
      '--dsw-specific-selector': ['#FFFFFF', '#0D1B2A'],
      '--dsw-specific-tip': ['#FFFFFF', '#0D1B2A'],
    };

    const apply = (ctx) => {
      // 1) token 层：一次性交作业给官方主题服务（浅/深双档）
      const table = {};
      for (const key of Object.keys(T)) {
        const [light, dark] = T[key];
        table[key] = { light, dark };
      }
      const disposeTokens = ctx.theme.overrideTokens('xingkong', table);
      ctx.effect(() => disposeTokens);

      // 2) 克制打磨：只做两件官方 token 覆盖不到的观感细节——
      //    · 文本选中色走极光青（默认是系统蓝，跟主题语言冲突）
      //    · 滚动条圆角（颜色已由 scrollbar-* token 控制）
      const style = document.createElement('style');
      style.textContent = `
::selection { background: rgba(0, 158, 130, 0.22); }
body[data-ds-dark-theme] ::selection { background: rgba(0, 212, 170, 0.28); }
*::-webkit-scrollbar-thumb { border-radius: 999px; }
*::-webkit-scrollbar-thumb:hover { border-radius: 999px; }
`;
      document.head.append(style);
      ctx.effect(() => () => style.remove());
    };

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
