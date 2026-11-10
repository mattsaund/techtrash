// XP's Notepad, over the shared disk. It edits a text file on the disk
// (?id=<id>) or a new Untitled one, with XP's menus and its Open and Save As
// dialogs (js/file-dialog.js). Closing with unsaved changes asks first, as
// XP did.
//
// Someone else may change the file while it's open here. If nothing's been
// typed here since, it just shows their version. Otherwise saving asks
// whether to replace theirs.
//
// The site's own text files (?file=credits.txt, from public/files/) open
// read-only, with their addresses turned into links.

import { openDialog, saveDialog } from "/js/file-dialog.js";
import { isText } from "/js/items.js";
import { menuBar } from "/js/menu.js";
import { showMessage } from "/js/message.js";
import { complain } from "/js/tasks.js";

const desktop = window.top === window ? null : window.top.desktop;
const disk = desktop?.disk;

const text = document.querySelector(".notepad__text");
const site = document.querySelector(".notepad__site");
const statusBar = document.querySelector(".status-bar");
const where = document.querySelector("[data-where]");

let file = null;       // the disk item being edited, or null for Untitled
let version = 0;       // its version when opened or last saved here
let saved = "";        // its text as of then
let wrap = true;       // Format > Word Wrap
let showStatus = false;

const name = () => file?.name ?? "Untitled";
const changed = () => !window.siteFile && text.value !== saved;

function title() {
  document.title = `${window.siteFile ?? name()} - Notepad`;
}

// Puts the file in the address, so a shared link or a reload reopens it.
function remember() {
  history.replaceState(null, "", file ? `?id=${encodeURIComponent(file.id)}` : location.pathname);
  dispatchEvent(new Event("addresschange"));
}

function show(item, words) {
  file = item;
  version = item?.version ?? 0;
  saved = words;
  text.value = words;
  text.setSelectionRange(0, 0);
  text.scrollTop = 0;
  title();
  remember();
  status();
}

async function load(id) {
  const item = disk.item(id);
  if (!item || !isText(item)) {
    await showMessage({ title: "Notepad", text: `Cannot find the ${item ? item.name : "file"}.\nSomeone may have moved it, renamed it or thrown it away.`, icon: "warning" });
    return show(null, "");
  }
  try {
    show(item, await disk.text(item));
  } catch (error) {
    await complain("Notepad", error);
    show(null, "");
  }
}

// --- saving ----------------------------------------------------------------

// Saves over the file it came from, or does Save As if it's new. Returns
// whether it saved.
async function save() {
  if (!file) return saveAs();
  const now = disk.item(file.id);
  if (!now) {
    await showMessage({ title: "Notepad", text: `${name()} isn't on the disk anymore: someone may have thrown it away. Save it somewhere else.`, icon: "warning" });
    return saveAs();
  }
  if (now.version !== version) {
    const answer = await showMessage({
      title: "Notepad",
      text: `Someone else has changed ${now.name} since you opened it.\n\nDo you want to replace their changes with yours?`,
      icon: "warning",
      buttons: ["Yes", "No"],
    });
    if (answer !== "Yes") return false;
  }
  return write(() => disk.save(file.id, text.value));
}

async function saveAs() {
  const to = await saveDialog({ kind: "text", folder: file?.parent ?? "documents", name: file?.name ?? "Untitled.txt", extension: ".txt" });
  if (!to) return false;
  return write(() => (to.replace ? disk.save(to.replace.id, text.value) : disk.makeFile(to.folder, to.name, text.value, "text")));
}

async function write(send) {
  const words = text.value;
  try {
    const item = await send();
    file = item;
    version = item.version;
    saved = words;
    title();
    remember();
    return true;
  } catch (error) {
    await complain("Notepad", error);
    return false;
  }
}

