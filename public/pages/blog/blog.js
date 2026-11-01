// techtrash.org : the website's pages.
//
// Picked by the address, which reads like a path after the "?" (the desktop
// shows it as the site's own address: #blog/liftoff, #flag/space):
//   (nothing)          the front page: the headline, and under it Home: the
//                      bulletin, its words, the newest blogs beside
//   ?blog              the headline, and under it the Blog: every blog, the
//                      newest first, to sort and to filter by flag
//   ?flag/<flag>/...   the Blog, with only the blogs that have those flags
//   ?pictures          the headline, and under it every picture on the site
//   ?about             the headline, and under it About me
//   ?blog/<blog>       one blog, and its comments
//   ?write             the admin: a new blog
//   ?edit/<blog>       the admin: changing a blog, or finishing a draft
// where <blog> and <flag> are their slugs (server/blog.js). The addresses
// from when blogs were in topics (?blog/<topic>/<post>, ?post=3) find their
// way to the new ones.
//
// Each blog has one of the six hues (from its number) and keeps it: its card
// and its page wear it. So does each flag, wherever it shows.
//
// Anyone can read and comment. The admin (server/admin.js) also gets the
// buttons and forms to write, change and delete everything, and their
// drafts. The server checks it's the admin again for every one of those:
// they're a convenience, not the lock.

import { commentsPanel } from "./comments.js";
import { renderBody } from "./content.js";
import { api, backTo, date, el, forNow, hueOf, label, plural, remembered, status, twoClick } from "./util.js";

const page = document.getElementById("page");

// XP's Internet Explorer named its window after the page.
const titled = (name) => { document.title = `${name} - Microsoft Internet Explorer`; };

const admin = await api("/api/me").then((me) => me.admin === true, () => false);

// Every address on the site, made here and nowhere else.
const slug = (value) => encodeURIComponent(value);
const to = {
  home: "./",
  blog: "?blog",
  flags: (slugs) => (slugs.length ? `?flag/${slugs.map(slug).join("/")}` : "?blog"),
  pictures: "?pictures",
  about: "?about",
  post: (post) => `?blog/${slug(post)}`,
  write: "?write",
  edit: (post) => `?edit/${slug(post)}`,
};

// Where the page is, in parts: ?flag/space/rockets is ["flag", "space", "rockets"].
function whereNow() {
  try {
    return decodeURIComponent(location.search.slice(1)).split("/").filter(Boolean);
  } catch {
    return [];
  }
}

// The page moving without loading again (the Blog, as its flags are picked,
// or a new blog once it's saved): its address says where it is now, and the
// desktop's follows (js/desktop.js).
function moveTo(address) {
  if (location.search === address) return;
  history.replaceState(null, "", address);
  dispatchEvent(new Event("addresschange"));
}

// The page is going somewhere else: nothing more to draw.
class Gone extends Error {}
function goTo(address) {
  location.replace(address);
  throw new Gone();
}

// What this tab keeps while it's open: the Blog the way it was left (its
// address, with its flags, its sort, and any or all), for Back from a blog.
const BLOG_AT = "techtrash:blog";
const SORT = "techtrash:sort";
const MATCH = "techtrash:match";
const theBlog = () => forNow.get(BLOG_AT) ?? to.blog;

// Shows one of two things in a spot: the admin's form, or what was there.
function swap(spot, form) {
  const was = [...spot.childNodes];
  spot.replaceChildren(form);
  return () => spot.replaceChildren(...was);
}

// A blog's flags, "#space #rockets", each in its hue: links to the Blog with
// only that flag's blogs, or (on a card, which is a link already) words.
const flagTags = (flags, { links = true } = {}) => el(links ? "p" : "span", { class: "tags" },
  flags.map((flag) => el(links ? "a" : "span", { class: `tag ${hueOf(flag.id)}`, href: links ? to.flags([flag.slug]) : null, textContent: flag.name })));

// --- every page ------------------------------------------------------------------

// The page drawn again, after the admin changes something on it.
let again = () => location.reload();

