// The blog's server side. It keeps posts, flags, comments and pages.
//
//   post     a blog, with a title, a body, flags, comments on or off, and
//            whether it's a draft. The body is HTML from the editor, cleaned
//            by the page before it's sent and again before it's shown
//            (public/pages/blog/content.js). A draft is the admin's alone
//            until it's published. Turning comments off keeps the ones
//            already there and stops new ones.
//   flag     a label on posts, like Space or Computers. A post can have any
//            number and the Blog filters by them. A flag is made the first
//            time a post uses it and goes when no post does.
//   comment  anyone's, on a published post or as a reply to another comment,
//            so comments form threads. Just a name and plain text.
//   page     one of the site's own pages the admin writes (Home's words, the
//            bulletin at the top of Home, About me, the tagline under the
//            headline). Just a body, like a post's.
//
// Each post has a slug, its title made fit for an address ("Daft Punk's
// best" is daft-punks-best). It's unique across the blog so addresses can
// read #blog/<post>, and it follows the title when the title changes.
//
// Everything is in the D1 database DB, and the tables are made the first
// time they're needed. Uploaded pictures are in the KV store PICTURES under
// "blog/<name>", served at /blog/img/<name>. Sounds are there too under
// "sound/<name>", served at /blog/sound/<name> a part at a time as a player
// asks, so it can skip ahead.
//
// Anyone gets a picture or sound once it's in something that's up (a
// published blog or one of the site's own pages). Until then, in a draft or
// in nothing yet, only the admin does. That keeps a draft's pictures and
// sounds as private as the draft, even from someone who guesses the address.
// A file is deleted once nothing on the site shows it anymore.
//
// Anyone can read, drafts aside, and anyone can comment while a post's
// comments are on (5 a minute per person, COMMENT_LIMITER).
//
//   GET    /api/blog/posts[?limit=]      published posts, newest first, each with its
//                                        opening words, first picture, flags and
//                                        comment count (?limit= for the newest few)
//   GET    /api/blog/post?slug= | ?id=   a post with its flags and comments (a draft
//                                        only for the admin)
//   GET    /api/blog/flags               the flags published posts have, with counts
//                                        (the admin gets every flag)
//   GET    /api/blog/pictures            every picture posted to the site, newest
//                                        first, each with where it's from
//   GET    /api/blog/page?name=          the body of home, bulletin, about or tagline
//                                        ("" until it's written, or once it's taken down)
//   POST   /api/blog/comments            { post, parent, name, body }
//
// Everything else is the admin's. worker.js checks that with server/admin.js,
// and this file checks the drafts itself.
//
//   GET    /api/blog/posts?drafts        every draft, listed the same way
//   POST   /api/blog/posts               { title, body, flags, comments, draft }
//   PUT    /api/blog/post?id=            any of { title, body, flags, comments, draft }
//   DELETE /api/blog/post?id=            the post and its comments (and any pictures
//                                        or sounds nothing else shows)
//   POST   /api/blog/pictures            a form with a picture, returns its address
//   POST   /api/blog/sounds?name=        the sound file as the body, returns its address
//   DELETE /api/blog/comment?id=         blanks the comment, but its replies stay
//   PUT    /api/blog/page?name=          { body }

import { isAdmin } from "./admin.js";
import { apiError, clientKey, done, fresh } from "./http.js";
import { mediaType, sendPart } from "./media.js";

const MAX_LENGTH = { title: 120, flag: 40, flags: 20, body: 500_000, name: 40, comment: 2000 };
const MAX_PICTURE_BYTES = 10 * 1024 * 1024;
const MAX_SOUND_BYTES = 20 * 1024 * 1024;   // under KV's 25 MiB per value
const PICTURES = "blog/";
const FIRST_PICTURES = "topics/";   // where the first blog kept a topic's picture
const SOUNDS = "sound/";
export const PICTURE_NAME = /^[\w-]+\.(?:png|jpg|gif|webp|avif)$/;
export const SOUND_NAME = /^[\w-]+\.(?:mp3|m4a|aac|ogg|wav|flac)$/;

// --- the tables ------------------------------------------------------------------

const POSTS = `(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT,
  body TEXT NOT NULL,
  draft INTEGER NOT NULL DEFAULT 0,
  comments_open INTEGER NOT NULL DEFAULT 1,
  created INTEGER NOT NULL,
  published INTEGER,
  updated INTEGER
)`;

// Made the first time they're needed, once per Worker instance.
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

