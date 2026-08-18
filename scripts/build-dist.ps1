# Build the DSH Desktop distributables (normal installer style):
#   1. DSH-Desktop-v<ver>.zip / -Setup.exe : small app package
#      (desktop UI + Electron runtime + installer; ~100 MB, like any Electron app)
#   2. DSH-Harness-bundle-v<ver>.zip        : heavy harness engine payload
#      (harness source + node_modules + bundled Node; downloaded once during install)
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-dist.ps1
param([string]$Version = '0.1.0')
$ErrorActionPreference = 'Stop'
$root = 'D:\DSH-desktop'
$dist = Join-Path $root 'dist'
$name = "DSH-Desktop-v$Version"
$harnessName = "DSH-Harness-bundle-v$Version"

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
Write-Host "=== Building $name (app only) ==="
$stage = Join-Path $dist "stage\$name"
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stage -Force | Out-Null
Copy-Tree $root (Join-Path $stage 'app') @("$root\.git", "$root\dist")
$cfg = Join-Path $stage 'config'
New-Item -ItemType Directory -Path $cfg -Force | Out-Null
Copy-Item (Join-Path $env:USERPROFILE '.dsh\settings.yaml')    (Join-Path $cfg 'settings.yaml') -Force
Copy-Item (Join-Path $env:USERPROFILE '.dsh\zen-ua-proxy.mjs') (Join-Path $cfg 'zen-ua-proxy.mjs') -Force
Copy-Item (Join-Path $root 'installer\setup.ps1')    (Join-Path $stage 'setup.ps1') -Force
Copy-Item (Join-Path $root 'installer\setup.bat')    (Join-Path $stage 'setup.bat') -Force
Copy-Item (Join-Path $root 'installer\安装说明.txt') (Join-Path $stage '安装说明.txt') -Force
$zip = Join-Path $dist "$name.zip"
Make-Zip $stage $zip

# ---------- 2. harness engine payload ----------
Write-Host "=== Building $harnessName (harness + bundled Node) ==="
$hstage = Join-Path $dist "stage\$harnessName"
Remove-Item $hstage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $hstage -Force | Out-Null
Copy-Tree 'D:\DeepSeek-Harness' (Join-Path $hstage 'harness') @('D:\DeepSeek-Harness\.git')
Copy-Tree 'D:\nodejs'           (Join-Path $hstage 'tools\node') @()
$hzip = Join-Path $dist "$harnessName.zip"
Make-Zip $hstage $hzip

# ---------- 3. self-extracting Setup.exe (app package only) ----------
Write-Host "=== Building $name-Setup.exe ==="
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { Write-Host 'csc not found - skipping Setup.exe (zips are the deliverables)'; exit 0 }
$exeOut = Join-Path $dist "$name-Setup.exe"
& $csc /nologo /optimize+ "/out:$exeOut" "/resource:$zip,DSH.bundle.zip" `
  /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll `
  (Join-Path $root 'scripts\extractor.cs')
if ($LASTEXITCODE -ne 0) { throw 'csc failed' }
Write-Host ("  {0:N0} MB" -f ((Get-Item $exeOut).Length / 1MB))
Write-Host "=== Done ==="
Get-ChildItem $dist -File | Select-Object Name, @{N='MB';E={[math]::Round($_.Length/1MB,1)}} | Format-Table -AutoSize
