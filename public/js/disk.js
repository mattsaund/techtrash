// The desktop page's copy of the shared disk (server/disk.js), minus the
// files' bytes. The whole disk comes down the line when it connects
// (js/shared.js), then every change anyone makes. Programs use this same copy
// as window.top.desktop.disk, so one connection serves them all. They hear
// about changes through a "diskchange" event on their own window (sent by
// js/desktop.js), and the desktop's own parts use disk.watch.
//
// Every change is a request to the server. If it says no (the desktop is
// locked, or the change isn't allowed), the DiskError's message goes straight
// into XP's message box. The answer carries what changed, so whoever made the
// change sees it at once, and everyone else gets it down the line.

import { line } from "./shared.js";
import { TEXT, fileUrl } from "./items.js";

export class DiskError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const items = new Map();     // every item, by id
const inFolder = new Map();  // folder id to the ids of what's in it
const gone = new Set();      // ids that are gone for good
const watchers = new Set();
let settings = { wallpaper: null, locked: false };
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

// A change from the server, down the line or in a request's answer. The same
// change can arrive both ways, in either order, so an item older than the
// one already here is skipped, and anything gone stays gone.
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
  if (all) markReady();
}

function changeSettings(next) {
  settings = next;
  notify({ settings });
}

line.on("disk", apply);
line.on("settings", (message) => changeSettings(message.settings));

// One request to /api/disk/. Resolves to the answer, or throws a DiskError
// with the server's words for what went wrong.
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
  // Settles once the whole disk is here.
  ready,
  // Whether this tab is the admin's (js/desktop.js keeps it up to date).
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
  // Is it in the Recycle Bin, or in a folder that is?
  inBin(id) {
    for (let item = items.get(id), steps = 0; item && steps < 32; item = items.get(item.parent), steps++) {
      if (item.parent === "recycle") return true;
    }
    return false;
  },
  binFull: () => (inFolder.get("recycle")?.size ?? 0) > 0,
  settings: () => settings,
  // Calls fn(change) on every change, with { items, gone, all } or
  // { settings }. Gives back a function that stops it.
  watch(fn) {
    watchers.add(fn);
    return () => watchers.delete(fn);
  },
  text: async (item) => (await fetchFile(item)).text(),
  blob: async (item) => (await fetchFile(item)).blob(),

  // --- changing ------------------------------------------------------------
  // Each gives back the item as it is now (or nothing, for what's gone).
  makeFolder: async (parent, name) => (await send("POST", "folder", { parent, name })).items[0],
  // A shortcut to an app, by its id (js/apps.js).
  makeShortcut: async (parent, app) => (await send("POST", "shortcut", { parent, type: app })).items[0],
  // kind is "text", "picture" or "sound", and data is a string or a Blob.
  makeFile: async (parent, name, data, kind = "text") =>
    (await call("POST", `file?${query({ parent, name, type: kind })}`, data, kind === "text" ? `${TEXT}; charset=utf-8` : "application/octet-stream")).items[0],
  save: async (id, data) => (await call("PUT", `file?${query({ id })}`, data, "application/octet-stream")).items[0],
  rename: async (id, name) => (await send("PATCH", `item?${query({ id })}`, { name })).items[0] ?? items.get(id),
  move: async (id, parent) => (await send("PATCH", `item?${query({ id })}`, { parent })).items[0] ?? items.get(id),
  // Into the Recycle Bin. Something already in the bin is deleted for good,
  // and so is anything the admin deletes with forGood.
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
