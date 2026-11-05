// techtrash.org : the desktop
//
// Draws the start menu from js/apps.js, opens each app in a window, and moves,
// resizes, stacks, minimizes and maximizes them. Every app is its own page,
// shown in its window through an iframe. The icons are js/icons.js, and
// logging on and off is js/session.js.
//
// The blog is the site. Every visit opens it, maximized, and the desktop is
// what's behind it for whoever closes it: the easter egg.
//
// Windows are each visitor's own. The icons are shared: everyone on the site
// sees the same desktop.
//
// The address follows the window in front: techtrash.org/#files opens the
// File Browser, and the address changes as you move between windows, so
// whatever's in front can always be copied and shared. The blog's front page
// is the plain techtrash.org.
//
// Only geometry is set from here: position, size and stacking order. How
// anything looks is a class in css/, and every length is read out of
// css/tokens.css rather than written here.

import { APPS, HOME, SHORTCUTS, findApp } from "./apps.js";
import { setUpIcons } from "./icons.js";
import { setUpSession } from "./session.js";

const css = getComputedStyle(document.documentElement);
const num = (name) => parseInt(css.getPropertyValue(name), 10);

const WINDOW_W = num("--window-w");
const WINDOW_H = num("--window-h");
const MIN_W = num("--window-min-w");
const MIN_H = num("--window-min-h");
const TITLE_H = num("--title-h");
const KEEP = num("--sp-48");                  // of a window that always stays on screen
const FIRST = {                               // where the first window opens: clear of the icons
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

const stack = [];   // open windows, back to front
let front = null;   // the active window, or null when the desktop is
let cascade = 0;    // how many title bars down and across the next window opens

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

// --- launchers -------------------------------------------------------------

// Clicking the bare desktop puts every window in the background, as XP does.
setUpIcons({ layer: iconBox, open, onBareDesktop: () => activate(null) });

// The start menu: programs, then documents, on the left; my pages on the right.
function startItem(list, { title, icon }, id, rest = "") {
  const item = make("a", "start-menu__item", make("li", "", list));
  item.href = `#${id}${rest ? `/${rest}` : ""}`;
  picture(icon, "", item);
  make("span", "", item).textContent = title;
  item.addEventListener("click", (e) => {
    e.preventDefault();
    showStart(false);
    open(id, rest);
  });
}

const programs = startMenu.querySelector(".start-menu__programs");
const places = startMenu.querySelector(".start-menu__places");
for (const app of APPS) {
  if (app.listed === false) continue;
  startItem(app.kind === "page" ? places : programs, app, app.id);
}
for (const shortcut of SHORTCUTS) startItem(programs, shortcut, shortcut.app, shortcut.rest);

// --- start menu ------------------------------------------------------------

function showStart(show) {
  startMenu.hidden = !show;
  startButton.setAttribute("aria-expanded", String(show));
}

startButton.addEventListener("click", () => showStart(startMenu.hidden));

document.addEventListener("pointerdown", (e) => {
  if (!startMenu.hidden && !startMenu.contains(e.target) && !startButton.contains(e.target)) showStart(false);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !startMenu.hidden) {
    showStart(false);
    startButton.focus();
  }
});

// Log Off asks first (js/session.js). Logging off closes every window, as
// XP's closed every program.
const session = setUpSession({
  closeAll: () => [...stack].forEach(close),
  // A different user may do different things (the admin can post), so every
  // open window starts over as them.
  onUser: () => stack.forEach((win) => win.frame.contentWindow.location.reload()),
});
startMenu.querySelector("[data-ask-log-off]").addEventListener("click", () => {
  showStart(false);
  session.askToLogOff();
});

// --- windows ---------------------------------------------------------------

function open(id, rest = "", { maximized = false } = {}) {
  const app = findApp(id);
  if (!app) return;
  let win = stack.find((w) => w.app === app);
  if (!win) win = create(app, rest, maximized);
  else if (rest && rest !== win.rest) win.frame.src = app.url + rest;
  win.el.hidden = false;
  activate(win);
  win.frame.focus();
}

