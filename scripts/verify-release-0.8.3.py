#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v0.8.3 发版产物校验。
沿用 0.8.1/0.8.2 学到的两课：版本串在 Windows 资源里是 UTF-16LE（别只搜 ASCII）；
判"不再硬编码"要先剥注释。本版逐项验证新增能力是否真的进了包。
"""
import json
import os
import re
import zipfile

DIST = r'D:\DS_harness\dist'
ZIP = os.path.join(DIST, 'DSH-Desktop-v0.8.3.zip')
EXE = os.path.join(DIST, 'DSH-Desktop-v0.8.3-Setup.exe')
REPO = r'D:\DS_harness'

fail = []
def check(name, cond, detail=''):
    print(('  OK   ' if cond else '  FAIL ') + name + (f'  {detail}' if detail else ''))
    if not cond:
        fail.append(name)

print('=== Setup.exe ===')
with open(EXE, 'rb') as f:
    blob = f.read()
check('PE 头是 MZ', blob[:2] == b'MZ')
check('版本串 0.8.3 存在（UTF-16LE 资源）', blob.find('0.8.3'.encode('utf-16le')) > 0)
check('不含 0.8.2（两种编码）', blob.find('0.8.2'.encode('utf-16le')) < 0 and blob.find(b'0.8.2') < 0)
print(f'  体积 {len(blob)/1024/1024:.1f} MB')

print('=== zip ===')
zf = zipfile.ZipFile(ZIP)
names = zf.namelist()
check('zip 根目录是 app/', names[0].startswith('app/'), names[0])
pkg = json.loads(zf.read('app/resources/app/package.json').decode('utf-8'))
check('package.json version = 0.8.3', pkg['version'] == '0.8.3', pkg['version'])

must = [
    'app/resources/app/main.js',
    'app/resources/app/preload.js',
    # 本版新增/改动的模块
    'app/resources/app/lib/git-ipc.js',
    'app/resources/app/lib/browser-ipc.js',
    'app/resources/app/lib/contrast.js',
    'app/resources/app/lib/web-themes.js',
    'app/resources/app/lib/theme-ipc.js',
    'app/resources/app/lib/theme-analysis.js',
    'app/resources/app/renderer/git-bar.js',
    'app/resources/app/renderer/quick-actions.js',
    'app/resources/app/renderer/panels.js',
    'app/resources/app/renderer/theme-studio.js',
    'app/resources/app/renderer/index.html',
    'app/resources/app/renderer/styles.css',
    'app/resources/app/DSH.ico',
    'app/ico/0.8.3/DSH.ico',
]
for m in must:
    check('含 ' + m.replace('app/resources/app/', 'res/'), m in names)

repo_ico = open(os.path.join(REPO, 'DSH.ico'), 'rb').read()
check('包内 app/DSH.ico = 仓库新图标', zf.read('app/DSH.ico') == repo_ico)
check('包内 app/ico/0.8.3/DSH.ico = 仓库新图标', zf.read('app/ico/0.8.3/DSH.ico') == repo_ico)

def res(p):
    return zf.read('app/resources/app/' + p).decode('utf-8')

git = res('lib/git-ipc.js')
browser = res('lib/browser-ipc.js')
contrast = res('lib/contrast.js')
web = res('lib/web-themes.js')
html = res('renderer/index.html')
css = res('renderer/styles.css')
qjs = res('renderer/quick-actions.js')
panels = res('renderer/panels.js')
main = res('main.js')
studio = res('renderer/theme-studio.js')

print('=== 本版能力逐项进包 ===')
check('Git：IPC 模块 + 白名单', 'isValidBranchName' in git and 'git:createBranch' in git)
check('Git：路径包含判断（Windows 正斜杠）', 'function isInside' in git)
check('Git：动态白名单（引擎工作区目录）', 'listWorkspaceDirs' in git)
check('浏览器：WebContentsView', 'WebContentsView' in browser and 'browser:setBounds' in browser)
check('浏览器：URL 白名单（拒 javascript:/data:）', 'normalizeUrl' in browser and 'javascript' not in browser.split('normalizeUrl')[0][-200:])
check('对比度：护栏 + 默认值解析', 'ensureReadable' in contrast and 'collectDesktopTokenDefaults' in web)
check('对比度：护栏接进净化管线', 'applyContrastGuard' in res('lib/theme-analysis.js'))
check('主题：扫描根逐根体检', 'pluginRootReports' in web)
check('主题：DSH_HOME 认环境变量', 'process.env.DSH_HOME' in main)
check('UI：侧边预览是右侧面板图标（非 ＋）', 'qa-toggle' in html and '<svg' in html.split('ctQuickBtn')[1][:600])
check('UI：侧边预览按钮有按下态', 'aria-pressed' in html and 'syncToggle' in qjs)
check('UI：右侧列搬进 .chat-shell', "classList.contains('chat-shell')" in qjs or "querySelector('.chat-shell')" in qjs)
check('UI：面板不再是 fixed 浮层', '.qa-dock-body > #qaPanel' in css and 'position: static' in css.split('.qa-dock-body > #qaPanel')[1][:200])
check('UI：产物卡片（图标/体积/操作）', 'cd-file-card' in css and 'cd-file-icon' in panels and 'filesStat' in panels)
check('UI：产物右键菜单 + 复制路径', 'copyPath' in panels and 'hostShowInFolder' in panels)
check('UI：会话行显示真实目录', 'cs-path' in css and 'chatDefaultDir' in res('renderer/chat.js'))
check('UI：未归入工作区 + 归入动作', 'session.action.assignWorkspace' in res('renderer/locales/zh-CN.js'))
check('UI：消息区质量层（14.5px/12.5px）', '对话区质量升级' in css and 'font-size: 14.5px' in css and '12.5px' in css)
check('UI：角色行', 'msg-role' in css and 'ensureRoleRow' in res('renderer/chat.js'))
check('主题页：扫描目录状态 + 手动添加', 'ts-roots' in css and 'ts-root-add' in studio)
check('CSP：img-src 含 file:', "img-src 'self' data: file:" in html)

strays = [n for n in names if re.search(r'(fix-icon|make-icons|_probe|_seg|dbg-|dist/market-scan|icon-work)', n)]
check('包内没有调试临时文件', not strays, str(strays[:5]))

print()
print(f'zip 条目 {len(names)} 个 | zip {os.path.getsize(ZIP)/1024/1024:.1f} MB')
print('SUCCESS: 产物校验全部通过' if not fail else f'FAILED: {len(fail)} 项 -> {fail}')
