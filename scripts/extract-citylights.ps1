Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName System.Drawing

$src = "D:\DS_harness\renderer\bg.jpg"
$out = "D:\DS_harness\renderer\citylights.json"
$sampleW = 768

$fs = [System.IO.File]::OpenRead($src)
$decoder = [System.Windows.Media.Imaging.BitmapDecoder]::Create($fs, [System.Windows.Media.Imaging.BitmapCreateOptions]::PreservePixelFormat, [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
$frame = $decoder.Frames[0]
$W = $frame.PixelWidth
$H = $frame.PixelHeight
$scale = [double]$sampleW / [double]$W
$sw = [int][Math]::Round($W * $scale)
$sh = [int][Math]::Round($H * $scale)

$conv = [System.Windows.Media.Imaging.FormatConvertedBitmap]::new($frame, [System.Windows.Media.PixelFormats]::Bgr32, $null, 0)
$conv = [System.Windows.Media.Imaging.TransformedBitmap]::new($conv, [System.Windows.Media.ScaleTransform]::new($scale, $scale))
$stride = $sw * 4
$buf = New-Object byte[] ($stride * $sh)
$conv.CopyPixels($buf, $stride, 0)
$fs.Close()

$cols = 96
$rows = 26
$y0 = [int]($sh * 0.68)

$lights = New-Object 'System.Collections.Generic.List[object]'

for ($cy = 0; $cy -lt $rows; $cy++) {
  for ($cx = 0; $cx -lt $cols; $cx++) {
    $x = [int]($cx * $sw / $cols)
    $y = $y0 + [int]($cy * ($sh - $y0) / $rows)
    $sum = 0.0; $warm = 0; $n = 0
    for ($dy = -2; $dy -le 2; $dy += 2) {
      for ($dx = -2; $dx -le 2; $dx += 2) {
        $px = $x + $dx; $py = $y + $dy
        if ($px -lt 0 -or $py -lt 0 -or $px -ge $sw -or $py -ge $sh) { continue }
        $i = ($py * $stride) + ($px * 4)
        $b = $buf[$i]; $g = $buf[$i + 1]; $r = $buf[$i + 2]
        $sum += (0.3 * $r + 0.59 * $g + 0.11 * $b)
        if ($r -gt $b) { $warm++ }
        $n++
      }
    }
    if ($n -eq 0) { continue }
    $avg = $sum / $n
    $warmRatio = $warm / $n
    $isLight = ($avg -gt 36 -and $warmRatio -gt 0.5) -or ($avg -gt 80)
    if ($isLight) {
      $size = 0.6 + [Math]::Min(1.8, ($avg - 36) / 55.0)
      $lights.Add(@{ x = [Math]::Round(($x + 2) / $sw, 4); y = [Math]::Round(($y + 2) / $sh, 4); s = [Math]::Round($size, 2); b = [Math]::Round($avg, 0) })
    }
  }
}

$sorted = $lights | Sort-Object -Property b -Descending | Select-Object -First 160
$arr = @($sorted | ForEach-Object { @{ x = $_.x; y = $_.y; s = $_.s } })
($arr | ConvertTo-Json -Compress -Depth 3) | Set-Content -Path $out -Encoding UTF8

Write-Output ("image {0}x{1} -> sampled {2}x{3}; lights: {4} -> {5}" -f $W, $H, $sw, $sh, $lights.Count, $out)
