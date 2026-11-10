// Every app on the desktop. Each is a page of its own, opened in a window.
//
//   kind     "page" (the website, in pages/<id>/, at the top of the start
//            menu's right column) or "program" (in programs/<id>/)
//   pinned   in the start menu's left column, like XP's most-used programs
//   group    its folder under All Programs, "accessories" or "games"
//   listed   false keeps it out of All Programs (the Recycle Bin, which XP
//            left out too, and what lives in the Control Panel)
//   home     the website, the one app every visit opens
//   bin      the Recycle Bin
//   multi    one window per file or folder, like XP's Notepad and Explorer.
//            Anything else gets one window at most.
//   opens    [app, rest] makes it a shortcut into another app. The Recycle
//            Bin is the File Browser, at the bin.
//   admin    the admin's alone
//   size     [width, height] as token names, for a window that doesn't open
//            at XP's 640 x 480 (--window-w, --window-h)
//   fixed    can't be resized or maximized, like XP's dialogs
//
// The id is the app's address (techtrash.org/#files) and has to match its
// folder's name. That's how a page opened on its own finds its way back to
// the desktop (js/app.js). The website's pages get addresses of their own
// (#blog/liftoff, see desktop.js). A shortcut to an app on the shared disk
// keeps this id as its type (server/disk.js).
//
// Every icon is XP's own, built into img/icons/xp/ by tools/make_icons.py and
// credited in files/credits.txt. The games aren't XP's, so their icons are
// our own.
//
// To add an app, add a line here, make a folder with an index.html copied
// from another app's, and add XP's icon for it to tools/make_icons.py. The
// page loads js/app.js first, then tokens.css and xp.css. Its
// <body class="app"> is the window's body and its <title> is the window's
// title.

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

// The website. Every visit opens it maximized, and its front page is the
// plain techtrash.org. The desktop behind it is the easter egg.
export const HOME = APPS.find((app) => app.home);

// The shortcuts the desktop comes with, in order. Nobody can rename these.
export const FIRST_SHORTCUTS = ["recycle-bin", "blog", "files"];

// Sorts the first shortcuts ahead of everything else, in their order.
const rank = (id) => (FIRST_SHORTCUTS.includes(id) ? FIRST_SHORTCUTS.indexOf(id) : FIRST_SHORTCUTS.length);
export const firstShortcutsFirst = (a, b) => rank(a.id) - rank(b.id);

// The names Run and the Command Prompt know programs by, XP's included
// (mspaint is Paint). programNamed gives back the app's id, or null.
const NAMES = new Map(Object.entries({
  notepad: "notepad", mspaint: "paint", pbrush: "paint", paint: "paint", calc: "calculator", calculator: "calculator",
  cmd: "cmd", command: "cmd", explorer: "files", control: "control-panel", "desk.cpl": "display", "timedate.cpl": "datetime",
  iexplore: "blog", wmplayer: "media-player", mplayer2: "media-player", mines: "mines", sol: "solitaire", solitaire: "solitaire",
  "notepad++": "notepad-plus", run: "run",
}));
export const programNamed = (word) => NAMES.get(String(word).toLowerCase().replace(/\.exe$/, "")) ?? null;

// The folders under All Programs. Programs with no group come after them,
// like XP.
export const GROUPS = [
  { id: "accessories", title: "Accessories" },
  { id: "games", title: "Games" },
];

// The start menu's right column, under the website. Folders on the disk, the
// Control Panel (plus the Admin Dashboard, for the admin) and Run, each
// opening an app somewhere. "-" is a rule.
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

// Documents in the start menu's left column, under the programs. Each opens
// a program on one file.
export const SHORTCUTS = [
  { title: "credits.txt", icon: `${XP}/text-document.png`, app: "notepad", rest: "?file=credits.txt" },
];
