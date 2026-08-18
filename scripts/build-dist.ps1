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
# 中文文件名在无 BOM 的 PS1 里会被按 GBK 误读，用通配符避开字面量
Get-ChildItem (Join-Path $root 'installer') -Filter '*.txt' | Copy-Item -Destination $stage -Force
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

# ---------- 3. self-extracting Setup.exe (7-Zip SFX, LZMA2 - small) ----------
Write-Host "=== Building $name-Setup.exe (7-Zip SFX) ==="
$sz7 = 'D:\7-Zip\7z.exe'
$sfx = 'D:\7-Zip\7z.sfx'
if (-not (Test-Path $sz7) -or -not (Test-Path $sfx)) {
  Write-Host '7-Zip not found - Setup.exe skipped (zip is the deliverable)'
} else {
  $sz7file = Join-Path $dist "$name.7z"
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
