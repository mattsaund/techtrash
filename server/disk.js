// The shared computer's disk. Everyone on the site shares one XP desktop and
// one disk, so whatever anyone saves is there for everyone. Anyone can open
// it, rename it, move it, throw it away or take it back out of the Recycle
// Bin. The wallpaper is everyone's too.
//
// A few things are held back. Nobody can rename, move or delete the folders
// the desktop is built on, or rename its first shortcuts. Only the admin can
// move the blog's shortcut and the Recycle Bin, delete the blog's, or add and
// change music. The admin can also lock the desktop, keep a visitor out, and
// see everything that's been done (programs/admin/).
//
// It all lives in the shared desktop's Durable Object (server/desktop.js), in
// four tables. items has every folder, file and shortcut, without its bytes.
// chunks has the bytes, in rows of 2 MB. settings has the wallpaper, the lock
// and who's kept out. activity is what's been done and by whom.
//
// Who did something is a visitor's tag, their internet address scrambled with
// a key only the server has (server/admin.js). The admin's is "admin".

import { FIRST_SHORTCUTS, findApp } from "../public/js/apps.js";
import { BAD_NAME, LIMITS, TEXT, isPicture, isSound } from "../public/js/items.js";
import { FIRST_WALLPAPER, POSITIONS, findWallpaper } from "../public/js/wallpapers.js";
import { mediaType } from "./media.js";

export { TEXT };

// Thrown for anything that can't be done, with its status and the words for it.
export class DiskError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const refuse = (status, message) => { throw new DiskError(status, message); };

// The folders the desktop is built on. They're always there, as they are.
const FOLDERS = [
  { id: "desktop", name: "Desktop", parent: null },
  { id: "documents", name: "My Documents", parent: null },
  { id: "pictures", name: "My Pictures", parent: "documents" },
  { id: "music", name: "My Music", parent: "documents" },
  { id: "recycle", name: "Recycle Bin", parent: null },
];
const FOLDER_IDS = new Set(FOLDERS.map((folder) => folder.id));

// Only the admin can move these, or throw the blog's away. The Recycle Bin
// never goes in the bin, not even the admin's.
const ADMINS_ONLY = new Set(["recycle-bin", "blog"]);

// A row holds 8 MB at most, so a file's bytes are kept in smaller pieces.
const CHUNK = 2 * 1024 * 1024;

// The newest this many things done are kept for the Admin Dashboard.
const ACTIVITY = 2000;

const BAD_NAME_TEXT = "A name can't be empty, longer than 100 characters, or have any of \\ / : * ? \" < > | in it.";

// Everything inside a folder, however deep, and the folder itself.
const INSIDE = "WITH RECURSIVE inside(id) AS (SELECT ? UNION SELECT items.id FROM items JOIN inside ON items.parent = inside.id)";

// A name as the disk keeps it, with no spaces or dots on the end. Null if
// nothing's left, it's too long, or it has a character Windows didn't allow.
function cleanName(value) {
  const name = String(value ?? "").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  return name && name.length <= LIMITS.name && !BAD_NAME.test(name) ? name : null;
}

// "Untitled.txt", then "Untitled (2).txt", "Untitled (3).txt" and so on.
function numbered(name, n) {
  if (n === 1) return name;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
}

const COLUMNS = "id, parent, name, kind, type, size, version, made_by, created, modified, was_in";

// An item as the pages get it.
const shown = (row) => row && {
  id: row.id,
  parent: row.parent,
  name: row.name,
  kind: row.kind,
  type: row.type,
  size: row.size,
  version: row.version,
  madeBy: row.made_by,
  created: row.created,
  modified: row.modified,
  wasIn: row.was_in,
};

export class Disk {
  // sql is the object's ctx.storage.sql. transaction(fn) runs fn all at
  // once or not at all.
  constructor(sql, transaction) {
    this.sql = sql;
    this.transaction = transaction;
    this.install();
  }

  // --- the tables ---------------------------------------------------------------

