# Texterkennung mit der in Windows 10/11 eingebauten OCR (Windows.Media.Ocr). Läuft offline.
# Aufruf: powershell.exe -NoProfile -ExecutionPolicy Bypass -File ocr.ps1 <Bilddatei>
# Ausgabe wie ocr.js: JSON-Liste mit y (oben 0), x (links 0) und Zeilenhöhe h in Tausendstel der Bildgröße und dem Text.
param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1

function Await($operation, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
  $null = $task.Wait(-1)
  return $task.Result
}

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync((Resolve-Path $Path).Path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])

# Zu große Bilder verkleinern, die Windows-OCR nimmt nur eine begrenzte Kantenlänge an.
$max = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
$width = $decoder.PixelWidth
$height = $decoder.PixelHeight
if ($width -gt $max -or $height -gt $max) {
  $scale = [Math]::Min($max / $width, $max / $height)
  $transform = New-Object Windows.Graphics.Imaging.BitmapTransform
  $transform.ScaledWidth = [uint32][Math]::Floor($width * $scale)
  $transform.ScaledHeight = [uint32][Math]::Floor($height * $scale)
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync($decoder.BitmapPixelFormat, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied, $transform,
      [Windows.Graphics.Imaging.ExifOrientationMode]::IgnoreExifOrientation, [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])
} else {
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
}

# Deutsch bevorzugen, sonst die Sprachen des Benutzerkontos.
$engine = $null
$german = New-Object Windows.Globalization.Language 'de-DE'
if ([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($german)) {
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($german)
}
if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if (-not $engine) { throw 'Keine Sprache für die Texterkennung installiert.' }

$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$w = [double]$bitmap.PixelWidth
$h = [double]$bitmap.PixelHeight
$lines = @()
foreach ($line in $result.Lines) {
  $left = [double]::MaxValue; $top = [double]::MaxValue; $right = 0.0; $bottom = 0.0
  foreach ($word in $line.Words) {
    $r = $word.BoundingRect
    $left = [Math]::Min($left, $r.X); $top = [Math]::Min($top, $r.Y)
    $right = [Math]::Max($right, $r.X + $r.Width); $bottom = [Math]::Max($bottom, $r.Y + $r.Height)
  }
  $lines += [pscustomobject]@{
    y    = [int][Math]::Round($top / $h * 1000)
    x    = [int][Math]::Round($left / $w * 1000)
    h    = [int][Math]::Round(($bottom - $top) / $h * 1000)
    text = $line.Text
  }
}
$stream.Dispose()
if ($lines.Count -eq 0) { '[]' } else { ConvertTo-Json -InputObject @($lines) -Compress }