// Asks XP's "Do you want to save the changes?" when there are any. Returns
// true when it's fine to go on (it saved, or they picked No).
async function settle() {
  if (!changed()) return true;
  const answer = await showMessage({
    title: "Notepad",
    text: `The text in the ${name()} file has changed.\n\nDo you want to save the changes?`,
    icon: "warning",
    buttons: ["Yes", "No", "Cancel"],
  });
  if (answer === "Yes") return save();
  return answer === "No";
}

// The window's close button asks this first (js/desktop.js).
window.mayClose = settle;

async function fresh() {
  if (!(await settle())) return;
  window.siteFile = null;
  useEditor();
  show(null, "");
  text.focus();
}

async function openOne() {
  if (!(await settle())) return;
  const item = await openDialog({ kind: "text", folder: file?.parent ?? "documents" });
  if (!item) return text.focus();
  window.siteFile = null;
  useEditor();
  await load(item.id);
  text.focus();
}

// --- editing ---------------------------------------------------------------

// Types words in at the cursor, over any selection, so Undo can take them
// back out.
function insert(words) {
  text.focus();
  if (!document.execCommand("insertText", false, words)) text.setRangeText(words, text.selectionStart, text.selectionEnd, "end");
  status();
}

// Time/Date (F5), written the way XP did, like 11:05 PM 11/9/2026.
function stamp() {
  const now = new Date();
  insert(`${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} ${now.toLocaleDateString("en-US")}`);
}

async function paste() {
  try {
    insert(await navigator.clipboard.readText());
  } catch {
    await showMessage({ title: "Notepad", text: "This browser won't let Notepad read the clipboard. Use Ctrl+V instead.", icon: "information" });
  }
}

const command = (name) => () => {
  text.focus();
  document.execCommand(name);
  status();
};

// Ln and Col, as XP's status bar counted them.
function status() {
  statusBar.hidden = !showStatus || Boolean(window.siteFile);
  if (statusBar.hidden) return;
  const before = text.value.slice(0, text.selectionStart);
  const line = before.split("\n").length;
  const column = before.length - before.lastIndexOf("\n");
  where.textContent = `Ln ${line}, Col ${column}`;
}

function setWrap(on) {
  wrap = on;
  text.wrap = on ? "soft" : "off";
  text.classList.toggle("is-unwrapped", !on);
}

// --- the menus -------------------------------------------------------------

function setUpMenus() {
  const editing = () => !window.siteFile;
  const picked = () => text.selectionStart !== text.selectionEnd;
  menuBar(document.querySelector(".menu-bar"), [
    { label: "File", items: () => [
      { label: "New", keys: "Ctrl+N", action: fresh },
      { label: "Open...", keys: "Ctrl+O", action: openOne },
      { label: "Save", keys: "Ctrl+S", disabled: !editing(), action: save },
      { label: "Save As...", action: () => (editing() ? saveAs() : saveSiteFile()) },
      "-",
      { label: "Exit", action: () => desktop.close(window) },
    ] },
    { label: "Edit", items: () => [
      { label: "Undo", keys: "Ctrl+Z", disabled: !editing(), action: command("undo") },
      "-",
      { label: "Cut", keys: "Ctrl+X", disabled: !editing() || !picked(), action: command("cut") },
      { label: "Copy", keys: "Ctrl+C", disabled: editing() && !picked(), action: editing() ? command("copy") : () => document.execCommand("copy") },
      { label: "Paste", keys: "Ctrl+V", disabled: !editing(), action: paste },
      { label: "Delete", keys: "Del", disabled: !editing() || !picked(), action: () => insert("") },
      "-",
      { label: "Select All", keys: "Ctrl+A", action: () => (editing() ? text.select() : getSelection().selectAllChildren(site)) },
      { label: "Time/Date", keys: "F5", disabled: !editing(), action: stamp },
    ] },
    { label: "Format", items: () => [
      { label: "Word Wrap", checked: wrap, disabled: !editing(), action: () => { setWrap(!wrap); if (wrap) showStatus = false; status(); } },
    ] },
    { label: "View", items: () => [
      // XP had no status bar with Word Wrap on, since wrapped lines would
      // throw off Ln.
      { label: "Status Bar", checked: showStatus && !wrap, disabled: wrap || !editing(), action: () => { showStatus = !showStatus; status(); } },
    ] },
    { label: "Help", items: () => [
      { label: "About Notepad", action: () => showMessage({ title: "About Notepad", text: "Notepad\n\nFor the text files on techtrash.org's shared disk: whatever's saved here, everyone can read.", icon: "information" }) },
    ] },
  ]);
}

