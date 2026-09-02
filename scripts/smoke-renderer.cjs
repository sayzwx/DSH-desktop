/**
 * 渲染层冒烟测试：启动真实 Electron + CDP，检查启动期无异常，并驱动真实 DOM 验证抽出的模块。
 *
 * 与仓库里既有的 verify-*.js 不同，本脚本不硬编码仓库路径（那些脚本写死了已失效的
 * D:\DSH-desktop），一律以自身所在目录的上级为仓库根。
 *
 * 以 DSH_DEV_INSTANCE 启动，userData 与已安装的正式版隔离：既能与正式版并存，
 * 也不会因为单实例锁拿不到而静默退出（那会让测试实际测到正式版而非本仓库代码）。
 * 开发实例的 LAYOUT_ROOT 是仓库根，其下没有 harness/，因此不会接管 :3080 上正在跑的引擎，
 * 冒烟过程对真实会话零干扰。
 *
 * 用法: node scripts/smoke-renderer.cjs
 */
const http = require('node:http');
const path = require('node:path');
const { spawn, execSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.SMOKE_PORT || 9333);
const BOOT_WAIT_MS = 20000;

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function waitForPage(deadlineMs) {
  for (;;) {
    try {
      const targets = await getJson(`http://127.0.0.1:${PORT}/json/list`);
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* CDP 还没起来，继续轮询 */ }
    if (Date.now() > deadlineMs) throw new Error(`CDP 未在 ${BOOT_WAIT_MS}ms 内就绪（端口 ${PORT}）`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

function killTree(pid) {
  try {
    execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
  } catch { /* 进程可能已自行退出 */ }
}

async function main() {
  const electron = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
  const child = spawn(electron, [`--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', ROOT], {
    cwd: ROOT,
    stdio: 'ignore',
    env: { ...process.env, DSH_DEV_INSTANCE: 'smoke' },
  });

  const failures = [];
  const consoleErrors = [];
  let exitedEarly = null;
  child.on('exit', (code) => { exitedEarly = code; });

  try {
    const page = await waitForPage(Date.now() + BOOT_WAIT_MS);
    if (exitedEarly !== null) {
      throw new Error(`Electron 提前退出（code ${exitedEarly}）——很可能是单实例锁被正式版占用，DSH_DEV_INSTANCE 未生效`);
    }

    const WebSocket = require(path.join(ROOT, 'node_modules', 'ws'));
    const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
    let msgId = 0;
    const pending = new Map();
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        consoleErrors.push(`uncaught: ${d.exception?.description || d.text}`);
      }
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        consoleErrors.push(`log: ${m.params.entry.text}`);
      }
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
      }
    });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

    const send = (method, params = {}) => new Promise((resolve) => {
      const id = ++msgId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) {
        return { __error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
      }
      return r.result?.result?.value;
    };

    await send('Runtime.enable');
    await send('Log.enable');
    await new Promise((r) => setTimeout(r, 2500)); // 让渲染层脚本全部执行完

    const check = (name, actual, expected) => {
      const ok = JSON.stringify(actual) === JSON.stringify(expected);
      if (!ok) failures.push(`${name}\n    期望: ${JSON.stringify(expected)}\n    实际: ${JSON.stringify(actual)}`);
      return ok;
    };

    // --- 模块已挂载 ---
    check('__md 已挂载', await evalJs(`typeof window.__md?.block`), 'function');
    check('__md.inline 已挂载', await evalJs(`typeof window.__md?.inline`), 'function');
    check('__toolcards 已挂载', await evalJs(`typeof window.__toolcards?.renderToolCall`), 'function');

    // --- markdown 走真实模块 ---
    check(
      'md.block 渲染标题与粗体',
      await evalJs(`window.__md.block('# 标题\\n**粗**')`),
      '<h1>标题</h1>\n<p><strong>粗</strong></p>',
    );
    check(
      'md.block 转义脚本注入',
      await evalJs(`window.__md.block('<script>alert(1)<\\/script>')`),
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );

    // --- 工具卡片走 chat.js 注入的真实 ctx（验证 init 拿到了可用的 messagesEl）---
    const cardProbe = await evalJs(`(() => {
      const host = document.getElementById('chatMessages');
      if (!host) return { err: 'no #chatMessages' };
      const before = host.children.length;
      const sid = 'smoke-probe';
      const callId = 'smoke-call-1';
      window.__toolcards.renderToolCall(sid, {
        seq: 1,
        data: { callId, name: 'bash', arguments: JSON.stringify({ command: 'echo hi' }) },
      });
      const pendingEl = host.lastElementChild;
      const pendingBadge = pendingEl?.querySelector('.mt-badge')?.textContent?.trim();
      const pendingArg = pendingEl?.querySelector('.mt-arg')?.textContent?.trim();
      window.__toolcards.renderToolResult(sid, {
        seq: 2,
        data: {
          callId,
          name: 'bash',
          message: { content: [{ type: 'tool-result', toolCallId: callId, content: 'hi\\nworld' }] },
        },
      });
      const doneEl = host.querySelector('[data-call-id="' + callId + '"]');
      const doneBadge = doneEl?.querySelector('.mt-badge')?.textContent?.trim();
      const detail = doneEl?.querySelector('.mt-detail pre')?.textContent;
      const grew = host.children.length - before;
      doneEl?.remove();
      return { grew, pendingBadge, pendingArg, doneBadge, detail };
    })()`);

    if (cardProbe?.__error) failures.push(`工具卡片探针抛错: ${cardProbe.__error}`);
    else if (cardProbe?.err) failures.push(`工具卡片探针: ${cardProbe.err}`);
    else {
      check('call+result 复用同一张卡（只增 1 个节点）', cardProbe.grew, 1);
      check('pending 态徽标', cardProbe.pendingBadge, '调用中…');
      check('pending 态显示参数摘要', cardProbe.pendingArg, 'echo hi');
      check('result 态徽标', cardProbe.doneBadge, '✓ 完成');
      check('result 态输出文本', cardProbe.detail, 'hi\nworld');
    }

    // --- i18n 运行时 ---
    check('t 是函数', await evalJs(`typeof window.__i18n?.t`), 'function');
    check('默认取到中文值', await evalJs(`window.__i18n.t('session.action.rename')`), '重命名');
    check('{n} 占位符插值', await evalJs(`window.__i18n.t('session.search.truncated', { n: 20 })`),
      '结果已截断（最多 20 个会话），请细化关键词');
    check('缺键回落键名本身', await evalJs(`window.__i18n.t('__no_such_key__')`), '__no_such_key__');
    check('切到 en-US 取到英文值', await evalJs(`(() => {
      const before = window.__i18n.lang;
      window.__i18n.setLang('en-US');
      const v = window.__i18n.t('session.action.rename');
      window.__i18n.setLang(before); // 恢复，避免开发实例下次启动停在英文
      return v;
    })()`), 'Rename');

    // 键位对齐：各轨道会陆续往两个语言包加键，英文包落后不会报错，
    // 只会在用户切语言时露出中文，所以在这里挡住。
    const keyGaps = await evalJs(`(() => {
      const L = window.__dshLocales || {};
      const zh = Object.keys(L['zh-CN'] || {});
      const en = new Set(Object.keys(L['en-US'] || {}));
      return { missingInEn: zh.filter((k) => !en.has(k)), extraInEn: [...en].filter((k) => !(k in (L['zh-CN'] || {}))) };
    })()`);
    check('en-US 覆盖 zh-CN 全部键', keyGaps?.missingInEn, []);
    check('en-US 没有 zh-CN 里不存在的孤儿键', keyGaps?.extraInEn, []);

    // --- vendored 前端库：验证"真的能用"，不是"文件存在" ---
    // CSP 拦截与 KaTeX 字体 404 不会让下面这些断言失败，但会被本脚本既有的
    // 控制台/Log 错误检查捕获（Log.entryAdded level=error），两层分工互补。
    check('hljs 已挂载', await evalJs(`typeof window.hljs?.highlight`), 'function');
    const hljsOut = await evalJs(`window.hljs.highlight('const a = 1;', { language: 'javascript' }).value`);
    if (typeof hljsOut !== 'string' || !hljsOut.includes('hljs-keyword')) {
      failures.push(`hljs 未产出 token 类名（主题会失效）: ${JSON.stringify(hljsOut)}`);
    }
    // powershell 不在 common 构建里，是单独引入的语言包，最容易漏
    check('powershell 语言包已注册', await evalJs(`!!window.hljs.getLanguage('powershell')`), true);
    check('katex 已挂载', await evalJs(`typeof window.katex?.renderToString`), 'function');
    const katexOut = await evalJs(`window.katex.renderToString('x^2 + y^2')`);
    if (typeof katexOut !== 'string' || !katexOut.includes('katex')) {
      failures.push(`katex 未产出公式 HTML: ${JSON.stringify(String(katexOut).slice(0, 120))}`);
    }

    // --- 轨道 A：会话重命名 / 搜索 / 分叉 / 右键菜单 ---
    // 先在 Node 侧探测 :3080。只有引擎已在线才调 startHarness：
    // main.js:369 的 startHarness 在端口空闲时会 discoverHarness 失败并触发 autoInstallHarness，
    // 那会真的下载安装一个引擎；端口在线时它只 setState('running') 接管，不另起进程。
    const engineUp = await new Promise((resolve) => {
      const req = http.get('http://127.0.0.1:3080/api/host.describe', { timeout: 2500 }, (res) => {
        res.resume(); // 只关心连得上，不关心状态码（该端点是 POST，GET 会 4xx）
        resolve(true);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });

    if (!engineUp) {
      console.log('  (引擎未在线 — 跳过需要连接态的轨道 A 断言；端口空闲时 startHarness 会触发引擎自动安装，不能调)');
    } else {
      const started = await evalJs(`window.api.startHarness()`);
      await new Promise((r) => setTimeout(r, 2500)); // 等 setState → chatConnect → refreshSessions
      if (!started || started.ok !== true) failures.push(`startHarness 接管失败: ${JSON.stringify(started)}`);

      check('搜索框 placeholder 取自 i18n',
        await evalJs(`document.getElementById('csSearchInput')?.placeholder`), '搜索会话内容…');

      const sidebar = await evalJs(`(() => {
        const rows = [...document.querySelectorAll('#chatSessions .chat-session')];
        return {
          rowCount: rows.length,
          withRenameBtn: rows.filter((r) => r.querySelector('.cs-rename')).length,
          hasGroupOrEmpty: !!document.querySelector('#chatSessions .ws-group, #chatSessions .chat-empty'),
        };
      })()`);
      if (sidebar.rowCount > 0) {
        check('每个会话行都带改名按钮', sidebar.withRenameBtn, sidebar.rowCount);
      } else {
        console.log('  (当前无可见会话 — 跳过会话行断言，只验证空态渲染)');
        check('无会话时渲染空态或分组', sidebar.hasGroupOrEmpty, true);
      }

      // 真实驱动一次搜索。session.search 只读，不改动引擎状态。
      // 本机引擎把 session-query 配成 openAt:'never'，所以确定性路径是降级面板而非结果列表；
      // 两种结果都算通过，但降级面板必须真的带出配置片段与复制按钮。
      // 轮询而非固定睡眠：防抖 300ms + IPC + 引擎 RPC 往返的总耗时随机器负载漂移，
      // 实测 1200ms 偶发不够、1500ms 才稳，固定值迟早变成 flaky 测试。
      const searched = await evalJs(`(async () => {
        const waitFor = async (fn, timeoutMs) => {
          const deadline = Date.now() + timeoutMs;
          for (;;) {
            if (fn()) return true;
            if (Date.now() > deadline) return false;
            await new Promise((r) => setTimeout(r, 150));
          }
        };
        const input = document.getElementById('csSearchInput');
        input.value = 'e';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const settled = await waitFor(
          () => document.querySelector('#chatSessions .cs-search-off, #chatSessions .cs-search-msg'), 5000);
        const off = document.querySelector('#chatSessions .cs-search-off');
        const msg = document.querySelector('#chatSessions .cs-search-msg');
        const shape = {
          settled,
          disabled: !!off,
          hasMsg: !!msg,
          msgText: msg ? msg.textContent : null,
          offHasSnippet: off ? /openAt:\\s*first-search/.test(off.querySelector('.cs-off-code')?.textContent || '') : false,
          offHasCopy: off ? !!off.querySelector('#csOffCopy') : false,
          resultRows: document.querySelectorAll('#chatSessions .cs-result').length,
          groups: document.querySelectorAll('#chatSessions .ws-group').length,
        };
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        shape.backToGroups = await waitFor(
          () => document.querySelector('#chatSessions .ws-group, #chatSessions .chat-empty'), 3000);
        shape.offGoneAfterClear = !document.querySelector('#chatSessions .cs-search-off');
        return shape;
      })()`);
      if (searched?.__error) failures.push(`搜索驱动抛错: ${searched.__error}`);
      else {
        check('搜索在 5s 内出结果', searched.settled, true);
        check('搜索后渲染结果视图头或未启用面板', searched.hasMsg || searched.disabled, true);
        if (searched.disabled) {
          check('降级面板带出 openAt 配置片段', searched.offHasSnippet, true);
          check('降级面板带复制按钮', searched.offHasCopy, true);
          check('清空查询后降级面板消失', searched.offGoneAfterClear, true);
        }
        check('搜索视图下不再渲染分组', searched.groups, 0);
        check('清空查询后回到分组/空态视图', searched.backToGroups, true);
        console.log(`  (搜索 "e": ${searched.disabled ? '引擎未启用全文搜索 → 降级面板' : `${searched.msgText}；命中行 ${searched.resultRows}`})`);
      }
    }

    // 右键菜单组件：不依赖引擎，任何时候都能测
    const menuProbe = await evalJs(`(() => {
      let clicked = null;
      window.__ctxMenu.open(120, 120, [
        { label: '甲', onSelect: () => { clicked = '甲'; } },
        { label: '乙', disabled: true, onSelect: () => { clicked = '乙'; } },
        { separator: true },
        { label: '丙', danger: true, onSelect: () => { clicked = '丙'; } },
      ]);
      const menu = document.querySelector('.ctx-menu');
      const items = menu ? [...menu.querySelectorAll('.ctx-item')] : [];
      const shape = {
        present: !!menu,
        itemCount: items.length,
        sepCount: menu ? menu.querySelectorAll('.ctx-sep').length : 0,
        disabledCount: items.filter((b) => b.disabled).length,
        dangerCount: menu ? menu.querySelectorAll('.ctx-danger').length : 0,
        inViewport: menu ? (() => { const r = menu.getBoundingClientRect(); return r.left >= 0 && r.top >= 0; })() : false,
      };
      if (items[0]) items[0].click();
      shape.closedAfterClick = !document.querySelector('.ctx-menu');
      shape.callbackRan = clicked === '甲';
      window.__ctxMenu.open(120, 120, [{ label: '丁', onSelect: () => {} }]);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      shape.closedOnEscape = !document.querySelector('.ctx-menu');
      return shape;
    })()`);
    if (menuProbe?.__error) failures.push(`右键菜单探针抛错: ${menuProbe.__error}`);
    else {
      check('菜单已渲染', menuProbe.present, true);
      check('菜单项数量', menuProbe.itemCount, 3);
      check('分隔线数量', menuProbe.sepCount, 1);
      check('禁用项不可点', menuProbe.disabledCount, 1);
      check('danger 项带标记类', menuProbe.dangerCount, 1);
      check('菜单落在视口内', menuProbe.inViewport, true);
      check('点击后菜单先关闭', menuProbe.closedAfterClick, true);
      check('点击后回调执行', menuProbe.callbackRan, true);
      check('Esc 关闭菜单', menuProbe.closedOnEscape, true);
    }

    // --- RPC 桥：preload 暴露面 ---
    // 只调只读方法，或用必定失败的路径触发错误分支。开发实例的 rpcCall 同样指向
    // 127.0.0.1:3080，正式版引擎可能正在那里跑，调用 chat:rename / chat:fork / goal:* /
    // workspace.delete 这类会改状态的桥会污染用户真实数据。
    const BRIDGE_METHODS = [
      'chatRename', 'chatSearch', 'chatFork', 'chatUpdateQueue',
      'goalCreate', 'goalEdit', 'goalPause', 'goalResume', 'goalComplete', 'goalClear',
      'subagentList', 'subagentHistory', 'subagentPrompt', 'subagentInterrupt',
      'chatRenameWorkspace', 'chatDeleteWorkspace', 'chatMoveWorkspace', 'chatMoveSession',
      'copyPreset', 'removePreset', 'replaceSettings',
      'hostDescribe', 'hostOpenPath',
    ];
    const missing = await evalJs(`(() => {
      const want = ${JSON.stringify(BRIDGE_METHODS)};
      return want.filter((k) => typeof window.api?.[k] !== 'function');
    })()`);
    check('preload 暴露全部 RPC 桥方法', missing, []);
    check('relaunchApp 重复键已去掉且仍可用', await evalJs(`typeof window.api?.relaunchApp`), 'function');

    // 桥的往返：host.describe 是只读的，返回引擎版本与能力开关，能证明整条链路通。
    // canOpenPath 是 openPath 的能力门控，也是后续诊断面板的数据源。
    const describe = await evalJs(`window.api.hostDescribe()`);
    if (!describe || describe.__error || describe.ok !== true) {
      // 引擎没跑时 fetch 会 reject，这是可接受的：只断言桥没有把异常漏给渲染层
      const shaped = describe && describe.ok === false && typeof describe.error === 'string';
      if (!shaped) failures.push(`hostDescribe 返回形状不合规范: ${JSON.stringify(describe)}`);
      else console.log('  (引擎未运行，hostDescribe 走失败分支且形状规范 — 跳过在线契约断言)');
    } else {
      const v = describe.value || {};
      check('describe.version 是字符串', typeof v.version, 'string');
      check('describe.cwd 是字符串', typeof v.cwd, 'string');
      check('describe.home 是字符串', typeof v.home, 'string');
      check('describe.attachedSessions 是数字', typeof v.attachedSessions, 'number');
      check('describe.canOpenPath 是布尔', typeof v.canOpenPath, 'boolean');
      console.log(`  (引擎在线: v${v.version}, attached=${v.attachedSessions}, canOpenPath=${v.canOpenPath})`);
    }

    // 桥的失败分支：轨道 A 的重命名/分叉要靠 error 与 code 给出可理解提示，先证明这条链路通。
    // 用一个必定不存在的路径，无论 canOpenPath 真假都只会得到业务错误，不会打开任何东西。
    const openBogus = await evalJs(`window.api.hostOpenPath('Z:\\\\__dsh_smoke_nonexistent__\\\\nope')`);
    if (openBogus && !openBogus.__error && openBogus.ok !== false) {
      failures.push(`hostOpenPath 对不存在的路径竟然成功: ${JSON.stringify(openBogus)}`);
    } else if (openBogus && openBogus.ok === false && typeof openBogus.error !== 'string') {
      failures.push(`桥的失败分支 error 不是字符串: ${JSON.stringify(openBogus)}`);
    }

    // 启动期无错误 ---
    const realErrors = consoleErrors.filter((e) => !/favicon|ERR_FILE_NOT_FOUND.*\.ico/i.test(e));
    if (realErrors.length > 0) {
      failures.push(`启动期控制台/页面错误 ${realErrors.length} 条:\n    ${realErrors.slice(0, 10).join('\n    ')}`);
    }

    ws.close();
  } catch (err) {
    failures.push(`冒烟测试自身失败: ${err.message}`);
  } finally {
    killTree(child.pid);
  }

  if (failures.length > 0) {
    console.error(`FAIL (${failures.length} 项)`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('PASS: 渲染层冒烟（模块 / markdown / 工具卡片 / i18n / vendored / 轨道A 搜索与右键菜单 / RPC 桥 / 启动无错误）');
}

main();
