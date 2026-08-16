Add-Type -AssemblyName System.Drawing

$outIco = "D:\DS_harness\icon.ico"
$outPng = "D:\DS_harness\icon.png"

function New-MasterBitmap {
  $size = 256
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  # 1. 深空渐变底
  $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect,
    [System.Drawing.Color]::FromArgb(255, 3, 5, 8),
    [System.Drawing.Color]::FromArgb(255, 26, 18, 48), 135)
  $g.FillRectangle($bg, $rect)
  $bg.Dispose()

  # 2. 星云雾霭（紫 + 青）
  function New-Glow([float]$cx, [float]$cy, [float]$r, [System.Drawing.Color]$core, [System.Drawing.Color]$edge) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddEllipse($cx - $r, $cy - $r, 2 * $r, 2 * $r)
    $pgb = New-Object System.Drawing.Drawing2D.PathGradientBrush($path)
    $pgb.CenterColor = $core
    $pgb.SurroundColors = [System.Drawing.Color[]]@($edge)
    return $pgb
  }

  $n1 = New-Glow 200 60 130 ([System.Drawing.Color]::FromArgb(90, 123, 97, 255)) ([System.Drawing.Color]::FromArgb(0, 123, 97, 255))
  $g.FillEllipse($n1, 70, -70, 260, 260)
  $n1.Dispose()

  $n2 = New-Glow 50 210 120 ([System.Drawing.Color]::FromArgb(70, 0, 212, 170)) ([System.Drawing.Color]::FromArgb(0, 0, 212, 170))
  $g.FillEllipse($n2, -70, 90, 240, 240)
  $n2.Dispose()

  $n3 = New-Glow 240 200 100 ([System.Drawing.Color]::FromArgb(60, 255, 107, 53)) ([System.Drawing.Color]::FromArgb(0, 255, 107, 53))
  $g.FillEllipse($n3, 140, 100, 200, 200)
  $n3.Dispose()

  # 3. 超新星爆发核心
  $core = New-Glow 128 128 115 ([System.Drawing.Color]::FromArgb(255, 255, 255, 255)) ([System.Drawing.Color]::FromArgb(0, 123, 97, 255))
  $g.FillEllipse($core, 13, 13, 230, 230)
  $core.Dispose()

  $mid = New-Glow 128 128 62 ([System.Drawing.Color]::FromArgb(255, 232, 244, 248)) ([System.Drawing.Color]::FromArgb(0, 0, 212, 170))
  $g.FillEllipse($mid, 66, 66, 124, 124)
  $mid.Dispose()

  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $g.FillEllipse($white, 108, 108, 40, 40)
  $white.Dispose()

  # 4. 十字星芒 + 对角短芒（衍射尖峰）
  $rand = New-Object System.Random(2026)
  $spikeDefs = @(
    @(0.0, 118), @(90.0, 118), @(180.0, 118), @(270.0, 118),
    @(45.0, 62), @(135.0, 62), @(225.0, 62), @(315.0, 62)
  )
  foreach ($sp in $spikeDefs) {
    $ang = $sp[0] * [Math]::PI / 180.0
    $len = $sp[1]
    $dirX = [Math]::Cos($ang)
    $dirY = [Math]::Sin($ang)
    $startX = 128 + $dirX * 26
    $startY = 128 + $dirY * 26
    $endX = 128 + $dirX * $len
    $endY = 128 + $dirY * $len
    $steps = 14
    for ($s = 1; $s -le $steps; $s++) {
      $t = $s / $steps
      $a = [int](200 * (1 - $t))
      $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb($a, 232, 244, 248), [float](3.2 * (1 - $t) + 0.4))
      $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
      $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
      $x1 = $startX + ($endX - $startX) * ($s - 1) / $steps
      $y1 = $startY + ($endY - $startY) * ($s - 1) / $steps
      $x2 = $startX + ($endX - $startX) * $s / $steps
      $y2 = $startY + ($endY - $startY) * $s / $steps
      $g.DrawLine($pen, [float]$x1, [float]$y1, [float]$x2, [float]$y2)
      $pen.Dispose()
    }
  }

  # 5. 爆发粒子
  for ($i = 0; $i -lt 60; $i++) {
    $ang = $rand.NextDouble() * 2 * [Math]::PI
    $dist = 32 + $rand.NextDouble() * 88
    $x = 128 + [Math]::Cos($ang) * $dist
    $y = 128 + [Math]::Sin($ang) * $dist
    $a = [int](90 + $rand.NextDouble() * 150)
    $c = if ($rand.NextDouble() -lt 0.5) { [System.Drawing.Color]::FromArgb($a, 0, 212, 170) } else { [System.Drawing.Color]::FromArgb($a, 123, 97, 255) }
    $b = New-Object System.Drawing.SolidBrush($c)
    $r = 0.6 + $rand.NextDouble() * 1.6
    $g.FillEllipse($b, [float]($x - $r / 2), [float]($y - $r / 2), [float]$r, [float]$r)
    $b.Dispose()
  }

  # 6. 满天恒星
  for ($i = 0; $i -lt 170; $i++) {
    $x = $rand.NextDouble() * 256
    $y = $rand.NextDouble() * 256
    if ([Math]::Sqrt((($x - 128) * ($x - 128)) + (($y - 128) * ($y - 128))) -lt 26) { continue }
    $a = [int](110 + $rand.NextDouble() * 145)
    $c = [System.Drawing.Color]::FromArgb($a, 232, 244, 248)
    $b = New-Object System.Drawing.SolidBrush($c)
    $r = 0.5 + $rand.NextDouble() * 1.5
    $g.FillEllipse($b, [float]$x, [float]$y, [float]$r, [float]$r)
    $b.Dispose()
  }

  # 7. 左上流星
  $mx1, $my1 = 40, 26
  $mx2, $my2 = 6, 68
  $msteps = 16
  for ($s = 1; $s -le $msteps; $s++) {
    $t = $s / $msteps
    $a = [int](170 * (1 - $t) + 60 * $t)
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb($a, 0, 212, 170), [float](2.6 * (1 - $t) + 0.4))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $x1 = $mx1 + ($mx2 - $mx1) * ($s - 1) / $msteps
    $y1 = $my1 + ($my2 - $my1) * ($s - 1) / $msteps
    $x2 = $mx1 + ($mx2 - $mx1) * $s / $msteps
    $y2 = $my1 + ($my2 - $my1) * $s / $msteps
    $g.DrawLine($pen, [float]$x1, [float]$y1, [float]$x2, [float]$y2)
    $pen.Dispose()
  }
  $mhead = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(240, 232, 244, 248))
  $g.FillEllipse($mhead, [float]($mx1 - 2), [float]($my1 - 2), 4, 4)
  $mhead.Dispose()

  $g.Dispose()
  return $bmp
}

