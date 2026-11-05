// techtrash.org : the frame every page of the website is drawn in.
//
// The headline at the top of every page: "Techtrash", a letter in each hue
// (its <template id="hero"> is in index.html), the tagline under it, and the
// four buttons that pick the front page's panel (Home, Blog, Pictures, About
// me), the one for where you are filled in. Under it, the page's own panels.

import { ownWords } from "./own-words.js";
import { drawWith } from "./site.js";
import { api } from "./util.js";

const page = document.getElementById("page");

// view: which of the four buttons is filled in (null for none). build()
// makes the page's panels, while the tagline is on its way.
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
