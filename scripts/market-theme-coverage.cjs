/**
 * 主题迁移**覆盖率审计**：把市场里主题类插件全部拉下来，逐个跑我们的扫描管线，
 * 统计「能识别 / 不能识别」及识别途径。用来回答"能不能迁移绝大部分"这种只能靠全量数据的问题。
 *
 * 数据源：https://awesome-dsh-plugin.com/plugins.json（市场目录）
 *   主题大多不在 npm 上，而是 GitHub 仓库（目录条目里的 install 字段写着 github:owner/repo）。
 *   还有 monorepo 形态：install 写 `github:owner/repo#path:/skin` —— 真插件在子目录，
 *   pnpm 装完 node_modules 里就是子目录内容，所以审计要如实模拟。
 *
 * 用法: node scripts/market-theme-coverage.cjs [--limit N] [--refresh]
 *   GH_TOKEN 可选（有则走 api.github.com tarball，无则退回 codeload + 猜分支）
 * 产物: dist/market-scan/coverage.json（明细）+ dist/market-scan/tgz/（缓存，可复用）
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const WORK = path.join(ROOT, 'dist', 'market-scan');
const CATALOG = path.join(WORK, 'plugins.json');
const MODULES = path.join(WORK, 'web-profile', 'profiles', 'web', 'node_modules');
const TGZ_DIR = path.join(WORK, 'tgz');
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i > 0 ? Number(process.argv[i + 1]) : 0; })();
const REFRESH = process.argv.includes('--refresh');
const PER_PKG_CAP = 150 * 1024 * 1024;   // 大包往往是带完整壁纸的真皮肤，别一刀切掉
const TOTAL_CAP = 2600 * 1024 * 1024;
const CONCURRENCY = 8;

const {
  scanThemePlugins, detectPageBackground, readPluginClientSource, buildMigration, buildSkinMigration,
} = require(path.join(ROOT, 'lib', 'web-themes.js'));

// ---------------------------------------------------------------- 极简 tar 解包
// 自己写的原因：沙箱里 spawn tar.exe 会 EBUSY，spawnSync 外部进程也不稳，只依赖 zlib 最可靠。
function extractTarGz(buf, destDir) {
  const tar = zlib.gunzipSync(buf);
  let off = 0;
  let files = 0;
  while (off + 512 <= tar.length) {
    const name = tar.toString('utf8', off, off + 100).replace(/\0.*$/, '');
    if (!name) { off += 512; continue; }
    const size = parseInt(tar.toString('utf8', off + 124, off + 136).replace(/\0.*$/, '').trim(), 8) || 0;
    const type = String.fromCharCode(tar[off + 156] || 48);
    const prefix = tar.toString('utf8', off + 345, off + 500).replace(/\0.*$/, '');
    const full = prefix ? `${prefix}/${name}` : name;
    const dataStart = off + 512;
    const parts = full.split('/');
    const rel = parts.length > 1 ? parts.slice(1).join('/') : '';   // 去掉顶层目录
    if (rel) {
      const target = path.join(destDir, rel);
      if (target.startsWith(destDir)) {
        if (type === '5' || full.endsWith('/')) {
          fs.mkdirSync(target, { recursive: true });
        } else if (type === '0' || type === '\0' || type === ' ') {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, tar.subarray(dataStart, dataStart + size));
          files++;
        }
      }
    }
    off = dataStart + Math.ceil(size / 512) * 512;
  }
  return { files };
}

// ---------------------------------------------------------------- 数据源
async function fetchBuf(url, headers = {}) {
  const r = await fetch(url, { headers: { 'user-agent': 'dsh-theme-coverage', ...headers }, redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/** 从目录条目解析 GitHub owner/repo 与可选的子目录（#path:/sub） */
