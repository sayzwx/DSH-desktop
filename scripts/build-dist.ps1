# Build the DSH Desktop distributable:
#   1. stages app + harness + bundled Node + config + installer into dist/stage/
#   2. packs them into dist/DSH-Desktop-v<ver>.zip
#   3. compiles a self-extracting Setup.exe (embedded zip, runs setup.bat)
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-dist.ps1
param([string]$Version = '0.1.0')
$ErrorActionPreference = 'Stop'
$root = 'D:\DSH-desktop'
$dist = Join-Path $root 'dist'
$stageRoot = Join-Path $dist 'stage'
$name = "DSH-Desktop-v$Version"
$stage = Join-Path $stageRoot $name

Remove-Item $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stage -Force | Out-Null

function Copy-Tree([string]$from, [string]$to, [string[]]$xd) {
  Write-Host "staging $from -> $to"
  $args = @($from, $to, '/E', '/MT:16', '/NFL', '/NDL', '/NJH', '/NJS', '/R:1', '/W:1')
  foreach ($d in $xd) { $args += @('/XD', $d) }
  robocopy @args | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $from" }
}

Write-Host "=== Staging $name ==="
Copy-Tree $root              (Join-Path $stage 'app')       @('.git', 'dist')
Copy-Tree 'D:\DeepSeek-Harness' (Join-Path $stage 'harness') @('.git')
Copy-Tree 'D:\nodejs'        (Join-Path $stage 'tools\node') @()

$cfg = Join-Path $stage 'config'
New-Item -ItemType Directory -Path $cfg -Force | Out-Null
Copy-Item (Join-Path $env:USERPROFILE '.dsh\settings.yaml')  (Join-Path $cfg 'settings.yaml') -Force
Copy-Item (Join-Path $env:USERPROFILE '.dsh\zen-ua-proxy.mjs') (Join-Path $cfg 'zen-ua-proxy.mjs') -Force

Copy-Item (Join-Path $root 'installer\setup.ps1') (Join-Path $stage 'setup.ps1') -Force
Copy-Item (Join-Path $root 'installer\setup.bat') (Join-Path $stage 'setup.bat') -Force
Copy-Item (Join-Path $root 'installer\安装说明.txt') (Join-Path $stage '安装说明.txt') -Force

Write-Host "=== Zipping $name.zip ==="
$zip = Join-Path $dist "$name.zip"
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
Write-Host ("zip: {0:N0} MB" -f ((Get-Item $zip).Length / 1MB))

Write-Host "=== Building self-extracting Setup.exe ==="
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { Write-Host 'csc not found - skipping Setup.exe (zip is the deliverable)'; exit 0 }
$exeOut = Join-Path $dist "$name-Setup.exe"
Remove-Item $exeOut -Force -ErrorAction SilentlyContinue
& $csc /nologo /optimize+ "/out:$exeOut" "/resource:$zip,DSH.bundle.zip" `
  /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll `
  (Join-Path $root 'scripts\extractor.cs')
if ($LASTEXITCODE -ne 0) { throw 'csc failed' }
Write-Host ("Setup.exe: {0:N0} MB" -f ((Get-Item $exeOut).Length / 1MB))
Write-Host "=== Done: $zip / $exeOut ==="