  // The folders are put back if they're ever missing. The first shortcuts
  // and the wallpaper are only put there the very first time, and after that
  // they're everyone's to change.
  install() {
    const { sql } = this;
    sql.exec(`CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      parent TEXT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1,
      made_by TEXT NOT NULL DEFAULT 'system',
      created INTEGER NOT NULL,
      modified INTEGER NOT NULL,
      was_in TEXT
    )`);
    sql.exec("CREATE INDEX IF NOT EXISTS items_by_parent ON items (parent)");
    sql.exec("CREATE TABLE IF NOT EXISTS chunks (id TEXT NOT NULL, n INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (id, n))");
    sql.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    sql.exec(`CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      who TEXT NOT NULL,
      what TEXT NOT NULL,
      item TEXT,
      name TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT ''
    )`);
    const now = Date.now();
    for (const folder of FOLDERS) {
      sql.exec("INSERT OR IGNORE INTO items (id, parent, name, kind, created, modified) VALUES (?, ?, ?, 'folder', ?, ?)",
        folder.id, folder.parent, folder.name, now, now);
    }
    if (!this.setting("installed")) {
      for (const id of FIRST_SHORTCUTS) {
        sql.exec("INSERT OR IGNORE INTO items (id, parent, name, kind, type, created, modified) VALUES (?, 'desktop', ?, 'app', ?, ?, ?)",
          id, findApp(id).title, id, now, now);
      }
      this.setSetting("wallpaper", FIRST_WALLPAPER);
      this.setSetting("installed", true);
    }
  }

  setting(key, fallback = null) {
    const row = this.sql.exec("SELECT value FROM settings WHERE key = ?", key).toArray()[0];
    return row ? JSON.parse(row.value) : fallback;
  }

