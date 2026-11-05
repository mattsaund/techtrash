// techtrash.org : the picture viewer.
//
// A click on a picture in what's written (a blog, Home's words, the bulletin,
// About me, the tagline), or on one in Pictures, opens it over the page, as
// big as the window has room for, with what's in it (its description, from
// the editor) under it. Goto Image goes to where the picture is, its place in
// its blog or page: on the page you're on, the viewer closes and the page
// brings the picture into view. Previous and Next (or the arrow keys) step
// through the other pictures it was opened among. Esc, Close, or a click
// beside it closes it.
//
// From Pictures, Goto Image is the picture's page with #picture-<its name> on
// the end, and showPictureFromAddress() brings it into view once that page is
// drawn.

import { el } from "./util.js";

const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const plainClick = (e) => e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;

// "#picture-liftoff-3f9a1c.png" for an uploaded picture's address ("" for one from elsewhere)
export function pictureHash(src) {
  const path = new URL(src, location.href).pathname;
  return path.startsWith("/blog/img/") ? `#picture-${path.slice("/blog/img/".length)}` : "";
}

// The pictures in what's written on this page that open in the viewer: not
// the editor's (a click there picks one), and not one that's a link.
const viewable = () => [...document.querySelectorAll(".prose img")].filter((img) => !img.closest(".editor, a[href]"));

// The hue of the panel a picture's in, for the viewer's buttons.
const hueAround = (node) => [...(node.closest(".panel")?.classList ?? [])].find((name) => /^hue-[1-6]$/.test(name)) ?? "hue-5";

// A picture on this page, brought into view and marked for a moment.
function bringIntoView(img) {
  img.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
  img.classList.add("is-found");
  setTimeout(() => img.classList.remove("is-found"), 2000);
}

// pictures: [{ src, alt, from, href, here }], each one's address, its
// description, where it's from (words for under it, or null), where Goto
// Image goes, and the picture itself if it's on this page. start: which one
// shows first. hue: the viewer's.
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

  // (a picture on this page: no going anywhere, just to it)
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
  // the viewer fills the window: a click that lands on it, not on the box, is beside the picture
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => dialog.remove());

  show();
  document.body.append(dialog);
  dialog.showModal();
  close.focus();
}

// Every picture in what's written on this page opens in the viewer, among
// the others on the page.
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

// #picture-<name> on the address (Goto Image, from Pictures): that picture,
// brought into view once the page is drawn. The pictures above it are loaded
// first (they're lazy otherwise), so it isn't pushed away as they come in.
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
