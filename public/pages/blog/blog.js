// techtrash.org : the website's pages.
//
// Picked by the address:
//   (nothing)            the front page: the headline, and the Blog: every
//                        topic, by topic or by flag
//   ?flag=<id>           the same, with only the topics that wear that flag
//   ?topic=<id>          one topic, and its posts
//   ?post=<id>           one post, and its comments
//   ?topic=<id>&write    the admin: a new post in a topic
//   ?post=<id>&edit      the admin: changing a post
//
// Each topic has one of the six hues (from its number) and keeps it: its
// card, its page and its posts all wear it. So does each flag.
//
// Anyone can read and comment. The admin (server/admin.js) also gets the
// buttons and forms to make, change and delete everything. The server checks
// it's the admin again for every one of those: they're a convenience, not
// the lock.

import { commentsPanel } from "./comments.js";
import { renderBody } from "./content.js";
import { flagManager, topicForm } from "./forms.js";
import { api, crumb, date, el, hueOf, label, pictureUrl, plural, remembered, status, twoClick } from "./util.js";

const page = document.getElementById("page");
const params = new URLSearchParams(location.search);

// XP's Internet Explorer named its window after the page.
const titled = (name) => { document.title = `${name} - Microsoft Internet Explorer`; };

const admin = await api("/api/me").then((me) => me.admin === true, () => false);

// The top bar's button for the page you're on is filled in (Home, on the
// front page; nothing, anywhere else).
function markNav(which) {
  for (const link of document.querySelectorAll("[data-nav]")) {
    if (link.dataset.nav === which) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

const flagLink = (flag, current) => el("a", {
  class: `button flag ${hueOf(flag.id)}`,
  href: `?flag=${flag.id}#blog`,
  textContent: flag.name,
  "aria-current": current ? "page" : null,
});

// Shows one of two things in a spot: the admin's form, or what was there.
function swap(spot, form) {
  const was = [...spot.childNodes];
  spot.replaceChildren(form);
  return () => spot.replaceChildren(...was);
}

// --- the front page --------------------------------------------------------------

// A topic's card: its picture, title, description, how many posts, its flags.
const card = (topic) => el("a", { class: `card ${hueOf(topic.id)}`, href: `?topic=${topic.id}` },
  topic.picture ? el("img", { class: "card__cover", src: pictureUrl(topic.picture), alt: "" }) : null,
  el("span", { class: "card__body" },
    el("span", { class: "named", textContent: topic.title }),
    topic.description ? el("span", { class: "card__text", textContent: topic.description }) : null,
    el("span", {
      class: "meta",
      textContent: plural(topic.post_count, "post") + (topic.last_post ? `, the newest ${date(topic.last_post)}` : ""),
    }),
    topic.flags.length ? el("span", { class: "tags" }, topic.flags.map((f) => el("span", { class: `tag ${hueOf(f.id)}`, textContent: f.name }))) : null));

const SORT = "techtrash:sort";

// The headline, and under it the Blog: every topic, sorted by topic (newest
// post first) or by flag (a group for each flag, and one for the topics with
// none). The sort is remembered in this browser. A flag's name in its group
// shows only its topics (?flag=<id>).
async function showFront() {
  const flagId = Number(params.get("flag")) || null;
  const [{ topics }, { flags }] = await Promise.all([
    api(`/api/blog/topics${flagId ? `?flag=${flagId}` : ""}`),
    api("/api/blog/flags"),
  ]);
  const flag = flags.find((f) => f.id === flagId);
  titled(flag ? `${flag.name} - Techtrash` : "Techtrash");
  markNav("home");

  let sort = remembered.get(SORT) === "flags" ? "flags" : "topics";
  const sortButton = (mode, text) => {
    const button = el("button", { class: "button", type: "button", textContent: text });
    button.addEventListener("click", () => {
      sort = mode;
      remembered.set(SORT, mode);
      draw();
    });
    return button;
  };
  const byTopic = sortButton("topics", "Topics");
  const byFlag = sortButton("flags", "Flags");
  const list = el("div", { class: "groups" });

  const group = (name, members) => el("section", { class: "group" },
    el("h3", { class: "group__head" }, name, el("span", { class: "meta", textContent: plural(members.length, "topic") })),
    el("div", { class: "topics" }, members.map(card)));

  function draw() {
    byTopic.setAttribute("aria-pressed", String(sort === "topics"));
    byFlag.setAttribute("aria-pressed", String(sort === "flags"));
    if (topics.length === 0) {
      list.replaceChildren(el("p", { class: "meta", textContent: flag ? `No topics wear ${flag.name} yet.` : "No topics yet." }));
    } else if (flag || sort === "topics") {
      list.replaceChildren(el("div", { class: "topics" }, topics.map(card)));
    } else {
      const groups = flags
        .map((f) => [f, topics.filter((topic) => topic.flags.some((worn) => worn.id === f.id))])
        .filter(([, members]) => members.length);
      const loose = topics.filter((topic) => topic.flags.length === 0);
      list.replaceChildren(...groups.map(([f, members]) => group(el("a", { class: `group__name flag ${hueOf(f.id)}`, href: `?flag=${f.id}#blog`, textContent: f.name }), members)));
      if (loose.length) list.append(group(el("span", { class: "group__name", textContent: groups.length ? "No flag" : "No flags yet" }), loose));
    }
  }

  const section = el("section", { class: "panel hue-4", id: "blog" },
    el("div", { class: "panel__head" },
      label("Blog", flag?.name),
      flag
        ? el("a", { class: "button", href: "./#blog", textContent: "All topics" })
        : el("div", { class: "sort", role: "group", "aria-label": "Sort by" }, el("span", { class: "meta", textContent: "Sort by" }), byTopic, byFlag)));

  if (admin) {
    const spot = el("div");
    const newTopic = el("button", { class: "button hue-4", type: "button", textContent: "New topic" });
    const editFlags = el("button", { class: "button hue-6", type: "button", textContent: "Edit flags" });
    newTopic.addEventListener("click", () => {
      const back = swap(spot, topicForm({ flags, done: (topic) => location.assign(`?topic=${topic.id}`), cancel: () => back() }));
      spot.querySelector("input").focus();
    });
    editFlags.addEventListener("click", () => swap(spot, flagManager(flags, showFront)));
    spot.append(el("div", { class: "button-row" }, newTopic, editFlags));
    section.append(spot);
  }

  draw();
  section.append(list);
  page.replaceChildren(document.getElementById("hero").content.cloneNode(true), section);
  if (location.hash === "#blog") section.scrollIntoView();
}

// --- a topic ---------------------------------------------------------------------

async function showTopic(id) {
  const topic = await api(`/api/blog/topic?id=${id}`);
  titled(`${topic.title} - Techtrash`);
  markNav(null);
  const hue = hueOf(topic.id);

  const head = el("section", { class: `panel ${hue}` },
    crumb(el("span", { textContent: topic.title })),
    topic.picture ? el("img", { class: "topic-cover", src: pictureUrl(topic.picture), alt: "" }) : null,
    el("h1", { class: "head", textContent: topic.title }),
    topic.description ? el("p", { class: "lede", textContent: topic.description }) : null,
    topic.flags.length ? el("nav", { class: "button-row", "aria-label": "Flags" }, topic.flags.map((f) => flagLink(f))) : null);

  if (admin) {
    const edit = el("button", { class: "button hue-5", type: "button", textContent: "Edit topic" });
    edit.addEventListener("click", async () => {
      const { flags } = await api("/api/blog/flags");
      const back = swap(head, topicForm({ topic, flags, done: () => showTopic(topic.id), cancel: () => back() }));
    });
    head.append(el("div", { class: "button-row" },
      el("a", { class: "button hue-4", href: `?topic=${topic.id}&write`, textContent: "Write a post" }),
      edit,
      twoClick("Delete topic", `Click again: ${plural(topic.posts.length, "post")} go${topic.posts.length === 1 ? "es" : ""} with it`, async () => {
        await api(`/api/blog/topic?id=${topic.id}`, { method: "DELETE" });
        location.assign("./#blog");
      })));
  }

  const posts = el("section", { class: `panel ${hue}` }, label("Posts"));
  if (topic.posts.length === 0) posts.append(el("p", { class: "meta", textContent: "No posts yet." }));
  else {
    posts.append(el("ul", { class: "entries" }, topic.posts.map((post) => el("li", { class: "entry" },
      el("span", { class: "named" }, el("a", { href: `?post=${post.id}`, textContent: post.title })),
      el("span", { class: "meta", textContent: `${date(post.created)}, ${plural(post.comment_count, "comment")}` }),
    ))));
  }
  page.replaceChildren(head, posts);
}

// --- a post ----------------------------------------------------------------------

async function showPost(id) {
  const post = await api(`/api/blog/post?id=${id}`);
  titled(`${post.title} - Techtrash`);
  markNav(null);
  const hue = hueOf(post.topic_id);

  const article = el("article", { class: `panel ${hue}` },
    crumb(el("a", { href: `?topic=${post.topic_id}`, textContent: post.topic_title })),
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
      el("a", { class: "button hue-4", href: `?post=${post.id}&edit`, textContent: "Edit post" }),
      toggle,
      twoClick("Delete post", "Click again to delete it", async () => {
        await api(`/api/blog/post?id=${post.id}`, { method: "DELETE" });
        location.assign(`?topic=${post.topic_id}`);
      })));
  }

  article.append(el("div", { class: "prose" }, renderBody(post.body)));
  page.replaceChildren(article, comments);
  if (location.hash.startsWith("#comment")) document.querySelector(location.hash)?.scrollIntoView({ block: "center" });
}

