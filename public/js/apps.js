// Every app on the desktop, each a page opened in a window.
// id is the address (#files) and must match the folder name (js/app.js relies on it).
// Disk shortcuts store the id as their type (server/disk.js).
// Icons are XP's own (tools/make_icons.py, credited in files/credits.txt), except the games'.
//
//   kind     "page" (pages/<id>/) or "program" (programs/<id>/)
//   pinned   in the start menu's left column
//   group    All Programs folder, "accessories" or "games"
//   listed   false hides it from All Programs
//   home     the website, opened on every visit
//   bin      the Recycle Bin
//   multi    a window per file or folder, else one window at most
//   opens    [app, rest] makes it a shortcut into another app
//   admin    admin only
//   size     [width, height] token names, if not --window-w and --window-h
//   fixed    no resize or maximize, like XP's dialogs
//
// To add an app: a line here, a folder with an index.html copied from another
// app's, and its XP icon in tools/make_icons.py.

const XP = "/img/icons/xp";
const GAMES = "/img/icons/games";   // drawn by tools/make_game_icons.py

const LIST = [
  { id: "recycle-bin", title: "Recycle Bin", icon: `${XP}/recycle-bin.png`, kind: "program", listed: false, bin: true, opens: ["files", "?folder=recycle"] },
  { id: "blog",    title: "Techtrash.org blog", icon: `${XP}/internet-shortcut.png`, kind: "page", home: true },

  { id: "files",   title: "File Browser", icon: `${XP}/explorer.png`, kind: "program", group: "accessories", pinned: true, multi: true, size: ["--explorer-w", "--explorer-h"] },
  { id: "paint",   title: "Paint",        icon: `${XP}/paint.png`,    kind: "program", group: "accessories", pinned: true, multi: true },
  { id: "notepad", title: "Notepad",      icon: `${XP}/notepad.png`,  kind: "program", group: "accessories", pinned: true, multi: true },
  { id: "calculator", title: "Calculator", icon: `${XP}/calculator.png`, kind: "program", group: "accessories", size: ["--calc-w", "--calc-h"], fixed: true },
  { id: "cmd",     title: "Command Prompt", icon: `${XP}/command-prompt.png`, kind: "program", group: "accessories", multi: true },
  { id: "media-player", title: "Windows Media Player", icon: `${XP}/media-player.png`, kind: "program", pinned: true },
  { id: "solitaire", title: "Solitaire",  icon: `${GAMES}/solitaire.png`, kind: "program", group: "games", pinned: true, size: ["--solitaire-w", "--solitaire-h"] },
  { id: "mines",   title: "Mines",        icon: `${GAMES}/mines.png`, kind: "program", group: "games", pinned: true, fixed: true },
  { id: "notepad-plus", title: "Notepad++", icon: `${XP}/script.png`, kind: "program", size: ["--explorer-w", "--explorer-h"] },

  { id: "viewer",  title: "Windows Picture and Fax Viewer", icon: `${XP}/picture-viewer.png`, kind: "program", listed: false, multi: true },
  { id: "control-panel", title: "Control Panel", icon: `${XP}/control-panel.png`, kind: "program", listed: false },
  { id: "display", title: "Display Properties", icon: `${XP}/display-properties.png`, kind: "program", listed: false, size: ["--display-w", "--display-h"], fixed: true },
  { id: "datetime", title: "Date and Time Properties", icon: `${XP}/date-time.png`, kind: "program", listed: false, size: ["--datetime-w", "--datetime-h"], fixed: true },
  { id: "run",     title: "Run", icon: `${XP}/run.png`, kind: "program", listed: false, size: ["--run-w", "--run-h"], fixed: true },
  { id: "admin",   title: "Admin Dashboard", icon: `${XP}/admin-tools.png`, kind: "program", listed: false, admin: true },
];

export const APPS = LIST.map((app) => ({
  ...app,
  url: `/${app.kind === "page" ? "pages" : "programs"}/${app.id}/`,
}));

export const findApp = (id) => APPS.find((app) => app.id === id);

// The website. Every visit opens it maximized.
export const HOME = APPS.find((app) => app.home);

// The desktop's built-in shortcuts, in order. Fixed in place (js/items.js isFixed).
export const FIRST_SHORTCUTS = ["recycle-bin", "blog", "files"];

const rank = (id) => (FIRST_SHORTCUTS.includes(id) ? FIRST_SHORTCUTS.indexOf(id) : FIRST_SHORTCUTS.length);
export const firstShortcutsFirst = (a, b) => rank(a.id) - rank(b.id);

// Names Run and the Command Prompt accept, XP's included (mspaint is Paint).
const NAMES = new Map(Object.entries({
  notepad: "notepad", mspaint: "paint", pbrush: "paint", paint: "paint", calc: "calculator", calculator: "calculator",
  cmd: "cmd", command: "cmd", explorer: "files", control: "control-panel", "desk.cpl": "display", "timedate.cpl": "datetime",
  iexplore: "blog", wmplayer: "media-player", mplayer2: "media-player", mines: "mines", sol: "solitaire", solitaire: "solitaire",
  "notepad++": "notepad-plus", run: "run",
}));
export const programNamed = (word) => NAMES.get(String(word).toLowerCase().replace(/\.exe$/, "")) ?? null;

// All Programs folders. Ungrouped programs follow them, like XP.
export const GROUPS = [
  { id: "accessories", title: "Accessories" },
  { id: "games", title: "Games" },
];

// Start menu's right column, under the website. "-" is a separator.
export const PLACES = [
  { title: "My Documents", icon: `${XP}/my-documents.png`, app: "files", rest: "?folder=documents" },
  { title: "My Pictures",  icon: `${XP}/my-pictures.png`,  app: "files", rest: "?folder=pictures" },
  { title: "My Music",     icon: `${XP}/my-music.png`,     app: "files", rest: "?folder=music" },
  "-",
  { title: "Control Panel",   icon: `${XP}/control-panel.png`, app: "control-panel" },
  { title: "Admin Dashboard", icon: `${XP}/admin-tools.png`,   app: "admin", admin: true },
  "-",
  { title: "Run...", icon: `${XP}/run.png`, app: "run" },
];

// Documents in the start menu's left column, under the programs.
export const SHORTCUTS = [
  { title: "credits.txt", icon: `${XP}/text-document.png`, app: "notepad", rest: "?file=credits.txt" },
];
