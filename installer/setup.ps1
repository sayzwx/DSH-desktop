# DSH Desktop one-click installer.
# 设计：Setup.exe 只包含桌面端 app（Electron 运行时，约 220MB）。
# 重型 Harness 引擎不打包、不托管：安装时从 DeepSeek 官方源自动拉取
# （官方源码 + 官方 Node 运行时），在本机完成依赖安装与构建（一次性）。
# 需要网络：github.com（源码）/ nodejs.org（Node）/ npm registry（pnpm 依赖）。
# 网络受限时可传 -NpmRegistry 指定镜像（如 https://registry.npmmirror.com）。
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" [-SkipHarness] [-DestDir "D:\path"]
param(
  [string]$HarnessSource = 'https://github.com/deepseek-ai/DeepSeek-Harness/archive/refs/tags/dsh-v0.1.0-rc.8.zip',
  [string]$HarnessGit    = 'https://github.com/deepseek-ai/DeepSeek-Harness.git',
  [string]$HarnessBranch = 'dsh-v0.1.0-rc.8',
  [string]$NodeVersion   = 'v22.23.2',
  [string]$NpmRegistry   = '',   # 例：https://registry.npmmirror.com（npm 网络受限时）
  [string]$DestDir       = '',   # 用户所选安装目录；留空则默认 %LOCALAPPDATA%\DSH
  [switch]$SkipHarness,
  [switch]$EngineOnly,    # 只安装/修复 harness 引擎（安装根目录\harness + tools\node），不重装 app/快捷方式/配置
  [switch]$InnoSetup      # 由 Inno Setup 安装器调用：app/tools 已就位，跳过复制，仅做快捷方式/配置/引擎
)
$ErrorActionPreference = 'Stop'

