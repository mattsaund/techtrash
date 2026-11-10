#!/usr/bin/env python3
"""
Builds public/files/create-mod-all.mrpack, the Minecraft server's modpack,
from the Prism Launcher instance it's played in.

A Modrinth pack (.mrpack) is a zip holding one file, modrinth.index.json. It
names the Minecraft version and the mod loader, and lists every mod with its
hashes and the address Modrinth serves it from. A launcher reads it, makes a
fresh instance, and downloads each mod from Modrinth itself, checking it
against its hashes. So the pack is a few dozen KB and hands out nobody's jars.

It carries nothing else. No configs (every mod writes its own defaults the
first time it runs), and no settings, worlds, caches, resource packs or
server list. Importing it gives a fresh instance with the mods and nothing
of the instance it was made from.

Every mod has to have come from Modrinth, installed through Prism's mod
browser, which records where each one came from in mods/.index. Before
anything is written, each jar on disk is checked against Prism's record of
it, and Modrinth is asked to confirm every file by its hash, so the pack
points at exactly the jars the instance runs.

    python3 tools/make_modpack.py                    # the default instance
    python3 tools/make_modpack.py "<instance folder>" [--version 2026.11.02]

Needs Python 3.11 or newer (for tomllib) and nothing else. Players import
the result in Prism (Add Instance, Import, paste
https://techtrash.org/files/create-mod-all.mrpack) or open it with the
Modrinth App.
"""
import argparse
import datetime
import hashlib
import json
import sys
import tomllib
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "files" / "create-mod-all.mrpack"
INSTANCE = Path.home() / ".local/share/PrismLauncher/instances/1.21.1 Create Mod All"
NAME = "1.21.1 Create Mod All"
SUMMARY = "Create and its addons, for Minecraft 1.21.1 on NeoForge."

# The hosts a launcher will download a pack's files from (the .mrpack format's own list).
HOSTS = {"cdn.modrinth.com", "github.com", "raw.githubusercontent.com", "gitlab.com"}
# Prism's names for the game and the loaders, and what the format calls them.
LOADERS = {
    "net.minecraft": "minecraft",
    "net.neoforged": "neoforge",
    "net.minecraftforge": "forge",
    "net.fabricmc.fabric-loader": "fabric-loader",
    "org.quiltmc.quilt-loader": "quilt-loader",
}
API = "https://api.modrinth.com/v2"


def fail(message):
    sys.exit(f"make_modpack.py: {message}")


def digest(path, algorithm):
    h = hashlib.new(algorithm)
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def modrinth_files(sha512s):
    """{sha512: (url, sha1)} for every file Modrinth has, asked in one go."""
    request = urllib.request.Request(
        f"{API}/version_files",
        data=json.dumps({"hashes": sha512s, "algorithm": "sha512"}).encode(),
        headers={"content-type": "application/json", "user-agent": "techtrash.org make_modpack.py"},
    )
    with urllib.request.urlopen(request) as response:
        versions = json.load(response)
    found = {}
    for wanted, version in versions.items():
        for file in version["files"]:
            if file["hashes"]["sha512"] == wanted:
                found[wanted] = (file["url"], file["hashes"]["sha1"])
    return found


def main():
    args = argparse.ArgumentParser(description="Builds the modpack from a Prism instance.")
    args.add_argument("instance", nargs="?", type=Path, default=INSTANCE)
    args.add_argument("--version", default=datetime.date.today().strftime("%Y.%m.%d"),
                      help="the pack's version (default: today's date, as 2026.11.02)")
    opts = args.parse_args()

    game = opts.instance / "minecraft"
    if not game.is_dir():
        game = opts.instance / ".minecraft"
    mods = game / "mods"
    if not mods.is_dir():
        fail(f"no mods folder in {opts.instance}")

    components = json.loads((opts.instance / "mmc-pack.json").read_text())["components"]
    dependencies = {LOADERS[c["uid"]]: c["version"] for c in components if c["uid"] in LOADERS}
    if "minecraft" not in dependencies or len(dependencies) < 2:
        fail(f"couldn't tell the Minecraft version and the loader from mmc-pack.json: {dependencies}")

    # Prism's record of each mod, with where it came from and its hash
    records = {}
    for path in (mods / ".index").glob("*.pw.toml"):
        record = tomllib.loads(path.read_text())
        records[record["filename"]] = record

    jars = sorted(p for p in mods.iterdir() if p.suffix == ".jar")
    problems = []
    files = []
    for jar in jars:
        record = records.get(jar.name)
        download = (record or {}).get("download", {})
        if not record or download.get("mode") != "url" or "modrinth" not in record.get("update", {}):
            problems.append(f"{jar.name}: not installed from Modrinth through Prism")
            continue
        if urllib.parse.urlparse(download["url"]).hostname not in HOSTS:
            problems.append(f"{jar.name}: downloads from {download['url']}, a host launchers won't use")
            continue
        sha512 = digest(jar, "sha512")
        if download.get("hash-format") == "sha512" and download.get("hash") != sha512:
            problems.append(f"{jar.name}: isn't the file Prism downloaded (its hash has changed)")
            continue
        files.append({
            "path": f"mods/{jar.name}",
            "hashes": {"sha1": digest(jar, "sha1"), "sha512": sha512},
            "downloads": [download["url"]],
            "fileSize": jar.stat().st_size,
        })
    if problems:
        fail("these mods can't go in the pack:\n  " + "\n  ".join(problems))

    # Modrinth's word that it serves each exact file, and where
    confirmed = modrinth_files([f["hashes"]["sha512"] for f in files])
    for f in files:
        url, sha1 = confirmed.get(f["hashes"]["sha512"], (None, None))
        if not url:
            problems.append(f"{f['path']}: Modrinth doesn't have this exact file")
        elif sha1 != f["hashes"]["sha1"]:
            problems.append(f"{f['path']}: Modrinth's sha1 for it doesn't match")
        else:
            f["downloads"] = [url]
    if problems:
        fail("Modrinth couldn't confirm:\n  " + "\n  ".join(problems))

    index = {
        "formatVersion": 1,
        "game": "minecraft",
        "versionId": opts.version,
        "name": NAME,
        "summary": SUMMARY,
        "files": files,
        "dependencies": dependencies,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as pack:
        pack.writestr("modrinth.index.json", json.dumps(index, indent=2) + "\n")
    loader = ", ".join(f"{k} {v}" for k, v in dependencies.items())
    print(f"{OUT.relative_to(ROOT)}: {len(files)} mods, {loader}, version {opts.version}, "
          f"{OUT.stat().st_size / 1024:.0f} KB (the mods themselves: {sum(f['fileSize'] for f in files) / 1e6:.0f} MB, "
          f"downloaded from Modrinth on import)")


if __name__ == "__main__":
    main()
