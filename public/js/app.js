// Loaded first in every app page's <head>. Opened top-level, redirects to the
// desktop with itself open (/programs/notepad/?file=x becomes /#notepad/?file=x).
// In a window, reports in on DOMContentLoaded so the title doesn't wait for media.
// App links open a window, other site links replace the desktop, external ones a new tab.
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
      // Keep a link's own target (Notepad's file links).
      if (!link.target) link.target = "_top";
      return;
    }
    if (here && to.id === here.id) return;
    e.preventDefault();
    window.top.desktop.open(to.id, to.rest + link.search);
  });
})();
