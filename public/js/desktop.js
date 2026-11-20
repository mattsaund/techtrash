// The desktop: start menu, taskbar and app windows (iframes).
// Windows are per visitor. Icons, disk and wallpaper are shared, but the
// socket (js/shared.js) only opens once someone uses the desktop.
// Only geometry and the wallpaper are set inline. The rest is css/ classes and tokens.

import { APPS, GROUPS, HOME, PLACES, SHORTCUTS, findApp } from "./apps.js";
import { disk } from "./disk.js";
import { setUpIcons } from "./icons.js";
import { opener } from "./items.js";
import { closeMenu, showMenu } from "./menu.js";
import { showMessage } from "./message.js";
import { setUpSession } from "./session.js";
import { line } from "./shared.js";
import { wallpaperUrl } from "./wallpapers.js";

const css = getComputedStyle(document.documentElement);
const num = (name) => parseInt(css.getPropertyValue(name), 10);

const WINDOW_W = num("--window-w");
const WINDOW_H = num("--window-h");
const MIN_W = num("--window-min-w");
const MIN_H = num("--window-min-h");
const TITLE_H = num("--title-h");
const FRAME = num("--frame");                 // frame width: left, right and bottom
const KEEP = num("--sp-48");                  // px of a window always kept on screen
const FIRST = {                               // first window's spot, clear of the icons
  x: num("--icon-cell") + num("--sp-24"),
  y: num("--sp-24"),
};
const Z_WINDOW = num("--z-window");
const phone = matchMedia(`(max-width: ${css.getPropertyValue("--breakpoint").trim()})`);

const desktop = document.querySelector(".desktop");
const iconBox = document.querySelector(".desktop__icons");
const taskBox = document.querySelector(".taskbar__tasks");
const startButton = document.querySelector(".start");
const startMenu = document.getElementById("start-menu");
const template = document.getElementById("window-template");
const lock = document.querySelector(".tray__lock");

const stack = [];   // open windows, back to front
let front = null;   // active window, or null for the bare desktop
let cascade = 0;    // next window's offset, in title bars
let made = 0;       // windows ever opened, for unique ids
let clipboard = []; // item ids from Cut (js/tasks.js)

function make(tag, className, parent) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  parent?.append(el);
  return el;
}

function picture(src, className, parent) {
  const img = make("img", className, parent);
  img.src = src;
  img.alt = "";
  return img;
}

// API for the apps' pages, as window.top.desktop (same origin).
// Set before any window opens.
window.desktop = {
  open: (id, rest) => open(id, rest),
  openItem: (item) => openItem(item),
  // For File > Exit. ask: false when the program already asked about unsaved work.
  close(inner, { ask = true } = {}) {
    const win = stack.find((w) => w.frame.contentWindow === inner);
    if (win) close(win, { ask });
  },
  // Sizes a window to its page (Mines, per level). width and height exclude the frame.
  fit(inner, width, height) {
    const win = stack.find((w) => w.frame.contentWindow === inner);
    if (!win) return;
    const { width: room, height: tall } = desktop.getBoundingClientRect();
    win.rect.w = Math.min(Math.ceil(width) + 2 * FRAME, room);
    win.rect.h = Math.min(Math.ceil(height) + TITLE_H + FRAME, tall);
    keepOnScreen(win.rect);
    place(win);
  },
  arrived,
  disk,
  clipboard: () => clipboard,
  setClipboard(ids) {
    clipboard = ids;
    icons.refresh();
    tellWindows({ clipboard: true });
  },
};

// --- socket ----------------------------------------------------------------

// Connect on the first input on this page, or when a non-blog app opens.
// Input inside the blog's iframe doesn't reach here.
const wake = () => line.wake();
addEventListener("pointerdown", wake, { capture: true, once: true });
addEventListener("keydown", wake, { capture: true, once: true });

// Forwards disk changes to every window as a "diskchange" event.
// detail is { items, gone, all }, { settings } or { clipboard }.
function tellWindows(detail) {
  for (const win of stack) {
    try {
      const inner = win.frame.contentWindow;
      inner.dispatchEvent(new inner.CustomEvent("diskchange", { detail }));
    } catch {}
  }
}
disk.watch(tellWindows);

// --- wallpaper and lock ----------------------------------------------------

