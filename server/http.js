// Small helpers the whole server uses.

// JSON is never cached (it changes whenever something's posted), and the
// browser never takes it for anything but JSON.
const JSON_HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

export function apiError(status, message) {
  return Response.json({ error: message }, { status, headers: JSON_HEADERS });
}

export function fresh(body, status = 200) {
  return Response.json(body, { status, headers: JSON_HEADERS });
}

export const done = () => new Response(null, { status: 204 });

// Who's asking, for the rate limiters.
export const clientKey = (request) => request.headers.get("cf-connecting-ip") ?? "unknown";

// A change (a post, a log on) has to come from the site's own pages.
// Browsers always send Origin with one, and another site can't fake it.
export function fromThisSite(request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}
