'use strict';
/**
 * 文件下载：镜像失败切换 + 断点续传 + 停滞检测 + 内容校验。
 *
 * 为什么单独抽成一个模块：这段逻辑的失败模式 —— 慢速网络、镜像回一个 HTML 错误页
 * 却带 200、安装根目录不可写、杀软锁住刚写完的文件 —— **只在别人的机器上才出现**。
 * 抽成纯函数模块（fetch 由调用方注入）之后，可以用本地 HTTP 服务器把这些情形
 * 一条条复现出来，见 `scripts/update-download-test.cjs`。
 *
 * 三条硬规则（旧实现三条全违反，用户看到的就是「下到 100% 报错、然后又从 0 开始，
 * 一直重复」）：
 *
 *   1. **超时只能是「停滞超时」，绝不能是「总时长超时」。**
 *      旧实现写成 `AbortSignal.timeout(120000)` —— 那是给**整个下载**压了一条 2 分钟
 *      的死线。慢速网络下大文件必然在收尾处被掐断（进度条都已经走到 100% 附近了），
 *      报错 → 换镜像 → **从 0 重新下** → 五跳全部同样在收尾处被掐断。
 *      现在只有「连续 N 秒收不到任何字节」才中止，另配一个 30 分钟的绝对兜底。
 *
 *   2. **不校验就不算成功。** content-length 对不上、文件小得离谱、或要求 PE 时
 *      文件头不是 `MZ`，一律判失败。镜像把 HTML 错误页当 200 返回是常事，
 *      这种东西绝不能流到「静默安装」那一步（那会让应用退出后再也回不来）。
 *
 *   3. **失败不删半截文件。** 下一跳带 `Range` 续传，用户不用把已经下过的几十 MB
 *      重下一遍。但**内容性失败**（HTML 页 / 长度不符）必须删掉，否则续传会从垃圾前缀接。
 */

const fs = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

/** 连续多久收不到字节就判定这条链路死了。慢速但活着的连接不会被误杀。 */
const DEFAULT_STALL_MS = 45_000;
/** 绝对兜底：再慢也不该超过这个时间，否则说明有别的东西卡住了。 */
const DEFAULT_TOTAL_MS = 30 * 60_000;
/** 小于这个体积的文件不可能是安装包。 */
const DEFAULT_MIN_BYTES = 1024;
const PROGRESS_INTERVAL_MS = 250;

/**
 * 目录可写探测。
 *
 * `mkdirSync` 成功 **不等于** 可写 —— Windows 上在 `Program Files` 里能建出目录，
 * 却写不进文件（要管理员）。所以必须真的写一个探针文件再删掉。
 */
