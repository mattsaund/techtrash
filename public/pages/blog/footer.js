// The footer under every page. Above its line (the copyleft, the credits and
// the feed) go the admin's own words and a row of blinkies, those little
// blinking badges from the old web. The admin edits the words in place and
// adds blinkies from their computer, then drags them into order or takes one
// off. The server keeps both as pages (server/blog.js).

import { ownWords } from "./own-words.js";
import { admin, again } from "./site.js";
import { api, el, readyPicture, sortable } from "./util.js";

const foot = document.querySelector(".foot");
const line = foot.querySelector(".foot__line");

// A blinkie is a picture uploaded to the site, kept as an <img> in its page.
const BLINKIE = /^\/blog\/img\/[\w-]+\.(?:png|jpg|gif|webp|avif)$/;
const addressesIn = (body) => [...body.matchAll(/<img\b[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]).filter((url) => BLINKIE.test(url));
const bodyOf = (urls) => urls.map((url) => `<img src="${url}" alt="">`).join("");

async function saveBlinkies(urls) {
  await api("/api/blog/page?name=blinkies", { method: "PUT", json: { body: bodyOf(urls) } });
  await again();
}

// Draws the footer, after anything about it changes too.
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

// The blinkies in a row, each at its own size. The admin can drag them into
// a new order, and take one off with its ×.
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

// The admin's Add blinkies button. It picks pictures off their computer
// (animated GIFs stay as they are), puts each up, and adds them to the end.
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
