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
  [switch]$SkipHarness,
  [switch]$EngineOnly     # 只安装/修复 harness 引擎（%LOCALAPPDATA%\DSH\harness + tools\node），不重装 app/快捷方式/配置
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

# 确保 Node >= 22：优先 %LOCALAPPDATA%\DSH\tools\node，其次系统 node；
# 都没有或版本过低时，优先用 winget 安装最新 Node LTS，失败再回退下载官方 Node zip。
function Get-NodeExe {
  $candidate = Join-Path $Dest 'tools\node\node.exe'
  if (Test-Path $candidate) {
    $cv = (& $candidate -v 2>$null | Select-Object -First 1)
    if ($cv -match '^v?(\d+)\.' -and [int]$Matches[1] -ge 22) { Write-Host '  using bundled node (tools\node)'; return $candidate }
  }
  $sys = (Get-Command node -ErrorAction SilentlyContinue).Source
  if ($sys) {
    $ver = (& $sys -v 2>$null | Select-Object -First 1)
    if ($ver -match '^v?(\d+)\.') { if ([int]$Matches[1] -ge 22) { Write-Host "  using system node $ver"; return $sys } }
    Write-Host "  system node ($ver) 版本过低，需要 >= 22。"
  }
  # 优先 winget 安装最新 LTS（与应用内自动获取走同一条修复路径）
  if (-not (Test-Path $candidate)) {
    $envCheck = Join-Path $Src 'check-env.ps1'
    if (Test-Path $envCheck) {
      Write-Host '  尝试 winget 安装最新 Node LTS ...'
      & powershell -NoProfile -ExecutionPolicy Bypass -File $envCheck -Fix -NodeMinMajor 22
      if ($LASTEXITCODE -eq 0) {
        $toolsNew = Join-Path $Dest 'tools\node\node.exe'
        if (Test-Path $toolsNew) { Write-Host '  using tools\node (installed via check-env)'; return $toolsNew }
        $sysNew = (Get-Command node -ErrorAction SilentlyContinue).Source
        if ($sysNew) { $vn = (& $sysNew -v 2>$null | Select-Object -First 1); if ($vn -match '^v?(\d+)\.' -and [int]$Matches[1] -ge 22) { Write-Host "  using system node $vn (installed via winget)"; return $sysNew } }
      }
    }
  }
  $url = "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip"
  Write-Host "  falling back to download Node.js $NodeVersion (official nodejs.org, ~30 MB) ..."
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
  # 2) pnpm：直接走 corepack 子命令（corepack pnpm 按 package.json 的
  #    packageManager 锁定版本并自动拉取，不依赖 shim 文件位置——corepack
  #    prepare 生成的 pnpm.cmd 位置随 COREPACK_HOME 环境变化，不可靠）
  $corepack = Join-Path $nodeDir 'corepack.cmd'
  if (-not (Test-Path $corepack)) { $corepack = Join-Path $nodeDir 'corepack' }
  if ($NpmRegistry) { $env:COREPACK_NPM_REGISTRY = $NpmRegistry }
  Write-Host '  installing dependencies (pnpm install, 一次性, 可能数百 MB) ...'
  Push-Location $harnessDir
  try {
    if (-not (Test-Path $corepack)) { throw '未找到 corepack（Node 目录缺 corepack.cmd）' }
    & $corepack pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'pnpm install 失败：检查网络/npm 源；npm 源受限时加参数 -NpmRegistry https://registry.npmmirror.com' }
    Write-Host '  building harness (pnpm build, 一次性, 需数分钟) ...'
    & $corepack pnpm build
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

if (-not $EngineOnly) {
  Write-Host ''
  Write-Host '[1/3] Installing application ...'
  Copy-Tree (Join-Path $Src 'app') (Join-Path $Dest 'app')

  # 应用装好立刻创建快捷方式（即使后续引擎拉取失败，快捷方式也已存在）
  Write-Host ''
  Write-Host 'Creating shortcuts ...'
  $exe = Join-Path $Dest 'app\DSH.exe'
  $appPath = Join-Path $Dest 'app'
  if (Test-Path $exe) {
    $ws = New-Object -ComObject WScript.Shell
    $linkDirs = New-Object System.Collections.ArrayList
    try { $d = $ws.SpecialFolders.Item('Desktop');          if ($d) { [void]$linkDirs.Add($d) } } catch {}
    try { $d = [Environment]::GetFolderPath('Desktop');     if ($d) { [void]$linkDirs.Add($d) } } catch {}
    $od = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'OneDrive\Desktop'
    if (Test-Path $od) { [void]$linkDirs.Add($od) }
    $sm = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
    if (Test-Path $sm) { [void]$linkDirs.Add($sm) }
    $cnt = 0
    foreach ($dir in ($linkDirs | Select-Object -Unique | Where-Object { $_ -and (Test-Path $_) })) {
      try {
        $lnk = Join-Path $dir 'DSH.lnk'
        $s = $ws.CreateShortcut($lnk)
        $s.TargetPath = $exe
        $s.Arguments = ''
        $s.WorkingDirectory = $appPath
        $s.IconLocation = (Join-Path $appPath 'DSH.ico')
        $s.Save()
        if (Test-Path $lnk) { Write-Host "  shortcut created: $lnk"; $cnt++ }
      } catch { Write-Host "  WARN: shortcut failed in $dir : $($_.Exception.Message)" }
    }
    if ($cnt -eq 0) { Write-Host '  WARN: 未能创建任何快捷方式（可手动运行 app\DSH.exe）' }
  } else {
    Write-Host "  WARN: 应用 EXE 不存在（$exe），跳过快捷方式创建"
  }

  Write-Host ''
  Write-Host '[2/3] Writing user configuration (~/.dsh) ...'
  $dshHome = Join-Path $UserHome '.dsh'
  New-Item -ItemType Directory -Path $dshHome -Force | Out-Null
  # 默认配置只从仓库内置的纯净模板复制（不带任何个人提供商/密钥引用）
  if (-not (Test-Path (Join-Path $dshHome 'settings.yaml'))) {
    if (Test-Path (Join-Path $Src 'config\settings.yaml')) {
      Copy-Item (Join-Path $Src 'config\settings.yaml') (Join-Path $dshHome 'settings.yaml') -Force
      Write-Host '  settings.yaml written (clean default template; existing config kept)'
    } else {
      Write-Host '  WARN: 缺少 config\settings.yaml 纯净模板，跳过写入（harness 使用内置默认）'
    }
  } else {
    Write-Host '  settings.yaml already exists - keeping yours'
  }
  # zen-ua-proxy 仅当包内确实带模板时才安装（不读取/分发开发者个人副本）
  if (Test-Path (Join-Path $Src 'config\zen-ua-proxy.mjs')) {
    Copy-Item (Join-Path $Src 'config\zen-ua-proxy.mjs') (Join-Path $dshHome 'zen-ua-proxy.mjs') -Force
  }
}

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

if (-not $EngineOnly) {
  # UA proxy startup entry (only when the packaged template exists)
  $nodeExe = Join-Path $Dest 'tools\node\node.exe'
  $mjs = Join-Path $dshHome 'zen-ua-proxy.mjs'
  if ((Test-Path $nodeExe) -and (Test-Path $mjs)) {
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
  Write-Host '=============================================='
  Write-Host '  Installation complete. Launching DSH Desktop ...'
  Write-Host '=============================================='
  Start-Process -FilePath $exe
} else {
  Write-Host ''
  Write-Host '=============================================='
  Write-Host '  Engine installation complete. Returning to DSH Desktop ...'
  Write-Host '=============================================='
}