function targetOf(p) {
  const src = `${p.install || ''} ${p.url || ''} ${p.page || ''}`;
  const m = /github(?:\.com)?[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/.exec(src);
  if (!m) return null;
  const repo = `${m[1]}/${m[2].replace(/\.git$/, '').replace(/#.*$/, '')}`;
  // 子目录形态实测有三种：`#path:/skin`、`#skin`、`#packages/dsh-web-all`
  const inst = p.install || '';
  const sm = /#(?:path:?)?\/?([A-Za-z0-9_.@/-]+)/.exec(inst.split(repo)[1] || '');
  let sub = sm ? sm[1].replace(/^\/+|\/+$/g, '') : '';
  if (/^dsh$/i.test(sub)) sub = '';   // 形如 `github:o/r#dsh` 是仓库内目录名，保留
  return { repo, sub };
}

async function downloadOne(t, token) {
  // npm 优先：市场里不少条目是「monorepo 仓库 + 已发布的 scoped 包」（install 写的是包名，
  // 不是 GitHub 子目录）。这类走 npm registry 最准，也最接近用户 pnpm 装出来的结果。
  if (t.npmName) {
    const enc = t.npmName.replace('/', '%2f');
    const cache = path.join(TGZ_DIR, `npm__${t.npmName.replace(/[@/]/g, '_')}.tgz`);
    if (!REFRESH && fs.existsSync(cache) && fs.statSync(cache).size > 1000) {
      return { buf: fs.readFileSync(cache), cached: true };
    }
    const meta = JSON.parse((await fetchBuf(`https://registry.npmjs.org/${enc}`)).toString('utf8'));
    const ver = meta['dist-tags'] && meta['dist-tags'].latest;
    const v = ver && meta.versions && meta.versions[ver];
    if (!v || !v.dist || !v.dist.tarball) throw new Error('npm 上没有可用的 tarball');
    let buf = await fetchBuf(v.dist.tarball);
    if (buf.length > PER_PKG_CAP) throw new Error(`包过大 ${(buf.length / 1024 / 1024).toFixed(1)}MB`);
    fs.mkdirSync(TGZ_DIR, { recursive: true });
    fs.writeFileSync(cache, buf);
    return { buf, cached: false, version: ver, tarball: v.dist.tarball };
  }
  const hdr = token ? { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' } : {};
  const cache = path.join(TGZ_DIR, t.repo.replace(/\//g, '__') + '.tgz');
  if (!REFRESH && fs.existsSync(cache) && fs.statSync(cache).size > 1000) {
    return { buf: fs.readFileSync(cache), cached: true };
  }
  let buf = null;
  let lastErr = null;
  try {
    buf = await fetchBuf(`https://api.github.com/repos/${t.repo}/tarball`, hdr);
  } catch (e) {
    lastErr = e;
    for (const br of ['main', 'master', 'HEAD']) {
      try { buf = await fetchBuf(`https://codeload.github.com/${t.repo}/tar.gz/${br}`); lastErr = null; break; } catch (e2) { lastErr = e2; }
    }
  }
  if (lastErr) throw lastErr;
  if (buf.length > PER_PKG_CAP) throw new Error(`包过大 ${(buf.length / 1024 / 1024).toFixed(1)}MB`);
  fs.mkdirSync(TGZ_DIR, { recursive: true });
  fs.writeFileSync(cache, buf);
  return { buf, cached: false };
}

/** 读解出来的 package.json（拿真实包名，作为扫描结果 id） */
function pkgNameOf(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name || ''; } catch { return ''; }
}

async function run() {
  fs.mkdirSync(WORK, { recursive: true });
  if (!fs.existsSync(CATALOG) || REFRESH) {
    fs.writeFileSync(CATALOG, await fetchBuf('https://awesome-dsh-plugin.com/plugins.json'));
  }
  const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  const themes = catalog.plugins.filter((p) => p.category === 'theme');
  const kw = /(theme|skin|wallpaper|主题|皮肤|壁纸|外观|配色|brand)/i;
  const others = catalog.plugins.filter((p) => p.category !== 'theme'
    && kw.test(`${p.name} ${JSON.stringify(p.description || '')}`));
  console.log(`目录：theme 分类 ${themes.length} 个；其它分类里像主题的 ${others.length} 个`);
  const all = themes.concat(others);
  const list = LIMIT ? all.slice(0, LIMIT) : all;

  fs.mkdirSync(MODULES, { recursive: true });
  const token = process.env.GH_TOKEN || '';
  const cacheExists = fs.existsSync(TGZ_DIR) && fs.readdirSync(TGZ_DIR).length > 0;
  console.log(`拉取 ${list.length} 个仓库（token ${token ? '有' : '无'}，并发 ${CONCURRENCY}，tarball 缓存 ${cacheExists ? '有' : '无'}）`);
  const results = [];
  let total = 0;
  let done = 0;
  let cachedCount = 0;
  const queue = [...list];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const p = queue.shift();
      const row = { name: p.name, owner: p.owner, category: p.category, status: '', reason: '' };
      try {
        if (total > TOTAL_CAP) { row.status = 'skip-budget'; results.push(row); continue; }
        // 取包策略：有 npm 包名就走 npm（市场里大量条目是「monorepo + 已发布 scoped 包」），否则 GitHub
        const t = p.npm ? { npmName: p.npm, repo: '', sub: '' } : targetOf(p);
        if (!t) { row.status = 'error'; row.reason = '目录里既没有 npm 包名，也没有 GitHub 仓库地址'; results.push(row); continue; }
        if (t.repo) row.repo = t.repo;
        if (t.npmName) row.npmName = t.npmName;
        if (t.sub) row.sub = t.sub;
        const { buf, cached } = await downloadOne(t, token);
        total += buf.length;
        if (cached) cachedCount++;
        row.bytes = buf.length;
        // 安装位置要跟 pnpm 一致：npm 用包名（scoped 要嵌套目录），GitHub 用仓库名
        const dirName = t.npmName ? t.npmName : t.repo.split('/')[1];
        const dest = path.join(MODULES, ...dirName.split('/'));
        fs.rmSync(dest, { recursive: true, force: true });
        fs.mkdirSync(dest, { recursive: true });
        const { files } = extractTarGz(buf, dest);
        // monorepo：把子目录提升为包根（模拟 pnpm 装 github:o/r#path:/sub 的结果）
        if (t.sub) {
          const subdir = path.join(dest, ...t.sub.split('/'));
          if (fs.existsSync(subdir)) {
            const tmp = `${dest}__sub`;
            fs.rmSync(tmp, { recursive: true, force: true });
            fs.renameSync(subdir, tmp);
            fs.rmSync(dest, { recursive: true, force: true });
            fs.renameSync(tmp, dest);
          } else {
            row.subMissing = t.sub;
          }
        }
        row.files = files;
        row.pkgName = pkgNameOf(dest);
        row.status = files > 0 ? 'ok' : 'empty';
      } catch (e) {
        row.status = 'error';
        row.reason = String((e && e.message) || e).slice(0, 100);
      }
      results.push(row);
      done++;
      if (done % 25 === 0) console.log(`  …${done}/${list.length}（新下载 ${(total / 1024 / 1024).toFixed(0)}MB，缓存命中 ${cachedCount}）`);
    }
  }));
  console.log(`拉取完成：${(total / 1024 / 1024).toFixed(0)}MB，缓存命中 ${cachedCount}`);

  // ---------------------------------------------------------------- 跑扫描
  const stylesCss = fs.readFileSync(path.join(ROOT, 'renderer', 'styles.css'), 'utf8');
  const scan = scanThemePlugins({ dshHome: path.join(WORK, 'web-profile'), stylesCss });
  const detected = new Map((scan.plugins || []).map((p) => [p.id, p]));
  const skipped = new Map((scan.skipped || []).map((s) => [s.id, s.reason]));
  const byDir = new Map((scan.plugins || []).map((p) => [path.basename(p.dir), p]));
  const skippedByDir = new Map((scan.skipped || []).map((s) => [String(s.id).split('/').pop(), s.reason]));

  for (const r of results) {
    if (r.status !== 'ok') { r.verdict = 'download-failed'; continue; }
    const dirName = r.npmName ? r.npmName.split('/').pop() : (r.repo || '').split('/')[1] || '';
    const plugin = detected.get(r.npmName) || detected.get(r.pkgName) || detected.get(r.name) || byDir.get(dirName);
    if (!plugin) {
      r.verdict = 'not-detected';
      r.reason = skipped.get(r.pkgName) || skipped.get(r.name) || skippedByDir.get(dirName) || '未出现在扫描结果里';
      continue;
    }
    r.id = plugin.id;
    r.verdict = plugin.kind === 'skin' ? 'detected-skin'
      : plugin.kind === 'generic' ? 'detected-generic' : 'detected-token';
    r.how = plugin.source;
    r.schemes = plugin.schemes.length;
    r.tokens = plugin.schemes.reduce((n, s) => n + (s.tokenCount || 0), 0);
    r.entry = plugin.clientEntry || '';
    try { r.hasBg = !!detectPageBackground(readPluginClientSource(plugin.dir).src, plugin.dir); } catch { r.hasBg = false; }
    // 能否真的产出迁移产物（三条路各试一次）
    try {
      const sch = plugin.schemes[0];
      const m = (plugin.kind === 'skin' || plugin.kind === 'generic')
        ? buildSkinMigration({ plugin, tone: 'dark', stylesCss })
        : buildMigration({ plugin, schemeId: sch.id, tone: (sch.tones[0] || 'dark'), stylesCss });
      r.migratable = !!(m && m.id);
      r.migrationCss = m && m.css ? m.css.length : 0;
    } catch (e) {
      r.migratable = false;
      r.migErr = String((e && e.message) || e).slice(0, 80);
    }
  }

  const byVerdict = {};
  for (const r of results) byVerdict[r.verdict] = (byVerdict[r.verdict] || 0) + 1;
  const okRows = results.filter((r) => r.status === 'ok');
  const ok = okRows.filter((r) => r.verdict.startsWith('detected')).length;
  const migratable = okRows.filter((r) => r.migratable).length;

  console.log('');
  console.log('================ 覆盖率 ================');
  console.log(`拉取成功 ${okRows.length} / ${results.length}`);
  console.log(`识别成功 ${ok} / ${okRows.length}${okRows.length ? `（${(ok / okRows.length * 100).toFixed(1)}%）` : ''}`);
  console.log(`能实际产出迁移 ${migratable} / ${okRows.length}${okRows.length ? `（${(migratable / okRows.length * 100).toFixed(1)}%）` : ''}`);
  console.log('明细:', JSON.stringify(byVerdict, null, 1));
  console.log(`其中检出页面级背景图（免费承接壁纸）: ${okRows.filter((r) => r.hasBg).length} 个`);

  const notDetected = results.filter((r) => r.verdict === 'not-detected');
  if (notDetected.length) {
    console.log('');
    console.log('---- 未识别（按理由归类）----');
    const byReason = {};
    for (const r of notDetected) {
      const key = String(r.reason).replace(/：.*$/, '').slice(0, 70);
      (byReason[key] || (byReason[key] = [])).push(r.name);
    }
    for (const [reason, names] of Object.entries(byReason).sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  [${names.length}] ${reason}`);
      console.log('       例:', names.slice(0, 6).join(', '));
      console.log('       仓库:', notDetected.filter((x) => names.includes(x.name)).slice(0, 6).map((x) => x.repo || '-').join(', '));
    }
  }
  const errs = results.filter((r) => r.status === 'error');
  if (errs.length) {
    console.log('');
    console.log(`拉取失败 ${errs.length} 个，例:`);
    for (const r of errs.slice(0, 8)) console.log(`  ${r.name}（${r.repo || '-'}）: ${r.reason}`);
  }

  fs.writeFileSync(path.join(WORK, 'coverage.json'), JSON.stringify({ results, byVerdict, ok, okRows: okRows.length, migratable }, null, 2));
  console.log('');
  console.log('明细已写 dist/market-scan/coverage.json');
}

run().then(() => process.exit(0)).catch((e) => { console.error('FAIL:', e); process.exit(1); });
