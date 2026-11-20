// Footer words and blinkies (old-web badge GIFs), above the line in index.html.
// Both are stored as pages (server/blog.js). The admin edits them in place.

import { ownWords } from "./own-words.js";
import { admin, again } from "./site.js";
import { api, el, readyPicture, sortable } from "./util.js";

const foot = document.querySelector(".foot");
const line = foot.querySelector(".foot__line");

// The blinkies page body is a run of <img>s of uploaded pictures.
const BLINKIE = /^\/blog\/img\/[\w-]+\.(?:png|jpg|gif|webp|avif)$/;
const addressesIn = (body) => [...body.matchAll(/<img\b[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]).filter((url) => BLINKIE.test(url));
const bodyOf = (urls) => urls.map((url) => `<img src="${url}" alt="">`).join("");

async function saveBlinkies(urls) {
  await api("/api/blog/page?name=blinkies", { method: "PUT", json: { body: bodyOf(urls) } });
  await again();
}

// Runs with every page draw (frame.js).
export async function drawFooter() {
  const [words, blinkies] = await Promise.all([
    api("/api/blog/page?name=footer").catch(() => null),
    api("/api/blog/page?name=blinkies").catch(() => null),
  ]);
  const parts = [];
  if (words) {
    parts.push(ownWords(words, { short: true, canEmpty: true, look: "foot__words", edit: "Edit footer", more: admin && blinkies ? addBlinkies(blinkies) : [] }));
  }
  if (blinkies) parts.push(blinkiesRow(blinkies));
  foot.replaceChildren(...parts, line);
}

// Blinkies at native size. The admin can drag to reorder or remove one with ×.
function blinkiesRow(page) {
  const urls = addressesIn(page.body);
  const row = el("div", { class: "blinkies" }, urls.map((url) => {
    const blinkie = el("span", { class: "blinkie", "data-id": url }, el("img", { src: url, alt: "", loading: "lazy" }));
    if (admin) {
      const off = el("button", { class: "blinkie__off", type: "button", textContent: "×", title: "Take this blinkie off", "aria-label": "Take this blinkie off" });
      off.addEventListener("click", () => saveBlinkies(urls.filter((one) => one !== url)));
      blinkie.append(off);
    }
    return blinkie;
  }));
  if (admin && urls.length > 1) sortable(row, saveBlinkies, { across: true });
  return row;
}

// Uploads picked pictures and appends them. GIFs go up as is, so they animate.
function addBlinkies(page) {
  const picker = el("input", { type: "file", accept: "image/gif,image/png,image/webp,image/jpeg", multiple: true, hidden: true });
  const button = el("button", { class: "button", type: "button", textContent: "Add blinkies" });
  button.addEventListener("click", () => picker.click());
  picker.addEventListener("change", async () => {
    const files = [...picker.files];
    if (!files.length) return;
    button.disabled = true;
    button.textContent = "Adding...";
    try {
      const urls = addressesIn(page.body);
      for (const file of files) {
        const form = new FormData();
        form.append("picture", await readyPicture(file), file.name || "blinkie");
        urls.push((await api("/api/blog/pictures", { method: "POST", form })).url);
      }
      await saveBlinkies(urls);
    } catch (error) {
      button.textContent = error.message;
      button.disabled = false;
    }
  });
  return [button, picker];
}
