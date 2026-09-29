/* update-download-test.cjs —— 自动更新下载链路的失败模式复现测试（纯 Node，不起 Electron）
 *
 * 用户在别人机器上报的是：「下载到 100% 会报错，然后又重新开始下载，一直重复」。
 * 这类症状**在自己机器上复现不出来**（网快、目录可写、没人拦）。所以这里起一个
 * 本地 HTTP 服务器，把怀疑到的每一种失败模式都真刀真枪地造一遍：
 *
 *   ① 首个镜像 404                → 必须自动换下一跳并成功
 *   ② content-length 对不上        → 必须判失败，且不产出目标文件
 *   ③ 200 + HTML 错误页            → 必须判失败（不是 PE），且清掉垃圾 .part
 *   ④ 中途彻底卡住（不发也不断）    → 停滞检测必须中止并换下一跳
 *   ⑤ 慢速但活着（每块间隔 < 停滞阈值，总时长很长）
 *                                → **必须成功**。这是本次修复的核心断言：
 *                                  旧实现用 AbortSignal.timeout(120s) 给整个下载压死线，
 *                                  慢网下大文件收尾时被掐断 → 报错 → 从 0 重下 → 五跳全断。
 *   ⑥ 绝对兜底确实存在且可配        → 把上限压到 1s 跑慢速下载，必须失败并说清原因
 *   ⑦ 断点续传                    → 第一跳发一半断链，第二跳必须带 Range 且拿到 206，
 *                                  最终文件与原始字节逐字节一致
 *   ⑧ 安装根目录不可写             → 必须落到兜底目录（用一个"文件"冒充目录来构造）
 *
 * 跑法：node scripts/update-download-test.cjs
 * 输出：%TEMP%\update-download-test.json
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { downloadToFile, pickWritableDir, isPeFile } = require(path.join(__dirname, '..', 'lib', 'download.js'));

const RESULT = path.join(os.tmpdir(), 'update-download-test.json');
const failures = [];
const steps = [];

/** 造一个体积明确的假安装包（带 MZ 头，这样才能过 PE 校验）。 */
const PAYLOAD = Buffer.concat([
  Buffer.from([0x4d, 0x5a]),
  Buffer.alloc(64 * 1024 * 6, 0x41).map((_, __, i) => i % 251),
]);
const TOTAL = PAYLOAD.length;

let base = '';        // 服务器地址
const seen = [];      // 服务器收到的请求，用来核实 Range 头

function makeServer() {
  const chunk = (res, buf) => { res.write(buf); };
  return http.createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    const range = req.headers.range || '';
    seen.push({ path: p, range });

    if (p === '/404') { res.writeHead(404); res.end('nope'); return; }

    if (p === '/ok') {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(TOTAL) });
      res.end(PAYLOAD);
      return;
    }

    // 声明 6MB 却只发 2MB 就收尾 → 长度对不上
    if (p === '/truncated') {
      const half = PAYLOAD.subarray(0, 64 * 1024 * 2);
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(TOTAL) });
      res.end(half);
      return;
    }

    // 镜像把 HTML 错误页当 200 返回（真实世界常见）
    if (p === '/html') {
      const body = Buffer.from('<!DOCTYPE html><html><body>502 Bad Gateway</body></html>');
      res.writeHead(200, { 'content-type': 'text/html', 'content-length': String(body.length) });
      res.end(body);
      return;
    }

    // 发几块之后彻底不动：连接不关、也不发数据 —— 这就是"卡死"
    if (p === '/stall') {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(TOTAL) });
      let n = 0;
      const t = setInterval(() => {
        if (n >= 3) { clearInterval(t); return; }  // 之后一直不写、不 end
        res.write(PAYLOAD.subarray(n * 4096, (n + 1) * 4096));
        n++;
      }, 30);
      req.on('close', () => clearInterval(t));
      return;
    }

    // 慢速但活着：每 120ms 一块，总共约 2.4s（远超"停滞阈值 300ms 不被触发"）
    if (p === '/slow') {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(TOTAL) });
      const block = Math.ceil(TOTAL / 20);
      let i = 0;
      const t = setInterval(() => {
        if (i >= 20) { clearInterval(t); res.end(); return; }
        res.write(PAYLOAD.subarray(i * block, Math.min(TOTAL, (i + 1) * block)));
        i++;
      }, 120);
      req.on('close', () => clearInterval(t));
      return;
    }

    // 续传：第一次只发一半然后掐断连接；带 Range 再来时回 206 只发剩下的一半
    if (p === '/resume') {
      const m = /^bytes=(\d+)-/.exec(range);
      if (!m) {
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(TOTAL) });
        res.write(PAYLOAD.subarray(0, 64 * 1024 * 3));
        setTimeout(() => res.socket.destroy(), 60);
        return;
      }
      const from = Number(m[1]);
      res.writeHead(206, {
        'content-type': 'application/octet-stream',
        'content-range': `bytes ${from}-${TOTAL - 1}/${TOTAL}`,
        'content-length': String(TOTAL - from),
      });
      res.end(PAYLOAD.subarray(from));
      return;
    }

    res.writeHead(500); res.end();
  });
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-dl-test-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dest = (name) => path.join(tmpRoot, name);

