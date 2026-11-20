// Blog API. Posts, flags, comments and pages live in D1 (DB), uploads in KV (PICTURES).
// Post bodies are editor HTML, sanitized by the client before sending and again before display
// (public/pages/blog/content.js). Slugs are unique and follow title changes. URLs are #blog/<slug>.
//
// Uploads are "blog/<name>" at /blog/img/<name> and "sound/<name>" at /blog/sound/<name>. Public once
// a published post or a page uses one, admin-only before that, so draft media stays private even
// if the URL is guessed. Deleted once nothing uses them.
//
// Public, drafts aside. Comments are limited by COMMENT_LIMITER (5/min per IP).
//   GET    /api/blog/posts[?limit=]      published posts, newest first, with excerpt,
//                                        cover picture, flags and comment count
//   GET    /api/blog/posts?featured      starred posts, in the admin's order
//   GET    /api/blog/post?slug= | ?id=   a post with its flags and comments
//   GET    /api/blog/flags               flags on published posts, with counts (admin sees all)
//   GET    /api/blog/pictures            pictures in published posts and pages, newest first
//   GET    /api/blog/page?name=          home, bulletin, about, tagline, footer or blinkies
//                                        ("" until written)
//   POST   /api/blog/comments            { post, parent, name, body }
//
// Admin-only, checked in worker.js. Drafts are checked here.
//   GET    /api/blog/posts?drafts        drafts, same shape
//   POST   /api/blog/posts               { title, body, flags, comments, draft }
//   PUT    /api/blog/post?id=            any of { title, body, flags, comments, draft, featured }
//   PUT    /api/blog/featured            { ids }, the whole featured list in order
//   DELETE /api/blog/post?id=            the post, its comments and its unused uploads
//   POST   /api/blog/pictures            form with a "picture" file, returns its URL
//   POST   /api/blog/sounds?name=        the file as the raw body, returns its URL
//   DELETE /api/blog/comment?id=         blanks it, replies stay
//   PUT    /api/blog/page?name=          { body }

import { isAdmin } from "./admin.js";
import { notify, quoted } from "./notify.js";
import { apiError, clientKey, done, fresh } from "./http.js";
import { mediaType, sendPart } from "./media.js";

const MAX_LENGTH = { title: 120, flag: 40, flags: 20, body: 500_000, name: 40, comment: 2000 };
const MAX_PICTURE_BYTES = 10 * 1024 * 1024;
const MAX_SOUND_BYTES = 20 * 1024 * 1024;   // under KV's 25 MiB per value
const PICTURES = "blog/";
const FIRST_PICTURES = "topics/";   // legacy, the first blog's topic pictures
const SOUNDS = "sound/";
export const PICTURE_NAME = /^[\w-]+\.(?:png|jpg|gif|webp|avif)$/;
export const SOUND_NAME = /^[\w-]+\.(?:mp3|m4a|aac|ogg|wav|flac)$/;

// --- schema ----------------------------------------------------------------------

const POSTS = `(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT,
  body TEXT NOT NULL,
  draft INTEGER NOT NULL DEFAULT 0,
  comments_open INTEGER NOT NULL DEFAULT 1,
  created INTEGER NOT NULL,
  published INTEGER,
  updated INTEGER,
  featured INTEGER
)`;

