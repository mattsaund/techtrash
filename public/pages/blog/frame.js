// The frame every page of the website is drawn in. On top is the headline
// ("Techtrash" with a letter in each hue, from <template id="hero"> in
// index.html), the tagline, and the four buttons for the front page's panels
// (Home, Blog, Pictures, About me) with the current one filled in. The page's
// own panels go under it.

import { ownWords } from "./own-words.js";
import { drawWith } from "./site.js";
import { api } from "./util.js";

const page = document.getElementById("page");

// view is the button to fill in (null for none). build() makes the page's
// panels while the tagline loads.
export async function framed(view, build) {
  drawWith(() => framed(view, build));
  const [tagline, panels] = await Promise.all([api("/api/blog/page?name=tagline").catch(() => null), build()]);
  const hero = document.getElementById("hero").content.cloneNode(true);
  for (const link of hero.querySelectorAll("[data-view]")) {
    if (link.dataset.view === view) link.setAttribute("aria-current", "page");
  }
  // until it's written, the tagline is the one in index.html
  const lede = hero.querySelector(".lede");
  if (tagline) lede.replaceWith(ownWords(tagline, { fallback: lede.cloneNode(true), short: true, look: "lede", edit: "Edit tagline" }));
  page.replaceChildren(hero, ...[panels].flat());
}
