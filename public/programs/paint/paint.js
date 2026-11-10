// Paint. It's JS Paint (jspaint/, MS Paint remade for the web by Isaiah
// Odhner, MIT) in a window, saving to the shared disk.
//
// JS Paint lets the page around it decide where files go, through
// window.systemHooks. Here that's the disk (js/disk.js). Save and Open use
// XP's own dialogs (js/file-dialog.js) on the desktop's page, since JS Paint's
// look would clash with them in here. File > Set As Wallpaper sets everyone's
// wallpaper, and a picture opened from the File Browser (?id=<id>) opens
// straight in. The address follows the file.
//
// Before JS Paint starts, this also trims its menus, stops About from asking
// jspaint.app for news, and makes closing the window with unsaved changes
// ask first. It runs after JS Paint's other modules and before its app.js
// (see index.html), so JS Paint's globals are there to read and its menus
// can be changed before they're drawn.

/* global file_name, localize, MENU_DIVIDER, saved, showMessageBox, system_file_handle */

import { openDialog, saveDialog } from "/js/file-dialog.js";
import { isPicture } from "/js/items.js";
import { showMessage } from "/js/message.js";
import { are_you_sure } from "./jspaint/src/functions.js";
import { menus } from "./jspaint/src/menus.js";

const desktop = window.top === window ? null : window.top.desktop;
const disk = desktop?.disk;
const doc = window.top.document;   // where XP's dialogs go

// The picture types the disk keeps, by extension, and the format JS Paint
// saves each one as.
const SAVE_AS = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp" };
const extension = (name) => (name.match(/\.([^.]+)$/)?.[1] ?? "").toLowerCase();

const complain = (error) => showMessage({ title: "Paint", text: error.message ?? String(error), doc });
const cannot = () => showMessage({ title: "Paint", text: "Paint here can only save and open pictures.", icon: "information", doc });
const onDisk = () => (typeof system_file_handle === "string" ? disk.item(system_file_handle) : null);
const forPictures = (formats) => formats.some((format) => format.formatID === "image/png");

// --- the address follows the file ------------------------------------------

// Puts the file's id in the address. JS Paint retitles its page whenever
// the file changes or is saved, so that's when this runs.
function remember() {
  const id = typeof system_file_handle === "string" ? system_file_handle : null;
  const search = id ? `?id=${encodeURIComponent(id)}` : "";
  if (location.search === search) return;
  history.replaceState(null, "", location.pathname + search);
  dispatchEvent(new Event("addresschange"));
}

// --- files, on the disk ----------------------------------------------------

async function asFile(item) {
  const blob = await disk.blob(item);
  return new File([blob], item.name, { type: blob.type });
}

// Saves a picture as a new file or over an old one. The name's extension
// picks the format, and a name without one the disk keeps gets ".png".
async function saveBlob(to, getBlob) {
  let name = to.name;
  if (!SAVE_AS[extension(name)]) name += ".png";
  const format = SAVE_AS[extension(name)];
  const blob = await getBlob(format);
  const item = to.replace ? await disk.save(to.replace.id, blob) : await disk.makeFile(to.folder, name, blob, "picture");
  return { item, format, blob };
}

// Makes the picture everyone's wallpaper. If it has unsaved changes (or was
// never saved), a copy goes to My Pictures first.
async function setWallpaper(canvas, position) {
  try {
    let item = saved ? onDisk() : null;
    if (!item) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      const base = String(file_name || "untitled").replace(/\.[^.]+$/, "");
      item = await disk.makeFile("pictures", `${base} wallpaper.png`, blob, "picture");
    }
    const now = disk.settings().wallpaper ?? {};
    await disk.setWallpaper({ image: `file:${item.id}`, position, color: now.color ?? "" });
  } catch (error) {
    await complain(error);
  }
}

