#!/usr/bin/env python3
"""
Builds public/programs/paint/jspaint/ from JS Paint.

JS Paint is MS Paint remade for the web, by Isaiah Odhner (MIT,
github.com/1j01/jspaint). The desktop's Paint is JS Paint in a window, saving
its files on the shared disk instead of your computer
(public/programs/paint/index.html and paint.js do that part).

This copies the parts of JS Paint that Paint uses, at one commit, unchanged
except for two small patches (PATCHES, below). Those keep it to English and
the classic look, since the other languages and looks aren't copied.
Also left behind are the multi-user sessions and their autosave, opening
PDFs, uploading to Imgur, the head tracker, speech recognition, the news
and the desktop app.

    python3 tools/make_paint.py                  # downloads COMMIT from GitHub
    python3 tools/make_paint.py --from ~/jspaint # or uses a checkout of it

A checkout should be at COMMIT, and this says so if it isn't.
"""
import argparse
import glob
import io
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "programs" / "paint" / "jspaint"
COMMIT = "53be67ab8c47cc0d2168899e7481bc04839c4c81"
ARCHIVE = f"https://codeload.github.com/1j01/jspaint/tar.gz/{COMMIT}"

# What Paint uses, as globs from JS Paint's own folder.
FILES = [
    "LICENSE.txt",
    "audio/*",
    "help/*",
    "images/*.png", "images/*.gif", "images/*.svg",
    "images/classic/*", "images/cursors/*", "images/transforms/*", "images/icons/*16x16*",
    "lib/98.css/98.custom-build.css",
    "lib/FileSaver.js", "lib/UPNG.js", "lib/UTIF.js", "lib/anypalette-0.6.0.js", "lib/bmp.js",
    "lib/font-detective.js", "lib/gif.js/gif.js", "lib/gif.js/gif.worker.js", "lib/imagetracer_v1.2.5.js",
    "lib/jquery-3.4.1.min.js", "lib/libtess.min.js", "lib/pako-2.0.3.min.js",
    "lib/os-gui/$Window.js", "lib/os-gui/MenuBar.js", "lib/os-gui/parse-theme.js",
    "lib/os-gui/build/layout.css", "lib/os-gui/build/windows-98.css",
    "src/*.js",
    "styles/layout.css", "styles/normalize.css", "styles/print.css", "styles/themes/classic.css",
]
# ...but not these, which are left behind (see above) or are JS Paint's own tools.
LEAVE = {
    "src/sessions.js", "src/test-news.js", "src/eye-gaze-mode.js", "src/discord-activity-client.js",
    "src/electron-injected.js", "src/electron-main.js", "src/copy-inkscape-labels.js",
    "src/repack-spritesheet.js", "src/save-history-as-spritesheet.js", "src/extra-tools.js",
}

# Each file's changes, as (what's there, what it becomes). What's there has
# to be found exactly once.
PATCHES = {
    "src/app-localization.js": [(
        "const accepted_languages = Array.from(navigator.languages || [navigator.language || navigator.userLanguage]);",
        "const accepted_languages = []; // techtrash.org: English only (the other languages aren't copied)",
    )],
    "src/theme.js": [
        ("if (is_december && !grinch && !running_tests) {",
         "if (false) { // techtrash.org: the classic look only (the others aren't copied)"),
        ("current_theme = localStorage[theme_storage_key] || default_theme;",
         "current_theme = default_theme; // techtrash.org: the classic look only"),
    ],
}


def download():
    request = urllib.request.Request(ARCHIVE, headers={"User-Agent": "techtrash make_paint.py"})
    with urllib.request.urlopen(request) as response:
        data = response.read()
    place = Path(tempfile.mkdtemp(prefix="jspaint-"))
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        archive.extractall(place, filter="data")
    return next(place.iterdir())


def build(source):
    if OUT.exists():
        shutil.rmtree(OUT)
    copied = 0
    size = 0
    for pattern in FILES:
        matches = sorted(glob.glob(pattern, root_dir=source))
        if not matches:
            raise SystemExit(f"nothing in JS Paint matches {pattern}")
        for name in matches:
            if name in LEAVE or not (source / name).is_file():
                continue
            target = OUT / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source / name, target)
            copied += 1
            size += target.stat().st_size
    for name, changes in PATCHES.items():
        path = OUT / name
        text = path.read_text()
        for old, new in changes:
            if text.count(old) != 1:
                raise SystemExit(f"{name}: expected to find this once:\n  {old}")
            text = text.replace(old, new)
        path.write_text(text)
    print(f"{copied} files, {size / 1024 / 1024:.1f} MB, in {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--from", dest="source", help="a checkout of JS Paint, instead of downloading it")
    args = parser.parse_args()
    if args.source:
        source = Path(args.source).expanduser().resolve()
        head = subprocess.run(["git", "-C", str(source), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
        if head and head != COMMIT:
            print(f"note: that checkout is at {head}, not {COMMIT}")
    else:
        source = download()
    build(source)
