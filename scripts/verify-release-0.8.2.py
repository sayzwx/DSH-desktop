#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v0.8.2 发版产物校验。
继承 verify-release-0.8.1 的两课：版本串在 Windows 资源里是 UTF-16LE（别只搜 ASCII）；
判"不再硬编码"要先剥注释。新增本轮修复的断言（六种形态 / 精修净化 / 背景承接 / CSP / 图标版本化路径）。"""
import json
import os
import re
import zipfile

DIST = r'D:\DS_harness\dist'
ZIP = os.path.join(DIST, 'DSH-Desktop-v0.8.2.zip')
EXE = os.path.join(DIST, 'DSH-Desktop-v0.8.2-Setup.exe')
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
check('版本串 0.8.2 存在（UTF-16LE 资源）', blob.find('0.8.2'.encode('utf-16le')) > 0)
check('不含 0.8.1（两种编码）',
      blob.find('0.8.1'.encode('utf-16le')) < 0 and blob.find(b'0.8.1') < 0)
print(f'  体积 {len(blob)/1024/1024:.1f} MB')

print('=== zip ===')
zf = zipfile.ZipFile(ZIP)
names = zf.namelist()
check('zip 根目录是 app/', names[0].startswith('app/'), names[0])
pkg = json.loads(zf.read('app/resources/app/package.json').decode('utf-8'))
check('package.json version = 0.8.2', pkg['version'] == '0.8.2', pkg['version'])

must = [
    'app/resources/app/main.js',
    'app/resources/app/lib/web-themes.js',
    'app/resources/app/lib/theme-analysis.js',
    'app/resources/app/lib/theme-ipc.js',
    'app/resources/app/renderer/index.html',
    'app/resources/app/renderer/styles.css',
    'app/resources/app/renderer/app.js',
    'app/resources/app/renderer/theme-studio.js',
    'app/resources/app/DSH.ico',
    'app/DSH.ico',
    'app/ico/0.8.2/DSH.ico',
]
for m in must:
    check('含 ' + m.replace('app/resources/app/', 'res/'), m in names)

# 图标三处一致（仓库 / 包根 / ico/版本）
repo_ico = open(os.path.join(REPO, 'DSH.ico'), 'rb').read()
check('包内 app/DSH.ico = 仓库新图标', zf.read('app/DSH.ico') == repo_ico)
check('包内 app/ico/0.8.2/DSH.ico = 仓库新图标', zf.read('app/ico/0.8.2/DSH.ico') == repo_ico)

# 本轮修复逐项进包验证
web = zf.read('app/resources/app/lib/web-themes.js').decode('utf-8')
ta = zf.read('app/resources/app/lib/theme-analysis.js').decode('utf-8')
ti = zf.read('app/resources/app/lib/theme-ipc.js').decode('utf-8')
html = zf.read('app/resources/app/renderer/index.html').decode('utf-8')
css = zf.read('app/resources/app/renderer/styles.css').decode('utf-8')
appjs = zf.read('app/resources/app/renderer/app.js').decode('utf-8')
studio = zf.read('app/resources/app/renderer/theme-studio.js').decode('utf-8')

check('形态：入口按 package.json 解析', 'readPluginClientSources' in web)
check('形态：通用变量提取', 'function parseTokenMapsFromSource' in web)
check('形态：平台按产物推断', 'platformInferred' in web)
check('形态：CSS 文件型（collectPackageCss）', 'function collectPackageCss' in web)
check('形态：官方 @deepseek-ai/* 全排除', '/^@deepseek-ai\\//.test(id)' in web)
check('精修：净化接受桌面端变量', 'collectDesktopTokenNames' in ta and '不在桌面端变量表里' in ta)
check('精修：提示词写明两类 token', '--dsw-* 或桌面端变量' in ta)
check('精修：应用端放行桌面端变量', 'isDesktop' in appjs and 'getPropertyValue(k)' in appjs)
check('背景：#themeBg 挂载点（DOM+样式）', 'id="themeBg"' in html and '#themeBg {' in css)
check('背景：免费承接（detectPageBackground）', 'function detectPageBackground' in web and 'buildBackgroundCss' in web)
check('背景：tczp 预设承接', '.tczp' in web)
check('背景：背景规则不被提前 return 挡住', web.index('if (!candidates.length) return null;') > web.index('⑤ 预设文件形态'))
check('CSP：img-src 含 file:', "img-src 'self' data: file:" in html)
check('CSP：font-src 含 file:', "font-src 'self' file:" in html)
check('界面：精修失败如实汇报', '模型没有产出可用内容' in studio)

strays = [n for n in names if re.search(r'(fix-icon|make-icons|_probe|_seg|dbg-|dist/market-scan|icon-work|1-clean|1-mask)', n)]
# 注：scripts/ 历来随包发（v0.8.1 就有 82 个条目，含开发脚本与临时 png），属既有打包行为；
# market-theme-coverage.cjs 一并带上无害（应用从不执行它）。后续可考虑整目录排除。
check('包内没有调试临时文件（scripts/ 随包发属既有行为）', not strays, str(strays[:5]))

print()
print(f'zip 条目 {len(names)} 个 | zip {os.path.getsize(ZIP)/1024/1024:.1f} MB')
print('SUCCESS: 产物校验全部通过' if not fail else f'FAILED: {len(fail)} 项 -> {fail}')
