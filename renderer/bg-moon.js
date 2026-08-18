/**
 * 紫月主题 · 无缝循环背景
 *
 * 背景本体是 bg-moon-loop.mp4（正放 + 倒放拼接的真无缝循环：
 * 中缝与外缝都是同一帧，实测帧差 ≈0.004，肉眼无任何复位顿感）。
 *
 * 因此这里**不需要**任何交叉淡化 / 相位错开的机制 —— 单一视频直接
 * `<video loop>` 播放即可，画面永不出现双帧重影。
 * 本脚本只负责三件事：
 *  1) 主题联动：moon 激活时显示并播放本层，其余主题暂停并隐藏；
 *  2) 窗口可见性：页面隐藏时暂停、恢复时继续（省电，与旧背景一致）；
 *  3) 对外的 window.__bgMoon 小接口（供 app.js / 验证脚本 / 实测驱动使用）。
 */
(() => {
  'use strict';

  const layer = document.getElementById('bgvideoMoon');
  const video = layer ? layer.querySelector('video') : null;
  let themeOn = false;

  /** 播放并忽略 autoplay 被拒绝（罕见；loop 兜底仍在） */
  const play = (v) => {
    if (!v) return;
    const p = v.play();
    if (p && p.catch) p.catch(() => {});
  };

  /** 主题联动：true = 显示并播放紫月层；false = 暂停并隐藏 */
  function setThemeActive(on) {
    themeOn = !!on;
    if (!layer) return;
    const mainVideo = document.getElementById('bgvideo');
    if (on) {
      layer.style.display = 'block';
      // 原星云背景已由 CSS 隐藏，这里同时暂停它，避免隐藏状态下继续解码浪费资源
      if (mainVideo) { try { mainVideo.pause(); } catch (e) { /* 忽略 */ } }
      play(video);
    } else {
      if (video) video.pause();
      layer.style.display = 'none';
      // 交还原星云背景：页面可见时恢复播放
      if (mainVideo && !document.hidden) play(mainVideo);
    }
  }

  // 随窗口可见性暂停/恢复（省电，与 starfield 对原背景的处理保持一致）
  document.addEventListener('visibilitychange', () => {
    if (!themeOn) return;
    if (document.hidden) {
      if (video) video.pause();
    } else if (video) {
      play(video);
    }
  });

  // ---------- 对外接口 ----------
  window.__bgMoon = {
    /** 当前是否为 moon 主题（紫月层是否激活） */
    isActive: () => themeOn,
    /** 主题切换联动 */
    setThemeActive,
    /** 调度状态快照（便于验证/调试/实测） */
    getInfo: () => ({
      // 无缝循环素材：周期 = 视频时长（正反各一段），无淡化
      T: video ? video.duration || null : null,
      fading: false,
      displayed: !!layer && layer.style.display !== 'none',
      paused: video ? video.paused : null,
      positions: video ? { a: video.currentTime } : null,
    }),
  };
})();