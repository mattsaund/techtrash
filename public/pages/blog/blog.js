// Website entry point. index.html is the only page. The query string is the
// route, read as a path. The desktop shows ?blog/liftoff as #blog/liftoff.
//
//   (none)            Home (bulletin, featured blogs)
//   ?blog             the Blog, sorted and filtered by flag
//   ?flag/<flag>/...  the Blog, only blogs with those flags
//   ?pictures         every picture on the site
//   ?about            About me
//   ?drafts           admin's drafts
//   ?blog/<blog>      a blog and its comments
//   ?write            admin, new blog
//   ?edit/<blog>      admin, edit a blog or finish a draft
//
// <blog> and <flag> are slugs (server/blog.js). Older URL forms
// (?blog/<topic>/<post>, ?post=3) still redirect.

import { framed } from "./frame.js";
import { showDrafts, showFront } from "./front.js";
import { showPost } from "./post.js";
import { Gone, admin, goTo, to, whereNow } from "./site.js";
import { api, backTo, el } from "./util.js";
import { showPictureFromAddress, watchPictures } from "./viewer.js";

// Admin only, loaded on demand.
const showEditor = async (postSlug) => (await import("./write.js")).showEditor(postSlug);

// Old numeric URLs. ?post=3 goes to its slug, ?topic=2 and ?flag=1 to the Blog.
async function numbered(old) {
  if (!old.get("post")) return to.blog;
  const post = await api(`/api/blog/post?id=${Number(old.get("post"))}`);
  return old.has("edit") ? to.edit(post.slug) : to.post(post.slug);
}

// Old ?blog/<topic>/<post> URLs. Tries the post, then the topic's flag, then the
// Blog. The slug may have gained a -N suffix (slugs used to be per topic).
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
  // non-admins on admin routes get the public page
  else if (first === "drafts") await (admin ? showDrafts() : goTo(to.blog));
  else if (first === "write") await (admin ? showEditor() : goTo(to.blog));
  else if (first === "edit" && rest.length) await (admin ? showEditor(rest.at(-1)) : goTo(to.post(rest.at(-1))));
  else await showFront(["blog", "pictures", "about"].includes(first) ? first : "home");
  await showPictureFromAddress();
} catch (error) {
  if (!(error instanceof Gone)) await framed(null, async () => el("section", { class: "panel hue-1" }, backTo(to.blog), el("p", { textContent: error.message })));
}

// Drop unused early responses from index.html (they'd go stale).
// sky/space.js waits for pagedrawn before building planets.
window.earlyAnswers?.clear();
window.pageDrawn = true;
dispatchEvent(new Event("pagedrawn"));
