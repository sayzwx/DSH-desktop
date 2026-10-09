/**
 * Git 集成 IPC（**工作区级别的本地 git**）—— 让桌面端"知道当前在哪个仓库、哪个分支"，
 * 并能切分支 / 新建分支 / 初始化仓库，以及给审阅面板提供 diff。
 *
 * 为什么单独成模块：main.js 已经很长，而主题工作室那套 `registerXxxIpc({ 依赖注入 })`
 * 的模式（lib/theme-ipc.js）已验证好用 —— 依赖显式传进来，方便测试时替换。
 *
 * 🔴 安全约束（硬要求，评审时优先看这里）：
 *   1. **一律 `spawn(git, [参数数组], { cwd })`，绝不拼 shell 字符串** —— 目录名/分支名里
 *      带空格、引号、`&&` 都只是普通参数，不可能变成命令注入。
 *   2. **目录必须通过 `safeDir()`**：存在、是目录、且在允许的根之下（默认允许
 *      "工作区目录 + 用户主目录"，避免渲染层传 `/` 或系统目录去跑 git）。
 *   3. **分支名白名单**：`^[A-Za-z0-9._/-]{1,80}$`，且不以 `-` `/` `.` 开头、不含 `..`
 *      （`git checkout --orphan`、`-b --help` 这类参数注入靠"不以 - 开头"挡掉）。
 *   4. 写操作（checkout / createBranch / init）都回传**实际执行的命令**与输出，便于审计与排错。
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const BRANCH_RE = /^[A-Za-z0-9._/-]{1,80}$/;

/** 分支名是否合法（同时挡掉参数注入：不能以 - 开头） */
function isValidBranchName(name) {
  const s = String(name || '').trim();
  if (!BRANCH_RE.test(s)) return false;
  if (/^[-/.]/.test(s)) return false;
  if (s.includes('..') || s.includes('//') || s.endsWith('/') || s.endsWith('.lock')) return false;
  return true;
}

/** 目录校验：存在 + 是目录 + 在允许的根之下 */
function makeSafeDir(allowRoots) {
  const roots = (allowRoots || []).filter(Boolean).map((r) => {
    try { return fs.realpathSync(r); } catch { return path.resolve(r); }
  });
  return (dir) => {
    if (typeof dir !== 'string' || !dir.trim()) return { ok: false, error: '缺少目录' };
    let real;
    try { real = fs.realpathSync(dir); } catch { return { ok: false, error: `目录不存在：${dir}` }; }
    let st;
    try { st = fs.statSync(real); } catch { return { ok: false, error: `目录不可访问：${dir}` }; }
    if (!st.isDirectory()) return { ok: false, error: `不是目录：${dir}` };
    if (roots.length && !roots.some((r) => real === r || real.startsWith(r + path.sep))) {
      return { ok: false, error: '目录不在允许的范围内' };
    }
    return { ok: true, dir: real };
  };
}


/**
 * —— 纯解析函数（不碰进程，方便单测）——
 * 单测里喂的是**真 git 命令的原始输出**（用 shell 采集下来的），所以解析逻辑是拿真数据验过的。
 */
function parseBranches(refsOut) {
  return String(refsOut || '').split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim()).map((l) => {
    const [name, upstream = '', head = ''] = l.split('\t');
    return { name, upstream: upstream.trim(), current: String(head).trim() === '*' };
  });
}

function parseStatusPorcelain(out) {
  const lines = String(out || '').split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean);
  const files = lines.map((l) => {
    const code = l.slice(0, 2).trim() || '?';
    let file = l.slice(3).trim();
    if (file.includes(' -> ')) file = file.split(' -> ').pop();
    return { code, file, untracked: code === '??' };
  });
  return { dirty: files.length, untracked: files.filter((f) => f.untracked).length, files };
}

function parseAheadBehind(out) {
  const [b, a] = String(out || '').trim().split(/\s+/).map((n) => Number(n) || 0);
  return { behind: b || 0, ahead: a || 0 };
}

/**
 * 「p 是否在 root 之内」——🔴 不能直接 startsWith：
 * git 在 Windows 上返回的 toplevel 是**正斜杠**（`C:/Users/x/repo`），而 path.resolve 给反斜杠，
 * 两者比较必然失败（真机实测：审阅面板里点文件一律报"文件不在仓库内"）。
 * 同时 Windows 路径大小写不敏感。
 */
function isInside(root, p) {
  const a = path.resolve(root);
  const b = path.resolve(p);
  const norm = (x) => (process.platform === 'win32' ? x.toLowerCase() : x);
  const na = norm(a);
  const nb = norm(b);
  return nb === na || nb.startsWith(na + path.sep) || nb.startsWith(na + '/');
}

