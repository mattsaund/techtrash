// techtrash.org : the website's pages.
//
// Picked by the address, which reads like a path after the "?" (the desktop
// shows it as the site's own address, #blog/rockets/liftoff):
//   (nothing)                the front page: the headline, and under it Home:
//                            its words and the bulletins, the newest posts beside
//   ?blog                    the headline, and under it the Blog: every topic
//   ?pictures                the headline, and under it every picture on the site
//   ?about                   the headline, and under it About me
//   ?blog/<topic>            one topic, and its posts
//   ?blog/<topic>/<post>     one post, and its comments
//   ?write/<topic>           the admin: a new post in a topic
//   ?edit/<topic>/<post>     the admin: changing a post
// where <topic> and <post> are their slugs (server/blog.js). The old numbered
// addresses (?post=3, ?topic=2) find their way to the new ones.
//
// Each topic has one of the six hues (from its number) and keeps it: its
// card, its page and its posts all wear it.
//
// Anyone can read and comment. The admin (server/admin.js) also gets the
// buttons and forms to make, change and delete everything. The server checks
// it's the admin again for every one of those: they're a convenience, not
// the lock.

import { commentsPanel } from "./comments.js";
import { renderBody } from "./content.js";
import { topicForm } from "./forms.js";
import { api, crumb, date, el, hueOf, label, pictureUrl, plural, remembered, status, twoClick } from "./util.js";

const page = document.getElementById("page");

// XP's Internet Explorer named its window after the page.
const titled = (name) => { document.title = `${name} - Microsoft Internet Explorer`; };

const admin = await api("/api/me").then((me) => me.admin === true, () => false);

// Every address on the site, made here and nowhere else.
const to = {
  home: "./",
  blog: "?blog",
  pictures: "?pictures",
  about: "?about",
  topic: (topic) => `?blog/${topic}`,
  post: (topic, post) => `?blog/${topic}/${post}`,
  write: (topic) => `?write/${topic}`,
  edit: (topic, post) => `?edit/${topic}/${post}`,
};
const slug = (value) => encodeURIComponent(value);

// Shows one of two things in a spot: the admin's form, or what was there.
function swap(spot, form) {
  const was = [...spot.childNodes];
  spot.replaceChildren(form);
  return () => spot.replaceChildren(...was);
}

// --- the front page --------------------------------------------------------------

// Every page: the headline, its tagline, and its buttons (Home, Blog,
// Pictures, About me) with the one for where you are filled in, and under
// them the page's own panels, made by build().
async function framed(view, build) {
  const [tagline, panels] = await Promise.all([api("/api/blog/page?name=tagline").catch(() => null), build()]);
  const hero = document.getElementById("hero").content.cloneNode(true);
  for (const link of hero.querySelectorAll("[data-view]")) {
    if (link.dataset.view === view) link.setAttribute("aria-current", "page");
  }
  // until it's written, the tagline is the one in index.html
  const lede = hero.querySelector(".lede");
  if (tagline) lede.replaceWith(pageText(tagline, { fallback: lede.cloneNode(true), short: true, look: "lede", edit: "Edit tagline" }));
  page.replaceChildren(hero, ...[panels].flat());
}

// The front page's panels, picked by the buttons under the headline: Home
// (what the front page opens to), the Blog, Pictures, or About me.
// (Drawn again after the admin changes something on it: the same panel.)
let frontView = "home";
const showFront = (view = frontView) => {
  frontView = view;
  return framed(view, { home: homePanel, blog: blogPanel, pictures: picturesPanel, about: aboutPanel }[view]);
};