(async () => {
  const srv = makeServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  const fetchImpl = (u, o) => fetch(u, o);

  // ---------- ① 404 换跳 ----------
  {
    const target = dest('a.exe');
    const r = await downloadToFile({
      candidates: [`${base}/404`, `${base}/ok`], target, fetchImpl, requirePe: true,
    });
    steps.push({ step: '① 首个镜像 404 → 自动换下一跳', detail: { ok: r.ok, via: r.via, attempts: r.attempts.length, bytes: r.bytes } });
    if (!r.ok) failures.push(`404 换跳后仍失败：${r.error}`);
    else if (r.bytes !== TOTAL) failures.push(`字节数不对：${r.bytes} ≠ ${TOTAL}`);
    if (!fs.existsSync(target)) failures.push('404 换跳成功了但目标文件不存在');
  }

  // ---------- ② 长度不符 ----------
  {
    const target = dest('b.exe');
    const r = await downloadToFile({ candidates: [`${base}/truncated`], target, fetchImpl, requirePe: true });
    const partFile = `${target}.part`;
    const partExists = fs.existsSync(partFile);
    const partIsPe = partExists ? isPeFile(partFile) : false;
    steps.push({
      step: '② content-length 对不上',
      detail: { ok: r.ok, error: r.error, part残留: partExists, part是可续传前缀: partIsPe },
    });
    if (r.ok) failures.push('长度不符竟然判成了成功 —— 会把半截 exe 拿去静默安装');
    if (fs.existsSync(target)) failures.push('长度不符却产出了目标文件');
    // 半截文件可以留（是好字节，留给下一跳续传），但绝不能是不可用的垃圾
    if (partExists && !partIsPe) failures.push('.part 留着但不是可续传的 PE 前缀 —— 续传会把垃圾接长');
  }

  // ---------- ③ HTML 错误页 ----------
  {
    const target = dest('c.exe');
    const r = await downloadToFile({ candidates: [`${base}/html`], target, fetchImpl, requirePe: true });
    steps.push({ step: '③ 200 + HTML 错误页', detail: { ok: r.ok, error: r.error, part残留: fs.existsSync(`${target}.part`) } });
    if (r.ok) failures.push('HTML 错误页被当成了安装包');
    if (fs.existsSync(`${target}.part`)) failures.push('HTML 错误页没被清掉 —— 下次续传会把它接长');
  }

  // ---------- ④ 停滞检测 ----------
  {
    const target = dest('d.exe');
    const r = await downloadToFile({
      candidates: [`${base}/stall`, `${base}/ok`], target, fetchImpl, requirePe: true, stallMs: 700,
    });
    const stalled = (r.attempts || []).find((a) => a.reason === 'stall');
    steps.push({ step: '④ 中途卡死', detail: { ok: r.ok, 第一跳被停滞中止: !!stalled, 第一跳报错: stalled && stalled.error, via: r.via } });
    if (!stalled) failures.push('卡死的连接没有被停滞检测中止');
    if (!r.ok) failures.push(`停滞换跳后应能成功，实际失败：${r.error}`);
  }

  // ---------- ⑤ 慢速但活着：核心断言 ----------
  {
    const target = dest('e.exe');
    const t0 = Date.now();
    const r = await downloadToFile({
      candidates: [`${base}/slow`], target, fetchImpl, requirePe: true, stallMs: 500, totalMs: 60000,
    });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    steps.push({ step: '⑤ 慢速但活着（每块 120ms，共约 2.4s，停滞阈值 500ms）', detail: { ok: r.ok, 耗时秒: secs, bytes: r.bytes, error: r.error } });
    if (!r.ok) failures.push(`慢速下载被误杀：${r.error} —— 这正是用户那台机器的症状`);
    else if (r.bytes !== TOTAL) failures.push(`慢速下载字节数不对：${r.bytes}`);
  }

  // ---------- ⑥ 绝对兜底可配且真的生效 ----------
  {
    const target = dest('f.exe');
    const r = await downloadToFile({ candidates: [`${base}/slow`], target, fetchImpl, totalMs: 900, stallMs: 5000 });
    steps.push({ step: '⑥ 绝对兜底（压到 0.9s 跑慢速下载）', detail: { ok: r.ok, error: r.error, reason: r.attempts && r.attempts[0] && r.attempts[0].reason } });
    if (r.ok) failures.push('绝对兜底没有生效 —— 卡住的下载会永远挂着');
    if (r.attempts && r.attempts[0] && r.attempts[0].reason !== 'total') failures.push(`兜底原因应为 total，实际 ${r.attempts[0] && r.attempts[0].reason}`);
  }

  // ---------- ⑦ 断点续传 ----------
  {
    const target = dest('g.exe');
    seen.length = 0;
    const r = await downloadToFile({
      candidates: [`${base}/resume`, `${base}/resume`], target, fetchImpl, requirePe: true, stallMs: 3000,
    });
    const ranges = seen.filter((s) => s.path === '/resume').map((s) => s.range);
    let same = false;
    try { same = fs.readFileSync(target).equals(PAYLOAD); } catch { same = false; }
    steps.push({
      step: '⑦ 断点续传',
      detail: { ok: r.ok, 请求次数: ranges.length, 各次Range: ranges, 逐字节一致: same, bytes: r.bytes, attempts: r.attempts },
    });
    if (!r.ok) failures.push(`续传后仍失败：${r.error}`);
    if (!ranges.some((x) => /^bytes=\d+-/.test(x))) failures.push('第二跳没有带 Range 头 —— 等于从头重下');
    if (!same) failures.push('续传拼出来的文件与原始字节不一致');
  }

  // ---------- ⑧ 目录不可写 → 兜底目录 ----------
  {
    // 用一个"文件"冒充目录：mkdirSync 会抛 ENOTDIR，比改 ACL 干净可靠
    const blocker = dest('blocker');
    fs.writeFileSync(blocker, 'x');
    const fallback = path.join(tmpRoot, 'fallback');
    let chosen = '';
    try { chosen = pickWritableDir(path.join(blocker, 'updates'), fallback); } catch (e) { chosen = `ERR:${e.message}`; }
    const target = path.join(chosen, 'h.exe');
    const r = chosen.startsWith('ERR:') ? { ok: false, error: chosen } : await downloadToFile({
      candidates: [`${base}/ok`], target, fetchImpl, requirePe: true,
    });
    steps.push({ step: '⑧ 主目录不可写 → 兜底目录', detail: { 实际选用: chosen, 是否兜底: chosen === fallback, ok: r.ok, error: r.error } });
    if (chosen !== fallback) failures.push(`应回退到兜底目录，实际选了 ${chosen}`);
    if (!r.ok) failures.push(`回退目录里仍下载失败：${r.error}`);
  }

  srv.close();
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }

  const report = { ok: failures.length === 0, failures, steps };
  fs.writeFileSync(RESULT, JSON.stringify(report, null, 2));
  console.log(`\n结果 → ${RESULT}`);
  for (const s of steps) console.log(`\n--- ${s.step}\n  ${JSON.stringify(s.detail)}`);
  console.log(`\n${failures.length ? '失败 ' + failures.length + ' 项：' : '全部通过'}`);
  failures.forEach((f) => console.log('  ✗ ' + f));
})();
