// techtrash.org : the server.
//
// Cloudflare serves everything in public/ before this code runs: a request that
// matches a file is answered straight away. What's left comes here:
//
//   /api/desktop          the shared desktop           server/desktop.js
//   /api/me, /api/logon,  who's logged on, and the     server/admin.js
//   /api/logoff           admin account
//   /api/blog/...,        the blog, and its pictures   server/blog.js
//   /blog/img/<name>
//   anything else         XP's blue screen, as a 404   public/404.html
//
// Anything that changes something has to come from the site's own pages, and
// everything that posts, changes or deletes is the admin's alone, except a
// comment, which is anyone's.

import { adminOnly, isAdmin, logoff, logon } from "./server/admin.js";
import * as blog from "./server/blog.js";
import { apiError, fresh, fromThisSite } from "./server/http.js";

export { Desktop } from "./server/desktop.js";

// "<method> <what>" for /api/blog/<what>. Reading is anyone's; the rest is the admin's.
const BLOG = {
  "GET flags": blog.listFlags,
  "POST flags": blog.createFlag,
  "PUT flag": blog.renameFlag,
  "DELETE flag": blog.deleteFlag,
  "GET topics": blog.listTopics,
  "POST topics": blog.createTopic,
  "GET topic": blog.getTopic,
  "PUT topic": blog.updateTopic,
  "DELETE topic": blog.deleteTopic,
  "POST posts": blog.createPost,
  "GET post": blog.getPost,
  "PUT post": blog.updatePost,
  "DELETE post": blog.deletePost,
  "POST pictures": blog.uploadPicture,
  "POST comments": blog.createComment,   // anyone's, see server/blog.js
  "DELETE comment": blog.deleteComment,
};

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const method = request.method;
    const reading = method === "GET" || method === "HEAD";

    if (pathname === "/api/desktop") return env.DESKTOP.get(env.DESKTOP.idFromName("desktop")).fetch(request);
    if (pathname.startsWith("/api/") && !reading && !fromThisSite(request)) {
      return apiError(403, "That has to come from techtrash.org itself.");
    }

    if (pathname === "/api/me" && reading) return fresh({ admin: await isAdmin(request, env) });
    if (pathname === "/api/logon" && method === "POST") return logon(request, env);
    if (pathname === "/api/logoff" && method === "POST") return logoff(request);

    if (pathname.startsWith("/api/blog/")) {
      const route = BLOG[`${reading ? "GET" : method} ${pathname.slice("/api/blog/".length)}`];
      if (route) return reading || route === blog.createComment ? route(request, env) : adminOnly(request, env, route);
    }
    if (reading && pathname.startsWith("/blog/img/")) {
      const name = pathname.slice("/blog/img/".length);
      if (blog.PICTURE_NAME.test(name)) return blog.servePicture(name, env);
    }

    if (pathname.startsWith("/api/")) return apiError(404, "Not found.");
    const page = await env.ASSETS.fetch(new URL("/404", request.url));
    return new Response(page.body, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  },
};
