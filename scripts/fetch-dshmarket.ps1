# fetch-dshmarket.ps1 —— 拉取 dshmarket 的 npm tarball 到 extras\dsh-market-bundle\
# 设计：默认走国内镜像（registry.npmmirror），多镜像兜底（npmmirror / npmjs 官方 / 腾讯云）。
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fetch-dshmarket.ps1 -Version 1.18.0
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fetch-dshmarket.ps1 -Version 1.18.0 -Registry https://registry.npmjs.org
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fetch-dshmarket.ps1 -Version 1.18.0 -VerifyOnly   # 仅校验已有文件
# 产出：
#   extras\dsh-market-bundle\dshmarket-<version>.tgz
#   extras\dsh-market-bundle\manifest.json
# SHA256 校验：写入 manifest.json + 重新跑同一脚本时会自动校验，不一致则报错。
param(
  [string]$Version = '1.18.0',
  [string]$Registry = 'https://registry.npmmirror.com',
  [switch]$VerifyOnly,
  [string]$BundleDir = ''   # 默认 = 脚本所在目录的上级\extras\dsh-market-bundle
)
$ErrorActionPreference = 'Stop'

# ---- 输出编码强制 UTF-8（与编码铁律一致） ----
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
try { $OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

if (-not $BundleDir) { $BundleDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'extras\dsh-market-bundle' }
New-Item -ItemType Directory -Path $BundleDir -Force | Out-Null

$tarballName = "dshmarket-$Version.tgz"
$tarballPath = Join-Path $BundleDir $tarballName
$manifestPath = Join-Path $BundleDir 'manifest.json'

# ---- 1. 仅校验模式 ----
if ($VerifyOnly) {
  if (-not (Test-Path $manifestPath)) { throw "manifest.json 不存在: $manifestPath" }
  if (-not (Test-Path $tarballPath)) { throw "tarball 不存在: $tarballPath" }
  $m = Get-Content -Raw -Path $manifestPath -Encoding UTF8 | ConvertFrom-Json
  $h = (Get-FileHash -Path $tarballPath -Algorithm SHA256).Hash.ToLower()
  if ($h -ne $m.sha256.ToLower()) { throw "SHA256 校验失败：期望 $($m.sha256)，实际 $h" }
  Write-Host "OK: $tarballName 校验通过（SHA256 = $h）" -ForegroundColor Green
  exit 0
}

# ---- 2. 组装 tarball 下载 URL（npm 标准格式：<registry>/<pkg>/-/<pkg>-<ver>.tgz） ----
# 实测：https://registry.npmjs.org/dshmarket/-/dshmarket-1.18.0.tgz 直连 200（npmmirror 同路径 302 可跟随）。
# 用「标准 tarball 路径」而非 metadata 探测——避免 registry 对单版本 URL 的行为差异。
$regs = @(
  $Registry,
  'https://registry.npmmirror.com',
  'https://registry.npmjs.org'
) | ForEach-Object { $_.TrimEnd('/') } | Select-Object -Unique
$candidates = @()
foreach ($r in $regs) {
  $candidates += ($r + '/dshmarket/-/dshmarket-' + $Version + '.tgz')
}

$got = $false
$tarballUrl = ''
foreach ($u in $candidates) {
  Write-Host "  downloading: $u"
  $i = 0; $ok = $false
  do {
    try {
      Invoke-WebRequest -Uri $u -OutFile $tarballPath -UseBasicParsing -TimeoutSec 120
      if ((Test-Path $tarballPath) -and (Get-Item $tarballPath).Length -gt 1000) { $ok = $true; break }
    } catch { $i++; if ($i -ge 2) { break }; Write-Host "    attempt $i failed: $($_.Exception.Message)" }
  } while (-not $ok)
  if ($ok) { $got = $true; $tarballUrl = $u; break }
  Remove-Item $tarballPath -Force -ErrorAction SilentlyContinue
}
if (-not $got) { throw "tarball 下载失败（所有镜像均失败），请手动下载: https://registry.npmjs.org/dshmarket/-/dshmarket-$Version.tgz" }

# ---- 4. SHA256 校验并写 manifest ----
# 说明：manifest.json 是本项目自己的信任锚点——安装时 setup.ps1 校验「打包的 tarball 与
# manifest.sha256 一致」，防止发行包被篡改/损坏。上游 dist.integrity 不做依赖（不同 registry
# 返回格式不一，且我们打包的就是本机这份 tarball，以本机 SHA256 为准）。
$hash = (Get-FileHash -Path $tarballPath -Algorithm SHA256).Hash.ToLower()
$size = (Get-Item $tarballPath).Length
Write-Host "  SHA256 = $hash ($size bytes)"

$manifest = [ordered]@{
  name      = 'dshmarket'
  version   = $Version
  registry  = $Registry
  tarball   = $tarballName
  sha256    = $hash
  fetchedAt = (Get-Date).ToString('o')
  sizeBytes = $size
  notes     = '生成自 scripts/fetch-dshmarket.ps1；setup.ps1 安装前会校验 SHA256'
}
$json = $manifest | ConvertTo-Json -Depth 5
# 强制 UTF-8 无 BOM
[System.IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ''
Write-Host '==============================================' -ForegroundColor Green
Write-Host "  dshmarket@$Version 拉取完成"
Write-Host "    tarball : $tarballPath"
Write-Host "    manifest: $manifestPath"
Write-Host "    SHA256  : $hash"
Write-Host "    size    : $size bytes"
Write-Host ''
Write-Host "  下一步：跑 build-dist.ps1 把它打进 Setup.exe："
Write-Host "    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-dist.ps1 -Version 0.5.4"
Write-Host '==============================================' -ForegroundColor Green