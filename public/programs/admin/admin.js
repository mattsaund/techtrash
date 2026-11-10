// The Admin Dashboard, for keeping the shared desktop in order. The tabs:
//
//   Desktop     the lock (only the admin can change things while it's on),
//               how full the disk is, and the Recycle Bin
//   Everything  every file, folder and shortcut, where it is and who made it,
//               to open, restore, delete for good, or keep its maker out
//   Activity    everything anyone has done, newest first
//   Visitors    who's kept out, and letting them back in
//
// The server only answers the admin (the admin routes in server/desktop.js),
// so this page is no use to anyone else even if they open it.

import { LIMITS, bytesText, dateText, iconOf, isFolder, isSound, typeName } from "/js/items.js";
import { showMessage } from "/js/message.js";
import { complain, emptyBin } from "/js/tasks.js";

const desktop = window.top === window ? null : window.top.desktop;
const disk = desktop?.disk;

let activity = [];
let blocked = [];
let moreToCome = true;
const picked = { everything: null, activity: null, visitors: null };

function el(tag, className, parent, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  parent?.append(node);
  return node;
}

// --- tabs ------------------------------------------------------------------

function showTab(name) {
  for (const tab of document.querySelectorAll("[data-tab]")) tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
  for (const panel of document.querySelectorAll("[data-panel]")) panel.hidden = panel.dataset.panel !== name;
}
for (const tab of document.querySelectorAll("[data-tab]")) tab.addEventListener("click", () => showTab(tab.dataset.tab));

// --- a table ---------------------------------------------------------------

// Each column is [heading, (row) => text or a node]. One row can be picked
// at a time.
function table(name, columns, rows, key) {
  const box = document.querySelector(`[data-table=${name}]`);
  box.replaceChildren();
  const head = el("tr", "", el("thead", "", box));
  for (const [heading] of columns) el("th", "", head, heading);
  const body = el("tbody", "", box);
  for (const row of rows) {
    const tr = el("tr", "", body);
    tr.dataset.key = key(row);
    tr.setAttribute("aria-selected", String(picked[name] === tr.dataset.key));
    for (const [, cell] of columns) {
      const value = cell(row);
      const td = el("td", "", tr);
      if (value instanceof Node) td.append(value);
      else td.textContent = value ?? "";
    }
  }
  if (!rows.length) el("td", "table__empty", el("tr", "", body), "Nothing here.").colSpan = columns.length;
}

for (const name of Object.keys(picked)) {
  const box = document.querySelector(`[data-table=${name}]`);
  box.addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-key]");
    if (!tr) return;
    picked[name] = tr.dataset.key;
    for (const one of box.querySelectorAll("tr[data-key]")) one.setAttribute("aria-selected", String(one === tr));
  });
}

const who = (tag) => (tag === "admin" ? "admin" : tag === "system" ? "(the desktop)" : tag);

// --- Desktop ---------------------------------------------------------------

function drawDesktop() {
  const all = disk.all();
  const files = all.filter((item) => item.kind === "file");
  const size = (list) => list.reduce((sum, item) => sum + item.size, 0);
  const music = size(files.filter(isSound));
  const inBin = disk.children("recycle").length;
  document.querySelector("[data-lock]").checked = disk.settings().locked;
  document.querySelector("[data-usage]").textContent =
    `${all.length.toLocaleString("en-US")} things on the disk (${files.length.toLocaleString("en-US")} of them files), using ${bytesText(size(files) - music)} of ${bytesText(LIMITS.bytes)}, plus ${bytesText(music)} of ${bytesText(LIMITS.music)} for music. ${inBin} in the Recycle Bin.`;
  document.querySelector("[data-empty]").disabled = !inBin;
}

document.querySelector("[data-lock]").addEventListener("change", async (e) => {
  try {
    await disk.lock(e.target.checked);
  } catch (error) {
    await complain("Admin Dashboard", error);
  }
  drawDesktop();
});
document.querySelector("[data-empty]").addEventListener("click", emptyBin);
document.querySelector("[data-open-bin]").addEventListener("click", () => desktop.open("recycle-bin"));

// --- Everything ------------------------------------------------------------

const where = (item) => disk.path(item.parent).map((one) => one.name).join("\\") || "(the disk)";

function picture(item) {
  const span = el("span", "table__name");
  const img = el("img", "", span);
  img.src = iconOf(item, disk.binFull());
  img.alt = "";
  el("span", "", span, item.name);
  return span;
}

function drawEverything() {
  const find = document.querySelector("[data-find]").value.trim().toLowerCase();
  const items = disk.all()
    .filter((item) => !["desktop", "documents", "pictures", "music", "recycle"].includes(item.id))
    .filter((item) => !find || [item.name, where(item), item.madeBy].some((text) => text.toLowerCase().includes(find)))
    .sort((a, b) => b.modified - a.modified);
  table("everything", [
    ["Name", picture],
    ["Where", where],
    ["Type", typeName],
    ["Size", (item) => (item.kind === "file" ? bytesText(item.size) : "")],
    ["Made by", (item) => who(item.madeBy)],
    ["Modified", (item) => dateText(item.modified)],
  ], items, (item) => item.id);
}