// Shared wallpaper, from the disk's settings (shape in js/wallpapers.js).
// A disk picture shows only while it still exists.
function showWallpaper() {
  const { wallpaper, locked, url: sent } = disk.settings();
  const image = wallpaper?.image ?? "";
  // Before the disk loads, a disk picture uses its last known URL.
  const url = wallpaperUrl(image, disk.item(image.slice(5))) || (image.startsWith("file:") && !disk.loaded() ? sent ?? "" : "");
  const value = url ? `url("${url}")` : "none";
  if (desktop.style.getPropertyValue("--wallpaper-image") !== value) desktop.style.setProperty("--wallpaper-image", value);
  if (wallpaper?.color) desktop.style.setProperty("--wallpaper-color", wallpaper.color);
  else desktop.style.removeProperty("--wallpaper-color");
  desktop.dataset.wallpaper = wallpaper?.position ?? "stretch";
  // Tray padlock shows while the desktop is locked.
  lock.hidden = !locked;
}
disk.watch(showWallpaper);

// Wallpaper waits until after the website's load so it never slows it down.
// This browser's last one first, then the shared one via disk.peek() (no socket).
function afterLoad(work) {
  const later = () => setTimeout(() => (window.requestIdleCallback ? requestIdleCallback(work, { timeout: 4000 }) : work()), 1500);
  if (document.readyState === "complete") later();
  else addEventListener("load", later, { once: true });
}
afterLoad(() => {
  showWallpaper();
  disk.peek();
});

// --- launchers -------------------------------------------------------------

// Clicking the bare desktop deactivates every window, like XP.
const icons = setUpIcons({
  layer: iconBox,
  openItem,
  openApp: (id) => open(id),
  onBareDesktop: () => activate(null),
});

// A start menu entry. Its right-click Send To > Desktop is how a deleted
// shortcut comes back.
function startItem(list, { title, icon }, id, rest = "") {
  const li = make("li", "", list);
  const item = make("a", "start-menu__item", li);
  item.href = `#${id}${rest ? `/${rest}` : ""}`;
  picture(icon, "", item);
  make("span", "", item).textContent = title;
  item.addEventListener("click", (e) => {
    e.preventDefault();
    showStart(false);
    open(id, rest);
  });
  item.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const shortcut = !rest && findApp(id);
    showMenu([
      { label: "Open", bold: true, action: () => { showStart(false); open(id, rest); } },
      "-",
      { label: "Send To", disabled: !shortcut, submenu: [
        { label: "Desktop (create shortcut)", icon: "/img/icons/xp/desktop.png", action: () => sendToDesktop(id) },
      ] },
    ], { x: e.clientX, y: e.clientY });
  });
  return li;
}

async function sendToDesktop(id) {
  showStart(false);
  try {
    await disk.makeShortcut("desktop", id);
  } catch (error) {
    await showMessage({ title: "Error Creating Shortcut", text: error.message });
  }
}

const rule = (list) => make("li", "start-menu__rule", list).setAttribute("role", "separator");

const programs = startMenu.querySelector(".start-menu__programs");
const places = startMenu.querySelector(".start-menu__places");
for (const app of APPS) {
  if (app.kind === "program" && app.pinned) startItem(programs, app, app.id);
}
rule(programs);
for (const shortcut of SHORTCUTS) startItem(programs, shortcut, shortcut.app, shortcut.rest);

// All Programs, with Accessories and Games as submenus like XP.
const allButton = startMenu.querySelector(".start-menu__all");
function allPrograms() {
  const entry = (app) => ({ label: app.title, icon: app.icon, action: () => { showStart(false); open(app.id); } });
  const listed = APPS.filter((app) => app.kind === "program" && app.listed !== false);
  const entries = GROUPS.map((group) => ({
    label: group.title,
    icon: "/img/icons/xp/folder.png",
    submenu: listed.filter((app) => app.group === group.id).map(entry),
  }));
  entries.push(...listed.filter((app) => !app.group).map(entry));
  const r = allButton.getBoundingClientRect();
  showMenu(entries, { x: r.right, y: r.top }, { first: false });
}
allButton.addEventListener("click", allPrograms);
for (const app of APPS) {
  if (app.kind === "page") startItem(places, app, app.id);
}
const adminPlaces = [];
for (const place of PLACES) {
  if (place === "-") {
    rule(places);
    continue;
  }
  const li = startItem(places, place, place.app, place.rest);
  if (place.admin) {
    li.hidden = true;
    adminPlaces.push(li);
  }
}

// --- start menu ------------------------------------------------------------

function showStart(show) {
  if (!show) closeMenu();
  startMenu.hidden = !show;
  startButton.setAttribute("aria-expanded", String(show));
}

