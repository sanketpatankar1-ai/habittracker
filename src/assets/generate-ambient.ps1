Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName PresentationCore

$width = 480
$height = 270
$frameCount = 60
$frameDelay = 5
$outputPath = Join-Path $PSScriptRoot 'login-ambient.gif'
$encoder = [System.Windows.Media.Imaging.GifBitmapEncoder]::new()

for ($frame = 0; $frame -lt $frameCount; $frame++) {
  $bitmap = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::FromArgb(255, 5, 7, 13))
  $phase = 2 * [Math]::PI * $frame / $frameCount
  $lights = @(
    @{ X = 0.25 + 0.22 * [Math]::Sin($phase); Y = 0.35 + 0.18 * [Math]::Cos($phase); S = 360; C = [System.Drawing.Color]::FromArgb(78, 85, 63, 232) },
    @{ X = 0.76 + 0.17 * [Math]::Cos($phase + 1.1); Y = 0.30 + 0.22 * [Math]::Sin($phase + 1.1); S = 330; C = [System.Drawing.Color]::FromArgb(75, 28, 135, 209) },
    @{ X = 0.56 + 0.22 * [Math]::Sin($phase + 2.4); Y = 0.78 + 0.12 * [Math]::Cos($phase + 2.4); S = 390; C = [System.Drawing.Color]::FromArgb(60, 33, 180, 163) },
    @{ X = 0.88 + 0.07 * [Math]::Sin($phase + 4.0); Y = 0.72 + 0.10 * [Math]::Cos($phase + 4.0); S = 250; C = [System.Drawing.Color]::FromArgb(52, 165, 67, 202) }
  )
  foreach ($light in $lights) {
    $size = [single]($light.S * $width / 720)
    $x = [single]($light.X * $width - $size / 2)
    $y = [single]($light.Y * $height - $size / 2)
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $path.AddEllipse([System.Drawing.RectangleF]::new($x, $y, $size, $size))
    $brush = [System.Drawing.Drawing2D.PathGradientBrush]::new($path)
    $brush.CenterPoint = [System.Drawing.PointF]::new($x + $size * 0.5, $y + $size * 0.5)
    $brush.CenterColor = $light.C
    $brush.SurroundColors = [System.Drawing.Color[]]@([System.Drawing.Color]::FromArgb(0, 5, 7, 13))
    $graphics.FillEllipse($brush, $x, $y, $size, $size)
    $brush.Dispose()
    $path.Dispose()
  }
  $imageStream = [System.IO.MemoryStream]::new()
  $bitmap.Save($imageStream, [System.Drawing.Imaging.ImageFormat]::Png)
  $imageStream.Position = 0
  $source = [System.Windows.Media.Imaging.BitmapImage]::new()
  $source.BeginInit()
  $source.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
  $source.StreamSource = $imageStream
  $source.EndInit()
  $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($source))
  $imageStream.Dispose()
  $source = $null
  $graphics.Dispose()
  $bitmap.Dispose()
}

$fileStream = [System.IO.File]::Create($outputPath)
$encoder.Save($fileStream)
$fileStream.Dispose()

# Add a frame delay before each image and the standard infinite-loop extension.
$bytes = [System.IO.File]::ReadAllBytes($outputPath)
$packed = $bytes[10]
$insertAt = 13
if (($packed -band 0x80) -ne 0) { $insertAt += 3 * [Math]::Pow(2, ($packed -band 0x07) + 1) }
$loopExtension = [byte[]](0x21, 0xFF, 0x0B, 0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30, 0x03, 0x01, 0x00, 0x00, 0x00)
$stream = [System.IO.MemoryStream]::new()
$stream.Write($bytes, 0, $insertAt)
$stream.Write($loopExtension, 0, $loopExtension.Length)
function Copy-GifBlocks($inputBytes, $start, $outputStream) {
  $position = $start
  while ($position -lt $inputBytes.Length) {
    $blockStart = $position
    $marker = $inputBytes[$position]
    if ($marker -eq 0x3B) { $outputStream.Write($inputBytes, $position, 1); break }
    if ($marker -eq 0x21) {
      $label = $inputBytes[$position + 1]
      $position += 2
      if ($label -eq 0xF9) { $position += 6 }
      else {
        $position++
        while ($position -lt $inputBytes.Length) { $length = $inputBytes[$position]; $position += 1 + $length; if ($length -eq 0) { break } }
      }
      if ($label -eq 0xF9 -and $inputBytes[$blockStart + 2] -eq 4) {
        $control = [byte[]]::new($position - $blockStart)
        [Array]::Copy($inputBytes, $blockStart, $control, 0, $control.Length)
        $control[3] = 0x04
        $control[4] = $frameDelay
        $control[5] = 0x00
        $outputStream.Write($control, 0, $control.Length)
      } else {
        $outputStream.Write($inputBytes, $blockStart, $position - $blockStart)
      }
      continue
    }
    if ($marker -ne 0x2C) { throw "Unexpected GIF block marker $marker at $position" }
    $position += 10
    $imagePacked = $inputBytes[$blockStart + 9]
    if (($imagePacked -band 0x80) -ne 0) { $position += 3 * [Math]::Pow(2, ($imagePacked -band 0x07) + 1) }
    $position++
    while ($position -lt $inputBytes.Length) { $length = $inputBytes[$position]; $position += 1 + $length; if ($length -eq 0) { break } }
    $outputStream.Write($inputBytes, $blockStart, $position - $blockStart)
  }
}
Copy-GifBlocks $bytes $insertAt $stream
[System.IO.File]::WriteAllBytes($outputPath, $stream.ToArray())
$stream.Dispose()
Write-Output "Created $outputPath"
