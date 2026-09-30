/**
 * 有状态的**假 git 执行器**（测试夹具）。
 *
 * 为什么需要：本机 agent 环境禁止 node 派生子进程（连绝对路径的 where.exe 都 EBUSY），
 * 真 git 在这里跑不起来。用它替换 `registerGitIpc({ runCommand })`，就能把
 * 「命令序列 → 状态流转 → handler 返回 → 界面渲染」整条链路测通，
 * 而解析逻辑另有单测拿**真 git 采集的原始输出**验证（scripts/git-ipc-test.cjs）。
 *
 * 用法：
 *   const { createFakeGit } = require('./fixtures/fake-git.cjs');
 *   const fake = createFakeGit({ root: REPO, fixDir: path.join(ROOT,'dist','git-fixtures') });
 *   registerGitIpc({ ..., runCommand: fake.run });
 *   fake.state.branch      // 观察状态流转
 */
const fs = require('node:fs');
const path = require('node:path');

function createFakeGit({ root, fixDir } = {}) {
  const read = (f) => {
    try { return fs.readFileSync(path.join(fixDir, f), 'utf8'); } catch { return ''; }
  };
  const state = {
    isRepo: true,
    branch: 'main',
    branches: ['main', 'feat/alpha'],
    cmdLog: [],
    version: 'git version 2.45.0',
    // 哪些目录是仓库：init 会把新目录加进来（真 git 也是这样 —— 初始化的目录随后就该被识别为仓库）
    repoDirs: new Set(root ? [path.resolve(root)] : []),
  };

  function run(dir, args) {
    state.cmdLog.push(args.join(' '));
    const ok = (stdout = '') => ({ ok: true, code: 0, stdout, stderr: '', cmd: 'git ' + args.join(' ') });
    const fail = (err) => ({ ok: false, code: 1, stdout: '', stderr: err, error: err, cmd: 'git ' + args.join(' ') });
    const target = path.resolve(dir);
    const isRoot = root ? target === path.resolve(root) : true;

    if (args[0] === '--version') return ok(state.version + '\n');
    if (args[0] === 'init') {
      state.repoDirs.add(target);
      state.isRepo = true;
      return ok('Initialized empty Git repository\n');
    }
    if (!state.isRepo || !state.repoDirs.has(target)) {
      if (args[0] === 'rev-parse') return fail('fatal: not a git repository (or any of the parent directories): .git');
      return fail('not a git repository');
    }
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return ok(target + '\n');
    if (args[0] === 'rev-parse' && args.includes('HEAD')) return ok(state.branch + '\n');
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
      return ok(`Switched to a new branch '${args[2]}'\n`);
    }
    if (args[0] === 'checkout') {
      if (!state.branches.includes(args[1])) return fail(`error: pathspec '${args[1]}' did not match any file(s) known to git`);
      state.branch = args[1];
      return ok(`Switched to branch '${args[1]}'\n`);
    }
    if (args[0] === 'diff' && args[1] === '--stat') return ok(read('stat.txt'));
    if (args[0] === 'diff' && args[1] === 'HEAD') return ok(read('diff-readme.txt'));
    if (args[0] === 'diff') return ok('');
    return ok('');
  }

  return { run, state, read };
}

module.exports = { createFakeGit };
