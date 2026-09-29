/**
 * renderer/event-seq.js 单测（纯 Node，不需要 Electron）。
 *
 * 这是「显示框重复」bug 的第二道防线：引擎按 seq 给每个会话事件编号，同一 seq 再投递一次
 * 一定是重复帧，必须丢弃，否则 turn/end（回合统计框）、permission/preset 等三条权限告警条
 * 会在界面上画两份 —— 而旧的 renderedIds 机制只覆盖带消息 id 的 user/message、assistant/message。
 *
 * 关键性质（本测试逐条钉死）：
 *   1) 首次到达全接受；
 *   2) 精确重复拒收；
 *   3) 两条连接交错投递（5,6,7,5,6,7）时后半段全部拒收；
 *   4) **乱序（6,5,7,6）不能丢事件** —— 5 在水位之后才到，但从未应用过，必须接受。
 *      纯水位判据（seq <= max）“丢消息”比“重复显示”更糟，所以实现用的是「是否见过」集合；
 *   5) 没有数字 seq 的帧一律放行（没有判据就不要猜）；
 *   6) 长会话内存有界，且尾部窗口内的重复仍被拒收。
 *
 * 用法: node scripts/event-seq-test.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'renderer', 'event-seq.js');

const failures = [];
let passed = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++;
  else failures.push(`${name}\n    期望: ${JSON.stringify(expected)}\n    实际: ${JSON.stringify(actual)}`);
}

/** 渲染层模块是「IIFE + window.__xxx」的约定（无打包步骤），这里喂一个假 window 直接求值，
 *  保证测的就是浏览器里跑的那份源码，而不是复制出来的第二份实现。 */
function loadModule() {
  const src = fs.readFileSync(SRC, 'utf8');
  const win = {};
  new Function('window', src)(win);
  if (!win.__eventSeq || typeof win.__eventSeq.create !== 'function') {
    throw new Error('event-seq.js 没有导出 window.__eventSeq.create');
  }
  return win.__eventSeq;
}

/** 把一串 seq 依次喂给水位，返回每次 accept 的结果。 */
function feed(guard, seqs) {
  return seqs.map((q) => guard.accept(q));
}

function main() {
  const { create } = loadModule();

  // 1) 首次到达全接受
  {
    const g = create();
    check('首次到达全部接受', feed(g, [5, 6, 7]), [true, true, true]);
    check('watermark 跟随最大 seq', g.watermark, 7);
  }

  // 2) 精确重复（同一帧投递两次）—— 用户看到的重复框就是这一条
  {
    const g = create();
    feed(g, [5, 6, 7]);
    check('已应用的 seq 再来一次被拒', g.accept(7), false);
    check('拒绝过的 seq 仍被拒（幂等）', g.accept(7), false);
    check('未见过的新 seq 仍接受', g.accept(8), true);
  }

  // 3) 两条连接交错投递：A 推完整序列、B 再推同一序列
  {
    const g = create();
    check('两条连接同序交错 → 后半段全部拒收',
      feed(g, [5, 6, 7, 5, 6, 7]), [true, true, true, false, false, false]);
  }

  // 4) 乱序：两条连接的交错顺序不受控
  {
    const g = create();
    // 6 先到（另一条连接先送达），随后 5 —— 5 从未应用过，必须接受
    check('乱序到达不丢事件（6,5,7,6）', feed(g, [6, 5, 7, 6]), [true, true, true, false]);
    // 更极端的交错
    const g2 = create();
    check('乱序到达不丢事件（3,4,3,5,4,5）', feed(g2, [3, 4, 3, 5, 4, 5]), [true, true, false, true, false, false]);
  }

  // 5) 没有数字 seq 的帧：一律放行，且不污染去重记账
  {
    const g = create();
    check('undefined seq 放行', g.accept(undefined), true);
    check('null seq 放行', g.accept(null), true);
    check('字符串 seq 放行（不做数字转换猜测）', g.accept('5'), true);
    check('NaN 放行', g.accept(NaN), true);
    check('Infinity 放行', g.accept(Infinity), true);
    check('放行不影响后续数字 seq 的判据', feed(g, [5, 5]), [true, false]);
  }

  // 6) 有界 + 尾部窗口仍然有效
  {
    const g = create();
    for (let i = 0; i < 20000; i++) g.accept(i);
    check('watermark 到 19999', g.watermark, 19999);
    const bounded = g.size <= 8192;
    if (!bounded) failures.push(`长会话去重集合无界增长: size=${g.size}（上限应为 8192）`);
    else passed++;
    check('尾部窗口内的重复仍被拒', g.accept(19990), false);
    check('新 seq 仍接受', g.accept(20000), true);
  }

  // 7) 会话之间互不干扰（chat.js 每个 sessionId 一个实例）
  {
    const a = create();
    const b = create();
    check('A 应用 1', a.accept(1), true);
    check('B 不受 A 影响', b.accept(1), true);
    check('A 的重复被拒', a.accept(1), false);
    check('B 的重复被拒', b.accept(1), false);
    check('两个实例水位独立', [a.watermark, b.watermark], [1, 1]);
  }

  if (failures.length > 0) {
    console.error(`FAIL (${failures.length} 项，通过 ${passed} 项)`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`PASS: 事件 seq 水位（首达接受 / 重复拒收 / 交错去重 / 乱序不丢事件 / 无 seq 放行 / 长会话有界 / 会话隔离）共 ${passed} 项`);
}

main();
