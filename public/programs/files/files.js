// The File Browser, XP's Explorer over the shared disk. It shows one folder
// (?folder=<id>, My Documents by default) with XP's menus, toolbar, address
// bar, blue task pane and the folder's contents. The Recycle Bin is this same
// page at ?folder=recycle, with its own tasks.
//
// Clicks, keys and drags work as on XP. Pictures, text files and (for the
// admin) music dragged in from your own computer get saved for everyone.
//
// The disk is the desktop's (window.top.desktop.disk, js/disk.js), so
// anyone's changes show up here as they happen.

import { folderDialog } from "/js/file-dialog.js";
import { DRAGGED, bytesText, dateText, editor, fileUrl, iconOf, isFolder, isPicture, isShortcut, isSound, isSpecial, nameParts, renamable, sizeText, sortItems, typeName } from "/js/items.js";
import { menuBar, showMenu } from "/js/menu.js";
import { showMessage } from "/js/message.js";
import { clipboard, deleteItems, emptyBin, makeNew, movable, moveItems, renameItem, restoreItems, saveFromComputer, setAsWallpaper, throwAway } from "/js/tasks.js";

const XP = "/img/icons/xp";

// Null when the page is opened on its own. js/app.js is already sending it
// to the desktop then.
const desktop = window.top === window ? null : window.top.desktop;
const disk = desktop?.disk;

const view = document.querySelector(".view");
const pane = document.querySelector(".pane");
const address = document.querySelector(".address");
const addressField = document.getElementById("address");
const addressIcon = document.querySelector(".address__field img");
const favicon = document.querySelector("link[rel=icon]");
const toolbar = document.querySelector(".toolbar");

let here = "documents";   // the folder shown
const back = [];          // for Back
const ahead = [];         // for Forward
let mode = null;          // "thumbnails", "icons", "details", or null for the folder's default
let sortBy = "name";
const selected = new Set();   // ids
let lead = null;          // the item with the keyboard's dotted outline
let anchor = null;        // where a Shift range starts
let renaming = null;
let stale = false;        // the disk changed mid-rename, so redraw after
let above = null;         // the shown folder's parent, in case it's deleted

const inBin = () => here === "recycle";
const item = (id) => disk.item(id);
const picked = () => [...selected].map(item).filter(Boolean);
const viewMode = () => mode ?? (here === "pictures" ? "thumbnails" : "icons");

// --- going places ----------------------------------------------------------

function go(folderId, { record = true } = {}) {
  const folder = item(folderId);
  if (!folder || !isFolder(folder)) return false;
  if (record && folder.id !== here) {
    back.push(here);
    ahead.length = 0;
  }
  here = folder.id;
  selected.clear();
  lead = anchor = null;
  history.replaceState(null, "", `?folder=${encodeURIComponent(here)}`);
  dispatchEvent(new Event("addresschange"));
  draw();
  view.scrollTop = 0;
  return true;
}

function goBack() {
  while (back.length) {
    const to = back.pop();
    if (item(to)) {
      ahead.push(here);
      return go(to, { record: false });
    }
  }
}

function goForward() {
  while (ahead.length) {
    const to = ahead.pop();
    if (item(to)) {
      back.push(here);
      return go(to, { record: false });
    }
  }
}

const goUp = () => item(here)?.parent && go(item(here).parent);

// An item's path as the address bar shows it, like My Documents\Stuff.
const pathText = (id) => disk.path(id).map((one) => one.name).join("\\");

// Finds the folder a typed address names. It can start at any of the
// desktop's own folders, so My Pictures\Trips works without the full path.
function find(path) {
  const parts = path.split(/[\\/]+/).map((part) => part.trim().toLowerCase()).filter(Boolean);
  if (!parts.length) return null;
  const named = (list, name) => list.find((one) => isFolder(one) && one.name.toLowerCase() === name);
  let folder = named(disk.all().filter(isSpecial), parts[0]);
  for (const part of parts.slice(1)) {
    folder = folder && named(disk.children(folder.id), part);
  }
  return folder;
}

address.addEventListener("submit", async (e) => {
  e.preventDefault();
  const folder = find(addressField.value);
  if (folder) return go(folder.id);
  await showMessage({ title: item(here).name, text: `Windows cannot find '${addressField.value}'. Check the spelling and try again.` });
  addressField.value = pathText(here);
});

// --- drawing ---------------------------------------------------------------

function el(tag, className, parent, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  parent?.append(node);
  return node;
}

