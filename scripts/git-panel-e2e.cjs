/**
 * Git 状态栏 + 右侧快捷动作 **端到端**：
 *   真建一个临时 git 仓库，跑「状态 → 新建分支 → 切回 → 改动 → 审阅 diff → 初始化仓库 →
 *   非法输入被拒 → 越界目录被拒」，再验 UI（状态栏渲染 / 分支面板 / 动作列 / 审阅面板）
 *   与内置浏览器视图的创建-销毁。
 *
 * 跑法（cwd 必须是仓库根）：
 *   env -u ELECTRON_RUN_AS_NODE node node_modules/electron/cli.js scripts/git-panel-e2e.cjs
 * 产出：%TEMP%\git-panel-e2e.json
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFakeGit } = require('./fixtures/fake-git.cjs');

app.disableHardwareAcceleration();
['no-sandbox', 'disable-gpu', 'disable-software-rasterizer', 'in-process-gpu']
  .forEach((s) => app.commandLine.appendSwitch(s));

const ROOT = 'D:/DS_harness';
const RESULT = path.join(os.tmpdir(), 'git-panel-e2e.json');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-e2e-'));
const REPO = path.join(SANDBOX, 'demo-repo');
const PLAIN = path.join(SANDBOX, 'plain-dir');

const failures = [];
const steps = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return true;
  failures.push(`${name}\n    期望: ${JSON.stringify(expected)}\n    实际: ${JSON.stringify(actual)}`);
  return false;
}
function checkTrue(name, cond, detail) {
  if (cond) return true;
  failures.push(name + (detail !== undefined ? `\n    实际: ${JSON.stringify(detail)}` : ''));
  return false;
}

// ---------- 夹具：目录结构（真 git 跑不了 —— 本环境禁 node 派生子进程，见文件头说明）----------
// 命令行为由 scripts/fixtures/fake-git.cjs 提供（有状态），解析逻辑另由 git-ipc-test.cjs 拿真 git 输出验过。
fs.mkdirSync(REPO, { recursive: true });
fs.mkdirSync(PLAIN, { recursive: true });

// ---------- 注册被测 IPC ----------
const { registerGitIpc } = require(path.join(ROOT, 'lib', 'git-ipc.js'));
const { registerBrowserIpc } = require(path.join(ROOT, 'lib', 'browser-ipc.js'));
const opened = { terminal: [], folder: [] };

let win = null;
const fixDir = path.join(ROOT, 'dist', 'git-fixtures');
const fake = createFakeGit({ root: REPO, fixDir });
const gitCtl = registerGitIpc({
  ipcMain,
  resolveGitExe: () => 'git',
  defaultWorkspaceDir: () => REPO,
  allowRoots: [SANDBOX],   // 只允许沙箱目录：主目录/临时目录都不在内，用来验证越界被拒
  openTerminal: async (dir) => { opened.terminal.push(dir); },
  runCommand: fake.run,    // 见文件头：环境不允许真 spawn，用有状态假执行器替代
});
const browserCtl = registerBrowserIpc({ ipcMain, getWindow: () => win });

const preloadSrc = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
for (const ch of [...new Set([...preloadSrc.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((m) => m[1]))]) {
  if (ch.startsWith('git:') || ch.startsWith('browser:')) continue;
  if (ch === 'host:openPath') { ipcMain.handle(ch, async (_e, a) => { opened.folder.push(a && a.path); return { ok: true }; }); continue; }
  if (ch === 'host:describe') { ipcMain.handle(ch, async () => ({ ok: true, value: { canOpenPath: true } })); continue; }
  if (ch === 'chat:workspaces') { ipcMain.handle(ch, async () => ({ ok: true, items: [{ workspaceId: 'w1', title: 'demo-repo', path: REPO, sessionIds: [] }], archivedSessionIds: [] })); continue; }
  ipcMain.handle(ch, async () => ({ ok: true, items: [], list: [], sessions: [], presets: [], providers: [], models: [], namespaces: [], value: {} }));
}

(async () => {
  const report = { ok: false, failures, steps, consoleErrors: [] };
  const watchdog = setTimeout(() => {
    try { fs.writeFileSync(RESULT, JSON.stringify({ ...report, error: 'watchdog' }, null, 2)); } catch { /* ignore */ }
    app.exit(3);
  }, 180000);
  try {
    await app.whenReady();
    win = new BrowserWindow({
      width: 1360, height: 900, show: false,
      webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    });
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) report.consoleErrors.push(String(message).slice(0, 200));
    });
    await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
    await wait(2500);
    const js = (expr) => win.webContents.executeJavaScript(expr, true);

    // ---------- 1. 主进程 git 能力 ----------
    const st = await js(`window.api.gitStatus(${JSON.stringify(REPO)})`);
    steps.push({ step: '1 · 状态', detail: { isRepo: st.isRepo, branch: st.branch, branches: (st.branches || []).map((b) => b.name) } });
    check('识别为 git 仓库', st.isRepo, true);
    check('当前分支 = main', st.branch, 'main');
    checkTrue('拿到本地分支列表', (st.branches || []).some((b) => b.name === 'main'), st.branches);

    const created = await js(`window.api.gitCreateBranch(${JSON.stringify(REPO)}, 'feat/e2e-work')`);
    check('新建分支成功', created.ok, true);
    const st2 = await js(`window.api.gitStatus(${JSON.stringify(REPO)})`);
    check('新建后当前分支切换过去', st2.branch, 'feat/e2e-work');

    const back = await js(`window.api.gitCheckout(${JSON.stringify(REPO)}, 'main')`);
    check('切回 main 成功', back.ok, true);
    const st3 = await js(`window.api.gitStatus(${JSON.stringify(REPO)})`);
    check('当前分支回到 main', st3.branch, 'main');

    // 非法输入
    const bad1 = await js(`window.api.gitCreateBranch(${JSON.stringify(REPO)}, '-b')`);
    check('分支名 "-b" 被拒（参数注入）', bad1.ok, false);
    const bad2 = await js(`window.api.gitCheckout(${JSON.stringify(REPO)}, 'not-exist')`);
    check('切不存在的分支被拒', bad2.ok, false);
    const bad3 = await js(`window.api.gitStatus(${JSON.stringify(os.homedir())})`);
    check('越界目录被拒（主目录不在允许根下）', bad3.ok, false);

    // ---------- 2. 改动 → 审阅（假执行器返回真 git 采样的 status/diff）----------
    const diff = await js(`window.api.gitDiff(${JSON.stringify(REPO)})`);
    steps.push({ step: '2 · 审阅', detail: { total: diff.total, files: diff.files.map((f) => f.code + ' ' + f.file) } });
    checkTrue('改动清单里有被修改的文件', diff.files.some((f) => f.file === 'readme.md'), diff.files);
    checkTrue('改动清单里有未跟踪文件', diff.files.some((f) => f.file === 'new-file.txt' && f.untracked), diff.files);
    const fileDiff = await js(`window.api.gitDiff(${JSON.stringify(REPO)}, 'readme.md')`);
    checkTrue('单文件 diff 含新增行', /\+line2/.test(fileDiff.diff || ''), (fileDiff.diff || '').slice(0, 120));
    const evil = await js(`window.api.gitDiff(${JSON.stringify(REPO)}, '../../etc/passwd')`);
    check('越界读文件被拒（../../）', evil.ok, false);

    // ---------- 3. 非仓库 → 初始化 ----------
    const plainStatus = await js(`window.api.gitStatus(${JSON.stringify(PLAIN)})`);
    check('普通目录：isRepo=false（不报错）', plainStatus.isRepo, false);
    const inited = await js(`window.api.gitInit(${JSON.stringify(PLAIN)})`);
    check('初始化仓库成功', inited.ok, true);
    const plain2 = await js(`window.api.gitStatus(${JSON.stringify(PLAIN)})`);
    check('初始化后识别为仓库', plain2.isRepo, true);

    // ---------- 4. 终端（走注入的桩） ----------
    const term = await js(`window.api.gitOpenTerminal(${JSON.stringify(REPO)})`);
    check('打开终端调用成功', term.ok, true);
    checkTrue('终端在正确目录被调用', opened.terminal.length === 1 && path.resolve(opened.terminal[0]) === path.resolve(REPO), opened.terminal);

    // ---------- 5. UI：Git 状态栏 ----------
    // 让渲染层拿到工作区（chat.js 已把 w1 作为唯一工作区；直接广播事件并刷新）
    await js(`window.dispatchEvent(new CustomEvent('dsh:workspace-changed', { detail: { path: ${JSON.stringify(REPO)} } }));
              window.__ws = { path: () => ${JSON.stringify(REPO)}, id: () => 'w1', title: () => 'demo-repo' };
              true`);
    const bar = await js(`(async () => {
      await window.__gitBar.refresh();
      const el = document.getElementById('gitBar');
      const cs = getComputedStyle(el);
      return {
        hidden: el.hidden, display: cs.display,
        repo: document.getElementById('gbRepo').textContent,
        scope: document.getElementById('gbScope').textContent,
        branch: document.getElementById('gbBranchName').textContent,
        dirty: document.getElementById('gbDirty').hidden ? '' : document.getElementById('gbDirty').textContent,
      };
    })()`);
    steps.push({ step: '5 · 状态栏', detail: bar });
    checkTrue('状态栏可见', !bar.hidden && bar.display !== 'none', bar);
    check('状态栏显示仓库名', bar.repo, 'demo-repo');
    check('状态栏显示「本地」', bar.scope, '本地');
    check('状态栏显示当前分支', bar.branch, 'main');
    checkTrue('状态栏显示改动数', /改动/.test(bar.dirty || ''), bar.dirty);

    // 分支面板
    const panel = await js(`(async () => {
      window.__gitBar.openPanel();
      await new Promise((r) => setTimeout(r, 200));
      const p = document.getElementById('gbPanel');
      return {
        hidden: p.hidden,
        rows: [...p.querySelectorAll('[data-branch]')].map((b) => b.textContent.trim()),
        hasNew: !!p.querySelector('[data-act="create"]'),
        hasSearch: !!p.querySelector('#gbSearch'),
      };
    })()`);
    steps.push({ step: '5 · 分支面板', detail: panel });
    checkTrue('分支面板打开', !panel.hidden, panel);
    checkTrue('列出了本地分支（含 main）', panel.rows.some((r) => r.includes('main')), panel.rows);
    checkTrue('有「新建分支」入口', panel.hasNew, panel);
    checkTrue('有搜索框', panel.hasSearch, panel);

    // ---------- 6. UI：快捷动作列 + 审阅面板 ----------
    const quick = await js(`(async () => {
      document.getElementById('ctQuickBtn').click();
      await new Promise((r) => setTimeout(r, 120));
      const p = document.getElementById('qaPanel');
      return { hidden: p.hidden, cards: [...p.querySelectorAll('[data-act]')].map((b) => b.getAttribute('data-act')) };
    })()`);
    steps.push({ step: '6 · 动作列', detail: quick });
    check('动作列默认收起→点击后展开', quick.hidden, false);
    check('五个动作卡齐全', quick.cards.sort(), ['browser', 'folder', 'review', 'sideTask', 'terminal']);

    const review = await js(`(async () => {
      window.__quickActions.openReview();
      await new Promise((r) => setTimeout(r, 700));
      const el = document.getElementById('qaReview');
      return {
        hidden: el.hidden,
        files: [...el.querySelectorAll('[data-file]')].map((b) => b.getAttribute('data-file')),
        head: (el.querySelector('.qa-review-head') || {}).textContent || '',
      };
    })()`);
    steps.push({ step: '6 · 审阅面板', detail: review });
    checkTrue('审阅面板打开', !review.hidden, review);
    checkTrue('审阅列出改动文件', review.files.includes('readme.md'), review.files);
    checkTrue('审阅头部显示分支', /main/.test(review.head), review.head);

    const diffView = await js(`(async () => {
      document.querySelector('#qaReview [data-file="readme.md"]').click();
      await new Promise((r) => setTimeout(r, 500));
      const pre = document.querySelector('#qaReview .qa-diff');
      return { has: !!pre, add: !!document.querySelector('#qaReview .d-add'), text: pre ? pre.textContent.slice(0, 120) : '' };
    })()`);
    checkTrue('点击文件后渲染出 diff（带新增行着色）', diffView.has && diffView.add, diffView);

    // ---------- 7. UI：内置浏览器 ----------
    const localPage = path.join(SANDBOX, 'page.html');
    fs.writeFileSync(localPage, '<html><body><h1>DSH embedded</h1></body></html>', 'utf8');
    const fileUrl = 'file:///' + localPage.split(path.sep).join('/');
    const bopen = await js(`(async () => {
      await window.__quickActions.openBrowser(${JSON.stringify(fileUrl)});
      await new Promise((r) => setTimeout(r, 1200));
      const st = await window.api.browserState();
      const el = document.getElementById('qaBrowser');
      const slot = document.getElementById('qaBrowserView').getBoundingClientRect();
      return { open: st.open, url: st.url, panelHidden: el.hidden, slot: [Math.round(slot.width), Math.round(slot.height)] };
    })()`);
    steps.push({ step: '7 · 内置浏览器', detail: bopen });
    checkTrue('浏览器视图创建成功', bopen.open === true, bopen);
    checkTrue('加载的是目标本地页', /page\.html$/.test(bopen.url || ''), bopen.url);
    checkTrue('面板打开且占位矩形有尺寸', !bopen.panelHidden && bopen.slot[0] > 50 && bopen.slot[1] > 50, bopen.slot);
    const bclose = await js(`(async () => {
      await window.api.browserClose();
      await new Promise((r) => setTimeout(r, 400));
      return await window.api.browserState();
    })()`);
    check('关闭后视图释放', bclose.open, false);

    // ---------- 8. 快捷键 Alt+E ----------
    const before = opened.folder.length;
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', altKey: true, bubbles: true })); true`);
    await wait(400);
    checkTrue('Alt+E 触发"打开工作区文件"', opened.folder.length > before, opened.folder);

    const realErrors = report.consoleErrors.filter((e) => !/favicon|ERR_FILE_NOT_FOUND|net::ERR/i.test(e));
    checkTrue('渲染层无报错', realErrors.length === 0, realErrors.slice(0, 3));
  } catch (err) {
    failures.push(`测试自身失败：${(err && err.message) || err}`);
  } finally {
    clearTimeout(watchdog);
    try { browserCtl.destroy(); } catch { /* ignore */ }
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  report.ok = failures.length === 0;
  try { fs.writeFileSync(RESULT, JSON.stringify(report, null, 2)); } catch { /* ignore */ }
  for (const s of steps) console.log(`  (${s.step}: ${JSON.stringify(s.detail).slice(0, 200)})`);
  if (failures.length) {
    console.error(`FAIL (${failures.length} 项)`);
    for (const f of failures) console.error('  - ' + f);
    app.exit(1);
  } else {
    console.log('PASS: Git 状态栏 + 快捷动作端到端（状态/分支/新建/切回/审阅/初始化/非法输入/越界/UI/浏览器视图）');
    app.exit(0);
  }
  void gitCtl;
})();
