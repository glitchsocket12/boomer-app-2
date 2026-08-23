#!/usr/bin/env python3
"""
Regenerate the app icons (home-screen icon, browser tab, install icons).

WHY THIS EXISTS AS A SCRIPT
---------------------------
The app name is expected to change. Rather than leaving four hand-made PNGs
that nobody remembers how to redo, this regenerates all of them from two
constants below. When the name changes, edit LETTER (and BRAND if the palette
moves), re-run, done.

HOW TO RUN
----------
    pip install pillow
    python3 scripts/generate-icons.py

Writes into public/:
    apple-touch-icon.png     180x180  iPhone home screen (iOS needs PNG, not SVG)
    icon-192.png             192x192  Android / Chrome install
    icon-512.png             512x512  Android / Chrome install, splash screens
    icon-maskable-512.png    512x512  Android adaptive icons (padded safe zone)

Then commit the PNGs — they're build inputs, not build output, so they belong
in git.
"""

from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------------------
# CHANGE THESE WHEN THE NAME CHANGES
# ---------------------------------------------------------------------------
LETTER = "G"                 # the letterform on the icon
BG = "#2E4034"               # dark green - the app's dominant colour (226 uses in src/)
FG = "#FBF3E0"               # warm cream - the app's surface colour
# ---------------------------------------------------------------------------

# Windows paths come first: this repo is developed on Windows, where every path below it
# missed and the script died on "No serif font found" (found 2026-08-22, during the Grove
# rename). Georgia Bold is also the app's own type face, so it's the better match anyway.
# DejaVu Serif Bold is the closest sturdy Linux equivalent; Liberation Serif is the fallback
# (Times-metric, a little lighter).
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\georgiab.ttf",
    r"C:\Windows\Fonts\timesbd.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSerifBold.ttf",
]


def load_font(size):
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    raise SystemExit(
        "No serif font found. Install one, or add its path to FONT_CANDIDATES."
    )


def render(size, padding_ratio=0.0):
    """Square icon, letter optically centred.

    padding_ratio shrinks the artwork toward the middle. Android's adaptive
    icons crop to a circle and can clip ~20% off each edge, so the maskable
    variant needs the letter well inside that safe zone.
    """
    img = Image.new("RGB", (size, size), BG)
    draw = ImageDraw.Draw(img)

    usable = size * (1.0 - 2 * padding_ratio)
    font = load_font(int(usable * 0.62))

    # Use the glyph's real ink bounds, not the font's line metrics - line
    # metrics include ascender/descender space the letter doesn't occupy, and
    # centring on them leaves the letter visibly sitting high.
    left, top, right, bottom = draw.textbbox((0, 0), LETTER, font=font)
    x = (size - (right - left)) / 2 - left
    y = (size - (bottom - top)) / 2 - top

    draw.text((x, y), LETTER, font=font, fill=FG)
    return img


def main():
    outputs = [
        ("public/apple-touch-icon.png", 180, 0.0),
        ("public/icon-192.png", 192, 0.0),
        ("public/icon-512.png", 512, 0.0),
        ("public/icon-maskable-512.png", 512, 0.18),
    ]
    for path, size, pad in outputs:
        render(size, pad).save(path, "PNG", optimize=True)
        print(f"wrote {path} ({size}x{size})")


if __name__ == "__main__":
    main()
