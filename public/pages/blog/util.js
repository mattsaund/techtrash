// Shared helpers for the website.

import { MAX_UPLOAD_BYTES, shrinkImage } from "/js/shrink-image.js";

const dateFormat = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" });
export const date = (ms) => dateFormat.format(ms);
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Stable hue class (hue-1 to hue-6) from a blog or flag id.
export const hueOf = (id) => `hue-${((Number(id) - 1) % 6 + 6) % 6 + 1}`;

// el("a", { href: "?blog/liftoff", class: "card" }, "a child", anotherElement)
// Keys the element has as properties (textContent, hidden, checked) are set
// directly, the rest as attributes.
export function el(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key in element) element[key] = value;
    else element.setAttribute(key, value === true ? "" : value);
  }
  element.append(...children.flat(Infinity).filter((child) => child != null && child !== false));
  return element;
}

// Plain text, with http(s) URLs made into links.
export function textWithLinks(text) {
  const out = document.createDocumentFragment();
  text.split(/(https?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]'])/).forEach((part, i) => {
    if (i % 2 === 0) out.append(part);
    else out.append(el("a", { href: part, textContent: part, rel: "noopener nofollow" }));
  });
  return out;
}

// fetch() wrapper. Returns the parsed JSON or throws an Error with the server's
// message. Send json (as JSON), form (FormData) or body (raw, like a file).
export async function api(url, { method = "GET", json, form, body } = {}) {
  // Use index.html's early response once. Any write makes them all stale.
  if (method !== "GET") window.earlyAnswers?.clear();
  const early = method === "GET" && window.earlyAnswers?.get(url);
  if (early) {
    window.earlyAnswers.delete(url);
    const got = await early;
    if (got) {
      if (!got.ok) throw new Error(got.answer.error ?? "That didn't work. Try again.");
      return got.answer;
    }
  }
  const options = { method };
  if (json !== undefined) {
    options.headers = { "content-type": "application/json" };
    options.body = JSON.stringify(json);
  }
  if (form) options.body = form;
  if (body) options.body = body;
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new Error("Can't reach techtrash.org right now.");
  }
  if (response.status === 204) return {};
  const answer = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(answer.error ?? "That didn't work. Try again.");
  return answer;
}

// Shrinks a picture for upload, or throws with the reason.
export async function readyPicture(file) {
  let picture;
  try {
    picture = await shrinkImage(file);
  } catch {
    throw new Error("That picture couldn't be read.");
  }
  if (picture.size > MAX_UPLOAD_BYTES) throw new Error("That picture is too big (10 MB at most).");
  return picture;
}

// Sounds upload as is. Same size limit as server/blog.js MAX_SOUND_BYTES.
const MAX_SOUND_BYTES = 20 * 1024 * 1024;
export function readySound(file) {
  if (file.size > MAX_SOUND_BYTES) throw new Error("That sound is too big (20 MB at most).");
  return file;
}

// Section heading in the section's hue.
export const label = (name) => el("h2", { class: "label", textContent: name });

// "Back" link at the top of a panel.
export const backTo = (href) => el("p", { class: "crumb" }, el("a", { href, textContent: "Back" }));

// Click twice to confirm (disarms after 4 s). work() throws to show an error.
export function twoClick(text, ask, work, look = "button hue-1") {
  const button = el("button", { class: look, type: "button", textContent: text });
  let armed = false;
  let disarm;
  button.addEventListener("click", async () => {
    if (!armed) {
      armed = true;
      button.textContent = ask;
      disarm = setTimeout(() => {
        armed = false;
        button.textContent = text;
      }, 4000);
      return;
    }
    clearTimeout(disarm);
    button.disabled = true;
    try {
      await work();
    } catch (error) {
      button.textContent = error.message;
      button.disabled = false;
      armed = false;
    }
  });
  return button;
}

// A form's status line.
export const status = () => el("p", { class: "form__message meta", role: "status" });

// Admin's star for featuring a blog on Home. words adds a "Feature(d)" label,
// for button rows. changed(on) runs after a successful toggle.
export function starButton(post, { words = false, changed } = {}) {
  const button = el("button", { class: words ? "button feature-star feature-star--words" : "feature-star", type: "button" });
  const show = () => {
    const on = post.featured != null;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", String(on));
    button.title = on ? "Take it off Home's featured blogs" : "Feature it on Home";
    if (words) button.textContent = on ? "Featured" : "Feature";
    else button.setAttribute("aria-label", "Featured on Home");
  };
  show();
  button.addEventListener("click", async (e) => {
    e.preventDefault();
    const on = post.featured == null;
    button.disabled = true;
    try {
      await api(`/api/blog/post?id=${post.id}`, { method: "PUT", json: { featured: on } });
      post.featured = on ? 1 : null;
      show();
      changed?.(on);
    } catch (error) {
      button.title = error.message;
    }
    button.disabled = false;
  });
  return button;
}

// Drag to reorder `list` (items need data-id). A press without a move stays a
// click. done(ids) gets the new order. across is for a wrapping row (blinkies).
export function sortable(list, done, { across = false } = {}) {
  let draggedAt = 0;
  list.classList.add("is-sortable");
  // native link and image drags would steal the pointer
  for (const one of list.querySelectorAll("a, img")) one.draggable = false;
  list.addEventListener("dragstart", (e) => e.preventDefault());
  // swallow the click that ends a drag
  list.addEventListener("click", (e) => {
    if (performance.now() - draggedAt < 400) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
  list.addEventListener("pointerdown", (down) => {
    const item = down.target.closest("[data-id]");
    if (down.button !== 0 || item?.parentElement !== list || down.target.closest("button")) return;
    let dragging = false;
    const move = (e) => {
      if (e.pointerId !== down.pointerId) return;
      if (!dragging) {
        if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < 5) return;
        dragging = true;
        item.classList.add("is-dragging");
      }
      e.preventDefault();
      // insert before the first item whose middle the pointer hasn't reached
      const next = [...list.children].find((one) => {
        if (one === item) return false;
        const r = one.getBoundingClientRect();
        if (!across) return e.clientY < r.top + r.height / 2;
        return e.clientY < r.top || (e.clientY < r.bottom && e.clientX < r.left + r.width / 2);
      });
      if (next !== item.nextElementSibling) list.insertBefore(item, next ?? null);
    };
    const up = (e) => {
      if (e.pointerId !== down.pointerId) return;
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", up);
      if (!dragging) return;
      item.classList.remove("is-dragging");
      draggedAt = performance.now();
      done([...list.children].map((one) => one.dataset.id));
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", up);
  });
}

// JSON in localStorage (remembered) or sessionStorage (forNow). Storage can be
// off or full, so failures are ignored. Convenience only.
function keeper(storage) {
  return {
    get(key) {
      try {
        return JSON.parse(storage().getItem(key));
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        storage().setItem(key, JSON.stringify(value));
      } catch {}
    },
    forget(key) {
      try {
        storage().removeItem(key);
      } catch {}
    },
  };
}
export const remembered = keeper(() => localStorage);
export const forNow = keeper(() => sessionStorage);