// One of the site's own pages (the tagline, Home's words, About me): its
// words, or `fallback` until it's written, and for the admin a button (edit
// says what it says) that opens them in the editor, with any `more` buttons
// beside it. Saving draws the page again.
function pageText(text, { fallback = null, short = false, look = "", edit, more = [] }) {
  const spot = el("div", { class: `page-text ${look}` });
  const written = Boolean(text.body.trim());
  spot.append(...[written ? el("div", { class: "prose" }, renderBody(text.body)) : fallback].filter(Boolean));
  if (admin) {
    const button = el("button", { class: "button", type: "button", textContent: edit });
    button.addEventListener("click", async () => {
      const back = swap(spot, await writingForm({
        body: text.body,
        short,
        saveText: "Save",
        cancel: () => back(),
        save: async (data) => {
          await api(`/api/blog/page?name=${text.name}`, { method: "PUT", json: data });
          await showFront();
        },
      }));
    });
    spot.append(el("div", { class: "button-row" }, button, more));
  }
  return spot;
}

// --- Home ------------------------------------------------------------------------

// Home's words and the bulletins (news, things to know; pinned ones on top),
// and down the right side the newest posts: a title, and its topic under it.
async function homePanel() {
  const [home, { bulletins }, { posts }] = await Promise.all([
    api("/api/blog/page?name=home"), api("/api/blog/bulletins"), api("/api/blog/posts?limit=8"),
  ]);
  titled("Techtrash");
  // the admin's New bulletin sits beside Edit homepage, and opens its form under them
  const spot = el("div");
  const add = admin ? el("button", { class: "button", type: "button", textContent: "New bulletin" }) : null;
  add?.addEventListener("click", async () => {
    const back = swap(spot, await bulletinForm({ cancel: () => back() }));
  });
  const main = el("div", { class: "home__main" }, pageText(home, { edit: "Edit homepage", more: [add] }), spot);
  if (bulletins.length) main.append(el("div", { class: "bulletins" }, bulletins.map(bulletinBox)));
  else if (!home.body.trim() && !admin) main.append(el("p", { class: "meta", textContent: "Nothing here yet." }));

  const side = el("aside", { class: "home__side", "aria-label": "Newest posts" },
    el("h3", { class: "group__head", textContent: "Newest posts" }),
    posts.length
      ? el("ul", { class: "side-posts" }, posts.map((post) => el("li", { class: hueOf(post.topic_id) },
        el("a", { class: "side-posts__title", href: to.post(post.topic_slug, post.slug), textContent: post.title }),
        el("a", { class: "side-posts__topic", href: to.topic(post.topic_slug), textContent: post.topic_title }))))
      : el("p", { class: "meta", textContent: "Nothing posted yet." }));

  return el("section", { class: "panel hue-5", id: "home" },
    el("div", { class: "panel__head" }, label("Home")),
    el("div", { class: "home" }, main, side));
}

function bulletinBox(bulletin) {
  const box = el("article", { class: `bulletin ${hueOf(bulletin.id)}` },
    bulletin.title ? el("h3", { class: "bulletin__title", textContent: bulletin.title }) : null,
    el("div", { class: "prose" }, renderBody(bulletin.body)),
    el("p", {
      class: "meta",
      textContent: (bulletin.pinned ? "Pinned, " : "") + date(bulletin.created) + (bulletin.updated ? `, changed ${date(bulletin.updated)}` : ""),
    }));
  if (admin) {
    // in Home's hue, not the bulletin's: only Delete is red
    const edit = el("button", { class: "button hue-5", type: "button", textContent: "Edit bulletin" });
    edit.addEventListener("click", async () => {
      const back = swap(box, await bulletinForm({ bulletin, cancel: () => back() }));
    });
    const pin = el("button", { class: "button hue-5", type: "button", textContent: bulletin.pinned ? "Unpin" : "Pin to the top" });
    pin.addEventListener("click", async () => {
      await api(`/api/blog/bulletin?id=${bulletin.id}`, { method: "PUT", json: { pinned: !bulletin.pinned } });
      await showFront();
    });
    box.append(el("div", { class: "button-row" }, edit, pin, twoClick("Delete", "Click again to delete", async () => {
      await api(`/api/blog/bulletin?id=${bulletin.id}`, { method: "DELETE" });
      await showFront();
    })));
  }
  return box;
}

