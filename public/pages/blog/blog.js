// The website. Start here.
//
// It's one page, index.html, and this draws whichever page the address asks
// for. The address reads like a path after the "?", and the desktop shows it
// as the site's own address (#blog/liftoff, #flag/space).
//
//   (nothing)          Home, with the bulletin and the newest blogs
//   ?blog              the Blog, every blog, to sort and filter by flag
//   ?flag/<flag>/...   the Blog, only the blogs with those flags
//   ?pictures          every picture on the site
//   ?about             About me
//   ?drafts            the admin's drafts
//   ?blog/<blog>       one blog and its comments
//   ?write             the admin, writing a new blog
//   ?edit/<blog>       the admin, changing a blog or finishing a draft
//
// <blog> and <flag> are slugs (server/blog.js). Addresses from back when
// blogs were in topics (?blog/<topic>/<post>, ?post=3) still find their way.
//
// Each kind of page is its own module. front.js draws the front page's
// panels and the admin's Drafts, post.js a blog (comments.js its comments)
// and write.js the admin's editor page (the editor itself is editor/). They
// share site.js (addresses, the admin, the window title), frame.js (the
// headline on every page) and own-words.js (the tagline, Home's words, the
// bulletin and About me, edited in place). Any picture in what's written
// opens in viewer.js.
//
// Each blog gets one of the six hues from its number and keeps it, on its
// card and its page. So does each flag.

import { framed } from "./frame.js";
import { showDrafts, showFront } from "./front.js";
import { showPost } from "./post.js";
import { Gone, admin, goTo, to, whereNow } from "./site.js";
import { api, backTo, el } from "./util.js";
import { showPictureFromAddress, watchPictures } from "./viewer.js";

// The admin's editor page, loaded only for them.
const showEditor = async (postSlug) => (await import("./write.js")).showEditor(postSlug);

// ?post=3 from the first blog goes to that post's address now. Numbered
// topics and flags (?topic=2, ?flag=1) are gone, so those go to the Blog.
async function numbered(old) {
  if (!old.get("post")) return to.blog;
  const post = await api(`/api/blog/post?id=${Number(old.get("post"))}`);
  return old.has("edit") ? to.edit(post.slug) : to.post(post.slug);
}

// ?blog/<topic>/<post> from when blogs were in topics. Goes to the same blog
// (its slug may have gotten a -2 since, if another topic had a post by the
// same name), or else the topic's flag, or else the Blog.
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
  // (anyone else on an admin address gets the public page instead)
  else if (first === "drafts") await (admin ? showDrafts() : goTo(to.blog));
  else if (first === "write") await (admin ? showEditor() : goTo(to.blog));
  else if (first === "edit" && rest.length) await (admin ? showEditor(rest.at(-1)) : goTo(to.post(rest.at(-1))));
  else await showFront(["blog", "pictures", "about"].includes(first) ? first : "home");
  await showPictureFromAddress();
} catch (error) {
  if (!(error instanceof Gone)) await framed(null, async () => el("section", { class: "panel hue-1" }, backTo(to.blog), el("p", { textContent: error.message })));
}
