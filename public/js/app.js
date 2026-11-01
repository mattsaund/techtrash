// techtrash.org : every app page loads this, first thing in its <head>.
//
// An app lives in a window on the desktop, so:
// - Opened on its own (a search result, a shared link), it sends the visitor
//   to the desktop with itself open at the same place:
//   /pages/notepad/?file=credits.txt becomes /#notepad/?file=credits.txt,
//   and /pages/blog/?blog/liftoff becomes
//   /#blog/?blog/liftoff, which the desktop tidies into the site's
//   own /#blog/liftoff.
// - Inside its window, it tells the desktop it's here as soon as it's read,
//   so the window's title and the address follow it without waiting for
//   every picture and player on it to load.
// - Inside its window, a link to another app opens that app's window rather
//   than loading it here, a link to anywhere else on the site replaces the
//   whole desktop (unless it has a target of its own, like a file Notepad
//   links to), and a link off the site opens a new tab.
(() => {
  const where = (path) => {
    const m = path.match(/^\/(?:pages|programs)\/([\w-]+)\/(.*)$/);
    return m && { id: m[1], rest: m[2] };
  };
  const here = where(location.pathname);

  if (window.top === window) {
    if (here) {
      const rest = here.rest + location.search;
      location.replace(`/#${here.id}${rest ? `/${rest}` : ""}`);
    }
    return;
  }

  document.addEventListener("DOMContentLoaded", () => window.top.desktop?.arrived?.(window));

  document.addEventListener("click", (e) => {
    const link = e.target.closest("a[href]");
    if (!link || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (link.origin !== location.origin) {
      link.target = "_blank";
      return;
    }
    const to = where(link.pathname);
    if (!to) {
      // (unless it says where it opens itself, as a file in Notepad does)
      if (!link.target) link.target = "_top";
      return;
    }
    if (here && to.id === here.id) return;
    e.preventDefault();
    window.top.desktop.open(to.id, to.rest + link.search);
  });
})();