// A new bulletin (no bulletin), or a change to one.
function bulletinForm({ bulletin = null, cancel }) {
  return writingForm({
    title: bulletin?.title ?? "",
    body: bulletin?.body ?? "",
    pinned: bulletin?.pinned ?? 0,
    saveText: bulletin ? "Save bulletin" : "Post bulletin",
    cancel,
    save: async (data) => {
      if (bulletin) await api(`/api/blog/bulletin?id=${bulletin.id}`, { method: "PUT", json: data });
      else await api("/api/blog/bulletins", { method: "POST", json: data });
      await showFront();
    },
  });
}

// The editor posts have, with Save and Cancel, for a bulletin or a page.
// A title field if there's a title (one's optional), and a pin checkbox if
// there's a pinned; short for a line or two. save(data) sends
// { body, title?, pinned? } and goes on.
async function writingForm({ title, body = "", pinned, short = false, saveText, save, cancel }) {
  const { createEditor } = await import("./editor.js");
  const titleField = title === undefined ? null
    : el("input", { class: "editor__title", maxlength: "120", placeholder: "Title (if you like)", "aria-label": "Title", value: title });
  const editor = createEditor(body, { short });
  const pin = pinned === undefined ? null : el("input", { type: "checkbox", checked: Boolean(pinned) });
  const message = status();
  const saveButton = el("button", { class: "button hue-4", type: "button", textContent: saveText });
  const back = el("button", { class: "button hue-1", type: "button", textContent: "Cancel" });
  back.addEventListener("click", cancel);
  saveButton.addEventListener("click", async () => {
    if (editor.empty()) {
      message.textContent = "Write something first.";
      return editor.focus();
    }
    saveButton.disabled = true;
    message.textContent = "Saving...";
    const data = { body: editor.html() };
    if (titleField) data.title = titleField.value;
    if (pin) data.pinned = pin.checked;
    try {
      await save(data);
    } catch (error) {
      message.textContent = error.message;
      saveButton.disabled = false;
    }
  });
  return el("div", { class: "writing-form" },
    titleField,
    editor.element,
    pin ? el("div", { class: "form settings" }, el("label", { class: "check" }, pin, "Pin it to the top")) : null,
    el("div", { class: "button-row" }, saveButton, back),
    message);
}

// --- Pictures --------------------------------------------------------------------

// Every picture posted to the site (topics', and the ones in everything
// written in the editor), newest first, edge to edge. Each one opens where
// it's from.
async function picturesPanel() {
  const { pictures } = await api("/api/blog/pictures");
  titled("Pictures - Techtrash");
  const where = (from) => ({
    topic: () => to.topic(from.slug),
    post: () => to.post(from.topic_slug, from.slug),
    bulletin: () => to.home,
    page: () => (from.id === "about" ? to.about : to.home),
  })[from.kind]();
  return el("section", { class: "panel hue-6", id: "pictures" },
    el("div", { class: "panel__head" },
      label("Pictures"),
      el("span", { class: "meta", textContent: plural(pictures.length, "picture") })),
    pictures.length
      ? el("div", { class: "gallery" }, pictures.map((picture) => el("a", {
        class: "gallery__item",
        href: where(picture.from),
        title: picture.from.title || "Home",
      }, el("img", { src: picture.url, alt: picture.alt, loading: "lazy" }))))
      : el("p", { class: "meta", textContent: "No pictures yet." }));
}

// --- the Blog --------------------------------------------------------------------

// A topic's card: its picture, title, the start of its description, how many posts.
const card = (topic) => el("a", { class: `card ${hueOf(topic.id)}`, href: to.topic(topic.slug) },
  topic.picture ? el("img", { class: "card__cover", src: pictureUrl(topic.picture), alt: "" }) : null,
  el("span", { class: "card__body" },
    el("span", { class: "named", textContent: topic.title }),
    topic.summary ? el("span", { class: "card__text", textContent: topic.summary }) : null,
    el("span", {
      class: "meta",
      textContent: plural(topic.post_count, "post") + (topic.last_post ? `, the newest ${date(topic.last_post)}` : ""),
    })));

