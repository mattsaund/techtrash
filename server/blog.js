// techtrash.org : the blog.
//
//   flag     a label that organizes topics (Music, Space, ...). A topic can wear
//            any number of them, and the front page has a button for each.
//   topic    a title, an optional description and picture, and its flags.
//   post     a title and a body under one topic. The body is HTML from the
//            editor, cleaned by the page before it's sent and again before it's
//            shown (public/pages/blog/content.js). Its comments can be switched
//            off, which keeps the ones already there and stops new ones.
//   comment  anyone's, on a post, or a reply to another comment, so a post's
//            comments are threads. A name and plain text, nothing else.
//
// Reading is anyone's. Everything else is the admin's (worker.js checks with
// server/admin.js), except posting a comment, which is anyone's while the
// post's comments are on, 5 a minute per person (COMMENT_LIMITER).
//
// Everything is in the D1 database DB; the tables are made the first time
// they're needed. Pictures (a topic's, and any in a post) are in the KV store
// PICTURES, under "blog/<name>", served at /blog/img/<name>.
//
//   GET    /api/blog/flags               every flag, and how many topics wear it
//   POST   /api/blog/flags               admin: { name }
//   PUT    /api/blog/flag?id=            admin: { name }
//   DELETE /api/blog/flag?id=            admin: the flag comes off every topic
//   GET    /api/blog/topics[?flag=]      topics (wearing that flag), newest post first
//   GET    /api/blog/topic?id=           a topic, its flags and its posts
//   POST   /api/blog/topics              admin: a form: title, description, flags, picture
//   PUT    /api/blog/topic?id=           admin: the same form, plus removePicture
//   DELETE /api/blog/topic?id=           admin: the topic, its posts and their comments
//   GET    /api/blog/post?id=            a post, its topic and its comments
//   POST   /api/blog/posts               admin: { topic, title, body, comments }
//   PUT    /api/blog/post?id=            admin: any of { topic, title, body, comments }
//   DELETE /api/blog/post?id=            admin: the post and its comments
//                                        (and pictures nothing else shows)
//   POST   /api/blog/pictures            admin: a form with a picture; says its address
//   POST   /api/blog/comments            anyone: { post, parent, name, body }
//   DELETE /api/blog/comment?id=         admin: the comment's words go, its replies stay

import { isAdmin } from "./admin.js";
import { apiError, clientKey, done, fresh } from "./http.js";

const MAX_LENGTH = { flag: 40, title: 120, description: 1000, body: 500_000, name: 40, comment: 2000 };
const MAX_PICTURE_BYTES = 10 * 1024 * 1024;
const PICTURES = "blog/";
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
        description TEXT NOT NULL DEFAULT '',
        picture TEXT,
        created INTEGER NOT NULL,
        updated INTEGER
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS flags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        created INTEGER NOT NULL
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS topic_flags (
        topic_id INTEGER NOT NULL,
        flag_id INTEGER NOT NULL,
        PRIMARY KEY (topic_id, flag_id)
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic_id INTEGER NOT NULL,
        title TEXT NOT NULL,
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
      env.DB.prepare("CREATE INDEX IF NOT EXISTS posts_by_topic ON posts (topic_id)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS comments_by_post ON comments (post_id)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS topics_by_flag ON topic_flags (flag_id)"),
    ]);
  })().catch((error) => {
    schemaReady = undefined;
    throw error;
  });
  return schemaReady;
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
  if (Number(request.headers.get("content-length")) > MAX_PICTURE_BYTES + 100_000) return null;
  return request.formData().catch(() => null);
}

// A form's flags, "3,7,12", as numbers.
function flagIds(value) {
  if (typeof value !== "string") return [];
  return [...new Set(value.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0))];
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
  const found = await env.PICTURES.getWithMetadata(PICTURES + name, { type: "stream" });
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
  await env.PICTURES.delete(PICTURES + name);
}

// The pictures a post's body shows, by name.
const picturesIn = (body) => [...(body ?? "").matchAll(/\/blog\/img\/([\w-]+\.(?:png|jpg|gif|webp|avif))/g)].map((m) => m[1]);

// Deletes the pictures nothing shows anymore: no topic's, and in no post.
async function dropUnused(env, names) {
  for (const name of new Set(names)) {
    const used = await env.DB.prepare(
      "SELECT 1 FROM topics WHERE picture = ? UNION ALL SELECT 1 FROM posts WHERE instr(body, ?) > 0 LIMIT 1",
    ).bind(name, `/blog/img/${name}`).first();
    if (!used) await deletePicture(env, name);
  }
}

// --- flags -----------------------------------------------------------------------

