Add-Type -AssemblyName System.Drawing

$outIco = "D:\DS_harness\icon.ico"
$outPng = "D:\DS_harness\icon.png"

function Lerp-Color([System.Drawing.Color]$c1, [System.Drawing.Color]$c2, [float]$t) {
  $t = [Math]::Max(0.0, [Math]::Min(1.0, $t))
  return [System.Drawing.Color]::FromArgb(255,
    [int]($c1.R + ($c2.R - $c1.R) * $t),
    [int]($c1.G + ($c2.G - $c1.G) * $t),
    [int]($c1.B + ($c2.B - $c1.B) * $t))
}

$pal = @(
  @(0.00, [System.Drawing.Color]::FromArgb(255, 255, 246, 224)),
  @(0.25, [System.Drawing.Color]::FromArgb(255, 255, 217, 138)),
  @(0.50, [System.Drawing.Color]::FromArgb(255, 245, 161, 60)),
  @(0.75, [System.Drawing.Color]::FromArgb(255, 192, 95, 30)),
  @(1.00, [System.Drawing.Color]::FromArgb(255, 100, 40, 13))
)

function Disk-Color([float]$t, [float]$doppler, [bool]$front) {
  $c = $pal[0][1]
  for ($i = 0; $i -lt $pal.Count - 1; $i++) {
    if ($t -le $pal[$i + 1][0]) {
      $span = $pal[$i + 1][0] - $pal[$i][0]
      $tt = 0.0
      if ($span -gt 0) { $tt = ($t - $pal[$i][0]) / $span }
      $c = Lerp-Color $pal[$i][1] $pal[$i + 1][1] $tt
      break
    }
  }
  if ($front) { $c = Lerp-Color $c ([System.Drawing.Color]::White) 0.12 }
  if ($doppler -gt 1.0) {
    $c = Lerp-Color $c ([System.Drawing.Color]::FromArgb(255, 255, 252, 245)) ([Math]::Min(1.0, ($doppler - 1.0) / 0.6))
  } else {
    $c = Lerp-Color $c ([System.Drawing.Color]::FromArgb(255, 0, 0, 4)) ([Math]::Min(1.0, (1.0 - $doppler) / 0.7))
  }
  return $c
}

function Disk-SegPoly([float]$cx, [float]$cy, [float]$k, [float]$R1, [float]$R2, [float]$t0, [float]$t1) {
  $pts = New-Object 'System.Collections.Generic.List[System.Drawing.PointF]'
  $sub = 6
  for ($i = 0; $i -le $sub; $i++) {
    $t = $t0 + ($t1 - $t0) * $i / $sub
    $pts.Add([System.Drawing.PointF]::new([float]($cx + $R1 * [Math]::Cos($t)), [float]($cy + $k * $R1 * [Math]::Sin($t))))
  }
  for ($i = $sub; $i -ge 0; $i--) {
    $t = $t0 + ($t1 - $t0) * $i / $sub
    $pts.Add([System.Drawing.PointF]::new([float]($cx + $R2 * [Math]::Cos($t)), [float]($cy + $k * $R2 * [Math]::Sin($t))))
  }
  return $pts.ToArray()
}

function Draw-DiskHalf($g, [float]$cx, [float]$cy, [float]$k, [float]$R, [bool]$front, [int]$segments, [float]$phase) {
  $bands = @(@(1.00, 0.70), @(0.70, 0.46), @(0.46, 0.34))
  for ($i = 0; $i -lt $segments; $i++) {
    $t0 = 2 * [Math]::PI * $i / $segments
    $t1 = 2 * [Math]::PI * ($i + 1) / $segments
    $tm = ($t0 + $t1) / 2
    $isFront = [Math]::Sin($tm) -ge 0
    if ($isFront -ne $front) { continue }
    $doppler = 1.0 + 0.55 * [Math]::Cos($tm - [Math]::PI - $phase)
    foreach ($b in $bands) {
      $R1 = $R * $b[0]; $R2 = $R * $b[1]
      $rc = ($R1 + $R2) / 2
      $tc = ($rc / $R - 0.34) / (1.0 - 0.34)
      $col = Disk-Color $tc $doppler $front
      $poly = Disk-SegPoly $cx $cy $k $R1 $R2 $t0 $t1
      $br = [System.Drawing.SolidBrush]::new($col)
      $g.FillPolygon($br, $poly)
      $br.Dispose()
    }
  }
}

function New-Glow([float]$cx, [float]$cy, [float]$r, [System.Drawing.Color]$core, [System.Drawing.Color]$edge) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddEllipse($cx - $r, $cy - $r, 2 * $r, 2 * $r)
  $pgb = [System.Drawing.Drawing2D.PathGradientBrush]::new($path)
  $pgb.CenterColor = $core
  $pgb.SurroundColors = [System.Drawing.Color[]]@($edge)
  return $pgb
}

