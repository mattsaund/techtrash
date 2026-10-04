// techtrash.org : the blog.
//
//   topic    a title, an optional description (HTML from the editor, like a
//            post's body; plain text from before that), and an optional
//            picture.
//   post     a title and a body under one topic. The body is HTML from the
//            editor, cleaned by the page before it's sent and again before it's
//            shown (public/pages/blog/content.js). Its comments can be switched
//            off, which keeps the ones already there and stops new ones.
//   comment  anyone's, on a post, or a reply to another comment, so a post's
//            comments are threads. A name and plain text, nothing else.
//   page     a page of the site's own, written by the admin: Home's words, the
//            bulletin at the top of Home (one, or none), About me, and the
//            tagline under the headline. Just a body like a post's.
//
// A topic and a post each have a slug, their title made fit for an address
// ("Daft Punk's best" is daft-punks-best), so the site's addresses read
// #blog/<topic>/<post>. A topic's is its own; a post's is its own within its
// topic. They follow the title when it changes.
//
// Reading is anyone's. Everything else is the admin's (worker.js checks with
// server/admin.js), except posting a comment, which is anyone's while the
// post's comments are on, 5 a minute per person (COMMENT_LIMITER).
//
// Everything is in the D1 database DB; the tables are made the first time
// they're needed. Pictures (a topic's, and any in words written in the editor)
// are in the KV store PICTURES, under "blog/<name>", served at /blog/img/<name>.
//
//   GET    /api/blog/topics              every topic, newest post first, each with
//                                        a summary of its description
//   GET    /api/blog/topic?id= | ?slug=  a topic and its posts, each with the start of
//                                        its words and its first picture
//   POST   /api/blog/topics              admin: a form: title, description, picture
//   PUT    /api/blog/topic?id=           admin: the same form, plus removePicture
//   DELETE /api/blog/topic?id=           admin: the topic, its posts and their comments
//   GET    /api/blog/posts[?limit=]      the newest posts, from every topic, each
//                                        with the start of its words (5, up to 20)
//   GET    /api/blog/post?id=            a post, its topic and its comments; or by
//          /api/blog/post?topic=&slug=   its topic's slug and its own
//   POST   /api/blog/posts               admin: { topic, title, body, comments }
//   PUT    /api/blog/post?id=            admin: any of { topic, title, body, comments }
//   DELETE /api/blog/post?id=            admin: the post and its comments
//                                        (and pictures nothing else shows)
//   GET    /api/blog/pictures            every picture posted to the site, newest first,
//                                        each with where it's from
//   POST   /api/blog/pictures            admin: a form with a picture; says its address
//   POST   /api/blog/comments            anyone: { post, parent, name, body }
//   DELETE /api/blog/comment?id=         admin: the comment's words go, its replies stay
//   GET    /api/blog/page?name=          a page's body ("" until it's written, or once
//                                        it's taken down): home, bulletin, about, tagline
//   PUT    /api/blog/page?name=          admin: { body }

import { isAdmin } from "./admin.js";
import { apiError, clientKey, done, fresh } from "./http.js";

const MAX_LENGTH = { title: 120, description: 500_000, body: 500_000, name: 40, comment: 2000 };
const MAX_PICTURE_BYTES = 10 * 1024 * 1024;
const PICTURES = "blog/";
const FIRST_PICTURES = "topics/";   // where the first blog kept a topic's picture
export const PICTURE_NAME = /^[\w-]+\.(?:png|jpg|gif|webp|avif)$/;

// --- the tables ------------------------------------------------------------------