// Every topic, the one with the newest post first.
async function blogPanel() {
  const { topics } = await api("/api/blog/topics");
  titled("Blog - Techtrash");
  const section = el("section", { class: "panel hue-4", id: "blog" }, el("div", { class: "panel__head" }, label("Blog")));
  if (admin) {
    const spot = el("div");
    const newTopic = el("button", { class: "button hue-4", type: "button", textContent: "New topic" });
    newTopic.addEventListener("click", async () => {
      const back = swap(spot, await topicForm({ done: (topic) => location.assign(to.topic(topic.slug)), cancel: () => back() }));
      spot.querySelector("input").focus();
    });
    spot.append(el("div", { class: "button-row" }, newTopic));
    section.append(spot);
  }
  section.append(topics.length ? el("div", { class: "topics" }, topics.map(card)) : el("p", { class: "meta", textContent: "No topics yet." }));
  return section;
}

// --- About me --------------------------------------------------------------------

// The site's own About me page, which the admin writes on the site.
async function aboutPanel() {
  const about = await api("/api/blog/page?name=about");
  titled(`${about.title} - Techtrash`);
  return el("section", { class: "panel hue-2", id: "about" },
    el("div", { class: "panel__head" }, label(about.title)),
    pageText(about, { fallback: el("p", { class: "meta", textContent: "Nothing here yet." }), edit: "Edit about me" }));
}

// --- a topic ---------------------------------------------------------------------

// A post's card, like a topic's: its first picture, title, the start of its
// words, its date and comments.
const postCard = (topic, post) => el("a", { class: `card ${hueOf(topic.id)}`, href: to.post(topic.slug, post.slug) },
  post.cover ? el("img", { class: "card__cover", src: post.cover, alt: "" }) : null,
  el("span", { class: "card__body" },
    el("span", { class: "named", textContent: post.title }),
    post.excerpt ? el("span", { class: "card__text", textContent: post.excerpt }) : null,
    el("span", { class: "meta", textContent: `${date(post.created)}, ${plural(post.comment_count, "comment")}` })));

// The Blog's panel, turned to one topic: its picture and description, and its
// posts as cards, the newest first.
const showTopic = (topicSlug) => framed("blog", async () => {
  const topic = await api(`/api/blog/topic?slug=${slug(topicSlug)}`);
  titled(`${topic.title} - Techtrash`);

  // what the admin's Edit topic swaps for its form
  const about = el("div", { class: "topic-about" },
    topic.picture ? el("img", { class: "topic-cover", src: pictureUrl(topic.picture), alt: "" }) : null,
    !topic.description.trim() ? null
      : /^\s*</.test(topic.description) ? el("div", { class: "prose" }, renderBody(topic.description))
      : el("p", { class: "lede", textContent: topic.description }));
  if (admin) {
    const edit = el("button", { class: "button hue-5", type: "button", textContent: "Edit topic" });
    edit.addEventListener("click", async () => {
      // a new title is a new slug, so a new address
      const back = swap(about, await topicForm({ topic, done: (saved) => location.assign(to.topic(saved.slug)), cancel: () => back() }));
    });
    about.append(el("div", { class: "button-row" },
      el("a", { class: "button hue-4", href: to.write(topic.slug), textContent: "Write a post" }),
      edit,
      twoClick("Delete topic", `Click again: ${plural(topic.posts.length, "post")} go${topic.posts.length === 1 ? "es" : ""} with it`, async () => {
        await api(`/api/blog/topic?id=${topic.id}`, { method: "DELETE" });
        location.assign(to.blog);
      })));
  }

  return el("section", { class: `panel ${hueOf(topic.id)}`, id: "topic" },
    crumb(el("span", { textContent: topic.title })),
    el("div", { class: "panel__head" }, label(topic.title)),
    about,
    topic.posts.length
      ? el("div", { class: "topics" }, topic.posts.map((post) => postCard(topic, post)))
      : el("p", { class: "meta", textContent: "No posts yet." }));
});

// --- a post ----------------------------------------------------------------------

