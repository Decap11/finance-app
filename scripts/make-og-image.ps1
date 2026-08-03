<#
.SYNOPSIS
  Builds a 1200x630 Open Graph card from a tall portrait promo image.

.DESCRIPTION
  WhatsApp, Facebook, LinkedIn and X all render a large link card at roughly
  1.91:1. Feeding them a portrait image gets it centre-cropped to a thin strip.
  This script takes the phone artwork out of a portrait slide, drops it on a
  landscape canvas, and re-typesets the headline beside it at a size that still
  reads in a chat bubble.

.EXAMPLE
  pwsh -File scripts/make-og-image.ps1 `
       -Source public/source/instant-loans.png `
       -Headline "Empower members to apply, manage, and track loans effortlessly" `
       -Eyebrow "Instant Loans"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $Source,

    [string] $Destination = "public/og-preview.jpg",

    [string] $Eyebrow = "Instant Loans",

    [string] $Headline = "Empower members to apply, manage, and track loans effortlessly",

    # Vertical slice of the source to lift the device artwork from, as
    # fractions of total height. Defaults skip the headline baked into the top.
    [double] $CropTop = 0.26,
    [double] $CropBottom = 1.0,

    # Override the sampled background, e.g. "#141F8C".
    [string] $BackgroundColor = "",

    [int] $Quality = 88
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent $PSScriptRoot
function Resolve-RepoPath([string] $p) {
    if ([System.IO.Path]::IsPathRooted($p)) { return $p }
    return Join-Path $repoRoot $p
}

$sourcePath = Resolve-RepoPath $Source
$destPath = Resolve-RepoPath $Destination

if (-not (Test-Path $sourcePath)) {
    throw "Source image not found: $sourcePath"
}

$CANVAS_W = 1200
$CANVAS_H = 630

$src = [System.Drawing.Image]::FromFile($sourcePath)
try {
    # ---- background colour -------------------------------------------------
    if ($BackgroundColor) {
        $bg = [System.Drawing.ColorTranslator]::FromHtml($BackgroundColor)
    }
    else {
        # Sample a few points along the top edge and take the darkest, which
        # reliably lands on the slide background rather than a logo or badge.
        $bmpSrc = New-Object System.Drawing.Bitmap($src)
        try {
            $samples = @(
                $bmpSrc.GetPixel(4, 4),
                $bmpSrc.GetPixel([int]($bmpSrc.Width / 2), 4),
                $bmpSrc.GetPixel($bmpSrc.Width - 5, 4)
            )
            $bg = $samples | Sort-Object { $_.R + $_.G + $_.B } | Select-Object -First 1
        }
        finally { $bmpSrc.Dispose() }
    }

    # Darker partner colour for the gradient. Kept deliberately close to the
    # base so that source artwork carrying its own flat background can sit on
    # the canvas without an obvious seam.
    $bgDark = [System.Drawing.Color]::FromArgb(
        255,
        [Math]::Max(0, [int]($bg.R * 0.74)),
        [Math]::Max(0, [int]($bg.G * 0.74)),
        [Math]::Max(0, [int]($bg.B * 0.80))
    )

    $canvas = New-Object System.Drawing.Bitmap($CANVAS_W, $CANVAS_H)
    $g = [System.Drawing.Graphics]::FromImage($canvas)
    try {
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

        # ---- background ----------------------------------------------------
        $rect = New-Object System.Drawing.Rectangle(0, 0, $CANVAS_W, $CANVAS_H)
        $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
            $rect, $bgDark, $bg, 35.0)
        $g.FillRectangle($grad, $rect)
        $grad.Dispose()

        # Soft radial glow behind the device so it separates from the flat fill.
        $glowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
        $glowPath.AddEllipse(700, 40, 620, 620)
        $glow = New-Object System.Drawing.Drawing2D.PathGradientBrush($glowPath)
        $glow.CenterColor = [System.Drawing.Color]::FromArgb(
            70,
            [Math]::Min(255, $bg.R + 70),
            [Math]::Min(255, $bg.G + 70),
            [Math]::Min(255, $bg.B + 90))
        $glow.SurroundColors = @([System.Drawing.Color]::FromArgb(0, $bg))
        $g.FillPath($glow, $glowPath)
        $glow.Dispose(); $glowPath.Dispose()

        # ---- device artwork ------------------------------------------------
        $cropY = [int]($src.Height * $CropTop)
        $cropH = [int]($src.Height * $CropBottom) - $cropY
        if ($cropH -le 0) { throw "CropBottom must be greater than CropTop." }

        $srcRect = New-Object System.Drawing.Rectangle(0, $cropY, $src.Width, $cropH)

        # Let the device run off the bottom edge - it reads as intentional and
        # fills the card better than a fully contained, floating screenshot.
        $deviceH = 655
        $deviceW = [int]($deviceH * ($src.Width / [double]$cropH))

        $colX = 660
        $colW = $CANVAS_W - $colX - 40
        $deviceX = $colX + [int](($colW - $deviceW) / 2)
        $deviceY = 48

        $destRect = New-Object System.Drawing.Rectangle(
            $deviceX, $deviceY, $deviceW, $deviceH)

        # Round the artwork into a panel. Source slides vary - some bleed the
        # screenshot to the edge, some float a device on their own background.
        # Rounding plus a shadow makes both read as a deliberate inset panel
        # instead of a rectangle pasted onto the canvas.
        $radius = 34
        function New-RoundedPath([System.Drawing.Rectangle] $r, [int] $rad) {
            $path = New-Object System.Drawing.Drawing2D.GraphicsPath
            $d = $rad * 2
            $path.AddArc($r.X, $r.Y, $d, $d, 180, 90)
            $path.AddArc($r.Right - $d, $r.Y, $d, $d, 270, 90)
            $path.AddArc($r.Right - $d, $r.Bottom - $d, $d, $d, 0, 90)
            $path.AddArc($r.X, $r.Bottom - $d, $d, $d, 90, 90)
            $path.CloseFigure()
            return $path
        }

        # Stacked translucent outlines approximate a soft drop shadow.
        for ($i = 18; $i -ge 1; $i--) {
            $shadowRect = New-Object System.Drawing.Rectangle(
                ($destRect.X - $i), ($destRect.Y - [int]($i / 3) + 6),
                ($destRect.Width + $i * 2), ($destRect.Height + $i * 2))
            $shadowPath = New-RoundedPath $shadowRect ($radius + $i)
            $shadowBrush = New-Object System.Drawing.SolidBrush(
                [System.Drawing.Color]::FromArgb(6, 0, 0, 20))
            $g.FillPath($shadowBrush, $shadowPath)
            $shadowBrush.Dispose(); $shadowPath.Dispose()
        }

        $clipPath = New-RoundedPath $destRect $radius
        $savedClip = $g.Save()
        $g.SetClip($clipPath)

        $attrs = New-Object System.Drawing.Imaging.ImageAttributes
        $attrs.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
        $g.DrawImage($src, $destRect, $srcRect.X, $srcRect.Y, $srcRect.Width,
            $srcRect.Height, [System.Drawing.GraphicsUnit]::Pixel, $attrs)
        $attrs.Dispose()

        $g.Restore($savedClip)

        # Hairline highlight lifts the panel off the background.
        $edgePen = New-Object System.Drawing.Pen(
            [System.Drawing.Color]::FromArgb(38, 255, 255, 255), 1.5)
        $g.DrawPath($edgePen, $clipPath)
        $edgePen.Dispose(); $clipPath.Dispose()

        # ---- typography ----------------------------------------------------
        $family = "Segoe UI"
        foreach ($candidate in @("Inter", "Segoe UI Variable Display", "Segoe UI")) {
            try {
                $probe = New-Object System.Drawing.FontFamily($candidate)
                $family = $probe.Name
                $probe.Dispose()
                break
            }
            catch { continue }
        }

        $textX = 72
        $textW = 540

        # Eyebrow pill.
        $pillFont = New-Object System.Drawing.Font(
            $family, 21, [System.Drawing.FontStyle]::Bold,
            [System.Drawing.GraphicsUnit]::Pixel)
        $pillSize = $g.MeasureString($Eyebrow, $pillFont)
        $pillW = [int]$pillSize.Width + 56
        $pillH = [int]$pillSize.Height + 26
        $pillY = 150

        $pillPath = New-Object System.Drawing.Drawing2D.GraphicsPath
        $r = $pillH
        $pillPath.AddArc($textX, $pillY, $r, $r, 90, 180)
        $pillPath.AddArc($textX + $pillW - $r, $pillY, $r, $r, 270, 180)
        $pillPath.CloseFigure()

        $pillBrush = New-Object System.Drawing.SolidBrush(
            [System.Drawing.Color]::FromArgb(255, 12, 15, 38))
        $g.FillPath($pillBrush, $pillPath)
        $pillBrush.Dispose(); $pillPath.Dispose()

        $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
        $centered = New-Object System.Drawing.StringFormat
        $centered.Alignment = [System.Drawing.StringAlignment]::Center
        $centered.LineAlignment = [System.Drawing.StringAlignment]::Center
        $g.DrawString($Eyebrow, $pillFont,
            $white,
            (New-Object System.Drawing.RectangleF($textX, $pillY, $pillW, $pillH)),
            $centered)
        $pillFont.Dispose()

        # Headline - shrink to fit rather than overflow the card.
        $headFont = $null
        for ($size = 54; $size -ge 30; $size -= 2) {
            $candidateFont = New-Object System.Drawing.Font(
                $family, $size, [System.Drawing.FontStyle]::Bold,
                [System.Drawing.GraphicsUnit]::Pixel)
            $measured = $g.MeasureString(
                $Headline, $candidateFont,
                (New-Object System.Drawing.SizeF($textW, 400)))
            if ($measured.Height -le 250) { $headFont = $candidateFont; break }
            $candidateFont.Dispose()
        }
        if (-not $headFont) {
            $headFont = New-Object System.Drawing.Font(
                $family, 30, [System.Drawing.FontStyle]::Bold,
                [System.Drawing.GraphicsUnit]::Pixel)
        }

        $headRect = New-Object System.Drawing.RectangleF(
            $textX, ($pillY + $pillH + 30), $textW, 260)
        $g.DrawString($Headline, $headFont, $white, $headRect)
        $headFont.Dispose()

        $white.Dispose()

        # ---- encode --------------------------------------------------------
        $destDir = Split-Path -Parent $destPath
        if (-not (Test-Path $destDir)) {
            New-Item -ItemType Directory -Path $destDir -Force | Out-Null
        }

        $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
            Where-Object { $_.MimeType -eq "image/jpeg" }
        $encParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
        $encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
            [System.Drawing.Imaging.Encoder]::Quality, [int64]$Quality)

        $canvas.Save($destPath, $codec, $encParams)
        $encParams.Dispose()
    }
    finally {
        $g.Dispose()
        $canvas.Dispose()
    }
}
finally {
    $src.Dispose()
}

$sizeKb = [math]::Round((Get-Item $destPath).Length / 1KB, 1)
"Wrote $destPath  ->  ${CANVAS_W}x${CANVAS_H}, ${sizeKb} KB"
if ($sizeKb -gt 300) {
    Write-Warning "Over 300 KB - some chat clients skip large previews. Lower -Quality."
}