// Every page: the headline, its tagline, and its buttons (Home, Blog,
// Pictures, About me) with the one for where you are filled in, and under
// them the page's own panels, made by build().
async function framed(view, build) {
  again = () => framed(view, build);
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
const PANELS = { home: homePanel, blog: blogPanel, pictures: picturesPanel, about: aboutPanel };
const showFront = (view) => framed(view, PANELS[view]);

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
          await again();
        },
      }));
    });
    spot.append(el("div", { class: "button-row" }, button, more));
  }
  return spot;
}

// --- Home ------------------------------------------------------------------------

// The bulletin across the top (if there is one), then Home's words, and down
// the right side the newest blogs: a title, and its flags under it.
async function homePanel() {
  const [home, bulletin, { posts }] = await Promise.all([
    api("/api/blog/page?name=home"), api("/api/blog/page?name=bulletin"), api("/api/blog/posts?limit=8"),
  ]);
  titled("Techtrash");
  const top = bulletinSpot(bulletin);
  // with no bulletin up, the admin's Add bulletin sits beside Edit homepage
  const add = admin && !bulletin.body.trim() ? el("button", { class: "button", type: "button", textContent: "Add bulletin" }) : null;
  add?.addEventListener("click", () => top.write());
  const main = el("div", { class: "home__main" }, pageText(home, { edit: "Edit homepage", more: [add] }));
  if (!home.body.trim() && !admin) main.append(el("p", { class: "meta", textContent: "Nothing here yet." }));

  const side = el("aside", { class: "home__side", "aria-label": "Newest blogs" },
    el("h3", { class: "group__head", textContent: "Newest blogs" }),
    posts.length
      ? el("ul", { class: "side-posts" }, posts.map((post) => el("li", { class: hueOf(post.id) },
        el("a", { class: "side-posts__title", href: to.post(post.slug), textContent: post.title }),
        post.flags.length ? flagTags(post.flags) : null)))
      : el("p", { class: "meta", textContent: "Nothing posted yet." }));

  return el("section", { class: "panel hue-5", id: "home" },
    el("div", { class: "panel__head" }, label("Home")),
    top,
    el("div", { class: "home" }, main, side));
}

// The bulletin: one thing at the top of Home that matters right now (news,
// anything), or nothing. The admin edits it or takes it down; .write() opens
// the editor in its place, for Add bulletin.
function bulletinSpot(bulletin) {
  const spot = el("div", { class: "home__bulletin" });
  const write = async () => {
    const back = swap(spot, await writingForm({
      body: bulletin.body,
      saveText: "Save bulletin",
      cancel: () => back(),
      save: async (data) => {
        await api("/api/blog/page?name=bulletin", { method: "PUT", json: data });
        await again();
      },
    }));
  };
  if (bulletin.body.trim()) {
    const box = el("article", { class: "bulletin" }, el("div", { class: "prose" }, renderBody(bulletin.body)));
    if (admin) {
      const edit = el("button", { class: "button", type: "button", textContent: "Edit bulletin" });
      edit.addEventListener("click", write);
      box.append(el("div", { class: "button-row" }, edit, twoClick("Remove bulletin", "Click again to take it down", async () => {
        await api("/api/blog/page?name=bulletin", { method: "PUT", json: { body: "" } });
        await again();
      })));
    }
    spot.append(box);
  }
  spot.write = write;
  return spot;
}

// The editor blogs have, with Save and Cancel, for one of the site's own
// pages (Home's words, the bulletin, About me, the tagline); short for a line
// or two. save({ body }) sends it and goes on.
async function writingForm({ body = "", short = false, saveText, save, cancel }) {
  const { createEditor } = await import("./editor.js");
  const editor = createEditor(body, { short });
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
    try {
      await save({ body: editor.html() });
    } catch (error) {
      message.textContent = error.message;
      saveButton.disabled = false;
    }
  });
  return el("div", { class: "writing-form" },
    editor.element,
    el("div", { class: "button-row" }, saveButton, back),
    message);
}

// --- Pictures --------------------------------------------------------------------

