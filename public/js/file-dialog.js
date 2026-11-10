// XP's Open, Save As and Move Items dialogs, over the shared disk. A program
// puts one up over its own window, like XP, and gets a promise of the answer.
//
//   openDialog({ kind, folder })
//       The file to open, or null. kind is "text", "picture", "sound" or
//       "any", and decides which files it lists.
//   saveDialog({ kind, folder, name, extension })
//       Where to save, as { folder, name, replace }, or null. replace is the
//       item already there, if the person said to replace it. A name with no
//       extension gets `extension`.
//   folderDialog({ title, text, button, exclude })
//       The id of a folder to move things into, or null. Folders in
//       `exclude` (and everything in them) aren't offered.
//
// Each lists the disk as it is (window.top.desktop.disk, js/disk.js) and
// keeps up with it while it's open. Their look is .dialog in
// css/explorer.css. Each also takes doc, the page to put it up on, if not
// this one. Paint puts its own on the desktop's, since its look would clash
// with XP's.

import { BAD_NAME, NAME_RULE, SPECIAL, iconOf, isFolder, isPicture, isSound, isText, sortItems } from "./items.js";
import { showMessage } from "./message.js";

const XP = "/img/icons/xp";
const disk = () => window.top.desktop.disk;

// The places down the dialog's left side, like XP's.
const PLACES = [
  { id: "desktop", label: "Desktop" },
  { id: "documents", label: "My Documents" },
  { id: "pictures", label: "My Pictures" },
  { id: "music", label: "My Music" },
];

const TYPES = {
  text: [{ label: "Text Documents (*.txt)", fits: isText }, { label: "All Files (*.*)", fits: (item) => !isFolder(item) }],
  picture: [{ label: "Pictures (*.png;*.jpg;*.gif;*.bmp)", fits: isPicture }, { label: "All Files (*.*)", fits: (item) => !isFolder(item) }],
  sound: [{ label: "Audio Files (*.mp3;*.wav;*.ogg;*.flac;*.m4a)", fits: isSound }, { label: "All Files (*.*)", fits: (item) => !isFolder(item) }],
  any: [{ label: "All Files (*.*)", fits: (item) => !isFolder(item) }],
};

let count = 0;

// The window on its own layer, with everything behind it out of reach, plus
// close() to take it all down again and a few helpers.
function frame(title, className, doc) {
  const id = `dialog-${++count}`;
  const layer = doc.createElement("div");
  layer.className = "layer";
  layer.innerHTML = `
    <section class="window dialog ${className}" role="dialog" aria-modal="true" aria-labelledby="${id}">
      <header class="title-bar">
        <h2 class="title-bar__text" id="${id}"></h2>
        <div class="title-bar__controls">
          <button class="caption caption--close" type="button" aria-label="Close"></button>
        </div>
      </header>
      <div class="dialog__body"></div>
    </section>`;
  layer.querySelector(".title-bar__text").textContent = title;
  const behind = [...doc.body.children];
  const wasInert = behind.map((el) => el.inert);
  const hadFocus = doc.activeElement;
  behind.forEach((el) => { el.inert = true; });
  doc.body.append(layer);
  const body = layer.querySelector(".dialog__body");
  const cleanups = [];
  const close = () => {
    cleanups.forEach((fn) => fn());
    layer.remove();
    behind.forEach((el, i) => { el.inert = wasInert[i]; });
    if (hadFocus?.isConnected) hadFocus.focus?.();
  };
  // Keeps up with the disk while it's open. The desktop's page hears of
  // changes from the disk itself, and a program's from its window.
  const onChange = (fn) => {
    if (doc === window.top.document) cleanups.push(disk().watch(fn));
    else {
      doc.defaultView.addEventListener("diskchange", fn);
      cleanups.push(() => doc.defaultView.removeEventListener("diskchange", fn));
    }
  };
  const el = (tag, className, parent, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    parent?.append(node);
    return node;
  };
  const picture = (src, className, parent) => {
    const img = el("img", className, parent);
    img.src = src;
    img.alt = "";
    return img;
  };
  const tell = (options) => showMessage({ ...options, doc });
  return { layer, body, close, onChange, el, picture, tell, closeButton: layer.querySelector(".caption--close") };
}

// The folder if it still exists and isn't in the Recycle Bin, else My Documents.
function usable(folderId) {
  const folder = disk().item(folderId);
  return folder && isFolder(folder) && folder.id !== "recycle" && !disk().inBin(folder.id) ? folder.id : "documents";
}

// --- Open and Save As ------------------------------------------------------

