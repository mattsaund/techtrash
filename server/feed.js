// The blog as an RSS feed at /rss.xml, for people who follow it in a feed
// reader. It has the newest published blogs (never a draft), each with its
// title, address, date, flags, opening words, and all its words and pictures,
// with the site's own addresses made absolute so they work in any reader. The
// site's pages point to it (<link rel="alternate"> in public/index.html and
// public/pages/blog/), so a reader given techtrash.org finds it.
//
// A browser that opens it draws it like the website, with a line saying what
// it is (public/css/feed.css). It's sent as plain XML, which every reader
// takes, because Firefox downloads a file sent as RSS instead of showing it.

import { ensureSchema, excerpt, flagsOf } from "./blog.js";

const NEWEST = 20;   // blogs in the feed
const TAGLINE = "My own little corner of the internet.";   // until one's written (public/pages/blog/index.html)

const xml = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// in a CDATA section, with any "]]>" (which would end it) split across two
const cdata = (text) => `<![CDATA[${String(text).replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;

// A blog's words with the site's own addresses made absolute. That's pictures
// and sounds (/blog/img/...) and links to other pages of the site
// (?blog/liftoff, which the blog's page sends on to the desktop).
const whole = (html, origin) => html
  .replace(/(\s(?:src|href)=")\/(?!\/)/g, `$1${origin}/`)
  .replace(/(\shref=")\?/g, `$1${origin}/pages/blog/?`);

export async function feed(request, env) {
  await ensureSchema(env);
  const origin = new URL(request.url).origin;
  const [{ results: posts }, tagline] = await Promise.all([
    env.DB.prepare(
      `SELECT id, title, slug, body, published, updated FROM posts WHERE draft = 0
       ORDER BY COALESCE(published, created) DESC, id DESC LIMIT ?`,
    ).bind(NEWEST).all(),
    env.DB.prepare("SELECT body FROM pages WHERE name = 'tagline'").first(),
  ]);
  const flags = await flagsOf(env, posts.map((post) => post.id));
  const latest = Math.max(0, ...posts.map((post) => Math.max(post.published ?? 0, post.updated ?? 0)));

  const items = posts.map((post) => `
    <item>
      <title>${xml(post.title)}</title>
      <link>${xml(`${origin}/#blog/${encodeURIComponent(post.slug)}`)}</link>
      <guid isPermaLink="false">techtrash-blog-${post.id}</guid>
      <pubDate>${new Date(post.published).toUTCString()}</pubDate>
${flags[post.id].map((flag) => `      <category>${xml(flag.name)}</category>\n`).join("")}      <description>${xml(excerpt(post.body, 300))}</description>
      <content:encoded>${cdata(whole(post.body, origin))}</content:encoded>
    </item>`).join("");

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/css" href="/css/tokens.css"?>
<?xml-stylesheet type="text/css" href="/css/feed.css"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Techtrash</title>
    <link>${xml(`${origin}/`)}</link>
    <atom:link href="${xml(`${origin}/rss.xml`)}" rel="self" type="application/rss+xml"/>
    <description>${xml((tagline?.body && excerpt(tagline.body, 300)) || TAGLINE)}</description>
    <language>en-us</language>
    <lastBuildDate>${new Date(latest || Date.now()).toUTCString()}</lastBuildDate>
    <image>
      <url>${xml(`${origin}/img/icons/xp/internet-shortcut.png`)}</url>
      <title>Techtrash</title>
      <link>${xml(`${origin}/`)}</link>
    </image>${items}
  </channel>
</rss>
`;

  // A reader that already has this version gets a 304 and fetches nothing.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const tag = `"${[...new Uint8Array(digest)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0")).join("")}"`;
  const headers = {
    "content-type": "application/xml; charset=utf-8",
    "cache-control": "public, max-age=900",
    etag: tag,
    "x-content-type-options": "nosniff",
  };
  if (request.headers.get("if-none-match") === tag) return new Response(null, { status: 304, headers });
  return new Response(request.method === "HEAD" ? null : body, { headers });
}
