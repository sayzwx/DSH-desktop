# Build the DSH Desktop distributables (installer style):
#   DSH-Desktop-v<ver>.zip / -Setup.exe : app package incl. portable Node
#   (desktop UI + Electron runtime + installer + bundled tools\node; ~250 MB)
#   The heavy harness engine is NOT packaged: setup.exe pulls it from the official
#   deepseek-ai/DeepSeek-Harness source at install time (see installer\setup.ps1).
#   Bundled portable Node: shipped inside the package and installed to
#   %LOCALAPPDATA%\DSH\tools\node — the desktop and the engine use it first,
#   so the target machine needs NO system Node at all.
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-dist.ps1 [-Version 0.2.1] [-NodeVersion v22.23.2] [-Root C:\path\to\repo]
param(
  [string]$Version = '0.2.1',
  [string]$NodeVersion = 'v22.23.2',  # 自带便携 Node 版本（随包分发，替换本机 Node 依赖）
  [string]$Root = ''   # 仓库根目录，默认取脚本所在目录的上级（scripts 的父目录）
)
$ErrorActionPreference = 'Stop'
if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
$root = $Root
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

# 获取/复用便携 Node（nodejs.org 官方 zip；构建机缓存到 dist\node-cache，
# 内容打进安装包 tools\node —— 目标机器不再需要本机 Node 环境）
function Get-BundledNode([string]$nodeVer) {
  $cache = Join-Path $dist 'node-cache'
  $cacheExe = Join-Path $cache "node-$nodeVer-win-x64\node.exe"
  if (-not (Test-Path $cacheExe)) {
    $zip = Join-Path $cache "node-$nodeVer-win-x64.zip"
    New-Item -ItemType Directory -Path $cache -Force | Out-Null
    if (-not (Test-Path $zip)) {
      Write-Host "downloading Node.js $nodeVer (official nodejs.org, ~30 MB, cached at dist\node-cache) ..."
      $url = "https://nodejs.org/dist/$nodeVer/node-$nodeVer-win-x64.zip"
      $i = 0; $ok = $false
      do {
        try { Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing; $ok = $true }
        catch {
          $i++
          if ($i -ge 3) { throw "Node.js 下载失败: $($_.Exception.Message)" }
          Write-Host "  attempt $i failed, retrying ..."; Start-Sleep -Seconds 3
        }
      } while (-not $ok)
    }
    Write-Host "extracting portable Node $nodeVer ..."
    Expand-Archive -Path $zip -DestinationPath $cache -Force
  }
  return $cacheExe
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

# 应用本体 → resources\app（剔除 .git / dist / electron 运行时 / 大体积非必需资源）
$resApp = Join-Path $appDir 'resources\app'
New-Item -ItemType Directory -Path $resApp -Force | Out-Null
robocopy $root $resApp /E /XD "$root\.git" "$root\dist" "$root\node_modules\electron" "$root\wallpaper-engine" /XF "*.mp4" /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'robocopy app failed' }
# 动态星空背景（renderer\bg-animated.mp4，~45MB）若存在则放回应用资源（可选动画背景，
# 体积敏感可自行从仓库删掉该文件后再打包——删除后 UI 自动回落静态星空背景）
$bgAni = Join-Path $root 'renderer\bg-animated.mp4'
if (Test-Path $bgAni) {
  Copy-Item $bgAni (Join-Path $resApp 'renderer\bg-animated.mp4') -Force
}
# 紫月主题背景（renderer\bg-moon-loop.mp4，无缝循环视频）一并放回，否则 紫月 主题会因
# 缺少视频文件而显示空白。
$bgMoon = Join-Path $root 'renderer\bg-moon-loop.mp4'
if (Test-Path $bgMoon) {
  Copy-Item $bgMoon (Join-Path $resApp 'renderer\bg-moon-loop.mp4') -Force
}

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

