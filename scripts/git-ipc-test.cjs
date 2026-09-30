/**
 * Git IPC **离线契约测试**（不需要 Electron，也不需要 spawn git）。
 *
 * 为什么这样测：本机 agent 环境**禁止 node 派生子进程**（连绝对路径的 where.exe 都 EBUSY），
 * 所以"真跑 git"在这里测不了。改成两段拼起来，覆盖度反而更实在：
 *   ① 解析函数喂的是**真 git 采集下来的原始输出**（dist/git-fixtures/*.txt，用 shell 采的）
 *   ② 注入一个**有状态的假执行器**，把 5 个 handler 全跑一遍（含各种拒绝分支）
 * 真 git 能不能跑属于环境问题，产品路径见 readStatus/runGit（spawn 数组、不拼 shell）。
 *
 * 跑法: node scripts/git-ipc-test.cjs
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const FIX = path.join(ROOT, 'dist', 'git-fixtures');
const { registerGitIpc, isValidBranchName, parseBranches, parseStatusPorcelain, parseAheadBehind } =
  require(path.join(ROOT, 'lib', 'git-ipc.js'));

const failures = [];
let passed = 0;
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failures.push(`${name}\n    期望: ${JSON.stringify(expected)}\n    实际: ${JSON.stringify(actual)}`);
}
function checkTrue(name, cond, detail) {
  if (cond) { passed++; return; }
  failures.push(name + (detail !== undefined ? `\n    实际: ${JSON.stringify(detail)}` : ''));
}
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');

(async () => {
// ---------- ① 解析：喂真 git 输出 ----------
console.log('=== ① 解析（数据来自真 git 采集）===');
const refs = parseBranches(read('refs.txt'));
console.log('  分支:', JSON.stringify(refs));
check('分支数 = 2', refs.length, 2);
check('当前分支是 main', (refs.find((b) => b.current) || {}).name, 'main');
check('另一个分支是 feat/alpha', refs.some((b) => b.name === 'feat/alpha'), true);
checkTrue('upstream 没有多余空格', refs.every((b) => b.upstream === b.upstream.trim()), refs);

const st = parseStatusPorcelain(read('status-main.txt'));
console.log('  状态:', JSON.stringify(st));
check('改动 2 处', st.dirty, 2);
check('未跟踪 1 个', st.untracked, 1);
check('文件清单', st.files.map((f) => f.file), ['readme.md', 'new-file.txt']);
check('未跟踪标记正确', st.files.find((f) => f.file === 'new-file.txt').untracked, true);

check('分支输出去空白', read('branch.txt').trim(), 'main');
check('ahead/behind 解析', parseAheadBehind('2\t3\n'), { behind: 2, ahead: 3 });
checkTrue('stat 文案含插入统计', /1 insertion/.test(read('stat.txt')), read('stat.txt').trim());
checkTrue('单文件 diff 含新增行', /\+line2/.test(read('diff-readme.txt')), read('diff-readme.txt').slice(0, 80));
checkTrue('toplevel 是绝对路径', /^[A-Za-z]:[\\/]/.test(read('toplevel.txt').trim()), read('toplevel.txt').trim());

// ---------- ② 分支名白名单 ----------
console.log('=== ② 分支名白名单 ===');
for (const ok of ['main', 'feat/e2e-work', 'release-1.2', 'a_b/c.d']) checkTrue(`接受 ${ok}`, isValidBranchName(ok));
for (const bad of ['-b', '--help', '../etc', 'a..b', 'x/', 'a b', '', 'x//y', 'end.lock/']) {
  checkTrue(`拒绝 ${JSON.stringify(bad)}`, !isValidBranchName(bad));
}

// ---------- ③ handler 契约（注入有状态假执行器）----------
console.log('=== ③ handler 契约（假执行器）===');
const handlers = new Map();
const fakeIpc = { handle: (ch, fn) => handlers.set(ch, fn) };
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-offline-'));
const REPO = path.join(SANDBOX, 'demo-repo');
const PLAIN = path.join(SANDBOX, 'plain');
fs.mkdirSync(REPO, { recursive: true });
fs.mkdirSync(PLAIN, { recursive: true });

/** 有状态假执行器：覆盖 runGit 会发出的所有参数组合 */
const state = { isRepo: true, branch: 'main', branches: ['main', 'feat/alpha'], cmdLog: [] };
const fakeRun = (dir, args) => {
  state.cmdLog.push(args.join(' '));
  const ok = (stdout = '') => ({ ok: true, code: 0, stdout, stderr: '', cmd: 'git ' + args.join(' ') });
  const fail = (err) => ({ ok: false, code: 1, stdout: '', stderr: err, error: err, cmd: 'git ' + args.join(' ') });
  const root = path.resolve(dir);
  if (args[0] === '--version') return ok('git version 2.45.0');
  if (!state.isRepo || root === path.resolve(PLAIN)) {
    if (args[0] === 'rev-parse') return fail('fatal: not a git repository (or any of the parent directories): .git');
    if (args[0] === 'init') { state.isRepo = true; return ok('Initialized empty Git repository'); }
    return fail('not a git repository');
  }
  if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return ok(root + '\n');
  if (args[0] === 'rev-parse' && args[2] === 'HEAD') return ok(state.branch + '\n');
  if (args[0] === 'status') return ok(read('status-main.txt'));
  if (args[0] === 'for-each-ref') {
    return ok(state.branches.map((b) => `${b}\t\t${b === state.branch ? '*' : ''}`).join('\n') + '\n');
  }
  if (args[0] === 'remote') return ok('');
  if (args[0] === 'rev-list') return ok('0\t0\n');
  if (args[0] === 'checkout' && args[1] === '-b') {
    if (state.branches.includes(args[2])) return fail(`fatal: a branch named '${args[2]}' already exists`);
    state.branches.push(args[2]);
    state.branch = args[2];
    return ok(`Switched to a new branch '${args[2]}'`);
  }
  if (args[0] === 'checkout') {
    if (!state.branches.includes(args[1])) return fail(`error: pathspec '${args[1]}' did not match`);
    state.branch = args[1];
    return ok(`Switched to branch '${args[1]}'`);
  }
  if (args[0] === 'diff' && args[1] === '--stat') return ok(read('stat.txt'));
  if (args[0] === 'diff' && args[1] === 'HEAD') return ok(read('diff-readme.txt'));
  if (args[0] === 'diff') return ok('');
  return ok('');
};

