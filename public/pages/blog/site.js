// Shared by every page. Admin flag, URLs, navigation, window title.

import { api, el, forNow, hueOf } from "./util.js";

// UI only. The server checks admin on every request (server/admin.js).
export const admin = await api("/api/me").then((me) => me.admin === true, () => false);

// Every site URL is built here. Blogs and flags use slugs (server/blog.js).
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

// ?flag/space/rockets becomes ["flag", "space", "rockets"].
export function whereNow() {
  try {
    return decodeURIComponent(location.search.slice(1)).split("/").filter(Boolean);
  } catch {
    return [];
  }
}

// Changes the URL without reloading. js/desktop.js follows addresschange.
export function moveTo(address) {
  if (location.search === address) return;
  history.replaceState(null, "", address);
  dispatchEvent(new Event("addresschange"));
}

// Thrown to stop drawing while the page navigates away. blog.js catches it.
export class Gone extends Error {}
export function goTo(address) {
  location.replace(address);
  throw new Gone();
}

// IE-style title, "<page> - Microsoft Internet Explorer".
export const titled = (name) => { document.title = `${name} - Microsoft Internet Explorer`; };

// The Blog's last URL (with flags), for Back links. front.js keeps it per tab.
export const BLOG_AT = "techtrash:blog";
export const theBlog = () => forNow.get(BLOG_AT) ?? to.blog;

// "#space #rockets", each in its hue. links is false on cards, which are
// already links.
export const flagTags = (flags, { links = true } = {}) => el(links ? "p" : "span", { class: "tags" },
  flags.map((flag) => el(links ? "a" : "span", { class: `tag ${hueOf(flag.id)}`, href: links ? to.flags([flag.slug]) : null, textContent: flag.name })));

// Redraws after an admin edit. frame.js sets the current page via drawWith().
let drawAgain = () => location.reload();
export const again = () => drawAgain();
export const drawWith = (draw) => { drawAgain = draw; };
