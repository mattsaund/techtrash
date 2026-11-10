// How the desktop and its programs show what's on the shared disk: an item's
// icon, its type, its size and dates, and which program opens it. Nothing is
// kept here. The disk itself is js/disk.js, in the desktop's page.
//
// Every folder, file and shortcut on the disk (server/disk.js) is an item,
// { id, parent, name, kind, type, size, version, madeBy, created, modified,
// wasIn }. kind is "folder", "file" or "app" (a shortcut, whose type is its
// app's id). A file's type is its media type, like text/plain, image/png or
// audio/mpeg.

import { FIRST_SHORTCUTS, findApp } from "./apps.js";

const XP = "/img/icons/xp";

export const TEXT = "text/plain";

// The drag data type for items dragged out of a File Browser, to another one
// or the desktop. The data is the items' ids, as JSON.
export const DRAGGED = "application/x-techtrash-items";

// The folders the desktop is built on (server/disk.js), and their icons.
export const SPECIAL = {
  desktop:   { icon: `${XP}/desktop.png` },
  documents: { icon: `${XP}/my-documents.png` },
  pictures:  { icon: `${XP}/my-pictures.png` },
  music:     { icon: `${XP}/my-music.png` },
  recycle:   { icon: `${XP}/recycle-bin.png`, full: `${XP}/recycle-bin-full.png` },
};
export const isSpecial = (item) => Boolean(item && SPECIAL[item.id]);

// Only what people made can be renamed. The desktop's own folders and
// shortcuts keep their names, and the server says no to that too.
export const renamable = (item) => Boolean(item) && !isSpecial(item) && !FIRST_SHORTCUTS.includes(item.id);

// How much the disk holds and how big things can be. The server enforces
// these (server/disk.js) and the programs show them.
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

// Each kind of picture and sound, by its type, with what XP called it (and a
// picture's icon).
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
// The extensions a sound from your computer can have.
export const SOUND_NAME = /\.(mp3|wav|ogg|oga|flac|m4a|aac)$/i;

export const isFolder = (item) => item?.kind === "folder";
export const isText = (item) => item?.kind === "file" && item.type === TEXT;
export const isPicture = (item) => item?.kind === "file" && Object.hasOwn(PICTURES, item.type);
export const isSound = (item) => item?.kind === "file" && Object.hasOwn(SOUNDS, item.type);
export const isShortcut = (item) => item?.kind === "app";

// An item's icon. The Recycle Bin (the folder or its shortcut) looks full or
// empty, going by binFull.
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

// What kind of thing it is, as XP's Type column put it.
export function typeName(item) {
  if (isFolder(item)) return isSpecial(item) ? "System Folder" : "File Folder";
  if (isShortcut(item)) return "Shortcut";
  if (isText(item)) return "Text Document";
  return (PICTURES[item.type] ?? SOUNDS[item.type])?.name ?? "File";
}

// A size as XP's Size column put it, in whole KB, rounded up.
export function sizeText(bytes) {
  return `${Math.ceil(bytes / 1024).toLocaleString("en-US")} KB`;
}

// A total as XP's status bar put it, in bytes, KB or MB.
export function bytesText(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 2 : 1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// A date and time as XP's Date Modified column put it (11/9/2026 3:45 PM).
export function dateText(ms) {
  return new Date(ms).toLocaleString("en-US", { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// Where a file's bytes are. Each version has its own address, so a browser
// can cache it and still never show an old one.
export const fileUrl = (item) => `/api/disk/file?id=${encodeURIComponent(item.id)}&v=${item.version}`;

// Which app opens an item, and where in that app, as { app, rest }. Like XP,
// folders open in the File Browser, text in Notepad, pictures in the Picture
// and Fax Viewer and sounds in Windows Media Player. A shortcut opens its app.
export function opener(item) {
  if (isFolder(item)) return { app: "files", rest: `?folder=${item.id}` };
  if (isText(item)) return { app: "notepad", rest: `?id=${item.id}` };
  if (isPicture(item)) return { app: "viewer", rest: `?id=${item.id}` };
  if (isSound(item)) return { app: "media-player", rest: `?id=${item.id}` };
  const app = findApp(item.type);
  if (app?.opens) return { app: app.opens[0], rest: app.opens[1] };
  return { app: item.type, rest: "" };
}

// The app behind a menu's Edit. Paint for a picture, Notepad for text, null
// for anything else.
export function editor(item) {
  if (isPicture(item)) return { app: "paint", rest: `?id=${item.id}` };
  if (isText(item)) return { app: "notepad", rest: `?id=${item.id}` };
  return null;
}

// Folders first, then by `by` (name by default). Names sort the way XP
// sorted them, "File 2" before "File 10".
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

// A name in two, so "notes.txt" is ["notes", ".txt"]. Renaming selects only
// the first part, like XP.
export function nameParts(name) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

// What Windows didn't allow in a name (\ / : * ? " < > |), plus control
// characters. The server checks this too.
export const BAD_NAME = /[\\/:*?"<>|\u0000-\u001f\u007f]/;
export const NAME_RULE = "A file name can't contain any of the following characters:\n\\ / : * ? \" < > |";
