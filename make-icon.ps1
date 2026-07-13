# Generates the Hacker's Lair native terminal-core icon.
# The prompt is deliberately simple so it remains legible in Windows taskbar,
# Start menu, shortcut, and desktop sizes.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function New-RoundedRectanglePath {
    param(
        [single]$X,
        [single]$Y,
        [single]$Width,
        [single]$Height,
        [single]$Radius
    )

    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $diameter = [single]([Math]::Min($Radius * 2, [Math]::Min($Width, $Height)))
    $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
    $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
    $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-TerminalCorePng {
    param([int]$Size)

    $oversample = if ($Size -le 32) { 8 } else { 4 }
    $dimension = $Size * $oversample
    $bitmap = [System.Drawing.Bitmap]::new(
        $dimension,
        $dimension,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $cyan = [System.Drawing.ColorTranslator]::FromHtml('#55D6FF')
    $green = [System.Drawing.ColorTranslator]::FromHtml('#64F0B2')
    $slate = [System.Drawing.ColorTranslator]::FromHtml('#233A51')
    $plateTop = [System.Drawing.ColorTranslator]::FromHtml('#101B2A')
    $plateBottom = [System.Drawing.ColorTranslator]::FromHtml('#03070D')
    $screenTop = [System.Drawing.ColorTranslator]::FromHtml('#07131B')
    $screenBottom = [System.Drawing.ColorTranslator]::FromHtml('#020609')

    # Angular hardware tile avoids the generic rounded mobile-app silhouette.
    $edge = [single]($dimension * 0.055)
    $cut = [single]($dimension * 0.165)
    $farEdge = [single]($dimension - $edge)
    $farCut = [single]($dimension - $cut)
    $platePath = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $platePath.AddPolygon([System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new($cut, $edge),
        [System.Drawing.PointF]::new($farCut, $edge),
        [System.Drawing.PointF]::new($farEdge, $cut),
        [System.Drawing.PointF]::new($farEdge, $farCut),
        [System.Drawing.PointF]::new($farCut, $farEdge),
        [System.Drawing.PointF]::new($cut, $farEdge),
        [System.Drawing.PointF]::new($edge, $farCut),
        [System.Drawing.PointF]::new($edge, $cut)
    ))
    $plateBounds = [System.Drawing.RectangleF]::new($edge, $edge, [single]($dimension - 2 * $edge), [single]($dimension - 2 * $edge))
    $plateBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
        $plateBounds,
        $plateTop,
        $plateBottom,
        [single]135
    )
    $graphics.FillPath($plateBrush, $platePath)
    $platePen = [System.Drawing.Pen]::new($cyan, [single]([Math]::Max($oversample, $dimension * 0.026)))
    $platePen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Miter
    $graphics.DrawPath($platePen, $platePath)

    # Inset terminal screen creates depth but leaves one unmistakable shape.
    $screenX = [single]($dimension * 0.18)
    $screenY = [single]($dimension * 0.245)
    $screenWidth = [single]($dimension * 0.64)
    $screenHeight = [single]($dimension * 0.51)
    $screenPath = New-RoundedRectanglePath `
        $screenX $screenY $screenWidth $screenHeight `
        ([single]($dimension * 0.075))
    $screenBounds = [System.Drawing.RectangleF]::new($screenX, $screenY, $screenWidth, $screenHeight)
    $screenBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
        $screenBounds,
        $screenTop,
        $screenBottom,
        [single]90
    )
    $graphics.FillPath($screenBrush, $screenPath)
    $screenPen = [System.Drawing.Pen]::new($green, [single]([Math]::Max($oversample * 0.9, $dimension * 0.021)))
    $graphics.DrawPath($screenPen, $screenPath)

    # Desktop sizes receive a restrained title rail; tiny frames keep only the
    # screen and prompt so Windows never has to downsample decorative noise.
    if ($Size -ge 32) {
        $railY = [single]($dimension * 0.345)
        $railPen = [System.Drawing.Pen]::new(
            [System.Drawing.Color]::FromArgb(120, 85, 214, 255),
            [single]([Math]::Max($oversample * 0.5, $dimension * 0.008))
        )
        $graphics.DrawLine(
            $railPen,
            [single]($dimension * 0.22), $railY,
            [single]($dimension * 0.78), $railY
        )
        $dotBrush = [System.Drawing.SolidBrush]::new($green)
        $dot = [single]($dimension * 0.025)
        $graphics.FillEllipse($dotBrush, [single]($dimension * 0.235), [single]($dimension * 0.285), $dot, $dot)
        $dotBrush.Dispose()
        $railPen.Dispose()
    }

    # Bold prompt geometry: no font dependency and no ambiguous tiny text.
    $promptWidth = [single]([Math]::Max($oversample * 1.35, $dimension * 0.058))
    $promptPen = [System.Drawing.Pen]::new($cyan, $promptWidth)
    $promptPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Square
    $promptPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Square
    $promptPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Miter
    $graphics.DrawLines($promptPen, [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new([single]($dimension * 0.31), [single]($dimension * 0.43)),
        [System.Drawing.PointF]::new([single]($dimension * 0.45), [single]($dimension * 0.51)),
        [System.Drawing.PointF]::new([single]($dimension * 0.31), [single]($dimension * 0.59))
    ))
    $cursorPen = [System.Drawing.Pen]::new($green, $promptWidth)
    $cursorPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Square
    $cursorPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Square
    $graphics.DrawLine(
        $cursorPen,
        [single]($dimension * 0.51), [single]($dimension * 0.60),
        [single]($dimension * 0.69), [single]($dimension * 0.60)
    )

    # A tiny side channel hints at process routing without competing with >_.
    if ($Size -ge 48) {
        $channelPen = [System.Drawing.Pen]::new(
            [System.Drawing.Color]::FromArgb(125, 35, 58, 81),
            [single]([Math]::Max($oversample * 0.6, $dimension * 0.008))
        )
        $graphics.DrawLine($channelPen, [single]($dimension * 0.10), [single]($dimension * 0.50), [single]($dimension * 0.16), [single]($dimension * 0.50))
        $graphics.DrawLine($channelPen, [single]($dimension * 0.84), [single]($dimension * 0.50), [single]($dimension * 0.90), [single]($dimension * 0.50))
        $channelPen.Dispose()
    }

    $cursorPen.Dispose()
    $promptPen.Dispose()
    $screenPen.Dispose()
    $screenBrush.Dispose()
    $screenPath.Dispose()
    $platePen.Dispose()
    $plateBrush.Dispose()
    $platePath.Dispose()
    $graphics.Dispose()

    $target = [System.Drawing.Bitmap]::new(
        $Size,
        $Size,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    $downsample = [System.Drawing.Graphics]::FromImage($target)
    $downsample.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $downsample.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $downsample.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $downsample.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $downsample.DrawImage($bitmap, 0, 0, $Size, $Size)
    $downsample.Dispose()
    $bitmap.Dispose()

    $stream = [System.IO.MemoryStream]::new()
    $target.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $target.Dispose()
    $bytes = $stream.ToArray()
    $stream.Dispose()
    return ,$bytes
}

