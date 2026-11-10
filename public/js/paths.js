// The shared disk as XP's C: drive, as the Command Prompt and Run see it.
//
//   C:\                                  the drive
//   C:\Documents and Settings\techtrash  the one user everyone is
//     Desktop                            the disk's Desktop folder
//     My Documents                       the disk's My Documents, with My
//                                        Pictures, My Music and the rest
//   C:\RECYCLER                          the Recycle Bin, where XP kept it
//   C:\Program Files, C:\WINDOWS         there, but empty
//
// A place is { kind, item, path }. kind is "drive", "virtual" (a made-up
// folder), "folder", "file" or "app" (a shortcut). item is the disk item
// (js/items.js) if it's on the disk, and path is its full DOS path. The disk
// is the desktop's, window.top.desktop.disk.

const disk = () => window.top.desktop.disk;

export const HOME = "C:\\Documents and Settings\\techtrash";
const PROFILE = { Desktop: "desktop", "My Documents": "documents" };

// The made-up folders that aren't on the disk, and what's in them.
const VIRTUAL = {
  "C:\\": ["Documents and Settings", "Program Files", "RECYCLER", "WINDOWS"],
  "C:\\Documents and Settings": ["techtrash"],
  [HOME]: ["Desktop", "My Documents"],
  "C:\\Program Files": [],
  "C:\\WINDOWS": [],
};

// The disk's own folders, by where they are on C:.
const ROOTS = { [`${HOME}\\Desktop`]: "desktop", [`${HOME}\\My Documents`]: "documents", "C:\\RECYCLER": "recycle" };

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

// A disk item's file name. A shortcut's has XP's .lnk on the end.
export const fileName = (item) => (item.kind === "app" ? `${item.name}.lnk` : item.name);

// Where something on the disk is, as a DOS path.
export function pathOf(id) {
  const chain = disk().path(id);
  if (!chain.length) return "C:\\";
  const [top, ...rest] = chain;
  const root = Object.entries(ROOTS).find(([, folder]) => folder === top.id)?.[0] ?? "C:\\";
  return [root, ...rest.map(fileName)].join("\\");
}

// What's at a full DOS path, or null.
function at(path) {
  const clean = path.replace(/\\+$/, "") || "C:";
  if (same(clean, "C:")) return { kind: "drive", item: null, path: "C:\\" };
  const virtual = Object.keys(VIRTUAL).find((key) => same(key.replace(/\\$/, ""), clean));
  if (virtual) return { kind: "virtual", item: null, path: virtual };
  const root = Object.keys(ROOTS).find((key) => same(key, clean) || clean.toLowerCase().startsWith(`${key.toLowerCase()}\\`));
  if (!root) return null;
  let item = disk().item(ROOTS[root]);
  if (!item) return null;   // (the disk isn't here yet)
  for (const part of clean.slice(root.length).split("\\").filter(Boolean)) {
    if (item.kind !== "folder") return null;
    item = disk().children(item.id).find((one) => same(fileName(one), part) || same(one.name, part));
    if (!item) return null;
  }
  return { kind: item.kind === "folder" ? "folder" : item.kind === "app" ? "app" : "file", item, path: pathOf(item.id) };
}

// A path someone typed, from `cwd` (a full path). It can be absolute
// (C:\..., \...) or relative, with . and .., in quotes or not. The bare
// names "My Documents", "Desktop" and "Recycle Bin" work too. Gives back the
// place, or null if nothing's there.
export function resolve(typed, cwd = HOME) {
  let text = String(typed ?? "").trim().replace(/^"(.*)"$/, "$1").replace(/\//g, "\\");
  if (!text) return at(cwd);
  const named = { "my documents": `${HOME}\\My Documents`, desktop: `${HOME}\\Desktop`, "recycle bin": "C:\\RECYCLER" };
  if (named[text.toLowerCase()]) return at(named[text.toLowerCase()]);
  if (/^c:/i.test(text)) text = text.slice(2);
  else if (!text.startsWith("\\")) text = `${cwd.slice(2)}\\${text}`;
  const parts = [];
  for (const part of text.split("\\")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return at(`C:\\${parts.join("\\")}`);
}

// What's in a place, disk folder or made-up one, as
// [{ name, folder, size, modified, item }], folders first.
export function contents(place) {
  if (place.kind === "drive" || place.kind === "virtual") {
    const names = VIRTUAL[place.path] ?? [];
    return names.map((name) => {
      const full = place.path === "C:\\" ? `C:\\${name}` : `${place.path}\\${name}`;
      const real = ROOTS[full] && disk().item(ROOTS[full]);
      return { name, folder: true, size: 0, modified: real?.modified ?? 0, item: real ?? null };
    });
  }
  return disk().children(place.item.id)
    .map((item) => ({ name: fileName(item), folder: item.kind === "folder", size: item.kind === "file" ? item.size : item.kind === "app" ? 1024 : 0, modified: item.modified, item }))
    .sort((a, b) => (b.folder - a.folder) || a.name.localeCompare(b.name, "en-US", { numeric: true, sensitivity: "base" }));
}

// Where something new made at a place goes, as a disk folder's id. Null for
// the made-up folders, which hold nothing.
export const folderOf = (place) => (place?.kind === "folder" ? place.item.id : null);
