# 创建桌面快捷方式「DSH」（已存在则跳过）。
# 供桌面端应用首启兜底调用（main.js -> ensureShortcut），也兼容安装器手动复用。
param(
  [string]$ExePath,     # DSH.exe 绝对路径
  [string]$WorkingDir,  # 工作目录（一般取 exe 所在目录）
  [string]$IconPath     # DSH.ico 绝对路径（可选）
)
try {
  $ws = New-Object -ComObject WScript.Shell
  $desktop = [Environment]::GetFolderPath('Desktop')
  $lnk = Join-Path $desktop 'DSH.lnk'
  if (-not (Test-Path $lnk)) {
    $s = $ws.CreateShortcut($lnk)
    $s.TargetPath = $ExePath
    $s.WorkingDirectory = $WorkingDir
    if ($IconPath -and (Test-Path $IconPath)) { $s.IconLocation = "$IconPath, 0" }
    $s.Description = 'DSH Desktop（DeepSeek Harness Desktop）'
    $s.Save()
  }
} catch { exit 1 }
exit 0