function picture(src, className, parent) {
  const img = el("img", className, parent);
  img.src = src;
  img.alt = "";
  img.draggable = false;
  return img;
}

// Where a thrown-away item came from (the bin's Original Location).
const cameFrom = (one) => (one.wasIn && item(one.wasIn) ? pathText(one.wasIn) : "Desktop");

function draw() {
  if (renaming) {
    stale = true;
    return;
  }
  stale = false;
  const folder = item(here);
  if (!folder) return go("documents", { record: false });
  above = folder.parent;
  const binFull = disk.binFull();
  document.title = folder.name;
  favicon.href = iconOf(folder, binFull);
  addressIcon.src = iconOf(folder, binFull);
  if (document.activeElement !== addressField) addressField.value = pathText(here);
  toolbar.querySelector("[data-go=back]").disabled = !back.length;
  toolbar.querySelector("[data-go=forward]").disabled = !ahead.length;
  toolbar.querySelector("[data-go=up]").disabled = !folder.parent;

  const items = sortItems(disk.children(here), sortBy);
  for (const id of selected) if (!item(id) || item(id).parent !== here) selected.delete(id);
  if (lead && !selected.has(lead) && !items.some((one) => one.id === lead)) lead = null;
  const cut = new Set(clipboard.ids());
  const shape = viewMode();
  view.className = `view view--${shape}`;
  const scroll = view.scrollTop;
  view.replaceChildren();

  if (shape === "details") {
    const head = el("div", "file file--head", view);
    const columns = inBin() ? [["Name", "name"], ["Original Location", null], ["Size", "size"], ["Type", "type"]] : [["Name", "name"], ["Size", "size"], ["Type", "type"], ["Date Modified", "modified"]];
    for (const [label, key] of columns) {
      const button = el("button", "file__column", head, label);
      button.type = "button";
      button.disabled = !key;
      button.addEventListener("click", () => {
        sortBy = key;
        draw();
      });
    }
  }

  for (const one of items) {
    const row = el("div", "file", view);
    row.dataset.id = one.id;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(selected.has(one.id)));
    row.classList.toggle("is-lead", lead === one.id);
    row.classList.toggle("is-cut", cut.has(one.id));
    row.draggable = movable(one);
    const box = el("span", "file__picture", row);
    if (shape === "thumbnails" && isPicture(one)) {
      const thumb = picture(fileUrl(one), "file__thumb", box);
      thumb.loading = "lazy";
    } else {
      picture(iconOf(one, binFull), "file__icon", box);
    }
    el("span", "file__name", row, one.name);
    if (shape === "details") {
      if (inBin()) el("span", "file__cell", row, cameFrom(one));
      el("span", "file__cell file__cell--size", row, isFolder(one) || isShortcut(one) ? "" : sizeText(one.size));
      el("span", "file__cell", row, typeName(one));
      if (!inBin()) el("span", "file__cell", row, dateText(one.modified));
    }
  }
  if (!items.length && inBin()) el("p", "view__empty", view, "The Recycle Bin is empty.");
  view.scrollTop = scroll;
  drawPane(folder, items);
  drawStatus(items);
}

function drawStatus(items) {
  const chosen = picked();
  const counted = chosen.length ? chosen : items;
  const bytes = counted.reduce((sum, one) => sum + (one.kind === "file" ? one.size : 0), 0);
  document.querySelector("[data-count]").textContent = chosen.length
    ? `${chosen.length} object${chosen.length === 1 ? "" : "s"} selected`
    : `${items.length} object${items.length === 1 ? "" : "s"}`;
  document.querySelector("[data-size]").textContent = bytesText(bytes);
}

// --- the task pane ---------------------------------------------------------

