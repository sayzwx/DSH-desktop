# DSH Desktop one-click installer.
# 设计：Setup.exe 只包含桌面端 app（Electron 运行时，约 220MB）。
# 重型 Harness 引擎不打包、不托管：安装时从 DeepSeek 官方源自动拉取
# （官方源码 + 官方 Node 运行时），在本机完成依赖安装与构建（一次性）。
# 需要网络：github.com（源码）/ nodejs.org（Node）/ npm registry（pnpm 依赖）。
# 网络受限时可传 -NpmRegistry 指定镜像（如 https://registry.npmmirror.com）。
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" [-SkipHarness]
param(
  [string]$HarnessSource = 'https://github.com/deepseek-ai/DeepSeek-Harness/archive/refs/tags/dsh-v0.1.0-rc.7.zip',
  [string]$HarnessGit    = 'https://github.com/deepseek-ai/DeepSeek-Harness.git',
  [string]$HarnessBranch = 'dsh-v0.1.0-rc.7',
  [string]$NodeVersion   = 'v22.23.2',
  [string]$NpmRegistry   = '',   # 例：https://registry.npmmirror.com（npm 网络受限时）
  [switch]$SkipHarness
)
$ErrorActionPreference = 'Stop'
$Dest     = Join-Path $env:LOCALAPPDATA 'DSH'
$UserHome = $env:USERPROFILE  # 不要用 $Home：$HOME 是 PowerShell 只读自动变量
$Src      = Split-Path -Parent $MyInvocation.MyCommand.Path

function Copy-Tree([string]$from, [string]$to) {
  Write-Host "  -> $to"
  robocopy $from $to /E /MT:16 /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $from -> $to" }
}

# 确保 Node >= 22：优先 %LOCALAPPDATA%\DSH\tools\node，其次系统 node，最后下载官方 Node。
function Get-NodeExe {
  $candidate = Join-Path $Dest 'tools\node\node.exe'
  if (Test-Path $candidate) { Write-Host '  using bundled node (tools\node)'; return $candidate }
  $sys = (Get-Command node -ErrorAction SilentlyContinue).Source
  if ($sys) {
    $ver = (& $sys -v 2>$null | Select-Object -First 1)
    if ($ver -match '^v?(\d+)\.') { if ([int]$Matches[1] -ge 22) { Write-Host "  using system node $ver"; return $sys } }
    Write-Host "  system node ($ver) 版本过低，需要 >= 22，改下载官方 Node。"
  }
  $url = "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip"
  Write-Host "  downloading Node.js $NodeVersion (official nodejs.org, ~30 MB) ..."
  $tmpZip = Join-Path $env:TEMP "node-$NodeVersion-win-x64.zip"
  $i = 0; $ok = $false
  do {
    try { Invoke-WebRequest -Uri $url -OutFile $tmpZip -UseBasicParsing; $ok = $true }
    catch {
      $i++
      if ($i -ge 3) { throw "Node.js 下载失败: $($_.Exception.Message)" }
      Write-Host "  attempt $i failed, retrying ..."; Start-Sleep -Seconds 3
    }
  } while (-not $ok)
  $tmpDir = Join-Path $env:TEMP "node-$NodeVersion-extract"
  Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive -Path $tmpZip -DestinationPath $tmpDir -Force
  New-Item -ItemType Directory -Path (Join-Path $Dest 'tools') -Force | Out-Null
  Move-Item (Join-Path $tmpDir "node-$NodeVersion-win-x64") (Join-Path $Dest 'tools\node') -Force
  Remove-Item $tmpZip -Force -ErrorAction SilentlyContinue
  Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
  return $candidate
}

# 从 DeepSeek 官方拉取引擎源码 + 依赖安装 + 构建（一次性）。
function Install-Harness([string]$NodeExe) {
  $harnessDir = Join-Path $Dest 'harness'
  $nodeDir    = Split-Path -Parent $NodeExe
  $got = $false
  if (Test-Path (Join-Path $harnessDir 'package.json')) {
    Write-Host '  harness source already present - reusing it'
    $got = $true
  } else {
    # 1) 官方源码：zip 优先，git clone 兜底
    $tmpZip = Join-Path $env:TEMP 'dsh-harness-src.zip'
    $tmpDir = Join-Path $env:TEMP 'dsh-harness-src'
    $i = 0
    do {
      try { Invoke-WebRequest -Uri $HarnessSource -OutFile $tmpZip -UseBasicParsing; $got = $true }
      catch { $i++; if ($i -ge 3) { break }; Write-Host "  zip attempt $i failed, retrying ..."; Start-Sleep -Seconds 3 }
    } while (-not $got)
    if ($got) {
      Write-Host '  extracting DeepSeek-Harness source (official github.com) ...'
      Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
      Expand-Archive -Path $tmpZip -DestinationPath $tmpDir -Force
      $inner = Get-ChildItem $tmpDir -Directory | Select-Object -First 1
      if (-not $inner) { throw '源码 zip 解压后未找到目录' }
      New-Item -ItemType Directory -Path $harnessDir -Force | Out-Null
      robocopy $inner.FullName $harnessDir /E /MT:16 /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
      if ($LASTEXITCODE -ge 8) { throw '源码解压失败' }
      Remove-Item $tmpZip -Force -ErrorAction SilentlyContinue
      Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    } else {
      Write-Host '  zip 下载失败，尝试 git clone（需要本机装有 git）...'
      $git = (Get-Command git -ErrorAction SilentlyContinue).Source
      if (-not $git) { throw '官方源码下载失败且未安装 git：请检查网络（需可访问 github.com），或用 -SkipHarness 后手动配置引擎。' }
      New-Item -ItemType Directory -Path $harnessDir -Force | Out-Null
      & $git clone --depth 1 --branch $HarnessBranch $HarnessGit $harnessDir
      if ($LASTEXITCODE -ne 0) { throw 'git clone 失败：请检查网络或 git 配置。' }
      $got = $true
    }
    if (-not (Test-Path (Join-Path $harnessDir 'package.json'))) { throw '引擎源码不完整：缺少 package.json' }
  }
  # 2) pnpm（corepack 随 Node 自带，按 package.json 的 packageManager 锁定版本）
  $corepack = Join-Path $nodeDir 'corepack.cmd'
  if (-not (Test-Path $corepack)) { $corepack = Join-Path $nodeDir 'corepack' }
  if ($NpmRegistry) { $env:COREPACK_NPM_REGISTRY = $NpmRegistry }
  Write-Host '  installing dependencies (pnpm install, 一次性, 可能数百 MB) ...'
  Push-Location $harnessDir
  try {
    & $corepack prepare pnpm@11.7.0 --activate
    if ($LASTEXITCODE -ne 0) { throw 'corepack 准备 pnpm 失败' }
    $pnpm = Join-Path $nodeDir 'pnpm.cmd'
    & $pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'pnpm install 失败（检查网络 / npm 源）' }
    Write-Host '  building harness (pnpm build, 一次性, 需数分钟) ...'
    & $pnpm build
    if ($LASTEXITCODE -ne 0) { throw 'pnpm build 失败' }
  } finally { Pop-Location }
  if (-not (Test-Path (Join-Path $harnessDir 'apps\cli\lib\bin.js'))) { throw '构建产物缺失：apps/cli/lib/bin.js' }
}