function fileDialog({ saving, kind = "text", folder = "documents", name = "", extension = ".txt", doc = document }) {
  const { body, close, onChange, el, picture, tell, closeButton } = frame(saving ? "Save As" : "Open", "dialog--file", doc);
  const types = TYPES[kind] ?? TYPES.any;
  let here = usable(folder);
  let type = types[0];

  body.innerHTML = `
    <div class="dialog__row">
      <label class="dialog__label" for="look-in"></label>
      <select class="dialog__look" id="look-in"></select>
      <button class="tool" type="button" data-up title="Up One Level"><img src="${XP}/up.png" alt="Up One Level"></button>
      <button class="tool" type="button" data-new title="Create New Folder"><img src="${XP}/new-folder.png" alt="Create New Folder"></button>
    </div>
    <div class="dialog__main">
      <nav class="places" aria-label="Places"></nav>
      <div class="dialog__list" role="listbox" tabindex="0" aria-label="Files"></div>
    </div>
    <div class="dialog__fields">
      <label class="dialog__label" for="file-name">File name:</label>
      <input id="file-name" autocomplete="off" spellcheck="false">
      <button class="button button--default" type="button" data-go></button>
      <label class="dialog__label" for="file-type"></label>
      <select id="file-type"></select>
      <button class="button" type="button" data-cancel>Cancel</button>
    </div>`;
  body.querySelector("[for=look-in]").textContent = saving ? "Save in:" : "Look in:";
  body.querySelector("[for=file-type]").textContent = saving ? "Save as type:" : "Files of type:";
  body.querySelector("[data-go]").textContent = saving ? "Save" : "Open";
  const look = body.querySelector(".dialog__look");
  const list = body.querySelector(".dialog__list");
  const field = body.querySelector("#file-name");
  const typeBox = body.querySelector("#file-type");
  field.value = name;
  for (const one of types) el("option", "", typeBox, one.label);
  typeBox.addEventListener("change", () => {
    type = types[typeBox.selectedIndex];
    draw();
  });

  const places = body.querySelector(".places");
  for (const place of PLACES) {
    const button = el("button", "places__place", places);
    button.type = "button";
    picture(SPECIAL[place.id].icon, "", button);
    el("span", "", button, place.label);
    button.addEventListener("click", () => go(place.id));
  }

  let picked = null;

  function go(folderId) {
    here = usable(folderId);
    picked = null;
    draw();
  }

  // "Save in" (or "Look in") lists the folder and the folders it's in, then
  // the places.
  function drawLook() {
    look.replaceChildren();
    const chain = disk().path(here);
    const shown = new Set();
    const option = (item, depth) => {
      if (shown.has(item.id)) return;
      shown.add(item.id);
      const opt = el("option", "", look, `${"   ".repeat(depth)}${item.name}`);
      opt.value = item.id;
      opt.selected = item.id === here;
    };
    chain.forEach((item, depth) => option(item, depth));
    for (const place of PLACES) {
      const item = disk().item(place.id);
      if (item) option(item, disk().path(place.id).length - 1);
    }
  }
  look.addEventListener("change", () => go(look.value));

  function draw() {
    if (!disk().item(here)) here = "documents";
    drawLook();
    const items = sortItems(disk().children(here).filter((item) => isFolder(item) || type.fits(item)));
    list.replaceChildren();
    for (const item of items) {
      const row = el("div", "dialog__file", list);
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(picked === item.id));
      row.dataset.id = item.id;
      picture(iconOf(item, disk().binFull()), "", row);
      el("span", "", row, item.name);
    }
    body.querySelector("[data-up]").disabled = !disk().item(here)?.parent;
  }

  list.addEventListener("click", (e) => {
    const row = e.target.closest(".dialog__file");
    picked = row?.dataset.id ?? null;
    for (const one of list.children) one.setAttribute("aria-selected", String(one === row));
    const item = picked && disk().item(picked);
    if (item && !isFolder(item)) field.value = item.name;
  });
  list.addEventListener("dblclick", (e) => {
    const item = disk().item(e.target.closest(".dialog__file")?.dataset.id);
    if (!item) return;
    if (isFolder(item)) go(item.id);
    else {
      field.value = item.name;
      choose();
    }
  });
  list.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !picked) return;
    e.preventDefault();
    const item = disk().item(picked);
    if (isFolder(item)) go(item.id);
    else choose();
  });

  body.querySelector("[data-up]").addEventListener("click", () => {
    const parent = disk().item(here)?.parent;
    if (parent) go(parent);
  });
  body.querySelector("[data-new]").addEventListener("click", async () => {
    try {
      const folder = await disk().makeFolder(here, "New Folder");
      picked = folder.id;
      draw();
    } catch (error) {
      await tell({ title: "Error Creating Folder", text: error.message });
    }
  });

  onChange(draw);
  draw();
  field.focus();
  field.select();

  return new Promise((resolve) => {
    const finish = (value) => {
      close();
      resolve(value);
    };

    async function choose() {
      let typed = field.value.replace(/\s+/g, " ").trim();
      if (!typed) return;
      if (BAD_NAME.test(typed)) {
        await tell({ title: saving ? "Save As" : "Open", text: `${typed}\nThe file name is not valid.\n\n${NAME_RULE}` });
        field.focus();
        return;
      }
      const there = disk().children(here);
      const named = (want) => there.find((item) => item.name.toLowerCase() === want.toLowerCase());
      const folder = named(typed);
      if (folder && isFolder(folder)) {
        field.value = "";
        return go(folder.id);
      }
      if (!saving) {
        if (!folder) {
          await tell({ title: "Open", text: `${typed}\nFile not found.\nCheck the file name and try again.`, icon: "warning" });
          field.focus();
          return;
        }
        return finish(folder);
      }
      if (!/\.[^. ]+$/.test(typed)) typed += extension;
      const existing = named(typed);
      if (existing) {
        if (isFolder(existing) || existing.kind !== "file") {
          await tell({ title: "Save As", text: `${typed}\nThat name is taken. Use another name.`, icon: "warning" });
          return;
        }
        const answer = await tell({ title: "Confirm Save As", text: `${typed} already exists.\nDo you want to replace it?`, icon: "warning", buttons: ["Yes", "No"] });
        if (answer !== "Yes") return field.focus();
        return finish({ folder: here, name: existing.name, replace: existing });
      }
      finish({ folder: here, name: typed, replace: null });
    }

    body.querySelector("[data-go]").addEventListener("click", choose);
    field.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      choose();
    });
    body.querySelector("[data-cancel]").addEventListener("click", () => finish(null));
    closeButton.addEventListener("click", () => finish(null));
    body.parentElement.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      finish(null);
    });
  });
}