// Every picture posted to the site (the ones in everything written in the
// editor), newest first, edge to edge. Each one opens where it's from.
async function picturesPanel() {
  const { pictures } = await api("/api/blog/pictures");
  titled("Pictures - Techtrash");
  const where = (from) => (from.kind === "post" ? to.post(from.slug) : from.id === "about" ? to.about : to.home);
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

// The ways the Blog sorts: by when each blog went up, or by its comments.
const SORTS = {
  newest: { text: "Newest", order: (a, b) => b.at - a.at || b.id - a.id },
  oldest: { text: "Oldest", order: (a, b) => a.at - b.at || a.id - b.id },
  comments: { text: "Most comments", order: (a, b) => b.comment_count - a.comment_count || b.at - a.at || b.id - a.id },
};

// A blog's card: its first picture, title, the start of its words, the day
// it went up, its comments and its flags.
const blogCard = (post) => el("a", { class: `card ${hueOf(post.id)}`, href: to.post(post.slug) },
  post.cover ? el("img", { class: "card__cover", src: post.cover, alt: "", loading: "lazy" }) : null,
  el("span", { class: "card__body" },
    el("span", { class: "named", textContent: post.title }),
    post.excerpt ? el("span", { class: "card__text", textContent: post.excerpt }) : null,
    el("span", { class: "meta", textContent: `${date(post.at)}, ${plural(post.comment_count, "comment")}` }),
    post.flags.length ? flagTags(post.flags, { links: false }) : null));

// A small button that's on or off, filled when it's on.
function toggle(text, look, click) {
  const button = el("button", { class: `button button--small ${look}`, type: "button", textContent: text });
  button.addEventListener("click", click);
  return button;
}

// Every blog, the newest first or sorted another way, and the flags to show
// only some of them by: pick one, or several, and only the blogs with them
// (with any of them, or with all of them) show. The flags picked are in the
// address (?flag/space/rockets), so the Blog that way can be shared.
async function blogPanel() {
  const [{ posts }, { flags: every }, drafts] = await Promise.all([
    api("/api/blog/posts"),
    api("/api/blog/flags"),
    admin ? api("/api/blog/posts?drafts").then((answer) => answer.posts) : [],
  ]);
  for (const post of posts) post.at = post.published ?? post.created;
  // (the admin hears about the flags only drafts have too: no use here)
  const flags = every.filter((flag) => flag.count > 0);
  const [, ...asked] = whereNow()[0] === "flag" ? whereNow().map((part) => part.toLowerCase()) : [];
  const picked = new Set(asked.filter((s) => flags.some((flag) => flag.slug === s)));
  let sort = SORTS[forNow.get(SORT)] ? forNow.get(SORT) : "newest";
  let match = forNow.get(MATCH) === "all" ? "all" : "any";

  const sorts = Object.entries(SORTS).map(([key, { text }]) => [key, toggle(text, "", () => {
    sort = key;
    forNow.set(SORT, key);
    draw();
  })]);
  const flagButtons = flags.map((flag) => [flag, toggle(flag.name, `flag ${hueOf(flag.id)}`, () => {
    if (!picked.delete(flag.slug)) picked.add(flag.slug);
    draw();
  })]);
  const matches = [["any", "Any of them"], ["all", "All of them"]].map(([key, text]) => [key, toggle(text, "", () => {
    match = key;
    forNow.set(MATCH, key);
    draw();
  })]);
  const clear = el("button", { class: "link-button", type: "button", textContent: "Clear" });
  clear.addEventListener("click", () => {
    picked.clear();
    draw();
  });
  const matchRow = el("div", { class: "filter", role: "group", "aria-label": "Show the blogs with" },
    el("span", { class: "meta", textContent: "Show the blogs with" }), matches.map(([, button]) => button));
  const count = el("p", { class: "meta" });
  const list = el("div");

  function draw() {
    for (const [key, button] of sorts) button.setAttribute("aria-pressed", String(key === sort));
    for (const [flag, button] of flagButtons) button.setAttribute("aria-pressed", String(picked.has(flag.slug)));
    for (const [key, button] of matches) button.setAttribute("aria-pressed", String(key === match));
    clear.hidden = picked.size === 0;
    matchRow.hidden = picked.size < 2;
    const shows = (post) => {
      const has = new Set(post.flags.map((flag) => flag.slug));
      return picked.size === 0 || [...picked][match === "all" ? "every" : "some"]((s) => has.has(s));
    };
    const shown = posts.filter(shows).sort(SORTS[sort].order);
    count.textContent = picked.size ? `${shown.length} of ${plural(posts.length, "blog")}` : plural(posts.length, "blog");
    list.replaceChildren(shown.length
      ? el("div", { class: "cards" }, shown.map(blogCard))
      : el("p", { class: "meta", textContent: posts.length ? "No blog has all of those flags." : "Nothing posted yet." }));

    const on = flags.filter((flag) => picked.has(flag.slug));
    const address = to.flags([...new Set(on.map((flag) => flag.slug))]);
    moveTo(address);
    forNow.set(BLOG_AT, address);
    titled(on.length ? `Blog: ${on.map((flag) => flag.name).join(", ")} - Techtrash` : "Blog - Techtrash");
  }
  draw();

  return el("section", { class: "panel hue-4", id: "blog" },
    el("div", { class: "panel__head" },
      label("Blog"),
      posts.length > 1
        ? el("div", { class: "sort", role: "group", "aria-label": "Sort by" }, el("span", { class: "meta", textContent: "Sort by" }), sorts.map(([, button]) => button))
        : null),
    admin ? adminBlog(drafts) : null,
    flags.length
      ? el("div", { class: "filters" },
        el("div", { class: "filter", role: "group", "aria-label": "Flags" },
          el("span", { class: "meta", textContent: "Flags" }), flagButtons.map(([, button]) => button), clear),
        matchRow)
      : null,
    posts.length ? count : null,
    list);
}

// The admin's New blog, and their drafts: each one's title, to finish it.
function adminBlog(drafts) {
  return el("div", { class: "admin-blog" },
    el("div", { class: "button-row" }, el("a", { class: "button hue-4", href: to.write, textContent: "New blog" })),
    drafts.length
      ? el("section", { class: "drafts", "aria-label": "Drafts" },
        el("h3", { class: "group__head" }, "Drafts", el("span", { class: "meta", textContent: "only you can see these" })),
        el("ul", { class: "draft-list" }, drafts.map((post) => el("li", { class: hueOf(post.id) },
          el("a", { href: to.edit(post.slug), textContent: post.title }),
          el("span", { class: "meta", textContent: `started ${date(post.created)}` })))))
      : null);
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

// --- a blog ----------------------------------------------------------------------

// One blog: its title, the day it went up, its flags, its words, and its
// comments. To the admin, the buttons to change it, switch its comments, take
// it down to the drafts or delete it; or, for a draft (which only they can
// see), to finish it or put it up.
const showPost = (postSlug) => framed("blog", async () => {
  const post = await api(`/api/blog/post?slug=${slug(postSlug)}`).catch(async (error) => {
    // ?blog/<topic>, from when blogs were in topics: that topic's a flag now
    const { flags } = await api("/api/blog/flags").catch(() => ({ flags: [] }));
    if (flags.some((flag) => flag.slug === postSlug && flag.count > 0)) goTo(to.flags([postSlug]));
    throw error;
  });
  titled(`${post.title} - Techtrash`);
  const hue = hueOf(post.id);
  const when = post.draft ? "Not up yet" : date(post.published) + (post.updated ? `, changed ${date(post.updated)}` : "");
  const article = el("article", { class: `panel ${hue}` },
    backTo(theBlog()),
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
    location.assign(theBlog());
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

// --- the admin's editor ------------------------------------------------------------

// The flags a blog has, in the editor: each one a button that takes it off,
// then a box to name another (Enter or a comma puts it on; Backspace in the
// empty box takes the last one off), and under them the flags other blogs
// have, a click each. { element, value(), take() }: value() is the flags'
// names, and take() puts on the one still being typed, if there is one.
function flagPicker(start, known, onChange) {
  const MAX = 20;
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  let names = [];
  const on = el("span", { class: "flag-picker__on" });
  const field = el("input", { class: "flag-picker__field", maxlength: "40", placeholder: "Add a flag", "aria-label": "Add a flag" });
  const others = el("p", { class: "flag-picker__others" });

  // the way it's spelled already, if a blog has it
  const put = (typed) => {
    const name = typed.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!name || names.some((n) => same(n, name)) || names.length >= MAX) return false;
    names.push(known.find((flag) => same(flag.name, name))?.name ?? name);
    return true;
  };
  function draw() {
    on.replaceChildren(...names.map((name) => {
      const flag = known.find((f) => same(f.name, name));
      const chip = el("button", { class: `button button--small flag ${flag ? hueOf(flag.id) : ""}`, type: "button", title: "Take it off", "aria-label": `Take ${name} off` },
        name, el("span", { class: "flag-picker__x", "aria-hidden": "true", textContent: "×" }));
      chip.addEventListener("click", () => {
        names = names.filter((n) => n !== name);
        changed();
        field.focus();
      });
      return chip;
    }));
    const rest = known.filter((flag) => !names.some((n) => same(n, flag.name)));
    others.replaceChildren(...(rest.length ? [el("span", { class: "meta", textContent: "Used before:" }), ...rest.map((flag) => {
      const add = el("button", { class: `link-button tag ${hueOf(flag.id)}`, type: "button", textContent: flag.name });
      add.addEventListener("click", () => {
        if (put(flag.name)) changed();
      });
      return add;
    })] : []));
  }
  const changed = () => {
    draw();
    onChange();
  };
  const take = () => {
    const typed = field.value;
    field.value = "";
    if (put(typed)) changed();
  };
  field.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      take();
    } else if (e.key === "Backspace" && !field.value && names.length) {
      names.pop();
      changed();
    }
  });
  field.addEventListener("blur", take);
  for (const name of start) put(name);
  draw();
  return {
    element: el("div", { class: "flag-picker" }, el("div", { class: "flag-picker__row" }, on, field), others),
    value: () => [...names],
    take,
  };
}

// A new blog, or a change to one. What's being written is kept in this
// browser as it's typed, until it's saved or thrown away: closing the window
// loses nothing. A new blog, or a draft, saves as a draft (Save draft, or
// Ctrl+S) to finish another time, and stays open to go on with; Publish puts
// it up. A blog that's up saves its changes (Ctrl+S saves and stays open).
async function showEditor(postSlug = null) {
  const { createEditor } = await import("./editor.js");
  const [{ flags: known }, found] = await Promise.all([
    api("/api/blog/flags"),
    postSlug ? api(`/api/blog/post?slug=${slug(postSlug)}`) : null,
  ]);
  let post = found;   // a new one's null until it's first saved
  const keyOf = () => `techtrash:draft:${post ? `post-${post.id}` : "new"}`;
  let key = keyOf();
  const kept = remembered.get(key);
  const isUp = () => Boolean(post && !post.draft);
  const leave = () => (isUp() ? to.post(post.slug) : theBlog());
  titled(post ? `Editing ${post.title} - Techtrash` : "New blog - Techtrash");

  let dirty = Boolean(kept);
  let leaving = false;
  let keeping;
  const keep = () => {
    dirty = true;
    clearTimeout(keeping);
    keeping = setTimeout(() => {
      if (leaving) return;
      remembered.set(key, { title: title.value, body: editor.html(), flags: flags.value(), comments: comments.checked, saved: Date.now() });
    }, 500);
  };

  const title = el("input", { class: "editor__title", maxlength: "120", placeholder: "Title", "aria-label": "Title", value: kept?.title ?? post?.title ?? "" });
  title.addEventListener("input", keep);
  const editor = createEditor(kept?.body ?? post?.body ?? "", {
    onChange: keep,
    onTitle: (name) => {
      if (title.value.trim()) return;
      title.value = name;
      keep();
    },
  });
  const flags = flagPicker(kept?.flags ?? post?.flags.map((flag) => flag.name) ?? [], known, keep);
  const comments = el("input", { type: "checkbox", checked: kept ? kept.comments : post ? Boolean(post.comments_open) : true });
  comments.addEventListener("change", keep);

  const back = backTo(leave());
  const message = status();
  const buttons = el("div", { class: "button-row" });
  let saving = false;
  const say = (text, field) => {
    message.textContent = text;
    field?.focus();
  };

  // draft: true or false to make it one or not, or left out to leave it as
  // it is. stay: stay in the editor, rather than go to the blog's page.
  async function save({ draft, stay }) {
    if (saving) return;
    flags.take();
    if (!title.value.trim()) return say(draft ? "It needs a title, even as a draft." : "It needs a title.", title);
    if (!draft && editor.empty()) return say("Write something first.", editor);
    saving = true;
    for (const button of buttons.querySelectorAll("button")) button.disabled = true;
    say("Saving...");
    const json = { title: title.value, body: editor.html(), flags: flags.value(), comments: comments.checked };
    if (draft !== undefined) json.draft = draft;
    try {
      clearTimeout(keeping);
      const saved = post
        ? await api(`/api/blog/post?id=${post.id}`, { method: "PUT", json })
        : await api("/api/blog/posts", { method: "POST", json });
      remembered.forget(key);
      dirty = false;
      if (!stay) {
        leaving = true;
        return location.assign(to.post(saved.slug));
      }
      post = { ...post, id: saved.id, slug: saved.slug, draft: saved.draft, comments_open: json.comments ? 1 : 0 };
      key = keyOf();
      moveTo(to.edit(saved.slug));
      titled(`Editing ${title.value.trim()} - Techtrash`);
      back.querySelector("a").href = leave();
      keptNote?.remove();
      drawButtons();
      say(`Saved${saved.draft ? " as a draft" : ""}, ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`);
    } catch (error) {
      say(error.message);
    }
    saving = false;
    for (const button of buttons.querySelectorAll("button")) button.disabled = false;
  }

  // Cancel leaves what isn't saved behind: a second click, if there's any.
  const cancel = el("button", { class: "button hue-1", type: "button", textContent: "Cancel" });
  let sure = false;
  cancel.addEventListener("click", () => {
    if (dirty && !sure) {
      sure = true;
      cancel.textContent = "Click again to throw the changes away";
      return;
    }
    leaving = true;
    clearTimeout(keeping);
    remembered.forget(key);
    location.assign(leave());
  });

  const button = (text, look, click) => {
    const made = el("button", { class: `button ${look}`, type: "button", textContent: text });
    made.addEventListener("click", click);
    return made;
  };
  function drawButtons() {
    buttons.replaceChildren(...(isUp()
      ? [button("Save changes", "hue-4", () => save({ stay: false })), cancel]
      : [
        button("Publish", "hue-4", () => save({ draft: false, stay: false })),
        button("Save draft", "hue-5", () => save({ draft: true, stay: true })),
        cancel,
        post ? twoClick("Delete draft", "Click again to delete it", async () => {
          await api(`/api/blog/post?id=${post.id}`, { method: "DELETE" });
          leaving = true;
          clearTimeout(keeping);
          remembered.forget(key);
          location.assign(theBlog());
        }) : null,
      ]));
  }
  drawButtons();
  addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save(isUp() ? { stay: true } : { draft: true, stay: true });
    }
  });

  let keptNote = null;
  if (kept) {
    const throwAway = el("button", { class: "link-button", type: "button", textContent: "Throw them away" });
    throwAway.addEventListener("click", () => {
      leaving = true;
      remembered.forget(key);
      location.reload();
    });
    keptNote = el("p", { class: "meta" }, `Picked up where you left off: changes from ${new Date(kept.saved).toLocaleString()} that weren't saved. `, throwAway);
  }

  await framed("blog", async () => el("section", { class: `panel ${post ? hueOf(post.id) : "hue-4"}` },
    back,
    keptNote,
    title,
    editor.element,
    el("div", { class: "form settings" },
      el("div", { class: "form__field", role: "group", "aria-label": "Flags" }, el("span", { textContent: "Flags" }), flags.element),
      el("label", { class: "check" }, comments, "Comments on")),
    buttons,
    message));
  if (!post && !kept) title.focus();
}

// --- start ---------------------------------------------------------------------

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
  else if (first === "write") await (admin ? showEditor() : goTo(to.blog));
  else if (first === "edit" && rest.length) await (admin ? showEditor(rest.at(-1)) : goTo(to.post(rest.at(-1))));
  else await showFront(["blog", "pictures", "about"].includes(first) ? first : "home");
} catch (error) {
  if (!(error instanceof Gone)) await framed(null, async () => el("section", { class: "panel hue-1" }, backTo(to.blog), el("p", { textContent: error.message })));
}
