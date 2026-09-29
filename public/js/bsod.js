// techtrash.org : the blue screen's "Press any key", which here really works.
//
// Any key, click or tap goes back: to the website if the blue screen came up
// inside its window, to techtrash.org if it's the whole screen.
(() => {
  const back = () => location.assign(window.top === window ? "/" : "/pages/blog/");
  addEventListener("keydown", back, { once: true });
  addEventListener("pointerdown", back, { once: true });
})();