// The blog before this one (September and October 2026) kept posts under
// topics, and the very first kept them as plain text, without the columns
// added since. CREATE TABLE IF NOT EXISTS leaves an old table as it is, so
// this brings it up to date. Two Worker instances can race here. Adding a
// column that's already there fails, and the loser leaves it to the other.
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
  if (!posts.has("comments_open")) {
    // Plain-text posts become HTML, in the same batch as the new column so
    // it only ever happens once.
    const { results } = await env.DB.prepare("SELECT id, body FROM posts").all();
    await env.DB.batch([
      env.DB.prepare("ALTER TABLE posts ADD COLUMN comments_open INTEGER NOT NULL DEFAULT 1"),
      ...results.map((post) => env.DB.prepare("UPDATE posts SET body = ? WHERE id = ?").bind(textToHtml(post.body), post.id)),
    ]).catch(alreadyThere);
  }
  if (posts.has("topic_id")) await outOfTopics(env);
  await everySlugItsOwn(env);
}

// Takes posts out of topics. Each topic becomes a flag of the same name on its
// posts, along with any flags the topic had back when topics had them. Every
// post stays published, dated from when it was posted. The topics themselves
// (descriptions, pictures) stay in the topics table, unused. One batch, so it
// all happens or none of it does.
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

// Gives every post a slug of its own. A post without one (from before slugs)
// or sharing one with an older post (slugs used to be per topic) gets its
// title's, with -2, -3... on the end until no other post has it.
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
    .replace(/[\u0300-\u036f]/g, "")   // the accents NFKD took off their letters
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug || fallback;
}

// A post's slug, from its title, with -2, -3... on the end if another post
// (not the one with this id) already has it.
async function postSlug(env, title, id = null) {
  const base = slugify(title, "post");
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!(await env.DB.prepare("SELECT 1 FROM posts WHERE slug = ? AND id IS NOT ?").bind(slug, id).first())) return slug;
  }
}

// A first-blog post as HTML that looks the way it did then. Blank lines make
// paragraphs, line ends make line breaks, and links are clickable.
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
  if (Number(request.headers.get("content-length")) > MAX_PICTURE_BYTES + 100_000) return null;
  return request.formData().catch(() => null);
}

// What the blog accepts, going by a file's first bytes (server/media.js).
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

// Stores a picture from a form's file field. Returns { name } or { error }.
async function storePicture(env, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > MAX_PICTURE_BYTES) return { error: apiError(413, "That picture is too big (10 MB at most).") };
  const image = mediaType(bytes);
  if (!PICTURE_TYPES.has(image?.type)) return { error: apiError(415, "The picture has to be a png, jpg, gif, webp or avif.") };
  const name = fileName(file.name ?? "", image.ext, "picture");
  try {
    await env.PICTURES.put(PICTURES + name, bytes, { metadata: { type: image.type } });
  } catch {
    // most likely the free plan's 1,000 writes a day or 1 GB of storage has run out
    return { error: apiError(503, "Pictures are full right now. Try again tomorrow.") };
  }
  return { name };
}

const hasFile = (value) => value instanceof Blob && value.size > 0;

// Who may have an uploaded picture or sound. Anyone, once it's in a published
// blog or one of the site's own pages. Before that only the admin, so they can
// see a draft's and what they've only just added. Returns its cache-control,
// or null for a 404 that looks the same whether the file exists or not.
async function mayHave(request, env, address) {
  if (await isAdmin(request, env)) return "private, max-age=3600";
  await ensureSchema(env);
  const shown = await env.DB.prepare(
    "SELECT 1 FROM posts WHERE draft = 0 AND instr(body, ?1) > 0 UNION ALL SELECT 1 FROM pages WHERE instr(body, ?1) > 0 LIMIT 1",
  ).bind(address).first();
  return shown ? "public, max-age=3600" : null;
}

const notFound = () => new Response("not found", { status: 404 });

export async function servePicture(name, request, env) {
  const cache = await mayHave(request, env, `/blog/img/${name}`);
  if (!cache) return notFound();
  let found = await env.PICTURES.getWithMetadata(PICTURES + name, { type: "stream" });
  if (!found.value) found = await env.PICTURES.getWithMetadata(FIRST_PICTURES + name, { type: "stream" });
  if (!found.value) return notFound();
  return new Response(found.value, {
    headers: {
      "content-type": found.metadata?.type ?? "application/octet-stream",
      "cache-control": cache,
      "x-content-type-options": "nosniff",
    },
  });
}