function Save-PngBytes([System.Drawing.Bitmap]$bmp) {
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $ms.ToArray()
  $ms.Dispose()
  return $bytes
}

function Resize-Bitmap([System.Drawing.Bitmap]$src, [int]$s) {
  $b = New-Object System.Drawing.Bitmap($s, $s)
  $g = [System.Drawing.Graphics]::FromImage($b)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($src, 0, 0, $s, $s)
  $g.Dispose()
  return $b
}

# ---- 渲染 256 母版 ----
$master = New-MasterBitmap
$master.Save($outPng, [System.Drawing.Imaging.ImageFormat]::Png)

# ---- 多尺寸并组装 ICO ----
$sizes = @(256, 128, 64, 48, 32, 16)
$pngs = New-Object 'System.Collections.ArrayList'
$bmps = @{}
foreach ($s in $sizes) {
  $b = if ($s -eq 256) { $master } else { Resize-Bitmap $master $s }
  $null = $pngs.Add([byte[]](Save-PngBytes $b))
  if ($s -ne 256) { $b.Dispose() }
}
$master.Dispose()

$fs = [System.IO.File]::Create($outIco)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([uint16]0)
$bw.Write([uint16]1)
$bw.Write([uint16]$sizes.Length)
$offset = 6 + 16 * $sizes.Length
for ($i = 0; $i -lt $sizes.Length; $i++) {
  $s = $sizes[$i]
  $bw.Write([byte]$(if ($s -ge 256) { 0 } else { $s }))
  $bw.Write([byte]$(if ($s -ge 256) { 0 } else { $s }))
  $bw.Write([byte]0)
  $bw.Write([byte]0)
  $bw.Write([uint16]1)
  $bw.Write([uint16]32)
  $bw.Write([uint32]$pngs[$i].Length)
  $bw.Write([uint32]$offset)
  $offset += $pngs[$i].Length
}
foreach ($png in $pngs) { $bw.Write([byte[]]$png) }
$bw.Close()
$fs.Close()

# ---- 创建桌面快捷方式 ----
$desktop = [Environment]::GetFolderPath('Desktop')
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut("$desktop\DeepSeek 观测站.lnk")
$lnk.TargetPath = "D:\DS_harness\node_modules\electron\dist\electron.exe"
$lnk.Arguments = '"D:\DS_harness"'
$lnk.WorkingDirectory = "D:\DS_harness"
$lnk.IconLocation = "$outIco,0"
$lnk.Description = "DeepSeek Harness 深空观测站"
$lnk.Save()

Write-Output ("icon.ico: {0} bytes" -f (Get-Item $outIco).Length)
Write-Output ("icon.png: {0} bytes" -f (Get-Item $outPng).Length)
Write-Output ("shortcut: $desktop\DeepSeek 观测站.lnk")