startButton.addEventListener("click", () => showStart(startMenu.hidden));

// Close on a press outside. All Programs' menus (.menu--pop) count as inside.
document.addEventListener("pointerdown", (e) => {
  if (startMenu.hidden || startMenu.contains(e.target) || startButton.contains(e.target) || e.target.closest(".menu--pop")) return;
  showStart(false);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !startMenu.hidden) {
    showStart(false);
    startButton.focus();
  }
});

// Log Off closes every window (js/session.js asks first).
const session = setUpSession({
  closeAll: () => [...stack].forEach((win) => close(win, { ask: false })),
  // Permissions differ by user, so a user change reconnects the socket and
  // reloads every window.
  onUser: async (user, { changed }) => {
    disk.admin = user === "admin";
    adminPlaces.forEach((li) => { li.hidden = !disk.admin; });
    if (!changed) return;
    line.again();
    // Unsaved work asks first. Cancel keeps that window as it is.
    for (const win of [...stack]) {
      if (await letsGo(win)) win.frame.contentWindow?.location.reload();
    }
  },
});
startMenu.querySelector("[data-ask-log-off]").addEventListener("click", () => {
  showStart(false);
  session.askToLogOff();
});

// --- windows ---------------------------------------------------------------

// Opens an app at rest ("?folder=pictures"), or brings its window to the front.
// A multi app gets a window per rest.
function open(id, rest = "", { maximized = false } = {}) {
  const app = findApp(id);
  if (!app) return null;
  if (app.opens) return open(app.opens[0], rest || app.opens[1], { maximized });
  if (app !== HOME) wake();
  let win = app.multi
    ? (rest ? stack.find((w) => w.app === app && w.rest === rest) : null)
    : stack.find((w) => w.app === app);
  if (!win) win = create(app, rest, maximized);
  else if (!app.multi && rest && rest !== win.rest) win.frame.src = app.url + rest;
  win.el.hidden = false;
  activate(win);
  win.frame.focus();
  return win;
}

// Opens a disk item in its app (js/items.js opener).
function openItem(item) {
  const { app, rest } = opener(item);
  open(app, rest);
}

function create(app, rest, maximized) {
  const el = template.content.firstElementChild.cloneNode(true);
  const bar = el.querySelector(".title-bar");
  const title = el.querySelector(".title-bar__text");
  const frame = el.querySelector(".window__frame");
  const task = make("button", "task");
  picture(app.icon, "task__icon", task);
  const label = make("span", "task__label", task);
  const fixed = Boolean(app.fixed);

  title.id = `window-${++made}`;
  el.dataset.app = app.id;
  el.setAttribute("aria-labelledby", title.id);
  el.querySelector(".title-bar__icon").src = app.icon;
  el.classList.toggle("is-fixed", fixed);

  // rect is the restored size, even when opening maximized.
  const win = { app, el, frame, task, rest, maximized: maximized && !fixed, rect: firstRect(app) };
  const rename = (text) => {
    title.textContent = label.textContent = text;
    frame.title = task.title = text;
  };
  rename(app.title);
  // The page's own icon if it has one (the File Browser shows its folder's).
  const reicon = (page) => {
    const src = page.querySelector("link[rel=icon]")?.href ?? app.icon;
    for (const img of [el.querySelector(".title-bar__icon"), task.querySelector(".task__icon")]) {
      if (img.src !== src) img.src = src;
    }
  };

  // Mirrors the page's title, icon and address. Hooked once per page, on
  // DOMContentLoaded via js/app.js, or on load as a fallback.
  let hooked = null;
  win.hook = () => {
    const inner = frame.contentWindow;
    const page = frame.contentDocument;
    if (!page || page === hooked) return;
    hooked = page;
    rename(page.title || app.title);
    reicon(page);
    // Title and icon can change without a reload (the blog does).
    new MutationObserver(() => {
      rename(page.title || app.title);
      reicon(page);
    }).observe(page.head, { subtree: true, childList: true, characterData: true, attributes: true });
    // So can the URL. Pages fire "addresschange" when they change it in place.
    const follow = () => {
      const path = inner.location.pathname + inner.location.search;
      win.rest = path.startsWith(app.url) ? path.slice(app.url.length) : "";
      if (front === win) address();
    };
    inner.addEventListener("addresschange", follow);
    inner.addEventListener("pointerdown", () => {
      activate(win);
      showStart(false);
    });
    follow();
  };
  frame.addEventListener("load", win.hook);
  frame.src = app.url + rest;

  el.addEventListener("pointerdown", () => activate(win), true);
  el.querySelector(".caption--min").addEventListener("click", () => minimize(win));
  el.querySelector(".caption--max").addEventListener("click", () => maximize(win, !win.maximized));
  el.querySelector(".caption--close").addEventListener("click", () => close(win));
  bar.addEventListener("dblclick", (e) => {
    if (!e.target.closest("button") && !fixed) maximize(win, !win.maximized);
  });
  bar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button") || win.maximized || phone.matches) return;
    const grab = { x: e.clientX - win.rect.x, y: e.clientY - win.rect.y };
    follow(e, (move) => {
      win.rect.x = Math.round(move.clientX - grab.x);
      win.rect.y = Math.round(move.clientY - grab.y);
      keepOnScreen(win.rect);
      place(win);
    });
  });
  for (const grip of el.querySelectorAll(".window__grip")) {
    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || win.maximized || fixed || phone.matches) return;
      resize(win, grip.dataset.edge, e);
    });
  }

  task.addEventListener("click", () => {
    if (front === win && !win.el.hidden) {
      minimize(win);
    } else {
      win.el.hidden = false;
      activate(win);
      win.frame.focus();
    }
  });

  stack.push(win);
  desktop.append(el);
  taskBox.append(task);
  place(win);
  return win;
}

