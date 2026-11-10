#!/usr/bin/env python3
"""
Builds public/img/wallpapers/ from Windows XP's own wallpapers.

They're Microsoft's, the Home edition's set at 800 x 600, taken unmodified
from real Windows installs and kept at
github.com/WINNT-Moments/Windows-Wallpaper-Archive.

Twelve of them were stock photos, and bigger copies of those (1920 x 1200,
from the photographers' own originals) were gathered for the Windows XP HD
Wallpaper Pack (deviantart.com/windowssenpai/art/Windows-XP-HD-Wallpaper-Pack-776806652,
mirrored at via.sudovanilla.org). Those are used instead, with their colors
matched to XP's copies, since some have been rescanned or read with the
wrong color profile. The other eight were made for XP and never came any
bigger, so they're used as they are.

Each is saved as a JPEG, under the id public/js/wallpapers.js gives it.

Needs pillow and numpy. In a throwaway virtualenv:

    python3 -m venv /tmp/wallenv
    /tmp/wallenv/bin/pip install pillow numpy
    /tmp/wallenv/bin/python tools/make_wallpapers.py
"""
import io
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "img" / "wallpapers"
ARCHIVE = "https://raw.githubusercontent.com/WINNT-Moments/Windows-Wallpaper-Archive/main/Windows XP RTM Home Wallpapers/"
BIGGER = "https://via.sudovanilla.org/media/wallpapers/Operating Systems/Microsoft Windows/Windows XP/"
QUALITY = 88

# each id on the site (public/js/wallpapers.js), with XP's file and the bigger copy's (or None)
WALLPAPERS = {
    "ascent": ("Ascent.jpg", "Ascent.jpg"),
    "autumn": ("Autumn.jpg", "Autumn.jpg"),
    "azul": ("Azul.jpg", "Azul.jpg"),
    "bliss": ("Bliss.bmp", "Bliss.jpg"),
    "crystal": ("Crystal.jpg", None),
    "follow": ("Follow.jpg", "Follow.jpg"),
    "friend": ("Friend.jpg", "Friend.jpg"),
    "home": ("Home.jpg", None),
    "moon-flower": ("Moon flower.jpg", None),
    "peace": ("Peace.jpg", None),
    "power": ("Power.jpg", None),
    "purple-flower": ("Purple flower.jpg", None),
    "radiance": ("Radiance.jpg", "Radiance.jpg"),
    "red-moon-desert": ("Red moon desert.jpg", "Red moon desert.jpg"),
    "ripple": ("Ripple.jpg", None),
    "stonehenge": ("Stonehenge.jpg", "Stonehenge (Getty Images Rescan).jpg"),
    "tulips": ("Tulips.jpg", "Tulips.jpg"),
    "vortec-space": ("Vortec space.jpg", "Vortec space.jpg"),
    "wind": ("Wind.jpg", "Wind.jpg"),
    "windows-xp": ("Windows XP.jpg", None),
}


def fetch(base, name):
    url = urllib.parse.quote(base + name, safe=":/")
    request = urllib.request.Request(url, headers={"User-Agent": "techtrash make_wallpapers.py"})
    with urllib.request.urlopen(request) as response:
        return response.read()


def matched(big, xp):
    """The bigger copy with XP's colors, so a rescan or a wrong color profile
    comes out the way XP showed it. Its brightness and two color channels
    (YCbCr) are each shifted and stretched until their average and spread
    match XP's copy, compared over the same 16:10 middle at the same small
    size. The change is the same over the whole picture, so no part of it
    changes color on its own."""
    w, h = xp.size
    cut = round(w * 10 / 16)
    xp_middle = xp.crop((0, (h - cut) // 2, w, (h - cut) // 2 + cut)).resize((640, 400), Image.LANCZOS)
    want = np.asarray(xp_middle.convert("YCbCr"), float)
    have = np.asarray(big.resize((640, 400), Image.LANCZOS).convert("YCbCr"), float)
    pixels = np.asarray(big.convert("YCbCr"), float)
    for channel in range(3):
        spread = want[..., channel].std() / max(have[..., channel].std(), 1e-6)
        pixels[..., channel] = (pixels[..., channel] - have[..., channel].mean()) * spread + want[..., channel].mean()
    return Image.fromarray(np.clip(np.round(pixels), 0, 255).astype(np.uint8), "YCbCr").convert("RGB")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for wallpaper_id, (xp_name, big_name) in WALLPAPERS.items():
        path = OUT / f"{wallpaper_id}.jpg"
        data = fetch(ARCHIVE, xp_name)
        xp = Image.open(io.BytesIO(data)).convert("RGB")
        if big_name:
            picture = matched(Image.open(io.BytesIO(fetch(BIGGER, big_name))).convert("RGB"), xp)
            picture.save(path, quality=QUALITY, optimize=True, progressive=True)
        else:
            # XP's own JPEG, byte for byte, since saving it again would only lose detail
            picture = xp
            path.write_bytes(data)
        print(f"{path.name}: {picture.width} x {picture.height}, {path.stat().st_size} bytes")
