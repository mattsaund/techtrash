// techtrash.org : the shared desktop.
//
// The desktop is one Durable Object, Desktop, that every open techtrash tab
// connects to over a WebSocket at /api/desktop. It knows which grid cell every
// icon sits in, sends that to each tab as it connects, passes every drag on to
// everyone else as it happens, and saves where things are dropped.
//
// Messages, all JSON. Positions are in grid cells, [column, row] from the top
// left (public/js/grid.js):
//   to a tab    { t: "desktop", icons }  every icon's cell, as it connects
//               { t: "move", icons }     someone's dragging these; here right
//                                        now, in cells but not whole ones
//               { t: "place", icons }    these landed in these cells
//   from a tab  { t: "move", icons }     dragging: passed on, not saved
//               { t: "drop", icons }     let go: snapped to a free cell, saved,
//                                        and sent to everyone as "place"

import { DurableObject } from "cloudflare:workers";
import { ON_DESKTOP } from "../public/js/apps.js";
import { LAST_CELL, cellKey, nearestFree, startingCells } from "../public/js/grid.js";

// The icons on the desktop (ON_DESKTOP in public/js/apps.js), in order. Things
// people save will join them.
const ICONS = ON_DESKTOP.map((app) => app.id);
const KNOWN = new Set(ICONS);

const MAX_MESSAGE_BYTES = 4096;
const MAX_MESSAGES_PER_SECOND = 60;   // a tab sends at most 20 while dragging

// Anything that isn't a known icon at a pair of numbers is dropped. The numbers
// are held to the grid, and made whole for a drop or held to two places (well
// under a pixel) for a move.
function cleanIcons(value, whole) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const icons = {};
  for (const [id, at] of Object.entries(value)) {
    if (!KNOWN.has(id) || !Array.isArray(at) || at.length !== 2) continue;
    const cell = at.map(Number);
    if (!cell.every(Number.isFinite)) continue;
    icons[id] = cell.map((n) => {
      const held = Math.min(LAST_CELL, Math.max(0, n));
      return whole ? Math.round(held) : Math.round(held * 100) / 100;
    });
  }
  return Object.keys(icons).length > 0 ? icons : null;
}

export class Desktop extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS cells (id TEXT PRIMARY KEY, col INTEGER NOT NULL, row INTEGER NOT NULL)");
    // lets tabs keep their connection alive without waking this object up
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    const saved = new Map();
    for (const { id, col, row } of ctx.storage.sql.exec("SELECT id, col, row FROM cells").toArray()) {
      if (KNOWN.has(id)) saved.set(id, [col, row]);
    }
    // an icon nobody has moved yet goes in XP's column down the left
    this.icons = startingCells(ICONS, saved);
  }

  // a tab connecting: send it the whole desktop, then it gets moves as they happen
  async fetch(request) {
    if (request.headers.get("upgrade") !== "websocket") return new Response("expected a websocket", { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ t: "desktop", icons: Object.fromEntries(this.icons) }));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, raw) {
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE_BYTES) return;
    const tab = ws.deserializeAttachment() ?? {};
    if (!this.allow(tab)) return ws.serializeAttachment(tab);
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return ws.serializeAttachment(tab);
    }

    if (message?.t === "move") {
      const icons = cleanIcons(message.icons, false);
      if (icons) {
        // remembered, so the icons can be put back if this tab goes mid-drag
        tab.moving = [...new Set([...(tab.moving ?? []), ...Object.keys(icons)])];
        this.send({ t: "move", icons }, ws);
      }
    } else if (message?.t === "drop") {
      const icons = cleanIcons(message.icons, true);
      if (icons) {
        tab.moving = [];
        this.send({ t: "place", icons: this.drop(icons) });
      }
    }
    ws.serializeAttachment(tab);
  }

  // Puts each dropped icon in its cell, or the nearest free one if another
  // icon got there first, and saves them. Cells the dropped icons are leaving
  // count as free.
  drop(icons) {
    const taken = new Set([...this.icons].filter(([id]) => !(id in icons)).map(([, cell]) => cellKey(cell)));
    const placed = {};
    for (const [id, want] of Object.entries(icons)) {
      const cell = taken.has(cellKey(want)) ? (nearestFree(want, taken) ?? want) : want;
      taken.add(cellKey(cell));
      placed[id] = cell;
      this.icons.set(id, cell);
      this.ctx.storage.sql.exec(
        "INSERT INTO cells (id, col, row) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET col = excluded.col, row = excluded.row",
        id, cell[0], cell[1],
      );
    }
    return placed;
  }

  // at most MAX_MESSAGES_PER_SECOND from one tab; the rest are ignored
  allow(tab) {
    const second = Math.floor(Date.now() / 1000);
    if (tab.second !== second) Object.assign(tab, { second, count: 0 });
    tab.count++;
    return tab.count <= MAX_MESSAGES_PER_SECOND;
  }

  // to every tab, or every tab but one
  send(message, except = null) {
    const text = JSON.stringify(message);
    for (const other of this.ctx.getWebSockets()) {
      if (other === except) continue;
      try {
        other.send(text);
      } catch {}
    }
  }

  // A tab that goes away in the middle of a drag never drops what it was
  // dragging: everyone else gets those icons back where they were.
  webSocketClose(ws, code) {
    const moving = ws.deserializeAttachment()?.moving ?? [];
    if (moving.length > 0) {
      this.send({ t: "place", icons: Object.fromEntries(moving.map((id) => [id, this.icons.get(id)])) }, ws);
    }
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code);
    } catch {}
  }
}