// Cascades new windows one title bar down and across, back to the top when one
// wouldn't fit. Size is app.size or XP's 640 x 480, clamped to the screen.
function firstRect(app) {
  const { width, height } = desktop.getBoundingClientRect();
  const w = Math.min(app.size ? num(app.size[0]) : WINDOW_W, width);
  const h = Math.min(app.size ? num(app.size[1]) : WINDOW_H, height);
  if (stack.length === 0) cascade = 0;
  let x = FIRST.x + cascade * TITLE_H;
  let y = FIRST.y + cascade * TITLE_H;
  if (x + w > width || y + h > height) {
    cascade = 0;
    x = FIRST.x;
    y = FIRST.y;
  }
  cascade += 1;
  return {
    x: Math.max(0, Math.min(x, width - w)),
    y: Math.max(0, Math.min(y, height - h)),
    w,
    h,
  };
}

// On a phone every window fills the screen.
function place(win) {
  const full = win.maximized || phone.matches;
  const s = win.el.style;
  win.el.classList.toggle("is-maximized", full);
  win.el.querySelector(".caption--max").setAttribute("aria-label", full ? "Restore" : "Maximize");
  if (full) {
    s.left = s.top = "0";
    s.width = s.height = "100%";
  } else {
    s.left = `${win.rect.x}px`;
    s.top = `${win.rect.y}px`;
    s.width = `${win.rect.w}px`;
    s.height = `${win.rect.h}px`;
  }
}

// Keep enough of the title bar on screen to grab it.
function keepOnScreen(rect) {
  const { width, height } = desktop.getBoundingClientRect();
  rect.x = Math.min(Math.max(rect.x, KEEP - rect.w), width - KEEP);
  rect.y = Math.min(Math.max(rect.y, 0), height - TITLE_H);
}

function resize(win, edge, down) {
  const start = { ...win.rect };
  const bottom = start.y + start.h;
  follow(down, (move) => {
    const dx = Math.round(move.clientX - down.clientX);
    const dy = Math.round(move.clientY - down.clientY);
    const r = { ...start };
    if (edge.includes("e")) r.w = Math.max(MIN_W, start.w + dx);
    if (edge.includes("s")) r.h = Math.max(MIN_H, start.h + dy);
    if (edge.includes("w")) {
      r.w = Math.max(MIN_W, start.w - dx);
      r.x = start.x + start.w - r.w;
    }
    if (edge.includes("n")) {
      r.y = Math.max(0, Math.min(start.y + dy, bottom - MIN_H));
      r.h = bottom - r.y;
    }
    win.rect = r;
    place(win);
  });
}

// Follows one drag, calling onMove until pointerup.
function follow(down, onMove) {
  const target = down.currentTarget;
  down.preventDefault();
  target.setPointerCapture(down.pointerId);
  desktop.classList.add("is-busy");
  const end = () => {
    desktop.classList.remove("is-busy");
    target.removeEventListener("pointermove", onMove);
    target.removeEventListener("pointerup", end);
    target.removeEventListener("pointercancel", end);
  };
  target.addEventListener("pointermove", onMove);
  target.addEventListener("pointerup", end);
  target.addEventListener("pointercancel", end);
}

