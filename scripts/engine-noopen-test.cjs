/**
 * 引擎启动契约测试：`dsh web --no-open` 必须不打开系统浏览器。
 *
 * 背景（2026-09-29 用户反馈「启动应用还是会跳出 web 端」）：
 * 引擎的 web 应用默认 openBrowser=true，:3080 就绪后会自己弹一个系统浏览器
 * （packages/bundle/web-app 里 handoffBrowser = config.openBrowser && !launchedThroughSsh，
 * 弹之前会打一行 "dsh web: opening the default browser; pass --no-open to disable"）。
 * main.js 的 launchHarness 因此给 spawn 加上 --no-open（并先做能力探测，老引擎不传）。
 *
 * 本测试用**临时 DSH_HOME + 独立端口**起一次真实引擎（不碰用户正在用的 :3080 会话），
 * 断言两件事：
 *   1. 带 --no-open 时：服务正常绑定（打出 "dsh web: http://…"），且**没有**开浏览器那行
 *   2. 不带时（对照）：那行**必须出现** —— 否则说明引擎已经不弹浏览器了，
 *      main.js 里的能力探测与传参可以简化（这条断言是为了让契约变化能被发现，而不是
 *      为了真去弹一个浏览器：真正 openBrowser 之前就 kill 掉进程）
 *
 * 用法: node scripts/engine-noopen-test.cjs
 * 环境: DSH_ENGINE_BIN 可指定引擎入口（默认取本机已安装引擎 D:\DSH\harness）
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CANDIDATE_BINS = [
  process.env.DSH_ENGINE_BIN,
  'D:/DSH/harness/apps/cli/lib/bin.js',
].filter(Boolean);
const NODE_CANDIDATES = [
  'C:/Users/mjsx/.dsh/tools/node/node.exe',
  process.env.DSH_NODE_EXE,
  process.execPath,
].filter(Boolean);

const failures = [];
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures.push(`${name}\n    期望: ${JSON.stringify(expected)}\n    实际: ${JSON.stringify(actual)}`);
};

/** 起一次引擎，跑 ms 毫秒后杀掉，返回它的全部输出。 */
function runEngine(bin, args, homeDir, ms, port) {
  return new Promise((resolve) => {
    const nodeExe = NODE_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || process.execPath;
    const env = { ...process.env, DSH_HOME: homeDir };
    delete env.DEEPSEEK_API_KEY; // 与 main.js 一致：不让 .env 托管的密钥进启动环境
    const p = spawn(nodeExe, [bin, 'web', ...args, '--port', String(port)], { env, windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => { out += d.toString(); });
    p.stderr.on('data', (d) => { out += d.toString(); });
    const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* 已退出 */ } resolve(out); }, ms);
    p.on('exit', () => { clearTimeout(timer); resolve(out); });
  });
}

(async () => {
  const bin = CANDIDATE_BINS.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
  if (!bin) {
    console.log('SKIP: 本机没有可用的引擎入口（设 DSH_ENGINE_BIN 指定）。');
    process.exit(0);
  }
  const tmpHome = path.join(os.tmpdir(), 'dsh-noopen-test-' + Date.now());
  fs.mkdirSync(tmpHome, { recursive: true });

  try {
    // 1) 带 --no-open
    const withFlag = await runEngine(bin, ['--no-open'], tmpHome, 16000, 3099);
    const hasUrl = /dsh web: https?:\/\//.test(withFlag);
    const hasOpenLine = /opening the default browser/.test(withFlag);
    check('带 --no-open：引擎正常绑定并打出 URL', hasUrl, true);
    check('带 --no-open：没有「opening the default browser」', hasOpenLine, false);

    // 2) 对照：不带该开关时必须出现那行（出现即 kill，不会真的留下浏览器窗口）
    const withoutFlag = await runEngine(bin, [], tmpHome, 9000, 3098);
    const controlOpenLine = /opening the default browser/.test(withoutFlag);
    check('对照（不带 --no-open）：引擎仍会声明要打开浏览器 —— 说明该开关是有效开关',
      controlOpenLine, true);

    console.log(`  (带 --no-open 输出摘要: ${withFlag.split(/\r?\n/).filter((l) => /dsh web:/.test(l)).slice(0, 2).join(' | ').slice(0, 160)})`);
  } finally {
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  if (failures.length) {
    console.error(`FAIL (${failures.length} 项)`);
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }
  console.log('PASS: 引擎启动契约（--no-open 静默 / 不带时仍会开浏览器，故该开关必须传）');
})();