function registerGitIpc({
  ipcMain,
  resolveGitExe,          // () => 'git' | 绝对路径（沿用 main.js 的 resolveExe）
  defaultWorkspaceDir,    // () => 默认工作区目录（渲染层没指定时用）
  allowRoots = [],        // 允许执行 git 的根目录（一般 [工作区目录, os.homedir()]）
  listWorkspaceDirs,      // async () => string[]  引擎登记的工作区目录（真实用户工作区常在这里）
  openTerminal,           // (dir) => Promise<void> 打开系统终端
  runCommand,             // 可选：注入执行器（测试用；默认走真 spawn —— 见 runGit）
} = {}) {
  // 🔴 真实工作区目录必须放行：用户的工作区由引擎登记（workspace.list），往往**不等于**
  //    默认目录 —— 真机实测就踩到过：工作区在 D:\DSH\harness，白名单只有默认目录 → 全部被拒。
  const dynamicRoots = new Set();
  let rootsRefreshedAt = 0;
  async function refreshRoots() {
    if (!listWorkspaceDirs) return;
    if (Date.now() - rootsRefreshedAt < 5000) return;   // 5 秒缓存，别每次 git 查询都打引擎
    rootsRefreshedAt = Date.now();
    try {
      const dirs = await listWorkspaceDirs();
      for (const d of dirs || []) if (typeof d === 'string' && d) dynamicRoots.add(d);
    } catch { /* 引擎不在线就只用静态白名单 */ }
  }
  // 🔴 allowRoots 必须**每次调用时求值**：main.js 里的 HARNESS_DIR / DSH_HOME 是异步探测出来的，
  //    注册时（模块初始化那一刻）还是空串 —— 真机实测就踩到：白名单里工作区目录被算成空，
  //    于是真实工作区 D:\DSH\harness 一律被判"不在允许的范围内"。
  const baseRoots = typeof allowRoots === 'function' ? allowRoots : () => allowRoots;
  // safeDir 每次调用时动态取根（含引擎登记的工作区），所以这里传 getter
  const safeDir = (dir) => {
    const roots = [...(baseRoots() || []), ...dynamicRoots].filter(Boolean).map((r) => {
      try { return fs.realpathSync(r); } catch { return path.resolve(r); }
    });
    return makeSafeDir(roots)(dir);
  };
  const gitExe = () => (typeof resolveGitExe === 'function' && resolveGitExe()) || 'git';

  let gitVersionCache = null;
  /** 跑一条 git 命令，返回 { ok, stdout, stderr, code, cmd } */
  function runGit(dir, args, opts = {}) {
    if (typeof runCommand === 'function') return Promise.resolve(runCommand(dir, args, opts));
    const { timeoutMs = 20000, allowFail = false } = opts;
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(gitExe(), args, { cwd: dir, shell: false, windowsHide: true });
      } catch (e) {
        resolve({ ok: false, code: -1, error: `无法启动 git：${e.message}`, cmd: 'git ' + args.join(' ') });
        return;
      }
      let out = '';
      let err = '';
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        try { child.kill(); } catch { /* ignore */ }
        resolve({ ok: false, code: -2, error: `git 超时（${timeoutMs}ms）`, cmd: 'git ' + args.join(' ') });
      }, timeoutMs);
      child.stdout.on('data', (b) => { out += b.toString('utf8'); });
      child.stderr.on('data', (b) => { err += b.toString('utf8'); });
      child.on('error', (e) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const noGit = /ENOENT/i.test(e.message || '');
        resolve({
          ok: false,
          code: -1,
          error: noGit ? '本机没有找到 git（请先安装 Git 并确保在 PATH 里）' : e.message,
          notFound: noGit,
          cmd: 'git ' + args.join(' '),
        });
      });
      child.on('close', (code) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const ok = code === 0;
        resolve({
          ok: ok || allowFail,
          code,
          stdout: out,
          stderr: err,
          error: ok ? '' : (err.trim() || out.trim() || `git 退出码 ${code}`),
          cmd: 'git ' + args.join(' '),
        });
      });
    });
  }

  function ensureGit() {
    if (gitVersionCache) return Promise.resolve(gitVersionCache);
    return runGit(process.cwd(), ['--version'], { allowFail: true }).then((r) => {
      gitVersionCache = r.ok ? String(r.stdout || '').trim() : '';
      return gitVersionCache;
    });
  }

  /** 读取仓库状态（不是仓库时返回 isRepo:false，而不是报错） */
  async function readStatus(dir) {
    const top = await runGit(dir, ['rev-parse', '--show-toplevel']);
    if (!top.ok) {
      return { isRepo: false, reason: /not a git repository/i.test(top.stderr || '') ? 'NOT_A_REPO' : 'GIT_ERROR', detail: (top.stderr || top.error || '').trim().split('\n')[0] };
    }
    const root = top.stdout.trim();
    const [branchR, statusR, refsR, remoteR] = await Promise.all([
      runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
      runGit(root, ['status', '--porcelain=v1']),
      runGit(root, ['for-each-ref', '--format=%(refname:short)%09%(upstream:short)%09%(HEAD)', 'refs/heads']),
      runGit(root, ['remote']),
    ]);
    const branchRaw = branchR.ok ? branchR.stdout.trim() : '';
    const detached = !branchRaw || branchRaw === 'HEAD';
    const branches = parseBranches(refsR.stdout);
    const current = branches.find((b) => b.current);
    const parsed = parseStatusPorcelain(statusR.stdout);
    let ahead = 0;
    let behind = 0;
    if (current && current.upstream) {
      const lr = await runGit(root, ['rev-list', '--left-right', '--count', `${current.upstream}...HEAD`], { allowFail: true });
      if (lr.ok) ({ ahead, behind } = parseAheadBehind(lr.stdout));
    }
    return {
      isRepo: true,
      root,
      name: path.basename(root),
      branch: detached ? '' : branchRaw,
      detached,
      branches,
      dirty: parsed.dirty,
      untracked: parsed.untracked,
      changedFiles: parsed.files,
      ahead,
      behind,
      remotes: (remoteR.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean),
    };
  }

  ipcMain.handle('git:workspaceDir', async () => {
    try {
      const d = typeof defaultWorkspaceDir === 'function' ? defaultWorkspaceDir() : '';
      return { ok: true, dir: d || '' };
    } catch (e) {
      return { ok: false, error: (e && e.message) || '取默认工作区失败' };
    }
  });

  ipcMain.handle('git:status', async (_e, args = {}) => {
    const ver = await ensureGit();
    if (!ver) return { ok: false, code: 'NO_GIT', error: '本机没有找到 git（请先安装 Git 并确保在 PATH 里）' };
    const cand = args.dir || (typeof defaultWorkspaceDir === 'function' ? defaultWorkspaceDir() : '');
    await refreshRoots();   // 先把引擎登记的工作区目录并进来，否则真实工作区会被白名单拒掉
    const safe = safeDir(cand);
    if (!safe.ok) return { ok: false, error: safe.error };
    const st = await readStatus(safe.dir);
    return { ok: true, dir: safe.dir, gitVersion: ver, ...st };
  });

  // 远端地址（只读）：GitHub 面板用它**自动带出当前工作区的仓库**（git remote get-url origin），
  // 免去手动输 owner/repo。只读、白名单目录内执行。
  ipcMain.handle('git:remoteUrl', async (_e, args = {}) => {
    const ver = await ensureGit();
    if (!ver) return { ok: false, code: 'NO_GIT', error: '本机没有找到 git' };
    await refreshRoots();
    const safe = safeDir(args && args.dir);
    if (!safe.ok) return { ok: false, error: safe.error };
    const st = await readStatus(safe.dir);
    if (!st.isRepo) return { ok: false, error: '不是 git 仓库' };
    const r = await runGit(st.root, ['remote', 'get-url', 'origin']);
    if (!r.ok) return { ok: false, error: '没有配置 origin 远端' };
    return { ok: true, url: String(r.stdout || '').trim(), root: st.root, branch: st.branch || '' };
  });

  ipcMain.handle('git:checkout', async (_e, args = {}) => {
    await refreshRoots();   // 先把引擎登记的工作区目录并进来，否则真实工作区会被白名单拒掉
    const safe = safeDir(args.dir);
    if (!safe.ok) return { ok: false, error: safe.error };
    if (!isValidBranchName(args.branch)) return { ok: false, error: `分支名不合法：${String(args.branch || '').slice(0, 40)}` };
    const st = await readStatus(safe.dir);
    if (!st.isRepo) return { ok: false, error: '不是 git 仓库' };
    if (!st.branches.some((b) => b.name === args.branch)) return { ok: false, error: `本地没有分支 ${args.branch}` };
    const r = await runGit(st.root, ['checkout', args.branch]);
    if (!r.ok) return { ok: false, error: r.error, cmd: r.cmd };
    return { ok: true, branch: args.branch, cmd: r.cmd, dir: st.root };
  });

  ipcMain.handle('git:createBranch', async (_e, args = {}) => {
    await refreshRoots();   // 先把引擎登记的工作区目录并进来，否则真实工作区会被白名单拒掉
    const safe = safeDir(args.dir);
    if (!safe.ok) return { ok: false, error: safe.error };
    if (!isValidBranchName(args.name)) return { ok: false, error: `分支名不合法：${String(args.name || '').slice(0, 40)}` };
    const st = await readStatus(safe.dir);
    if (!st.isRepo) return { ok: false, error: '不是 git 仓库' };
    if (st.branches.some((b) => b.name === args.name)) return { ok: false, error: `分支 ${args.name} 已存在` };
    const gitArgs = ['checkout', '-b', args.name];
    if (args.from && isValidBranchName(args.from)) gitArgs.push(args.from);
    const r = await runGit(st.root, gitArgs);
    if (!r.ok) return { ok: false, error: r.error, cmd: r.cmd };
    return { ok: true, branch: args.name, cmd: r.cmd, dir: st.root };
  });

  ipcMain.handle('git:init', async (_e, args = {}) => {
    await refreshRoots();   // 先把引擎登记的工作区目录并进来，否则真实工作区会被白名单拒掉
    const safe = safeDir(args.dir);
    if (!safe.ok) return { ok: false, error: safe.error };
    const st = await readStatus(safe.dir);
    if (st.isRepo) return { ok: true, already: true, root: st.root };
    // -b main：新版 git 支持；老版会失败，退回不带 -b 的写法
    let r = await runGit(safe.dir, ['init', '-b', 'main']);
    if (!r.ok) r = await runGit(safe.dir, ['init']);
    if (!r.ok) return { ok: false, error: r.error, cmd: r.cmd };
    const after = await readStatus(safe.dir);
    return { ok: true, root: after.root || safe.dir, branch: after.branch || '' };
  });

  /** 审阅面板用：改动清单 + 统计 + （可选）某个文件的 diff 正文 */
  ipcMain.handle('git:diff', async (_e, args = {}) => {
    await refreshRoots();   // 先把引擎登记的工作区目录并进来，否则真实工作区会被白名单拒掉
    const safe = safeDir(args.dir);
    if (!safe.ok) return { ok: false, error: safe.error };
    const st = await readStatus(safe.dir);
    if (!st.isRepo) return { ok: false, error: '不是 git 仓库' };
    const root = st.root;
    const [filesR, statR] = await Promise.all([
      runGit(root, ['status', '--porcelain=v1']),
      runGit(root, ['diff', '--stat', 'HEAD'], { allowFail: true }),
    ]);
    const files = parseStatusPorcelain(filesR.stdout).files;
    const out = {
      ok: true,
      root,
      branch: st.branch,
      files,
      stat: (statR.stdout || '').trim(),
      total: files.length,
    };
    if (args.file) {
      const target = String(args.file);
      // 只允许仓库内的相对路径（挡掉 ../../ 越界读取）
      if (!isInside(root, path.resolve(root, target))) return { ok: false, error: '文件不在仓库内' };
      const f = files.find((x) => x.file === target);
      const d = f && f.untracked
        ? await runGit(root, ['diff', '--no-index', '--', '/dev/null', target], { allowFail: true })
        : await runGit(root, ['diff', 'HEAD', '--', target], { allowFail: true });
      out.file = target;
      out.diff = String(d.stdout || '').slice(0, 400 * 1024);
      out.truncated = String(d.stdout || '').length > 400 * 1024;
    }
    return out;
  });

  ipcMain.handle('git:openTerminal', async (_e, args = {}) => {
    await refreshRoots();   // 先把引擎登记的工作区目录并进来，否则真实工作区会被白名单拒掉
    const safe = safeDir(args.dir);
    if (!safe.ok) return { ok: false, error: safe.error };
    if (typeof openTerminal !== 'function') return { ok: false, error: '当前平台不支持打开终端' };
    try {
      await openTerminal(safe.dir);
      return { ok: true, dir: safe.dir };
    } catch (e) {
      return { ok: false, error: (e && e.message) || '打开终端失败' };
    }
  });

  return { readStatus, isValidBranchName, runGit, safeDir: (d) => safeDir(d), refreshRoots, dynamicRoots };
}

module.exports = {
  registerGitIpc,
  isInside,
  isValidBranchName,
  parseBranches,
  parseStatusPorcelain,
  parseAheadBehind,
};
