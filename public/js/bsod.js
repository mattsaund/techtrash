// Makes the blue screen's "Press any key" work. Back to the blog in its
// window, or to / when the blue screen is the whole page.
(() => {
  const back = () => location.assign(window.top === window ? "/" : "/pages/blog/");
  addEventListener("keydown", back, { once: true });
  addEventListener("pointerdown", back, { once: true });
})();