export const openDialog = (options = {}) => fileDialog({ ...options, saving: false });
export const saveDialog = (options = {}) => fileDialog({ ...options, saving: true });

// --- Move Items ------------------------------------------------------------

export function folderDialog({ title = "Browse For Folder", text = "", button = "OK", exclude = [], doc = document } = {}) {
  const { body, close, onChange, el, picture, tell, closeButton } = frame(title, "dialog--folder", doc);
  body.innerHTML = `
    <p class="dialog__text"></p>
    <div class="dialog__list dialog__tree" role="tree" tabindex="0" aria-label="Folders"></div>
    <div class="dialog__buttons">
      <button class="button" type="button" data-new>Make New Folder</button>
      <span class="dialog__gap"></span>
      <button class="button button--default" type="button" data-go></button>
      <button class="button" type="button" data-cancel>Cancel</button>
    </div>`;
  body.querySelector(".dialog__text").textContent = text;
  body.querySelector("[data-go]").textContent = button;
  const tree = body.querySelector(".dialog__tree");
  const left = new Set(exclude);
  let picked = null;

  // Every folder there is, each under the one it's in, the desktop first and
  // then My Documents. Not the Recycle Bin, and nothing being moved.
  function draw() {
    tree.replaceChildren();
    const add = (folder, depth) => {
      if (left.has(folder.id) || folder.id === "recycle") return;
      const row = el("div", "dialog__file", tree);
      row.setAttribute("role", "treeitem");
      row.setAttribute("aria-selected", String(picked === folder.id));
      row.dataset.id = folder.id;
      row.style.setProperty("--depth", depth);
      picture(iconOf(folder), "", row);
      el("span", "", row, folder.name);
      for (const inside of sortItems(disk().children(folder.id).filter(isFolder))) add(inside, depth + 1);
    };
    for (const id of ["desktop", "documents"]) {
      const folder = disk().item(id);
      if (folder) add(folder, 0);
    }
    if (picked && !disk().item(picked)) picked = null;
    body.querySelector("[data-go]").disabled = !picked;
  }

  tree.addEventListener("click", (e) => {
    const row = e.target.closest(".dialog__file");
    if (!row) return;
    picked = row.dataset.id;
    for (const one of tree.children) one.setAttribute("aria-selected", String(one === row));
    body.querySelector("[data-go]").disabled = false;
  });

  body.querySelector("[data-new]").addEventListener("click", async () => {
    try {
      const folder = await disk().makeFolder(picked ?? "documents", "New Folder");
      picked = folder.id;
      draw();
    } catch (error) {
      await tell({ title: "Error Creating Folder", text: error.message });
    }
  });

  onChange(draw);
  draw();
  tree.focus();

  return new Promise((resolve) => {
    const finish = (value) => {
      close();
      resolve(value);
    };
    body.querySelector("[data-go]").addEventListener("click", () => picked && finish(picked));
    tree.addEventListener("dblclick", (e) => {
      const row = e.target.closest(".dialog__file");
      if (row) finish(row.dataset.id);
    });
    body.querySelector("[data-cancel]").addEventListener("click", () => finish(null));
    closeButton.addEventListener("click", () => finish(null));
    body.parentElement.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish(null);
      } else if (e.key === "Enter" && picked && e.target === tree) {
        e.preventDefault();
        finish(picked);
      }
    });
  });
}