// Made the first time they're needed, once per Worker instance.
let schemaReady;
function ensureSchema(env) {
  schemaReady ??= (async () => {
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS topics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        slug TEXT,
        description TEXT NOT NULL DEFAULT '',
        picture TEXT,
        created INTEGER NOT NULL,
        updated INTEGER
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        slug TEXT,
        body TEXT NOT NULL,
        comments_open INTEGER NOT NULL DEFAULT 1,
        created INTEGER NOT NULL,
        updated INTEGER
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        parent_id INTEGER,
        name TEXT NOT NULL,
        body TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        deleted INTEGER NOT NULL DEFAULT 0,
        created INTEGER NOT NULL
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS pages (
        name TEXT PRIMARY KEY,
        body TEXT NOT NULL,
        updated INTEGER
      )`),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS posts_by_topic ON posts (topic_id)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS comments_by_post ON comments (post_id)"),
    ]);
    await upgrade(env);
    await env.DB.batch([
      env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS topics_by_slug ON topics (slug)"),
      env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS posts_by_slug ON posts (topic_id, slug)"),
    ]);
  })().catch((error) => {
    schemaReady = undefined;
    throw error;
  });
  return schemaReady;
}

// The first blogs (September and October 2026) made topics and posts without
// the columns added since, and the very first kept a post as plain text.
// CREATE TABLE IF NOT EXISTS leaves a table that's already there as it is, so
// this brings one up to date, slugs and all.
// Two Worker instances can try at once: adding a column that's there fails,
// and the one that fails leaves it to the other.
async function upgrade(env) {
  const columns = async (table) => {
    const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
    return new Set(results.map((column) => column.name));
  };
  const alreadyThere = (error) => {
    if (!/duplicate column/i.test(error.message)) throw error;
  };
  const topics = await columns("topics");
  if (!topics.has("updated")) {
    await env.DB.prepare("ALTER TABLE topics ADD COLUMN updated INTEGER").run().catch(alreadyThere);
  }
  if (!topics.has("slug")) await env.DB.prepare("ALTER TABLE topics ADD COLUMN slug TEXT").run().catch(alreadyThere);
  const posts = await columns("posts");
  if (!posts.has("slug")) await env.DB.prepare("ALTER TABLE posts ADD COLUMN slug TEXT").run().catch(alreadyThere);
  if (!posts.has("updated")) {
    await env.DB.prepare("ALTER TABLE posts ADD COLUMN updated INTEGER").run().catch(alreadyThere);
  }
  if (!posts.has("comments_open")) {
    // The posts were plain text; now they're HTML. In one go with the new
    // column, so they're only ever turned into HTML once.
    const { results } = await env.DB.prepare("SELECT id, body FROM posts").all();
    await env.DB.batch([
      env.DB.prepare("ALTER TABLE posts ADD COLUMN comments_open INTEGER NOT NULL DEFAULT 1"),
      ...results.map((post) => env.DB.prepare("UPDATE posts SET body = ? WHERE id = ?").bind(textToHtml(post.body), post.id)),
    ]).catch(alreadyThere);
  }
  // A topic or a post from before slugs gets one.
  const { results: bareTopics } = await env.DB.prepare("SELECT id, title FROM topics WHERE slug IS NULL ORDER BY id").all();
  for (const topic of bareTopics) {
    await env.DB.prepare("UPDATE topics SET slug = ? WHERE id = ?").bind(await topicSlug(env, topic.title, topic.id), topic.id).run();
  }
  const { results: barePosts } = await env.DB.prepare("SELECT id, topic_id, title FROM posts WHERE slug IS NULL ORDER BY id").all();
  for (const post of barePosts) {
    await env.DB.prepare("UPDATE posts SET slug = ? WHERE id = ?").bind(await postSlug(env, post.topic_id, post.title, post.id), post.id).run();
  }
}

// --- slugs -----------------------------------------------------------------------

// "Daft Punk's best (2001)!" as daft-punks-best-2001
function slugify(title, fallback) {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug || fallback;
}

// The title's slug, or with -2, -3... on the end if something else has it.
async function freeSlug(base, taken) {
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!(await taken(slug))) return slug;
  }
}

// A topic's slug: its own among all topics (but itself, if it's id).
const topicSlug = (env, title, id = null) => freeSlug(slugify(title, "topic"),
  (slug) => env.DB.prepare("SELECT 1 FROM topics WHERE slug = ? AND id IS NOT ?").bind(slug, id).first());

// A post's slug: its own among its topic's posts.
const postSlug = (env, topicId, title, id = null) => freeSlug(slugify(title, "post"),
  (slug) => env.DB.prepare("SELECT 1 FROM posts WHERE topic_id = ? AND slug = ? AND id IS NOT ?").bind(topicId, slug, id).first());

// A first-blog post, as the HTML that shows it the way it showed then: a
// paragraph for each blank line, a line break for each line, links clickable.
function textToHtml(text) {
  const escaped = text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  return escaped
    .split(/\n{2,}/)
    .map((paragraph) => {
      const linked = paragraph.replace(/https?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]']/g, (url) => `<a href="${url}">${url}</a>`);
      return `<p>${linked.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
}

// --- small things ----------------------------------------------------------------

function cleanText(value, max) {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim().slice(0, max) : "";
}

const idParam = (request) => Number(new URL(request.url).searchParams.get("id"));

async function readJson(request, maxBytes) {
  if (Number(request.headers.get("content-length")) > maxBytes) return null;
  return request.json().catch(() => null);
}

async function readForm(request) {
  if (Number(request.headers.get("content-length")) > MAX_PICTURE_BYTES + MAX_LENGTH.description * 2 + 100_000) return null;
  return request.formData().catch(() => null);
}

// Identify the image from its first bytes rather than trusting the file name or the browser
function detectImageType(bytes) {
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return { ext: "png", type: "image/png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg", type: "image/jpeg" };
  if (ascii(0, 4) === "GIF8") return { ext: "gif", type: "image/gif" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { ext: "webp", type: "image/webp" };
  if (ascii(4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(8, 12))) return { ext: "avif", type: "image/avif" };
  return null;
}

// "My Cat!.PNG" -> "My-Cat-3f9a1c.png". The random bit keeps pictures from replacing each other.
function pictureName(original, ext) {
  const base = original
    .replace(/\.[^.]*$/, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${base || "picture"}-${crypto.randomUUID().slice(0, 6)}.${ext}`;
}

// Stores a picture from a form's file field. Answers { name } or { error }.
async function storePicture(env, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > MAX_PICTURE_BYTES) return { error: apiError(413, "That picture is too big (10 MB at most).") };
  const image = detectImageType(bytes);
  if (!image) return { error: apiError(415, "The picture has to be a png, jpg, gif, webp or avif.") };
  const name = pictureName(file.name ?? "", image.ext);
  try {
    await env.PICTURES.put(PICTURES + name, bytes, { metadata: { type: image.type } });
  } catch {
    // most likely the free plan's 1,000 writes a day or 1 GB of storage has run out
    return { error: apiError(503, "Pictures are full right now. Try again tomorrow.") };
  }
  return { name };
}

const hasFile = (value) => value instanceof Blob && value.size > 0;

export async function servePicture(name, env) {
  let found = await env.PICTURES.getWithMetadata(PICTURES + name, { type: "stream" });
  if (!found.value) found = await env.PICTURES.getWithMetadata(FIRST_PICTURES + name, { type: "stream" });
  if (!found.value) return new Response("not found", { status: 404 });
  return new Response(found.value, {
    headers: {
      "content-type": found.metadata?.type ?? "application/octet-stream",
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  });
}

async function deletePicture(env, name) {
  if (!name) return;
  await Promise.all([env.PICTURES.delete(PICTURES + name), env.PICTURES.delete(FIRST_PICTURES + name)]);
}

// The pictures a post's (or a page's) body shows, by name.
const picturesIn = (body) => [...(body ?? "").matchAll(/\/blog\/img\/([\w-]+\.(?:png|jpg|gif|webp|avif))/g)].map((m) => m[1]);

// Deletes the pictures nothing shows anymore: no topic's, and in no post or page.
async function dropUnused(env, names) {
  for (const name of new Set(names)) {
    const used = await env.DB.prepare(
      `SELECT 1 FROM topics WHERE picture = ?1 UNION ALL SELECT 1 FROM topics WHERE instr(description, ?2) > 0
       UNION ALL SELECT 1 FROM posts WHERE instr(body, ?2) > 0
       UNION ALL SELECT 1 FROM pages WHERE instr(body, ?2) > 0 LIMIT 1`,
    ).bind(name, `/blog/img/${name}`).first();
    if (!used) await deletePicture(env, name);
  }
}

// --- topics ----------------------------------------------------------------------

export async function listTopics(request, env) {
  await ensureSchema(env);
  const { results: topics } = await env.DB.prepare(
    `SELECT id, title, slug, description, picture, created, updated,
       (SELECT COUNT(*) FROM posts WHERE topic_id = topics.id) AS post_count,
       (SELECT MAX(created) FROM posts WHERE topic_id = topics.id) AS last_post
     FROM topics ORDER BY COALESCE(last_post, created) DESC`,
  ).all();
  return fresh({ topics: topics.map(({ description, ...topic }) => ({ ...topic, summary: summaryOf(description) })) });
}

// A topic's description, short and as plain text, for its card.
const summaryOf = (description) => (/^\s*</.test(description) ? excerpt(description, 160) : description.slice(0, 160));

export async function getTopic(request, env) {
  await ensureSchema(env);
  const params = new URL(request.url).searchParams;
  const topic = await env.DB.prepare(
    `SELECT id, title, slug, description, picture, created, updated FROM topics WHERE ${params.has("slug") ? "slug = ?" : "id = ?"}`,
  ).bind(params.has("slug") ? params.get("slug") : Number(params.get("id"))).first();
  if (!topic) return apiError(404, "That topic isn't here anymore.");
  const { results: posts } = await env.DB.prepare(
    `SELECT id, title, slug, body, created, updated, comments_open,
       (SELECT COUNT(*) FROM comments WHERE post_id = posts.id AND deleted = 0) AS comment_count
     FROM posts WHERE topic_id = ? ORDER BY id DESC`,
  ).bind(topic.id).all();
  // each post as a card: the start of its words, and its first picture
  return fresh({
    ...topic,
    posts: posts.map(({ body, ...post }) => ({ ...post, excerpt: excerpt(body, 160), cover: uploadedPicturesIn(body)[0]?.url ?? null })),
  });
}

// The form for a new topic, or a change to one.
async function topicForm(request, env) {
  const form = await readForm(request);
  if (!form) return { error: apiError(400, "That didn't come through. Try again.") };
  const title = cleanText(form.get("title"), MAX_LENGTH.title);
  if (!title) return { error: apiError(400, "A topic needs a title.") };
  let picture = null;
  if (hasFile(form.get("picture"))) {
    const stored = await storePicture(env, form.get("picture"));
    if (stored.error) return stored;
    picture = stored.name;
  }
  return {
    title,
    description: cleanText(form.get("description"), MAX_LENGTH.description),
    picture,
    removePicture: form.get("removePicture") === "1",
  };
}

export async function createTopic(request, env) {
  await ensureSchema(env);
  const input = await topicForm(request, env);
  if (input.error) return input.error;
  try {
    const topic = await env.DB.prepare(
      "INSERT INTO topics (title, slug, description, picture, created) VALUES (?, ?, ?, ?, ?) RETURNING id, slug",
    ).bind(input.title, await topicSlug(env, input.title), input.description, input.picture, Date.now()).first();
    return fresh(topic, 201);
  } catch (error) {
    await deletePicture(env, input.picture).catch(() => {});
    throw error;
  }
}

export async function updateTopic(request, env) {
  await ensureSchema(env);
  const id = idParam(request);
  const before = await env.DB.prepare("SELECT title, slug, picture, description FROM topics WHERE id = ?").bind(id).first();
  if (!before) return apiError(404, "That topic isn't here anymore.");
  const input = await topicForm(request, env);
  if (input.error) return input.error;
  const picture = input.picture ?? (input.removePicture ? null : before.picture);
  const slug = input.title === before.title ? before.slug : await topicSlug(env, input.title, id);
  await env.DB.prepare("UPDATE topics SET title = ?, slug = ?, description = ?, picture = ?, updated = ? WHERE id = ?")
    .bind(input.title, slug, input.description, picture, Date.now(), id).run();
  if (before.picture && before.picture !== picture) await deletePicture(env, before.picture);
  const kept = new Set(picturesIn(input.description));
  await dropUnused(env, picturesIn(before.description).filter((name) => !kept.has(name)));
  return fresh({ id, slug });
}

export async function deleteTopic(request, env) {
  await ensureSchema(env);
  const id = idParam(request);
  const topic = await env.DB.prepare("SELECT picture, description FROM topics WHERE id = ?").bind(id).first();
  const { results: bodies } = await env.DB.prepare("SELECT body FROM posts WHERE topic_id = ?").bind(id).all();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE topic_id = ?)").bind(id),
    env.DB.prepare("DELETE FROM posts WHERE topic_id = ?").bind(id),
    env.DB.prepare("DELETE FROM topics WHERE id = ?").bind(id),
  ]);
  await dropUnused(env, [topic?.picture, ...picturesIn(topic?.description), ...bodies.flatMap((post) => picturesIn(post.body))].filter(Boolean));
  return done();
}

// --- posts -----------------------------------------------------------------------

const decodeEntities = (text) =>
  text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " })[name]);

// The start of a post's words, as plain text, for a list of posts.
function excerpt(html, length = 220) {
  const text = decodeEntities(html
    .replace(/<\/?(?:p|h\d|li|ul|ol|blockquote|pre|br|hr|table|tr|td|th|img)\b[^>]*>/gi, " ")   // between lines
    .replace(/<[^>]*>/g, ""))   // inside a line
    .replace(/https?:\/\/\S+/g, "")   // a player's link says nothing on its own
    .replace(/\s+/g, " ")
    .trim();
  // cut at a word, and without the cut sentence's own stop: "back...", not "back...."
  return text.length > length ? `${text.slice(0, length).replace(/\s+\S*$/, "").replace(/[\s.,;:!?-]+$/, "")}...` : text;
}

export async function newestPosts(request, env) {
  await ensureSchema(env);
  const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get("limit")) || 5, 1), 20);
  const { results } = await env.DB.prepare(
    `SELECT posts.id, posts.title, posts.slug, posts.created, posts.updated, substr(posts.body, 1, 4000) AS start,
       topics.id AS topic_id, topics.title AS topic_title, topics.slug AS topic_slug,
       (SELECT COUNT(*) FROM comments WHERE post_id = posts.id AND deleted = 0) AS comment_count
     FROM posts JOIN topics ON topics.id = posts.topic_id ORDER BY posts.id DESC LIMIT ?`,
  ).bind(limit).all();
  return fresh({ posts: results.map(({ start, ...post }) => ({ ...post, excerpt: excerpt(start) })) });
}

export async function getPost(request, env) {
  await ensureSchema(env);
  const params = new URL(request.url).searchParams;
  const bySlug = params.has("slug");
  const post = await env.DB.prepare(
    `SELECT posts.id, posts.title, posts.slug, posts.body, posts.comments_open, posts.created, posts.updated,
       topics.id AS topic_id, topics.title AS topic_title, topics.slug AS topic_slug
     FROM posts JOIN topics ON topics.id = posts.topic_id
     WHERE ${bySlug ? "topics.slug = ? AND posts.slug = ?" : "posts.id = ?"}`,
  ).bind(...(bySlug ? [params.get("topic"), params.get("slug")] : [Number(params.get("id"))])).first();
  if (!post) return apiError(404, "That post isn't here anymore.");
  const { results: comments } = await env.DB.prepare(
    "SELECT id, parent_id, name, body, is_admin, deleted, created FROM comments WHERE post_id = ? ORDER BY id",
  ).bind(post.id).all();
  return fresh({
    ...post,
    comments: comments.map((c) => (c.deleted ? { ...c, name: "", body: "", is_admin: 0 } : c)),
  });
}

// Whatever of { topic, title, body, comments } a request sends, cleaned.
async function postInput(request) {
  const input = await readJson(request, MAX_LENGTH.body * 2 + 10_000);
  if (!input) return null;
  const out = {};
  if ("topic" in input) out.topic = Number(input.topic);
  if ("title" in input) out.title = cleanText(input.title, MAX_LENGTH.title);
  if ("body" in input) out.body = typeof input.body === "string" ? input.body.slice(0, MAX_LENGTH.body) : "";
  if ("comments" in input) out.comments = input.comments ? 1 : 0;
  return out;
}

const topicOf = (env, id) => env.DB.prepare("SELECT id, slug FROM topics WHERE id = ?").bind(id).first();

export async function createPost(request, env) {
  await ensureSchema(env);
  const input = await postInput(request);
  if (!input) return apiError(400, "That didn't come through. Try again.");
  if (!input.title || !input.body?.trim()) return apiError(400, "A post needs a title and something in it.");
  const topic = await topicOf(env, input.topic);
  if (!topic) return apiError(404, "That topic isn't here anymore.");
  const post = await env.DB.prepare(
    "INSERT INTO posts (topic_id, title, slug, body, comments_open, created) VALUES (?, ?, ?, ?, ?, ?) RETURNING id, topic_id, slug",
  ).bind(topic.id, input.title, await postSlug(env, topic.id, input.title), input.body, input.comments ?? 1, Date.now()).first();
  return fresh({ ...post, topic_slug: topic.slug }, 201);
}

export async function updatePost(request, env) {
  await ensureSchema(env);
  const id = idParam(request);
  const before = await env.DB.prepare("SELECT topic_id, title, slug, body, comments_open FROM posts WHERE id = ?").bind(id).first();
  if (!before) return apiError(404, "That post isn't here anymore.");
  const input = await postInput(request);
  if (!input) return apiError(400, "That didn't come through. Try again.");
  const next = {
    topic: input.topic ?? before.topic_id,
    title: input.title ?? before.title,
    body: input.body ?? before.body,
    comments: input.comments ?? before.comments_open,
  };
  if (!next.title || !next.body.trim()) return apiError(400, "A post needs a title and something in it.");
  const topic = await topicOf(env, next.topic);
  if (!topic) return apiError(404, "That topic isn't here anymore.");
  // Its slug follows its title, and has to be its own in a topic it moves to.
  const slug = next.title === before.title && next.topic === before.topic_id ? before.slug : await postSlug(env, next.topic, next.title, id);
  // Switching comments on or off isn't an edit to the post, so it doesn't say "edited".
  const edited = next.title !== before.title || next.body !== before.body || next.topic !== before.topic_id;
  await env.DB.prepare(
    `UPDATE posts SET topic_id = ?, title = ?, slug = ?, body = ?, comments_open = ?${edited ? ", updated = ?" : ""} WHERE id = ?`,
  ).bind(next.topic, next.title, slug, next.body, next.comments, ...(edited ? [Date.now()] : []), id).run();
  const kept = new Set(picturesIn(next.body));
  await dropUnused(env, picturesIn(before.body).filter((name) => !kept.has(name)));
  return fresh({ id, topic_id: next.topic, slug, topic_slug: topic.slug });
}

export async function deletePost(request, env) {
  await ensureSchema(env);
  const id = idParam(request);
  const post = await env.DB.prepare("SELECT body FROM posts WHERE id = ?").bind(id).first();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM comments WHERE post_id = ?").bind(id),
    env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(id),
  ]);
  await dropUnused(env, picturesIn(post?.body));
  return done();
}

// The pictures uploaded to the site that a post's (or a page's) body
// shows, in order: { url, alt }. Pictures from elsewhere on the web aren't
// the site's, so they're left out.
function uploadedPicturesIn(html) {
  return [...html.matchAll(/<img\b[^>]*>/gi)]
    .map(([tag]) => ({ url: tag.match(/\ssrc="([^"]*)"/i)?.[1] ?? "", alt: decodeEntities(tag.match(/\salt="([^"]*)"/i)?.[1] ?? "") }))
    .filter(({ url }) => url.startsWith("/blog/img/") && PICTURE_NAME.test(url.slice("/blog/img/".length)));
}

// Every picture posted to the site, newest first: topics' pictures, and the
// ones in topics' descriptions, posts and pages, each once, with where it's
// from.
export async function listPictures(request, env) {
  await ensureSchema(env);
  const [topics, described, posts, pages] = await Promise.all([
    env.DB.prepare("SELECT id, title, slug, picture, created FROM topics WHERE picture IS NOT NULL").all(),
    env.DB.prepare("SELECT id, title, slug, description AS body, created FROM topics WHERE instr(description, '/blog/img/') > 0").all(),
    env.DB.prepare(
      `SELECT posts.id, posts.title, posts.slug, posts.body, posts.created, topics.slug AS topic_slug
       FROM posts JOIN topics ON topics.id = posts.topic_id WHERE instr(posts.body, '/blog/img/') > 0`,
    ).all(),
    env.DB.prepare("SELECT name AS id, body, updated AS created FROM pages WHERE instr(body, '/blog/img/') > 0").all(),
  ]);
  // where a picture is: { kind, id, title }, and a topic's or a post's slugs
  const from = (kind, row) => ({
    kind, id: row.id, title: row.title ?? PAGES[row.id],
    ...(row.slug ? { slug: row.slug } : {}), ...(row.topic_slug ? { topic_slug: row.topic_slug } : {}),
  });
  const found = topics.results.map((topic) => ({ url: `/blog/img/${topic.picture}`, alt: "", created: topic.created, from: from("topic", topic) }));
  for (const [kind, rows] of [["topic", described.results], ["post", posts.results], ["page", pages.results]]) {
    for (const row of rows) {
      for (const picture of uploadedPicturesIn(row.body)) found.push({ ...picture, created: row.created, from: from(kind, row) });
    }
  }
  found.sort((a, b) => b.created - a.created);   // stable: a post's pictures stay in its order
  const seen = new Set();
  return fresh({ pictures: found.filter(({ url }) => !seen.has(url) && seen.add(url)) });
}

// A picture for anywhere in a post.
export async function uploadPicture(request, env) {
  const form = await readForm(request);
  if (!form || !hasFile(form.get("picture"))) return apiError(400, "No picture came through. Try again.");
  const stored = await storePicture(env, form.get("picture"));
  if (stored.error) return stored.error;
  return fresh({ url: `/blog/img/${stored.name}` }, 201);
}

// --- comments --------------------------------------------------------------------

export async function createComment(request, env) {
  const { success } = await env.COMMENT_LIMITER.limit({ key: clientKey(request) });
  if (!success) return apiError(429, "That's a lot of comments. Wait a minute, then try again.");
  const input = await readJson(request, 20_000);
  if (!input) return apiError(400, "That didn't come through. Try again.");
  // A field people never see. Only a bot fills it in.
  if (input.website) return apiError(400, "That didn't come through. Try again.");
  const name = cleanText(input.name, MAX_LENGTH.name);
  const body = cleanText(input.body, MAX_LENGTH.comment);
  if (!name || !body) return apiError(400, "A comment needs a name and something to say.");

  await ensureSchema(env);
  const post = await env.DB.prepare("SELECT id, comments_open FROM posts WHERE id = ?").bind(Number(input.post)).first();
  if (!post) return apiError(404, "That post isn't here anymore.");
  if (!post.comments_open) return apiError(403, "Comments are closed on this post.");
  let parent = null;
  if (input.parent != null) {
    parent = await env.DB.prepare("SELECT id FROM comments WHERE id = ? AND post_id = ?").bind(Number(input.parent), post.id).first();
    if (!parent) return apiError(404, "The comment you're replying to isn't here anymore.");
  }
  const comment = await env.DB.prepare(
    `INSERT INTO comments (post_id, parent_id, name, body, is_admin, created) VALUES (?, ?, ?, ?, ?, ?)
     RETURNING id, parent_id, name, body, is_admin, deleted, created`,
  ).bind(post.id, parent?.id ?? null, name, body, (await isAdmin(request, env)) ? 1 : 0, Date.now()).first();
  return fresh(comment, 201);
}

// The comment's words go; it stays as "deleted" so the replies under it keep their place.
export async function deleteComment(request, env) {
  await ensureSchema(env);
  await env.DB.prepare("UPDATE comments SET deleted = 1, name = '', body = '' WHERE id = ?").bind(idParam(request)).run();
  return done();
}

// --- pages -----------------------------------------------------------------------

// The site's own pages the admin writes, by name, and what they're called.
const PAGES = { home: "Home", bulletin: "Bulletin", about: "About me", tagline: "Tagline" };
const pageName = (request) => {
  const name = new URL(request.url).searchParams.get("name");
  return Object.hasOwn(PAGES, name) ? name : null;
};

export async function getPage(request, env) {
  await ensureSchema(env);
  const name = pageName(request);
  if (!name) return apiError(404, "There's no page like that.");
  const page = await env.DB.prepare("SELECT body, updated FROM pages WHERE name = ?").bind(name).first();
  return fresh({ name, title: PAGES[name], body: page?.body ?? "", updated: page?.updated ?? null });
}

export async function savePage(request, env) {
  await ensureSchema(env);
  const name = pageName(request);
  if (!name) return apiError(404, "There's no page like that.");
  const input = await readJson(request, MAX_LENGTH.body * 2 + 10_000);
  if (typeof input?.body !== "string") return apiError(400, "That didn't come through. Try again.");
  const body = input.body.slice(0, MAX_LENGTH.body);
  const before = await env.DB.prepare("SELECT body FROM pages WHERE name = ?").bind(name).first();
  await env.DB.prepare(
    "INSERT INTO pages (name, body, updated) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET body = excluded.body, updated = excluded.updated",
  ).bind(name, body, Date.now()).run();
  const kept = new Set(picturesIn(body));
  await dropUnused(env, picturesIn(before?.body).filter((picture) => !kept.has(picture)));
  return fresh({ name });
}
