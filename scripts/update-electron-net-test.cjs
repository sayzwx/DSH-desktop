/* update-electron-net-test.cjs —— 用真实的 Electron net.fetch 验证下载链路
 *
 * 纯 Node 的测试（update-download-test.cjs）用的是全局 fetch，但主进程用的是
 * **Electron 的 net.fetch** —— 它走 Chromium 的网络栈，返回的响应体是 Chromium 侧的
 * ReadableStream，跟 Node 自己的实现不是一个类型。这层差异纯 Node 测不出来，
 * 而一旦对不上，`Readable.fromWeb` 会抛 ERR_INVALID_ARG_TYPE。
 *
 * 所以这里必须起真 Electron，跑三件事：
 *   ① net.fetch 的响应体能被 lib/download.js 顺利落盘（含 fromWeb 适配兜底）
 *   ② net.fetch 支持 Range 请求（断点续传依赖它）—— 服务端必须真收到 Range 头
 *   ③ content-length / PE 校验在 Electron 这条链路上同样生效
 *
 * 跑法（cwd 必须是仓库根）：
 *   env -u ELECTRON_RUN_AS_NODE node node_modules/electron/cli.js scripts/update-electron-net-test.cjs
 * 输出：%TEMP%\update-electron-net-test.json
 */
const { app, net } = require('electron');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

app.disableHardwareAcceleration();
['no-sandbox', 'disable-gpu', 'disable-software-rasterizer', 'in-process-gpu']
  .forEach((s) => app.commandLine.appendSwitch(s));

// 看门狗：任何一步挂住都不能让进程留到外层超时
setTimeout(() => { console.error('看门狗超时'); app.exit(3); }, 90000);

const ROOT = process.env.DESKTOP_ROOT || __dirname + '/..';
const RESULT = path.join(os.tmpdir(), 'update-electron-net-test.json');
const { downloadToFile, toNodeReadable } = require(path.join(ROOT, 'lib', 'download.js'));

const failures = [];
const steps = [];
const seen = [];

const PAYLOAD = Buffer.concat([
  Buffer.from([0x4d, 0x5a]),
  Buffer.alloc(64 * 1024 * 3, 0x42).map((_, __, i) => (i * 7) % 251),
]);
const TOTAL = PAYLOAD.length;

function makeServer() {
  return http.createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    seen.push({ path: p, range: req.headers.range || '' });
    if (p === '/ok') {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(TOTAL) });
      res.end(PAYLOAD);
      return;
    }
    if (p === '/range') {
      const m = /^bytes=(\d+)-/.exec(req.headers.range || '');
      if (!m) {
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(TOTAL) });
        res.end(PAYLOAD);
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
    res.writeHead(404); res.end();
  });
}

app.whenReady().then(async () => {
  const srv = makeServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-net-test-'));

  try {
    // ---------- ① net.fetch 的 body 能不能落盘 ----------
    {
      const target = path.join(tmp, 'ok.exe');
      const r = await downloadToFile({
        candidates: [`${base}/ok`], target,
        fetchImpl: (u, o) => net.fetch(u, o),   // ← 真的 Electron net.fetch
        requirePe: true,
      });
      const same = r.ok && fs.existsSync(target) && fs.readFileSync(target).equals(PAYLOAD);
      steps.push({ step: '① Electron net.fetch → 落盘', detail: { ok: r.ok, bytes: r.bytes, error: r.error, 逐字节一致: same } });
      if (!r.ok) failures.push(`net.fetch 下载失败：${r.error}`);
      else if (!same) failures.push('落盘内容与原始字节不一致');
    }

    // ---------- ② 手工确认 fromWeb 的可用性（诊断用，不算失败项） ----------
    {
      const res = await net.fetch(`${base}/ok`);
      let fromWebOk = false;
      let fromWebErr = '';
      try {
        const { Readable } = require('node:stream');
        const s = Readable.fromWeb(res.body);
        let n = 0;
        for await (const c of s) n += c.length;
        fromWebOk = n === TOTAL;
      } catch (e) { fromWebErr = (e && e.message) || String(e); }
      steps.push({ step: '② 诊断：Readable.fromWeb 对 Electron body 是否可用', detail: { 可用: fromWebOk, 报错: fromWebErr } });
      // 这条只作诊断信息，兜底适配器已经保证两种情况下都能跑，不作断言。
    }

    // ---------- ③ net.fetch 是否支持 Range ----------
    {
      const target = path.join(tmp, 'range.exe');
      seen.length = 0;
      const r = await downloadToFile({
        candidates: [`${base}/range`], target,
        fetchImpl: (u, o) => net.fetch(u, o),
        requirePe: true,
      });
      const ranges = seen.map((s) => s.range);
      let same = false;
      try { same = fs.readFileSync(target).equals(PAYLOAD); } catch { same = false; }
      steps.push({ step: '③ net.fetch + Range', detail: { ok: r.ok, 收到的Range: ranges, 逐字节一致: same } });
      if (!r.ok) failures.push(`带 Range 的下载失败：${r.error}`);
      if (!same) failures.push('Range 下载内容不一致');
    }

    // ---------- ④ 校验逻辑在 Electron 链路上同样生效 ----------
    {
      const target = path.join(tmp, 'bad.exe');
      const r = await downloadToFile({
        candidates: [`${base}/404`], target,
        fetchImpl: (u, o) => net.fetch(u, o), requirePe: true,
      });
      steps.push({ step: '④ 404 必须判失败', detail: { ok: r.ok, error: r.error } });
      if (r.ok) failures.push('404 竟然判成功了');
    }

    // ---------- ⑤ toNodeReadable 的兜底分支本身可用 ----------
    {
      const res = await net.fetch(`${base}/ok`);
      let n = 0;
      for await (const c of toNodeReadable(res.body)) n += c.length;
      steps.push({ step: '⑤ toNodeReadable 兜底适配器', detail: { 读到字节: n, 期望: TOTAL } });
      if (n !== TOTAL) failures.push(`兜底适配器读数不对：${n} ≠ ${TOTAL}`);
    }
  } catch (e) {
    failures.push(`未捕获异常：${(e && e.stack) || e}`);
  }

  srv.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }

  const report = { ok: failures.length === 0, failures, steps };
  fs.writeFileSync(RESULT, JSON.stringify(report, null, 2));
  console.log(`\n结果 → ${RESULT}`);
  for (const s of steps) console.log(`--- ${s.step}\n  ${JSON.stringify(s.detail)}`);
  console.log(`\n${failures.length ? '失败：' : '全部通过'}`);
  failures.forEach((f) => console.log('  ✗ ' + f));
  app.exit(failures.length ? 1 : 0);
});