const showPost = (topicSlug, postSlug) => framed("blog", async () => {
  const post = await api(`/api/blog/post?topic=${slug(topicSlug)}&slug=${slug(postSlug)}`);
  titled(`${post.title} - Techtrash`);
  const hue = hueOf(post.topic_id);

  const article = el("article", { class: `panel ${hue}` },
    crumb(el("a", { href: to.topic(post.topic_slug), textContent: post.topic_title })),
    el("h1", { class: "head", textContent: post.title }),
    el("p", { class: "meta", textContent: date(post.created) + (post.updated ? `, changed ${date(post.updated)}` : "") }));
  const comments = commentsPanel(post, { admin, hue });

  if (admin) {
    const toggle = el("button", { class: "button hue-3", type: "button" });
    const say = () => { toggle.textContent = post.comments_open ? "Turn comments off" : "Turn comments on"; };
    say();
    toggle.addEventListener("click", async () => {
      toggle.disabled = true;
      try {
        await api(`/api/blog/post?id=${post.id}`, { method: "PUT", json: { comments: !post.comments_open } });
        post.comments_open = post.comments_open ? 0 : 1;
        say();
        const next = commentsPanel(await api(`/api/blog/post?id=${post.id}`), { admin, hue });
        document.getElementById("comments").replaceWith(next);
      } catch (error) {
        toggle.textContent = error.message;
      }
      toggle.disabled = false;
    });
    article.append(el("div", { class: "button-row" },
      el("a", { class: "button hue-4", href: to.edit(post.topic_slug, post.slug), textContent: "Edit post" }),
      toggle,
      twoClick("Delete post", "Click again to delete it", async () => {
        await api(`/api/blog/post?id=${post.id}`, { method: "DELETE" });
        location.assign(to.topic(post.topic_slug));
      })));
  }

  article.append(el("div", { class: "prose" }, renderBody(post.body)));
  return [article, comments];
});

// --- the admin's editor ------------------------------------------------------------

