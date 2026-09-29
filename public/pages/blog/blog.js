// techtrash.org : the website's pages.
//
// Three views, picked by the address:
//   (nothing)    the front page: the headline, and every topic, the one with
//                the newest post first
//   ?topic=<id>  one topic, and its posts
//   ?post=<id>   one post
//
// Each topic has one of the six hues (from its number), and keeps it: its
// card, its page and its posts all wear it.
//
// Anyone can read. The admin (server/admin.js) also gets a form for a new
// topic, one for a new post in a topic, and buttons to delete them. The server
// checks it's the admin again for every one of those: the forms are only a
// convenience, not the lock.

import { MAX_UPLOAD_BYTES, shrinkImage } from "/js/shrink-image.js";

const page = document.getElementById("page");
const params = new URLSearchParams(location.search);
const dateFormat = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" });
const date = (ms) => dateFormat.format(ms);
const pictureUrl = (name) => `/blog/img/${encodeURIComponent(name)}`;
const postCount = (n) => (n === 1 ? "1 post" : `${n} posts`);
const hueOf = (topicId) => `hue-${((Number(topicId) - 1) % 6 + 6) % 6 + 1}`;

// XP's Internet Explorer named its window after the page.
const titled = (name) => { document.title = `${name} - Microsoft Internet Explorer`; };

const admin = await fetch("/api/me")
  .then((response) => (response.ok ? response.json() : {}))
  .then((me) => me.admin === true)
  .catch(() => false);

function el(tag, props = {}, ...children) {
  const element = Object.assign(document.createElement(tag), props);
  element.append(...children.filter((child) => child != null));
  return element;
}

// Plain text, exactly as typed; web links become clickable. (As on tcc.place.)
function textWithLinks(text) {
  const out = document.createDocumentFragment();
  text.split(/(https?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]'])/).forEach((part, i) => {
    if (i % 2 === 0) out.append(part);
    else out.append(el("a", { href: part, textContent: part, rel: "noopener nofollow" }));
  });
  return out;
}

async function getJson(url) {
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "Something went wrong. Try again.");
  return body;
}

const label = (path, name) => el("h2", { className: "label" }, el("span", { className: "label__path", textContent: path }), name);
const crumb = (...parts) => el("p", { className: "crumb" }, el("a", { href: "./", textContent: "~/topics" }), ...parts.flatMap((part) => [" / ", part]));