// A sound, whole or just the part a player asks for (Range: bytes=...), so it
// can start partway in.
export async function serveSound(name, request, env) {
  const cache = await mayHave(request, env, `/blog/sound/${name}`);
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

// The addresses of uploaded pictures and sounds a post's (or a page's) body
// shows, /blog/img/<name> and /blog/sound/<name>.
const filesIn = (body) => [...(body ?? "").matchAll(/\/blog\/(?:img\/[\w-]+\.(?:png|jpg|gif|webp|avif)|sound\/[\w-]+\.(?:mp3|m4a|aac|ogg|wav|flac))/g)].map((m) => m[0]);

// Deletes the files that no post (drafts included) or page shows anymore.
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

// The start of a post's words, as plain text, for a list of posts.
export function excerpt(html, length = 220) {
  const text = decodeEntities(html
    .replace(/<a\b[^>]*href="\/blog\/sound\/[^"]*"[^>]*>.*?<\/a>/gi, " ")   // a sound's name says nothing on its own
    .replace(/<\/?(?:p|h\d|li|ul|ol|blockquote|pre|br|hr|table|tr|td|th|img)\b[^>]*>/gi, " ")   // between lines
    .replace(/<[^>]*>/g, ""))   // inside a line
    .replace(/https?:\/\/\S+/g, "")   // a player's link says nothing on its own
    .replace(/\s+/g, " ")
    .trim();
  // cut at a word and drop the trailing punctuation, so "back...", not "back...."
  return text.length > length ? `${text.slice(0, length).replace(/\s+\S*$/, "").replace(/[\s.,;:!?-]+$/, "")}...` : text;
}

// The uploaded pictures a post's (or a page's) body shows, in order, as
// { url, alt }. Pictures from elsewhere on the web aren't the site's, so
// they're left out.
function uploadedPicturesIn(html) {
  return [...html.matchAll(/<img\b[^>]*>/gi)]
    .map(([tag]) => ({ url: tag.match(/\ssrc="([^"]*)"/i)?.[1] ?? "", alt: decodeEntities(tag.match(/\salt="([^"]*)"/i)?.[1] ?? "") }))
    .filter(({ url }) => url.startsWith("/blog/img/") && PICTURE_NAME.test(url.slice("/blog/img/".length)));
}

// --- flags -----------------------------------------------------------------------

// { postId: [{ id, name, slug }, ...] } for the posts asked about. It reads
// every post's flags (a short list) instead of naming each post, since D1
// takes at most 100 bound values per query.
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

// Sets exactly these flags (by name, any case) on a post, making any that
// don't exist yet and dropping any flag no post has anymore.
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

export async function listFlags(request, env) {
  await ensureSchema(env);
  const { results } = await env.DB.prepare(
    `SELECT flags.id, flags.name,
       (SELECT COUNT(*) FROM post_flags JOIN posts ON posts.id = post_flags.post_id
        WHERE post_flags.flag_id = flags.id AND posts.draft = 0) AS count
     FROM flags ORDER BY flags.name COLLATE NOCASE`,
  ).all();
  // only the admin sees a flag that's only on drafts
  const admin = await isAdmin(request, env);
  return fresh({ flags: results.filter((flag) => admin || flag.count > 0).map((flag) => ({ ...flag, slug: slugify(flag.name, "flag") })) });
}

// --- posts -----------------------------------------------------------------------

export async function listPosts(request, env) {
  await ensureSchema(env);
  const params = new URL(request.url).searchParams;
  const drafts = params.has("drafts");
  if (drafts && !(await isAdmin(request, env))) return apiError(401, "Only the admin can do that.");
  const limit = Math.min(Math.max(Number(params.get("limit")) || 0, 0), 100);   // 0 means all
  const { results } = await env.DB.prepare(
    `SELECT id, title, slug, substr(body, 1, 50000) AS start, draft, comments_open, created, published, updated,
       (SELECT COUNT(*) FROM comments WHERE post_id = posts.id AND deleted = 0) AS comment_count
     FROM posts WHERE draft = ? ORDER BY COALESCE(published, created) DESC, id DESC${limit ? " LIMIT ?" : ""}`,
  ).bind(drafts ? 1 : 0, ...(limit ? [limit] : [])).all();
  const flags = await flagsOf(env, results.map((post) => post.id));
  // each post as a card, with its opening words, first picture and flags
  return fresh({
    posts: results.map(({ start, ...post }) => ({
      ...post, excerpt: excerpt(start, 160), cover: uploadedPicturesIn(start)[0]?.url ?? null, flags: flags[post.id],
    })),
  });
}

