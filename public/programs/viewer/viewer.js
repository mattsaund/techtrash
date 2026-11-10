// The Windows Picture and Fax Viewer. Pictures on the shared disk open in it,
// as they did on XP.
//
// Previous and Next go through the other pictures in the folder, and the
// slide show runs through them all until Esc or a click. Delete asks first,
// Edit opens Paint, and Set as Desktop Background changes everyone's
// wallpaper. The keys are XP's.

import { fileUrl, isPicture, sortItems } from "/js/items.js";
import { deleteItems, setAsWallpaper } from "/js/tasks.js";

const desktop = window.top === window ? null : window.top.desktop;
const disk = desktop?.disk;

const SHOW_EVERY_MS = 4000;
const ZOOMS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];

const stage = document.querySelector(".viewer__stage");
const picture = document.querySelector(".viewer__picture");
const empty = document.querySelector(".viewer__empty");

let item = null;     // the picture shown
let zoom = null;     // null to fit the window, or a scale
let showing = null;  // the slide show's timer

// The pictures in this one's folder, in order.
const neighbors = () => (item ? sortItems(disk.children(item.parent).filter(isPicture)) : []);

function show(next) {
  item = next;
  const title = item ? `${item.name} - Windows Picture and Fax Viewer` : "Windows Picture and Fax Viewer";
  if (document.title !== title) document.title = title;
  picture.hidden = !item;
  empty.hidden = Boolean(item);
  if (item && picture.getAttribute("src") !== fileUrl(item)) picture.src = fileUrl(item);
  picture.alt = item?.name ?? "";
  const search = item ? `?id=${encodeURIComponent(item.id)}` : "";
  if (location.search !== search) {
    history.replaceState(null, "", location.pathname + search);
    dispatchEvent(new Event("addresschange"));
  }
  size();
}

// Sizes the picture to fit, or scales it from its own size.
function size() {
  stage.classList.toggle("is-fit", zoom === null);
  if (zoom === null || !picture.naturalWidth) {
    picture.style.width = picture.style.height = "";
    return;
  }
  picture.style.width = `${Math.round(picture.naturalWidth * zoom)}px`;
  picture.style.height = `${Math.round(picture.naturalHeight * zoom)}px`;
}
picture.addEventListener("load", size);

// The scale Best Fit comes to, so zooming starts from there.
function fittedScale() {
  if (!picture.naturalWidth) return 1;
  return Math.min(1, stage.clientWidth / picture.naturalWidth, stage.clientHeight / picture.naturalHeight);
}

function zoomBy(direction) {
  const now = zoom ?? fittedScale();
  zoom = direction > 0 ? ZOOMS.find((z) => z > now + 0.001) ?? ZOOMS.at(-1) : [...ZOOMS].reverse().find((z) => z < now - 0.001) ?? ZOOMS[0];
  size();
}

function step(by) {
  const all = neighbors();
  if (!all.length) return;
  const at = all.findIndex((one) => one.id === item?.id);
  zoom = null;
  show(all[(at + by + all.length) % all.length]);
}

function startShow() {
  if (showing || !item) return;
  document.body.classList.add("is-show");
  zoom = null;
  size();
  showing = setInterval(() => step(1), SHOW_EVERY_MS);
  stage.focus();
}

function stopShow() {
  if (!showing) return;
  clearInterval(showing);
  showing = null;
  document.body.classList.remove("is-show");
}

const ACTIONS = {
  previous: () => step(-1),
  next: () => step(1),
  fit: () => { zoom = null; size(); },
  actual: () => { zoom = 1; size(); },
  show: startShow,
  in: () => zoomBy(1),
  out: () => zoomBy(-1),
  async delete() {
    const was = item;
    const all = neighbors();
    if (!was || !(await deleteItems([was]))) return;
    const rest = all.filter((one) => one.id !== was.id);
    show(rest[Math.min(all.findIndex((one) => one.id === was.id), rest.length - 1)] ?? null);
  },
  edit: () => item && desktop.open("paint", `?id=${item.id}`),
  wallpaper: () => item && setAsWallpaper(item),
};

for (const button of document.querySelectorAll("[data-act]")) {
  button.addEventListener("click", () => ACTIONS[button.dataset.act]());
}
stage.addEventListener("click", stopShow);

document.addEventListener("keydown", (e) => {
  if (document.querySelector(".layer")) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (showing && (e.key === "Escape" || e.key === " ")) stopShow();
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") step(-1);
  else if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "PageDown") step(1);
  else if (e.key === "+" || e.key === "=") zoomBy(1);
  else if (e.key === "-") zoomBy(-1);
  else if (e.key === "Delete") ACTIONS.delete();
  else if (ctrl && e.key.toLowerCase() === "e") ACTIONS.edit();
  else if (e.key === "F11") startShow();
  else if (ctrl && e.key.toLowerCase() === "b") ACTIONS.fit();
  else if (ctrl && e.key.toLowerCase() === "a") ACTIONS.actual();
  else return;
  e.preventDefault();
});

function start() {
  // Someone else's change. Show their new version, or if the picture's gone,
  // the first one left in its folder.
  addEventListener("diskchange", (e) => {
    if (!item || e.detail.settings) return;
    const now = disk.item(item.id);
    if (now && isPicture(now) && !disk.inBin(now.id)) show(now);
    else if (!now || disk.inBin(now.id)) show(neighbors()[0] ?? null);
  });
  disk.ready.then(() => {
    const id = new URLSearchParams(location.search).get("id");
    const first = id && disk.item(id);
    show(first && isPicture(first) ? first : null);
    stage.focus();
  });
}

if (desktop) start();