# 自带便携 Node：装进安装包 tools\node —— 安装器会搬到 %LOCALAPPDATA%\DSH\tools\node，
# 桌面端启动与引擎安装都优先使用它，本机不需要任何 Node 环境
Write-Host '=== Bundling portable Node.js (tools\\node) ==='
$nodeExe = Get-BundledNode $NodeVersion
$stageTools = Join-Path $stage 'tools\node'
robocopy (Split-Path -Parent $nodeExe) $stageTools /E /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'staging bundled node failed' }
Write-Host ("  bundled Node: {0:N0} MB" -f ((Get-ChildItem $stageTools -Recurse -File | Measure-Object Length -Sum).Sum / 1MB))

$zip = Join-Path $dist "$name.zip"
Make-Zip $stage $zip

# ---------- 2. self-extracting Setup.exe (7-Zip SFX, LZMA2 - small) ----------
Write-Host "=== Building $name-Setup.exe (7-Zip SFX) ==="
$sz7 = ''
foreach ($p in @('D:\7-Zip\7z.exe', 'C:\Program Files\7-Zip\7z.exe', 'C:\Program Files (x86)\7-Zip\7z.exe', 'D:\Program Files\7-Zip\7z.exe')) { if (Test-Path $p) { $sz7 = $p; break } }
if (-not $sz7) {
  $w = (Get-Command 7z -ErrorAction SilentlyContinue).Source
  if ($w) { $sz7 = $w }
}
$sfx = if ($sz7) { Join-Path (Split-Path -Parent $sz7) '7z.sfx' } else { '' }
if (-not $sz7 -or -not (Test-Path $sfx)) {
  Write-Host '7-Zip not found - Setup.exe skipped (zip is the deliverable)'
} else {
  $sz7file = Join-Path $dist "$name.7z"
  Remove-Item $sz7file -Force -ErrorAction SilentlyContinue   # 7z a 是追加模式，先删旧档避免体积翻倍
  Push-Location $stage
  & $sz7 a -t7z -mx=9 -m0=LZMA2 -bso0 -bsp0 $sz7file '*' | Out-Null
  Pop-Location
  if ($LASTEXITCODE -ne 0) { throw '7z failed' }
  $cfg = Join-Path $dist 'sfx-config.txt'
  # InstallPath 指向固定安装暂存目录（%%LOCALAPPDATA%% 需要 7-Zip 21.02+；
  #   旧版 7-Zip 回退为解压到当前目录的旧行为）。GUIMode=1 提供安装器风格的进度对话框。
  $cfgLines = @(
    ';!@Install@!UTF-8!',
    'Title="DSH Desktop Installer"',
    'GUIMode="1"',
    'RunProgram="setup.bat"',
    ';!@InstallEnd@!'
  )
  $verLine = & $sz7 i 2>$null | Select-String '^7-Zip (\d+)\.' | Select-Object -First 1
  $szMajor = if ($verLine -and $verLine.Matches.Count -gt 0) { [int]$verLine.Matches[0].Groups[1].Value } else { 0 }
  if ($szMajor -ge 21) {
    $cfgLines = @(
      ';!@Install@!UTF-8!',
      'Title="DSH Desktop Installer"',
      'GUIMode="1"',
      'InstallPath="%%LOCALAPPDATA%%\DSH\stage"',
      'RunProgram="setup.bat"',
      ';!@InstallEnd@!'
    )
  } else {
    Write-Host 'WARN: 7-Zip < 21.02，SFX 不支持 InstallPath 环境变量展开，回退为解压到当前目录'
  }
  Set-Content -Path $cfg -Encoding ASCII -Value $cfgLines
  $exeOut = Join-Path $dist "$name-Setup.exe"
  cmd /c "copy /b `"$sfx`" + `"$cfg`" + `"$sz7file`" `"$exeOut`" >nul"
  if ($LASTEXITCODE -ne 0) { throw 'copy /b sfx failed' }
  Remove-Item $cfg -Force -ErrorAction SilentlyContinue
  Write-Host ("  {0:N0} MB" -f ((Get-Item $exeOut).Length / 1MB))
}
Write-Host "=== Done ==="
Get-ChildItem $dist -File | Select-Object Name, @{N='MB';E={[math]::Round($_.Length/1MB,1)}} | Format-Table -AutoSize