document.querySelector("[data-find]").addEventListener("input", drawEverything);

const chosenItem = () => picked.everything && disk.item(picked.everything);

async function needItem() {
  const item = chosenItem();
  if (!item) await showMessage({ title: "Admin Dashboard", text: "Pick something in the list first.", icon: "information" });
  return item;
}

document.querySelector("[data-act=open]").addEventListener("click", async () => {
  const item = await needItem();
  if (item) desktop.openItem(item);
});

document.querySelector("[data-act=restore]").addEventListener("click", async () => {
  const item = await needItem();
  if (!item) return;
  if (item.parent !== "recycle") return showMessage({ title: "Admin Dashboard", text: `${item.name} isn't in the Recycle Bin.`, icon: "information" });
  try {
    await disk.restore(item.id);
  } catch (error) {
    await complain("Admin Dashboard", error);
  }
});

document.querySelector("[data-act=delete]").addEventListener("click", async () => {
  const item = await needItem();
  if (!item) return;
  const inside = isFolder(item) ? " and everything in it" : "";
  const answer = await showMessage({ title: "Confirm File Delete", text: `Are you sure you want to delete '${item.name}'${inside} for good?\n\nIt won't go to the Recycle Bin: it'll be gone.`, icon: "delete", buttons: ["Yes", "No"] });
  if (answer !== "Yes") return;
  try {
    await disk.remove(item.id, true);
  } catch (error) {
    await complain("Admin Dashboard", error);
  }
});

document.querySelector("[data-act=block]").addEventListener("click", async () => {
  const item = await needItem();
  if (item) keepOut(item.madeBy);
});

// --- Activity --------------------------------------------------------------

function drawActivity() {
  table("activity", [
    ["When", (entry) => dateText(entry.at)],
    ["Who", (entry) => who(entry.who)],
    ["What", (entry) => entry.what],
    ["Name", (entry) => entry.name],
    ["", (entry) => entry.detail],
  ], activity, (entry) => String(entry.id));
  document.querySelector("[data-more]").disabled = !moreToCome;
}

async function loadActivity(more = false) {
  try {
    const { activity: rows } = await disk.activity(more ? activity.at(-1)?.id : null);
    activity = more ? [...activity, ...rows] : rows;
    moreToCome = rows.length === 200;
    drawActivity();
  } catch (error) {
    await complain("Admin Dashboard", error);
  }
}

document.querySelector("[data-refresh]").addEventListener("click", () => loadActivity());
document.querySelector("[data-more]").addEventListener("click", () => loadActivity(true));
document.querySelector("[data-act=block-who]").addEventListener("click", async () => {
  const entry = activity.find((one) => String(one.id) === picked.activity);
  if (!entry) return showMessage({ title: "Admin Dashboard", text: "Pick something someone did first.", icon: "information" });
  keepOut(entry.who);
});

// --- Visitors --------------------------------------------------------------

function drawVisitors() {
  table("visitors", [["Visitor kept out", (tag) => tag]], blocked, (tag) => tag);
}

async function keepOut(tag) {
  if (!tag || tag === "admin" || tag === "system") {
    return showMessage({ title: "Admin Dashboard", text: "That was the admin, or the desktop itself: there's nobody to keep out.", icon: "information" });
  }
  const answer = await showMessage({ title: "Admin Dashboard", text: `Keep visitor ${tag} out?\n\nThey'll still be able to look, but not change anything.`, icon: "question", buttons: ["Yes", "No"] });
  if (answer !== "Yes") return;
  await setBlocked(tag, true);
  showTab("visitors");
}

async function setBlocked(tag, on) {
  try {
    ({ blocked } = await disk.block(tag, on));
    drawVisitors();
  } catch (error) {
    await complain("Admin Dashboard", error);
  }
}

document.querySelector("[data-keep-out]").addEventListener("submit", (e) => {
  e.preventDefault();
  const field = document.getElementById("visitor");
  keepOut(field.value.trim().toLowerCase());
  field.value = "";
});
document.querySelector("[data-act=let-in]").addEventListener("click", async () => {
  if (!picked.visitors) return showMessage({ title: "Admin Dashboard", text: "Pick a visitor first.", icon: "information" });
  await setBlocked(picked.visitors, false);
});

// --- starting --------------------------------------------------------------

async function start() {
  let overview;
  try {
    await disk.ready;
    overview = await disk.overview();
  } catch (error) {
    document.body.replaceChildren();
    await showMessage({ title: "Admin Dashboard", text: error.status === 401 ? "Only the admin can open the Admin Dashboard." : error.message });
    return desktop.close(window);
  }
  activity = overview.activity;
  moreToCome = activity.length === 200;
  blocked = overview.blocked;
  drawDesktop();
  drawEverything();
  drawActivity();
  drawVisitors();
  // Redraws as the disk changes, and reloads the activity a second after the
  // last change.
  let soon = null;
  addEventListener("diskchange", () => {
    drawDesktop();
    drawEverything();
    clearTimeout(soon);
    soon = setTimeout(() => loadActivity(), 1000);
  });
}

if (desktop) start();