// The top bar's button for the page you're on is filled in.
function markNav(which) {
  for (const link of document.querySelectorAll("[data-nav]")) {
    if (link.dataset.nav === which) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

// --- views ---------------------------------------------------------------------

async function showFront() {
  titled("Techtrash");
  markNav("home");
  const { topics } = await getJson("/api/blog/topics");
  const section = el("section", { className: "panel hue-4", id: "topics" }, label("~/", "topics"));
  if (admin) section.append(newTopicForm());
  if (topics.length === 0) section.append(el("p", { className: "meta", textContent: "No topics yet." }));
  else {
    section.append(el("div", { className: "topics" }, ...topics.map((topic) => el("a", { className: `card ${hueOf(topic.id)}`, href: `?topic=${topic.id}` },
      topic.picture ? el("img", { className: "card__cover", src: pictureUrl(topic.picture), alt: "" }) : null,
      el("span", { className: "card__body" },
        el("span", { className: "named", textContent: topic.title }),
        topic.description ? el("span", { className: "card__text", textContent: topic.description }) : null,
        el("span", {
          className: "meta",
          textContent: postCount(topic.post_count) + (topic.last_post ? `, the newest ${date(topic.last_post)}` : ""),
        })),
    ))));
  }
  page.replaceChildren(document.getElementById("hero").content.cloneNode(true), section);
  if (location.hash === "#topics") section.scrollIntoView();
}

async function showTopic(id) {
  const topic = await getJson(`/api/blog/topic?id=${id}`);
  titled(`${topic.title} - Techtrash`);
  markNav("topics");
  const hue = hueOf(topic.id);
  const head = el("section", { className: `panel ${hue}` },
    crumb(el("span", { textContent: topic.title })),
    topic.picture ? el("img", { className: "topic-cover", src: pictureUrl(topic.picture), alt: "" }) : null,
    el("h1", { className: "head", textContent: topic.title }),
    topic.description ? el("p", { className: "lede", textContent: topic.description }) : null,
  );
  const posts = el("section", { className: `panel ${hue}` }, label("~/", "posts"));
  if (admin) posts.append(newPostForm(topic.id));
  if (topic.posts.length === 0) posts.append(el("p", { className: "meta", textContent: "No posts yet." }));
  else {
    posts.append(el("ul", { className: "entries" }, ...topic.posts.map((post) => el("li", { className: "entry" },
      el("span", { className: "named" }, el("a", { href: `?post=${post.id}`, textContent: post.title })),
      el("span", { className: "meta", textContent: date(post.created) }),
    ))));
  }
  if (admin) posts.append(deleteButton("Delete this topic and its posts", `/api/blog/topic?id=${topic.id}`, "./"));
  page.replaceChildren(head, posts);
}

async function showPost(id) {
  const post = await getJson(`/api/blog/post?id=${id}`);
  titled(`${post.title} - Techtrash`);
  markNav("topics");
  const article = el("article", { className: `panel ${hueOf(post.topic_id)}` },
    crumb(el("a", { href: `?topic=${post.topic_id}`, textContent: post.topic_title })),
    el("h1", { className: "head", textContent: post.title }),
    el("p", { className: "meta", textContent: date(post.created) }),
    el("div", { className: "post-body" }, textWithLinks(post.body)),
  );
  if (admin) article.append(deleteButton("Delete this post", `/api/blog/post?id=${post.id}`, `?topic=${post.topic_id}`));
  page.replaceChildren(article);
}

// --- the admin's forms ------------------------------------------------------------

function fromTemplate(id) {
  return document.getElementById(id).content.firstElementChild.cloneNode(true);
}

// Sends a form's request, saying what's going on, and hands what comes back to
// done. The button stays off while it's sending.
async function send(form, url, options, done) {
  const button = form.querySelector(".button");
  const message = form.querySelector(".form__message");
  button.disabled = true;
  message.textContent = "Posting...";
  try {
    const response = await fetch(url, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "That didn't work. Try again.");
    done(body);
  } catch (error) {
    message.textContent = error.message === "Failed to fetch" ? "Can't reach techtrash.org right now." : error.message;
    button.disabled = false;
  }
}

function newTopicForm() {
  const form = fromTemplate("new-topic");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const message = form.querySelector(".form__message");
    const data = new FormData();
    data.append("title", form.elements.title.value);
    data.append("description", form.elements.description.value);
    const file = form.elements.picture.files[0];
    if (file) {
      message.textContent = "Getting the picture ready...";
      let picture;
      try {
        picture = await shrinkImage(file);
      } catch {
        message.textContent = "That picture couldn't be read.";
        return;
      }
      if (picture.size > MAX_UPLOAD_BYTES) {
        message.textContent = "That picture is too big (10 MB at most).";
        return;
      }
      data.append("picture", picture, file.name);
    }
    send(form, "/api/blog/topics", { method: "POST", body: data }, (topic) => location.assign(`?topic=${topic.id}`));
  });
  return form;
}

function newPostForm(topicId) {
  const form = fromTemplate("new-post");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    send(form, "/api/blog/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic: topicId, title: form.elements.title.value, body: form.elements.body.value }),
    }, (post) => location.assign(`?post=${post.id}`));
  });
  return form;
}

// Deleting takes two clicks: the first one asks, the second one does it.
function deleteButton(text, url, after) {
  const button = el("button", { className: "button hue-1", type: "button", textContent: text });
  let armed = false;
  button.addEventListener("click", async () => {
    if (!armed) {
      armed = true;
      button.textContent = "Click again to delete";
      return;
    }
    button.disabled = true;
    const response = await fetch(url, { method: "DELETE" }).catch(() => null);
    if (response?.ok) location.assign(after);
    else {
      button.textContent = "That didn't work. Try again.";
      button.disabled = false;
      armed = false;
    }
  });
  return el("div", { className: "button-row" }, button);
}

// --- start ---------------------------------------------------------------------

try {
  if (params.has("post")) await showPost(params.get("post"));
  else if (params.has("topic")) await showTopic(params.get("topic"));
  else await showFront();
} catch (error) {
  page.replaceChildren(el("section", { className: "panel hue-1" }, crumb(), el("p", { textContent: error.message })));
}
