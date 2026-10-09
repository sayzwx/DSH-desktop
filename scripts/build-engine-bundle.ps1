# DSH Desktop —— 引擎离线打包（P0：打包时构建、安装时展开）
# 从本机已构建好的引擎（默认 D:\DSH\harness）产出**无符号链接的平铺引擎树**并压缩为 engine.zip。
# 为什么必须平铺：引擎是 pnpm 布局（node_modules 顶层全是 junction），zip/Inno 无法携带链接；
# 用 pnpm install --shamefully-hoist 在暂存副本里重装（--offline 走本地 store），得到自包含树。
# 产物：dist\engine\engine.zip（setup.ps1 / build-dist.ps1 会把它展开为 <安装根>\harness）。
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-engine-bundle.ps1
param(
  [string]$Source = 'D:\DSH\harness',
  [string]$Out    = 'D:\DS_harness\dist\engine'
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

if (-not (Test-Path (Join-Path $Source 'apps\cli\lib\bin.js'))) { throw "源引擎缺少构建产物：$Source\apps\cli\lib\bin.js（请先在源引擎目录完成构建）" }

$stage = Join-Path $Out 'harness'
New-Item -ItemType Directory -Path $stage -Force | Out-Null

Write-Host '[1/4] 复制源码与构建产物（排除 node_modules / .git）…'
# /XD 排除 node_modules（后面用 shamefully-hoist 重装）与 .git；apps/packages 等原样带走
robocopy $Source $stage /E /MT:16 /NFL /NDL /NJH /NJS /R:1 /W:1 /XD node_modules .git .pnpm-store dist-engine | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy 失败（exit=$LASTEXITCODE）" }

Write-Host '[2/4] 去引用复制 node_modules（跟随 junction，得到自包含树）…'
# 为什么不用 pnpm install 重装：workspace 包的 postinstall 在平铺布局下会 ERR_MODULE_NOT_FOUND。
# robocopy 不带 /XJ → 跟随 junction 把真实内容落到对应位置，Node 的逐级解析天然成立。
robocopy (Join-Path $Source 'node_modules') (Join-Path $stage 'node_modules') /E /MT:16 /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
if ($LASTEXITCODE -ge 8) { throw "node_modules 复制失败（exit=$LASTEXITCODE）" }

Write-Host '[3/4] 校验引擎完整性…'
$bin  = Join-Path $stage 'apps\cli\lib\bin.js'
$webd = Join-Path $stage 'apps\web\dist\index.html'
foreach ($f in @($bin, $webd)) { if (-not (Test-Path $f)) { throw "平铺引擎缺构建产物：$f" } }

Write-Host '[4/4] 压缩为 engine.zip …'
$zip = Join-Path $Out 'engine.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal

$rawMB  = [math]::Round((Get-ChildItem $stage -Recurse -File | Measure-Object Length -Sum).Sum / 1MB)
$zipMB  = [math]::Round((Get-Item $zip).Length / 1MB)
Write-Host ("完成：{0}（平铺 {1} MB → engine.zip {2} MB）" -f $zip, $rawMB, $zipMB)
