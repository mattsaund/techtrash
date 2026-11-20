// Paint is JS Paint (jspaint/, MS Paint remade for the web by Isaiah Odhner,
// MIT). window.systemHooks points its files at the shared disk.
// Save and Open use XP's dialogs on the top page, clear of JS Paint's CSS.
// Loads just before JS Paint's app.js (see index.html) to edit its menus first.

/* global file_name, localize, MENU_DIVIDER, saved, showMessageBox, system_file_handle */

import { openDialog, saveDialog } from "/js/file-dialog.js";
import { isPicture } from "/js/items.js";
import { showMessage } from "/js/message.js";
import { are_you_sure } from "./jspaint/src/functions.js";
import { menus } from "./jspaint/src/menus.js";

const desktop = window.top === window ? null : window.top.desktop;
const disk = desktop?.disk;
const doc = window.top.document;   // where XP's dialogs go

// Picture extensions the disk keeps -> the format JS Paint saves each as.
const SAVE_AS = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp" };
const extension = (name) => (name.match(/\.([^.]+)$/)?.[1] ?? "").toLowerCase();

const complain = (error) => showMessage({ title: "Paint", text: error.message ?? String(error), doc });
const cannot = () => showMessage({ title: "Paint", text: "Paint here can only save and open pictures.", icon: "information", doc });
const onDisk = () => (typeof system_file_handle === "string" ? disk.item(system_file_handle) : null);
const forPictures = (formats) => formats.some((format) => format.formatID === "image/png");

// --- address ---------------------------------------------------------------

// Puts ?id= in the address. Triggered by <title> changes, since JS Paint
// retitles the page on every open and save.
function remember() {
  const id = typeof system_file_handle === "string" ? system_file_handle : null;
  const search = id ? `?id=${encodeURIComponent(id)}` : "";
  if (location.search === search) return;
  history.replaceState(null, "", location.pathname + search);
  dispatchEvent(new Event("addresschange"));
}

// --- disk files ------------------------------------------------------------

async function asFile(item) {
  const blob = await disk.blob(item);
  return new File([blob], item.name, { type: blob.type });
}

// The extension picks the format. Names without a SAVE_AS extension get ".png".
async function saveBlob(to, getBlob) {
  let name = to.name;
  if (!SAVE_AS[extension(name)]) name += ".png";
  const format = SAVE_AS[extension(name)];
  const blob = await getBlob(format);
  const item = to.replace ? await disk.save(to.replace.id, blob) : await disk.makeFile(to.folder, name, blob, "picture");
  return { item, format, blob };
}

// Sets everyone's wallpaper. Unsaved pictures get a copy in My Pictures first.
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

  // Never settles on cancel, same as JS Paint's own canceled file picker.
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
  // No autosave to local storage. Files live on the disk, and JS Paint's
  // session code isn't copied.
  window.new_local_session = () => {};

  // Picture to open at startup.
  const id = new URLSearchParams(location.search).get("id");
  if (id) window.initial_system_file_handle = id;

  // File > Exit. JS Paint has already asked about saving.
  window.close = function close() {
    desktop.close(window, { ask: false });
  };

  // The close button asks about saving, like Exit.
  window.mayClose = () => new Promise((resolve) => are_you_sure(() => resolve(true), () => resolve(false)));

  new MutationObserver(remember).observe(document.querySelector("title"), { childList: true, characterData: true, subtree: true });

  // Drop items for parts tools/make_paint.py doesn't copy, plus Fullscreen,
  // news and chat. About gets a local box so it doesn't fetch jspaint.app news.
  const gone = ["Load From URL", "Upload To Imgur", "Manage Storage", "Multi-User", "Themes", "Language", "Head Tracker",
    "Dwell Clicker", "Enlarge UI", "Quick Undo Button", "Vertical Color Box", "Speech Recognition", "Fullscreen",
    "Project News", "Discord", "Donate"];
  const plain = (label) => String(localize(label ?? "")).replace(/&/g, "");
  for (const [name, items] of Object.entries(menus)) {
    const kept = items.filter((item) => !gone.includes(plain(item.label)));
    // no leading, trailing or doubled dividers
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
