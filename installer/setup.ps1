# DSH Desktop one-click installer (normal installer style: small app package,
# heavy harness engine is downloaded once during install, not bundled).
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" [-SkipHarness]
param(
  [string]$HarnessUrl = 'https://github.com/sayzwx/DSH-desktop/releases/latest/download/DSH-Harness-bundle-v0.1.0.zip',
  [switch]$SkipHarness
)
$ErrorActionPreference = 'Stop'
$Dest  = Join-Path $env:LOCALAPPDATA 'DSH'
$Home  = $env:USERPROFILE
$Src   = Split-Path -Parent $MyInvocation.MyCommand.Path

function Copy-Tree([string]$from, [string]$to) {
  Write-Host "  -> $to"
  robocopy $from $to /E /MT:16 /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $from -> $to" }
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
$dshHome = Join-Path $Home '.dsh'
New-Item -ItemType Directory -Path $dshHome -Force | Out-Null
if (-not (Test-Path (Join-Path $dshHome 'settings.yaml'))) {
  Copy-Item (Join-Path $Src 'config\settings.yaml') (Join-Path $dshHome 'settings.yaml') -Force
  Write-Host '  settings.yaml written (first install; existing config kept)'
} else {
  Write-Host '  settings.yaml already exists - keeping yours'
}
Copy-Item (Join-Path $Src 'config\zen-ua-proxy.mjs') (Join-Path $dshHome 'zen-ua-proxy.mjs') -Force

Write-Host ''
Write-Host '[3/3] Harness engine (DeepSeek Harness) ...'
$harnessDir = Join-Path $Dest 'harness'
$haveHarness = (Test-Path (Join-Path $harnessDir 'package.json')) -or (Test-Path 'D:\DeepSeek-Harness\package.json')
if ($haveHarness) {
  Write-Host '  harness engine already present - skipping download'
} elseif ($SkipHarness) {
  Write-Host '  skipped (-SkipHarness). The app will ask for the engine on first start.'
} else {
  $localZip = Join-Path $Src 'DSH-Harness-bundle-v0.1.0.zip'
  if (-not (Test-Path $localZip)) {
    Write-Host '  downloading harness engine (about 500-700 MB, one time only)...'
    Write-Host "  from: $HarnessUrl"
    $tmpZip = Join-Path $env:TEMP 'DSH-Harness-bundle.zip'
    $i = 0
    do {
      try {
        Invoke-WebRequest -Uri $HarnessUrl -OutFile $tmpZip -UseBasicParsing
        $ok = $true
      } catch {
        $i++
        if ($i -ge 3) { throw "download failed after 3 attempts: $($_.Exception.Message)" }
        Write-Host "  attempt $i failed, retrying ..."
        Start-Sleep -Seconds 3
      }
    } while (-not $ok)
    Write-Host ("  downloaded: {0:N0} MB" -f ((Get-Item $tmpZip).Length / 1MB))
  } else {
    $tmpZip = $localZip
    Write-Host '  using local bundle zip found next to setup'
  }
  Write-Host '  extracting ...'
  Expand-Archive -Path $tmpZip -DestinationPath $Dest -Force
  if ($tmpZip -ne $localZip) { Remove-Item $tmpZip -Force -ErrorAction SilentlyContinue }
  Write-Host '  harness engine installed.'
}

# UA proxy startup entry (needs bundled node from the harness bundle)
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
