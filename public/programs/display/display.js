// Display Properties, XP's Desktop tab only. Apply sets the wallpaper for
// everyone (server/disk.js). The list holds (None), XP's wallpapers and
// My Pictures. Browse can pick any picture on the disk.

import { openDialog } from "/js/file-dialog.js";
import { iconOf, isPicture, sortItems } from "/js/items.js";
import { showMessage } from "/js/message.js";
import { WALLPAPERS, wallpaperUrl } from "/js/wallpapers.js";

const desktop = window.top === window ? null : window.top.desktop;
const disk = desktop?.disk;

const list = document.querySelector(".display__list");
const screen = document.querySelector(".monitor__screen");
const position = document.getElementById("position");
const color = document.getElementById("color");
const apply = document.querySelector("[data-apply]");

const XP = "/img/icons/xp";
const MONITOR_W = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--monitor-w"), 10);
const BLUE = getComputedStyle(document.documentElement).getPropertyValue("--desktop").trim();

// Preview scale, relative to this visitor's desktop.
const scale = () => MONITOR_W / (window.top.document.querySelector(".desktop")?.clientWidth || 800);

let choice = { image: "", position: "stretch", color: "" };   // selection in this dialog
let extra = null;   // Browse pick from outside My Pictures

// List rows as [image, name, icon].
function options() {
  const pictures = sortItems(disk.children("pictures").filter(isPicture));
  const shown = [...pictures];
  for (const id of [choice.image, extra].filter((image) => image?.startsWith("file:")).map((image) => image.slice(5))) {
    const item = disk.item(id);
    if (item && isPicture(item) && !shown.some((one) => one.id === id)) shown.push(item);
  }
  return [
    ["", "(None)", null],
    ...WALLPAPERS.map((one) => [`xp:${one.id}`, one.name, `${XP}/jpg.png`]),
    ...shown.map((item) => [`file:${item.id}`, item.name, iconOf(item)]),
  ];
}

const urlOf = (image) => wallpaperUrl(image, disk.item(image.slice(5)));

function drawList() {
  list.replaceChildren();
  for (const [image, name, icon] of options()) {
    const row = document.createElement("div");
    row.className = "dialog__file";
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(image === choice.image));
    row.dataset.image = image;
    const img = document.createElement("img");
    img.alt = "";
    if (icon) img.src = icon;
    else img.hidden = true;
    const label = document.createElement("span");
    label.textContent = name;
    row.append(img, label);
    list.append(row);
  }
  list.querySelector("[aria-selected=true]")?.scrollIntoView({ block: "nearest" });
}

// Preview at this visitor's desktop scale. Center and tile need the image's
// natural size.
function drawMonitor() {
  const url = urlOf(choice.image);
  screen.style.setProperty("--wallpaper-image", url ? `url("${url}")` : "none");
  screen.style.setProperty("--wallpaper-color", choice.color || BLUE);
  screen.dataset.wallpaper = choice.position;
  screen.style.backgroundSize = "";
  if (url && choice.position !== "stretch") {
    const probe = new Image();
    probe.onload = () => {
      if (urlOf(choice.image) !== url || choice.position === "stretch") return;
      screen.style.backgroundSize = `${Math.round(probe.naturalWidth * scale())}px ${Math.round(probe.naturalHeight * scale())}px`;
    };
    probe.src = url;
  }
}

function draw() {
  position.value = choice.position;
  color.value = choice.color || BLUE;
  drawList();
  drawMonitor();
}

const same = (a, b) => a.image === b.image && a.position === b.position && (a.color || "") === (b.color || "");
const current = () => ({ image: "", position: "stretch", color: "", ...disk.settings().wallpaper });

function pick(changes) {
  choice = { ...choice, ...changes };
  apply.disabled = same(choice, current());
  draw();
}

list.addEventListener("click", (e) => {
  const row = e.target.closest("[data-image]");
  if (row) pick({ image: row.dataset.image });
});
list.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const images = options().map(([image]) => image);
  const at = images.indexOf(choice.image);
  const next = images[Math.max(0, Math.min(images.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))];
  pick({ image: next });
});
position.addEventListener("change", () => pick({ position: position.value }));
color.addEventListener("input", () => pick({ color: color.value === BLUE ? "" : color.value }));

document.querySelector("[data-browse]").addEventListener("click", async () => {
  const item = await openDialog({ kind: "picture", folder: "pictures" });
  if (!item) return;
  extra = `file:${item.id}`;
  pick({ image: extra });
});

// Applies for everyone. False if the disk refused.
async function save() {
  if (same(choice, current())) return true;
  try {
    await disk.setWallpaper(choice);
    apply.disabled = true;
    return true;
  } catch (error) {
    await showMessage({ title: "Display Properties", text: error.message });
    return false;
  }
}

apply.addEventListener("click", save);
document.querySelector("[data-ok]").addEventListener("click", async () => {
  if (await save()) desktop.close(window);
});
document.querySelector("[data-cancel]").addEventListener("click", () => desktop.close(window));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !document.querySelector(".layer")) desktop.close(window);
});

function start() {
  disk.ready.then(() => {
    choice = current();
    draw();
    list.focus();
  });
  // Follow others' wallpaper changes unless there's an unapplied pick here.
  addEventListener("diskchange", (e) => {
    if (e.detail.settings && apply.disabled) choice = current();
    if (e.detail.settings || e.detail.items || e.detail.gone) {
      apply.disabled = same(choice, current());
      draw();
    }
  });
}

if (desktop) start();
