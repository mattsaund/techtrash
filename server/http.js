// techtrash.org : small helpers every part of the server uses.

// JSON that's never cached (it changes whenever something's posted), and is
// only ever JSON
const JSON_HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

export function apiError(status, message) {
  return Response.json({ error: message }, { status, headers: JSON_HEADERS });
}

export function fresh(body, status = 200) {
  return Response.json(body, { status, headers: JSON_HEADERS });
}

export const done = () => new Response(null, { status: 204 });

// who's asking, for the rate limiters
export const clientKey = (request) => request.headers.get("cf-connecting-ip") ?? "unknown";

// A change (a post, a log on) has to come from the site's own pages. Browsers
// send Origin with every one; a page on another site can't fake it.
export function fromThisSite(request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}
