// The desktop. It draws the start menu from js/apps.js and opens each app
// in its own window (an iframe) that it moves, resizes, stacks, minimizes
// and maximizes. Icons are js/icons.js, logging on is js/session.js and the
// shared disk is js/disk.js.
//
// Every visit opens the blog, maximized. The desktop behind it is the
// easter egg, and its line to the server (js/shared.js) only opens once
// someone actually uses it.
//
// Windows are each visitor's own. Everything else is shared, so everyone
// sees the same icons, disk and wallpaper.
//
// The address follows the window in front (techtrash.org/#files is the File
// Browser), so whatever's in front can always be copied and shared. The
// blog's front page is the plain techtrash.org.
//
// Only geometry is set from here (position, size, stacking order), plus the
// wallpaper. Everything else about how things look is a class in css/, and
// every length comes from css/tokens.css.

import { APPS, GROUPS, HOME, PLACES, SHORTCUTS, findApp } from "./apps.js";
import { disk } from "./disk.js";
import { setUpIcons } from "./icons.js";
import { fileUrl, opener } from "./items.js";
import { closeMenu, showMenu } from "./menu.js";
import { showMessage } from "./message.js";
import { setUpSession } from "./session.js";
import { line } from "./shared.js";
import { WALLPAPER_DIR, findWallpaper } from "./wallpapers.js";

const css = getComputedStyle(document.documentElement);
const num = (name) => parseInt(css.getPropertyValue(name), 10);

