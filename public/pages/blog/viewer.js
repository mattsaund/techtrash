// Picture viewer, a modal <dialog> for pictures in .prose and in Pictures.
// Goto Image scrolls to a picture on this page, or opens its page with
// #picture-<name>, which showPictureFromAddress() handles.

import { el } from "./util.js";

const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const plainClick = (e) => e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;

// "#picture-liftoff-3f9a1c.png" for an uploaded picture, "" for any other
export function pictureHash(src) {
  const path = new URL(src, location.href).pathname;
  return path.startsWith("/blog/img/") ? `#picture-${path.slice("/blog/img/".length)}` : "";
}

// Viewable pictures. Not in the editor (a click there selects) or inside a link.
const viewable = () => [...document.querySelectorAll(".prose img")].filter((img) => !img.closest(".editor, a[href]"));

// Viewer buttons take the hue of the picture's panel.
const hueAround = (node) => [...(node.closest(".panel")?.classList ?? [])].find((name) => /^hue-[1-6]$/.test(name)) ?? "hue-5";

// Scrolls to a picture and highlights it for 2 s.
function bringIntoView(img) {
  img.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
  img.classList.add("is-found");
  setTimeout(() => img.classList.remove("is-found"), 2000);
}

// pictures is [{ src, alt, from, href, here }]. from is the caption source or
// null, href is Goto Image's target, here is the <img> if it's on this page.
export function openViewer(pictures, start, { hue = "hue-5" } = {}) {
  let at = start;
  const many = pictures.length > 1;
  const button = (text, click, look = "") => {
    const made = el("button", { class: `button ${look}`, type: "button", textContent: text });
    made.addEventListener("click", click);
    return made;
  };
  const picture = el("img", { class: "viewer__picture", alt: "" });
  const about = el("p", { class: "viewer__about" });
  const meta = el("p", { class: "meta" });
  const caption = el("figcaption", { class: "viewer__caption" }, about, meta);
  const goto = el("a", { class: "button", textContent: "Goto Image" });
  const close = button("Close", () => dialog.close(), "hue-1");
  const dialog = el("dialog", { class: `viewer ${hue}`, "aria-label": "Picture" },
    el("figure", { class: "viewer__box" },
      picture,
      caption,
      el("div", { class: "button-row" },
        goto,
        many ? button("Previous", () => step(-1)) : null,
        many ? button("Next", () => step(1)) : null,
        close)));

  function show() {
    const now = pictures[at];
    picture.src = now.src;
    picture.alt = now.alt;
    about.textContent = now.alt;
    about.hidden = !now.alt;
    meta.textContent = [now.from && `From ${now.from}`, many && `${at + 1} of ${pictures.length}`].filter(Boolean).join(", ");
    meta.hidden = !meta.textContent;
    caption.hidden = about.hidden && meta.hidden;
    goto.href = now.href;
  }
  const step = (by) => {
    at = (at + by + pictures.length) % pictures.length;
    show();
  };

  // same page, so just scroll
  goto.addEventListener("click", (e) => {
    const here = pictures[at].here;
    if (!here || !plainClick(e)) return;
    e.preventDefault();
    dialog.close();
    bringIntoView(here);
  });
  dialog.addEventListener("keydown", (e) => {
    if (!many || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    step(e.key === "ArrowLeft" ? -1 : 1);
  });
  // the dialog fills the window, so a click on it directly is outside the box
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => dialog.remove());

  show();
  document.body.append(dialog);
  dialog.showModal();
  close.focus();
}

// A click on a .prose picture opens the viewer over all of this page's pictures.
export function watchPictures(root) {
  root.addEventListener("click", (e) => {
    const img = e.target.closest?.(".prose img");
    if (!img || img.closest(".editor, a[href]") || !plainClick(e)) return;
    const all = viewable();
    const page = location.search || "./";
    openViewer(all.map((one) => ({ src: one.currentSrc || one.src, alt: one.alt, from: null, href: page + pictureHash(one.src), here: one })),
      all.indexOf(img), { hue: hueAround(img) });
  });
}

// Scrolls to #picture-<name> once the page is drawn. Loads the lazy pictures
// above it first (3 s max) so they don't push it out of view.
export async function showPictureFromAddress() {
  if (!location.hash.startsWith("#picture-")) return;
  const all = viewable();
  const found = all.find((img) => pictureHash(img.src) === decodeURIComponent(location.hash));
  if (!found) return;
  const above = all.slice(0, all.indexOf(found) + 1);
  for (const img of above) img.loading = "eager";
  const loaded = Promise.all(above.map((img) => img.decode().catch(() => {})));
  await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, 3000))]);
  bringIntoView(found);
}