window.systemHooks = {
  async showSaveFileDialog({ formats, defaultFileName, getBlob, savedCallbackUnreliable }) {
    if (!forPictures(formats)) return cannot();
    const now = onDisk();
    const named = String(defaultFileName || "untitled");
    const to = await saveDialog({
      doc,
      kind: "picture",
      folder: now?.parent ?? "pictures",
      name: SAVE_AS[extension(named)] ? named : `${named}.png`,
      extension: ".png",
    });
    if (!to) return;
    try {
      const { item, format, blob } = await saveBlob(to, getBlob);
      savedCallbackUnreliable?.({ newFileName: item.name, newFileFormatID: format, newFileHandle: item.id, newBlob: blob });
    } catch (error) {
      await complain(error);
    }
  },

  // On cancel this never settles. JS Paint just carries on, the same as when
  // its own file picker is canceled.
  async showOpenFileDialog({ formats }) {
    if (!forPictures(formats)) {
      await cannot();
      return new Promise(() => {});
    }
    const item = await openDialog({ doc, kind: "picture", folder: onDisk()?.parent ?? "pictures" });
    if (!item) return new Promise(() => {});
    try {
      return { file: await asFile(item), fileHandle: item.id };
    } catch (error) {
      await complain(error);
      return new Promise(() => {});
    }
  },

  async writeBlobToHandle(id, blob) {
    try {
      await disk.save(id, blob);
      return true;
    } catch (error) {
      await complain(error);
      return false;
    }
  },

  async readBlobFromHandle(id) {
    await disk.ready;
    const item = disk.item(id);
    if (!item || !isPicture(item)) throw new Error("That picture isn't on the disk anymore. Someone may have moved it or thrown it away.");
    return asFile(item);
  },

  setWallpaperTiled: (canvas) => setWallpaper(canvas, "tile"),
  setWallpaperCentered: (canvas) => setWallpaper(canvas, "center"),
};

// --- before JS Paint starts ------------------------------------------------

function start() {
  // No autosave to this browser's storage, since everything's on the disk.
  // JS Paint calls this for a new picture, and its sessions aren't copied.
  window.new_local_session = () => {};

  // A picture from the disk, to open as JS Paint starts.
  const id = new URLSearchParams(location.search).get("id");
  if (id) window.initial_system_file_handle = id;

  // File > Exit closes the window (JS Paint has asked about saving by then).
  window.close = function close() {
    desktop.close(window, { ask: false });
  };

  // The window's close button asks first, as Exit does.
  window.mayClose = () => new Promise((resolve) => are_you_sure(() => resolve(true), () => resolve(false)));

  new MutationObserver(remember).observe(document.querySelector("title"), { childList: true, characterData: true, subtree: true });

  // Drop the menu items for what tools/make_paint.py didn't copy (multi-user
  // sessions, Imgur, the head tracker...), plus Fullscreen, since a window on
  // the desktop can't be, and JS Paint's news and chat. About gets its own
  // box so it doesn't ask jspaint.app for news.
  const gone = ["Load From URL", "Upload To Imgur", "Manage Storage", "Multi-User", "Themes", "Language", "Head Tracker",
    "Dwell Clicker", "Enlarge UI", "Quick Undo Button", "Vertical Color Box", "Speech Recognition", "Fullscreen",
    "Project News", "Discord", "Donate"];
  const plain = (label) => String(localize(label ?? "")).replace(/&/g, "");
  for (const [name, items] of Object.entries(menus)) {
    const kept = items.filter((item) => !gone.includes(plain(item.label)));
    // no divider left at either end, or two in a row
    menus[name] = kept.filter((item, i) => item !== MENU_DIVIDER || (i > 0 && i < kept.length - 1 && kept[i - 1] !== MENU_DIVIDER));
  }
  const about = Object.values(menus).flat().find((item) => plain(item.label) === "About Paint");
  if (about) {
    about.action = () => showMessageBox({
      title: localize("About Paint"),
      message: "Paint\n\nJS Paint: MS Paint, remade for the web by Isaiah Odhner.\nMIT License: github.com/1j01/jspaint\n\nWhat's saved here goes on techtrash.org's shared disk, for everyone.",
    });
  }
}

if (desktop) start();
