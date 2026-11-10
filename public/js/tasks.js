// XP's File and Folder Tasks, which the desktop's icons and the File Browser
// share. Each asks XP's question first, and shows XP's message when
// something can't be done.
//
// They all work on the one disk (window.top.desktop.disk, js/disk.js). Their
// questions and messages go up in whichever page called them (the desktop,
// or a program's window), as XP put them over the window that asked.

import { BAD_NAME, NAME_RULE, SOUND_NAME, isFolder, isSpecial } from "./items.js";
import { showMessage } from "./message.js";

export const disk = () => window.top.desktop.disk;

const one = (items) => items.length === 1;
const quoted = (item) => `'${item.name}'`;

// Says what went wrong, in the server's words.
export function complain(title, error) {
  return showMessage({ title, text: error.message ?? String(error) });
}

// Into the Recycle Bin, after XP's question. From inside the bin (or with
// the admin's Shift+Delete) it's gone for good, which asks differently.
export async function deleteItems(items, { forGood = false } = {}) {
  items = items.filter(Boolean);
  if (!items.length) return false;
  const gone = forGood || items.every((item) => disk().inBin(item.id));
  const what = one(items) ? (isFolder(items[0]) ? "Folder" : "File") : "Multiple File";
  const text = gone
    ? (one(items) ? `Are you sure you want to delete ${quoted(items[0])}?` : `Are you sure you want to delete these ${items.length} items?`)
    : (one(items) ? `Are you sure you want to send ${quoted(items[0])} to the Recycle Bin?` : `Are you sure you want to send these ${items.length} items to the Recycle Bin?`);
  const answer = await showMessage({ title: `Confirm ${what} Delete`, text, icon: "delete", buttons: ["Yes", "No"] });
  if (answer !== "Yes") return false;
  return throwAway(items, { forGood });
}

// The same without asking, for dragging onto the Recycle Bin.
export async function throwAway(items, { forGood = false } = {}) {
  let ok = true;
  for (const item of items) {
    try {
      await disk().remove(item.id, forGood);
    } catch (error) {
      ok = false;
      await complain(`Error Deleting ${isFolder(item) ? "Folder" : "File or Folder"}`, error);
      // Locked (423) or too many changes (429) would stop the rest too.
      if (error.status === 423 || error.status === 429) break;
    }
  }
  return ok;
}

// A new name. One Windows wouldn't allow gets XP's rule, and one the server
// turns down (another item has it, say) gets the server's words.
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

// Into a folder. Skips the folder itself and anything already in it.
export async function moveItems(items, folderId) {
  for (const item of items) {
    if (item.id === folderId || item.parent === folderId) continue;
    try {
      await disk().move(item.id, folderId);
    } catch (error) {
      await complain(`Error Moving ${isFolder(item) ? "Folder" : "File or Folder"}`, error);
      if (error.status === 423 || error.status === 429) return false;
    }
  }
  return true;
}

// Out of the Recycle Bin, back where each came from.
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

// A new folder or text file, named the way XP named them ("New Folder",
// "New Folder (2)"). Gives back the new item, ready to rename, or null.
export async function makeNew(parent, kind) {
  try {
    if (kind === "folder") return await disk().makeFolder(parent, "New Folder");
    return await disk().makeFile(parent, "New Text Document.txt", "", "text");
  } catch (error) {
    await complain(kind === "folder" ? "Error Creating Folder" : "Error Creating File", error);
    return null;
  }
}

// What a file from your computer would be on the disk ("picture", "sound" or
// "text"), or null.
export function kindOf(file) {
  if (file.type.startsWith("image/")) return "picture";
  if (file.type.startsWith("audio/") || SOUND_NAME.test(file.name)) return "sound";
  if (file.type.startsWith("text/") || /\.txt$/i.test(file.name)) return "text";
  return null;
}

// Files from your own computer, saved in a folder for everyone. Anyone can
// add pictures and text files, only the admin can add music, and anything
// else gets XP's error.
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

// A picture on the disk as everyone's wallpaper, keeping the wallpaper's
// current position (stretch, if it has none).
export async function setAsWallpaper(item) {
  const now = disk().settings().wallpaper ?? {};
  try {
    await disk().setWallpaper({ image: `file:${item.id}`, position: now.position ?? "stretch", color: now.color ?? "" });
  } catch (error) {
    await complain("Display Properties", error);
  }
}

// Anything but the desktop's own folders can be cut and pasted elsewhere.
export const movable = (item) => Boolean(item) && !isSpecial(item);

// What Cut has put aside. The desktop keeps it (js/desktop.js), so something
// cut in one window can be pasted in another, or on the desktop. Paste moves
// it.
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