function drawPane(folder) {
  pane.replaceChildren();
  const chosen = picked();
  const single = chosen.length === 1 ? chosen[0] : null;
  const box = (title) => {
    const section = el("section", "pane__box", pane);
    el("h2", "pane__head", section, title);
    return el("ul", "pane__list", section);
  };
  const task = (list, label, icon, action) => {
    const button = el("button", "pane__task", el("li", "", list));
    button.type = "button";
    picture(icon, "", button);
    el("span", "", button, label);
    button.addEventListener("click", action);
  };
  const word = single ? (isFolder(single) ? "folder" : "file") : "";

  if (inBin()) {
    const list = box("Recycle Bin Tasks");
    task(list, "Empty the Recycle Bin", iconOf(folder, disk.binFull()), emptyBin);
    if (chosen.length) task(list, single ? "Restore this item" : "Restore the selected items", `${XP}/restore.png`, () => restoreItems(chosen));
    else task(list, "Restore all items", `${XP}/restore-all.png`, () => restoreItems(disk.children("recycle")));
  } else {
    const list = box("File and Folder Tasks");
    if (!chosen.length) {
      task(list, "Make a new folder", `${XP}/new-folder.png`, () => makeAndRename("folder"));
    } else if (single) {
      if (renamable(single)) task(list, `Rename this ${word}`, `${XP}/rename.png`, () => startRename(single.id));
      if (movable(single)) task(list, `Move this ${word}`, `${XP}/move-to.png`, () => moveTo(chosen));
      if (isPicture(single)) task(list, "Set as desktop background", `${XP}/display-properties.png`, () => setAsWallpaper(single));
      task(list, `Delete this ${word}`, `${XP}/delete.png`, () => deleteItems(chosen));
    } else {
      if (chosen.some(movable)) task(list, "Move the selected items", `${XP}/move-to.png`, () => moveTo(chosen));
      task(list, "Delete the selected items", `${XP}/delete.png`, () => deleteItems(chosen));
    }
    // XP's Music Tasks show in My Music and anywhere else with music.
    const songs = chosen.filter(isSound);
    if (here === "music" || disk.children(here).some(isSound)) {
      const music = box("Music Tasks");
      if (songs.length) task(music, "Play selection", `${XP}/play.png`, () => desktop.open("media-player", `?id=${songs[0].id}`));
      else task(music, "Play all", `${XP}/play.png`, () => desktop.open("media-player", `?folder=${here}`));
    }
  }

  // Other Places lists the parent folder, then the desktop's own folders.
  const others = box("Other Places");
  const places = [folder.parent, "desktop", "documents", "pictures", "music", "recycle"];
  const shown = new Set([here]);
  for (const id of places) {
    const place = id && item(id);
    if (!place || shown.has(id)) continue;
    shown.add(id);
    task(others, place.name, iconOf(place, disk.binFull()), () => go(id));
  }

  const details = box("Details");
  const about = el("li", "pane__details", details);
  const shownItem = single ?? (chosen.length ? null : folder);
  if (shownItem) {
    if (isPicture(shownItem)) {
      const thumb = picture(fileUrl(shownItem), "pane__thumb", about);
      thumb.loading = "lazy";
    }
    el("strong", "", about, shownItem.name);
    el("span", "", about, typeName(shownItem));
    if (shownItem.kind === "file") {
      el("span", "", about, `Date Modified: ${dateText(shownItem.modified)}`);
      el("span", "", about, `Size: ${bytesText(shownItem.size)}`);
    }
    if (shownItem.parent === "recycle") el("span", "", about, `Original Location: ${cameFrom(shownItem)}`);
  } else {
    el("span", "", about, `${chosen.length} items selected.`);
  }
}

// --- selecting -------------------------------------------------------------

function paint() {
  for (const row of view.querySelectorAll(".file[data-id]")) {
    row.setAttribute("aria-selected", String(selected.has(row.dataset.id)));
    row.classList.toggle("is-lead", lead === row.dataset.id);
  }
  const items = sortItems(disk.children(here), sortBy);
  drawPane(item(here), items);
  drawStatus(items);
}

const order = () => [...view.querySelectorAll(".file[data-id]")].map((row) => row.dataset.id);

function choose(id, { add = false, range = false } = {}) {
  if (range && anchor) {
    const ids = order();
    const [a, b] = [ids.indexOf(anchor), ids.indexOf(id)].sort((x, y) => x - y);
    if (!add) selected.clear();
    for (const one of ids.slice(a, b + 1)) selected.add(one);
  } else if (add) {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    anchor = id;
  } else {
    selected.clear();
    if (id) selected.add(id);
    anchor = id;
  }
  lead = id;
  paint();
}

view.addEventListener("pointerdown", (e) => {
  if (renaming || e.button === 1) return;
  const row = e.target.closest(".file[data-id]");
  view.focus({ preventScroll: true });
  if (!row) {
    if (e.button === 0 && !e.ctrlKey && !e.metaKey) choose(null);
    return;
  }
  const id = row.dataset.id;
  if (e.button === 2) {
    if (!selected.has(id)) choose(id);
    return;
  }
  // A press on something already selected might start a drag of the whole
  // selection, so it only becomes the sole selection on a plain click.
  if (selected.has(id) && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    lead = id;
    row.addEventListener("click", () => choose(id), { once: true });
    return;
  }
  choose(id, { add: e.ctrlKey || e.metaKey, range: e.shiftKey });
});

