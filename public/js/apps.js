// techtrash.org : every app on the desktop, in one list.
//
// An app is a page of its own, opened in a window. Where its launcher goes
// depends on what it is:
//
//   page     my pages. An icon on the desktop, and a place in the start
//            menu's right column. Lives in pages/<id>/.
//   program  things to use: the File Browser, Paint, games. The start menu's
//            left column. Lives in programs/<id>/.
//
// The id is the app's address (techtrash.org/#blog) and has to match its
// folder's name, which is how a page opened on its own finds its way back to
// the desktop (js/app.js). It's also the icon's name on the shared desktop:
// worker.js reads this list to know which icons exist. The order here is the
// order on screen.
//
// Adding one: a line here, a folder with an index.html in it (copy another
// app's), and a line in index.html's <noscript> list.

const LIST = [
  { id: "blog",  title: "Blog",         icon: "/img/icons/globe.svg",    kind: "page" },

  { id: "files", title: "File Browser", icon: "/img/icons/explorer.svg", kind: "program" },
];

export const APPS = LIST.map((app) => ({
  ...app,
  url: `/${app.kind === "page" ? "pages" : "programs"}/${app.id}/`,
}));

export const findApp = (id) => APPS.find((app) => app.id === id);
