// Every app page loads this first thing in its <head>.
//
// Opened on its own (a search result, a shared link), a page sends the
// visitor to the desktop with itself open at the same place.
// /programs/notepad/?file=credits.txt becomes /#notepad/?file=credits.txt,
// and /pages/blog/?blog/liftoff becomes /#blog/?blog/liftoff, which the
// desktop tidies into /#blog/liftoff.
//
// Inside its window, it tells the desktop it's here on DOMContentLoaded, so
// the title and address don't wait for every picture and player to load.
// A link to another app opens that app's window, a link elsewhere on the
// site replaces the whole desktop, and a link off the site opens a new tab.
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
      // Unless it has its own target, like the files Notepad links to.
      if (!link.target) link.target = "_top";
      return;
    }
    if (here && to.id === here.id) return;
    e.preventDefault();
    window.top.desktop.open(to.id, to.rest + link.search);
  });
})();
