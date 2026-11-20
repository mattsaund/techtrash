// The desktop page's copy of the shared disk (server/disk.js), metadata only.
// Filled over the socket (js/shared.js). Programs share it as window.top.desktop.disk
// and get "diskchange" events from js/desktop.js. One connection serves them all.
// Changes are HTTP requests. A DiskError's message goes straight into XP's message box.

import { line } from "./shared.js";
import { TEXT, fileUrl } from "./items.js";
import { wallpaperUrl } from "./wallpapers.js";

export class DiskError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const items = new Map();     // by id
const inFolder = new Map();  // folder id -> ids of its children
const gone = new Set();      // deleted ids, so late updates can't bring them back
const watchers = new Set();
let settings = { wallpaper: null, locked: false };
let fromServer = false;
let loaded = false;
// Last settings seen, in localStorage, so the wallpaper shows before the socket
// opens. url is kept because a disk picture can't be resolved until the disk loads.
const SEEN = "techtrash:settings";
try {
  const seen = JSON.parse(localStorage.getItem(SEEN));
  if (seen?.wallpaper) settings = { wallpaper: seen.wallpaper, url: seen.url ?? "", locked: false };
} catch {}
let markReady;
const ready = new Promise((resolve) => { markReady = resolve; });

function notify(change) {
  for (const watcher of watchers) {
    try {
      watcher(change);
    } catch (error) {
      console.error(error);
    }
  }
}

// A change from the socket or a response. The same change can arrive both
// ways, in either order, so older items are skipped and gone stays gone.
function apply({ items: changed = [], gone: removed = [], all = false }) {
  if (all) {
    items.clear();
    inFolder.clear();
  }
  const fresh = [];
  for (const item of changed) {
    const had = items.get(item.id);
    if (gone.has(item.id) || (!all && had && item.modified < had.modified)) continue;
    if (had) inFolder.get(had.parent)?.delete(had.id);
    items.set(item.id, item);
    if (!inFolder.has(item.parent)) inFolder.set(item.parent, new Set());
    inFolder.get(item.parent).add(item.id);
    fresh.push(item);
  }
  for (const id of removed) {
    gone.add(id);
    inFolder.get(items.get(id)?.parent)?.delete(id);
    items.delete(id);
  }
  notify({ items: fresh, gone: removed, all });
  if (all) {
    loaded = true;
    markReady();
  }
}

function changeSettings(next) {
  const image = next.wallpaper?.image ?? "";
  settings = { ...next, url: next.url ?? wallpaperUrl(image, items.get(image.slice(5))) };
  fromServer = true;
  try {
    localStorage.setItem(SEEN, JSON.stringify({ wallpaper: settings.wallpaper, url: settings.url }));
  } catch {}
  notify({ settings });
}

line.on("disk", apply);
line.on("settings", (message) => changeSettings(message.settings));

// One /api/disk/ request. Applies the response's changes at once (other tabs
// get them over the socket). Throws a DiskError with the server's message.
async function call(method, path, body, type) {
  let response;
  try {
    response = await fetch(`/api/disk/${path}`, { method, body, headers: type ? { "content-type": type } : {} });
  } catch {
    throw new DiskError("Can't reach techtrash.org right now. Check your connection, then try again.", 0);
  }
  const answer = await response.json().catch(() => ({}));
  if (!response.ok) throw new DiskError(answer.error ?? "That didn't work. Try again.", response.status);
  if (answer.items || answer.gone) apply(answer);
  if (answer.settings) changeSettings(answer.settings);
  return answer;
}

const send = (method, path, value) => call(method, path, JSON.stringify(value), "application/json");
const query = (params) => new URLSearchParams(params).toString();

// A file's bytes, as a Response.
async function fetchFile(item) {
  let response;
  try {
    response = await fetch(fileUrl(item));
  } catch {
    throw new DiskError("Can't reach techtrash.org right now. Check your connection, then try again.", 0);
  }
  if (!response.ok) throw new DiskError((await response.json().catch(() => ({}))).error ?? "That file can't be opened.", response.status);
  return response;
}

export const disk = {
  // Resolves once the whole disk is here. loaded() is the sync check.
  ready,
  loaded: () => loaded,
  // True in the admin's tab. Kept current by js/desktop.js.
  admin: false,

  // --- reading -------------------------------------------------------------
  item: (id) => items.get(id) ?? null,
  all: () => [...items.values()],
  children: (folder) => [...(inFolder.get(folder) ?? [])].map((id) => items.get(id)),
  // An item and the folders it's in, outermost first.
  path(id) {
    const chain = [];
    for (let item = items.get(id); item && chain.length < 32; item = items.get(item.parent)) chain.unshift(item);
    return chain;
  },
  // In the Recycle Bin, directly or nested.
  inBin(id) {
    for (let item = items.get(id), steps = 0; item && steps < 32; item = items.get(item.parent), steps++) {
      if (item.parent === "recycle") return true;
    }
    return false;
  },
  binFull: () => (inFolder.get("recycle")?.size ?? 0) > 0,
  settings: () => settings,
  // Settings over HTTP, without opening the socket. The server resolves url
  // for a disk picture. The socket's settings win once it connects.
  async peek() {
    if (fromServer) return;
    try {
      const response = await fetch("/api/disk/settings");
      const answer = await response.json();
      if (response.ok && answer.settings && !fromServer) changeSettings({ ...answer.settings, url: answer.url });
    } catch {}
  },
  // fn(change) gets { items, gone, all } or { settings }. Returns an unsubscribe.
  watch(fn) {
    watchers.add(fn);
    return () => watchers.delete(fn);
  },
  text: async (item) => (await fetchFile(item)).text(),
  blob: async (item) => (await fetchFile(item)).blob(),

  // --- changing ------------------------------------------------------------
  // Each resolves to the updated item (nothing for what's gone).
  makeFolder: async (parent, name) => (await send("POST", "folder", { parent, name })).items[0],
  // app is an id from js/apps.js.
  makeShortcut: async (parent, app) => (await send("POST", "shortcut", { parent, type: app })).items[0],
  // kind is "text", "picture" or "sound", and data is a string or a Blob.
  makeFile: async (parent, name, data, kind = "text") =>
    (await call("POST", `file?${query({ parent, name, type: kind })}`, data, kind === "text" ? `${TEXT}; charset=utf-8` : "application/octet-stream")).items[0],
  save: async (id, data) => (await call("PUT", `file?${query({ id })}`, data, "application/octet-stream")).items[0],
  rename: async (id, name) => (await send("PATCH", `item?${query({ id })}`, { name })).items[0] ?? items.get(id),
  move: async (id, parent) => (await send("PATCH", `item?${query({ id })}`, { parent })).items[0] ?? items.get(id),
  // To the Recycle Bin. Permanent if already in it, or with forGood (admin only).
  remove: (id, forGood = false) => call("DELETE", `item?${query({ id })}${forGood ? "&for-good" : ""}`),
  restore: async (id) => (await call("POST", `restore?${query({ id })}`)).items[0],
  empty: () => call("POST", "empty"),
  setWallpaper: (wallpaper) => send("PUT", "wallpaper", wallpaper),

  // --- admin only ----------------------------------------------------------
  overview: () => call("GET", "admin"),
  activity: (before) => call("GET", before ? `admin/activity?${query({ before })}` : "admin/activity"),
  lock: (locked) => send("PUT", "admin/lock", { locked }),
  block: (visitor, blocked) => send("PUT", "admin/block", { visitor, blocked }),
};
