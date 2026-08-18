/**
 * 动态背景管理器
 *
 * 背景本体是 bg-animated.mp4 —— 由 1.jpg 直接渲染出的无缝循环动态壁纸
 * （全天空星云流动 / 云层漂移 / 城市灯火 / 动态流星，全部来自参考图本身）。
 * 此脚本只负责：
 *   1. 播放/暂停背景视频（随窗口可见性切换，省电）
 *   2. 交互反馈：启动 Harness / 发送消息时，背景星云短暂微闪（事件驱动，平时不渲染任何像素）
 */
(() => {
  const video = document.getElementById('bgvideo');
  const fx = document.getElementById('bgfx');
  const ctx = fx.getContext('2d');

  let W = 0, H = 0, DPR = 1;
  let rafId = null;
  let lastFrame = 0;
  let flashUntil = 0;

  function resize() {
    DPR = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
    W = window.innerWidth;
    H = window.innerHeight;
    fx.width = W * DPR;
    fx.height = H * DPR;
    fx.style.width = W + 'px';
    fx.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function frame(now) {
    if (now >= flashUntil) {
      ctx.clearRect(0, 0, W, H);
      rafId = null; // 空闲：完全不渲染，由视频承担全部背景
      return;
    }
    const dt = Math.min(50, now - lastFrame);
    lastFrame = now;
    ctx.clearRect(0, 0, W, H);
    const k = (flashUntil - now) / 900;
    ctx.globalCompositeOperation = 'screen';
    const g = ctx.createRadialGradient(W * 0.5, H * 0.34, 0, W * 0.5, H * 0.34, Math.max(W, H) * 0.55);
    g.addColorStop(0, `rgba(140, 160, 255, ${0.16 * k})`);
    g.addColorStop(0.5, `rgba(90, 220, 235, ${0.08 * k})`);
    g.addColorStop(1, 'rgba(90, 220, 235, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    rafId = requestAnimationFrame(frame);
  }

  function kick() {
    if (!rafId) {
      lastFrame = performance.now();
      rafId = requestAnimationFrame(frame);
    }
  }

  function start() {
    resize();
    // 紫月主题下 #bgvideo 已被 CSS 隐藏并由 bg-moon.js 接管背景，
    // 不再播放它（避免隐藏状态下仍持续解码大视频浪费资源）
    if (document.documentElement.dataset.theme === 'moon') { video.pause(); return; }
    const p = video.play();
    if (p && p.catch) p.catch(() => { /* 静默：poster 图兜底 */ });
  }

  function stop() {
    video.pause();
  }

  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });

  window.__starfield = {
    start,
    stop,
    // 交互反馈：启动 / 发送消息时 —— 星云微闪
    triggerMeteor() {
      flashUntil = performance.now() + 900;
      kick();
    },
  };
})();