  setSetting(key, value) {
    this.sql.exec("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      key, JSON.stringify(value));
  }

  // --- reading ------------------------------------------------------------------

  // Every item on the disk, for a tab as it connects.
  list() {
    return this.sql.exec(`SELECT ${COLUMNS} FROM items`).toArray().map(shown);
  }

  row(id) {
    return this.sql.exec(`SELECT ${COLUMNS} FROM items WHERE id = ?`, String(id ?? "")).toArray()[0] ?? null;
  }

  item(id) {
    return shown(this.row(id));
  }

  existing(id) {
    return this.row(id) ?? refuse(404, "That isn't here anymore. Someone may have moved it or thrown it away.");
  }

  // A file, to send its bytes.
  file(id) {
    const row = this.existing(id);
    if (row.kind !== "file") refuse(400, "Only a file can be opened that way.");
    return shown(row);
  }

  // A file's bytes from start to end (end included). They're read a piece at
  // a time as they go out, so a long song never sits in memory all at once.
  stream(id, start, end) {
    const { readable, writable } = new FixedLengthStream(end - start + 1);
    const writer = writable.getWriter();
    (async () => {
      for (let n = Math.floor(start / CHUNK); n <= Math.floor(end / CHUNK); n++) {
        const row = this.sql.exec("SELECT data FROM chunks WHERE id = ? AND n = ?", id, n).toArray()[0];
        if (!row) throw new Error("the file went while it was being sent");
        await writer.write(new Uint8Array(row.data).subarray(Math.max(0, start - n * CHUNK), end - n * CHUNK + 1));
      }
      await writer.close();
    })().catch((error) => writer.abort(error));
    return readable;
  }

  // What everyone sees of the desktop's settings.
  settings() {
    return { wallpaper: this.setting("wallpaper", FIRST_WALLPAPER), locked: Boolean(this.setting("locked", false)) };
  }

  // --- the rules ----------------------------------------------------------------

  // The admin can always change things. A visitor can unless the desktop is
  // locked or they've been kept out.
  mayChange(who) {
    if (who === "admin") return;
    if (this.setting("locked", false)) refuse(423, "The desktop is locked right now. Only the admin can change things on it.");
    if (this.setting("blocked", []).includes(who)) refuse(403, "You can't change things on this desktop.");
  }

  // What stays put. verb is what was tried, for XP's own words, like
  // "Cannot delete My Documents: Permission Denied."
  mayTouch(row, who, verb) {
    const denied = FOLDER_IDS.has(row.id)
      || (verb === "rename" && FIRST_SHORTCUTS.includes(row.id))
      || (who !== "admin" && ADMINS_ONLY.has(row.id));
    if (denied) refuse(403, `Cannot ${verb} ${row.name}: Permission Denied.`);
    if (who !== "admin" && this.holdsSound(row)) {
      refuse(403, `Cannot ${verb} ${row.name}: Permission Denied. Only the admin can change music and sounds.`);
    }
  }

  // Is it a sound, or a folder with one somewhere inside?
  holdsSound(row) {
    if (row.kind !== "folder") return isSound(row);
    return this.sql.exec(`${INSIDE} SELECT 1 FROM items WHERE id IN inside AND type LIKE 'audio/%' LIMIT 1`, row.id).toArray().length > 0;
  }

  // A folder something can go into.
  folder(id) {
    const row = this.existing(id);
    if (row.kind !== "folder") refuse(400, "That isn't a folder.");
    if (row.id === "recycle") refuse(400, "Things go in the Recycle Bin by being thrown away.");
    if (this.inBin(row.id)) refuse(400, "That folder is in the Recycle Bin. Take it out first.");
    return row;
  }

  // Is this item in the Recycle Bin, or in a folder that is?
  inBin(id) {
    for (let row = this.row(id), steps = 0; row && steps <= LIMITS.depth + 2; row = this.row(row.parent), steps++) {
      if (row.parent === "recycle") return true;
    }
    return false;
  }

  depth(id) {
    let depth = 0;
    for (let row = this.row(id); row?.parent; row = this.row(row.parent)) depth++;
    return depth;
  }

  // Is the folder `id` the folder `folderId`, or somewhere above it? A folder
  // can't go inside itself.
  contains(id, folderId) {
    for (let row = this.row(folderId); row; row = this.row(row.parent)) {
      if (row.id === id) return true;
    }
    return false;
  }

  // The name `name` would get in `parent`. It gets a number if something
  // there already has it, ignoring case. The Recycle Bin can hold two of a
  // name, as XP's could.
  freeName(parent, name, except = "") {
    if (parent === "recycle") return name;
    for (let n = 1; ; n++) {
      const candidate = numbered(name, n);
      const taken = this.sql.exec("SELECT 1 FROM items WHERE parent = ? AND lower(name) = lower(?) AND id != ?", parent, candidate, except).toArray().length;
      if (!taken) return candidate;
    }
  }

  // Is there room for this many more bytes, and one more item? Music has a
  // share of its own.
  room(bytes, { newItem = true, sound = false } = {}) {
    const used = this.sql.exec(`SELECT COUNT(*) AS count,
      COALESCE(SUM(CASE WHEN type LIKE 'audio/%' THEN size ELSE 0 END), 0) AS music,
      COALESCE(SUM(CASE WHEN type LIKE 'audio/%' THEN 0 ELSE size END), 0) AS rest FROM items`).toArray()[0];
    if (newItem && used.count >= LIMITS.items) refuse(507, "The disk is full. It holds 1,000 things at most, so throw some away and empty the Recycle Bin first.");
    if (sound && used.music + bytes > LIMITS.music) refuse(507, "There's no room for more music (500 MB at most). Delete some first.");
    if (!sound && used.rest + bytes > LIMITS.bytes) refuse(507, "The disk is full. Throw some things away and empty the Recycle Bin first.");
  }

  // The bytes a file is written with, checked against what it's meant to be.
  // Text can be anything, since it's only ever shown as text.
  content(data, as) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data ?? new ArrayBuffer(0));
    if (as === "text") {
      if (bytes.length > LIMITS.text) refuse(413, "That's too long for Notepad here (256 KB at most).");
      return { bytes, type: TEXT };
    }
    const file = { kind: "file", type: mediaType(bytes)?.type };
    if (as === "picture") {
      if (!isPicture(file)) refuse(415, "A picture has to be a PNG, JPEG, GIF, BMP or WebP.");
      if (bytes.length > LIMITS.picture) refuse(413, "That picture is too big (4 MB at most).");
    } else if (as === "sound") {
      if (!isSound(file)) refuse(415, "A sound has to be an MP3, WAV, OGG, FLAC, M4A or AAC file.");
      if (bytes.length > LIMITS.sound) refuse(413, "That sound is too big (20 MB at most).");
    } else {
      refuse(400, "That isn't something the disk can hold.");
    }
    return { bytes, type: file.type };
  }

  // A file's bytes, in pieces, in place of whatever it had.
  store(id, bytes) {
    this.sql.exec("DELETE FROM chunks WHERE id = ?", id);
    for (let n = 0; n * CHUNK < bytes.length; n++) {
      this.sql.exec("INSERT INTO chunks (id, n, data) VALUES (?, ?, ?)", id, n, bytes.slice(n * CHUNK, (n + 1) * CHUNK));
    }
  }

  log(who, what, row, detail = "") {
    this.sql.exec("INSERT INTO activity (at, who, what, item, name, detail) VALUES (?, ?, ?, ?, ?, ?)",
      Date.now(), who, what, row?.id ?? null, row?.name ?? "", detail);
    this.sql.exec("DELETE FROM activity WHERE id <= (SELECT MAX(id) FROM activity) - ?", ACTIVITY);
  }

  // Where an item is, as a path like "My Documents\My Pictures".
  path(id) {
    const names = [];
    for (let row = this.row(id); row; row = this.row(row.parent)) names.unshift(row.name);
    return names.join("\\");
  }

  // --- changing things ----------------------------------------------------------
  //
  // Each gives back what changed for everyone, as { items } (as they are now)
  // and { gone } (ids no longer on the disk at all).

  // A new folder, file or shortcut. For a file, type is what it's meant to be
  // ("text", "picture" or "sound"). For a shortcut, it's the app's id.
  create(who, { parent, name, kind = "file", type = "text", data }) {
    this.mayChange(who);
    const folder = this.folder(parent);
    if (this.depth(folder.id) + 1 > LIMITS.depth) refuse(400, "Folders can't go that deep here.");
    const clean = cleanName(name) ?? refuse(400, BAD_NAME_TEXT);
    let content = null;
    if (kind === "file") {
      if (type === "sound" && who !== "admin") refuse(403, "Only the admin can add music and sounds.");
      content = this.content(data, type);
    } else if (kind === "app") {
      if (!findApp(type)) refuse(400, "There's no program like that.");
    } else if (kind !== "folder") {
      refuse(400, "That isn't something the disk can hold.");
    }
    this.room(content?.bytes.length ?? 0, { sound: type === "sound" });
    const now = Date.now();
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const finalName = this.freeName(folder.id, clean);
    this.transaction(() => {
      this.sql.exec("INSERT INTO items (id, parent, name, kind, type, size, made_by, created, modified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id, folder.id, finalName, kind, content?.type ?? (kind === "app" ? type : ""), content?.bytes.length ?? 0, who, now, now);
      if (content) this.store(id, content.bytes);
      this.log(who, "made", { id, name: finalName }, this.path(folder.id));
    });
    return { items: [this.item(id)] };
  }

  // A file written again, from Notepad's or Paint's Save.
  write(who, id, data) {
    this.mayChange(who);
    const row = this.existing(id);
    if (row.kind !== "file" || isSound(row)) refuse(400, "That file can't be saved over.");
    if (this.inBin(row.id)) refuse(400, "That file is in the Recycle Bin. Take it out to save to it.");
    const content = this.content(data, row.type === TEXT ? "text" : "picture");
    this.room(content.bytes.length - row.size, { newItem: false });
    this.transaction(() => {
      this.sql.exec("UPDATE items SET size = ?, type = ?, version = version + 1, modified = ? WHERE id = ?",
        content.bytes.length, content.type, Date.now(), row.id);
      this.store(row.id, content.bytes);
      this.log(who, "changed", row);
    });
    return { items: [this.item(row.id)] };
  }

  rename(who, id, name) {
    this.mayChange(who);
    const row = this.existing(id);
    this.mayTouch(row, who, "rename");
    const clean = cleanName(name) ?? refuse(400, BAD_NAME_TEXT);
    if (clean === row.name) return { items: [] };
    if (row.parent !== "recycle" && this.freeName(row.parent, clean, row.id) !== clean) {
      refuse(409, `Cannot rename ${row.name}: A file with the name you specified already exists. Specify a different file name.`);
    }
    this.transaction(() => {
      this.sql.exec("UPDATE items SET name = ?, modified = ? WHERE id = ?", clean, Date.now(), row.id);
      this.log(who, "renamed", { id: row.id, name: clean }, `from ${row.name}`);
    });
    return { items: [this.item(row.id)] };
  }

  move(who, id, parent) {
    this.mayChange(who);
    const row = this.existing(id);
    this.mayTouch(row, who, "move");
    const folder = this.folder(parent);
    if (folder.id === row.parent) return { items: [] };
    if (row.kind === "folder" && this.contains(row.id, folder.id)) refuse(400, `Cannot move ${row.name}: The destination folder is inside it.`);
    const name = this.freeName(folder.id, row.name, row.id);
    this.transaction(() => {
      this.sql.exec("UPDATE items SET parent = ?, name = ?, modified = ? WHERE id = ?", folder.id, name, Date.now(), row.id);
      this.log(who, "moved", row, `to ${this.path(folder.id)}`);
    });
    return { items: [this.item(row.id)] };
  }

  // Into the Recycle Bin, remembering where from. If it's in the bin already,
  // or the admin says so, it's gone for good with everything inside it.
  remove(who, id, forGood = false) {
    this.mayChange(who);
    const row = this.existing(id);
    this.mayTouch(row, who, "delete");
    if (row.id === "recycle-bin") refuse(403, "The Recycle Bin can't go in itself.");
    if (row.parent === "recycle" || this.inBin(row.id) || (forGood && who === "admin")) {
      return { gone: this.purge(who, [row]) };
    }
    this.transaction(() => {
      this.sql.exec("UPDATE items SET parent = 'recycle', was_in = ?, modified = ? WHERE id = ?", row.parent, Date.now(), row.id);
      this.log(who, "threw away", row, `from ${this.path(row.parent)}`);
    });
    return { items: [this.item(row.id)] };
  }

  // Out of the Recycle Bin and back where it was, or to the desktop if that
  // folder's gone. Its name gets a number if something there has it now.
  restore(who, id) {
    this.mayChange(who);
    const row = this.existing(id);
    if (row.parent !== "recycle") refuse(400, `${row.name} isn't in the Recycle Bin.`);
    const was = row.was_in && this.row(row.was_in);
    const back = was?.kind === "folder" && !this.inBin(was.id) ? was.id : "desktop";
    const name = this.freeName(back, row.name, row.id);
    this.transaction(() => {
      this.sql.exec("UPDATE items SET parent = ?, name = ?, was_in = NULL, modified = ? WHERE id = ?", back, name, Date.now(), row.id);
      this.log(who, "took back", { id: row.id, name }, `to ${this.path(back)}`);
    });
    return { items: [this.item(row.id)] };
  }

  // Everything in the Recycle Bin, gone for good.
  empty(who) {
    this.mayChange(who);
    const rows = this.sql.exec(`SELECT ${COLUMNS} FROM items WHERE parent = 'recycle'`).toArray();
    return { gone: this.purge(who, rows, `emptied the Recycle Bin (${rows.length} thing${rows.length === 1 ? "" : "s"})`) };
  }

  // These and everything inside them, off the disk. Gives back their ids.
  purge(who, rows, summary = null) {
    const ids = rows.flatMap((row) => this.sql.exec(`${INSIDE} SELECT id FROM inside`, row.id).toArray().map((one) => one.id));
    this.transaction(() => {
      for (const id of ids) {
        this.sql.exec("DELETE FROM chunks WHERE id = ?", id);
        this.sql.exec("DELETE FROM items WHERE id = ?", id);
      }
      if (summary) this.log(who, summary, null);
      else for (const row of rows) this.log(who, "deleted for good", row);
    });
    return ids;
  }

  // The wallpaper, for everyone. One of XP's, a picture on the disk, or none.
  setWallpaper(who, value) {
    this.mayChange(who);
    const image = String(value?.image ?? "");
    const position = POSITIONS.includes(value?.position) ? value.position : "stretch";
    const color = /^#[0-9a-f]{6}$/i.test(value?.color ?? "") ? value.color.toLowerCase() : "";
    let named = "none";
    if (image.startsWith("xp:")) named = findWallpaper(image.slice(3))?.name ?? refuse(400, "There's no wallpaper like that.");
    else if (image.startsWith("file:")) {
      const row = this.existing(image.slice(5));
      if (!isPicture(row)) refuse(400, "Only a picture can be a wallpaper.");
      named = row.name;
    } else if (image) refuse(400, "There's no wallpaper like that.");
    this.transaction(() => {
      this.setSetting("wallpaper", { image, position, color });
      this.log(who, "changed the wallpaper", null, `to ${named}, ${position}`);
    });
    return this.settings();
  }

  // --- the admin's --------------------------------------------------------------

  setLocked(locked) {
    this.transaction(() => {
      this.setSetting("locked", Boolean(locked));
      this.log("admin", locked ? "locked the desktop" : "unlocked the desktop", null);
    });
    return this.settings();
  }

  // Keeps a visitor from changing anything, or lets them again.
  setBlocked(visitor, blocked) {
    const tag = String(visitor ?? "");
    if (!/^[0-9a-f]{8,16}$/.test(tag)) refuse(400, "That isn't a visitor's tag.");
    const list = new Set(this.setting("blocked", []));
    if (blocked) list.add(tag);
    else list.delete(tag);
    this.transaction(() => {
      this.setSetting("blocked", [...list]);
      this.log("admin", blocked ? "kept a visitor out" : "let a visitor back in", null, tag);
    });
    return [...list];
  }

  // What's been done, newest first. `before` is an entry's id, for more.
  activity(before = null, count = 200) {
    return before
      ? this.sql.exec("SELECT * FROM activity WHERE id < ? ORDER BY id DESC LIMIT ?", Number(before), count).toArray()
      : this.sql.exec("SELECT * FROM activity ORDER BY id DESC LIMIT ?", count).toArray();
  }

  // Everything people have made, with where it is, for the dashboard.
  everything() {
    return this.list().filter((item) => !FOLDER_IDS.has(item.id)).map((item) => ({ ...item, path: this.path(item.parent) }));
  }

  blocked() {
    return this.setting("blocked", []);
  }
}
