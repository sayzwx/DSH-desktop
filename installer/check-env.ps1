# DSH Desktop 环境预检与 Node.js 修复脚本。
# 用途：应用内"启动 Harness"发现本机没有引擎时，先确认/补齐运行底层（Node.js + npm），
#       确保环境合格（架构 / 网络 / 磁盘 / Node 版本）后才去拉取引擎，避免大体积下载半途失败。
# 两种模式：
#   -Report            只读环境体检：输出日志 + 末尾一行 JSON（main.js 解析用）
#   -Fix               修复模式：Node 缺失或版本过低时，优先用 winget 安装/升级最新 Node LTS，
#                      失败则回退官方 zip 下载到 %LOCALAPPDATA%\DSH\tools\node（无需管理员权限）
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File check-env.ps1 [-Report|-Fix] [-DestDir "D:\path"] [-ReportFile <path>]
param(
  [switch]$Report,
  [switch]$Fix,
  [string]$NodeMinMajor = '22',
  [string]$NodeVersion  = 'v22.23.2',   # 回退下载的官方发行版（仅当 winget 不可用时）
  [string]$NpmRegistry  = '',           # 例：https://registry.npmmirror.com（npm 网络受限时）
  [string]$DestDir      = '',           # 安装根目录（问题#5）；留空默认 %LOCALAPPDATA%\DSH
  [string]$ReportFile   = ''            # -Report 时把 JSON 同步写到这个文件（UTF-8 no BOM）——给 Inno Setup 用
)
$ErrorActionPreference = 'Stop'
if ($DestDir) { $Dest = [System.IO.Path]::GetFullPath($DestDir) }
else          { $Dest = Join-Path $env:LOCALAPPDATA 'DSH' }
$ToolsNode = Join-Path $Dest 'tools\node\node.exe'
$KNOWN_NODE = @(
  (Join-Path ${env:ProgramFiles} 'nodejs\node.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
  (Join-Path $env:APPDATA 'nvm\current\node.exe'),
  $ToolsNode
)

function Write-Log([string]$m) { Write-Host "[env] $m" }
function Get-NodeVersion([string]$exe) {
  if (-not $exe -or -not (Test-Path $exe)) { return $null }
  try { $o = & $exe -v 2>$null | Select-Object -First 1; return $o } catch { return $null }
}
function MajorOf([string]$v) {
  if (-not $v) { return -1 }
  $m = [regex]::Match($v, '^v?(\d+)\.')
  if (-not $m.Success) { return -1 }
  return [int]$m.Groups[1].Value
}
function NodeIsOk([string]$ver) { return (MajorOf $ver) -ge [int]$NodeMinMajor }

# ---------- 采集环境事实（只读） ----------
function Get-EnvReport {
  $arch = $env:PROCESSOR_ARCHITECTURE
  $hasWinget = [bool](Get-Command winget -ErrorAction SilentlyContinue)
  $sysNode   = $null
  try { $sysNode = (Get-Command node -ErrorAction SilentlyContinue).Source } catch { }
  $sysVer  = Get-NodeVersion $sysNode
  $toolsVer = Get-NodeVersion $ToolsNode
  $netOk = $false
  try {
    $netOk = [bool](Test-NetConnection -ComputerName registry.npmjs.org -Port 443 -InformationLevel Quiet -WarningAction SilentlyContinue -ErrorAction SilentlyContinue)
  } catch { $netOk = $false }
  $freeMB = 0
  try {
    $drv = Get-PSDrive -Name $env:SystemDrive.TrimEnd(':') -ErrorAction SilentlyContinue
    if ($drv) { $freeMB = [math]::Round($drv.Free / 1MB) }
  } catch { }

  $nodeOk = (NodeIsOk $sysVer) -or (NodeIsOk $toolsVer)
  $nodeLabel = '未安装'
  $effective = ''
  if (NodeIsOk $sysVer) { $nodeLabel = $sysVer; $effective = $sysNode }
  elseif (NodeIsOk $toolsVer) { $nodeLabel = "$toolsVer (tools)"; $effective = $ToolsNode }
  elseif ($sysVer) { $nodeLabel = "$sysVer (版本过低)" }

  $issues = @()
  if ($arch -notin @('AMD64', 'ARM64')) { $issues += "不受支持的 CPU 架构: $arch（需要 64 位）" }
  if (-not $netOk) { $issues += '无法连接 registry.npmjs.org（网络不可达或被防火墙阻断）' }
  if ($freeMB -gt 0 -and $freeMB -lt 1024) { $issues += "系统盘剩余空间不足（${freeMB} MB < 1GB）" }
  if (-not $nodeOk) { $issues += "Node.js 缺失或版本过低（当前: ${nodeLabel}，要求: >= v${NodeMinMajor}）" }

  return [pscustomobject]@{
    arch        = $arch
    hasWinget   = $hasWinget
    nodePath    = $effective
    nodeVersion = $nodeLabel
    nodeOk      = [bool]$nodeOk
    netOk       = [bool]$netOk
    freeMB      = [int]$freeMB
    issues      = @($issues)
  }
}

# ---------- winget 安装/升级 Node.js（最新 LTS） ----------
function Install-NodeViaWinget {
  $id = 'OpenJS.NodeJS.LTS'
  Write-Log "使用 winget 安装/升级 Node.js（最新 LTS, ${id}）...（如弹出管理员授权请选择 是）"
  try {
    & winget install --id $id --exact --silent --accept-source-agreements --accept-package-agreements --disable-interactivity
    if ($LASTEXITCODE -ne 0) {
      Write-Log "winget install 退出码 ${LASTEXITCODE}，尝试 winget upgrade ..."
      & winget upgrade --id $id --exact --silent --accept-source-agreements --accept-package-agreements --disable-interactivity
    }
    # winget 装完后当前进程 PATH 不刷新，直接探测已知安装位置
    foreach ($k in $KNOWN_NODE) { if (Test-Path $k) { return $k } }
    $g = (Get-Command node -ErrorAction SilentlyContinue).Source
    if ($g -and (NodeIsOk (Get-NodeVersion $g))) { return $g }
  } catch {
    Write-Log "winget 调用失败: $($_.Exception.Message)"
  }
  return $null
}

# ---------- 回退：下载官方 Node zip 到 %LOCALAPPDATA%\DSH\tools\node ----------
function Install-NodeFallback {
  Write-Log "winget 不可用/失败，回退下载官方 Node.js ${NodeVersion}（约 30 MB，多镜像尝试）..."
  $tmpZip = Join-Path $env:TEMP "node-${NodeVersion}-win-x64.zip"
  $tmpDir = Join-Path $env:TEMP "node-${NodeVersion}-extract"
  $candidates = @(
    "https://nodejs.org/dist/${NodeVersion}/node-${NodeVersion}-win-x64.zip",
    "https://registry.npmmirror.com/-/binary/node/${NodeVersion}/node-${NodeVersion}-win-x64.zip",
    "https://mirrors.cloud.tencent.com/nodejs-release/${NodeVersion}/node-${NodeVersion}-win-x64.zip",
    "https://mirrors.huaweicloud.com/nodejs/${NodeVersion}/node-${NodeVersion}-win-x64.zip"
  )
  $got = $false
  foreach ($u in $candidates) {
    Write-Log "  尝试下载: ${u}"
    $i = 0; $ok = $false
    do {
      try { Invoke-WebRequest -Uri $u -OutFile $tmpZip -UseBasicParsing -TimeoutSec 120; $ok = $true }
      catch { $i++; if ($i -ge 2) { break }; Write-Log "  第 ${i} 次失败，重试..."; Start-Sleep -Seconds 3 }
    } while (-not $ok)
    if ($ok -and (Test-Path $tmpZip) -and (Get-Item $tmpZip).Length -gt 100000) { $got = $true; break }
    Remove-Item $tmpZip -Force -ErrorAction SilentlyContinue
  }
  if (-not $got) {
    Write-Log ''
    Write-Log '  ================= 手动下载 Node.js ================='
    Write-Log "  下载地址（任一可用）："
    Write-Log "    官方: https://nodejs.org/dist/${NodeVersion}/node-${NodeVersion}-win-x64.zip"
    Write-Log "    镜像: https://registry.npmmirror.com/-/binary/node/${NodeVersion}/node-${NodeVersion}-win-x64.zip"
    Write-Log "  下载后解压，把 node-${NodeVersion}-win-x64 目录放到 $(Join-Path $Dest 'tools\node')"
    Write-Log '  =================================================='
    throw "Node.js 下载失败（多镜像均失败），请按上方指引手动下载。"
  }
  Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive -Path $tmpZip -DestinationPath $tmpDir -Force
  New-Item -ItemType Directory -Path (Join-Path $Dest 'tools') -Force | Out-Null
  Move-Item (Join-Path $tmpDir "node-${NodeVersion}-win-x64") (Join-Path $Dest 'tools\node') -Force
  Remove-Item $tmpZip -Force -ErrorAction SilentlyContinue
  Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
  return $ToolsNode
}

# ---------- main ----------
if ($Report) {
  # 兜底：任何内部异常都不能让安装器看到"裸 exit 1"——输出 JSON 兜底并 exit 0，
  # Inno 侧只关心 JSON 里的字段；真正致命的问题由 Install-Harness 阶段再报。
  try {
    $r = Get-EnvReport
    $json = $r | ConvertTo-Json -Compress -Depth 4
    foreach ($i in $r.issues) { Write-Log "WARN: $i" }
    # 关键：JSON 同步落盘 UTF-8 no BOM（Write-Host / Write-Output 在 PS 5.1 走 host/UTF-16LE，
    # Inno 的 LoadStringsFromFile 按 ANSI 读会全乱码，导致「环境预检未产生输出」。直接写文件最稳。
    Write-Output $json
    if ($ReportFile) {
      New-Item -ItemType Directory -Path (Split-Path -Parent $ReportFile) -Force | Out-Null
      [System.IO.File]::WriteAllText($ReportFile, $json, (New-Object System.Text.UTF8Encoding($false)))
    }
  } catch {
    $err = "预检内部异常: $($_.Exception.Message)"
    Write-Log $err
    $fallback = '{"arch":"' + $env:PROCESSOR_ARCHITECTURE + '","nodeVersion":"异常","nodeOk":false,"netOk":false,"freeMB":0,"issues":["' + $err.Replace('"','''') + '"]}'
    Write-Output $fallback
    if ($ReportFile) {
      try {
        New-Item -ItemType Directory -Path (Split-Path -Parent $ReportFile) -Force | Out-Null
        [System.IO.File]::WriteAllText($ReportFile, $fallback, (New-Object System.Text.UTF8Encoding($false)))
      } catch { }
    }
  }
  exit 0
}

if ($Fix) {
  New-Item -ItemType Directory -Path $Dest -Force | Out-Null
  $r = Get-EnvReport
  if ($r.nodeOk) { Write-Log "Node.js 已就绪（$($r.nodeVersion)）"; exit 0 }
  Write-Log "Node.js 缺失或版本过低（$($r.nodeVersion)，要求 >= v${NodeMinMajor}）"
  if ($NpmRegistry) { $env:COREPACK_NPM_REGISTRY = $NpmRegistry }
  $got = $null
  if ($r.hasWinget) {
    $got = Install-NodeViaWinget
    if ($got) {
      $v = Get-NodeVersion $got
      if (NodeIsOk $v) { Write-Log "Node.js 安装完成: $v（$got）"; exit 0 }
    }
  }
  $got = Install-NodeFallback
  $v = Get-NodeVersion $got
  if (NodeIsOk $v) { Write-Log "Node.js 安装完成: $v（$got）"; exit 0 }
  Write-Log 'Node.js 安装失败：请检查网络、winget 与磁盘空间后重试。'
  exit 1
}

# 无参数：轻量打印
$r = Get-EnvReport
Write-Log "报告: arch=$($r.arch) node=$($r.nodeVersion) net=$($r.netOk) winget=$($r.hasWinget) diskFreeMB=$($r.freeMB)"
exit 0
