# -*- coding: utf-8 -*-
"""发版产物校验：Setup.exe 的 PE 头/版本、zip 内的版本号与关键文件、图标是否为新版。"""
import hashlib
import json
import os
import re
import struct
import zipfile

DIST = r'D:\DS_harness\dist'
ZIP = os.path.join(DIST, 'DSH-Desktop-v0.8.1.zip')
EXE = os.path.join(DIST, 'DSH-Desktop-v0.8.1-Setup.exe')
REPO_ICO = r'D:\DS_harness\DSH.ico'

fail = []
def check(name, cond, detail=''):
    print(('  OK   ' if cond else '  FAIL ') + name + (f'  {detail}' if detail else ''))
    if not cond:
        fail.append(name)

print('=== Setup.exe ===')
with open(EXE, 'rb') as f:
    head = f.read(2)
check('PE 头是 MZ', head == b'MZ', repr(head))
size_exe = os.path.getsize(EXE)
print(f'  体积 {size_exe/1024/1024:.1f} MB')

# ISS 里 ProductVersion 由 Inno 写入版本资源（Windows 资源是 UTF-16LE，别只搜 ASCII）
with open(EXE, 'rb') as f:
    blob = f.read()
v_utf16 = blob.find('0.8.1'.encode('utf-16le'))
v_ascii = blob.find(b'0.8.1')
check('安装包内含 0.8.1 版本串（UTF-16LE 资源）', v_utf16 > 0 or v_ascii > 0, f'utf16@{v_utf16}')
check('安装包内不含 0.8.0（两种编码都查）',
      blob.find('0.8.0'.encode('utf-16le')) < 0 and blob.find(b'0.8.0') < 0)

print('=== zip ===')
zf = zipfile.ZipFile(ZIP)
names = zf.namelist()
check('zip 根目录是 app/', names[0].startswith('app/'), names[0])
check('含 app/resources/app/package.json', 'app/resources/app/package.json' in names)
pkg = json.loads(zf.read('app/resources/app/package.json').decode('utf-8'))
check('package.json version = 0.8.1', pkg['version'] == '0.8.1', pkg['version'])

must = [
    'app/resources/app/main.js',
    'app/resources/app/preload.js',
    'app/resources/app/lib/web-themes.js',
    'app/resources/app/lib/theme-analysis.js',
    'app/resources/app/lib/theme-ipc.js',
    'app/resources/app/renderer/dashboard.js',
    'app/resources/app/renderer/market.js',
    'app/resources/app/renderer/theme-studio.js',
    'app/resources/app/renderer/styles.css',
    'app/resources/app/DSH.ico',
]
for m in must:
    check('含 ' + m.replace('app/resources/app/', ''), m in names)

# 图标必须是本次换的新图标（与仓库 DSH.ico 字节一致）
ico_in_zip = zf.read('app/resources/app/DSH.ico')
repo_ico = open(REPO_ICO, 'rb').read()
check('包内 DSH.ico 与仓库新图标一致', ico_in_zip == repo_ico,
      f'zip {len(ico_in_zip)}B vs repo {len(repo_ico)}B')

# 关键修复：引擎启动参数必须带 --no-open
main_src = zf.read('app/resources/app/main.js').decode('utf-8')
check('main.js 含 --no-open（静默启动修复）', "'--no-open'" in main_src)
check('main.js 含引擎能力探测', 'engineSupportsNoOpen' in main_src)
# 浅色修复：卡片底色
css = zf.read('app/resources/app/renderer/styles.css').decode('utf-8')
check('styles.css 含浅色卡片灰 #f5f6f7', '--panel: #f5f6f7' in css)
check('styles.css 含浅色弹窗遮罩修正', '[data-theme="light"] .modal-overlay' in css)
# 图表配色不再硬编码（注释里提到旧色值是说明，要先把注释去掉再判）
dash = zf.read('app/resources/app/renderer/dashboard.js').decode('utf-8')
dash_code = re.sub(r'/\*[\s\S]*?\*/', '', re.sub(r'//[^\n]*', '', dash))
check('dashboard.js 代码里不再硬编码旧色板',
      '#e8f4f8' not in dash_code and '#6b7b8d' not in dash_code and 'getPropertyValue' in dash_code)
# skin 承接
ta = zf.read('app/resources/app/lib/theme-analysis.js').decode('utf-8')
check('theme-analysis.js 含 skin 全文承接', 'analyzeSkin' in ta and 'sanitizeAssetUrl' in ta)

# 临时文件不该进包
strays = [n for n in names if re.search(r'(fix-icon|make-icons|measure-icon|analyze-icon|icon-\d+\.png|_probe|_seg|dbg-)', n)]
check('包内没有本次调试的临时文件', not strays, str(strays[:5]))

print()
print(f'zip 条目 {len(names)} 个 | zip {os.path.getsize(ZIP)/1024/1024:.1f} MB')
print('SUCCESS: 产物校验全部通过' if not fail else f'FAILED: {len(fail)} 项未通过 -> {fail}')
