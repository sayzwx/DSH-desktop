<#
.SYNOPSIS
    DSH Desktop 开发环境一键 setup（Windows）。

.DESCRIPTION
    检查 Node.js（>= 18，含 npm），按 package-lock.json 用 `npm ci` 安装依赖
    （Electron + ws），然后给出开发运行（npm start / 启动桌面端.bat）与
    分发包构建（scripts\build-dist.ps1）指引。
    这是给源码检出/开发者的 setup；最终用户请使用 installer\setup.bat。

.EXAMPLE
    .\setup.ps1               # 检查环境并安装依赖
    .\setup.ps1 -NoInstall    # 只检查环境，不安装依赖
#>
[CmdletBinding()]
param(
    [switch]$NoInstall,
    [switch]$Help
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot

function Write-Setup([string]$Message) {
    Write-Host "[setup] $Message"
}

if ($Help) {
    Write-Host 'DSH Desktop 开发环境一键 setup（Windows）'
    Write-Host ''
    Write-Host '用法：'
    Write-Host '  .\setup.ps1 [选项]'
    Write-Host ''
    Write-Host '选项：'
    Write-Host '  -NoInstall   只检查 Node.js 环境，不安装依赖'
    Write-Host '  -Help        显示本帮助'
    Write-Host ''
    Write-Host '功能：检查 Node.js（>= 18）→ npm ci 按锁定的版本安装依赖 → 提示如何启动/打包'
    Write-Host '最终用户安装走 installer\setup.bat（联网下载 Harness 引擎）。'
    exit 0
}

# --- 1. Node.js 检查 ---------------------------------------------------------
$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
$nodeVersion = $null
if ($nodeExe) {
    $nodeVersion = (& $nodeExe -v 2>$null | Select-Object -First 1)
}
if (-not $nodeExe -or -not $nodeVersion) {
    Write-Setup '未检测到 Node.js。请先安装 Node.js >= 18（https://nodejs.org，或 nvm/volta），再重新运行。'
    exit 1
}
$match = [regex]::Match($nodeVersion, '^v?([0-9]+)')
if (-not $match.Success -or [int]$match.Groups[1].Value -lt 18) {
    Write-Setup "Node.js 版本过低：$nodeVersion（需要 >= 18）。请升级后重试。"
    exit 1
}
Write-Setup "Node.js $nodeVersion 就绪"

# --- 2. 安装依赖 --------------------------------------------------------------
$npmCommand = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npmCommand) { $npmCommand = 'npm' }

if (-not $NoInstall) {
    if (Test-Path (Join-Path $Root 'package-lock.json')) {
        Write-Setup '安装依赖（npm ci，按 package-lock.json 锁定版本）...'
        $npmArgs = @('ci')
    } else {
        Write-Setup '缺少 package-lock.json（从未 npm install 过？），改用 npm install ...'
        $npmArgs = @('install')
    }
    # 工作目录必须是项目根，否则依赖会装到用户当前的目录。Windows PowerShell 在输出被
    # 重定向（2>&1 等）时会把原生程序 stderr 变成错误记录，Stop 模式会被中途终止；
    # 安装的结果由退出码判定，因此子进程在 Continue 下运行。
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    Push-Location $Root
    try {
        & $npmCommand @npmArgs
        $exitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    $ErrorActionPreference = $previousErrorActionPreference
    if ($exitCode -ne 0) {
        Write-Setup "依赖安装失败（退出码 $exitCode）。请检查上面的输出。"
        exit $exitCode
    }
    Write-Setup '依赖安装完成。'
}

# --- 3. 结果与指引 ------------------------------------------------------------
$electronExe = Join-Path $Root 'node_modules\electron\dist\electron.exe'
if (Test-Path $electronExe) {
    Write-Setup 'Electron 运行时就绪。'
} else {
    Write-Setup '提示：未发现 node_modules\electron（依赖被跳过或安装失败，请检查 npm 输出）。'
}

Write-Setup ''
Write-Setup 'DSH Desktop 开发环境就绪：'
Write-Setup '  - 开发运行（推荐，带日志）：npm start'
Write-Setup '  - 静默启动（无控制台窗口）：启动桌面端.bat'
Write-Setup '  - 构建分发包（Setup.exe / zip）：'
Write-Setup '      powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-dist.ps1'
Write-Setup '      （build-dist.ps1 依赖本机路径 D:\DSH-desktop / D:\DeepSeek-Harness / D:\nodejs / D:\7-Zip）'
Write-Setup '  - 最终用户安装包：installer\setup.bat（会联网下载约 500-700MB Harness 引擎）'
Write-Setup '  - Harness 源码目录默认 C:\Users\mjsx\DeepSeek-Harness，可用环境变量 DSH_HARNESS_DIR 覆盖'
