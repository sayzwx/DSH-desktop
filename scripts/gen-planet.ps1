Add-Type -AssemblyName System.Drawing

$outIco = "D:\DS_harness\icon-planet.ico"
$outPng = "D:\DS_harness\icon-planet.png"

function Lerp-Color([System.Drawing.Color]$c1, [System.Drawing.Color]$c2, [float]$t) {
  $t = [Math]::Max(0.0, [Math]::Min(1.0, $t))
  return [System.Drawing.Color]::FromArgb(255,
    [int]($c1.R + ($c2.R - $c1.R) * $t),
    [int]($c1.G + ($c2.G - $c1.G) * $t),
    [int]($c1.B + ($c2.B - $c1.B) * $t))
}

function New-Glow([float]$cx, [float]$cy, [float]$r, [System.Drawing.Color]$core, [System.Drawing.Color]$edge) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddEllipse($cx - $r, $cy - $r, 2 * $r, 2 * $r)
  $pgb = [System.Drawing.Drawing2D.PathGradientBrush]::new($path)
  $pgb.CenterColor = $core
  $pgb.SurroundColors = [System.Drawing.Color[]]@($edge)
  return $pgb
}

function Ring-SegPoly([float]$cx, [float]$cy, [float]$k, [float]$Rout, [float]$Rin, [float]$t0, [float]$t1) {
  $pts = New-Object 'System.Collections.Generic.List[System.Drawing.PointF]'
  $sub = 5
  for ($i = 0; $i -le $sub; $i++) {
    $t = $t0 + ($t1 - $t0) * $i / $sub
    $pts.Add([System.Drawing.PointF]::new([float]($cx + $Rout * [Math]::Cos($t)), [float]($cy + $k * $Rout * [Math]::Sin($t))))
  }
  for ($i = $sub; $i -ge 0; $i--) {
    $t = $t0 + ($t1 - $t0) * $i / $sub
    $pts.Add([System.Drawing.PointF]::new([float]($cx + $Rin * [Math]::Cos($t)), [float]($cy + $k * $Rin * [Math]::Sin($t))))
  }
  return $pts.ToArray()
}

function Draw-RingHalf($g, [float]$cx, [float]$cy, [float]$k, [bool]$front) {
  $bands = @(
    @(100.0, 92.0, [System.Drawing.Color]::FromArgb(80, 190, 140, 90)),
    @(92.0, 82.0, [System.Drawing.Color]::FromArgb(120, 235, 190, 120)),
    @(74.0, 68.0, [System.Drawing.Color]::FromArgb(190, 252, 238, 205)),
    @(62.0, 58.0, [System.Drawing.Color]::FromArgb(110, 225, 165, 105)),
    @(56.0, 49.0, [System.Drawing.Color]::FromArgb(70, 185, 125, 75))
  )
  $segments = 60
  for ($i = 0; $i -lt $segments; $i++) {
    $t0 = 2 * [Math]::PI * $i / $segments
    $t1 = 2 * [Math]::PI * ($i + 1) / $segments
    $tm = ($t0 + $t1) / 2
    $isFront = [Math]::Sin($tm) -ge 0
    if ($isFront -ne $front) { continue }
    foreach ($b in $bands) {
      $alpha = $b[2].A
      if ($front) { $alpha = [int]($alpha * 1.12) }
      $c = [System.Drawing.Color]::FromArgb([Math]::Min(255, $alpha), $b[2].R, $b[2].G, $b[2].B)
      $poly = Ring-SegPoly $cx $cy $k $b[0] $b[1] $t0 $t1
      $br = [System.Drawing.SolidBrush]::new($c)
      $g.FillPolygon($br, $poly)
      $br.Dispose()
    }
  }
}

