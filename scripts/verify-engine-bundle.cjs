/* P0 验证：从**离线引擎包**启动引擎（不依赖 D:\DSH\harness 原目录）
   用法: node scripts/verify-engine-bundle.cjs [port]
   前置: dist\engine\harness 已由 build-engine-bundle.ps1 产出（或从 engine.zip 展开）*/
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const PORT = Number(process.argv[2] || 3099);
const ENGINE = process.env.ENGINE_DIR || 'D:/DS_harness/dist/engine/harness';
const NODE = process.env.DSH_NODE_EXE || 'node';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(u) {
  return new Promise((res, rej) => {
    const req = http.get(u, { headers: { 'content-type': 'application/json' } }, (r) => {
      let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    });
    req.on('error', rej);
    req.setTimeout(6000, () => { req.destroy(new Error('timeout')); });
  });
}

(async () => {
  // 两种布局都支持：源码/平铺形态（apps/cli/lib/bin.js）与 **npm 形态**（node_modules/@deepseek-ai/dsh/lib/bin.js）
  const fs = require('node:fs');
  let bin = path.join(ENGINE, 'apps', 'cli', 'lib', 'bin.js');
  let cwd = ENGINE;
  let form = 'source';
  if (!fs.existsSync(bin)) {
    const npmDir = path.join(ENGINE, 'node_modules', '@deepseek-ai', 'dsh');
    const npmBin = path.join(npmDir, 'lib', 'bin.js');
    if (fs.existsSync(npmBin)) { bin = npmBin; cwd = npmDir; form = 'npm'; }
  }
  if (!fs.existsSync(bin)) { console.log('FAIL: 找不到引擎入口（source/npm 两种形态都试过）'); process.exit(1); }
  console.log(`启动引擎（${form} 形态）:`, NODE, bin, 'web --port', PORT, '--no-open');
  const child = spawn(NODE, [bin, 'web', '--port', String(PORT), '--no-open'], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let lastLine = '';
  child.stdout.on('data', (d) => { lastLine = d.toString().trim().split(/\r?\n/).pop(); });
  child.stderr.on('data', (d) => { lastLine = d.toString().trim().split(/\r?\n/).pop(); });
  let up = false;
  for (let i = 0; i < 30 && !up; i++) {
    await sleep(2000);
    try { up = (await getJson(`http://127.0.0.1:${PORT}/api/host.describe`)).ok; } catch { /* 等 */ }
    if (i % 3 === 2) console.log(`  …${(i + 1) * 2}s  last: ${lastLine.slice(0, 90)}`);
  }
  console.log(up ? `PASS: 离线引擎包在 :${PORT} 正常就绪（自包含验证通过）` : 'FAIL: 引擎未在 60 秒内就绪（last: ' + lastLine.slice(0, 160) + '）');
  try { child.kill(); } catch {}
  await sleep(500);
  process.exit(up ? 0 : 1);
})();