// Once per isolate. Cleared on failure so the next call retries.
let schemaReady;
export function ensureSchema(env) {
  schemaReady ??= (async () => {
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS posts ${POSTS}`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS flags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        created INTEGER NOT NULL
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS post_flags (
        post_id INTEGER NOT NULL,
        flag_id INTEGER NOT NULL,
        PRIMARY KEY (post_id, flag_id)
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
      env.DB.prepare("CREATE INDEX IF NOT EXISTS comments_by_post ON comments (post_id)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS posts_by_flag ON post_flags (flag_id)"),
    ]);
    await upgrade(env);
    await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS posts_slug_unique ON posts (slug)").run();
  })().catch((error) => {
    schemaReady = undefined;
    throw error;
  });
  return schemaReady;
}

// Reads skip ensureSchema (extra D1 round trips). On "no such table/column",
// set up the schema and retry once. Writes call ensureSchema first since they can't be retried.
export async function reading(env, work) {
  try {
    return await work();
  } catch (error) {
    if (!/no such (table|column)/i.test(error?.message ?? "")) throw error;
    await ensureSchema(env);
    return work();
  }
}
const readOnly = (handler) => (request, env, ...rest) => reading(env, () => handler(request, env, ...rest));

// Upgrades older databases: the first blog (plain-text posts) and the topics blog (Sep to Oct 2026).
// CREATE TABLE IF NOT EXISTS never adds columns. Isolates can race, so "duplicate column" is ignored.
async function upgrade(env) {
  const columns = async (table) => {
    const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
    return new Set(results.map((column) => column.name));
  };
  const alreadyThere = (error) => {
    if (!/duplicate column/i.test(error.message)) throw error;
  };
  const posts = await columns("posts");
  if (!posts.has("slug")) await env.DB.prepare("ALTER TABLE posts ADD COLUMN slug TEXT").run().catch(alreadyThere);
  if (!posts.has("updated")) await env.DB.prepare("ALTER TABLE posts ADD COLUMN updated INTEGER").run().catch(alreadyThere);
  if (!posts.has("featured")) await env.DB.prepare("ALTER TABLE posts ADD COLUMN featured INTEGER").run().catch(alreadyThere);
  if (!posts.has("comments_open")) {
    // Same batch as the new column, so the plain-text conversion runs exactly once.
    const { results } = await env.DB.prepare("SELECT id, body FROM posts").all();
    await env.DB.batch([
      env.DB.prepare("ALTER TABLE posts ADD COLUMN comments_open INTEGER NOT NULL DEFAULT 1"),
      ...results.map((post) => env.DB.prepare("UPDATE posts SET body = ? WHERE id = ?").bind(textToHtml(post.body), post.id)),
    ]).catch(alreadyThere);
  }
  if (posts.has("topic_id")) await outOfTopics(env);
  await everySlugItsOwn(env);
}

// Topics become flags on their posts (plus old topic_flags). Every post is published,
// dated when it was created. The topics table stays, unused. One batch, all or nothing.
async function outOfTopics(env) {
  const { results: tables } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
  const topicFlags = tables.some((table) => table.name === "topic_flags");
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE posts_new ${POSTS}`),
    env.DB.prepare(`INSERT INTO posts_new (id, title, slug, body, draft, comments_open, created, published, updated)
      SELECT id, title, slug, body, 0, comments_open, created, created, updated FROM posts`),
    env.DB.prepare("INSERT OR IGNORE INTO flags (name, created) SELECT title, created FROM topics"),
    env.DB.prepare(`INSERT OR IGNORE INTO post_flags (post_id, flag_id)
      SELECT posts.id, flags.id FROM posts JOIN topics ON topics.id = posts.topic_id JOIN flags ON flags.name = topics.title`),
    ...(topicFlags ? [env.DB.prepare(`INSERT OR IGNORE INTO post_flags (post_id, flag_id)
      SELECT posts.id, flags.id FROM posts JOIN topic_flags ON topic_flags.topic_id = posts.topic_id
      JOIN flags ON flags.id = topic_flags.flag_id`)] : []),
    env.DB.prepare("DROP TABLE posts"),
    env.DB.prepare("ALTER TABLE posts_new RENAME TO posts"),
    env.DB.prepare("DELETE FROM flags WHERE id NOT IN (SELECT flag_id FROM post_flags)"),
  ]);
}

