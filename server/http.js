// Shared HTTP helpers.

// Never cached (API data changes on every write) and never MIME-sniffed.
const JSON_HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

export function apiError(status, message) {
  return Response.json({ error: message }, { status, headers: JSON_HEADERS });
}

export function fresh(body, status = 200) {
  return Response.json(body, { status, headers: JSON_HEADERS });
}

export const done = () => new Response(null, { status: 204 });

// Client IP, the key for rate limits.
export const clientKey = (request) => request.headers.get("cf-connecting-ip") ?? "unknown";

// CSRF check for writes. Browsers always send Origin with them, and other sites can't forge it.
export function fromThisSite(request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}
