// 独立验证引擎探测 + 完整性检测逻辑（与 main.js 实现一致）
// 用法: node scripts/test-engine-detect.cjs
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// 模拟打包形态 DSH_ROOT（实际由 detectDSHRoot 推导，这里用环境变量模拟）
const DSH_ROOT = process.env.DSH_ROOT || path.join(process.env.LOCALAPPDATA || '', 'DSH');

function commonEngineCandidatePaths() {
  const out = [];
  try {
    if (DSH_ROOT) out.push(path.join(DSH_ROOT, 'harness'));
    out.push(path.join(__dirname, '..', 'harness'));
  } catch {}
  return out;
}

function checkHarnessIntegrity(dir, kind) {
  const missing = [];
  const keyPkgs = ['dsh-app-boot', 'cordis-plugin-loader'];
  if (kind === 'source' && !fs.existsSync(path.join(dir, 'apps', 'web', 'dist', 'index.html'))) {
    missing.push('web 前端 dist 缺失');
  }
  const scopes = kind === 'dist'
    ? [
        path.join(dir, 'node_modules', '@deepseek-ai'),
        path.join(dir, '..', '@deepseek-ai'),
        path.join(dir, '..', '..', '@deepseek-ai'),
      ]
    : [
        path.join(dir, 'node_modules', '@deepseek-ai'),
        path.join(dir, 'apps', 'cli', 'node_modules', '@deepseek-ai'),
        path.join(dir, 'apps', 'web', 'node_modules', '@deepseek-ai'),
      ];
  let hitScope = false;
  for (const scope of scopes) {
    if (!fs.existsSync(scope)) continue;
    hitScope = true;
    for (const pkg of keyPkgs) {
      const p = path.join(scope, pkg);
      if (!fs.existsSync(p)) { missing.push(`${pkg} 未安装`); continue; }
      let n = 0;
      try { n = fs.readdirSync(p).length; } catch { n = 0; }
      if (n === 0) missing.push(`${pkg} 为空目录`);
    }
    break;
  }
  if (!hitScope) missing.push('未找到 @deepseek-ai 依赖目录');
  return { ok: missing.length === 0, missing };
}

function inspect(dir, label) {
  const srcBin = path.join(dir, 'apps', 'cli', 'lib', 'bin.js');
  const distBin = path.join(dir, 'lib', 'bin.js');
  if (fs.existsSync(srcBin)) {
    const chk = checkHarnessIntegrity(dir, 'source');
    console.log(`${label}: 源码形态 -> ${chk.ok ? '完整 ✓' : 'BROKEN ✗ (' + chk.missing.join('; ') + ')'}`);
    return;
  }
  if (fs.existsSync(distBin)) {
    const chk = checkHarnessIntegrity(dir, 'dist');
    console.log(`${label}: 发行包形态 dir=${dir} -> ${chk.ok ? '完整 ✓' : 'BROKEN ✗ (' + chk.missing.join('; ') + ')'}`);
    return;
  }
  console.log(`${label}: 无引擎 ${dir}`);
}

console.log('=== 1. npm 全局安装的 dsh（依赖应被识别为完整——hoist 到 node_modules 根）===');
const npmGlobal = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh');
inspect(npmGlobal, 'npm 全局 dsh');

console.log('\n=== 2. npx 缓存 rc.7 ===');
const npx = path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx', '1e7f6d9597241db0', 'node_modules', '@deepseek-ai', 'dsh');
inspect(npx, 'npx rc.7');

console.log('\n=== 3. D:\\DeepSeek-Harness（残骸，应判为损坏）===');
inspect('D:\\DeepSeek-Harness', 'D盘残骸');

console.log('\n=== 4. 候选路径（不绑定本地路径）===');
for (const p of commonEngineCandidatePaths()) {
  console.log(`  候选: ${p}`);
}
console.log('（扫描完成，仅含安装根同级 + app 同级，不扫盘符根/用户目录）');