function New-MasterBitmap {
  $size = 256
  $bmp = [System.Drawing.Bitmap]::new($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $cx = 128.0
  $cy = 136.0
  $k = 0.38

  # 1. 深空底
  $rect = [System.Drawing.Rectangle]::new(0, 0, $size, $size)
  $c1 = [System.Drawing.Color]::FromArgb(255, 3, 4, 10)
  $c2 = [System.Drawing.Color]::FromArgb(255, 28, 18, 50)
  $bg = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rect, $c1, $c2, 135)
  $g.FillRectangle($bg, $rect)
  $bg.Dispose()

  # 2. 星云
  $n1 = New-Glow 205 60 130 ([System.Drawing.Color]::FromArgb(85, 123, 97, 255)) ([System.Drawing.Color]::FromArgb(0, 123, 97, 255))
  $g.FillEllipse($n1, 75, -70, 260, 260)
  $n1.Dispose()
  $n2 = New-Glow 40 200 115 ([System.Drawing.Color]::FromArgb(65, 0, 212, 170)) ([System.Drawing.Color]::FromArgb(0, 0, 212, 170))
  $g.FillEllipse($n2, -75, 85, 230, 230)
  $n2.Dispose()
  $n3 = New-Glow 235 195 95 ([System.Drawing.Color]::FromArgb(55, 255, 107, 53)) ([System.Drawing.Color]::FromArgb(0, 255, 107, 53))
  $g.FillEllipse($n3, 140, 100, 190, 190)
  $n3.Dispose()

  # 3. 星星
  $rand = [System.Random]::new(42)
  for ($i = 0; $i -lt 160; $i++) {
    $x = $rand.NextDouble() * 256
    $y = $rand.NextDouble() * 256
    $a = [int](90 + $rand.NextDouble() * 160)
    $rr = $rand.NextDouble()
    $cc = if ($rr -lt 0.65) { [System.Drawing.Color]::FromArgb($a, 230, 240, 250) } elseif ($rr -lt 0.85) { [System.Drawing.Color]::FromArgb($a, 200, 215, 255) } else { [System.Drawing.Color]::FromArgb($a, 255, 235, 200) }
    $b = [System.Drawing.SolidBrush]::new($cc)
    $r = 0.5 + $rand.NextDouble() * 1.4
    $g.FillEllipse($b, [float]$x, [float]$y, [float]$r, [float]$r)
    $b.Dispose()
  }

  # 4. 亮星光芒
  $sparkles = @(@(52, 60), @(218, 44), @(36, 150), @(226, 200))
  foreach ($sp in $sparkles) {
    $sx = $sp[0]; $sy = $sp[1]
    for ($s = 1; $s -le 4; $s++) {
      $t = $s / 4
      $a = [int](110 * (1 - $t))
      $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb($a, 240, 245, 255), [float](2.2 * (1 - $t) + 0.3))
      $g.DrawLine($pen, [float]$sx, [float]($sy - 14 * $t), [float]$sx, [float]($sy + 14 * $t))
      $g.DrawLine($pen, [float]($sx - 14 * $t), [float]$sy, [float]($sx + 14 * $t), [float]$sy)
      $pen.Dispose()
    }
  }

  # 5. 后环（天体背后）
  Draw-RingHalf $g $cx $cy $k $false

  # 6. 天体：大气晕 + 球体 + 云带
  $atmo = New-Glow $cx ($cy - 6) 68 ([System.Drawing.Color]::FromArgb(70, 255, 190, 120)) ([System.Drawing.Color]::FromArgb(0, 255, 190, 120))
  $g.FillEllipse($atmo, $cx - 68, $cy - 6 - 68, 136, 136)
  $atmo.Dispose()

  $pr = 42.0
  $ball = New-Glow $cx ($cy - 6) $pr ([System.Drawing.Color]::FromArgb(255, 255, 236, 200)) ([System.Drawing.Color]::FromArgb(255, 168, 105, 48))
  $ball.CenterPoint = [System.Drawing.PointF]::new([float]($cx - 10), [float]($cy - 6 - 12))
  $g.FillEllipse($ball, [float]($cx - $pr), [float]($cy - 6 - $pr), [float](2 * $pr), [float](2 * $pr))
  $ball.Dispose()

  $bandCol = [System.Drawing.Color]::FromArgb(95, 148, 92, 42)
  foreach ($off in @(-16, -4, 8, 19)) {
    $by = $cy - 6 + $off
    $bw = 3.2
    $pen = [System.Drawing.Pen]::new($bandCol, [float]$bw)
    $g.DrawEllipse($pen, [float]($cx - $pr * 0.82), [float]($by - $pr * 0.28), [float](2 * $pr * 0.82), [float](2 * $pr * 0.28))
    $pen.Dispose()
  }
  $highlight = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(60, 255, 248, 230))
  $g.FillEllipse($highlight, [float]($cx - $pr * 0.72), [float]($cy - 6 - $pr * 0.62), [float](2 * $pr * 0.55), [float](2 * $pr * 0.30))
  $highlight.Dispose()

  # 7. 前环（天体前方，半透明盘）
  Draw-RingHalf $g $cx $cy $k $true

  $g.Dispose()
  return $bmp
}

function Save-PngBytes([System.Drawing.Bitmap]$bmp) {
  $ms = [System.IO.MemoryStream]::new()
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $ms.ToArray()
  $ms.Dispose()
  return $bytes
}

function Resize-Bitmap([System.Drawing.Bitmap]$src, [int]$s) {
  $b = [System.Drawing.Bitmap]::new($s, $s)
  $g = [System.Drawing.Graphics]::FromImage($b)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($src, 0, 0, $s, $s)
  $g.Dispose()
  return $b
}

$master = New-MasterBitmap
$master.Save($outPng, [System.Drawing.Imaging.ImageFormat]::Png)

$sizes = @(256, 128, 64, 48, 32, 16)
$pngs = New-Object 'System.Collections.Generic.List[byte[]]'
foreach ($s in $sizes) {
  $b = if ($s -eq 256) { $master } else { Resize-Bitmap $master $s }
  $pngs.Add([byte[]](Save-PngBytes $b))
  if ($s -ne 256) { $b.Dispose() }
}
$master.Dispose()

$fs = [System.IO.File]::Create($outIco)
$bw = [System.IO.BinaryWriter]::new($fs)
$bw.Write([uint16]0)
$bw.Write([uint16]1)
$bw.Write([uint16]$sizes.Length)
$offset = 6 + 16 * $sizes.Length
for ($i = 0; $i -lt $sizes.Length; $i++) {
  $s = $sizes[$i]
  if ($s -ge 256) { $w = [byte]0 } else { $w = [byte]$s }
  $bw.Write($w)
  $bw.Write($w)
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

Write-Output ("icon-planet.ico: {0} bytes" -f (Get-Item $outIco).Length)
Write-Output ("icon-planet.png: {0} bytes" -f (Get-Item $outPng).Length)