// Dedupes slugs before posts_slug_unique is created. Missing ones (pre-slug posts) and
// duplicates (slugs were per topic) get the title's slug plus -2, -3...
async function everySlugItsOwn(env) {
  const { results } = await env.DB.prepare("SELECT id, title, slug FROM posts ORDER BY id").all();
  const held = new Set(results.map((post) => post.slug).filter(Boolean));
  const taken = new Set();
  const fixes = [];
  for (const post of results) {
    if (post.slug && !taken.has(post.slug)) {
      taken.add(post.slug);
      continue;
    }
    const base = slugify(post.title, "post");
    let slug = base;
    for (let n = 2; taken.has(slug) || held.has(slug); n++) slug = `${base}-${n}`;
    taken.add(slug);
    fixes.push(env.DB.prepare("UPDATE posts SET slug = ? WHERE id = ?").bind(slug, post.id));
  }
  if (fixes.length) await env.DB.batch(fixes);
}

// --- slugs -----------------------------------------------------------------------

// "Daft Punk's best (2001)!" as daft-punks-best-2001
function slugify(title, fallback) {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")   // combining accents split off by NFKD
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug || fallback;
}

// Title's slug, plus -2, -3... if another post (not id) has it.
async function postSlug(env, title, id = null) {
  const base = slugify(title, "post");
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!(await env.DB.prepare("SELECT 1 FROM posts WHERE slug = ? AND id IS NOT ?").bind(slug, id).first())) return slug;
  }
}

// First-blog plain text as HTML. Blank lines make paragraphs, newlines <br>, and URLs links.
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

// --- helpers ---------------------------------------------------------------------

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

// Allowed upload types, as sniffed by mediaType().
const PICTURE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);
const isSound = (found) => found?.type.startsWith("audio/");

