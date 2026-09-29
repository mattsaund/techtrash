// techtrash.org : the server.
//
// Cloudflare serves everything in public/ before this code runs: a request that
// matches a file is answered straight away. What's left comes here:
//
//   /api/desktop          the shared desktop           server/desktop.js
//   /api/me, /api/logon,  who's logged on, and the     server/admin.js
//   /api/logoff           admin account
//   /api/blog/...,        the blog, and its topics'    server/blog.js
//   /blog/img/<name>      pictures
//   anything else         XP's blue screen, as a 404   public/404.html
//
// Anything that changes something has to come from the site's own pages, and
// everything that posts or deletes is the admin's alone.

import { adminOnly, isAdmin, logoff, logon } from "./server/admin.js";
import {
  PICTURE_NAME, createPost, createTopic, deletePost, deleteTopic, getPost, getTopic, listTopics, servePicture,
} from "./server/blog.js";
import { apiError, fresh, fromThisSite } from "./server/http.js";

export { Desktop } from "./server/desktop.js";

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

    if (pathname === "/api/blog/topics" && reading) return listTopics(request, env);
    if (pathname === "/api/blog/topic" && reading) return getTopic(request, env);
    if (pathname === "/api/blog/post" && reading) return getPost(request, env);
    if (pathname === "/api/blog/topics" && method === "POST") return adminOnly(request, env, createTopic);
    if (pathname === "/api/blog/posts" && method === "POST") return adminOnly(request, env, createPost);
    if (pathname === "/api/blog/topic" && method === "DELETE") return adminOnly(request, env, deleteTopic);
    if (pathname === "/api/blog/post" && method === "DELETE") return adminOnly(request, env, deletePost);

    if (reading && pathname.startsWith("/blog/img/")) {
      const name = pathname.slice("/blog/img/".length);
      if (PICTURE_NAME.test(name)) return servePicture(name, env);
    }

    if (pathname.startsWith("/api/")) return apiError(404, "Not found.");
    const page = await env.ASSETS.fetch(new URL("/404", request.url));
    return new Response(page.body, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  },
};