export async function listFlags(request, env) {
  await ensureSchema(env);
  const { results: flags } = await env.DB.prepare(
    `SELECT id, name, (SELECT COUNT(*) FROM topic_flags WHERE flag_id = flags.id) AS topic_count
     FROM flags ORDER BY name COLLATE NOCASE`,
  ).all();
  return fresh({ flags });
}

async function saveFlagName(env, id, input) {
  const name = cleanText(input?.name, MAX_LENGTH.flag);
  if (!name) return apiError(400, "A flag needs a name.");
  try {
    const flag = id
      ? await env.DB.prepare("UPDATE flags SET name = ? WHERE id = ? RETURNING id, name").bind(name, id).first()
      : await env.DB.prepare("INSERT INTO flags (name, created) VALUES (?, ?) RETURNING id, name").bind(name, Date.now()).first();
    if (!flag) return apiError(404, "That flag isn't here anymore.");
    return fresh(flag, id ? 200 : 201);
  } catch (error) {
    if (/UNIQUE/i.test(error.message)) return apiError(409, "There's already a flag called that.");
    throw error;
  }
}

export async function createFlag(request, env) {
  await ensureSchema(env);
  return saveFlagName(env, null, await readJson(request, 10_000));
}

export async function renameFlag(request, env) {
  await ensureSchema(env);
  return saveFlagName(env, idParam(request), await readJson(request, 10_000));
}

export async function deleteFlag(request, env) {
  await ensureSchema(env);
  const id = idParam(request);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM topic_flags WHERE flag_id = ?").bind(id),
    env.DB.prepare("DELETE FROM flags WHERE id = ?").bind(id),
  ]);
  return done();
}

// { topicId: [{ id, name }, ...] } for the topics asked about. It reads every
// topic's flags (a short list) rather than name each topic: D1 takes at most
// 100 values in one query.
async function flagsOf(env, topicIds) {
  const byTopic = Object.fromEntries(topicIds.map((id) => [id, []]));
  if (topicIds.length === 0) return byTopic;
  const { results } = await env.DB.prepare(
    `SELECT topic_flags.topic_id, flags.id, flags.name FROM topic_flags JOIN flags ON flags.id = topic_flags.flag_id
     ORDER BY flags.name COLLATE NOCASE`,
  ).all();
  for (const row of results) byTopic[row.topic_id]?.push({ id: row.id, name: row.name });
  return byTopic;
}

// Puts exactly these flags on a topic. Ids that aren't flags are skipped.
function setFlagsStatements(env, topicId, ids) {
  return [
    env.DB.prepare("DELETE FROM topic_flags WHERE topic_id = ?").bind(topicId),
    ...ids.map((flagId) => env.DB.prepare(
      "INSERT OR IGNORE INTO topic_flags (topic_id, flag_id) SELECT ?, id FROM flags WHERE id = ?",
    ).bind(topicId, flagId)),
  ];
}

// --- topics ----------------------------------------------------------------------

export async function listTopics(request, env) {
  await ensureSchema(env);
  const flag = Number(new URL(request.url).searchParams.get("flag")) || null;
  const statement = env.DB.prepare(
    `SELECT id, title, description, picture, created, updated,
       (SELECT COUNT(*) FROM posts WHERE topic_id = topics.id) AS post_count,
       (SELECT MAX(created) FROM posts WHERE topic_id = topics.id) AS last_post
     FROM topics ${flag ? "WHERE id IN (SELECT topic_id FROM topic_flags WHERE flag_id = ?)" : ""}
     ORDER BY COALESCE(last_post, created) DESC`,
  );
  const { results: topics } = await (flag ? statement.bind(flag) : statement).all();
  const flags = await flagsOf(env, topics.map((topic) => topic.id));
  return fresh({ topics: topics.map((topic) => ({ ...topic, flags: flags[topic.id] })) });
}

export async function getTopic(request, env) {
  await ensureSchema(env);
  const id = idParam(request);
  const topic = await env.DB.prepare("SELECT id, title, description, picture, created, updated FROM topics WHERE id = ?").bind(id).first();
  if (!topic) return apiError(404, "That topic isn't here anymore.");
  const { results: posts } = await env.DB.prepare(
    `SELECT id, title, created, updated, comments_open,
       (SELECT COUNT(*) FROM comments WHERE post_id = posts.id AND deleted = 0) AS comment_count
     FROM posts WHERE topic_id = ? ORDER BY id DESC`,
  ).bind(id).all();
  const flags = await flagsOf(env, [id]);
  return fresh({ ...topic, flags: flags[id], posts });
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
    flags: flagIds(form.get("flags")),
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
      "INSERT INTO topics (title, description, picture, created) VALUES (?, ?, ?, ?) RETURNING id",
    ).bind(input.title, input.description, input.picture, Date.now()).first();
    await env.DB.batch(setFlagsStatements(env, topic.id, input.flags));
    return fresh(topic, 201);
  } catch (error) {
    await deletePicture(env, input.picture).catch(() => {});
    throw error;
  }
}