function create(app, rest, maximized) {
  const el = template.content.firstElementChild.cloneNode(true);
  const bar = el.querySelector(".title-bar");
  const title = el.querySelector(".title-bar__text");
  const frame = el.querySelector(".window__frame");
  const task = make("button", "task");
  picture(app.icon, "task__icon", task);
  const label = make("span", "task__label", task);

  title.id = `window-${app.id}`;
  el.setAttribute("aria-labelledby", title.id);
  el.querySelector(".title-bar__icon").src = app.icon;

  // A window that opens maximized still gets a place of its own, for when
  // it's restored.
  const win = { app, el, frame, task, rest, maximized, rect: firstRect() };
  const rename = (text) => {
    title.textContent = label.textContent = text;
    frame.title = task.title = text;
  };
  rename(app.title);

  // The page inside sets the title (Notepad's is "credits.txt - Notepad"),
  // and the address follows it as it moves around inside its own app: from
  // the moment the page says it's here (js/app.js does, as soon as it's
  // read, not once every picture and player on it has loaded), or else from
  // when it's loaded. Once for each page.
  let hooked = null;
  win.hook = () => {
    const inner = frame.contentWindow;
    const page = frame.contentDocument;
    if (!page || page === hooked) return;
    hooked = page;
    rename(page.title || app.title);
    // ...and follows it when the page changes it without loading again, as
    // the blog does once it knows which blog it's showing.
    new MutationObserver(() => rename(page.title || app.title))
      .observe(page.head, { subtree: true, childList: true, characterData: true });
    // The same for its address, which a page can change without loading
    // again too, and says so: the blog's Blog does, as flags are picked.
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
    if (!e.target.closest("button")) maximize(win, !win.maximized);
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
      if (e.button !== 0 || win.maximized || phone.matches) return;
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
// starts over at the top when the next one wouldn't fit.
function firstRect() {
  const { width, height } = desktop.getBoundingClientRect();
  const w = Math.min(WINDOW_W, width);
  const h = Math.min(WINDOW_H, height);
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
// the screen, as a maximized one does anywhere.
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

// Track one drag from its pointerdown to its pointerup, calling onMove for
// every step in between.
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

function close(win) {
  stack.splice(stack.indexOf(win), 1);
  win.el.remove();
  win.task.remove();
  if (front === win) activate(topmost());
}

// --- the address -----------------------------------------------------------
//
// The front window's place, in the site's address. Another app's is
// #<app>/<where in it> (#notepad/?file=credits.txt). The site's own (the
// home app's) is just where it is, because it is the site: its pages'
// addresses read like paths (?blog/liftoff, ?pictures), and the
// address bar shows them as they are, #blog/liftoff, #pictures. Its
// front page is the plain address.

// "?blog/liftoff" as "blog/liftoff", or null if it isn't a
// path (an old ?post=3, which the site sends on to its new address)
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

// What the address asks for, as { app, rest }: #files and #notepad/... are
// those apps; anything else is a place on the site (#blog/liftoff),
// and so is the old way of saying one (#blog/?post=3).
function fromAddress() {
  const m = location.hash.match(/^#([\w-]+)(?:\/(.*))?$/);
  if (!m) return { app: HOME, rest: "" };
  const app = findApp(m[1]);
  if (app && app !== HOME) return { app, rest: m[2] ?? "" };
  // the old way: #blog/?post=3, and #blog/ for the front page (#blog is the Blog)
  if (app === HOME && (m[2] === "" || m[2]?.startsWith("?"))) return { app: HOME, rest: m[2] };
  return { app: HOME, rest: siteRest(location.hash.slice(1)) };
}

// (The address catches up once the window's page has loaded: see create.)
function openFromAddress() {
  const { app, rest } = fromAddress();
  open(app.id, rest);
}

addEventListener("hashchange", openFromAddress);

// --- focus and the window size ----------------------------------------------

// Focus going into a window's page (a click, or Tab) brings that window to
// the front and closes the start menu. The parent page only hears that it
// lost focus, so look at where focus went once it's settled.
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

// --- the clock ---------------------------------------------------------------

const clock = document.querySelector(".tray__clock");
function tick() {
  const now = new Date();
  clock.textContent = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  clock.dateTime = now.toISOString();
  clock.title = now.toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}
tick();
setInterval(tick, 10000);

// Apps open other apps through this (js/app.js does it for their links).
// A page in a window, saying it's here (js/app.js).
function arrived(inner) {
  stack.find((w) => w.frame.contentWindow === inner)?.hook();
}

window.desktop = { open, arrived };

// Arriving: the site opens, maximized, every time. An address on it
// (#blog/liftoff) opens it there; one for another app (#files) opens that too, in
// front of it.
function arrive() {
  const { app, rest } = fromAddress();
  open(HOME.id, app === HOME ? rest : "", { maximized: true });
  if (app !== HOME) open(app.id, rest);
}

arrive();