// --- the admin's editor ------------------------------------------------------------

// A post being written is kept in this browser as it's typed, until it's
// posted or thrown away: closing the window loses nothing.
async function showEditor({ postId, topicId }) {
  const { createEditor } = await import("./editor.js");
  const [{ topics }, post] = await Promise.all([
    api("/api/blog/topics"),
    postId ? api(`/api/blog/post?id=${postId}`) : null,
  ]);
  const topic = topics.find((t) => t.id === Number(post?.topic_id ?? topicId));
  if (!topic) throw new Error("That topic isn't here anymore.");
  const key = `techtrash:draft:${post ? `post-${post.id}` : `topic-${topic.id}`}`;
  const draft = remembered.get(key);
  const back = post ? `?post=${post.id}` : `?topic=${topic.id}`;
  titled(post ? `Editing ${post.title} - Techtrash` : "New post - Techtrash");
  markNav(null);

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
      location.assign(`?post=${saved.id}`);
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

  page.replaceChildren(el("section", { class: `panel ${hueOf(topic.id)}` },
    crumb(el("a", { href: `?topic=${topic.id}`, textContent: topic.title }), post ? el("a", { href: back, textContent: post.title }) : null, el("span", { textContent: post ? "edit" : "new post" })),
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

try {
  if (admin && params.has("post") && params.has("edit")) await showEditor({ postId: params.get("post") });
  else if (params.has("post")) await showPost(params.get("post"));
  else if (admin && params.has("topic") && params.has("write")) await showEditor({ topicId: params.get("topic") });
  else if (params.has("topic")) await showTopic(params.get("topic"));
  else await showFront();
} catch (error) {
  page.replaceChildren(el("section", { class: "panel hue-1" }, crumb(), el("p", { textContent: error.message })));
}
