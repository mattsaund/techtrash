// The server. Cloudflare answers any request that matches a file in public/
// before this code runs, and everything else comes here.
//
//   /api/desktop,         the shared desktop (its      server/desktop.js,
//   /api/disk/...         icons, disk and admin)       server/disk.js
//   /api/me, /api/logon,  who's logged on, and the     server/admin.js
//   /api/logoff           admin account
//   /api/time             the server's clock, for Date and Time Properties
//                         and the Command Prompt's ping
//   /api/blog/...,        the blog, its pictures and   server/blog.js
//   /blog/img/<name>,     its sounds
//   /blog/sound/<name>
//   /rss.xml              the blog, for feed readers   server/feed.js
//   anything else         XP's blue screen, as a 404   public/404.html
//                         (a JSON one under /api/)
//
// Anything that changes something has to come from the site's own pages.
// Posting, changing or deleting on the blog is the admin's alone, except for
// comments, which are anyone's. The shared desktop is everyone's, though the
// admin can lock it and keep people out (server/disk.js).

import { adminOnly, isAdmin, logoff, logon, visitorTag } from "./server/admin.js";
import * as blog from "./server/blog.js";
import { feed } from "./server/feed.js";
import { apiError, clientKey, fresh, fromThisSite } from "./server/http.js";

export { Desktop } from "./server/desktop.js";

// "<method> <what>" for /api/blog/<what>. Reading is anyone's, and the rest
// is the admin's, except comments.
const BLOG = {
  "GET posts": blog.listPosts,     // drafts are the admin's, checked there
  "POST posts": blog.createPost,
  "GET post": blog.getPost,        // a draft is the admin's, checked there
  "PUT post": blog.updatePost,
  "DELETE post": blog.deletePost,
  "GET flags": blog.listFlags,
  "GET pictures": blog.listPictures,
  "POST pictures": blog.uploadPicture,
  "POST sounds": blog.uploadSound,
  "POST comments": blog.createComment,   // anyone's, see server/blog.js
  "DELETE comment": blog.deleteComment,
  "GET page": blog.getPage,
  "PUT page": blog.savePage,
};

// The most anyone can send the shared disk in one go. That's a 4 MB picture,
// or a 20 MB song from the admin, plus a little.
const MAX_UPLOAD = 4 * 1024 * 1024 + 64 * 1024;
const MAX_ADMIN_UPLOAD = 20 * 1024 * 1024 + 64 * 1024;

// Passes a request on to the shared desktop, with two headers saying who's
// asking (server/desktop.js). Any the request brought itself are thrown out
// first. Changes are limited to 60 a minute per person (DISK_LIMITER).
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
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      // The error goes in the Worker's logs (the dashboard's Observability
      // tab, or `npx wrangler tail`). An API call gets a plain message
      // instead of Cloudflare's error page.
      console.error(request.method, new URL(request.url).pathname, error);
      if (new URL(request.url).pathname.startsWith("/api/")) {
        return apiError(500, "Something broke on the server. Try again, and if it keeps happening, check the Worker's logs.");
      }
      throw error;
    }
  },
};

async function route(request, env) {
  const { pathname } = new URL(request.url);
  const method = request.method;
  const reading = method === "GET" || method === "HEAD";

  // (the desktop's WebSocket opens with a GET, so it's checked too)
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
    if (handler) return reading || handler === blog.createComment ? handler(request, env) : adminOnly(request, env, handler);
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
