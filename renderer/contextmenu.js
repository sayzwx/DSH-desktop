/**
 * 通用右键菜单。会话行、工作区分组、后续的消息操作都用它，避免每处各写一套定位与关闭逻辑。
 *
 * 同一时刻只存在一个菜单：open 会先关掉上一个。点菜单外、按 Esc、窗口失焦都关闭。
 * 菜单项的 onSelect 在关闭之后才调用，这样回调里再开对话框或再开一个菜单都不会被
 * 本次关闭逻辑连带清掉。
 *
 * 对外接口：window.__ctxMenu = { open, close }
 */
(function () {
  let el = null;

  function close() {
    if (!el) return;
    el.remove();
    el = null;
  }

  /**
   * 在指定视口坐标打开菜单。
   * @param x - 左边界（视口坐标，通常取事件的 clientX）。
   * @param y - 上边界（视口坐标，通常取事件的 clientY）。
   * @param items - 菜单项数组。{ label, onSelect, title?, disabled?, danger? }，
   *   或 { separator: true } 表示一条分隔线。
   */
  function open(x, y, items) {
    close();
    el = document.createElement('div');
    el.className = 'ctx-menu';
    el.setAttribute('role', 'menu');

    for (const item of items || []) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'ctx-sep';
        el.appendChild(sep);
        continue;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ctx-item' + (item.danger ? ' ctx-danger' : '');
      btn.textContent = item.label;
      btn.setAttribute('role', 'menuitem');
      if (item.title) btn.title = item.title;
      if (item.disabled) {
        btn.disabled = true;
      } else {
        btn.onclick = () => { close(); item.onSelect(); };
      }
      el.appendChild(btn);
    }

    document.body.appendChild(el);
    // 先挂到 DOM 才能量到尺寸；靠边时收回视口内，避免菜单被裁掉
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.max(4, Math.min(x, window.innerWidth - r.width - 6))}px`;
    el.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 6))}px`;
  }

  document.addEventListener('mousedown', (e) => {
    if (el && !e.target.closest('.ctx-menu')) close();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  window.addEventListener('blur', close);
  window.addEventListener('resize', close);

  window.__ctxMenu = { open, close };
})();