function activate(win) {
  if (win) stack.push(...stack.splice(stack.indexOf(win), 1));
  front = win;
  stack.forEach((w, i) => {
    w.el.style.zIndex = Z_WINDOW + i;
    w.el.classList.toggle("is-inactive", w !== win);
    w.task.classList.toggle("is-active", w === win);
    w.task.setAttribute("aria-pressed", String(w === win));
  });
  address();
}

function topmost() {
  return [...stack].reverse().find((w) => !w.el.hidden) ?? null;
}

function minimize(win) {
  win.el.hidden = true;
  if (front === win) activate(topmost());
}

function maximize(win, on) {
  win.maximized = on;
  place(win);
}

// A page with unsaved work sets window.mayClose, which resolves false to stay open.
async function close(win, { ask = true } = {}) {
  if (ask && !(await letsGo(win))) return;
  if (!stack.includes(win)) return;
  stack.splice(stack.indexOf(win), 1);
  win.el.remove();
  win.task.remove();
  if (front === win) activate(topmost());
}

// False only when the page's mayClose says stay. Errors let it close.
async function letsGo(win) {
  try {
    return (await win.frame.contentWindow?.mayClose?.()) !== false;
  } catch {
    return true;
  }
}

// --- address ---------------------------------------------------------------
//
// The hash follows the front window: #<app>/<rest> (#notepad/?file=credits.txt).
// The website's rests are paths (?blog/liftoff) and show bare (#blog/liftoff).
// Its front page has no hash.

// "?blog/liftoff" -> "blog/liftoff". Null for a real query (the old ?post=3,
// which the site redirects).
function siteHash(rest) {
  if (!rest) return "";
  return rest.startsWith("?") && !/[=&]/.test(rest) ? rest.slice(1) : null;
}

const siteRest = (path) => (path ? `?${path}` : "");

function address() {
  let hash = front ? `#${front.app.id}${front.rest ? `/${front.rest}` : ""}` : "";
  const short = front?.app === HOME ? siteHash(front.rest) : null;
  if (short !== null) hash = short ? `#${short}` : "";
  if (hash !== location.hash) history.replaceState(null, "", hash || location.pathname);
}

// The hash as { app, rest }. #files and #notepad/... are apps. Anything else
// is a website path (#blog/liftoff), or the old #blog/?post=3.
function fromAddress() {
  const m = location.hash.match(/^#([\w-]+)(?:\/(.*))?$/);
  if (!m) return { app: HOME, rest: "" };
  const app = findApp(m[1]);
  if (app && app !== HOME) return { app, rest: m[2] ?? "" };
  // Old #blog/?post=3, or #blog/ for the front page. Bare #blog is the Blog page.
  if (app === HOME && (m[2] === "" || m[2]?.startsWith("?"))) return { app: HOME, rest: m[2] };
  return { app: HOME, rest: siteRest(location.hash.slice(1)) };
}

// The hash catches up once the page loads (see create).
function openFromAddress() {
  const { app, rest } = fromAddress();
  open(app.id, rest);
}

addEventListener("hashchange", openFromAddress);

// --- focus and resize ------------------------------------------------------

// Focus moving into an iframe only blurs this page. Once it settles, bring
// the focused window to the front.
addEventListener("blur", () => {
  showStart(false);
  setTimeout(() => {
    const win = stack.find((w) => w.frame === document.activeElement);
    if (win && win !== front) activate(win);
  });
});

addEventListener("resize", () => {
  for (const win of stack) {
    keepOnScreen(win.rect);
    place(win);
  }
});
phone.addEventListener("change", () => stack.forEach(place));

// --- clock -----------------------------------------------------------------

const clock = document.querySelector(".tray__clock");
document.querySelector(".tray__clock-button").addEventListener("click", () => open("datetime"));
function tick() {
  const now = new Date();
  clock.textContent = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  clock.dateTime = now.toISOString();
  clock.title = now.toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}
tick();
setInterval(tick, 10000);

// Called by js/app.js on DOMContentLoaded.
function arrived(inner) {
  stack.find((w) => w.frame.contentWindow === inner)?.hook();
}

// Every visit opens the website maximized, at the hash if it's a website path.
// Another app's hash (#files) opens that app in front.
function arrive() {
  const { app, rest } = fromAddress();
  open(HOME.id, app === HOME ? rest : "", { maximized: true });
  if (app !== HOME) open(app.id, rest);
}

arrive();
