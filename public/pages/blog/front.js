// Front page panels, one under the headline at a time (Home, Blog, Pictures,
// About me), plus the admin's Drafts (?drafts).

import { renderBody } from "./content.js";
import { framed } from "./frame.js";
import { ownWords, swap, writingForm } from "./own-words.js";
import { BLOG_AT, admin, again, flagTags, moveTo, theBlog, titled, to, whereNow } from "./site.js";
import { api, backTo, date, el, forNow, hueOf, label, plural, sortable, starButton, twoClick } from "./util.js";
import { openViewer, pictureHash } from "./viewer.js";

const PANELS = { home: homePanel, blog: blogPanel, pictures: picturesPanel, about: aboutPanel };
export const showFront = (view) => framed(view, PANELS[view]);

// --- Home ------------------------------------------------------------------------

// Bulletin on top, Home's words, featured blogs in the side column.
async function homePanel() {
  const [home, bulletin, { posts }] = await Promise.all([
    api("/api/blog/page?name=home"), api("/api/blog/page?name=bulletin"), api("/api/blog/posts?featured"),
  ]);
  titled("Techtrash");
  const top = bulletinSpot(bulletin);
  // no bulletin, so the admin gets Add bulletin next to Edit homepage
  const add = admin && !bulletin.body.trim() ? el("button", { class: "button", type: "button", textContent: "Add bulletin" }) : null;
  add?.addEventListener("click", () => top.write());
  const main = el("div", { class: "home__main" }, ownWords(home, { edit: "Edit homepage", more: [add] }));
  if (!home.body.trim() && !admin) main.append(el("p", { class: "meta", textContent: "Nothing here yet." }));

  const side = el("aside", { class: "home__side", "aria-label": "Featured blogs" },
    el("h3", { class: "group__head", textContent: "Featured blogs" }),
    featuredList(posts));

  return el("section", { class: "panel hue-5", id: "home" },
    el("div", { class: "panel__head" }, label("Home")),
    top,
    el("div", { class: "home" }, main, side));
}

// Starred blogs in the admin's order. The admin can drag to reorder or unstar.
function featuredList(posts) {
  if (!posts.length) return el("p", { class: "meta", textContent: admin ? "Star a blog to feature it here." : "Nothing here yet." });
  const list = el("ul", { class: "side-posts" }, posts.map((post) => {
    const title = el("a", { class: "side-posts__title", href: to.post(post.slug), textContent: post.title });
    return el("li", { class: hueOf(post.id), "data-id": post.id },
      admin ? el("span", { class: "side-posts__row" }, title, starButton(post, { changed: () => again() })) : title,
      post.flags.length ? flagTags(post.flags) : null);
  }));
  if (admin) sortable(list, (ids) => api("/api/blog/featured", { method: "PUT", json: { ids: ids.map(Number) } }).catch(() => again()));
  return list;
}

// Optional notice at the top of Home. spot.write() opens the editor in its
// place, for Add bulletin.
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

// Per-tab sort order, and any/all matching when several flags are picked.
const SORT = "techtrash:sort";
const MATCH = "techtrash:match";

// By post.at (published, else created) or comment count.
const SORTS = {
  newest: { text: "Newest", order: (a, b) => b.at - a.at || b.id - a.id },
  oldest: { text: "Oldest", order: (a, b) => a.at - b.at || a.id - b.id },
  comments: { text: "Most comments", order: (a, b) => b.comment_count - a.comment_count || b.at - a.at || b.id - a.id },
};

// A draft's card opens the editor and shows when it was started.
const blogCard = (post, { draft = false } = {}) => el("a", { class: `card ${hueOf(post.id)}`, href: draft ? to.edit(post.slug) : to.post(post.slug) },
  post.cover ? el("img", { class: "card__cover", src: post.cover, alt: "", loading: "lazy" }) : null,
  el("span", { class: "card__body" },
    el("span", { class: "named", textContent: post.title }),
    post.excerpt ? el("span", { class: "card__text", textContent: post.excerpt }) : null,
    el("span", { class: "meta", textContent: draft ? `Started ${date(post.created)}` : `${date(post.at)}, ${plural(post.comment_count, "comment")}` }),
    post.flags.length ? flagTags(post.flags, { links: false }) : null));

// Admin card. The star sits beside the card's link, not inside it.
const starredCard = (post) => el("div", { class: `card-spot ${hueOf(post.id)}` }, blogCard(post), starButton(post));

// Small toggle button. draw() sets aria-pressed, which fills it.
function toggle(text, look, click) {
  const button = el("button", { class: `button button--small ${look}`, type: "button", textContent: text });
  button.addEventListener("click", click);
  return button;
}

// Every blog, sortable and filterable by flags (any or all). Picked flags go in
// the URL (?flag/space/rockets) so a filtered Blog can be shared.
async function blogPanel() {
  const [{ posts }, { flags: every }, drafts] = await Promise.all([
    api("/api/blog/posts"),
    api("/api/blog/flags"),
    admin ? api("/api/blog/posts?drafts").then((answer) => answer.posts) : [],
  ]);
  for (const post of posts) post.at = post.published ?? post.created;
  // skip flags only drafts use (the admin's list includes them)
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
      ? el("div", { class: "cards" }, shown.map((post) => (admin ? starredCard(post) : blogCard(post))))
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

const adminBlog = (drafts) => el("div", { class: "button-row" },
  el("a", { class: "button hue-4", href: to.write, textContent: "New blog" }),
  el("a", { class: "button hue-5", href: to.drafts, textContent: drafts.length ? `Drafts (${drafts.length})` : "Drafts" }));

// --- the admin's drafts ----------------------------------------------------------

// Unpublished blogs, newest first. Admin only (server/blog.js enforces it too).
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

// Caption source, a blog's title or a site page's name.
const OWN_WORDS = { home: "Home", bulletin: "the bulletin", about: "About me", tagline: "the tagline" };
const whereFrom = (from) => (from.kind === "post" ? from.title : OWN_WORDS[from.id] ?? from.title);

// All pictures, newest first. A plain click opens the viewer. Each tile links
// to the picture in its page, for Goto Image and new tabs.
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

async function aboutPanel() {
  const about = await api("/api/blog/page?name=about");
  titled(`${about.title} - Techtrash`);
  return el("section", { class: "panel hue-2", id: "about" },
    el("div", { class: "panel__head" }, label(about.title)),
    ownWords(about, { fallback: el("p", { class: "meta", textContent: "Nothing here yet." }), edit: "Edit about me" }));
}
