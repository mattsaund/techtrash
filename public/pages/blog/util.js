// techtrash.org : small things every part of the website uses.

import { MAX_UPLOAD_BYTES, shrinkImage } from "/js/shrink-image.js";

const dateFormat = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" });
export const date = (ms) => dateFormat.format(ms);
export const pictureUrl = (name) => `/blog/img/${encodeURIComponent(name)}`;
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Each blog (and each flag) has one of the six hues, from its number, and keeps it.
export const hueOf = (id) => `hue-${((Number(id) - 1) % 6 + 6) % 6 + 1}`;

// el("a", { href: "?blog/liftoff", class: "card" }, "a child", anotherElement)
// Anything the element has as a property is set as one (textContent, hidden,
// checked...); the rest become attributes (class, for, aria-label, data-...).
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

// Plain text, exactly as typed; web links become clickable. (As on tcc.place.)
export function textWithLinks(text) {
  const out = document.createDocumentFragment();
  text.split(/(https?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]'])/).forEach((part, i) => {
    if (i % 2 === 0) out.append(part);
    else out.append(el("a", { href: part, textContent: part, rel: "noopener nofollow" }));
  });
  return out;
}

// Asks the server. Answers what it says back, or throws what went wrong, in words.
export async function api(url, { method = "GET", json, form } = {}) {
  const options = { method };
  if (json !== undefined) {
    options.headers = { "content-type": "application/json" };
    options.body = JSON.stringify(json);
  }
  if (form) options.body = form;
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new Error("Can't reach techtrash.org right now.");
  }
  if (response.status === 204) return {};
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "That didn't work. Try again.");
  return body;
}

// A picture, shrunk and ready to upload, or an Error that says why not.
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

// A section's name, in its hue: "Blog".
export const label = (name) => el("h2", { class: "label", textContent: name });

// "Back", at the top of a panel: up one, from a blog to the Blog.
export const backTo = (href) => el("p", { class: "crumb" }, el("a", { href, textContent: "Back" }));

// A button that takes two clicks: the first one asks, the second one does it.
// work() throws to say it didn't work.
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

// A form's line that says what's going on.
export const status = () => el("p", { class: "form__message meta", role: "status" });

// What this browser remembers (a comment's name, a blog not saved yet), and
// what this tab does while it's open (the Blog's sort). Either can be
// switched off, or full, so it's only ever a convenience.
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
