// techtrash.org : what every page of the website shares.
//
// Who's reading (the admin, or anyone), every address on the site, the
// window's title, and going from one page to another. blog.js works out which
// page the address asks for; each kind of page is drawn by a module of its
// own (front.js, post.js, write.js), inside the frame they all share
// (frame.js).

import { api, el, forNow, hueOf } from "./util.js";

// The admin (server/admin.js) gets the buttons and forms to write, change and
// delete everything, and their drafts. The server checks it's the admin again
// for every one of those: they're a convenience, not the lock.
export const admin = await api("/api/me").then((me) => me.admin === true, () => false);

// Every address on the site, made here and nowhere else. A blog's and a
// flag's are their slugs, their names made fit for an address (server/blog.js).
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

// Where the page is, in parts: ?flag/space/rockets is ["flag", "space", "rockets"].
export function whereNow() {
  try {
    return decodeURIComponent(location.search.slice(1)).split("/").filter(Boolean);
  } catch {
    return [];
  }
}

// The page moving without loading again (the Blog, as its flags are picked,
// or a new blog once it's saved): its address says where it is now, and the
// desktop's follows (js/desktop.js).
export function moveTo(address) {
  if (location.search === address) return;
  history.replaceState(null, "", address);
  dispatchEvent(new Event("addresschange"));
}

// The page is going somewhere else: nothing more to draw. (blog.js catches it.)
export class Gone extends Error {}
export function goTo(address) {
  location.replace(address);
  throw new Gone();
}

// XP's Internet Explorer named its window after the page.
export const titled = (name) => { document.title = `${name} - Microsoft Internet Explorer`; };

// The Blog the way it was left (its address, with the flags picked), kept
// while the tab's open, for Back from a blog. The Blog keeps it (front.js).
export const BLOG_AT = "techtrash:blog";
export const theBlog = () => forNow.get(BLOG_AT) ?? to.blog;

// A blog's flags, "#space #rockets", each in its hue: links to the Blog with
// only that flag's blogs, or (on a card, which is a link already) words.
export const flagTags = (flags, { links = true } = {}) => el(links ? "p" : "span", { class: "tags" },
  flags.map((flag) => el(links ? "a" : "span", { class: `tag ${hueOf(flag.id)}`, href: links ? to.flags([flag.slug]) : null, textContent: flag.name })));

// The page drawn again, after the admin changes something on it. frame.js
// says how, each time it draws a page.
let drawAgain = () => location.reload();
export const again = () => drawAgain();
export const drawWith = (draw) => { drawAgain = draw; };
