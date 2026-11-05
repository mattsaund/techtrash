// techtrash.org : every app on the desktop, in one list.
//
// An app is a page of its own, opened in a window. Where its launcher goes
// depends on what it is:
//
//   page     my pages. An icon on the desktop, and a place in the start
//            menu's right column. Lives in pages/<id>/.
//   program  things to use: the File Browser, Paint, games. The start menu's
//            left column, unless it says listed: false (Notepad, which only
//            opens files, and the Recycle Bin, which XP kept off the start
//            menu too). With desktop: true it gets a desktop icon too, as the
//            File Browser does. Lives in programs/<id>/.
//
// home: true is the website, the one app every visit opens. bin: true is the
// Recycle Bin: what's dragged onto it is thrown away, or would be, if
// anything on this desktop could be (js/icons.js says it can't). It's first
// in the list, so it starts in the top left corner, over the blog.
//
// The id is the app's address (techtrash.org/#files; the site's own pages
// have their own, #blog/liftoff: see desktop.js) and has to match its
// folder's name, which is how a page opened on its own finds its way back to
// the desktop (js/app.js). It's also the icon's name on the shared desktop:
// worker.js reads ON_DESKTOP to know which icons exist. The order here is the
// order on screen.
//
// Every icon is Windows XP's own, built into img/icons/xp/ by
// tools/make_icons.py and credited in files/credits.txt.
//
// Adding an app: a line here; a folder with an index.html in it, copied from
// another app's (it loads js/app.js first, then tokens.css and xp.css; its
// <body class="app"> is the window's body, and its <title> the window's
// title); a line in index.html's <noscript> list; and XP's own icon for the
// job, added to tools/make_icons.py.

const XP = "/img/icons/xp";

const LIST = [
  { id: "recycle-bin", title: "Recycle Bin", icon: `${XP}/recycle-bin.png`,  kind: "program", desktop: true, listed: false, bin: true },
  { id: "blog",    title: "Techtrash.org blog", icon: `${XP}/internet-shortcut.png`, kind: "page", home: true },

  { id: "files",   title: "File Browser", icon: `${XP}/explorer.png`,          kind: "program", desktop: true },
  { id: "notepad", title: "Notepad",      icon: `${XP}/notepad.png`,           kind: "program", listed: false },
];

export const APPS = LIST.map((app) => ({
  ...app,
  url: `/${app.kind === "page" ? "pages" : "programs"}/${app.id}/`,
}));

export const findApp = (id) => APPS.find((app) => app.id === id);

// The site itself: every visit opens it, maximized, and its front page is
// the site's plain address. The desktop behind it is the easter egg.
export const HOME = APPS.find((app) => app.home);

// The apps with an icon on the desktop, in order: every page, and any
// program that asks for one.
export const ON_DESKTOP = APPS.filter((app) => app.kind === "page" || app.desktop);

// The Recycle Bin.
export const BIN = APPS.find((app) => app.bin);

// Documents in the start menu's left column, under the programs: each opens
// a program on one file, the way XP's could.
export const SHORTCUTS = [
  { title: "credits.txt", icon: `${XP}/text-document.png`, app: "notepad", rest: "?file=credits.txt" },
];
