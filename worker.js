// Worker entry point. Cloudflare serves files in public/ before this runs.
//
//   /api/desktop, /api/disk/...        shared desktop             server/desktop.js, disk.js
//   /api/me, /api/logon, /api/logoff   admin session              server/admin.js
//   /api/time                          server clock (Date and Time, cmd ping)
//   /api/blog/..., /blog/img/<name>,   blog, pictures, sounds     server/blog.js
//     /blog/sound/<name>
//   /rss.xml                           RSS feed                   server/feed.js
//   anything else                      404 blue screen            public/404.html
//                                      (JSON 404 under /api/)
//
// API writes and the desktop WebSocket must come from this origin. Blog writes are
// admin-only, except comments. The admin can lock the desktop or block visitors (server/disk.js).

import { adminOnly, isAdmin, logoff, logon, visitorTag } from "./server/admin.js";
import * as blog from "./server/blog.js";
import { feed } from "./server/feed.js";
import { apiError, clientKey, fresh, fromThisSite } from "./server/http.js";

export { Desktop } from "./server/desktop.js";

// "<method> <path>" under /api/blog/. Reads are public, writes admin-only except comments.
const BLOG = {
  "GET posts": blog.listPosts,     // handler checks admin for ?drafts
  "POST posts": blog.createPost,
  "GET post": blog.getPost,        // handler checks admin for drafts
  "PUT post": blog.updatePost,
  "PUT featured": blog.saveFeatured,
  "DELETE post": blog.deletePost,
  "GET flags": blog.listFlags,
  "GET pictures": blog.listPictures,
  "POST pictures": blog.uploadPicture,
  "POST sounds": blog.uploadSound,
  "POST comments": blog.createComment,   // public, rate-limited
  "DELETE comment": blog.deleteComment,
  "GET page": blog.getPage,
  "PUT page": blog.savePage,
};

// LIMITS.picture, or LIMITS.sound for the admin (public/js/items.js), plus 64 KB.
const MAX_UPLOAD = 4 * 1024 * 1024 + 64 * 1024;
const MAX_ADMIN_UPLOAD = 20 * 1024 * 1024 + 64 * 1024;

// Forwards to the Desktop object, which trusts x-techtrash-admin and x-techtrash-visitor,
// so client copies are dropped first. Writes count against DISK_LIMITER (60/min per IP).
async function toDesktop(request, env, reading) {
  const admin = await isAdmin(request, env);
  if (!reading) {
    const most = admin ? MAX_ADMIN_UPLOAD : MAX_UPLOAD;
    if (Number(request.headers.get("content-length")) > most) return apiError(413, `That's too big to save here (${admin ? 20 : 4} MB at most).`);
    const { success } = await env.DISK_LIMITER.limit({ key: clientKey(request) });
    if (!success) return apiError(429, "That's a lot of changes at once. Wait a minute, then try again.");
  }
  const headers = new Headers(request.headers);
  headers.delete("x-techtrash-admin");
  headers.delete("x-techtrash-visitor");
  if (admin) headers.set("x-techtrash-admin", "1");
  headers.set("x-techtrash-visitor", await visitorTag(request, env));
  return env.DESKTOP.get(env.DESKTOP.idFromName("desktop")).fetch(new Request(request, { headers }));
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (error) {
      // Logged to Workers Logs (Observability tab, or `npx wrangler tail`).
      // API calls get a JSON error instead of Cloudflare's error page.
      console.error(request.method, new URL(request.url).pathname, error);
      if (new URL(request.url).pathname.startsWith("/api/")) {
        return apiError(500, "Something broke on the server. Try again, and if it keeps happening, check the Worker's logs.");
      }
      throw error;
    }
  },
};

async function route(request, env, ctx) {
  const { pathname } = new URL(request.url);
  const method = request.method;
  const reading = method === "GET" || method === "HEAD";

  // The desktop WebSocket opens with a GET, so check it too.
  const upgrade = request.headers.get("upgrade") === "websocket";
  if (pathname.startsWith("/api/") && (!reading || upgrade) && !fromThisSite(request)) {
    return apiError(403, "That has to come from techtrash.org itself.");
  }
  if (pathname === "/api/desktop" || pathname.startsWith("/api/disk/")) return toDesktop(request, env, reading);

  if (pathname === "/api/me" && reading) return fresh({ admin: await isAdmin(request, env) });
  if (pathname === "/api/time" && reading) return fresh({ now: Date.now() });
  if (pathname === "/api/logon" && method === "POST") return logon(request, env);
  if (pathname === "/api/logoff" && method === "POST") return logoff(request);

  if (pathname.startsWith("/api/blog/")) {
    const handler = BLOG[`${reading ? "GET" : method} ${pathname.slice("/api/blog/".length)}`];
    if (handler) return reading || handler === blog.createComment ? handler(request, env, ctx) : adminOnly(request, env, handler);
  }
  if (reading && pathname.startsWith("/blog/img/")) {
    const name = pathname.slice("/blog/img/".length);
    if (blog.PICTURE_NAME.test(name)) return blog.servePicture(name, request, env);
  }
  if (reading && pathname.startsWith("/blog/sound/")) {
    const name = pathname.slice("/blog/sound/".length);
    if (blog.SOUND_NAME.test(name)) return blog.serveSound(name, request, env);
  }
  if (reading && pathname === "/rss.xml") return feed(request, env);

  if (pathname.startsWith("/api/")) return apiError(404, "Not found.");
  const page = await env.ASSETS.fetch(new URL("/404", request.url));
  return new Response(page.body, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
}