export async function getPost(request, env) {
  await ensureSchema(env);
  const params = new URL(request.url).searchParams;
  const bySlug = params.has("slug");
  const post = await env.DB.prepare(
    `SELECT id, title, slug, body, draft, comments_open, created, published, updated FROM posts WHERE ${bySlug ? "slug = ?" : "id = ?"}`,
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
}

// Whatever of { title, body, flags, comments, draft } a request sends,
// cleaned. Flags are names, and case doesn't matter.
async function postInput(request) {
  const input = await readJson(request, MAX_LENGTH.body * 2 + 10_000);
  if (!input) return null;
  const out = {};
  if ("title" in input) out.title = cleanText(input.title, MAX_LENGTH.title);
  if ("body" in input) out.body = typeof input.body === "string" ? input.body.slice(0, MAX_LENGTH.body) : "";
  if ("comments" in input) out.comments = input.comments ? 1 : 0;
  if ("draft" in input) out.draft = input.draft ? 1 : 0;
  if ("flags" in input) {
    const names = (Array.isArray(input.flags) ? input.flags : [])
      .map((name) => cleanText(name, MAX_LENGTH.flag).replace(/\s+/g, " "))
      .filter(Boolean);
    // the same flag twice (in any case) keeps the first spelling
    const once = new Map();
    for (const name of names) if (!once.has(name.toLowerCase())) once.set(name.toLowerCase(), name);
    out.flags = [...once.values()].slice(0, MAX_LENGTH.flags);
  }
  return out;
}

// A draft just needs a title. A published post needs words too.
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
  const before = await env.DB.prepare("SELECT title, slug, body, draft, comments_open, published FROM posts WHERE id = ?").bind(id).first();
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
  // It's dated the first time it goes up, and that date stays.
  const published = before.published ?? (next.draft ? null : Date.now());
  // "changed" is only for edits to its words while it's up, not for switching
  // comments or for edits made while it was a draft.
  const edited = !before.draft && !next.draft && (next.title !== before.title || next.body !== before.body);
  await env.DB.prepare(
    `UPDATE posts SET title = ?, slug = ?, body = ?, draft = ?, comments_open = ?, published = ?${edited ? ", updated = ?" : ""} WHERE id = ?`,
  ).bind(next.title, slug, next.body, next.draft, next.comments, published, ...(edited ? [Date.now()] : []), id).run();
  if (input.flags) await setFlags(env, id, input.flags);
  const kept = new Set(filesIn(next.body));
  await dropUnused(env, filesIn(before.body).filter((address) => !kept.has(address)));
  return fresh({ id, slug, draft: next.draft });
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

// Every picture posted to the site, newest first. That's the ones in published
// posts and the site's own pages, each once, with where it's from.
export async function listPictures(request, env) {
  await ensureSchema(env);
  const [posts, pages] = await Promise.all([
    env.DB.prepare(
      "SELECT id, title, slug, body, COALESCE(published, created) AS created FROM posts WHERE draft = 0 AND instr(body, '/blog/img/') > 0",
    ).all(),
    env.DB.prepare("SELECT name AS id, body, updated AS created FROM pages WHERE instr(body, '/blog/img/') > 0").all(),
  ]);
  // where a picture is, as { kind, id, title } plus a post's slug
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
}

// A picture for anywhere in a post.
export async function uploadPicture(request, env) {
  const form = await readForm(request);
  if (!form || !hasFile(form.get("picture"))) return apiError(400, "No picture came through. Try again.");
  const stored = await storePicture(env, form.get("picture"));
  if (stored.error) return stored.error;
  return fresh({ url: `/blog/img/${stored.name}` }, 201);
}

// --- sounds ----------------------------------------------------------------------

// A sound for anywhere in a post. The file is the request's body, not a form,
// since parsing a form costs a big file more time than the free plan allows.
// Its name comes in the address (?name=). Answers with the sound's address.
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
    // most likely the free plan's 1,000 writes a day or 1 GB of storage has run out
    return apiError(503, "There's no room for sounds right now. Try again tomorrow.");
  }
  return fresh({ url: `/blog/sound/${name}` }, 201);
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
  const post = await env.DB.prepare("SELECT id, comments_open FROM posts WHERE id = ? AND draft = 0").bind(Number(input.post)).first();
  if (!post) return apiError(404, "That blog isn't here anymore.");
  if (!post.comments_open) return apiError(403, "Comments are closed on this blog.");
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

// Blanks the comment but keeps it as "deleted", so its replies keep their place.
export async function deleteComment(request, env) {
  await ensureSchema(env);
  await env.DB.prepare("UPDATE comments SET deleted = 1, name = '', body = '' WHERE id = ?").bind(idParam(request)).run();
  return done();
}

// --- pages -----------------------------------------------------------------------

// The site's own pages the admin writes, by name, with their titles.
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
  const kept = new Set(filesIn(body));
  await dropUnused(env, filesIn(before?.body).filter((address) => !kept.has(address)));
  return fresh({ name });
}
