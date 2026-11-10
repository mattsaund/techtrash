#!/usr/bin/env python3
"""
Builds public/img/icons/xp/ from the official Windows XP icons.

They're all Microsoft's, from Windows XP, taken from two GitHub repositories
that collect them:

    XPIcons   github.com/softwarehistorysociety/XPIcons  (1024px versions)
    winXP     github.com/ShizukuIchi/winXP               (the user picture and
                                                          the start flag)

The 1024px ones are far too heavy for a web page. Each is scaled down to
SIZE, twice the biggest the site shows (48), so it stays sharp on a high
density screen and the browser draws it smaller from there. The two from
winXP keep their own size, and the flag is cropped to the picture itself.

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

# each file on the site, and where it comes from
ICONS = {
    "internet-explorer.png": XPICONS + "InternetExplorer6.png",   # the style guide's IE window
    "explorer.png": XPICONS + "Explorer.png",                     # the File Browser
    "notepad.png": XPICONS + "Notepad.png",
    "text-document.png": XPICONS + "TXT.png",                     # credits.txt
    "internet-shortcut.png": XPICONS + "InternetShortcut.png",    # the tab icon, and the blog's
    "log-off.png": XPICONS + "Logout.png",
    "switch-user.png": XPICONS + "SwitchUser.png",
    "folder.png": XPICONS + "FolderClosed.png",
    "my-pictures.png": XPICONS + "MyPictures.png",
    "my-music.png": XPICONS + "MyMusic.png",
    "admin-key.png": XPICONS + "Key.png",                         # the admin's picture
    "go.png": XPICONS + "Go.png",                                 # the log on arrow
    "recycle-bin.png": XPICONS + "RecycleBin(empty).png",         # the Recycle Bin, empty
    "error.png": XPICONS + "Critical.png",                        # an error message's red X
    # the shared desktop's programs and places
    "paint.png": XPICONS + "Paint.png",
    "display-properties.png": XPICONS + "DisplayProperties.png",
    "control-panel.png": XPICONS + "ControlPanel.png",
    "admin-tools.png": XPICONS + "AdministrativeTools.png",       # the Admin Dashboard
    "my-documents.png": XPICONS + "MyDocuments.png",
    "desktop.png": XPICONS + "Desktop.png",
    "recycle-bin-full.png": XPICONS + "RecycleBin(full).png",
    # what's on the disk
    "jpg.png": XPICONS + "JPG.png",                               # a PNG, JPEG or WebP picture
    "bitmap.png": XPICONS + "Bitmap.png",                         # a BMP picture
    "gif.png": XPICONS + "GIF.png",
    # Explorer's buttons and tasks
    "back.png": XPICONS + "Back.png",
    "forward.png": XPICONS + "Forward.png",
    "up.png": XPICONS + "Up.png",
    "new-folder.png": XPICONS + "NewFolder.png",
    "rename.png": XPICONS + "Rename.png",
    "delete.png": XPICONS + "Delete.png",
    "move-to.png": XPICONS + "Movetofolder.png",
    "restore.png": XPICONS + "Restore.png",
    "restore-all.png": XPICONS + "RestoreAllItems.png",
    # More programs. Date and Time Properties (from the clock), the
    # accessories, and Notepad++, which gets XP's script icon since it isn't
    # XP's. The games have their own icons (tools/make_game_icons.py).
    "date-time.png": XPICONS + "DateandTime.png",
    "calculator.png": XPICONS + "Calculator.png",
    "command-prompt.png": XPICONS + "CommandPrompt.png",
    "run.png": XPICONS + "Run.png",
    "picture-viewer.png": XPICONS + "WindowsPictureandFaxViewer.png",
    "script.png": XPICONS + "ScriptComponent.png",
    # Notepad++'s files, and its toolbar
    "javascript.png": XPICONS + "JavaScript.png",
    "css.png": XPICONS + "CSS.png",
    "html.png": XPICONS + "HTML.png",
    "open.png": XPICONS + "Open.png",
    "save.png": XPICONS + "Save.png",
    "cut.png": XPICONS + "Cut.png",
    "copy.png": XPICONS + "Copy.png",
    "paste.png": XPICONS + "Paste.png",
    "undo.png": XPICONS + "Undo.png",
    "redo.png": XPICONS + "Redo.png",
    "search.png": XPICONS + "Search.png",
    # Windows Media Player, and the music and sounds it plays
    "media-player.png": XPICONS + "WindowsMediaPlayer9.png",
    "audio.png": XPICONS + "GenericAudio.png",
    "play.png": XPICONS + "Play.png",                             # the File Browser's Music Tasks
    # the picture viewer's buttons
    "zoom-in.png": XPICONS + "IEEnlargeImage.png",
    "zoom-out.png": XPICONS + "IEShrinkImage.png",
    "slideshow.png": XPICONS + "Slideshow.png",
    # message boxes, and the lock in the tray
    "question.png": XPICONS + "Question.png",
    "information.png": XPICONS + "Information.png",
    "alert.png": XPICONS + "Alert.png",
    "delete-file.png": XPICONS + "DeleteConfirmation.png",
    "padlock.png": XPICONS + "Padlock.png",
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
    # Scaled with the color premultiplied by its alpha, so the see-through
    # edges don't pick up a dark fringe from the transparent pixels' color.
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