document.addEventListener("keydown", (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (ctrl && key === "s" && !e.shiftKey) {
    if (!window.siteFile) save();
  } else if (ctrl && key === "n") {
    fresh();
  } else if (ctrl && key === "o") {
    openOne();
  } else if (e.key === "F5" && !window.siteFile) {
    stamp();
  } else {
    return;
  }
  e.preventDefault();
});

text.addEventListener("input", status);
text.addEventListener("keyup", status);
text.addEventListener("pointerup", status);

// --- the site's own files --------------------------------------------------

// Addresses in the text become links that open in a new tab: web addresses,
// with or without https:// (github.com/..., dejavu-fonts.github.io), and the
// site's own files (/fonts/LGPL-2.1.txt). A name like cosmos.js isn't one.
const ADDRESS = /(https?:\/\/\S+|(?<![\w.])\/[\w.-]+\/[\w./-]+|\b(?:[\w-]+\.)+(?:com|org|net|io|dev|app|gov|edu)(?:\/[\w./%-]*)?)/g;
function linked(words) {
  const out = document.createDocumentFragment();
  words.split(ADDRESS).forEach((part, i) => {
    if (i % 2 === 0) return out.append(part);
    const link = document.createElement("a");
    link.textContent = part;
    link.href = /^(?:https?:|\/)/.test(part) ? part : `https://${part}`;
    link.target = "_blank";
    link.rel = "noopener";
    out.append(link);
  });
  return out;
}

let siteWords = "";
function useEditor() {
  site.hidden = true;
  text.hidden = false;
}

async function readSiteFile() {
  text.hidden = true;
  site.hidden = false;
  try {
    const response = await fetch(`/files/${window.siteFile}`);
    if (!response.ok) throw new Error();
    siteWords = await response.text();
    site.replaceChildren(linked(siteWords));
  } catch {
    site.textContent = `Cannot find the ${window.siteFile} file.`;
  }
}

// Save As on a site file saves an editable copy to the disk.
async function saveSiteFile() {
  const to = await saveDialog({ kind: "text", folder: "documents", name: window.siteFile, extension: ".txt" });
  if (!to) return;
  text.value = siteWords;
  const ok = await write(() => (to.replace ? disk.save(to.replace.id, siteWords) : disk.makeFile(to.folder, to.name, siteWords, "text")));
  if (!ok) return;
  window.siteFile = null;
  useEditor();
  title();
}

// --- starting --------------------------------------------------------------

function start() {
  setUpMenus();
  setWrap(true);
  // Someone else changed the open file. Follow a rename, and show their text
  // if nothing's been typed here since.
  addEventListener("diskchange", async (e) => {
    if (!file || !e.detail.items) return;
    const now = e.detail.items.find((item) => item.id === file.id);
    if (!now) return;
    const typed = changed();
    file = now;
    title();
    if (now.version !== version && !typed) {
      const at = [text.selectionStart, text.selectionEnd];
      try {
        const words = await disk.text(now);
        if (changed()) return;
        version = now.version;
        saved = words;
        text.value = words;
        text.setSelectionRange(...at);
      } catch {}
    }
  });
  if (window.siteFile) return readSiteFile();
  const id = new URLSearchParams(location.search).get("id");
  if (id) disk.ready.then(() => load(id));
  else show(null, "");
  text.focus();
}

if (desktop) start();
