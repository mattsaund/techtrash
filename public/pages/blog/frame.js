// Page frame. The headline panel (<template id="hero"> in index.html) goes on
// top, the page's panels under it.

import { drawFooter } from "./footer.js";
import { ownWords } from "./own-words.js";
import { drawWith } from "./site.js";
import { api } from "./util.js";

const page = document.getElementById("page");

// view is the nav button to mark current, or null. build() returns the page's
// panels and runs alongside the tagline and footer loads.
export async function framed(view, build) {
  drawWith(() => framed(view, build));
  const [tagline, panels] = await Promise.all([api("/api/blog/page?name=tagline").catch(() => null), build(), drawFooter()]);
  const hero = document.getElementById("hero").content.cloneNode(true);
  for (const link of hero.querySelectorAll("[data-view]")) {
    if (link.dataset.view === view) link.setAttribute("aria-current", "page");
  }
  // no saved tagline, keep index.html's default
  const lede = hero.querySelector(".lede");
  if (tagline) lede.replaceWith(ownWords(tagline, { fallback: lede.cloneNode(true), short: true, look: "lede", edit: "Edit tagline" }));
  page.replaceChildren(hero, ...[panels].flat());
}
