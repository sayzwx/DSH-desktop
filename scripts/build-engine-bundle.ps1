# DSH Desktop —— 引擎离线包（P0 · 官方同款：引擎 = 普通 npm 依赖）
#
# 为什么这样做（对官方社区版 dsh-desktop 的逆向结论，2026-10-09）：
#   官方把整颗 Harness 引擎作为 **已发布的 npm 包**（@deepseek-ai/dsh-*）打进安装包，
#   首次运行只是把这些包硬链接进 profile —— 没有"从源码构建"这一步，所以一个安装包就够。
#   我们照做：npm 装一份引擎到 dist\engine-npm，build-dist.ps1 再把它放进安装包 payload。
#   好处：① 产出是**平铺、无符号链接**的 node_modules（zip/Inno 可携带）；
#         ② 版本来自官方 npm，天然对齐官方发布；
#         ③ 全程不需要 pnpm workspace / 源码构建。
#
# 版本策略（"官方更新检测"的打包侧）：
#   默认 -Version latest → 查 npm registry 上 @deepseek-ai/dsh 的最新 tag；
#   也可显式 -Version 0.1.7-rc.2 钉版。装完打印实际版本，便于核对。
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-engine-bundle.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-engine-bundle.ps1 -Version 0.1.7-rc.2
param(
  [string]$Version = 'latest',
  [string]$Out = 'D:\DS_harness\dist\engine-npm',
  [string]$NpmRegistry = ''
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$pkg = '@deepseek-ai/dsh'
$pkgDir = $pkg.Replace('/', '\')

function Get-NodeExe {
  $cands = @(
    (Join-Path $env:LOCALAPPDATA 'DSH\tools\node\node.exe'),
    'C:\Program Files\nodejs\node.exe'
  )
  foreach ($c in $cands) { if (Test-Path $c) { return $c } }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw '本机找不到 node（需要 node 来跑 npm）'
}
$nodeExe = Get-NodeExe
$npmCli = Join-Path (Split-Path -Parent $nodeExe) 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path $npmCli)) { throw "找不到 npm-cli.js（$npmCli）：请确认 node 安装完整" }

Write-Host ("=== 构建引擎离线包（{0}@{1}）===" -f $pkg, $Version)
New-Item -ItemType Directory -Path $Out -Force | Out-Null

# 版本解析：latest → 问 registry 要准确版本号（写进 package.json，锁定可复现）
$resolved = $Version
if ($Version -eq 'latest') {
  $regArgs = @($npmCli, 'view', $pkg, 'version')
  if ($NpmRegistry) { $regArgs += "--registry=$NpmRegistry" }
  $resolved = (& $nodeExe @regArgs 2>$null | Select-Object -Last 1).Trim()
  if (-not $resolved) { throw '未能从 npm 取到最新版本号（网络受限？可用 -Version 显式指定）' }
  Write-Host "  官方最新版本：$resolved"
}

# 安装清单（引擎目录 = 一个普通 npm 项目根；依赖精确锁版）
$manifest = [ordered]@{
  name         = 'dsh-engine'
  version      = '1.0.0'
  private      = $true
  dependencies = [ordered]@{ $pkg = $resolved }
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $Out 'package.json') -Encoding UTF8

Write-Host '  安装依赖（npm install --omit=dev）…'
$env:CI = 'true'
Push-Location $Out
try {
  $args = @($npmCli, 'install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error')
  if ($NpmRegistry) { $args += "--registry=$NpmRegistry" }
  & $nodeExe @args
  if ($LASTEXITCODE -ne 0) { throw "npm install 失败（exit=$LASTEXITCODE）" }
} finally { Pop-Location }

# 校验：npm 形态入口 + 实际版本
$bin = Join-Path $Out "node_modules\$pkgDir\lib\bin.js"
if (-not (Test-Path $bin)) { throw "引擎入口缺失：$bin" }
$installed = (Get-Content (Join-Path $Out "node_modules\$pkgDir\package.json") -Raw | ConvertFrom-Json).version
$nm = Join-Path $Out 'node_modules'
$topCount = (Get-ChildItem $nm -Directory).Count
$sizeMB = [math]::Round((Get-ChildItem $Out -Recurse -File | Measure-Object Length -Sum).Sum / 1MB)
$links = (Get-ChildItem $nm -Recurse -Force -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.LinkType -in @('SymbolicLink', 'Junction') } | Measure-Object).Count

Write-Host ("完成：引擎 v{0} 已就位于 {1}（{2} 个顶层包，{3} MB，链接 {4} 个）" -f $installed, $Out, $topCount, $sizeMB, $links)
if ($installed -ne $resolved) { Write-Host "  注意：装到的版本 ($installed) 与请求 ($resolved) 不一致" -ForegroundColor Yellow }
if ($links -gt 0) { Write-Host "  警告：检出 $links 个符号链接/联接（打包前应确认可被 zip/Inno 携带）" -ForegroundColor Yellow }