# ---- 输出编码强制 UTF-8：避免 main.js spawn 收集日志时中文乱码 ----
# 中文 Windows 的 PowerShell 控制台默认 GBK(936)，Write-Host 输出的中文是 GBK 字节，
# 而 main.js 的 pushLog 按 UTF-8 解码 → 乱码。这里把控制台输出编码改为 UTF8 对齐。
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
try { $OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# ---- 脚本执行策略防呆：若机器策略禁止脚本且 -ExecutionPolicy Bypass 也被覆盖，明确提示用户 ----
$effectivePolicy = Get-ExecutionPolicy
if ($effectivePolicy -eq 'Restricted' -or $effectivePolicy -eq 'AllSigned') {
  $procPolicy = try { (Get-ExecutionPolicy -Scope Process -ErrorAction Stop) } catch { $effectivePolicy }
  if ($procPolicy -eq 'Restricted' -or $procPolicy -eq 'AllSigned') {
    Write-Host '======================================================' -ForegroundColor Yellow
    Write-Host ' 检测到 PowerShell 执行策略禁止运行脚本（Restricted/AllSigned）。' -ForegroundColor Yellow
    Write-Host ' 这会阻止安装器拉取引擎。请以管理员身份打开 PowerShell 执行：' -ForegroundColor Yellow
    Write-Host '   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned' -ForegroundColor Yellow
    Write-Host ' 然后重新运行本安装器。或直接运行 DSH Desktop 的 Setup.exe（已内置 Bypass）。' -ForegroundColor Yellow
    Write-Host '======================================================' -ForegroundColor Yellow
    throw 'PowerShell 执行策略禁止脚本运行，请按上方提示以管理员身份调整后重试。'
  }
}

# ---- 安装失败可见化：任何未捕获异常 → 写 install.log + 保底手动指引 + exit 1 ----
# 历史教训：0.5.0 引擎拉取失败时安装器静默继续，用户装完没有引擎也无提示（ERR_MODULE_NOT_FOUND）。
# 这里保证失败一定有日志与可执行的手动方案，不再静默。
trap {
  $msg = $_.Exception.Message
  $ts  = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  $logDir = if ($Dest) { $Dest } else { Join-Path $env:LOCALAPPDATA 'DSH' }
  try { New-Item -ItemType Directory -Path $logDir -Force | Out-Null } catch { }
  $log = Join-Path $logDir 'install.log'
  $guide = @(
    "[$ts] DSH Desktop 安装失败：$msg",
    '',
    '自动拉取引擎失败。以下手动安装办法 100% 可成功，任选其一后重启应用即可：',
    '  办法 1（最快）：若本机已有 DeepSeek-Harness 源码目录，设环境变量指向它后重启应用：',
    '      setx DSH_HARNESS_DIR "你的引擎源码目录"',
    '  办法 2：浏览器手动下载引擎源码压缩包（任一链接）：',
    '      官方: https://github.com/deepseek-ai/DeepSeek-Harness/archive/refs/tags/dsh-v0.1.0-rc.8.zip',
    '      镜像: https://ghfast.top/https://github.com/deepseek-ai/DeepSeek-Harness/archive/refs/tags/dsh-v0.1.0-rc.8.zip',
    "      解压后把整个仓库目录放到: $logDir\harness",
    '      （若该目录没有 node_modules，以管理员身份在 cmd 中执行：',
    "         cd /d `"$logDir\harness`"",
    '         corepack pnpm install --frozen-lockfile',
    '         corepack pnpm build）',
    '  办法 3：以管理员身份运行 cmd，安装官方发行包：',
    '      npm install -g @deepseek-ai/dsh --registry https://registry.npmmirror.com',
    ''
  )
  $guide | Set-Content -Path $log -Encoding UTF8
  Write-Host ''
  Write-Host "安装失败，详情已写入日志: $log"
  Write-Host '----------------------------------------------'
  $guide | ForEach-Object { Write-Host $_ }
  Write-Host '----------------------------------------------'
  exit 1
}
# 安装根目录：用户所选目录优先（app / harness / tools 全部落在该目录下，自动适配所选路径）
if ($DestDir) { $Dest = [System.IO.Path]::GetFullPath($DestDir) }
else          { $Dest = Join-Path $env:LOCALAPPDATA 'DSH' }
$UserHome = $env:USERPROFILE  # 不要用 $Home：$HOME 是 PowerShell 只读自动变量
$Src      = Split-Path -Parent $MyInvocation.MyCommand.Path

function Copy-Tree([string]$from, [string]$to) {
  Write-Host "  -> $to"
  robocopy $from $to /E /MT:16 /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $from -> $to" }
}

# 确保 Node >= 22：优先 安装根目录\tools\node，其次系统 node；
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
      & powershell -NoProfile -ExecutionPolicy Bypass -File $envCheck -Fix -NodeMinMajor 22 -DestDir "$Dest"
      if ($LASTEXITCODE -eq 0) {
        $toolsNew = Join-Path $Dest 'tools\node\node.exe'
        if (Test-Path $toolsNew) { Write-Host '  using tools\node (installed via check-env)'; return $toolsNew }
        $sysNew = (Get-Command node -ErrorAction SilentlyContinue).Source
        if ($sysNew) { $vn = (& $sysNew -v 2>$null | Select-Object -First 1); if ($vn -match '^v?(\d+)\.' -and [int]$Matches[1] -ge 22) { Write-Host "  using system node $vn (installed via winget)"; return $sysNew } }
      }
    }
  }
  $nodeZipCandidates = @(
    "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip",   # 官方
    "https://registry.npmmirror.com/-/binary/node/$NodeVersion/node-$NodeVersion-win-x64.zip",  # 国内镜像(npmmirror)
    "https://mirrors.cloud.tencent.com/nodejs-release/$NodeVersion/node-$NodeVersion-win-x64.zip", # 腾讯云镜像
    "https://mirrors.huaweicloud.com/nodejs/$NodeVersion/node-$NodeVersion-win-x64.zip"            # 华为云镜像
  )
  $tmpZip = Join-Path $env:TEMP "node-$NodeVersion-win-x64.zip"
  $got = $false
  foreach ($u in $nodeZipCandidates) {
    Write-Host "  downloading Node.js $NodeVersion from $u ..."
    $i = 0; $ok = $false
    do {
      try { Invoke-WebRequest -Uri $u -OutFile $tmpZip -UseBasicParsing -TimeoutSec 120; $ok = $true }
      catch { $i++; if ($i -ge 2) { break }; Write-Host "    attempt $i failed, retrying ..."; Start-Sleep -Seconds 3 }
    } while (-not $ok)
    if ($ok -and (Test-Path $tmpZip) -and (Get-Item $tmpZip).Length -gt 100000) { $got = $true; break }
    Remove-Item $tmpZip -Force -ErrorAction SilentlyContinue
  }
  if (-not $got) {
    Write-Host ''
    Write-Host '  ================= 手动下载 Node.js ================='
    Write-Host "  下载地址（任一）："
    Write-Host "    官方: https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip"
    Write-Host "    镜像: https://registry.npmmirror.com/-/binary/node/$NodeVersion/node-$NodeVersion-win-x64.zip"
    Write-Host "  下载后解压，把 node-$NodeVersion-win-x64 整个目录放到: $(Join-Path $Dest 'tools\node')"
    Write-Host '  =================================================='
    throw "Node.js 下载失败（多镜像均失败），请按上方指引手动下载。"
  }
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
  $binJs      = Join-Path $harnessDir 'apps\cli\lib\bin.js'
  $webDist    = Join-Path $harnessDir 'apps\web\dist\index.html'
  $got = $false
  $build = $false
  if (Test-Path (Join-Path $harnessDir 'package.json')) {
    # “已存在即跳过”必须以【CLI + web 前端 dist 都齐全】为前提；只差 web dist 的
    # 旧安装（rc.7 时代曾出现 lib 构建成功而 web 未构建，导致打开就报 “frontend dist not built”）
    # 必须重新构建，而不是复用一个残缺引擎。
    if ((Test-Path $binJs) -and (Test-Path $webDist)) {
      Write-Host '  harness 源码 + 完整构建产物已存在，跳过构建'
      return
    }
    Write-Host '  harness 源码已存在但构建产物不完整（缺少 CLI 或 web 前端 dist）——重新构建'
    $got = $true
    $build = $true
  } else {
    # 1) 官方源码：zip 优先（GitHub 官方直链 + 国内加速镜像多跳），git clone 兜底
    #    GitHub 源码下载在国内不稳定 → 镜像优先（ghfast.top 等国内加速，超时短、快失败），
    #    官方直连放最后（国内直连常超时，放前面会拖 120s×2 才轮到镜像，用户以为卡死）。
    $tmpZip = Join-Path $env:TEMP 'dsh-harness-src.zip'
    $tmpDir = Join-Path $env:TEMP 'dsh-harness-src'
    $srcCandidates = @(
      "https://ghfast.top/$HarnessSource",                                  # 镜像1（国内加速，优先）
      "https://ghproxy.net/$HarnessSource",                                 # 镜像2
      "https://gh-proxy.com/$HarnessSource",                                # 镜像3
      "https://gh.ddlc.top/$HarnessSource",                                 # 镜像4
      $HarnessSource                                                      # 官方（最后兜底）
    )
    foreach ($srcUrl in $srcCandidates) {
      Write-Host "  downloading harness source: $srcUrl"
      $i = 0; $ok = $false
      do {
        try { Invoke-WebRequest -Uri $srcUrl -OutFile $tmpZip -UseBasicParsing -TimeoutSec 45; $ok = $true }
        catch { $i++; if ($i -ge 2) { break }; Write-Host "    attempt $i failed, retrying ..."; Start-Sleep -Seconds 2 }
      } while (-not $ok)
      if ($ok -and (Test-Path $tmpZip) -and (Get-Item $tmpZip).Length -gt 10000) { $got = $true; break }
      Remove-Item $tmpZip -Force -ErrorAction SilentlyContinue
    }
    if ($got) {
      Write-Host '  extracting DeepSeek-Harness source ...'
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
      Write-Host '  zip 下载失败（官方与镜像均失败），尝试 git clone（需要本机装有 git）...'
      $git = (Get-Command git -ErrorAction SilentlyContinue).Source
      if (-not $git) {
        # 给出手动下载指引，而不是直接失败
        Write-Host ''
        Write-Host '  ================= 手动下载 Harness 引擎 ================='
        Write-Host "  引擎源码包下载地址（任一可用）："
        Write-Host "    官方: $HarnessSource"
        Write-Host '    镜像: https://ghfast.top/<上面官方地址>'
        Write-Host '    镜像: https://ghproxy.net/<上面官方地址>'
        Write-Host "  下载后解压，把整个仓库根目录放到: $harnessDir"
        Write-Host '  （也可直接 git clone --depth 1 --branch {0} {1} "{2}"）' -f $HarnessBranch, $HarnessGit, $harnessDir
        Write-Host '  ========================================================'
        throw '官方源码下载失败且未安装 git：请按上面的指引手动下载引擎（或用 -SkipHarness 后手动配置）。'
      }
      New-Item -ItemType Directory -Path $harnessDir -Force | Out-Null
      & $git clone --depth 1 --branch $HarnessBranch $HarnessGit $harnessDir
      if ($LASTEXITCODE -ne 0) { throw 'git clone 失败：请检查网络或 git 配置。' }
      $got = $true
    }
    if (-not (Test-Path (Join-Path $harnessDir 'package.json'))) { throw '引擎源码不完整：缺少 package.json' }
    $build = $true
  }
  # 2) 构建全程使用【本机捆绑的 Node 工具链】（tools\node），不依赖系统 node/npm/pnpm：
  #    - corepack pnpm：按 package.json 的 packageManager 锁定版本并自动拉取；
  #    - 在捆绑 node 目录放一个 pnpm.cmd 转发到 corepack，并把它前置到 PATH，
  #      以便构建脚本内部裸调用 `pnpm`/`npm` 都解析到捆绑版本（rc.7 干过一次
  #      “CLI 构建成功但 web 前端没构建”的事故，根因就是 script 里裸 pnpm 解析不到）。
  $corepack = Join-Path $nodeDir 'corepack.cmd'
  if (-not (Test-Path $corepack)) { $corepack = Join-Path $nodeDir 'corepack' }
  $pnpmShim = Join-Path $nodeDir 'pnpm.cmd'
  if (-not (Test-Path $pnpmShim)) {
    $shimContent = '@echo off' + "`r`n" + '"%~dp0corepack.cmd" pnpm %*'
    Set-Content -Path $pnpmShim -Encoding Ascii -Value $shimContent
  }
  if ($NpmRegistry) { $env:COREPACK_NPM_REGISTRY = $NpmRegistry }
  # npm registry 候选：用户指定 > 国内镜像(npmmirror 等) > 官方。pnpm install 失败时依次换源重试。
  # ERR_MODULE_NOT_FOUND（@deepseek-ai/dsh-app-boot 缺失）正是依赖下载不完整所致，多源重试可显著缓解。
  $npmRegistries = @()
  if ($NpmRegistry) { $npmRegistries += $NpmRegistry }
  $npmRegistries += @(
    'https://registry.npmmirror.com',   # 国内镜像1
    'https://registry.npmjs.org',        # 官方回源
    'https://mirrors.cloud.tencent.com/npm/',  # 镜像2
    'https://registry.npmmirror.com'     # 重复兜底
  )
  Push-Location $harnessDir
  try {
    if (-not (Test-Path $corepack)) { throw '未找到 corepack（Node 目录缺 corepack.cmd）' }
    $oldPath = $env:PATH
    $env:PATH = "$nodeDir;$oldPath"
    try {
      if ($build) {
        $installOk = $false
        foreach ($reg in $npmRegistries) {
          Write-Host "  installing dependencies via $reg (pnpm install, 一次性, 可能数百 MB) ..."
          $env:COREPACK_NPM_REGISTRY = $reg
          & $corepack pnpm install --frozen-lockfile
          if ($LASTEXITCODE -eq 0) { $installOk = $true; break }
          Write-Host "    该镜像失败 (code=$LASTEXITCODE)，尝试下一个镜像 ..."
        }
        if (-not $installOk) {
          Write-Host ''
          Write-Host '  ================= 依赖安装失败 → 手动下载指引 ================='
          Write-Host '  pnpm install 在多个 npm 镜像均失败（网络/磁盘/代理问题）。请人工处理：'
          Write-Host ('  1) 打开 `{0}` 目录' -f $harnessDir)
          Write-Host '  2) 运行：corepack pnpm install --frozen-lockfile'
          Write-Host '     若慢/失败，先执行：$env:COREPACK_NPM_REGISTRY="https://registry.npmmirror.com"'
          Write-Host '  3) 再运行：corepack pnpm build'
          Write-Host '  4) 完成后重启本安装器（引擎已存在会跳过源码下载，直接补构建）'
          Write-Host '  ==========================================================='
          throw 'pnpm install 失败：多镜像均失败，请按上方指引手动安装依赖。'
        }
        Write-Host '  building harness (pnpm build, 一次性, 需数分钟) ...'
        & $corepack pnpm build
        if ($LASTEXITCODE -ne 0) { throw 'pnpm build 失败' }
      }
      # 3) 兜底校验：web 前端 dist 必须在，否则用捆邦工具直接补构建 build:web
      if (-not (Test-Path $webDist)) {
        Write-Host '  web 前端 dist 缺失，直接补构建 build:web ...'
        & $corepack pnpm --filter @deepseek-ai/dsh-web-frontend run build
        if ($LASTEXITCODE -ne 0) { throw 'web 前端构建失败（build:web）' }
      }
    } finally { $env:PATH = $oldPath }
  } finally { Pop-Location }
  if (-not (Test-Path $binJs)) { throw '构建产物缺失：apps/cli/lib/bin.js' }
  if (-not (Test-Path $webDist)) { throw '构建产物缺失：web 前端 apps/web/dist/index.html；构建未完整产出，请重试或检查网络/磁盘空间' }
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
  if (-not $InnoSetup) {
    Write-Host '[1/3] Installing application ...'
    Copy-Tree (Join-Path $Src 'app') (Join-Path $Dest 'app')

    # 自带便携 Node（tools\node）随包分发：搬到 %LOCALAPPDATA%\DSH\tools\node，
    # 引擎安装/启动都优先用它 → 本机不再需要任何 Node 环境
    Write-Host ''
    Write-Host 'Installing bundled Node.js (portable tools\node) ...'
    $srcTools = Join-Path $Src 'tools'
    $dstTools = Join-Path $Dest 'tools'
    if (Test-Path (Join-Path $srcTools 'node\node.exe')) {
      Copy-Tree (Join-Path $srcTools 'node') (Join-Path $dstTools 'node')
    } else {
      Write-Host '  WARN: 包内未发现 tools\node（旧版构建产物？），将回退为联网自动获取 Node（见 [3/3]）'
    }
  } else {
    Write-Host '[1/3] app / tools 已由 Inno Setup 就位，跳过复制'
  }

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

# 插件市场（dshmarket）随引擎固定安装：引擎就绪后自动装 dshmarket 到 web profile。
# 优先路径：{Dest}\app\extras\dsh-market-bundle\manifest.json + dshmarket-*.tgz（由 build-dist.ps1 打包）
#   → 校验 manifest.json 的 SHA256 与 tarball 一致 → 调 `dsh plugin add <tarball>` 从本地装（不走 npm）
# Fallback 路径：本地 tarball 不存在或校验失败 → 远程 `dsh plugin add dshmarket`（需 npm 网络）
# 幂等：已安装则跳过；失败不阻塞安装（可下次启动时由应用内补装）。
$dshCli = Join-Path $harnessDir 'apps\cli\lib\bin.js'
$nodeExe = Join-Path $Dest 'tools\node\node.exe'
if ((Test-Path $dshCli) -and (Test-Path $nodeExe)) {
  $marketDir = Join-Path $Dest 'app\extras\dsh-market-bundle'
  $mfstPath = Join-Path $marketDir 'manifest.json'
  $installedFromBundle = $false
  if ((Test-Path $marketDir) -and (Test-Path $mfstPath)) {
    try {
      $mfst = Get-Content -Raw -Path $mfstPath -Encoding UTF8 | ConvertFrom-Json
      $tgzPath = Join-Path $marketDir $mfst.tarball
      if ((Test-Path $tgzPath) -and $mfst.sha256) {
        $actualSha = (Get-FileHash -Path $tgzPath -Algorithm SHA256).Hash.ToLower()
        if ($actualSha -eq $mfst.sha256.ToLower()) {
          Write-Host ("  installing plugin market (dshmarket v{0}, 本地内置, SHA256 已校验) ..." -f $mfst.version)
          Push-Location $harnessDir
          try {
            & $nodeExe $dshCli plugin --profile web add $tgzPath 2>&1 | ForEach-Object { Write-Host "    $_" }
            if ($LASTEXITCODE -eq 0) {
              Write-Host '  plugin market installed (本地内置).' -ForegroundColor Green
              $installedFromBundle = $true
            } else {
              Write-Host '  WARN: 本地 tarball 安装未成功（exit ' $LASTEXITCODE '），将尝试远程 npm' -ForegroundColor Yellow
            }
          } finally { Pop-Location }
        } else {
          Write-Host ("  WARN: 本地 tarball SHA256 校验失败（期望 {0} vs 实际 {1}），跳过本地安装，将尝试远程 npm" -f $mfst.sha256.ToLower(), $actualSha) -ForegroundColor Yellow
        }
      }
    } catch {
      Write-Host "  WARN: 解析 manifest.json 异常: $($_.Exception.Message)，将尝试远程 npm" -ForegroundColor Yellow
    }
  }
  if (-not $installedFromBundle) {
    Write-Host '  installing plugin market (dshmarket, 远程 npm registry) ...'
    Push-Location $harnessDir
    try {
      & $nodeExe $dshCli plugin --profile web add dshmarket 2>&1 | ForEach-Object { Write-Host "    $_" }
      if ($LASTEXITCODE -eq 0) { Write-Host '  plugin market installed.' }
      else { Write-Host '  WARN: dshmarket 安装未成功（可下次启动自动补装，不影响其余安装）' }
    } catch {
      Write-Host "  WARN: dshmarket 安装异常: $($_.Exception.Message)"
    } finally { Pop-Location }
  }
} else {
  Write-Host '  WARN: 引擎 CLI 未就绪，跳过插件市场安装（启动后应用内自动补装）'
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