const openedTerminal = [];
registerGitIpc({
  ipcMain: fakeIpc,
  resolveGitExe: () => 'git',
  defaultWorkspaceDir: () => REPO,
  allowRoots: [SANDBOX],
  openTerminal: async (d) => { openedTerminal.push(d); },
  runCommand: fakeRun,
});
checkTrue('注册了 7 个 git 通道', handlers.size === 7, [...handlers.keys()]);
const call = (ch, args) => handlers.get(ch)(null, args);

const s1 = await call('git:status', { dir: REPO });
console.log('  status:', JSON.stringify({ isRepo: s1.isRepo, branch: s1.branch, dirty: s1.dirty, branches: s1.branches.length }));
check('status.isRepo', s1.isRepo, true);
check('status.branch', s1.branch, 'main');
check('status.name 取目录名', s1.name, 'demo-repo');
check('status.dirty', s1.dirty, 2);
check('status.branches', s1.branches.map((b) => b.name), ['main', 'feat/alpha']);
checkTrue('status 带 git 版本', /git version/.test(s1.gitVersion), s1.gitVersion);

const c1 = await call('git:createBranch', { dir: REPO, name: 'feat/new-one' });
check('新建分支 ok', c1.ok, true);
check('新建后 state.branch', state.branch, 'feat/new-one');
const c2 = await call('git:createBranch', { dir: REPO, name: 'feat/new-one' });
check('同名分支再建被拒', c2.ok, false);

const co = await call('git:checkout', { dir: REPO, branch: 'main' });
check('切回 main ok', co.ok, true);
check('切回后 state.branch', state.branch, 'main');
const coBad = await call('git:checkout', { dir: REPO, branch: 'nope' });
check('切不存在的分支被拒', coBad.ok, false);
const logBeforeBad = state.cmdLog.length;
const coBad2 = await call('git:checkout', { dir: REPO, branch: '-b' });
check('非法分支名被拒（白名单）', coBad2.ok, false);
// 判据是"这次非法请求**没有新增任何 git 调用**"，而不是"整个日志里没有 -b "
// （早先那次合法的 createBranch 就会记一条 `checkout -b <name>`）
check('非法分支名不产生任何 git 调用', state.cmdLog.length, logBeforeBad);

const d1 = await call('git:diff', { dir: REPO });
check('审阅：改动清单', d1.files.map((f) => f.file), ['readme.md', 'new-file.txt']);
check('审阅：总数', d1.total, 2);
const d2 = await call('git:diff', { dir: REPO, file: 'readme.md' });
checkTrue('审阅：单文件 diff', /\+line2/.test(d2.diff), (d2.diff || '').slice(0, 60));
const d3 = await call('git:diff', { dir: REPO, file: '../../secret.txt' });
check('审阅：越界文件被拒', d3.ok, false);

const p1 = await call('git:status', { dir: PLAIN });
check('普通目录 isRepo=false（不抛错）', p1.isRepo, false);
const i1 = await call('git:init', { dir: PLAIN });
check('初始化仓库 ok', i1.ok, true);

const out = await call('git:status', { dir: os.homedir() });
check('越界目录被拒', out.ok, false);
const none = await call('git:status', { dir: path.join(SANDBOX, 'not-exist') });
check('不存在的目录被拒', none.ok, false);

const t1 = await call('git:openTerminal', { dir: REPO });
check('终端 ok', t1.ok, true);
check('终端目录正确', openedTerminal.map((d) => path.basename(d)), ['demo-repo']);

fs.rmSync(SANDBOX, { recursive: true, force: true });

console.log();
if (failures.length) {
  console.error(`FAIL (${failures.length} 项，通过 ${passed} 项)`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`PASS: Git IPC 契约（真输出解析 / 分支白名单 / 5 个 handler / 拒绝分支）共 ${passed} 项`);
})();
