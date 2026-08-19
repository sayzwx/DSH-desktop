# Build the DSH Desktop distributables (small installer style):
#   DSH-Desktop-v<ver>.zip / -Setup.exe : small app package
#   (desktop UI + Electron runtime + installer; ~220 MB, like any Electron app)
#   The heavy harness engine is NOT packaged: setup.exe pulls it from the official
#   deepseek-ai/DeepSeek-Harness source at install time (see installer\setup.ps1).
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-dist.ps1
param([string]$Version = '0.2.0')
$ErrorActionPreference = 'Stop'
$root = 'D:\DSH-desktop'
$dist = Join-Path $root 'dist'
$name = "DSH-Desktop-v$Version"

# 编码防线：打包前强制检查，乱码/错误编码一律不放行
Write-Host '=== 编码检查 (scripts\check-encoding.ps1) ==='
& (Join-Path $root 'scripts\check-encoding.ps1')
if ($LASTEXITCODE -ne 0) { throw '编码检查未通过，请先修复（可运行 scripts\check-encoding.ps1 -Fix）' }

function Copy-Tree([string]$from, [string]$to, [string[]]$xd) {
  Write-Host "staging $from -> $to"
  $roboArgs = @($from, $to, '/E', '/MT:16', '/NFL', '/NDL', '/NJH', '/NJS', '/R:1', '/W:1')
  foreach ($d in $xd) { $roboArgs += @('/XD', $d) }
  robocopy @roboArgs | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $from" }
}

function Make-Zip([string]$stage, [string]$zip) {
  Write-Host "zipping -> $zip ..."
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal -Force
  Write-Host ("  {0:N0} MB" -f ((Get-Item $zip).Length / 1MB))
}

# ---------- 1. small app package ----------
# 标准应用布局（双击 app\DSH.exe 即启动，无需命令行参数）：
#   app\DSH.exe                 = Electron 运行时重命名
#   app\resources\electron.asar = Electron 运行时内核
#   app\resources\app\          = 应用本体（package.json / main.js / renderer / 依赖）
#   app\DSH.ico                 = 图标（快捷方式使用）
Write-Host "=== Building $name (app only) ==="
$stage = Join-Path $dist "stage\$name"
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stage -Force | Out-Null

$eleDist = Join-Path $root 'node_modules\electron\dist'
if (-not (Test-Path (Join-Path $eleDist 'electron.exe'))) { throw '缺少 node_modules\electron\dist\electron.exe：请先运行 setup.ps1（npm ci）安装依赖' }
$appDir = Join-Path $stage 'app'
robocopy $eleDist $appDir /E /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'robocopy electron dist failed' }
Move-Item (Join-Path $appDir 'electron.exe') (Join-Path $appDir 'DSH.exe') -Force
Copy-Item (Join-Path $root 'DSH.ico') (Join-Path $appDir 'DSH.ico') -Force

# 应用本体 → resources\app（剔除 .git / dist / electron 运行时自身）
$resApp = Join-Path $appDir 'resources\app'
New-Item -ItemType Directory -Path $resApp -Force | Out-Null
robocopy $root $resApp /E /XD "$root\.git" "$root\dist" "$root\node_modules\electron" /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'robocopy app failed' }

$cfg = Join-Path $stage 'config'
New-Item -ItemType Directory -Path $cfg -Force | Out-Null
# 默认配置必须用仓库内置的纯净模板（config\settings.yaml），绝不能读取/打包开发者本机的
# ~/.dsh\settings.yaml 或 .github-token 等个人文件（避免把个人提供商/密钥引用泄露给每个用户）。
Copy-Item (Join-Path $root 'config\settings.yaml') (Join-Path $cfg 'settings.yaml') -Force
# zen-ua-proxy 是可选启动代理脚本：仅当仓库确实带有模板时才随包分发（不读取 ~/.dsh 个人副本）
if (Test-Path (Join-Path $root 'config\zen-ua-proxy.mjs')) {
  Copy-Item (Join-Path $root 'config\zen-ua-proxy.mjs') (Join-Path $cfg 'zen-ua-proxy.mjs') -Force
}
Copy-Item (Join-Path $root 'installer\setup.ps1')    (Join-Path $stage 'setup.ps1') -Force
Copy-Item (Join-Path $root 'installer\setup.bat')    (Join-Path $stage 'setup.bat') -Force
# 环境预检 / Node 修复脚本（setup.ps1 的 Get-NodeExe 与应用内自动获取共用）
Copy-Item (Join-Path $root 'installer\check-env.ps1') (Join-Path $stage 'check-env.ps1') -Force
# 说明文档（中文名）随构建复制；编码由 scripts\check-encoding.ps1 统一把关
Get-ChildItem (Join-Path $root 'installer') -Filter '*.txt' | Copy-Item -Destination $stage -Force
$zip = Join-Path $dist "$name.zip"
Make-Zip $stage $zip

# ---------- 2. self-extracting Setup.exe (7-Zip SFX, LZMA2 - small) ----------
Write-Host "=== Building $name-Setup.exe (7-Zip SFX) ==="
$sz7 = 'D:\7-Zip\7z.exe'
$sfx = 'D:\7-Zip\7z.sfx'
if (-not (Test-Path $sz7) -or -not (Test-Path $sfx)) {
  Write-Host '7-Zip not found - Setup.exe skipped (zip is the deliverable)'
} else {
  $sz7file = Join-Path $dist "$name.7z"
  Remove-Item $sz7file -Force -ErrorAction SilentlyContinue   # 7z a 是追加模式，先删旧档避免体积翻倍
  Push-Location $stage
  & $sz7 a -t7z -mx=9 -m0=LZMA2 -bso0 -bsp0 $sz7file '*' | Out-Null
  Pop-Location
  if ($LASTEXITCODE -ne 0) { throw '7z failed' }
  $cfg = Join-Path $dist 'sfx-config.txt'
  Set-Content -Path $cfg -Encoding ASCII -Value @(
    ';!@Install@!UTF-8!',
    'Title="DSH Desktop Installer"',
    'RunProgram="setup.bat"',
    ';!@InstallEnd@!'
  )
  $exeOut = Join-Path $dist "$name-Setup.exe"
  cmd /c "copy /b `"$sfx`" + `"$cfg`" + `"$sz7file`" `"$exeOut`" >nul"
  if ($LASTEXITCODE -ne 0) { throw 'copy /b sfx failed' }
  Remove-Item $cfg -Force -ErrorAction SilentlyContinue
  Write-Host ("  {0:N0} MB" -f ((Get-Item $exeOut).Length / 1MB))
}
Write-Host "=== Done ==="
Get-ChildItem $dist -File | Select-Object Name, @{N='MB';E={[math]::Round($_.Length/1MB,1)}} | Format-Table -AutoSize