$iconPath = Join-Path $PSScriptRoot 'icon.ico'
$sizes = 256, 128, 64, 48, 32, 24, 16
$pngs = [System.Collections.Generic.List[byte[]]]::new()
foreach ($size in $sizes) {
    $pngs.Add([byte[]](New-TerminalCorePng $size))
}

$readmeLogoPath = Join-Path $PSScriptRoot 'docs\command-line-mark.png'
[System.IO.File]::WriteAllBytes($readmeLogoPath, $pngs[0])

# ICO container with PNG-compressed entries (supported by Windows Vista+).
$output = [System.IO.MemoryStream]::new()
$writer = [System.IO.BinaryWriter]::new($output)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count

for ($index = 0; $index -lt $sizes.Count; $index++) {
    $size = $sizes[$index]
    $data = $pngs[$index]
    $dimensionByte = [Byte]$(if ($size -ge 256) { 0 } else { $size })
    $writer.Write($dimensionByte)
    $writer.Write($dimensionByte)
    $writer.Write([Byte]0)
    $writer.Write([Byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$data.Length)
    $writer.Write([UInt32]$offset)
    $offset += $data.Length
}
foreach ($data in $pngs) { $writer.Write($data) }
$writer.Flush()
[System.IO.File]::WriteAllBytes($iconPath, $output.ToArray())
$writer.Dispose()
$output.Dispose()

Write-Output "Wrote $iconPath ($([Math]::Round((Get-Item $iconPath).Length / 1kb, 1)) KB)"
Write-Output "Wrote $readmeLogoPath ($([Math]::Round((Get-Item $readmeLogoPath).Length / 1kb, 1)) KB)"
