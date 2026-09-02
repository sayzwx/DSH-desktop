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
  console.log('PASS: 渲染层冒烟（模块挂载 / markdown / 工具卡片 / i18n 与键位对齐 / vendored 库 / RPC 桥 / 启动无错误）');
}

main();
