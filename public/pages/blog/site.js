// What every page of the website shares. Whether the admin is reading, every
// address on the site, the window title, and moving between pages. blog.js
// picks the page, and front.js, post.js and write.js draw them inside the
// frame they share (frame.js).

import { api, el, forNow, hueOf } from "./util.js";

// The admin (server/admin.js) gets the buttons and forms to write, change and
// delete everything, plus their drafts. The server checks again on every
// request, so this is a convenience, not the lock.
export const admin = await api("/api/me").then((me) => me.admin === true, () => false);

// Every address on the site, made here and nowhere else. Blogs and flags go
// by their slugs (server/blog.js).
const slug = (value) => encodeURIComponent(value);
export const to = {
  home: "./",
  blog: "?blog",
  flags: (slugs) => (slugs.length ? `?flag/${slugs.map(slug).join("/")}` : "?blog"),
  pictures: "?pictures",
  about: "?about",
  drafts: "?drafts",
  post: (post) => `?blog/${slug(post)}`,
  write: "?write",
  edit: (post) => `?edit/${slug(post)}`,
};

// The address in parts, so ?flag/space/rockets is ["flag", "space", "rockets"].
export function whereNow() {
  try {
    return decodeURIComponent(location.search.slice(1)).split("/").filter(Boolean);
  } catch {
    return [];
  }
}

// Changes the address without reloading (the Blog as flags are picked, or a
// new blog once it's saved). The desktop's address follows (js/desktop.js).
export function moveTo(address) {
  if (location.search === address) return;
  history.replaceState(null, "", address);
  dispatchEvent(new Event("addresschange"));
}

// The page is leaving, so there's nothing more to draw. blog.js catches Gone.
export class Gone extends Error {}
export function goTo(address) {
  location.replace(address);
  throw new Gone();
}

// XP's Internet Explorer named its window after the page.
export const titled = (name) => { document.title = `${name} - Microsoft Internet Explorer`; };

// The Blog's address as it was left (with its picked flags), so Back from a
// blog goes there. front.js saves it for as long as the tab's open.
export const BLOG_AT = "techtrash:blog";
export const theBlog = () => forNow.get(BLOG_AT) ?? to.blog;

// A blog's flags ("#space #rockets"), each in its hue. Each links to the Blog
// filtered by it, or is plain text on a card, since a card is already a link.
export const flagTags = (flags, { links = true } = {}) => el(links ? "p" : "span", { class: "tags" },
  flags.map((flag) => el(links ? "a" : "span", { class: `tag ${hueOf(flag.id)}`, href: links ? to.flags([flag.slug]) : null, textContent: flag.name })));

// Redraws the page after the admin changes something. frame.js sets how,
// each time it draws a page.
let drawAgain = () => location.reload();
export const again = () => drawAgain();
export const drawWith = (draw) => { drawAgain = draw; };
