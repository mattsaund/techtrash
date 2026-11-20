// Stateless helpers for disk items: icons, type names, sizes, dates, openers.
// An item (server/disk.js) is { id, parent, name, kind, type, size, version,
// madeBy, created, modified, wasIn }. kind is "folder", "file" or "app" (a
// shortcut). type is a file's media type, or a shortcut's app id.

import { FIRST_SHORTCUTS, findApp } from "./apps.js";

const XP = "/img/icons/xp";

export const TEXT = "text/plain";

// DataTransfer type for items dragged out of a File Browser. Data is a JSON array of ids.
export const DRAGGED = "application/x-techtrash-items";

// Built-in folders (server/disk.js) and their icons.
export const SPECIAL = {
  desktop:   { icon: `${XP}/desktop.png` },
  documents: { icon: `${XP}/my-documents.png` },
  pictures:  { icon: `${XP}/my-pictures.png` },
  music:     { icon: `${XP}/my-music.png` },
  recycle:   { icon: `${XP}/recycle-bin.png`, full: `${XP}/recycle-bin-full.png` },
};
export const isSpecial = (item) => Boolean(item && SPECIAL[item.id]);

// Built-in folders and first shortcuts can't be renamed, moved or deleted, by
// anyone (the server refuses too). The shortcuts stay atop the first column.
export const isFixed = (item) => Boolean(item) && (isSpecial(item) || FIRST_SHORTCUTS.includes(item.id));
export const renamable = (item) => Boolean(item) && !isFixed(item);

// Disk limits. Enforced by server/disk.js, shown by the programs.
export const LIMITS = {
  items: 1000,
  bytes: 200 * 1024 * 1024,   // everything but music
  music: 500 * 1024 * 1024,
  text: 256 * 1024,
  picture: 4 * 1024 * 1024,
  sound: 20 * 1024 * 1024,
  name: 100,
  depth: 8,
};

// Picture and sound types with XP's names for them (and picture icons).
const PICTURES = {
  "image/png":  { name: "PNG Image",    icon: `${XP}/jpg.png` },
  "image/jpeg": { name: "JPEG Image",   icon: `${XP}/jpg.png` },
  "image/gif":  { name: "GIF Image",    icon: `${XP}/gif.png` },
  "image/bmp":  { name: "Bitmap Image", icon: `${XP}/bitmap.png` },
  "image/webp": { name: "WebP Image",   icon: `${XP}/jpg.png` },
};
const SOUNDS = {
  "audio/mpeg": { name: "MP3 Format Sound" },
  "audio/wav":  { name: "Wave Sound" },
  "audio/ogg":  { name: "OGG File" },
  "audio/flac": { name: "FLAC File" },
  "audio/mp4":  { name: "MPEG-4 Audio" },
  "audio/aac":  { name: "AAC File" },
};
// Sound file extensions accepted from the user's computer.
export const SOUND_NAME = /\.(mp3|wav|ogg|oga|flac|m4a|aac)$/i;

export const isFolder = (item) => item?.kind === "folder";
export const isText = (item) => item?.kind === "file" && item.type === TEXT;
export const isPicture = (item) => item?.kind === "file" && Object.hasOwn(PICTURES, item.type);
export const isSound = (item) => item?.kind === "file" && Object.hasOwn(SOUNDS, item.type);
export const isShortcut = (item) => item?.kind === "app";

// The Recycle Bin (folder or shortcut) looks full or empty per binFull.
export function iconOf(item, binFull = false) {
  if (item.id === "recycle" || (isShortcut(item) && findApp(item.type)?.bin)) {
    return binFull ? SPECIAL.recycle.full : SPECIAL.recycle.icon;
  }
  if (isFolder(item)) return SPECIAL[item.id]?.icon ?? `${XP}/folder.png`;
  if (isShortcut(item)) return findApp(item.type)?.icon ?? `${XP}/explorer.png`;
  if (isText(item)) return `${XP}/text-document.png`;
  if (isSound(item)) return `${XP}/audio.png`;
  return PICTURES[item.type]?.icon ?? `${XP}/jpg.png`;
}

// XP's Type column.
export function typeName(item) {
  if (isFolder(item)) return isSpecial(item) ? "System Folder" : "File Folder";
  if (isShortcut(item)) return "Shortcut";
  if (isText(item)) return "Text Document";
  return (PICTURES[item.type] ?? SOUNDS[item.type])?.name ?? "File";
}

// XP's Size column: whole KB, rounded up.
export function sizeText(bytes) {
  return `${Math.ceil(bytes / 1024).toLocaleString("en-US")} KB`;
}

// XP's status bar total, in bytes, KB or MB.
export function bytesText(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 2 : 1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// XP's Date Modified column (11/9/2026 3:45 PM).
export function dateText(ms) {
  return new Date(ms).toLocaleString("en-US", { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// Versioned, so browsers can cache it without ever showing an old version.
export const fileUrl = (item) => `/api/disk/file?id=${encodeURIComponent(item.id)}&v=${item.version}`;

// The { app, rest } that opens an item, like XP. A shortcut opens its app.
export function opener(item) {
  if (isFolder(item)) return { app: "files", rest: `?folder=${item.id}` };
  if (isText(item)) return { app: "notepad", rest: `?id=${item.id}` };
  if (isPicture(item)) return { app: "viewer", rest: `?id=${item.id}` };
  if (isSound(item)) return { app: "media-player", rest: `?id=${item.id}` };
  const app = findApp(item.type);
  if (app?.opens) return { app: app.opens[0], rest: app.opens[1] };
  return { app: item.type, rest: "" };
}

// The app behind a menu's Edit, or null.
export function editor(item) {
  if (isPicture(item)) return { app: "paint", rest: `?id=${item.id}` };
  if (isText(item)) return { app: "notepad", rest: `?id=${item.id}` };
  return null;
}

// Folders first, then by `by`. Names sort like XP's, "File 2" before "File 10".
const byName = new Intl.Collator("en-US", { numeric: true, sensitivity: "base" });
export function sortItems(items, by = "name") {
  const key = {
    name: (a, b) => byName.compare(a.name, b.name),
    size: (a, b) => a.size - b.size || byName.compare(a.name, b.name),
    type: (a, b) => byName.compare(typeName(a), typeName(b)) || byName.compare(a.name, b.name),
    modified: (a, b) => b.modified - a.modified || byName.compare(a.name, b.name),
  }[by];
  return [...items].sort((a, b) => (isFolder(b) - isFolder(a)) || key(a, b));
}

// "notes.txt" -> ["notes", ".txt"]. Rename selects only the first part, like XP.
export function nameParts(name) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

// Characters Windows forbids in names, plus control characters. The server checks this too.
export const BAD_NAME = /[\\/:*?"<>|\u0000-\u001f\u007f]/;
export const NAME_RULE = "A file name can't contain any of the following characters:\n\\ / : * ? \" < > |";
