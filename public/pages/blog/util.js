// Small helpers the whole website uses.

import { MAX_UPLOAD_BYTES, shrinkImage } from "/js/shrink-image.js";

const dateFormat = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" });
export const date = (ms) => dateFormat.format(ms);
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Each blog (and each flag) gets one of the six hues from its number, and keeps it.
export const hueOf = (id) => `hue-${((Number(id) - 1) % 6 + 6) % 6 + 1}`;

// el("a", { href: "?blog/liftoff", class: "card" }, "a child", anotherElement)
// Anything the element has as a property is set as one (textContent, hidden,
// checked...). The rest become attributes (class, for, aria-label, data-...).
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

// Plain text exactly as typed, with web links made clickable (as on tcc.place).
export function textWithLinks(text) {
  const out = document.createDocumentFragment();
  text.split(/(https?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]'])/).forEach((part, i) => {
    if (i % 2 === 0) out.append(part);
    else out.append(el("a", { href: part, textContent: part, rel: "noopener nofollow" }));
  });
  return out;
}

// Calls the server and returns its answer, or throws an Error saying what went
// wrong. Send json as JSON, form as FormData, or body as is (a file).
export async function api(url, { method = "GET", json, form, body } = {}) {
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

// Shrinks a picture for upload, or throws an Error saying why not.
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

// Checks a sound file for upload (it goes as is), or throws an Error saying
// why not. The server has the same size limit (server/blog.js).
const MAX_SOUND_BYTES = 20 * 1024 * 1024;
export function readySound(file) {
  if (file.size > MAX_SOUND_BYTES) throw new Error("That sound is too big (20 MB at most).");
  return file;
}

// A section's name in its hue, like "Blog".
export const label = (name) => el("h2", { class: "label", textContent: name });

// "Back" at the top of a panel, up one level (from a blog to the Blog).
export const backTo = (href) => el("p", { class: "crumb" }, el("a", { href, textContent: "Back" }));

// A button that takes two clicks. The first asks, the second does it. work()
// throws to say it failed.
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

// What this browser remembers (a commenter's name, an unsaved blog) and what
// this tab keeps while it's open (the Blog's sort). Storage can be off or
// full, so it's only ever a convenience.
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
