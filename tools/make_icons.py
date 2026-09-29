#!/usr/bin/env python3
"""
make_icons.py : builds public/img/icons/xp/ from the official Windows XP icons.

Every icon on the site is Microsoft's, from Windows XP, taken from two GitHub
repositories that collect them:

    XPIcons   github.com/softwarehistorysociety/XPIcons  (1024px versions)
    winXP     github.com/ShizukuIchi/winXP               (the user picture and
                                                          the start flag)

The 1024px ones are far too heavy for a web page, so each is scaled down to
SIZE: twice the biggest the site shows (48), so it's still sharp on a high
density screen. The browser draws it smaller from there. The two from winXP
are kept at their own size, the flag cut down to the picture itself.

Needs pillow. In a throwaway virtualenv:

    python3 -m venv /tmp/iconenv
    /tmp/iconenv/bin/pip install pillow
    /tmp/iconenv/bin/python tools/make_icons.py
"""
import io
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "img" / "icons" / "xp"
SIZE = 96

XPICONS = "https://raw.githubusercontent.com/softwarehistorysociety/XPIcons/main/XP/"
WINXP = "https://raw.githubusercontent.com/ShizukuIchi/winXP/master/src/assets/windowsIcons/"

# file on the site: where it comes from
ICONS = {
    "internet-explorer.png": XPICONS + "InternetExplorer6.png",   # the Blog
    "explorer.png": XPICONS + "Explorer.png",                     # the File Browser
    "notepad.png": XPICONS + "Notepad.png",
    "text-document.png": XPICONS + "TXT.png",                     # credits.txt
    "internet-shortcut.png": XPICONS + "InternetShortcut.png",    # the tab icon
    "log-off.png": XPICONS + "Logout.png",
    "switch-user.png": XPICONS + "SwitchUser.png",
    "folder.png": XPICONS + "FolderClosed.png",
    "my-pictures.png": XPICONS + "MyPictures.png",
    "my-music.png": XPICONS + "MyMusic.png",
    "admin-key.png": XPICONS + "Key.png",                         # the admin's picture
    "go.png": XPICONS + "Go.png",                                 # the log on arrow
}
AS_IS = {
    "user-chess.png": WINXP + "user.png",                         # the user picture
    "start-flag.png": WINXP + "windows-off.png",                  # the start button
}


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "techtrash make_icons.py"})
    with urllib.request.urlopen(request) as response:
        return Image.open(io.BytesIO(response.read())).convert("RGBA")


def shrink(image, size):
    # Scaled with the colour premultiplied by its alpha, so the see-through
    # edges don't pick up a dark fringe from the transparent pixels' colour.
    return image.convert("RGBa").resize((size, size), Image.LANCZOS).convert("RGBA")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, url in ICONS.items():
        shrink(fetch(url), SIZE).save(OUT / name, optimize=True)
        print(f"{name}: {(OUT / name).stat().st_size} bytes")
    for name, url in AS_IS.items():
        image = fetch(url)
        image.crop(image.getchannel("A").getbbox()).save(OUT / name, optimize=True)
        print(f"{name}: {(OUT / name).stat().st_size} bytes")