function New-MasterBitmap {
  $size = 256
  $bmp = [System.Drawing.Bitmap]::new($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $cx = 128.0; $cy = 128.0
  $k = 0.46
  $R = 96.0
  $rs = 0.36 * $R

  $rect = [System.Drawing.Rectangle]::new(0, 0, $size, $size)
  $c1 = [System.Drawing.Color]::FromArgb(255, 2, 4, 8)
  $c2 = [System.Drawing.Color]::FromArgb(255, 30, 20, 52)
  $bg = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rect, $c1, $c2, 135)
  $g.FillRectangle($bg, $rect)
  $bg.Dispose()

  $rand = [System.Random]::new(2027)
  for ($i = 0; $i -lt 130; $i++) {
    $x = $rand.NextDouble() * 256
    $y = $rand.NextDouble() * 256
    $a = [int](90 + $rand.NextDouble() * 150)
    $c = [System.Drawing.Color]::FromArgb($a, 226, 240, 248)
    $b = [System.Drawing.SolidBrush]::new($c)
    $r = 0.5 + $rand.NextDouble() * 1.4
    $g.FillEllipse($b, [float]$x, [float]$y, [float]$r, [float]$r)
    $b.Dispose()
  }

  $h1 = New-Glow $cx $cy 150 ([System.Drawing.Color]::FromArgb(70, 190, 232, 255)) ([System.Drawing.Color]::FromArgb(0, 190, 232, 255))
  $g.FillEllipse($h1, $cx - 150, $cy - 150, 300, 300)
  $h1.Dispose()
  $h2 = New-Glow $cx $cy 105 ([System.Drawing.Color]::FromArgb(55, 123, 97, 255)) ([System.Drawing.Color]::FromArgb(0, 123, 97, 255))
  $g.FillEllipse($h2, $cx - 105, $cy - 105, 210, 210)
  $h2.Dispose()

  Draw-DiskHalf $g $cx $cy $k $R $false 48 0.0

  $sh = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 1, 1, 2))
  $g.FillEllipse($sh, [float]($cx - $rs), [float]($cy - $k * $rs), [float](2 * $rs), [float](2 * $k * $rs))
  $sh.Dispose()
  $sh2 = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 6, 8, 14))
  $g.FillEllipse($sh2, [float]($cx - $rs * 0.92), [float]($cy - $k * $rs * 0.92), [float](2 * $rs * 0.92), [float](2 * $k * $rs * 0.92))
  $sh2.Dispose()
  $sh3 = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 10, 13, 22))
  $g.FillEllipse($sh3, [float]($cx - $rs * 0.72), [float]($cy - $k * $rs * 0.72), [float](2 * $rs * 0.72), [float](2 * $k * $rs * 0.72))
  $sh3.Dispose()

  $ph = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(220, 235, 250, 255), 2.4)
  $g.DrawEllipse($ph, [float]($cx - $rs * 1.14), [float]($cy - $k * $rs * 1.14), [float](2 * $rs * 1.14), [float](2 * $k * $rs * 1.14))
  $ph.Dispose()
  $ph2 = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(70, 190, 232, 255), 5.5)
  $g.DrawEllipse($ph2, [float]($cx - $rs * 1.14), [float]($cy - $k * $rs * 1.14), [float](2 * $rs * 1.14), [float](2 * $k * $rs * 1.14))
  $ph2.Dispose()

  $arcPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(210, 245, 252, 255), 2.0)
  $g.DrawArc($arcPen, [float]($cx - $rs * 0.86), [float]($cy - $k * $rs * 0.86), [float](2 * $rs * 0.86), [float](2 * $k * $rs * 0.86), 198, 144)
  $arcPen.Dispose()

  Draw-DiskHalf $g $cx $cy $k $R $true 48 0.0

  $jetCol = [System.Drawing.Color]::FromArgb(160, 140, 110, 255)
  foreach ($dir in @(-1, 1)) {
    for ($s = 0; $s -lt 5; $s++) {
      $t = ($s + 1) / 5
      $a = [int](46 * (1 - $t))
      $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb($a, $jetCol.R, $jetCol.G, $jetCol.B), [float](3.4 * (1 - $t) + 0.5))
      $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
      $y0 = $cy - $k * $rs + $dir * 8
      $y1 = $y0 + $dir * 44 * $t
      $g.DrawLine($pen, [float]$cx, [float]$y0, [float]($cx + 6 * $t), [float]$y1)
      $pen.Dispose()
    }
  }

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

Write-Output ("icon.ico: {0} bytes" -f (Get-Item $outIco).Length)
Write-Output ("icon.png: {0} bytes" -f (Get-Item $outPng).Length)
