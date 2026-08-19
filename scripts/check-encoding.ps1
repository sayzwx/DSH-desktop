<#
.SYNOPSIS
    仓库文本编码检查：确保中文内容不会以错误编码入库 / 打包（全局编码防线）。

    规则（本项目约定，Windows 生态相关）：
      .ps1        必须 UTF-8 带 BOM —— Windows PowerShell 5.1 对无 BOM 文件按
                  本机 ANSI/GBK 解析，中文字节里可能混入引号字节导致语法崩溃
      .txt        必须 UTF-8 带 BOM —— 中文 Windows 记事本把无 BOM 的 UTF-8 当
                  ANSI 显示，用户打开说明文件会看到乱码
      .bat/.cmd   必须无 BOM —— cmd 会把 BOM 字节当命令执行报错；内容保持 ASCII 最安全
      其他文本    必须有效 UTF-8 且无 BOM（.js .mjs .json .html .css .md .yml .yaml），
                  严格解码校验能抓出 GBK/ANSI 内容

.DESCRIPTION
    用法：powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-encoding.ps1 [-Fix]
    -Fix：自动补/去 BOM（不会转码 GBK 内容——那种情况会列出文件要求人工重新保存）。

    已接入：
      - scripts\build-dist.ps1（打包前强制检查，不过不放行）
      - .github\workflows\encoding-check.yml（每次 push / PR 检查）
.EXAMPLE
    .\scripts\check-encoding.ps1            # 检查并报告
    .\scripts\check-encoding.ps1 -Fix       # 检查并自动修复 BOM 问题
#>
param([switch]$Fix)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$skipDirs = @('.git', 'node_modules', 'dist', 'wallpaper-engine', 'scripts\.scratch')
$requireBom = @('.ps1', '.txt')      # 必须带 BOM
$forbidBom = @('.bat', '.cmd', '.js', '.mjs', '.json', '.html', '.css', '.md', '.yml', '.yaml')

$issues = New-Object System.Collections.Generic.List[string]
$count = 0

# 迭代枚举并剪枝：不下钻跳过目录（node_modules 等），避免遍历上万文件
$files = New-Object System.Collections.Generic.List[string]
$stack = New-Object System.Collections.Generic.Stack[string]
$stack.Push($root)
while ($stack.Count -gt 0) {
  $d = $stack.Pop()
  foreach ($sub in Get-ChildItem $d -Directory -Force -ErrorAction SilentlyContinue) {
    $rel = $sub.FullName.Substring($root.Length + 1)
    if ($skipDirs -contains $rel) { continue }
    $stack.Push($sub.FullName)
  }
  foreach ($f in Get-ChildItem $d -File -Force -ErrorAction SilentlyContinue) {
    $ext = $f.Extension.ToLower()
    if (($requireBom -contains $ext) -or ($forbidBom -contains $ext)) { $files.Add($f.FullName) }
  }
}

foreach ($full in $files) {
  $count++
  $rel = $full.Substring($root.Length + 1)
  $bytes = [System.IO.File]::ReadAllBytes($full)
  $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
  $body = if ($hasBom) { $bytes[3..($bytes.Length - 1)] } else { $bytes }
  try {
    $strict = New-Object System.Text.UTF8Encoding($false, $true)   # throwOnInvalidBytes
    [void]$strict.GetString($body)
    $validUtf8 = $true
  } catch { $validUtf8 = $false }

  $ext = [System.IO.Path]::GetExtension($full).ToLower()
  if ($requireBom -contains $ext) {
    if (-not $validUtf8) {
      $issues.Add("$rel : 不是有效 UTF-8（疑似 GBK/ANSI），请用编辑器重新保存为「UTF-8 带 BOM」")
    } elseif (-not $hasBom) {
      if ($Fix) {
        [System.IO.File]::WriteAllBytes($full, [byte[]](0xEF, 0xBB, 0xBF) + $bytes)
        Write-Host "FIXED (+BOM): $rel"
      } else {
        $issues.Add("$rel : .ps1/.txt 缺少 UTF-8 BOM（Windows PowerShell/记事本会乱码）")
      }
    }
  } else {
    if (-not $validUtf8) {
      $issues.Add("$rel : 不是有效 UTF-8（疑似 GBK/ANSI），请用编辑器重新保存为 UTF-8 无 BOM")
    } elseif ($hasBom) {
      if ($Fix) {
        [System.IO.File]::WriteAllBytes($full, $body)
        Write-Host "FIXED (-BOM): $rel"
      } else {
        $issues.Add("$rel : 不应带 BOM（cmd 会报错 / Node 解析受影响），请去掉 BOM")
      }
    }
  }
}

Write-Host ("checked {0} text files under {1}" -f $count, $root)
if ($issues.Count -gt 0) {
  Write-Host ''
  Write-Host ('发现 {0} 个编码问题（可用 -Fix 自动修复 BOM 类问题）：' -f $issues.Count) -ForegroundColor Red
  $issues | ForEach-Object { Write-Host ('  ' + $_) -ForegroundColor Red }
  exit 1
}
Write-Host 'OK: 所有文本文件编码符合约定' -ForegroundColor Green
exit 0
