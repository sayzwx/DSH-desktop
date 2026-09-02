/**
 * 界面语言运行时。
 *
 * 语言包是同步加载的 .js（见 locales/zh-CN.js、locales/en-US.js），不是 JSON：
 * 其他渲染层脚本在自身加载期就会调用 t()，若语言包要靠 fetch 异步取回，
 * 所有消费者都得改成 await，代价远大于收益。
 *
 * zh-CN 是唯一真值源（从既有界面逐字抽取，不改写文案）。en-US 缺键时回落到
 * zh-CN，两边都缺时返回键名本身——让漏抽的键直接显示在界面上，而不是静默变空白。
 *
 * 对外接口：window.__i18n = { t, lang, setLang, langs }
 */
(function () {
  const LANG_KEY = 'dsh-lang';
  const FALLBACK = 'zh-CN';
  const bundles = window.__dshLocales || {};

  function detect() {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved && bundles[saved]) return saved;
    } catch { /* localStorage 不可用（隐私模式等）时按浏览器语言走 */ }
    const nav = String(navigator.language || FALLBACK);
    return nav.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
  }

  let lang = detect();

  /**
   * 取一条文案，`{name}` 形式的占位符用 params 替换。
   * @param key - 语言包里的键。
   * @param params - 占位符取值，可省略。
   * @returns 当前语言的文案；缺键时依次回落 zh-CN、键名本身。
   */
  function t(key, params) {
    let s = bundles[lang] ? bundles[lang][key] : undefined;
    if (s === undefined && lang !== FALLBACK) s = bundles[FALLBACK] ? bundles[FALLBACK][key] : undefined;
    if (s === undefined) return key;
    if (!params) return s;
    for (const [k, v] of Object.entries(params)) {
      s = s.split(`{${k}}`).join(String(v));
    }
    return s;
  }

  /**
   * 切换界面语言并持久化。
   * 存量文案尚未全部抽取（见 Phase 0.2b），因此设置页的语言入口暂不暴露；
   * 提前暴露会让用户切到英文后看到大半仍是中文的破碎界面。
   * @param next - 目标语言码，必须是已加载的语言包之一。
   * @returns 是否真的发生了切换。
   */
  function setLang(next) {
    if (!bundles[next] || next === lang) return false;
    lang = next;
    try { localStorage.setItem(LANG_KEY, next); } catch { /* 存不下就只在本次生效 */ }
    return true;
  }

  window.__i18n = {
    t,
    setLang,
    get lang() { return lang; },
    get langs() { return Object.keys(bundles); },
  };
})();