export async function updateTopic(request, env) {
  await ensureSchema(env);
  const id = idParam(request);
  const before = await env.DB.prepare("SELECT picture FROM topics WHERE id = ?").bind(id).first();
  if (!before) return apiError(404, "That topic isn't here anymore.");
  const input = await topicForm(request, env);
  if (input.error) return input.error;
  const picture = input.picture ?? (input.removePicture ? null : before.picture);
  await env.DB.batch([
    env.DB.prepare("UPDATE topics SET title = ?, description = ?, picture = ?, updated = ? WHERE id = ?")
      .bind(input.title, input.description, picture, Date.now(), id),
    ...setFlagsStatements(env, id, input.flags),
  ]);
  if (before.picture && before.picture !== picture) await deletePicture(env, before.picture);
  return fresh({ id });
}

export async function deleteTopic(request, env) {
  await ensureSchema(env);
  const id = idParam(request);
  const topic = await env.DB.prepare("SELECT picture FROM topics WHERE id = ?").bind(id).first();
  const { results: bodies } = await env.DB.prepare("SELECT body FROM posts WHERE topic_id = ?").bind(id).all();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE topic_id = ?)").bind(id),
    env.DB.prepare("DELETE FROM posts WHERE topic_id = ?").bind(id),
    env.DB.prepare("DELETE FROM topic_flags WHERE topic_id = ?").bind(id),
    env.DB.prepare("DELETE FROM topics WHERE id = ?").bind(id),
  ]);
  await dropUnused(env, [topic?.picture, ...bodies.flatMap((post) => picturesIn(post.body))].filter(Boolean));
  return done();
}

// --- posts -----------------------------------------------------------------------

export async function getPost(request, env) {
  await ensureSchema(env);
  const id = idParam(request);
  const post = await env.DB.prepare(
    `SELECT posts.id, posts.title, posts.body, posts.comments_open, posts.created, posts.updated,
       topics.id AS topic_id, topics.title AS topic_title
     FROM posts JOIN topics ON topics.id = posts.topic_id WHERE posts.id = ?`,
  ).bind(id).first();
  if (!post) return apiError(404, "That post isn't here anymore.");
  const { results: comments } = await env.DB.prepare(
    "SELECT id, parent_id, name, body, is_admin, deleted, created FROM comments WHERE post_id = ? ORDER BY id",
  ).bind(id).all();
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

const topicExists = (env, id) => env.DB.prepare("SELECT id FROM topics WHERE id = ?").bind(id).first();

export async function createPost(request, env) {
  await ensureSchema(env);
  const input = await postInput(request);
  if (!input) return apiError(400, "That didn't come through. Try again.");
  if (!input.title || !input.body?.trim()) return apiError(400, "A post needs a title and something in it.");
  if (!(await topicExists(env, input.topic))) return apiError(404, "That topic isn't here anymore.");
  const post = await env.DB.prepare(
    "INSERT INTO posts (topic_id, title, body, comments_open, created) VALUES (?, ?, ?, ?, ?) RETURNING id, topic_id",
  ).bind(input.topic, input.title, input.body, input.comments ?? 1, Date.now()).first();
  return fresh(post, 201);
}

export async function updatePost(request, env) {
  await ensureSchema(env);
  const id = idParam(request);
  const before = await env.DB.prepare("SELECT topic_id, title, body, comments_open FROM posts WHERE id = ?").bind(id).first();
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
  if (next.topic !== before.topic_id && !(await topicExists(env, next.topic))) {
    return apiError(404, "That topic isn't here anymore.");
  }
  // Switching comments on or off isn't an edit to the post, so it doesn't say "edited".
  const edited = next.title !== before.title || next.body !== before.body || next.topic !== before.topic_id;
  await env.DB.prepare(
    `UPDATE posts SET topic_id = ?, title = ?, body = ?, comments_open = ?${edited ? ", updated = ?" : ""} WHERE id = ?`,
  ).bind(next.topic, next.title, next.body, next.comments, ...(edited ? [Date.now()] : []), id).run();
  const kept = new Set(picturesIn(next.body));
  await dropUnused(env, picturesIn(before.body).filter((name) => !kept.has(name)));
  return fresh({ id, topic_id: next.topic });
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
