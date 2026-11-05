// techtrash.org : the front page's panels.
//
// Under the headline, one of four panels, picked by its buttons:
//   Home      the bulletin, Home's words, and the newest blogs beside them
//   Blog      every blog as a card, to sort and to filter by flag
//   Pictures  every picture posted to the site
//   About me  the site's own About page
// The admin also gets the buttons to change what's on them, and, from the
// Blog's Drafts button, a panel of their drafts (?drafts).

import { renderBody } from "./content.js";
import { framed } from "./frame.js";
import { ownWords, swap, writingForm } from "./own-words.js";
import { BLOG_AT, admin, again, flagTags, moveTo, theBlog, titled, to, whereNow } from "./site.js";
import { api, backTo, date, el, forNow, hueOf, label, plural, twoClick } from "./util.js";
import { openViewer, pictureHash } from "./viewer.js";

// The front page, with `view` (home, blog, pictures or about) under the headline.
const PANELS = { home: homePanel, blog: blogPanel, pictures: picturesPanel, about: aboutPanel };
export const showFront = (view) => framed(view, PANELS[view]);

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
  const main = el("div", { class: "home__main" }, ownWords(home, { edit: "Edit homepage", more: [add] }));
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

// --- the Blog --------------------------------------------------------------------

// What this tab keeps while it's open: how the Blog was sorted, and whether
// its flags show the blogs with any of them or with all of them.
const SORT = "techtrash:sort";
const MATCH = "techtrash:match";

// The ways the Blog sorts: by when each blog went up, or by its comments.
const SORTS = {
  newest: { text: "Newest", order: (a, b) => b.at - a.at || b.id - a.id },
  oldest: { text: "Oldest", order: (a, b) => a.at - b.at || a.id - b.id },
  comments: { text: "Most comments", order: (a, b) => b.comment_count - a.comment_count || b.at - a.at || b.id - a.id },
};

// A blog's card: its first picture, title, the start of its words, the day
// it went up, its comments and its flags. A draft's opens it in the editor,
// and says when it was started.
const blogCard = (post, { draft = false } = {}) => el("a", { class: `card ${hueOf(post.id)}`, href: draft ? to.edit(post.slug) : to.post(post.slug) },
  post.cover ? el("img", { class: "card__cover", src: post.cover, alt: "", loading: "lazy" }) : null,
  el("span", { class: "card__body" },
    el("span", { class: "named", textContent: post.title }),
    post.excerpt ? el("span", { class: "card__text", textContent: post.excerpt }) : null,
    el("span", { class: "meta", textContent: draft ? `Started ${date(post.created)}` : `${date(post.at)}, ${plural(post.comment_count, "comment")}` }),
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

// The admin's buttons over the Blog: New blog, and Drafts (with how many
// there are), which opens their drafts' own panel.
const adminBlog = (drafts) => el("div", { class: "button-row" },
  el("a", { class: "button hue-4", href: to.write, textContent: "New blog" }),
  el("a", { class: "button hue-5", href: to.drafts, textContent: drafts.length ? `Drafts (${drafts.length})` : "Drafts" }));

// --- the admin's drafts ----------------------------------------------------------

// Every blog the admin has started and not put up (or taken back down), the
// newest first, as cards: each opens in the editor, to finish it. Nobody else
// sees them, here or anywhere (server/blog.js says so too).
export const showDrafts = () => framed("blog", async () => {
  const { posts: drafts } = await api("/api/blog/posts?drafts");
  titled("Drafts - Techtrash");
  return el("section", { class: "panel hue-5", id: "drafts" },
    backTo(theBlog()),
    el("div", { class: "panel__head" },
      label("Drafts"),
      el("span", { class: "meta", textContent: plural(drafts.length, "draft") })),
    el("p", { class: "meta", textContent: "Only you can see these, until you publish them." }),
    drafts.length
      ? el("div", { class: "cards" }, drafts.map((post) => blogCard(post, { draft: true })))
      : el("p", { class: "meta", textContent: "No drafts. Save draft, in the editor, keeps one here." }));
});

// --- Pictures --------------------------------------------------------------------

// Where a picture is from, in words: a blog's title, or which of the site's own words.
const OWN_WORDS = { home: "Home", bulletin: "the bulletin", about: "About me", tagline: "the tagline" };
const whereFrom = (from) => (from.kind === "post" ? from.title : OWN_WORDS[from.id] ?? from.title);

// Every picture posted to the site (the ones in everything written in the
// editor), newest first, edge to edge. A click opens one in the viewer, among
// the rest, and its Goto Image goes to it on the page it's on (as does a
// picture opened in a new tab).
async function picturesPanel() {
  const { pictures } = await api("/api/blog/pictures");
  titled("Pictures - Techtrash");
  const pageOf = (from) => (from.kind === "post" ? to.post(from.slug) : from.id === "about" ? to.about : to.home);
  const place = (picture) => pageOf(picture.from) + pictureHash(picture.url);
  const gallery = el("div", { class: "gallery" }, pictures.map((picture) => el("a", {
    class: "gallery__item",
    href: place(picture),
    title: `From ${whereFrom(picture.from)}`,
  }, el("img", { src: picture.url, alt: picture.alt, loading: "lazy" }))));
  gallery.addEventListener("click", (e) => {
    const item = e.target.closest(".gallery__item");
    if (!item || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const viewed = pictures.map((picture) => ({ src: picture.url, alt: picture.alt, from: whereFrom(picture.from), href: place(picture), here: null }));
    openViewer(viewed, [...gallery.children].indexOf(item), { hue: "hue-6" });
  });
  return el("section", { class: "panel hue-6", id: "pictures" },
    el("div", { class: "panel__head" },
      label("Pictures"),
      el("span", { class: "meta", textContent: plural(pictures.length, "picture") })),
    pictures.length ? gallery : el("p", { class: "meta", textContent: "No pictures yet." }));
}

// --- About me --------------------------------------------------------------------

// The site's own About me page, which the admin writes on the site.
async function aboutPanel() {
  const about = await api("/api/blog/page?name=about");
  titled(`${about.title} - Techtrash`);
  return el("section", { class: "panel hue-2", id: "about" },
    el("div", { class: "panel__head" }, label(about.title)),
    ownWords(about, { fallback: el("p", { class: "meta", textContent: "Nothing here yet." }), edit: "Edit about me" }));
}