view.addEventListener("dblclick", (e) => {
  const row = e.target.closest(".file[data-id]");
  if (!row || renaming) return;
  open(item(row.dataset.id));
});

function open(one) {
  if (!one) return;
  if (isFolder(one)) return go(one.id);
  if (one.parent === "recycle") {
    return showMessage({ title: one.name, text: `${one.name} is in the Recycle Bin. To open it, restore it first.`, icon: "information" });
  }
  desktop.openItem(one);
}

// --- the keyboard ----------------------------------------------------------

// How many items sit in a row, so Up and Down can jump a whole row.
function across() {
  const rows = [...view.querySelectorAll(".file[data-id]")];
  if (viewMode() === "details" || rows.length < 2) return 1;
  const top = rows[0].offsetTop;
  const n = rows.findIndex((row) => row.offsetTop !== top);
  return n === -1 ? rows.length : n;
}

view.addEventListener("keydown", (e) => {
  if (renaming) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const ids = order();
  const at = ids.indexOf(lead);
  const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -across(), ArrowDown: across(), Home: -Infinity, End: Infinity };
  if (e.key in moves && !e.altKey) {
    if (!ids.length) return;
    const to = at === -1 ? 0 : Math.max(0, Math.min(ids.length - 1, at + moves[e.key]));
    choose(ids[to], { range: e.shiftKey, add: false });
    view.querySelector(`.file[data-id="${CSS.escape(ids[to])}"]`)?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    picked().forEach(open);
  } else if (e.key === "Delete") {
    if (selected.size) deleteItems(picked(), { forGood: e.shiftKey && disk.admin });
  } else if (e.key === "F2") {
    if (lead && selected.has(lead) && renamable(disk.item(lead))) startRename(lead);
  } else if (e.key === "Backspace" || (e.altKey && e.key === "ArrowUp")) {
    goUp();
  } else if (e.altKey && e.key === "ArrowLeft") {
    goBack();
  } else if (e.altKey && e.key === "ArrowRight") {
    goForward();
  } else if (e.key === "F5") {
    draw();
  } else if (ctrl && e.key.toLowerCase() === "a") {
    ids.forEach((id) => selected.add(id));
    paint();
  } else if (ctrl && e.key.toLowerCase() === "x") {
    if (selected.size) clipboard.cut(picked());
  } else if (ctrl && e.key.toLowerCase() === "v") {
    paste();
  } else {
    return;
  }
  e.preventDefault();
});

// --- doing things ----------------------------------------------------------

async function makeAndRename(kind) {
  const made = await makeNew(here, kind);
  if (!made) return;
  draw();
  choose(made.id);
  startRename(made.id);
}

async function moveTo(items) {
  const moving = items.filter(movable);
  if (!moving.length) return;
  const what = moving.length === 1 ? `'${moving[0].name}'` : `the ${moving.length} selected items`;
  const to = await folderDialog({
    title: "Move Items",
    text: `Select the place where you want to move ${what}. Then click the Move button.`,
    button: "Move",
    exclude: moving.filter(isFolder).map((one) => one.id),
  });
  if (to) moveItems(moving, to);
}

function paste() {
  if (!clipboard.has()) return;
  if (inBin()) return throwAway(clipboard.ids().map(item).filter(Boolean));
  clipboard.paste(here);
}

// XP's rename box, over the name, with the extension left unselected.
// Enter or clicking away keeps the new name, and Esc cancels.
function startRename(id) {
  const row = view.querySelector(`.file[data-id="${CSS.escape(id)}"]`);
  const one = item(id);
  if (!row || !one || renaming) return;
  const label = row.querySelector(".file__name");
  const field = el("textarea", "file__rename");
  field.value = one.name;
  field.rows = 1;
  field.spellcheck = false;
  field.setAttribute("aria-label", "New name");
  label.hidden = true;
  label.after(field);
  row.draggable = false;
  const fit = () => {
    field.style.height = "0";
    field.style.height = `${field.scrollHeight}px`;
  };
  fit();
  field.focus();
  field.setSelectionRange(0, isFolder(one) || isShortcut(one) ? field.value.length : nameParts(one.name)[0].length);
  renaming = id;
  let done = false;
  const end = (keep) => {
    if (done) return;
    done = true;
    renaming = null;
    const name = field.value;
    field.remove();
    label.hidden = false;
    view.focus({ preventScroll: true });
    if (keep) renameItem(one, name).then(draw);
    else if (stale) draw();
  };
  field.addEventListener("input", fit);
  field.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      end(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      end(false);
    }
  });
  field.addEventListener("blur", () => end(true));
  for (const type of ["pointerdown", "dblclick", "contextmenu", "dragstart"]) field.addEventListener(type, (e) => e.stopPropagation());
}

