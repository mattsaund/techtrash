// techtrash.org : the admin account.
//
// Everyone who visits is the "techtrash" user, and can read everything. Only
// the admin can post. The admin logs on from the Welcome screen with a user
// name and password that live in the Worker's secrets, never in this repo:
//
//   ADMIN_USERNAME   ADMIN_PASSWORD
//
// (set them with `npx wrangler secret put ADMIN_USERNAME`, or in the Cloudflare
// dashboard under the Worker's Settings -> Variables and Secrets). Until both
// are set, nobody can log on as admin.
//
// The right pair gets a cookie that says "admin" until it expires, signed with
// a key made from the pair itself: changing either one logs every admin
// session out. The cookie can't be read by the page's scripts, and is only
// sent with requests from this site.

import { apiError, clientKey, done } from "./http.js";

const COOKIE = "techtrash_admin";
const SESSION_DAYS = 30;
const encoder = new TextEncoder();

const isSetUp = (env) => Boolean(env.ADMIN_USERNAME && env.ADMIN_PASSWORD);

async function signingKey(env) {
  const secret = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`techtrash admin session\n${env.ADMIN_USERNAME}\n${env.ADMIN_PASSWORD}`),
  );
  return crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

const toHex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((pair) => parseInt(pair, 16)));

function cookie(request, value, maxAge) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Strict${secure}`;
}

// Is this request from a logged on admin?
export async function isAdmin(request, env) {
  if (!isSetUp(env)) return false;
  const value = (request.headers.get("cookie") ?? "")
    .split(/;\s*/)
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  const [expires, signature] = value?.split(".") ?? [];
  if (!(Number(expires) > Date.now()) || !/^[0-9a-f]{64}$/.test(signature ?? "")) return false;
  return crypto.subtle.verify("HMAC", await signingKey(env), fromHex(signature), encoder.encode(`admin.${expires}`));
}

// Compares two strings in the same time whatever they hold, so how long a
// wrong guess takes says nothing about how close it was.
async function same(a, b) {
  const [x, y] = await Promise.all([a, b].map((text) => crypto.subtle.digest("SHA-256", encoder.encode(text))));
  return crypto.subtle.timingSafeEqual(x, y);
}

// POST /api/logon { username, password }. Every try counts toward
// LOGON_LIMITER (5 a minute per person), so the password can't be guessed.
export async function logon(request, env) {
  const { success } = await env.LOGON_LIMITER.limit({ key: clientKey(request) });
  if (!success) return apiError(429, "Too many tries. Wait a minute, then try again.");
  if (!isSetUp(env)) return apiError(503, "The admin account isn't set up yet.");

  // (a user name and a password are a few bytes: anything much bigger isn't one)
  if (Number(request.headers.get("content-length")) > 4096) return apiError(400, "The user name or password is incorrect.");
  const input = await request.json().catch(() => ({}));
  const username = typeof input.username === "string" ? input.username : "";
  const password = typeof input.password === "string" ? input.password : "";
  const rightName = await same(username, env.ADMIN_USERNAME);
  const rightPassword = await same(password, env.ADMIN_PASSWORD);
  if (!rightName || !rightPassword) return apiError(401, "The user name or password is incorrect.");

  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const signature = await crypto.subtle.sign("HMAC", await signingKey(env), encoder.encode(`admin.${expires}`));
  return new Response(null, {
    status: 204,
    headers: { "set-cookie": cookie(request, `${expires}.${toHex(signature)}`, SESSION_DAYS * 24 * 60 * 60) },
  });
}

// POST /api/logoff: the cookie goes, whoever's asking
export function logoff(request) {
  const response = done();
  response.headers.set("set-cookie", cookie(request, "", 0));
  return response;
}

// Runs handler only for the admin.
export async function adminOnly(request, env, handler) {
  if (!(await isAdmin(request, env))) return apiError(401, "Only the admin can do that.");
  return handler(request, env);
}
