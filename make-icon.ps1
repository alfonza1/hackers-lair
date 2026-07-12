# Generates the Hacker's Lair "command core" icon.
# The connected nodes represent several local processes routed through one
# controller; the output chevron represents starting a selected target.
# Every taskbar/search size is rendered independently from oversampled vectors.
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

function New-CommandCorePng {
    param([int]$Size)

    # Extra source pixels keep the 16/24/32px taskbar variants crisp.
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

    $pad = [single]($dimension * 0.045)
    $tileSize = [single]($dimension - 2 * $pad)
    $radius = [single]($dimension * 0.205)
    $tilePath = New-RoundedRectanglePath $pad $pad $tileSize $tileSize $radius
    $tileBounds = [System.Drawing.RectangleF]::new($pad, $pad, $tileSize, $tileSize)

    # Near-black console surface: restrained, high-contrast, and consistent
    # with the green/cyan Lair Console rather than the old purple gradient.
    $backgroundTop = [System.Drawing.ColorTranslator]::FromHtml('#0A1915')
    $backgroundBottom = [System.Drawing.ColorTranslator]::FromHtml('#020806')
    $backgroundBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
        $tileBounds,
        $backgroundTop,
        $backgroundBottom,
        [single]135
    )
    $graphics.FillPath($backgroundBrush, $tilePath)

    $borderWidth = [single]([Math]::Max($oversample * 1.05, $dimension * 0.025))
    $borderColor = [System.Drawing.ColorTranslator]::FromHtml('#39F59A')
    $borderPen = [System.Drawing.Pen]::new($borderColor, $borderWidth)
    $borderPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $graphics.DrawPath($borderPen, $tilePath)

    # Subtle inset frame adds definition at large sizes without cluttering the
    # 16px glyph. It intentionally stays dimmer than the controller mark.
    if ($Size -ge 32) {
        $inset = [single]($dimension * 0.075)
        $insetPath = New-RoundedRectanglePath `
            $inset $inset `
            ([single]($dimension - 2 * $inset)) `
            ([single]($dimension - 2 * $inset)) `
            ([single]($dimension * 0.17))
        $insetPen = [System.Drawing.Pen]::new(
            [System.Drawing.Color]::FromArgb(85, 43, 124, 91),
            [single]([Math]::Max($oversample * 0.6, $dimension * 0.006))
        )
        $graphics.DrawPath($insetPen, $insetPath)
        $insetPen.Dispose()
        $insetPath.Dispose()
    }

    $cyan = [System.Drawing.ColorTranslator]::FromHtml('#58D7E8')
    $green = [System.Drawing.ColorTranslator]::FromHtml('#5CFFAE')
    $connector = [System.Drawing.ColorTranslator]::FromHtml('#83F4C0')
    $darkCore = [System.Drawing.ColorTranslator]::FromHtml('#062016')

    $lineWidth = [single]([Math]::Max($oversample * 1.15, $dimension * 0.035))
    $connectorPen = [System.Drawing.Pen]::new($connector, $lineWidth)
    $connectorPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $connectorPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $connectorPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    $leftX = [single]($dimension * 0.255)
    $joinX = [single]($dimension * 0.435)
    $hubX = [single]($dimension * 0.535)
    $topY = [single]($dimension * 0.315)
    $midY = [single]($dimension * 0.500)
    $bottomY = [single]($dimension * 0.685)

    # Three managed targets converge on one controller.
    foreach ($nodeY in @($topY, $midY, $bottomY)) {
        $graphics.DrawLine($connectorPen, $leftX, $nodeY, $joinX, $nodeY)
    }
    $graphics.DrawLine($connectorPen, $joinX, $topY, $joinX, $bottomY)
    $graphics.DrawLine($connectorPen, $joinX, $midY, $hubX, $midY)

    $nodeSize = [single]([Math]::Max($oversample * 1.8, $dimension * 0.075))
    $nodeRadius = [single]($nodeSize * 0.28)
    $nodeBrush = [System.Drawing.SolidBrush]::new($cyan)
    foreach ($nodeY in @($topY, $midY, $bottomY)) {
        $nodePath = New-RoundedRectanglePath `
            ([single]($leftX - $nodeSize / 2)) `
            ([single]($nodeY - $nodeSize / 2)) `
            $nodeSize $nodeSize $nodeRadius
        $graphics.FillPath($nodeBrush, $nodePath)
        $nodePath.Dispose()
    }

    # Central command core.
    $hubSize = [single]([Math]::Max($oversample * 3.0, $dimension * 0.145))
    $hubPath = New-RoundedRectanglePath `
        ([single]($hubX - $hubSize / 2)) `
        ([single]($midY - $hubSize / 2)) `
        $hubSize $hubSize ([single]($hubSize * 0.28))
    $hubBrush = [System.Drawing.SolidBrush]::new($green)
    $graphics.FillPath($hubBrush, $hubPath)
    if ($Size -ge 24) {
        $coreSize = [single]($hubSize * 0.32)
        $coreBrush = [System.Drawing.SolidBrush]::new($darkCore)
        $graphics.FillEllipse(
            $coreBrush,
            [single]($hubX - $coreSize / 2),
            [single]($midY - $coreSize / 2),
            $coreSize,
            $coreSize
        )
        $coreBrush.Dispose()
    }

    # A bold launch chevron stays recognizable in the smallest taskbar entry.
    $arrowStartX = [single]($dimension * 0.615)
    $arrowShoulderX = [single]($dimension * 0.695)
    $arrowTipX = [single]($dimension * 0.785)
    $arrowHalfHeight = [single]($dimension * 0.115)
    $arrowPen = [System.Drawing.Pen]::new($green, [single]($lineWidth * 1.18))
    $arrowPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $arrowPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $arrowPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $graphics.DrawLine($arrowPen, $arrowStartX, $midY, $arrowTipX, $midY)
    $graphics.DrawLine($arrowPen, $arrowShoulderX, $midY - $arrowHalfHeight, $arrowTipX, $midY)
    $graphics.DrawLine($arrowPen, $arrowTipX, $midY, $arrowShoulderX, $midY + $arrowHalfHeight)

    $arrowPen.Dispose()
    $hubBrush.Dispose()
    $hubPath.Dispose()
    $nodeBrush.Dispose()
    $connectorPen.Dispose()
    $borderPen.Dispose()
    $backgroundBrush.Dispose()
    $tilePath.Dispose()
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
    $pngs.Add([byte[]](New-CommandCorePng $size))
}

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