// --- menus -----------------------------------------------------------------

function viewEntries() {
  const shape = viewMode();
  const as = (label, value) => ({ label, radio: shape === value, action: () => { mode = value; draw(); } });
  return [as("Thumbnails", "thumbnails"), as("Icons", "icons"), as("Details", "details")];
}

function arrangeEntries() {
  const by = (label, value) => ({ label, radio: sortBy === value, action: () => { sortBy = value; draw(); } });
  return [by("Name", "name"), by("Size", "size"), by("Type", "type"), by("Modified", "modified")];
}

const newEntries = () => [
  { label: "Folder", icon: `${XP}/folder.png`, action: () => makeAndRename("folder") },
  "-",
  { label: "Text Document", icon: `${XP}/text-document.png`, action: () => makeAndRename("text") },
];

function itemMenu() {
  const chosen = picked();
  const single = chosen.length === 1 ? chosen[0] : null;
  if (inBin()) {
    return [
      { label: "Restore", bold: true, action: () => restoreItems(chosen) },
      "-",
      { label: "Delete", action: () => deleteItems(chosen) },
    ];
  }
  const entries = [{ label: "Open", bold: true, action: () => chosen.forEach(open) }];
  const edit = single && editor(single);
  if (edit) entries.push({ label: "Edit", action: () => desktop.open(edit.app, edit.rest) });
  if (single && isPicture(single)) entries.push("-", { label: "Set as Desktop Background", action: () => setAsWallpaper(single) });
  entries.push(
    "-",
    { label: "Cut", disabled: !chosen.some(movable), action: () => clipboard.cut(chosen) },
    "-",
    { label: "Delete", action: () => deleteItems(chosen) },
    { label: "Rename", disabled: !renamable(single), action: () => startRename(single.id) },
  );
  return entries;
}

function folderMenu() {
  const entries = [
    { label: "View", submenu: viewEntries() },
    "-",
    { label: "Arrange Icons By", submenu: arrangeEntries() },
    { label: "Refresh", action: draw },
  ];
  if (inBin()) {
    entries.push("-", { label: "Empty Recycle Bin", disabled: !disk.binFull(), action: emptyBin });
  } else {
    entries.push("-", { label: "Paste", disabled: !clipboard.has(), action: paste }, "-", { label: "New", submenu: newEntries() });
  }
  return entries;
}

view.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (renaming) return;
  const row = e.target.closest(".file[data-id]");
  if (!row) choose(null);
  else if (!selected.has(row.dataset.id)) choose(row.dataset.id);
  showMenu(row ? itemMenu() : folderMenu(), { x: e.clientX, y: e.clientY });
});

function about() {
  return showMessage({
    title: "About techtrash",
    text: "techtrash.org\n\nOne desktop, shared by everyone here. Whatever anyone saves, moves or throws away, everyone sees.",
    icon: "information",
  });
}