Write-Host ''
Write-Host '=============================================='
Write-Host '  DSH Desktop Installer (DSH Desktop UI)'
Write-Host '=============================================='
Write-Host ''
Write-Host "Installing to: $Dest"
New-Item -ItemType Directory -Path $Dest -Force | Out-Null

Write-Host ''
Write-Host '[1/3] Installing application ...'
Copy-Tree (Join-Path $Src 'app') (Join-Path $Dest 'app')

Write-Host ''
Write-Host '[2/3] Writing user configuration (~/.dsh) ...'
$dshHome = Join-Path $UserHome '.dsh'
New-Item -ItemType Directory -Path $dshHome -Force | Out-Null
if (-not (Test-Path (Join-Path $dshHome 'settings.yaml'))) {
  Copy-Item (Join-Path $Src 'config\settings.yaml') (Join-Path $dshHome 'settings.yaml') -Force
  Write-Host '  settings.yaml written (first install; existing config kept)'
} else {
  Write-Host '  settings.yaml already exists - keeping yours'
}
Copy-Item (Join-Path $Src 'config\zen-ua-proxy.mjs') (Join-Path $dshHome 'zen-ua-proxy.mjs') -Force

Write-Host ''
Write-Host '[3/3] Harness engine (official source: deepseek-ai/DeepSeek-Harness) ...'
$harnessDir = Join-Path $Dest 'harness'
$harnessReady = (Test-Path (Join-Path $harnessDir 'package.json')) -and (Test-Path (Join-Path $harnessDir 'apps\cli\lib\bin.js'))
if ($harnessReady) {
  Write-Host '  harness already present - skipping'
} elseif ($SkipHarness) {
  Write-Host '  skipped (-SkipHarness). The app will ask for the engine on first start.'
} else {
  $nodeExe = Get-NodeExe
  Install-Harness -NodeExe $nodeExe
  Write-Host '  harness engine installed (from official DeepSeek-Harness).'
}

# UA proxy startup entry (uses the node we provisioned)
$nodeExe = Join-Path $Dest 'tools\node\node.exe'
if (Test-Path $nodeExe) {
  $mjs = Join-Path $dshHome 'zen-ua-proxy.mjs'
  $startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
  New-Item -ItemType Directory -Path $startup -Force | Out-Null
  $line = 'WshShell.Run """' + $nodeExe + '"" ""' + $mjs + '""", 0, False'
  Set-Content -Path (Join-Path $dshHome 'zen-ua-proxy.vbs') -Encoding ASCII -Value @(
    "' Hidden launcher for the OpenCode Zen UA-rewriting proxy (logon startup).",
    "Set WshShell = CreateObject(""WScript.Shell"")",
    $line
  )
  Copy-Item (Join-Path $dshHome 'zen-ua-proxy.vbs') (Join-Path $startup 'zen-ua-proxy.vbs') -Force
  try { Start-Process $nodeExe -ArgumentList $mjs -WindowStyle Hidden } catch { }
}

Write-Host ''
Write-Host 'Creating shortcuts ...'
$exe = Join-Path $Dest 'app\node_modules\electron\dist\electron.exe'
$appArg = '"' + (Join-Path $Dest 'app') + '"'
$ws = New-Object -ComObject WScript.Shell
foreach ($dir in @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'))) {
  $lnk = Join-Path $dir 'DSH.lnk'
  $s = $ws.CreateShortcut($lnk)
  $s.TargetPath = $exe
  $s.Arguments = $appArg
  $s.WorkingDirectory = Join-Path $Dest 'app'
  $s.IconLocation = (Join-Path $Dest 'app\DSH.ico')
  $s.Save()
}

Write-Host ''
Write-Host '=============================================='
Write-Host '  Installation complete. Launching DSH Desktop ...'
Write-Host '=============================================='
Start-Process -FilePath $exe -ArgumentList $appArg
