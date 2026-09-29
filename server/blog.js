// techtrash.org : the blog.
//
// The blog is topics, and posts under a topic. A topic has a title, a
// description and, if it wants one, a picture. Anyone can read; only the
// admin can post or delete (server/admin.js decides who that is, in worker.js).
//
// Topics and posts are in the D1 database DB; the tables are made the first
// time they're needed. A topic's picture is in the KV store PICTURES, under
// "topics/<name>", and is served at /blog/img/<name>. Both are made by
// Cloudflare on the first deploy.
//
//   GET    /api/blog/topics           every topic, the one with the newest post first
//   GET    /api/blog/topic?id=        one topic and its posts, newest first
//   GET    /api/blog/post?id=         one post, with its topic's id and title
//   POST   /api/blog/topics           admin: a new topic (a form, for the picture)
//   POST   /api/blog/posts            admin: { topic, title, body }
//   DELETE /api/blog/topic?id=        admin: a topic, its posts and its picture
//   DELETE /api/blog/post?id=         admin: a post

import { apiError, done, fresh } from "./http.js";

const MAX_LENGTH = { title: 100, description: 1000, body: 50000 };
const MAX_PICTURE_BYTES = 10 * 1024 * 1024;
const TOPIC_PICTURES = "topics/";
export const PICTURE_NAME = /^[\w-]+\.(?:png|jpg|gif|webp|avif)$/;

// Creates the tables the first time they're needed, once per Worker instance.
let schemaReady;
function ensureSchema(env) {
  schemaReady ??= env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      picture TEXT,
      created INTEGER NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created INTEGER NOT NULL
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS posts_by_topic ON posts (topic_id)"),
  ]).catch((error) => {
    schemaReady = undefined;
    throw error;
  });
  return schemaReady;
}

function cleanText(value, max) {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim().slice(0, max) : "";
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

export async function servePicture(name, env) {
  const { value, metadata } = await env.PICTURES.getWithMetadata(TOPIC_PICTURES + name, { type: "stream" });
  if (!value) return new Response("not found", { status: 404 });
  return new Response(value, {
    headers: {
      "content-type": metadata?.type ?? "application/octet-stream",
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  });
}

// --- reading -------------------------------------------------------------------

export async function listTopics(request, env) {
  await ensureSchema(env);
  const { results: topics } = await env.DB.prepare(
    `SELECT id, title, description, picture, created,
       (SELECT COUNT(*) FROM posts WHERE topic_id = topics.id) AS post_count,
       (SELECT MAX(created) FROM posts WHERE topic_id = topics.id) AS last_post
     FROM topics ORDER BY COALESCE(last_post, created) DESC`,
  ).all();
  return fresh({ topics });
}

export async function getTopic(request, env) {
  await ensureSchema(env);
  const id = Number(new URL(request.url).searchParams.get("id"));
  const topic = await env.DB.prepare("SELECT id, title, description, picture, created FROM topics WHERE id = ?").bind(id).first();
  if (!topic) return apiError(404, "That topic isn't here anymore.");
  const { results: posts } = await env.DB.prepare(
    "SELECT id, title, created FROM posts WHERE topic_id = ? ORDER BY id DESC",
  ).bind(id).all();
  return fresh({ ...topic, posts });
}

export async function getPost(request, env) {
  await ensureSchema(env);
  const id = Number(new URL(request.url).searchParams.get("id"));
  const post = await env.DB.prepare(
    `SELECT posts.id, posts.title, posts.body, posts.created, topics.id AS topic_id, topics.title AS topic_title
     FROM posts JOIN topics ON topics.id = posts.topic_id WHERE posts.id = ?`,
  ).bind(id).first();
  if (!post) return apiError(404, "That post isn't here anymore.");
  return fresh(post);
}

// --- posting (admin only) -------------------------------------------------------

// A form: title, description, and a picture if there is one.
export async function createTopic(request, env) {
  if (Number(request.headers.get("content-length")) > MAX_PICTURE_BYTES + 100_000) {
    return apiError(413, "That picture is too big (10 MB at most).");
  }
  const form = await request.formData().catch(() => null);
  if (!form) return apiError(400, "That didn't come through. Try again.");
  const title = cleanText(form.get("title"), MAX_LENGTH.title);
  const description = cleanText(form.get("description"), MAX_LENGTH.description);
  if (!title) return apiError(400, "A topic needs a title.");

  let picture = null;
  const file = form.get("picture");
  if (file instanceof Blob && file.size > 0) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > MAX_PICTURE_BYTES) return apiError(413, "That picture is too big (10 MB at most).");
    const image = detectImageType(bytes);
    if (!image) return apiError(415, "The picture has to be a png, jpg, gif, webp or avif.");
    picture = { name: pictureName(file.name ?? "", image.ext), bytes, type: image.type };
  }

  await ensureSchema(env);
  if (picture) {
    try {
      await env.PICTURES.put(TOPIC_PICTURES + picture.name, picture.bytes, { metadata: { type: picture.type } });
    } catch {
      // most likely the free plan's 1,000 writes a day or 1 GB of storage has run out
      return apiError(503, "Pictures are full right now. Try again tomorrow, or post it without one.");
    }
  }
  try {
    const topic = await env.DB.prepare(
      "INSERT INTO topics (title, description, picture, created) VALUES (?, ?, ?, ?) RETURNING id, title, description, picture, created",
    ).bind(title, description, picture?.name ?? null, Date.now()).first();
    return fresh({ ...topic, post_count: 0, last_post: null }, 201);
  } catch (error) {
    if (picture) await env.PICTURES.delete(TOPIC_PICTURES + picture.name).catch(() => {});
    throw error;
  }
}

export async function createPost(request, env) {
  const input = await request.json().catch(() => ({}));
  const topicId = Number(input.topic);
  const title = cleanText(input.title, MAX_LENGTH.title);
  const body = cleanText(input.body, MAX_LENGTH.body);
  if (!title || !body) return apiError(400, "A post needs a title and some text.");

  await ensureSchema(env);
  const topic = await env.DB.prepare("SELECT id FROM topics WHERE id = ?").bind(topicId).first();
  if (!topic) return apiError(404, "That topic isn't here anymore.");
  const post = await env.DB.prepare(
    "INSERT INTO posts (topic_id, title, body, created) VALUES (?, ?, ?, ?) RETURNING id, topic_id, title, created",
  ).bind(topic.id, title, body, Date.now()).first();
  return fresh(post, 201);
}

export async function deleteTopic(request, env) {
  await ensureSchema(env);
  const id = Number(new URL(request.url).searchParams.get("id"));
  const topic = await env.DB.prepare("SELECT picture FROM topics WHERE id = ?").bind(id).first();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM posts WHERE topic_id = ?").bind(id),
    env.DB.prepare("DELETE FROM topics WHERE id = ?").bind(id),
  ]);
  if (topic?.picture) await env.PICTURES.delete(TOPIC_PICTURES + topic.picture);
  return done();
}

export async function deletePost(request, env) {
  await ensureSchema(env);
  const id = Number(new URL(request.url).searchParams.get("id"));
  await env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(id).run();
  return done();
}