function setUpMenus() {
  menuBar(document.querySelector(".menu-bar"), [
    { label: "File", items: () => {
      const chosen = picked();
      const entries = inBin()
        ? [{ label: "Empty Recycle Bin", disabled: !disk.binFull(), action: emptyBin }, { label: "Restore", disabled: !chosen.length, action: () => restoreItems(chosen) }]
        : [{ label: "New", submenu: newEntries() }, "-", { label: "Open", disabled: !chosen.length, action: () => chosen.forEach(open) }];
      entries.push(
        "-",
        { label: "Delete", disabled: !chosen.length, action: () => deleteItems(chosen) },
        { label: "Rename", disabled: chosen.length !== 1 || !renamable(chosen[0]) || inBin(), action: () => startRename(chosen[0].id) },
        "-",
        { label: "Close", action: () => desktop.close(window) },
      );
      return entries;
    } },
    { label: "Edit", items: () => {
      const chosen = picked();
      return [
        { label: "Cut", keys: "Ctrl+X", disabled: !chosen.some(movable), action: () => clipboard.cut(chosen) },
        { label: "Paste", keys: "Ctrl+V", disabled: !clipboard.has(), action: paste },
        "-",
        { label: "Select All", keys: "Ctrl+A", action: () => { order().forEach((id) => selected.add(id)); paint(); } },
        { label: "Invert Selection", action: () => { for (const id of order()) selected.has(id) ? selected.delete(id) : selected.add(id); paint(); } },
        "-",
        { label: "Move To Folder...", disabled: !chosen.some(movable) || inBin(), action: () => moveTo(chosen) },
      ];
    } },
    { label: "View", items: () => [
      ...viewEntries(),
      "-",
      { label: "Arrange Icons by", submenu: arrangeEntries() },
      "-",
      { label: "Go To", submenu: [
        { label: "Back", keys: "Alt+Left", disabled: !back.length, action: goBack },
        { label: "Forward", keys: "Alt+Right", disabled: !ahead.length, action: goForward },
        { label: "Up One Level", disabled: !item(here)?.parent, action: goUp },
      ] },
      { label: "Refresh", keys: "F5", action: draw },
    ] },
    { label: "Help", items: () => [{ label: "About techtrash", action: about }] },
  ]);
}

// --- dragging --------------------------------------------------------------

// Is the drag carrying items from a File Browser (this one or another) or
// files from your own computer?
const carrying = (e) => e.dataTransfer.types.includes(DRAGGED) || e.dataTransfer.types.includes("Files");

// Where a drop would land. That's the folder (or Recycle Bin shortcut) under
// the pointer, or else this folder.
function dropTarget(e) {
  const row = e.target.closest?.(".file[data-id]");
  const under = row && item(row.dataset.id);
  if (under && isFolder(under)) return { id: under.id, row };
  if (under && isShortcut(under) && under.type === "recycle-bin") return { id: "recycle", row };
  return { id: here, row: null };
}

view.addEventListener("dragstart", (e) => {
  const row = e.target.closest(".file[data-id]");
  if (!row || renaming) return e.preventDefault();
  if (!selected.has(row.dataset.id)) choose(row.dataset.id);
  const ids = picked().filter(movable).map((one) => one.id);
  if (!ids.length) return e.preventDefault();
  e.dataTransfer.setData(DRAGGED, JSON.stringify(ids));
  e.dataTransfer.effectAllowed = "move";
});

let lit = null;
function light(row) {
  if (lit === row) return;
  lit?.classList.remove("is-target");
  row?.classList.add("is-target");
  lit = row;
}

view.addEventListener("dragover", (e) => {
  if (!carrying(e)) return;
  const { row } = dropTarget(e);
  e.preventDefault();
  e.dataTransfer.dropEffect = e.dataTransfer.types.includes("Files") ? "copy" : "move";
  light(row);
});
view.addEventListener("dragleave", (e) => {
  if (!view.contains(e.relatedTarget)) light(null);
});

view.addEventListener("drop", async (e) => {
  if (!carrying(e)) return;
  e.preventDefault();
  light(null);
  const { id } = dropTarget(e);
  if (e.dataTransfer.types.includes(DRAGGED)) {
    const moving = JSON.parse(e.dataTransfer.getData(DRAGGED) || "[]").map(item).filter(Boolean);
    if (id === "recycle") return throwAway(moving);
    return moveItems(moving.filter((one) => one.id !== id), id);
  }
  if (id === "recycle") return;
  saveFromComputer([...e.dataTransfer.files], id);
});

// --- starting --------------------------------------------------------------

function start() {
  setUpMenus();
  toolbar.querySelector("[data-go=back]").addEventListener("click", goBack);
  toolbar.querySelector("[data-go=forward]").addEventListener("click", goForward);
  toolbar.querySelector("[data-go=up]").addEventListener("click", goUp);
  const views = toolbar.querySelector("[data-views]");
  views.addEventListener("click", () => showMenu(viewEntries(), { below: views }));
  // Redraw on anyone's change. If this folder was deleted for good, go to
  // the one it was in.
  addEventListener("diskchange", (e) => {
    if (e.detail.settings) return;
    if (!item(here)) return go(item(above) ? above : "documents", { record: false });
    draw();
  });
  disk.ready.then(() => {
    const asked = new URLSearchParams(location.search).get("folder");
    if (!go(asked ?? "documents", { record: false })) go("documents", { record: false });
    view.focus({ preventScroll: true });
  });
}

if (desktop) start();
