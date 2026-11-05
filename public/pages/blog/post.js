// techtrash.org : a blog's own page.
//
// Its title, the day it went up, its flags, its words, and its comments
// (comments.js). The admin also gets the buttons to change it, switch its
// comments off or on, take it down to the drafts, or delete it; or, for a
// draft (which only they can see), to finish it, put it up, or throw it away.

import { commentsPanel } from "./comments.js";
import { renderBody } from "./content.js";
import { framed } from "./frame.js";
import { admin, flagTags, goTo, theBlog, titled, to } from "./site.js";
import { api, backTo, date, el, hueOf, status, twoClick } from "./util.js";

// The blog whose slug is postSlug.
export const showPost = (postSlug) => framed("blog", async () => {
  const post = await api(`/api/blog/post?slug=${encodeURIComponent(postSlug)}`).catch(async (error) => {
    // ?blog/<topic>, from when blogs were in topics: that topic's a flag now
    const { flags } = await api("/api/blog/flags").catch(() => ({ flags: [] }));
    if (flags.some((flag) => flag.slug === postSlug && flag.count > 0)) goTo(to.flags([postSlug]));
    throw error;
  });
  titled(`${post.title} - Techtrash`);
  const hue = hueOf(post.id);
  const when = post.draft ? "Not up yet" : date(post.published) + (post.updated ? `, changed ${date(post.updated)}` : "");
  const article = el("article", { class: `panel ${hue}` },
    backTo(post.draft ? to.drafts : theBlog()),
    post.draft ? el("p", { class: "notice", textContent: "A draft: only you can see it, until you publish it." }) : null,
    el("h1", { class: "head", textContent: post.title }),
    el("p", { class: "meta", textContent: when }),
    post.flags.length ? flagTags(post.flags) : null,
    admin ? postButtons(post, hue) : null,
    el("div", { class: "prose" }, renderBody(post.body)));
  return post.draft ? article : [article, commentsPanel(post, { admin, hue })];
});

// The admin's buttons on a blog's page.
function postButtons(post, hue) {
  const message = status();
  const put = (json) => api(`/api/blog/post?id=${post.id}`, { method: "PUT", json });
  const remove = (what) => twoClick(`Delete ${what}`, "Click again to delete it", async () => {
    await api(`/api/blog/post?id=${post.id}`, { method: "DELETE" });
    location.assign(post.draft ? to.drafts : theBlog());
  });

  if (post.draft) {
    const publish = el("button", { class: "button hue-4", type: "button", textContent: "Publish" });
    publish.addEventListener("click", async () => {
      publish.disabled = true;
      message.textContent = "Publishing...";
      try {
        await put({ draft: false });
        location.reload();
      } catch (error) {
        message.textContent = error.message;
        publish.disabled = false;
      }
    });
    return [el("div", { class: "button-row" }, el("a", { class: "button hue-5", href: to.edit(post.slug), textContent: "Edit draft" }), publish, remove("draft")), message];
  }

  const comments = el("button", { class: "button hue-3", type: "button" });
  const say = () => { comments.textContent = post.comments_open ? "Turn comments off" : "Turn comments on"; };
  say();
  comments.addEventListener("click", async () => {
    comments.disabled = true;
    try {
      await put({ comments: !post.comments_open });
      post.comments_open = post.comments_open ? 0 : 1;
      say();
      document.getElementById("comments").replaceWith(commentsPanel(await api(`/api/blog/post?id=${post.id}`), { admin, hue }));
    } catch (error) {
      comments.textContent = error.message;
    }
    comments.disabled = false;
  });
  return el("div", { class: "button-row" },
    el("a", { class: "button hue-4", href: to.edit(post.slug), textContent: "Edit blog" }),
    comments,
    twoClick("Move to drafts", "Click again to take it down", async () => {
      await put({ draft: true });
      location.reload();
    }, "button hue-2"),
    remove("blog"));
}