function isWritableDir(dir) {
  if (!dir) return false;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.dsh-write-probe-${process.pid}`);
    fs.writeFileSync(probe, 'x');
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * 挑一个真的能写的下载目录。
 *
 * 旧实现的 bug：`mkdirSync` 失败时**建了**兜底目录，却忘了把 `target` 也跟着改 ——
 * 于是文件仍然往那个创建失败的目录里写，注释写着「回退系统临时目录」但代码没回退。
 * 装了 `C:\Program Files\XXX` 的用户必然踩到这条。
 */
function pickWritableDir(primary, fallback) {
  if (isWritableDir(primary)) return primary;
  if (isWritableDir(fallback)) return fallback;
  throw new Error(`下载目录不可写（已尝试 ${primary}）`);
}

/** 文件头是不是 Windows PE（`MZ`）。用来挡掉「镜像回了个 HTML 错误页」。 */
function isPeBuffer(buf) {
  return buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a;
}

/** 读前 2 字节判 PE。文件不存在 / 读不动都算 false。 */
function isPeFile(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(2);
      const n = fs.readSync(fd, buf, 0, 2, 0);
      return n === 2 && isPeBuffer(buf);
    } finally { fs.closeSync(fd); }
  } catch { return false; }
}

/**
 * 已落盘的那半截文件能不能当**续传前缀**用。
 *
 * 判据只有一条：文件头和我们要的东西对得上（要 exe 时必须 `MZ`）。
 * 对不上就说明这条链路回的根本不是目标文件（返回 HTML 错误页最常见），
 * 续传只会把垃圾接长，必须删。
 *
 * 注意判据**不是**「流有没有走完」：服务端提前收尾（`terminated`）时流是异常结束的，
 * 但已经落盘的那些字节往往是好字节，删掉等于让用户白下一遍 —— 这正是慢网用户
 * 最不愿意看到的事。
 */
function isUsablePrefix(part, requirePe) {
  try {
    if (fs.statSync(part).size <= 0) return false;
    return requirePe ? isPeFile(part) : true;
  } catch { return false; }
}

/**
 * 把 fetch 返回的响应体变成 Node 可读流。
 *
 * 为什么不能直接用 `Readable.fromWeb`：它要求 body 是**Node 自己那个** web stream
 * 实现，而 Electron 主进程的 `net.fetch` 返回的是 Chromium 侧的 ReadableStream ——
 * 类型对不上时会抛 `ERR_INVALID_ARG_TYPE`，而且是在「已经下完一半」的时候才炸。
 * 旧实现手工 `getReader()` 循环所以不受影响，换成 `pipeline` 后必须补这层适配。
 * 兜底用异步生成器：逐块拉取，背压语义与 fromWeb 一致，对任何 ReadableStream 都成立。
 */
function toNodeReadable(body) {
  if (!body) throw new Error('响应没有 body');
  if (typeof Readable.fromWeb === 'function') {
    try { return Readable.fromWeb(body); } catch { /* 不是 Node 的 web stream，走下面 */ }
  }
  const reader = body.getReader();
  return Readable.from((async function* () {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield Buffer.isBuffer(value) ? value : Buffer.from(value);
    }
  })());
}

/**
 * 下载到文件。
 *
 * @param {object} o
 * @param {string[]} o.candidates   候选 URL（镜像在前、官方直链在后）
 * @param {string}  o.target        最终落盘路径（成功后由 `.part` 改名而来）
 * @param {Function} o.fetchImpl    注入的 fetch（主进程传 Electron 的 net.fetch）
 * @param {(p:object)=>void} [o.onProgress]
 * @param {(kind:string,line:string)=>void} [o.log]
 * @param {number} [o.stallMs]      停滞超时
 * @param {number} [o.totalMs]      绝对兜底
 * @param {number} [o.minBytes]     最小体积
 * @param {boolean} [o.requirePe]   是否要求 PE 文件头（下载 .exe 时为 true）
 * @param {object} [o.headers]      额外请求头
 * @returns {Promise<{ok:boolean, path?:string, bytes?:number, via?:string,
 *                    attempts:Array<{via:string,error:string}>, error?:string}>}
 */
async function downloadToFile({
  candidates, target, fetchImpl, onProgress, log,
  stallMs = DEFAULT_STALL_MS, totalMs = DEFAULT_TOTAL_MS, minBytes = DEFAULT_MIN_BYTES,
  requirePe = false, headers: extraHeaders,
}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { ok: false, error: '没有可用的下载地址', attempts: [] };
  }
  if (typeof fetchImpl !== 'function') {
    return { ok: false, error: '缺少 fetch 实现', attempts: [] };
  }

  const part = `${target}.part`;
  const attempts = [];

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    const via = candidates.length > 1 ? `镜像 ${i + 1}/${candidates.length}` : '直连';

    // 上次留下的半截文件 = 续传起点。内容性失败时会被删掉，所以留下的都是真前缀。
    let have = 0;
    try { have = fs.statSync(part).size; } catch { have = 0; }

    const ac = new AbortController();
    let stallTimer = null;
    let totalTimer = null;
    let timedOutBy = '';
    const armStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        timedOutBy = 'stall';
        ac.abort(new Error(`连续 ${Math.round(stallMs / 1000)} 秒没有收到数据`));
      }, stallMs);
    };
    totalTimer = setTimeout(() => {
      timedOutBy = 'total';
      ac.abort(new Error(`下载超过 ${Math.round(totalMs / 60000)} 分钟上限`));
    }, totalMs);

    let base = have;
    let total = 0;
    let wrote = 0;
    let lastAt = Date.now();
    let lastBytes = have;
    let startedAt = Date.now();
    // 失败分两类，处置完全相反：
    //   · pipeline 抛（网络断 / 写盘失败）→ 已落盘的是**真前缀**，留给下一跳续传
    //   · pipeline 正常结束但内容不对（长度不符 / 非 PE）→ 落盘的是**垃圾**，必须删
    // 所以不能靠错误文案去猜，得记住"流到底走完没有"。
    let streamOk = false;

    try {
      const reqHeaders = { 'User-Agent': 'dsh-desktop', ...(extraHeaders || {}) };
      if (have > 0) reqHeaders.Range = `bytes=${have}-`;
      log?.('stdout', `[下载] ${via} 开始${have > 0 ? `（续传自 ${(have / 1048576).toFixed(1)} MB）` : ''}`);
      onProgress?.({ received: have, total: 0, pct: 0, phase: 'downloading', via, speed: 0 });

      armStall();
      const res = await fetchImpl(cand, { headers: reqHeaders, signal: ac.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // 206 = 服务端接受了 Range；200 = 不支持 Range，只能从头来。
      if (res.status === 206) {
        base = have;
        const m = /\/(\d+)\s*$/.exec(res.headers.get('content-range') || '');
        total = m ? Number(m[1]) : base + (Number(res.headers.get('content-length')) || 0);
      } else {
        base = 0;
        total = Number(res.headers.get('content-length')) || 0;
      }

      const ws = fs.createWriteStream(part, { flags: base > 0 ? 'a' : 'w' });
      const counter = new Transform({
        transform(chunk, _enc, cb) {
          wrote += chunk.length;
          armStall(); // 有数据进来就重置停滞计时
          const now = Date.now();
          if (now - lastAt >= PROGRESS_INTERVAL_MS) {
            const dt = (now - lastAt) / 1000;
            onProgress?.({
              received: base + wrote,
              total,
              pct: total ? Math.min(100, Math.round(((base + wrote) / total) * 100)) : 0,
              phase: 'downloading',
              via,
              speed: dt > 0 ? ((wrote - lastBytes) / 1048576) / dt : 0,
            });
            lastAt = now;
            lastBytes = wrote;
          }
          cb(null, chunk);
        },
      });
      await pipeline(toNodeReadable(res.body), counter, ws);
      streamOk = true;

      const size = fs.statSync(part).size;
      if (total > 0 && size !== total) throw new Error(`下载不完整：${size}/${total} 字节`);
      if (size < minBytes) throw new Error(`文件过小（${size} 字节），不像是安装包`);
      if (requirePe && !isPeFile(part)) throw new Error('文件头不是 MZ，不是 Windows 可执行文件（镜像可能返回了错误页）');

      fs.rmSync(target, { force: true });
      fs.renameSync(part, target);
      const secs = Math.max(0.001, (Date.now() - startedAt) / 1000);
      onProgress?.({
        received: size, total: size, pct: 100, phase: 'done', via,
        speed: (size / 1048576) / secs,
      });
      log?.('stdout', `[下载] 完成 ${path.basename(target)}（${(size / 1048576).toFixed(1)} MB · ${via}）`);
      return { ok: true, path: target, bytes: size, via, attempts };
    } catch (err) {
      const msg = ac.signal.aborted
        ? String((ac.signal.reason && ac.signal.reason.message) || '已中止')
        : ((err && err.message) || String(err));
      attempts.push({ via, error: msg, reason: timedOutBy || (streamOk ? 'content' : 'stream'), bytes: base + wrote });
      log?.('stderr', `[下载] ${via} 失败：${msg}`);

      // 失败后决定这半截文件留不留：能当续传前缀就留，是垃圾就删。
      if (!isUsablePrefix(part, requirePe)) {
        try { fs.rmSync(part, { force: true }); } catch { /* 杀软锁住就留着，下次 'w' 会覆盖 */ }
      }
      // 换下一跳时**不要把进度归零**：那正是用户抱怨的「下到 100% 突然归零、一直重复」。
      // 把这一跳跑到哪了如实带出去，界面才能说清「哪一跳断了、断在几 %」。
      onProgress?.({
        received: base + wrote,
        total,
        pct: total ? Math.min(100, Math.round(((base + wrote) / total) * 100)) : 0,
        phase: 'retry', via, speed: 0,
      });
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
      if (totalTimer) clearTimeout(totalTimer);
    }
  }

  const last = attempts[attempts.length - 1];
  // 失败信息要能指导用户下一步动作，所以把"最接近成功的那一跳下到哪了"带上 ——
  // 用户看到"已经下到 68 MB，可稍后重试，下次会接着下"才不会以为白等了半天。
  const best = attempts.reduce((a, b) => (b.bytes > (a ? a.bytes : -1) ? b : a), null);
  let error = attempts.length ? `全部 ${attempts.length} 个下载源都失败` : '没有可用的下载地址';
  if (last) error += `（最后一次：${last.error}）`;
  if (best && best.bytes > 1048576) {
    error += `。最接近成功的一次已下到 ${(best.bytes / 1048576).toFixed(1)} MB`
      + '，稍后重试会接着已下载的部分继续，不必从头再来';
  }
  return { ok: false, attempts, error };
}

module.exports = {
  downloadToFile,
  pickWritableDir,
  isWritableDir,
  isPeFile,
  isPeBuffer,
  toNodeReadable,
  DEFAULT_STALL_MS,
  DEFAULT_TOTAL_MS,
  DEFAULT_MIN_BYTES,
};
