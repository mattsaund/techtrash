// Makes the blue screen's "Press any key" actually work. Any key, click or
// tap goes back to the website if the blue screen is inside its window, or
// to techtrash.org if it's the whole page.
(() => {
  const back = () => location.assign(window.top === window ? "/" : "/pages/blog/");
  addEventListener("keydown", back, { once: true });
  addEventListener("pointerdown", back, { once: true });
})();