const WINDOW_W = num("--window-w");
const WINDOW_H = num("--window-h");
const MIN_W = num("--window-min-w");
const MIN_H = num("--window-min-h");
const TITLE_H = num("--title-h");
const FRAME = num("--frame");                 // a window's frame, left, right and bottom
const KEEP = num("--sp-48");                  // how much of a window always stays on screen
const FIRST = {                               // where the first window opens, clear of the icons
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
let front = null;   // the active window, or null when the desktop is
let cascade = 0;    // how many title bars down and across the next window opens
let made = 0;       // windows ever opened, to give each its own ids
let clipboard = []; // the ids Cut has put aside (js/tasks.js)

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

// What the programs in the windows reach as window.top.desktop (they're
// pages on the same site). It opens other apps and what's on the disk, and
// holds the disk and the clipboard. Set before anything opens.
window.desktop = {
  open: (id, rest) => open(id, rest),
  openItem: (item) => openItem(item),
  // A program closing its own window (File > Exit). It asks first if there's
  // something unsaved, unless the program already asked (ask: false).
  close(inner, { ask = true } = {}) {
    const win = stack.find((w) => w.frame.contentWindow === inner);
    if (win) close(win, { ask });
  },
  // A program sizing its window to what's in it, as Mines does for each
  // level. width and height are its page's, and the frame goes around that.
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

// --- the line to the shared desktop ----------------------------------------

// The line comes up the first time anything on the desktop's own page is
// pressed (not the blog inside its window), or an app other than the blog
// opens.
const wake = () => line.wake();
addEventListener("pointerdown", wake, { capture: true, once: true });
addEventListener("keydown", wake, { capture: true, once: true });

// Passes every change to the disk on to every window, as a "diskchange"
// event on its page. Its detail is { items, gone, all }, { settings } or
// { clipboard }.
function tellWindows(detail) {
  for (const win of stack) {
    try {
      const inner = win.frame.contentWindow;
      inner.dispatchEvent(new inner.CustomEvent("diskchange", { detail }));
    } catch {}
  }
}
disk.watch(tellWindows);

// --- the wallpaper and the lock --------------------------------------------

// The wallpaper is everyone's, so it comes from the disk's settings (the
// shape is in js/wallpapers.js). A picture on the disk only shows while it's
// still there.
function showWallpaper() {
  const { wallpaper, locked } = disk.settings();
  const image = wallpaper?.image ?? "";
  let url = "";
  if (image.startsWith("xp:") && findWallpaper(image.slice(3))) url = `${WALLPAPER_DIR}/${image.slice(3)}.jpg`;
  if (image.startsWith("file:") && disk.item(image.slice(5))) url = fileUrl(disk.item(image.slice(5)));
  const value = url ? `url("${url}")` : "none";
  if (desktop.style.getPropertyValue("--wallpaper-image") !== value) desktop.style.setProperty("--wallpaper-image", value);
  if (wallpaper?.color) desktop.style.setProperty("--wallpaper-color", wallpaper.color);
  else desktop.style.removeProperty("--wallpaper-color");
  desktop.dataset.wallpaper = wallpaper?.position ?? "stretch";
  // The tray's padlock shows while only the admin can change things.
  lock.hidden = !locked;
}
disk.watch(showWallpaper);

// --- launchers -------------------------------------------------------------

// Clicking the bare desktop puts every window in the background, like XP.
const icons = setUpIcons({
  layer: iconBox,
  openItem,
  openApp: (id) => open(id),
  onBareDesktop: () => activate(null),
});

// The start menu has programs, then documents, on the left, and the website,
// then places on the disk and the Control Panel, on the right. Right-clicking
// a program (or the blog) offers XP's Send To > Desktop (create shortcut),
// which is how a shortcut that's been thrown away comes back.
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

// All Programs, at the foot of the left column. Every program, with
// Accessories and Games in folders of their own, like XP.
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

// A press anywhere else closes it. All Programs' menus count as part of it,
// though they're drawn outside it.
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

// Log Off asks first (js/session.js). Logging off closes every window, as
// XP closed every program.
const session = setUpSession({
  closeAll: () => [...stack].forEach((win) => close(win, { ask: false })),
  // A different user may do different things (the admin can post and
  // manage the desktop), so every open window starts over as them, and so
  // does the line.
  onUser: async (user, { changed }) => {
    disk.admin = user === "admin";
    adminPlaces.forEach((li) => { li.hidden = !disk.admin; });
    if (!changed) return;
    line.again();
    // Every window starts over as the new user. One with unsaved work asks
    // first, and stays as it is on Cancel.
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

// Opens an app, somewhere in it (rest: "?folder=pictures"), or brings its
// window to the front if it's open there already. A multi app opens a new
// window for anything it hasn't got open.
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

// Opens something on the disk in the app that opens it (js/items.js).
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

  // A window that opens maximized still gets a place of its own for when
  // it's restored.
  const win = { app, el, frame, task, rest, maximized: maximized && !fixed, rect: firstRect(app) };
  const rename = (text) => {
    title.textContent = label.textContent = text;
    frame.title = task.title = text;
  };
  rename(app.title);
  // The page's own icon in the title bar and on the taskbar, if it has one
  // (the File Browser shows its folder's).
  const reicon = (page) => {
    const src = page.querySelector("link[rel=icon]")?.href ?? app.icon;
    for (const img of [el.querySelector(".title-bar__icon"), task.querySelector(".task__icon")]) {
      if (img.src !== src) img.src = src;
    }
  };

  // The page inside sets the title (Notepad's is "credits.txt - Notepad"),
  // and the address follows it around its own app. Each page is hooked once,
  // as soon as it says it's here (js/app.js, on DOMContentLoaded), or else
  // when it's loaded.
  let hooked = null;
  win.hook = () => {
    const inner = frame.contentWindow;
    const page = frame.contentDocument;
    if (!page || page === hooked) return;
    hooked = page;
    rename(page.title || app.title);
    reicon(page);
    // The page can change its title and icon without loading again, as the
    // blog does once it knows which blog it's showing.
    new MutationObserver(() => {
      rename(page.title || app.title);
      reicon(page);
    }).observe(page.head, { subtree: true, childList: true, characterData: true, attributes: true });
    // Its address too. A page that changes it without loading again fires
    // "addresschange", as the blog's Blog does when flags are picked, and the
    // File Browser does from folder to folder.
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

// Each new window opens one title bar down and across from the last, and
// starts over at the top when the next one wouldn't fit. Its size is XP's
// 640 x 480, or the app's own (Explorer's, a dialog's), shrunk to fit a small
// screen.
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

// A phone has no room to move windows around, so there every window fills
// the screen like a maximized one.
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

// Enough of the title bar always stays on screen to grab it again.
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

// Follows one drag from pointerdown to pointerup, calling onMove for every
// step in between.
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

// A program with something unsaved asks first, as XP's Notepad did ("Do you
// want to save the changes?"). Its page sets window.mayClose, which settles
// false to stay open. Logging off doesn't ask.
async function close(win, { ask = true } = {}) {
  if (ask && !(await letsGo(win))) return;
  if (!stack.includes(win)) return;
  stack.splice(stack.indexOf(win), 1);
  win.el.remove();
  win.task.remove();
  if (front === win) activate(topmost());
}

// Whether a window's page lets it go. False if it has unsaved work and the
// answer to its question is Cancel.
async function letsGo(win) {
  try {
    return (await win.frame.contentWindow?.mayClose?.()) !== false;
  } catch {
    return true;
  }
}

// --- the address -----------------------------------------------------------
//
// The front window's place goes in the site's address. Another app's is
// #<app>/<where in it> (#notepad/?file=credits.txt). The website's own pages
// read like paths (?blog/liftoff, ?pictures), so the address shows them as
// they are (#blog/liftoff, #pictures), and its front page is the plain
// address.

// "?blog/liftoff" as "blog/liftoff", or null if it isn't a path (an old
// ?post=3, which the site sends on to its new address)
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

// What the address asks for, as { app, rest }. #files and #notepad/... are
// those apps. Anything else is a place on the website (#blog/liftoff), and
// so is the old way of saying one (#blog/?post=3).
function fromAddress() {
  const m = location.hash.match(/^#([\w-]+)(?:\/(.*))?$/);
  if (!m) return { app: HOME, rest: "" };
  const app = findApp(m[1]);
  if (app && app !== HOME) return { app, rest: m[2] ?? "" };
  // the old way, #blog/?post=3, and #blog/ for the front page (#blog alone is the Blog)
  if (app === HOME && (m[2] === "" || m[2]?.startsWith("?"))) return { app: HOME, rest: m[2] };
  return { app: HOME, rest: siteRest(location.hash.slice(1)) };
}

// The address catches up once the window's page has loaded (see create).
function openFromAddress() {
  const { app, rest } = fromAddress();
  open(app.id, rest);
}

addEventListener("hashchange", openFromAddress);

// --- focus and the window size ---------------------------------------------

// Focus going into a window's page (a click, or Tab) brings that window to
// the front and closes the start menu. This page only hears that it lost
// focus, so it looks at where focus went once it's settled.
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

// --- the clock -------------------------------------------------------------

// Clicking it brings up Date and Time Properties, like XP.
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

// A page in a window saying it's here (js/app.js).
function arrived(inner) {
  stack.find((w) => w.frame.contentWindow === inner)?.hook();
}

// Every visit opens the website, maximized. An address on it (#blog/liftoff)
// opens it there, and one for another app (#files) opens that app in front.
function arrive() {
  const { app, rest } = fromAddress();
  open(HOME.id, app === HOME ? rest : "", { maximized: true });
  if (app !== HOME) open(app.id, rest);
}

arrive();
