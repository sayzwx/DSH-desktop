# DSH Desktop one-click installer (run from setup.bat, no admin required)
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
Write-Host '  DSH Desktop + DeepSeek Harness Installer'
Write-Host '=============================================='
Write-Host ''
Write-Host "Installing to: $Dest"
New-Item -ItemType Directory -Path $Dest -Force | Out-Null

Write-Host ''
Write-Host '[1/4] Installing application (DSH Desktop UI) ...'
Copy-Tree (Join-Path $Src 'app')       (Join-Path $Dest 'app')
Write-Host '[2/4] Installing harness engine ...'
Copy-Tree (Join-Path $Src 'harness')   (Join-Path $Dest 'harness')
Write-Host '[3/4] Installing bundled Node.js runtime ...'
Copy-Tree (Join-Path $Src 'tools\node') (Join-Path $Dest 'tools\node')

Write-Host ''
Write-Host '[4/4] Writing user configuration (~/.dsh) ...'
$dshHome = Join-Path $Home '.dsh'
New-Item -ItemType Directory -Path $dshHome -Force | Out-Null
if (-not (Test-Path (Join-Path $dshHome 'settings.yaml'))) {
  Copy-Item (Join-Path $Src 'config\settings.yaml') (Join-Path $dshHome 'settings.yaml') -Force
  Write-Host '  settings.yaml written (first install; your existing config is kept untouched)'
} else {
  Write-Host '  settings.yaml already exists - keeping yours'
}
Copy-Item (Join-Path $Src 'config\zen-ua-proxy.mjs') (Join-Path $dshHome 'zen-ua-proxy.mjs') -Force
$nodeExe = Join-Path $Dest 'tools\node\node.exe'
$mjs     = Join-Path $dshHome 'zen-ua-proxy.mjs'
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

Write-Host ''
Write-Host 'Creating shortcuts ...'
$exe = Join-Path $Dest 'app\node_modules\electron\dist\electron.exe'
$appArg = '"' + (Join-Path $Dest 'app') + '"'
$ws = New-Object -ComObject WScript.Shell
foreach ($dir in @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'))) {
  $lnk = Join-Path $dir 'DSH Desktop.lnk'
  $s = $ws.CreateShortcut($lnk)
  $s.TargetPath = $exe
  $s.Arguments = $appArg
  $s.WorkingDirectory = Join-Path $Dest 'app'
  $s.IconLocation = (Join-Path $Dest 'app\icon-planet.ico')
  $s.Save()
}

Write-Host ''
Write-Host '=============================================='
Write-Host '  Installation complete. Launching DSH Desktop ...'
Write-Host '=============================================='
Start-Process -FilePath $exe -ArgumentList $appArg
