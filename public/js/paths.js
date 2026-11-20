// The shared disk as XP's C: drive, for the Command Prompt and Run.
//
//   C:\Documents and Settings\techtrash  the one user everyone is
//     Desktop, My Documents              the disk's folders
//   C:\RECYCLER                          the Recycle Bin, where XP kept it
//   C:\Program Files, C:\WINDOWS         there, but empty
//
// A place is { kind, item, path }. kind is "drive", "virtual" (not on the disk),
// "folder", "file" or "app" (a shortcut). item is the disk item or null.

const disk = () => window.top.desktop.disk;

export const HOME = "C:\\Documents and Settings\\techtrash";
const PROFILE = { Desktop: "desktop", "My Documents": "documents" };

// Virtual folders and their contents.
const VIRTUAL = {
  "C:\\": ["Documents and Settings", "Program Files", "RECYCLER", "WINDOWS"],
  "C:\\Documents and Settings": ["techtrash"],
  [HOME]: ["Desktop", "My Documents"],
  "C:\\Program Files": [],
  "C:\\WINDOWS": [],
};

// Disk folders by their C: path.
const ROOTS = { [`${HOME}\\Desktop`]: "desktop", [`${HOME}\\My Documents`]: "documents", "C:\\RECYCLER": "recycle" };

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

// Shortcuts get XP's .lnk extension.
export const fileName = (item) => (item.kind === "app" ? `${item.name}.lnk` : item.name);

// A disk item's DOS path.
export function pathOf(id) {
  const chain = disk().path(id);
  if (!chain.length) return "C:\\";
  const [top, ...rest] = chain;
  const root = Object.entries(ROOTS).find(([, folder]) => folder === top.id)?.[0] ?? "C:\\";
  return [root, ...rest.map(fileName)].join("\\");
}

// The place at a full DOS path, or null.
function at(path) {
  const clean = path.replace(/\\+$/, "") || "C:";
  if (same(clean, "C:")) return { kind: "drive", item: null, path: "C:\\" };
  const virtual = Object.keys(VIRTUAL).find((key) => same(key.replace(/\\$/, ""), clean));
  if (virtual) return { kind: "virtual", item: null, path: virtual };
  const root = Object.keys(ROOTS).find((key) => same(key, clean) || clean.toLowerCase().startsWith(`${key.toLowerCase()}\\`));
  if (!root) return null;
  let item = disk().item(ROOTS[root]);
  if (!item) return null;   // disk not loaded yet
  for (const part of clean.slice(root.length).split("\\").filter(Boolean)) {
    if (item.kind !== "folder") return null;
    item = disk().children(item.id).find((one) => same(fileName(one), part) || same(one.name, part));
    if (!item) return null;
  }
  return { kind: item.kind === "folder" ? "folder" : item.kind === "app" ? "app" : "file", item, path: pathOf(item.id) };
}

// A typed path, from `cwd`. Absolute (C:\..., \...) or relative with . and ..,
// quoted or not. Bare "My Documents", "Desktop" and "Recycle Bin" work too.
// Null if nothing's there.
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

// A place's listing as [{ name, folder, size, modified, item }], folders first.
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

// Disk folder id for new items at a place. Null for virtual folders.
export const folderOf = (place) => (place?.kind === "folder" ? place.item.id : null);