// A post being written is kept in this browser as it's typed, until it's
// posted or thrown away: closing the window loses nothing.
async function showEditor(topicSlug, postSlug = null) {
  const { createEditor } = await import("./editor.js");
  const [{ topics }, post] = await Promise.all([
    api("/api/blog/topics"),
    postSlug ? api(`/api/blog/post?topic=${slug(topicSlug)}&slug=${slug(postSlug)}`) : null,
  ]);
  const topic = topics.find((t) => (post ? t.id === post.topic_id : t.slug === topicSlug));
  if (!topic) throw new Error("That topic isn't here anymore.");
  const key = `techtrash:draft:${post ? `post-${post.id}` : `topic-${topic.id}`}`;
  const draft = remembered.get(key);
  const back = post ? to.post(post.topic_slug, post.slug) : to.topic(topic.slug);
  titled(post ? `Editing ${post.title} - Techtrash` : "New post - Techtrash");

  let leaving = false;
  let keeping;
  const keep = () => {
    clearTimeout(keeping);
    keeping = setTimeout(() => {
      if (leaving) return;
      remembered.set(key, { title: title.value, body: editor.html(), topic: where.value, comments: comments.checked, saved: Date.now() });
    }, 500);
  };

  const title = el("input", { class: "editor__title", maxlength: "120", placeholder: "Title", "aria-label": "Title", value: draft?.title ?? post?.title ?? "" });
  title.addEventListener("input", keep);
  const editor = createEditor(draft?.body ?? post?.body ?? "", {
    onChange: keep,
    onTitle: (name) => {
      if (title.value.trim()) return;
      title.value = name;
      keep();
    },
  });
  const where = el("select", { "aria-label": "Topic" }, topics.map((t) => el("option", { value: t.id, textContent: t.title })));
  where.value = draft?.topic ?? topic.id;
  where.addEventListener("change", keep);
  const comments = el("input", { type: "checkbox", checked: draft ? draft.comments : post ? Boolean(post.comments_open) : true });
  comments.addEventListener("change", keep);

  const message = status();
  const save = el("button", { class: "button hue-4", type: "button", textContent: post ? "Save changes" : "Post it" });
  const publish = async () => {
    if (!title.value.trim()) {
      message.textContent = "It needs a title.";
      return title.focus();
    }
    if (editor.empty()) {
      message.textContent = "Write something first.";
      return editor.focus();
    }
    save.disabled = true;
    message.textContent = post ? "Saving..." : "Posting...";
    const data = { topic: Number(where.value), title: title.value, body: editor.html(), comments: comments.checked };
    try {
      const saved = post
        ? await api(`/api/blog/post?id=${post.id}`, { method: "PUT", json: data })
        : await api("/api/blog/posts", { method: "POST", json: data });
      leaving = true;
      remembered.forget(key);
      location.assign(to.post(saved.topic_slug, saved.slug));
    } catch (error) {
      message.textContent = error.message;
      save.disabled = false;
    }
  };
  save.addEventListener("click", publish);
  addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (!save.disabled) publish();
    }
  });

  // Cancel throws the changes away: a second click, if there are any.
  const cancel = el("button", { class: "button hue-1", type: "button", textContent: "Cancel" });
  let sure = false;
  cancel.addEventListener("click", () => {
    if (remembered.get(key) && !sure) {
      sure = true;
      cancel.textContent = "Click again to throw the changes away";
      return;
    }
    leaving = true;
    remembered.forget(key);
    location.assign(back);
  });

  let kept = null;
  if (draft) {
    const throwAway = el("button", { class: "link-button", type: "button", textContent: "Throw them away" });
    throwAway.addEventListener("click", () => {
      leaving = true;
      remembered.forget(key);
      location.reload();
    });
    kept = el("p", { class: "meta" }, `Picked up where you left off: changes from ${new Date(draft.saved).toLocaleString()} that weren't ${post ? "saved" : "posted"}. `, throwAway);
  }

  await framed("blog", async () => el("section", { class: `panel ${hueOf(topic.id)}` },
    crumb(el("a", { href: to.topic(topic.slug), textContent: topic.title }), post ? el("a", { href: back, textContent: post.title }) : null, el("span", { textContent: post ? "edit" : "new post" })),
    kept,
    title,
    editor.element,
    el("div", { class: "form settings" },
      el("label", {}, "Topic", where),
      el("label", { class: "check" }, comments, "Comments on")),
    el("div", { class: "button-row" }, save, cancel),
    message));
  if (!post && !draft) title.focus();
}

// --- start ---------------------------------------------------------------------

// The old numbered addresses, as the new ones.
async function newAddress(old) {
  if (old.has("post")) {
    const post = await api(`/api/blog/post?id=${Number(old.get("post"))}`);
    return old.has("edit") ? to.edit(post.topic_slug, post.slug) : to.post(post.topic_slug, post.slug);
  }
  const topic = await api(`/api/blog/topic?id=${Number(old.get("topic"))}`);
  return old.has("write") ? to.write(topic.slug) : to.topic(topic.slug);
}

try {
  const old = new URLSearchParams(location.search);
  const [first, topicSlug, postSlug] = decodeURIComponent(location.search.slice(1)).split("/").filter(Boolean);
  if (old.has("post") || old.has("topic")) location.replace(await newAddress(old));
  else if (admin && first === "edit" && postSlug) await showEditor(topicSlug, postSlug);
  else if (admin && first === "write" && topicSlug) await showEditor(topicSlug);
  // (a visitor with the admin's address gets the page itself)
  else if (["blog", "edit"].includes(first) && postSlug) {
    await showPost(topicSlug, postSlug);
    if (location.hash.startsWith("#comment")) document.querySelector(location.hash)?.scrollIntoView({ block: "center" });
  }
  else if (["blog", "write"].includes(first) && topicSlug) await showTopic(topicSlug);
  else await showFront(["blog", "pictures", "about"].includes(first) ? first : old.has("flag") ? "blog" : "home");
} catch (error) {
  await framed(null, async () => el("section", { class: "panel hue-1" }, crumb(), el("p", { textContent: error.message })));
}
