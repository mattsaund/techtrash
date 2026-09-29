// techtrash.org : the server.
//
// Cloudflare serves everything in public/ before this code runs: a request that
// matches a file is answered straight away. What's left comes here, and the
// only thing here so far is the shared desktop.
//
// The desktop is one Durable Object, Desktop, that every open techtrash tab
// connects to over a WebSocket at /api/desktop. It knows where every icon sits,
// sends that to each tab as it connects, passes every move on to everyone else
// as it happens, and saves where things end up.

import { DurableObject } from "cloudflare:workers";
import { APPS } from "./public/js/apps.js";

// The icons on the desktop: my pages (public/js/apps.js). Things people save
// will join them.
const ICONS = new Set(APPS.filter((app) => app.kind === "page").map((app) => app.id));

const SAVE_DELAY_MS = 2000;           // a move is saved this long after the last one, a drop at once
const MAX_MESSAGE_BYTES = 4096;
const MAX_MESSAGES_PER_SECOND = 60;   // a tab sends at most 20 while dragging

// Where an icon sits is a fraction of the room it has to move in, 0 to 1 across
// and 0 to 1 down, so the desktop keeps its arrangement on every screen size.
// Anything that isn't a known icon at a pair of numbers is dropped, and the
// numbers are held to 0..1 and 4 places (a quarter of a pixel on a 2560px screen).
function cleanIcons(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const icons = {};
  for (const [id, at] of Object.entries(value)) {
    if (!ICONS.has(id) || !Array.isArray(at) || at.length !== 2) continue;
    const [x, y] = at.map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    icons[id] = [x, y].map((n) => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000);
  }
  return Object.keys(icons).length > 0 ? icons : null;
}

export class Desktop extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS icons (id TEXT PRIMARY KEY, x REAL NOT NULL, y REAL NOT NULL)");
    // lets tabs keep their connection alive without waking this object up
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.icons = new Map();
    for (const { id, x, y } of ctx.storage.sql.exec("SELECT id, x, y FROM icons").toArray()) {
      if (ICONS.has(id)) this.icons.set(id, [x, y]);
    }
    this.unsaved = new Set();
    this.saveTimer = null;
  }

  // a tab connecting: send it the whole desktop, then it gets moves as they happen
  async fetch(request) {
    if (request.headers.get("upgrade") !== "websocket") return new Response("expected a websocket", { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ t: "desktop", icons: Object.fromEntries(this.icons) }));
    return new Response(null, { status: 101, webSocket: client });
  }

  // "move" while an icon is being dragged, "drop" when it's let go
  webSocketMessage(ws, raw) {
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE_BYTES || !this.allow(ws)) return;
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message?.t !== "move" && message?.t !== "drop") return;
    const icons = cleanIcons(message.icons);
    if (!icons) return;

    for (const [id, at] of Object.entries(icons)) {
      this.icons.set(id, at);
      this.unsaved.add(id);
    }
    const update = JSON.stringify({ t: "move", icons });
    for (const other of this.ctx.getWebSockets()) {
      if (other === ws) continue;
      try {
        other.send(update);
      } catch {}
    }
    if (message.t === "drop") this.save();
    else this.saveTimer ??= setTimeout(() => this.save(), SAVE_DELAY_MS);
  }

  // at most MAX_MESSAGES_PER_SECOND from one tab; the rest are ignored
  allow(ws) {
    const tab = ws.deserializeAttachment() ?? {};
    const second = Math.floor(Date.now() / 1000);
    if (tab.second !== second) Object.assign(tab, { second, count: 0 });
    tab.count++;
    ws.serializeAttachment(tab);
    return tab.count <= MAX_MESSAGES_PER_SECOND;
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    for (const id of this.unsaved) {
      const [x, y] = this.icons.get(id);
      this.ctx.storage.sql.exec(
        "INSERT INTO icons (id, x, y) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET x = excluded.x, y = excluded.y",
        id, x, y,
      );
    }
    this.unsaved.clear();
  }

  webSocketClose(ws, code) {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code);
    } catch {}
  }
}

export default {
  // only runs for requests that don't match a file in public/
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/desktop") return env.DESKTOP.get(env.DESKTOP.idFromName("desktop")).fetch(request);
    return new Response("not found", { status: 404 });
  },
};
