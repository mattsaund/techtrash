// techtrash.org : the blog.
//
// Three views, picked by the address:
//   (nothing)    every topic, the one with the newest post first
//   ?topic=<id>  one topic, and its posts
//   ?post=<id>   one post
//
// Anyone can read. The admin (server/admin.js) also gets a form for a new
// topic, one for a new post in a topic, and buttons to delete them. The server
// checks it's the admin again for every one of those: the forms are only a
// convenience, not the lock.

import { MAX_UPLOAD_BYTES, shrinkImage } from "/js/shrink-image.js";

const main = document.getElementById("blog");
const params = new URLSearchParams(location.search);
const dateFormat = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" });
const date = (ms) => dateFormat.format(ms);
const pictureUrl = (name) => `/blog/img/${encodeURIComponent(name)}`;
const postCount = (n) => (n === 1 ? "1 post" : `${n} posts`);

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

// --- views ---------------------------------------------------------------------

async function showTopics() {
  const { topics } = await getJson("/api/blog/topics");
  main.replaceChildren(el("h1", { textContent: "Blog" }));
  if (admin) main.append(newTopicForm());
  if (topics.length === 0) {
    main.append(el("p", { className: "meta", textContent: "No topics yet." }));
    return;
  }
  main.append(el("ul", { className: "topics" }, ...topics.map((topic) => el("li", {},
    el("a", { className: "topic", href: `?topic=${topic.id}` },
      topic.picture ? el("img", { className: "topic__picture", src: pictureUrl(topic.picture), alt: "" }) : null,
      el("span", { className: "topic__text" },
        el("span", { className: "topic__title", textContent: topic.title }),
        topic.description ? el("span", { textContent: topic.description }) : null,
        el("span", {
          className: "meta",
          textContent: postCount(topic.post_count) + (topic.last_post ? `, the newest ${date(topic.last_post)}` : ""),
        }))),
  ))));
}

async function showTopic(id) {
  const topic = await getJson(`/api/blog/topic?id=${id}`);
  document.title = `${topic.title} - Blog`;
  main.replaceChildren(
    el("p", {}, el("a", { href: "./", textContent: "All topics" })),
    topic.picture ? el("img", { className: "topic-picture", src: pictureUrl(topic.picture), alt: "" }) : null,
    el("h1", { textContent: topic.title }),
    topic.description ? el("p", { className: "topic-description", textContent: topic.description }) : null,
  );
  if (admin) main.append(newPostForm(topic.id));
  main.append(el("h2", { textContent: "Posts" }));
  if (topic.posts.length === 0) main.append(el("p", { className: "meta", textContent: "No posts yet." }));
  else {
    main.append(el("ul", { className: "posts" }, ...topic.posts.map((post) => el("li", {},
      el("a", { href: `?post=${post.id}`, textContent: post.title }),
      el("span", { className: "meta", textContent: ` ${date(post.created)}` }),
    ))));
  }
  if (admin) main.append(deleteButton("Delete this topic and its posts", `/api/blog/topic?id=${topic.id}`, "./"));
}

async function showPost(id) {
  const post = await getJson(`/api/blog/post?id=${id}`);
  document.title = `${post.title} - Blog`;
  main.replaceChildren(
    el("p", {}, el("a", { href: `?topic=${post.topic_id}`, textContent: post.topic_title })),
    el("h1", { textContent: post.title }),
    el("p", { className: "meta", textContent: date(post.created) }),
    el("div", { className: "post-body" }, textWithLinks(post.body)),
  );
  if (admin) main.append(deleteButton("Delete this post", `/api/blog/post?id=${post.id}`, `?topic=${post.topic_id}`));
}

// --- the admin's forms ------------------------------------------------------------

function fromTemplate(id) {
  return document.getElementById(id).content.firstElementChild.cloneNode(true);
}

// Sends a form's request, saying what's going on, and hands what comes back to
// done. The button stays off while it's sending.
async function send(form, url, options, done) {
  const button = form.querySelector(".button");
  const message = form.querySelector(".blog-form__message");
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
    const message = form.querySelector(".blog-form__message");
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
function deleteButton(label, url, after) {
  const button = el("button", { className: "button", type: "button", textContent: label });
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
  return el("div", { className: "button-row blog-delete" }, button);
}

// --- start ---------------------------------------------------------------------

try {
  if (params.has("post")) await showPost(params.get("post"));
  else if (params.has("topic")) await showTopic(params.get("topic"));
  else await showTopics();
} catch (error) {
  main.replaceChildren(
    el("p", {}, el("a", { href: "./", textContent: "All topics" })),
    el("p", { textContent: error.message }),
  );
}
