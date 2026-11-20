// XP's File and Folder Tasks, shared by the desktop icons and the File Browser.
// XP's questions and errors show in the calling page, over the window that asked.

import { BAD_NAME, NAME_RULE, SOUND_NAME, isFixed, isFolder } from "./items.js";
import { showMessage } from "./message.js";

export const disk = () => window.top.desktop.disk;

const one = (items) => items.length === 1;
const quoted = (item) => `'${item.name}'`;

// Error box with the server's message.
export function complain(title, error) {
  return showMessage({ title, text: error.message ?? String(error) });
}

// XP's error for a fixed item (js/items.js isFixed), worded like the server's.
// verb is "delete" or "move".
export function refuseFixed(item, verb) {
  const title = `Error ${verb === "delete" ? "Deleting" : "Moving"} ${isFolder(item) ? "Folder" : "File or Folder"}`;
  return showMessage({ title, text: `Cannot ${verb} ${item.name}: Permission Denied.` });
}

// Asks, then sends to the Recycle Bin. From the bin, or with the admin's
// Shift+Delete, it's for good and asks differently. Fixed items get XP's error.
export async function deleteItems(items, { forGood = false } = {}) {
  items = items.filter(Boolean);
  const loose = items.filter(movable);
  if (!items.length) return false;
  if (loose.length) {
    const gone = forGood || loose.every((item) => disk().inBin(item.id));
    const what = one(loose) ? (isFolder(loose[0]) ? "Folder" : "File") : "Multiple File";
    const text = gone
      ? (one(loose) ? `Are you sure you want to delete ${quoted(loose[0])}?` : `Are you sure you want to delete these ${loose.length} items?`)
      : (one(loose) ? `Are you sure you want to send ${quoted(loose[0])} to the Recycle Bin?` : `Are you sure you want to send these ${loose.length} items to the Recycle Bin?`);
    const answer = await showMessage({ title: `Confirm ${what} Delete`, text, icon: "delete", buttons: ["Yes", "No"] });
    if (answer !== "Yes") return false;
  }
  return throwAway(items, { forGood });
}

// No question, for drops on the Recycle Bin.
export async function throwAway(items, { forGood = false } = {}) {
  let ok = true;
  let refused = false;
  for (const item of items) {
    if (!movable(item)) {
      ok = false;
      if (!refused) await refuseFixed(item, "delete");
      refused = true;
      continue;
    }
    try {
      await disk().remove(item.id, forGood);
    } catch (error) {
      ok = false;
      await complain(`Error Deleting ${isFolder(item) ? "Folder" : "File or Folder"}`, error);
      // Locked (423) or rate limited (429): the rest would fail too.
      if (error.status === 423 || error.status === 429) break;
    }
  }
  return ok;
}

// Bad characters get XP's rule. Server refusals (a name taken) get its message.
export async function renameItem(item, name) {
  name = name.replace(/\s+/g, " ").trim();
  if (!name || name === item.name) return true;
  if (BAD_NAME.test(name)) {
    await showMessage({ title: "Rename", text: NAME_RULE });
    return false;
  }
  try {
    await disk().rename(item.id, name);
    return true;
  } catch (error) {
    await complain(`Error Renaming ${isFolder(item) ? "Folder" : "File or Folder"}`, error);
    return false;
  }
}

// Skips the folder itself and what's already in it. Fixed items get XP's error.
export async function moveItems(items, folderId) {
  let refused = false;
  for (const item of items) {
    if (item.id === folderId || item.parent === folderId) continue;
    if (!movable(item)) {
      if (!refused) await refuseFixed(item, "move");
      refused = true;
      continue;
    }
    try {
      await disk().move(item.id, folderId);
    } catch (error) {
      await complain(`Error Moving ${isFolder(item) ? "Folder" : "File or Folder"}`, error);
      if (error.status === 423 || error.status === 429) return false;
    }
  }
  return true;
}

// Back to each item's original folder.
export async function restoreItems(items) {
  for (const item of items) {
    try {
      await disk().restore(item.id);
    } catch (error) {
      await complain("Error Restoring File or Folder", error);
      if (error.status === 423 || error.status === 429) return false;
    }
  }
  return true;
}

export async function emptyBin() {
  const inBin = disk().children("recycle");
  if (!inBin.length) return false;
  const text = one(inBin) ? `Are you sure you want to delete ${quoted(inBin[0])}?` : `Are you sure you want to delete these ${inBin.length} items?`;
  const answer = await showMessage({ title: one(inBin) ? "Confirm File Delete" : "Confirm Multiple File Delete", text, icon: "delete", buttons: ["Yes", "No"] });
  if (answer !== "Yes") return false;
  try {
    await disk().empty();
    return true;
  } catch (error) {
    await complain("Error Deleting File or Folder", error);
    return false;
  }
}

// The server numbers duplicates like XP ("New Folder (2)").
// Returns the new item, ready to rename, or null.
export async function makeNew(parent, kind) {
  try {
    if (kind === "folder") return await disk().makeFolder(parent, "New Folder");
    return await disk().makeFile(parent, "New Text Document.txt", "", "text");
  } catch (error) {
    await complain(kind === "folder" ? "Error Creating Folder" : "Error Creating File", error);
    return null;
  }
}

// A local file's disk kind: "picture", "sound", "text" or null.
export function kindOf(file) {
  if (file.type.startsWith("image/")) return "picture";
  if (file.type.startsWith("audio/") || SOUND_NAME.test(file.name)) return "sound";
  if (file.type.startsWith("text/") || /\.txt$/i.test(file.name)) return "text";
  return null;
}

// Uploads local files. Anyone can add pictures and text. Sounds are admin only.
export async function saveFromComputer(files, folderId) {
  for (const file of files) {
    const kind = kindOf(file);
    const refused = !kind ? "only pictures, text files and music can be saved here."
      : kind === "sound" && !disk().admin ? "only the admin can add music and sounds." : null;
    if (refused) {
      await showMessage({ title: "Error Copying File or Folder", text: `Cannot copy ${file.name}: ${refused}` });
      continue;
    }
    try {
      await disk().makeFile(folderId, file.name, file, kind);
    } catch (error) {
      await complain("Error Copying File or Folder", error);
      if (error.status === 423 || error.status === 429) break;
    }
  }
}

// A disk picture as the shared wallpaper, keeping the current position.
export async function setAsWallpaper(item) {
  const now = disk().settings().wallpaper ?? {};
  try {
    await disk().setWallpaper({ image: `file:${item.id}`, position: now.position ?? "stretch", color: now.color ?? "" });
  } catch (error) {
    await complain("Display Properties", error);
  }
}

// Anything not fixed in place (js/items.js isFixed).
export const movable = (item) => Boolean(item) && !isFixed(item);

// Cut and Paste. js/desktop.js holds it, so it works across windows. Paste moves.
export const clipboard = {
  ids: () => window.top.desktop.clipboard(),
  has: () => clipboard.ids().some((id) => disk().item(id)),
  cut: (items) => window.top.desktop.setClipboard(items.filter(movable).map((item) => item.id)),
  async paste(folderId) {
    const items = clipboard.ids().map((id) => disk().item(id)).filter(Boolean);
    window.top.desktop.setClipboard([]);
    return moveItems(items, folderId);
  },
};
