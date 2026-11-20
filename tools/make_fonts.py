#!/usr/bin/env python3
"""
Builds the Tahoma and DejaVu Sans Mono web fonts in public/fonts/.

    tahoma-latin.woff2             Wine's Tahoma, subset to Latin
    tahoma-bold-latin.woff2        Wine's Tahoma Bold, emboldened (below)
    dejavu-sans-mono-latin.woff2   DejaVu Sans Mono, subset to Latin

Wine's Tahoma Bold has bold widths but regular outlines. Its bold look comes
from embedded bitmaps, which browsers ignore, so it renders thin. embolden()
fakes it the way XP did, merging each outline with a copy shifted STEM font
units right. That doubles vertical stems. 180 of 2048 is about 1px at 11px.

Needs fonttools, brotli and skia-pathops. In a throwaway virtualenv:

    python3 -m venv /tmp/fontenv
    /tmp/fontenv/bin/pip install fonttools brotli skia-pathops
    /tmp/fontenv/bin/python tools/make_fonts.py

Sources are from Debian/Ubuntu's fonts-wine and fonts-dejavu-core packages.
Change the paths below if yours differ.
"""
from pathlib import Path

from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.ttLib.removeOverlaps import removeOverlaps

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "fonts"

TAHOMA = "/usr/share/wine/fonts/tahoma.ttf"
TAHOMA_BOLD = "/usr/share/wine/fonts/tahomabd.ttf"
MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"

STEM = 180

# Google Fonts' "latin" subset.
LATIN = (
    list(range(0x0000, 0x0100))
    + [0x0131, 0x0152, 0x0153, 0x02BB, 0x02BC, 0x02C6, 0x02DA, 0x02DC]
    + list(range(0x2000, 0x2070))
    + [0x2074, 0x20AC, 0x2122, 0x2190, 0x2191, 0x2192, 0x2193, 0x2212, 0x2215, 0xFEFF, 0xFFFD]
)

# Bitmap and FontForge tables, which browsers don't use.
DROP = ["EBDT", "EBLC", "BDF ", "FFTM", "VDMX"]


def embolden(font):
    """Merges every outline with a copy of itself STEM units to the right."""
    glyphs = font.getGlyphSet()
    glyf = font["glyf"]
    order = font.getGlyphOrder()
    thick = {}
    for name in order:
        # Decompose first so composite glyphs aren't thickened twice.
        outline = DecomposingRecordingPen(glyphs)
        glyphs[name].draw(outline)
        pen = TTGlyphPen(None)
        outline.replay(pen)
        outline.replay(TransformPen(pen, (1, 0, 0, 1, STEM, 0)))
        thick[name] = pen.glyph()
    for name in order:
        glyf[name] = thick[name]
    removeOverlaps(font)
    # Widths already fit the bold. Only the left side bearings follow the new outlines.
    hmtx = font["hmtx"]
    for name in order:
        g = glyf[name]
        g.recalcBounds(glyf)
        hmtx[name] = (hmtx[name][0], getattr(g, "xMin", 0))


def build(src, dst, bold=False):
    font = TTFont(src)
    for tag in DROP:
        if tag in font:
            del font[tag]
    if bold:
        embolden(font)
    opts = Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    sub = Subsetter(opts)
    sub.populate(unicodes=LATIN)
    sub.subset(font)
    font.flavor = "woff2"
    font.save(OUT / dst)
    print(f"{dst}: {(OUT / dst).stat().st_size} bytes")


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    build(TAHOMA, "tahoma-latin.woff2")
    build(TAHOMA_BOLD, "tahoma-bold-latin.woff2", bold=True)
    build(MONO, "dejavu-sans-mono-latin.woff2")
