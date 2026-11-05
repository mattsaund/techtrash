// techtrash.org : the website. Start here.
//
// The website is one page, index.html, and this works out which of the site's
// pages its address asks for, and draws it. The address reads like a path
// after the "?" (the desktop shows it as the site's own address:
// #blog/liftoff, #flag/space):
//   (nothing)          the front page: the headline, and under it Home: the
//                      bulletin, its words, the newest blogs beside
//   ?blog              the headline, and under it the Blog: every blog, the
//                      newest first, to sort and to filter by flag
//   ?flag/<flag>/...   the Blog, with only the blogs that have those flags
//   ?pictures          the headline, and under it every picture on the site
//   ?about             the headline, and under it About me
//   ?drafts            the admin: their drafts
//   ?blog/<blog>       one blog, and its comments
//   ?write             the admin: a new blog
//   ?edit/<blog>       the admin: changing a blog, or finishing a draft
// where <blog> and <flag> are their slugs (server/blog.js). The addresses
// from when blogs were in topics (?blog/<topic>/<post>, ?post=3) find their
// way to the new ones.
//
// Each kind of page is a module of its own:
//   front.js      the front page's panels: Home, Blog, Pictures, About me,
//                 and the admin's Drafts
//   post.js       a blog (comments.js, its comments)
//   write.js      the admin's editor page (the editor itself is editor/)
// Any picture in what's written opens in the picture viewer (viewer.js).
// and they share site.js (addresses, the admin, the window's title),
// frame.js (the headline over every page) and own-words.js (the tagline,
// Home's words, the bulletin and About me, written in place).
//
// Each blog has one of the six hues (from its number) and keeps it: its card
// and its page wear it. So does each flag, wherever it shows.

import { framed } from "./frame.js";
import { showDrafts, showFront } from "./front.js";
import { showPost } from "./post.js";
import { Gone, admin, goTo, to, whereNow } from "./site.js";
import { api, backTo, el } from "./util.js";
import { showPictureFromAddress, watchPictures } from "./viewer.js";

// The admin's editor page, loaded only for them.
const showEditor = async (postSlug) => (await import("./write.js")).showEditor(postSlug);

// ?post=3, from the first blog: the address that blog has now. A topic's or
// a flag's number (?topic=2, ?flag=1) is the Blog: those are gone.
async function numbered(old) {
  if (!old.get("post")) return to.blog;
  const post = await api(`/api/blog/post?id=${Number(old.get("post"))}`);
  return old.has("edit") ? to.edit(post.slug) : to.post(post.slug);
}

// ?blog/<topic>/<post>, from when blogs were in topics: the same blog (its
// slug may have had -2 put on it since, if another topic had one by the same
// name), or else the topic's flag, or else the Blog.
async function fromTopic(topicSlug, postSlug) {
  const { posts } = await api("/api/blog/posts");
  const inTopic = (post) => post.flags.some((flag) => flag.slug === topicSlug);
  const was = (post) => post.slug === postSlug || new RegExp(`^${postSlug.replace(/[^\w-]/g, "")}-\\d+$`).test(post.slug);
  const post = posts.find((p) => inTopic(p) && was(p)) ?? posts.find((p) => p.slug === postSlug);
  if (post) return to.post(post.slug);
  return posts.some(inTopic) ? to.flags([topicSlug]) : to.blog;
}

watchPictures(document.getElementById("page"));

try {
  const old = new URLSearchParams(location.search);
  const [first, ...rest] = whereNow();
  if (["post", "topic", "flag"].some((name) => old.get(name))) goTo(await numbered(old));
  else if (first === "blog" && rest.length > 1) goTo(await fromTopic(rest[0], rest[1]));
  else if (first === "blog" && rest.length) {
    await showPost(rest[0]);
    if (location.hash.startsWith("#comment")) document.querySelector(location.hash)?.scrollIntoView({ block: "center" });
  }
  else if (first === "flag") await showFront("blog");
  // (a visitor with the admin's address gets the page itself)
  else if (first === "drafts") await (admin ? showDrafts() : goTo(to.blog));
  else if (first === "write") await (admin ? showEditor() : goTo(to.blog));
  else if (first === "edit" && rest.length) await (admin ? showEditor(rest.at(-1)) : goTo(to.post(rest.at(-1))));
  else await showFront(["blog", "pictures", "about"].includes(first) ? first : "home");
  await showPictureFromAddress();
} catch (error) {
  if (!(error instanceof Gone)) await framed(null, async () => el("section", { class: "panel hue-1" }, backTo(to.blog), el("p", { textContent: error.message })));
}