// "My Cat!.PNG" -> "My-Cat-3f9a1c.png". The random bit keeps files from replacing each other.
function fileName(original, ext, fallback) {
  const base = original
    .replace(/\.[^.]*$/, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${base || fallback}-${crypto.randomUUID().slice(0, 6)}.${ext}`;
}

// Returns { name } or { error }.
async function storePicture(env, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > MAX_PICTURE_BYTES) return { error: apiError(413, "That picture is too big (10 MB at most).") };
  const image = mediaType(bytes);
  if (!PICTURE_TYPES.has(image?.type)) return { error: apiError(415, "The picture has to be a png, jpg, gif, webp or avif.") };
  const name = fileName(file.name ?? "", image.ext, "picture");
  try {
    await env.PICTURES.put(PICTURES + name, bytes, { metadata: { type: image.type } });
  } catch {
    // likely the free plan's KV limits (1,000 writes a day, 1 GB)
    return { error: apiError(503, "Pictures are full right now. Try again tomorrow.") };
  }
  return { name };
}

const hasFile = (value) => value instanceof Blob && value.size > 0;

// Public once a published post or a page uses it, admin-only before that.
// Returns the Cache-Control value, or null for a 404 that doesn't reveal whether the file exists.
async function mayHave(admin, env, address) {
  if (admin) return "private, max-age=3600";
  const shown = await reading(env, () => env.DB.prepare(
    "SELECT 1 FROM posts WHERE draft = 0 AND instr(body, ?1) > 0 UNION ALL SELECT 1 FROM pages WHERE instr(body, ?1) > 0 LIMIT 1",
  ).bind(address).first());
  return shown ? "public, max-age=3600" : null;
}

const notFound = () => new Response("not found", { status: 404 });

// Names never get new bytes, so KV can cache at the edge for a day (cacheTtl).
// Only read after mayHave allows it.
export async function servePicture(name, request, env) {
  const cache = await mayHave(await isAdmin(request, env), env, `/blog/img/${name}`);
  if (!cache) return notFound();
  let found = await env.PICTURES.getWithMetadata(PICTURES + name, { type: "stream", cacheTtl: 86400 });
  if (!found.value) found = await env.PICTURES.getWithMetadata(FIRST_PICTURES + name, { type: "stream", cacheTtl: 86400 });
  if (!found.value) return notFound();
  return new Response(found.value, {
    headers: {
      "content-type": found.metadata?.type ?? "application/octet-stream",
      "cache-control": cache,
      "x-content-type-options": "nosniff",
    },
  });
}

// Supports Range requests so players can seek.
export async function serveSound(name, request, env) {
  const cache = await mayHave(await isAdmin(request, env), env, `/blog/sound/${name}`);
  if (!cache) return notFound();
  const found = await env.PICTURES.getWithMetadata(SOUNDS + name, { type: "arrayBuffer" });
  if (!found.value) return notFound();
  const headers = {
    "content-type": found.metadata?.type ?? "application/octet-stream",
    "cache-control": cache,
    "x-content-type-options": "nosniff",
  };
  return sendPart(request, found.value.byteLength, headers, (start, end) => found.value.slice(start, end + 1));
}

// Upload paths (/blog/img/<name>, /blog/sound/<name>) in a post or page body.
const filesIn = (body) => [...(body ?? "").matchAll(/\/blog\/(?:img\/[\w-]+\.(?:png|jpg|gif|webp|avif)|sound\/[\w-]+\.(?:mp3|m4a|aac|ogg|wav|flac))/g)].map((m) => m[0]);

// Deletes uploads no post (drafts included) or page uses anymore.
async function dropUnused(env, addresses) {
  for (const address of new Set(addresses)) {
    const used = await env.DB.prepare(
      "SELECT 1 FROM posts WHERE instr(body, ?1) > 0 UNION ALL SELECT 1 FROM pages WHERE instr(body, ?1) > 0 LIMIT 1",
    ).bind(address).first();
    if (used) continue;
    const [, folder, name] = address.match(/^\/blog\/(img|sound)\/(.+)$/);
    if (folder === "img") await Promise.all([env.PICTURES.delete(PICTURES + name), env.PICTURES.delete(FIRST_PICTURES + name)]);
    else await env.PICTURES.delete(SOUNDS + name);
  }
}

const decodeEntities = (text) =>
  text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " })[name]);

// Plain-text opening of a post, for cards and the feed.
export function excerpt(html, length = 220) {
  const text = decodeEntities(html
    .replace(/<a\b[^>]*href="\/blog\/sound\/[^"]*"[^>]*>.*?<\/a>/gi, " ")   // sound links (just a file name)
    .replace(/<\/?(?:p|h\d|li|ul|ol|blockquote|pre|br|hr|table|tr|td|th|img)\b[^>]*>/gi, " ")   // block tags become spaces
    .replace(/<[^>]*>/g, ""))   // inline tags are dropped
    .replace(/https?:\/\/\S+/g, "")   // URLs (player links) mean nothing as text
    .replace(/\s+/g, " ")
    .trim();
  // cut at a word and drop the trailing punctuation, so "back...", not "back...."
  return text.length > length ? `${text.slice(0, length).replace(/\s+\S*$/, "").replace(/[\s.,;:!?-]+$/, "")}...` : text;
}

// Uploaded pictures in a body, in order, as { url, alt }. External images are skipped.
function uploadedPicturesIn(html) {
  return [...html.matchAll(/<img\b[^>]*>/gi)]
    .map(([tag]) => ({ url: tag.match(/\ssrc="([^"]*)"/i)?.[1] ?? "", alt: decodeEntities(tag.match(/\salt="([^"]*)"/i)?.[1] ?? "") }))
    .filter(({ url }) => url.startsWith("/blog/img/") && PICTURE_NAME.test(url.slice("/blog/img/".length)));
}

// --- flags -----------------------------------------------------------------------

// { postId: [{ id, name, slug }, ...] }. Reads every post_flags row instead of binding the ids,
// since D1 allows at most 100 bound parameters per query.
export async function flagsOf(env, postIds) {
  const byPost = Object.fromEntries(postIds.map((id) => [id, []]));
  if (postIds.length === 0) return byPost;
  const { results } = await env.DB.prepare(
    `SELECT post_flags.post_id, flags.id, flags.name FROM post_flags JOIN flags ON flags.id = post_flags.flag_id
     ORDER BY flags.name COLLATE NOCASE`,
  ).all();
  for (const row of results) byPost[row.post_id]?.push({ id: row.id, name: row.name, slug: slugify(row.name, "flag") });
  return byPost;
}

// Replaces a post's flags (names, any case). Creates new flags and deletes unused ones.
function setFlags(env, postId, names) {
  const now = Date.now();
  return env.DB.batch([
    env.DB.prepare("DELETE FROM post_flags WHERE post_id = ?").bind(postId),
    ...names.flatMap((name) => [
      env.DB.prepare("INSERT OR IGNORE INTO flags (name, created) VALUES (?, ?)").bind(name, now),
      env.DB.prepare("INSERT OR IGNORE INTO post_flags (post_id, flag_id) SELECT ?, id FROM flags WHERE name = ?").bind(postId, name),
    ]),
    env.DB.prepare("DELETE FROM flags WHERE id NOT IN (SELECT flag_id FROM post_flags)"),
  ]);
}

export const listFlags = readOnly(async (request, env) => {
  const { results } = await env.DB.prepare(
    `SELECT flags.id, flags.name,
       (SELECT COUNT(*) FROM post_flags JOIN posts ON posts.id = post_flags.post_id
        WHERE post_flags.flag_id = flags.id AND posts.draft = 0) AS count
     FROM flags ORDER BY flags.name COLLATE NOCASE`,
  ).all();
  // flags used only by drafts are admin-only
  const admin = await isAdmin(request, env);
  return fresh({ flags: results.filter((flag) => admin || flag.count > 0).map((flag) => ({ ...flag, slug: slugify(flag.name, "flag") })) });
});

// --- posts -----------------------------------------------------------------------

export const listPosts = readOnly(async (request, env) => {
  const params = new URL(request.url).searchParams;
  const drafts = params.has("drafts");
  const featured = params.has("featured");
  if (drafts && !(await isAdmin(request, env))) return apiError(401, "Only the admin can do that.");
  const limit = Math.min(Math.max(Number(params.get("limit")) || 0, 0), 100);   // 0 means all
  const order = featured ? "featured, id" : "COALESCE(published, created) DESC, id DESC";
  const { results } = await env.DB.prepare(
    `SELECT id, title, slug, substr(body, 1, 50000) AS start, draft, comments_open, created, published, updated, featured,
       (SELECT COUNT(*) FROM comments WHERE post_id = posts.id AND deleted = 0) AS comment_count
     FROM posts WHERE draft = ?${featured ? " AND featured IS NOT NULL" : ""} ORDER BY ${order}${limit ? " LIMIT ?" : ""}`,
  ).bind(drafts ? 1 : 0, ...(limit ? [limit] : [])).all();
  const flags = await flagsOf(env, results.map((post) => post.id));
  return fresh({
    posts: results.map(({ start, ...post }) => ({
      ...post, excerpt: excerpt(start, 160), cover: uploadedPicturesIn(start)[0]?.url ?? null, flags: flags[post.id],
    })),
  });
});

export const getPost = readOnly(async (request, env) => {
  const params = new URL(request.url).searchParams;
  const bySlug = params.has("slug");
  const post = await env.DB.prepare(
    `SELECT id, title, slug, body, draft, comments_open, created, published, updated, featured FROM posts WHERE ${bySlug ? "slug = ?" : "id = ?"}`,
  ).bind(bySlug ? params.get("slug") : Number(params.get("id"))).first();
  if (!post || (post.draft && !(await isAdmin(request, env)))) return apiError(404, "That blog isn't here anymore.");
  const [flags, { results: comments }] = await Promise.all([
    flagsOf(env, [post.id]),
    env.DB.prepare("SELECT id, parent_id, name, body, is_admin, deleted, created FROM comments WHERE post_id = ? ORDER BY id").bind(post.id).all(),
  ]);
  return fresh({
    ...post,
    flags: flags[post.id],
    comments: comments.map((c) => (c.deleted ? { ...c, name: "", body: "", is_admin: 0 } : c)),
  });
});

// The sent subset of { title, body, flags, comments, draft, featured }, cleaned.
async function postInput(request) {
  const input = await readJson(request, MAX_LENGTH.body * 2 + 10_000);
  if (!input) return null;
  const out = {};
  if ("title" in input) out.title = cleanText(input.title, MAX_LENGTH.title);
  if ("body" in input) out.body = typeof input.body === "string" ? input.body.slice(0, MAX_LENGTH.body) : "";
  if ("comments" in input) out.comments = input.comments ? 1 : 0;
  if ("draft" in input) out.draft = input.draft ? 1 : 0;
  if ("featured" in input) out.featured = Boolean(input.featured);
  if ("flags" in input) {
    const names = (Array.isArray(input.flags) ? input.flags : [])
      .map((name) => cleanText(name, MAX_LENGTH.flag).replace(/\s+/g, " "))
      .filter(Boolean);
    // case-insensitive dedupe, first spelling wins
    const once = new Map();
    for (const name of names) if (!once.has(name.toLowerCase())) once.set(name.toLowerCase(), name);
    out.flags = [...once.values()].slice(0, MAX_LENGTH.flags);
  }
  return out;
}

// Drafts need a title. Published posts also need a body.
function checkPost(post) {
  if (!post.title) return apiError(400, "A blog needs a title.");
  if (!post.draft && !post.body.trim()) return apiError(400, "A blog needs something in it before it goes up.");
  return null;
}

export async function createPost(request, env) {
  await ensureSchema(env);
  const input = await postInput(request);
  if (!input) return apiError(400, "That didn't come through. Try again.");
  const post = { title: input.title ?? "", body: input.body ?? "", draft: input.draft ?? 0, comments: input.comments ?? 1 };
  const problem = checkPost(post);
  if (problem) return problem;
  const now = Date.now();
  const made = await env.DB.prepare(
    `INSERT INTO posts (title, slug, body, draft, comments_open, created, published) VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING id, slug, draft`,
  ).bind(post.title, await postSlug(env, post.title), post.body, post.draft, post.comments, now, post.draft ? null : now).first();
  await setFlags(env, made.id, input.flags ?? []);
  return fresh(made, 201);
}

export async function updatePost(request, env) {
  await ensureSchema(env);
  const id = idParam(request);
  const before = await env.DB.prepare("SELECT title, slug, body, draft, comments_open, published, featured FROM posts WHERE id = ?").bind(id).first();
  if (!before) return apiError(404, "That blog isn't here anymore.");
  const input = await postInput(request);
  if (!input) return apiError(400, "That didn't come through. Try again.");
  const next = {
    title: input.title ?? before.title,
    body: input.body ?? before.body,
    draft: input.draft ?? before.draft,
    comments: input.comments ?? before.comments_open,
  };
  const problem = checkPost(next);
  if (problem) return problem;
  const slug = next.title === before.title ? before.slug : await postSlug(env, next.title, id);
  // set on first publish, never changed
  const published = before.published ?? (next.draft ? null : Date.now());
  // updated only tracks title or body edits while published
  const edited = !before.draft && !next.draft && (next.title !== before.title || next.body !== before.body);
  await env.DB.prepare(
    `UPDATE posts SET title = ?, slug = ?, body = ?, draft = ?, comments_open = ?, published = ?${edited ? ", updated = ?" : ""} WHERE id = ?`,
  ).bind(next.title, slug, next.body, next.draft, next.comments, published, ...(edited ? [Date.now()] : []), id).run();
  if (input.flags) await setFlags(env, id, input.flags);
  // newly starred posts go last
  if (input.featured === true && before.featured === null) {
    await env.DB.prepare("UPDATE posts SET featured = (SELECT COALESCE(MAX(featured), 0) + 1 FROM posts) WHERE id = ?").bind(id).run();
  } else if (input.featured === false) {
    await env.DB.prepare("UPDATE posts SET featured = NULL WHERE id = ?").bind(id).run();
  }
  const kept = new Set(filesIn(next.body));
  await dropUnused(env, filesIn(before.body).filter((address) => !kept.has(address)));
  return fresh({ id, slug, draft: next.draft });
}

// Reorder from Home. ids is the whole featured list, and posts left out are unstarred.
export async function saveFeatured(request, env) {
  await ensureSchema(env);
  const input = await readJson(request, 10_000);
  const ids = Array.isArray(input?.ids) ? [...new Set(input.ids.map(Number).filter(Number.isInteger))].slice(0, 100) : null;
  if (!ids) return apiError(400, "That didn't come through. Try again.");
  await env.DB.batch([
    env.DB.prepare("UPDATE posts SET featured = NULL WHERE featured IS NOT NULL"),
    ...ids.map((id, at) => env.DB.prepare("UPDATE posts SET featured = ? WHERE id = ?").bind(at + 1, id)),
  ]);
  return fresh({ ids });
}

export async function deletePost(request, env) {
  await ensureSchema(env);
  const id = idParam(request);
  const post = await env.DB.prepare("SELECT body FROM posts WHERE id = ?").bind(id).first();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM comments WHERE post_id = ?").bind(id),
    env.DB.prepare("DELETE FROM post_flags WHERE post_id = ?").bind(id),
    env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(id),
    env.DB.prepare("DELETE FROM flags WHERE id NOT IN (SELECT flag_id FROM post_flags)"),
  ]);
  await dropUnused(env, filesIn(post?.body));
  return done();
}

// --- pictures --------------------------------------------------------------------

// Uploaded pictures in published posts and pages, newest first, each once, with their source.
// The footer and blinkies are site decoration, so they're skipped.
export const listPictures = readOnly(async (request, env) => {
  const [posts, pages] = await Promise.all([
    env.DB.prepare(
      "SELECT id, title, slug, body, COALESCE(published, created) AS created FROM posts WHERE draft = 0 AND instr(body, '/blog/img/') > 0",
    ).all(),
    env.DB.prepare("SELECT name AS id, body, updated AS created FROM pages WHERE instr(body, '/blog/img/') > 0 AND name NOT IN ('footer', 'blinkies')").all(),
  ]);
  const from = (kind, row) => ({ kind, id: row.id, title: row.title ?? PAGES[row.id], ...(row.slug ? { slug: row.slug } : {}) });
  const found = [];
  for (const [kind, rows] of [["post", posts.results], ["page", pages.results]]) {
    for (const row of rows) {
      for (const picture of uploadedPicturesIn(row.body)) found.push({ ...picture, created: row.created, from: from(kind, row) });
    }
  }
  found.sort((a, b) => b.created - a.created);   // stable, so a post's pictures keep their order
  const seen = new Set();
  return fresh({ pictures: found.filter(({ url }) => !seen.has(url) && seen.add(url)) });
});

export async function uploadPicture(request, env) {
  const form = await readForm(request);
  if (!form || !hasFile(form.get("picture"))) return apiError(400, "No picture came through. Try again.");
  const stored = await storePicture(env, form.get("picture"));
  if (stored.error) return stored.error;
  return fresh({ url: `/blog/img/${stored.name}` }, 201);
}

// --- sounds ----------------------------------------------------------------------

// Raw body, not a form. Parsing a big multipart form takes more CPU than the free plan allows.
// The file name comes in ?name=.
export async function uploadSound(request, env) {
  const tooBig = apiError(413, "That sound is too big (20 MB at most).");
  if (Number(request.headers.get("content-length")) > MAX_SOUND_BYTES) return tooBig;
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length === 0) return apiError(400, "No sound came through. Try again.");
  if (bytes.length > MAX_SOUND_BYTES) return tooBig;
  const sound = mediaType(bytes);
  if (!isSound(sound)) return apiError(415, "The sound has to be an mp3, m4a, aac, ogg, wav or flac.");
  const name = fileName(new URL(request.url).searchParams.get("name") ?? "", sound.ext, "sound");
  try {
    await env.PICTURES.put(SOUNDS + name, bytes, { metadata: { type: sound.type } });
  } catch {
    // likely the free plan's KV limits (1,000 writes a day, 1 GB)
    return apiError(503, "There's no room for sounds right now. Try again tomorrow.");
  }
  return fresh({ url: `/blog/sound/${name}` }, 201);
}

// --- comments --------------------------------------------------------------------

export async function createComment(request, env, ctx) {
  const { success } = await env.COMMENT_LIMITER.limit({ key: clientKey(request) });
  if (!success) return apiError(429, "That's a lot of comments. Wait a minute, then try again.");
  const input = await readJson(request, 20_000);
  if (!input) return apiError(400, "That didn't come through. Try again.");
  // honeypot, hidden from people
  if (input.website) return apiError(400, "That didn't come through. Try again.");
  const name = cleanText(input.name, MAX_LENGTH.name);
  const body = cleanText(input.body, MAX_LENGTH.comment);
  if (!name || !body) return apiError(400, "A comment needs a name and something to say.");

  await ensureSchema(env);
  const post = await env.DB.prepare("SELECT id, title, slug, comments_open FROM posts WHERE id = ? AND draft = 0").bind(Number(input.post)).first();
  if (!post) return apiError(404, "That blog isn't here anymore.");
  if (!post.comments_open) return apiError(403, "Comments are closed on this blog.");
  let parent = null;
  if (input.parent != null) {
    parent = await env.DB.prepare("SELECT id FROM comments WHERE id = ? AND post_id = ?").bind(Number(input.parent), post.id).first();
    if (!parent) return apiError(404, "The comment you're replying to isn't here anymore.");
  }
  const admin = await isAdmin(request, env);
  const comment = await env.DB.prepare(
    `INSERT INTO comments (post_id, parent_id, name, body, is_admin, created) VALUES (?, ?, ?, ?, ?, ?)
     RETURNING id, parent_id, name, body, is_admin, deleted, created`,
  ).bind(post.id, parent?.id ?? null, name, body, admin ? 1 : 0, Date.now()).first();
  // email the admin, unless it's their own comment
  if (!admin) {
    const { hostname, origin } = new URL(request.url);
    const said = parent ? "replied to a comment on" : "commented on";
    ctx?.waitUntil(notify(env, hostname, `New comment on ${quoted(post.title)}`,
      `${name} ${said} ${quoted(post.title)}:\n\n${body}\n\nRead it there: ${origin}/#blog/${encodeURIComponent(post.slug)}\n`));
  }
  return fresh(comment, 201);
}

// Soft delete. The blanked row keeps its replies in place.
export async function deleteComment(request, env) {
  await ensureSchema(env);
  await env.DB.prepare("UPDATE comments SET deleted = 1, name = '', body = '' WHERE id = ?").bind(idParam(request)).run();
  return done();
}

// --- pages -----------------------------------------------------------------------

// Admin-written pages, name to title.
const PAGES = { home: "Home", bulletin: "Bulletin", about: "About me", tagline: "Tagline", footer: "Footer", blinkies: "Blinkies" };
const pageName = (request) => {
  const name = new URL(request.url).searchParams.get("name");
  return Object.hasOwn(PAGES, name) ? name : null;
};

export const getPage = readOnly(async (request, env) => {
  const name = pageName(request);
  if (!name) return apiError(404, "There's no page like that.");
  const page = await env.DB.prepare("SELECT body, updated FROM pages WHERE name = ?").bind(name).first();
  return fresh({ name, title: PAGES[name], body: page?.body ?? "", updated: page?.updated ?? null });
});

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
  const kept = new Set(filesIn(body));
  await dropUnused(env, filesIn(before?.body).filter((address) => !kept.has(address)));
  return fresh({ name });
}
