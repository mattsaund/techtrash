// The shared desktop. One Durable Object, Desktop, is the computer everyone
// on the site shares. It holds where the icons sit, the disk (server/disk.js,
// with every file, the wallpaper, the lock and what's been done), and the
// line to every tab using it. A tab connects over a WebSocket at /api/desktop
// and gets the whole desktop, then every change as it happens. Changes to the
// disk come in as plain requests to /api/disk/... (through worker.js) and go
// out to every tab once they're made.
//
// worker.js says who's asking in two headers it sets itself, after throwing
// out any the request came with. x-techtrash-admin is "1" for the admin, and
// x-techtrash-visitor is a visitor's tag.
//
// WebSocket messages are all JSON. Positions are grid cells, [column, row]
// from the top left (public/js/grid.js):
//   to a tab    { t: "desktop", icons }       every desktop icon's cell, as it connects
//               { t: "disk", items, all }     every item on the disk, as it connects
//               { t: "disk", items, gone }    these changed (as they are now), or are gone
//               { t: "settings", settings }   the wallpaper and the lock
//               { t: "move", icons }          someone's dragging these, and they're
//                                             here right now (in cells, not whole ones)
//               { t: "place", icons }         these landed in these cells
//   from a tab  { t: "move", icons }          dragging: passed on, not saved
//               { t: "drop", icons }          let go: snapped to a free cell, saved,
//                                             and sent to everyone as "place"
// The disk's requests are the cases in answer(), below.

import { DurableObject } from "cloudflare:workers";
import { findApp, firstShortcutsFirst } from "../public/js/apps.js";
import { LAST_CELL, cellKey, nearestFree, nextFreeCell, startingCells } from "../public/js/grid.js";
import { LIMITS } from "../public/js/items.js";
import { Disk, DiskError, TEXT } from "./disk.js";
import { sendPart } from "./media.js";

const MAX_MESSAGE_BYTES = 4096;
const MAX_MESSAGES_PER_SECOND = 60;   // a tab sends at most 20 while dragging
const MAX_JSON_BYTES = 16 * 1024;

// A request's body, read no further than `most` bytes. worker.js checks the
// size a request says it is, but a body sent in chunks doesn't say.
async function upTo(request, most) {
  const parts = [];
  let size = 0;
  for await (const part of request.body ?? []) {
    size += part.byteLength;
    if (size > most) throw new DiskError(413, "That's too big to save here.");
    parts.push(part);
  }
  const all = new Uint8Array(size);
  parts.reduce((at, part) => (all.set(part, at), at + part.byteLength), 0);
  return all;
}

const json = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });

export class Desktop extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const { sql } = ctx.storage;
    sql.exec("CREATE TABLE IF NOT EXISTS cells (id TEXT PRIMARY KEY, col INTEGER NOT NULL, row INTEGER NOT NULL)");
    this.disk = new Disk(sql, (work) => ctx.storage.transactionSync(work));
    // Lets tabs keep their connection alive without waking this object up.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    // The desktop's icons are the items in its folder. The shortcuts it
    // started with come first, then the rest in the order they were made.
    // Each goes in its saved cell, or the next free one down XP's columns.
    const onDesktop = this.disk.list().filter((item) => item.parent === "desktop")
      .sort((a, b) => firstShortcutsFirst(a, b) || a.created - b.created);
    const saved = new Map(sql.exec("SELECT id, col, row FROM cells").toArray().map(({ id, col, row }) => [id, [col, row]]));
    this.icons = startingCells(onDesktop.map((item) => item.id), saved);
    for (const [id, cell] of this.icons) if (!saved.has(id)) this.store(id, cell);
  }

  // Puts an icon in a cell and saves it for next time.
  store(id, cell) {
    this.icons.set(id, cell);
    this.ctx.storage.sql.exec(
      "INSERT INTO cells (id, col, row) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET col = excluded.col, row = excluded.row",
      id, cell[0], cell[1],
    );
  }

  forget(id) {
    this.icons.delete(id);
    this.ctx.storage.sql.exec("DELETE FROM cells WHERE id = ?", id);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const who = request.headers.get("x-techtrash-admin") === "1" ? "admin" : request.headers.get("x-techtrash-visitor") || "unknown";
    if (url.pathname === "/api/desktop") return this.connect(request, who);
    try {
      return await this.answer(request, url, who);
    } catch (error) {
      if (error instanceof DiskError) return json({ error: error.message }, error.status);
      throw error;
    }
  }

  // --- the WebSocket ------------------------------------------------------------

  // A new tab gets the whole desktop, then every change as it happens.
  connect(request, who) {
    if (request.headers.get("upgrade") !== "websocket") return new Response("expected a websocket", { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ who });
    server.send(JSON.stringify({ t: "desktop", icons: Object.fromEntries(this.icons) }));
    server.send(JSON.stringify({ t: "disk", all: true, items: this.disk.list() }));
    server.send(JSON.stringify({ t: "settings", settings: this.disk.settings() }));
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
    const icons = this.cleanIcons(message?.icons, message?.t === "drop");
    // If the desktop's locked or this visitor's kept out, nothing moves, and
    // a drop goes back where it came from.
    let mayMove = Boolean(icons);
    if (icons) {
      try {
        this.disk.mayChange(tab.who);
      } catch {
        mayMove = false;
        if (message.t === "drop") ws.send(JSON.stringify({ t: "place", icons: Object.fromEntries(Object.keys(icons).map((id) => [id, this.icons.get(id)])) }));
      }
    }
    if (mayMove && message.t === "move") {
      // Remembered, so the icons can go back if this tab leaves mid-drag.
      tab.moving = [...new Set([...(tab.moving ?? []), ...Object.keys(icons)])];
      this.send({ t: "move", icons }, ws);
    } else if (mayMove && message.t === "drop") {
      tab.moving = [];
      this.send({ t: "place", icons: this.drop(icons) });
    }
    ws.serializeAttachment(tab);
  }

  // Throws out anything that isn't one of the desktop's icons at a pair of
  // numbers. The numbers are held to the grid, then rounded to whole cells
  // for a drop or to two places (well under a pixel) for a move.
  cleanIcons(value, whole) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const icons = {};
    for (const [id, at] of Object.entries(value)) {
      if (!this.icons.has(id) || !Array.isArray(at) || at.length !== 2) continue;
      const cell = at.map(Number);
      if (!cell.every(Number.isFinite)) continue;
      icons[id] = cell.map((n) => {
        const held = Math.min(LAST_CELL, Math.max(0, n));
        return whole ? Math.round(held) : Math.round(held * 100) / 100;
      });
    }
    return Object.keys(icons).length > 0 ? icons : null;
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
      this.store(id, cell);
    }
    return placed;
  }

  // At most MAX_MESSAGES_PER_SECOND from one tab. The rest are ignored.
  allow(tab) {
    const second = Math.floor(Date.now() / 1000);
    if (tab.second !== second) Object.assign(tab, { second, count: 0 });
    tab.count++;
    return tab.count <= MAX_MESSAGES_PER_SECOND;
  }

  // To every tab, or every tab but one.
  send(message, except = null) {
    const text = JSON.stringify(message);
    for (const other of this.ctx.getWebSockets()) {
      if (other === except) continue;
      try {
        other.send(text);
      } catch {}
    }
  }

  // A tab that goes away mid-drag never drops what it was dragging, so
  // everyone else gets those icons back where they were.
  webSocketClose(ws, code) {
    const moving = (ws.deserializeAttachment()?.moving ?? []).filter((id) => this.icons.has(id));
    if (moving.length > 0) {
      this.send({ t: "place", icons: Object.fromEntries(moving.map((id) => [id, this.icons.get(id)])) }, ws);
    }
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code);
    } catch {}
  }

  // --- the disk's requests ------------------------------------------------------

  async answer(request, url, who) {
    const q = url.searchParams;
    const op = `${request.method} ${url.pathname.slice("/api/disk/".length)}`;
    const body = async () => {
      try {
        return JSON.parse(new TextDecoder().decode(await upTo(request, MAX_JSON_BYTES)));
      } catch (error) {
        if (error instanceof DiskError) throw error;
        return {};
      }
    };
    const bytes = () => upTo(request, who === "admin" ? LIMITS.sound : LIMITS.picture);
    const admin = () => {
      if (who !== "admin") throw new DiskError(401, "Only the admin can do that.");
    };

    switch (op) {
      case "GET file": return this.file(request, q.get("id"), q.get("v"));
      case "POST folder": return this.changed(this.disk.create(who, { ...(await body()), kind: "folder" }));
      // A shortcut to a program (the start menu's Send To > Desktop), named
      // after it. Only the admin can make one to an admin-only program.
      case "POST shortcut": {
        const { parent, type } = await body();
        const app = findApp(String(type ?? ""));
        if (app?.admin && who !== "admin") throw new DiskError(403, "Only the admin can make a shortcut to that.");
        return this.changed(this.disk.create(who, { parent, name: app?.title ?? "Shortcut", kind: "app", type: app?.id ?? "" }));
      }
      // type is what the file's meant to be ("text", "picture" or "sound")
      case "POST file": return this.changed(this.disk.create(who, {
        parent: q.get("parent"), name: q.get("name"), kind: "file", type: q.get("type"), data: await bytes(),
      }));
      case "PUT file": return this.changed(this.disk.write(who, q.get("id"), await bytes()));
      case "PATCH item": {
        const { name, parent } = await body();
        return this.changed(parent !== undefined ? this.disk.move(who, q.get("id"), parent) : this.disk.rename(who, q.get("id"), name));
      }
      case "DELETE item": return this.changed(this.disk.remove(who, q.get("id"), q.has("for-good")));
      case "POST restore": return this.changed(this.disk.restore(who, q.get("id")));
      case "POST empty": return this.changed(this.disk.empty(who));
      case "PUT wallpaper": return this.settingsChanged(this.disk.setWallpaper(who, await body()));
      // the Admin Dashboard's
      case "GET admin": admin(); return json({
        items: this.disk.everything(), activity: this.disk.activity(), blocked: this.disk.blocked(), settings: this.disk.settings(),
      });
      case "GET admin/activity": admin(); return json({ activity: this.disk.activity(q.get("before")) });
      case "PUT admin/lock": admin(); return this.settingsChanged(this.disk.setLocked((await body()).locked));
      case "PUT admin/block": {
        admin();
        const { visitor, blocked } = await body();
        return json({ blocked: this.disk.setBlocked(visitor, blocked) });
      }
      default: return json({ error: "Not found." }, 404);
    }
  }

  // A file's bytes, or the part of them a player asked for. Each version has
  // its own address (?v=), so a browser can keep it a while. Whatever's in a
  // file, it's only ever shown as what it is, never run.
  file(request, id, version) {
    const item = this.disk.file(id);
    const current = String(item.version) === String(version ?? "");
    const headers = {
      "content-type": item.type === TEXT ? "text/plain; charset=utf-8" : item.type,
      "cache-control": current ? "private, max-age=3600" : "no-store",
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(item.name)}`,
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
    };
    return sendPart(request, item.size, headers, (start, end) => this.disk.stream(item.id, start, end));
  }

  // Sends a change to the disk out to every tab, and keeps the desktop's
  // icons in step with its folder. Something new there gets the next free
  // cell down XP's columns, and whatever left gives its cell up.
  changed({ items = [], gone = [] }) {
    const placed = {};
    for (const item of items) {
      if (item.parent === "desktop" && !this.icons.has(item.id)) {
        const cell = nextFreeCell(new Set([...this.icons.values()].map(cellKey)));
        this.store(item.id, cell);
        placed[item.id] = cell;
      } else if (item.parent !== "desktop" && this.icons.has(item.id)) {
        this.forget(item.id);
      }
    }
    for (const id of gone) if (this.icons.has(id)) this.forget(id);
    this.send({ t: "disk", items, gone });
    if (Object.keys(placed).length) this.send({ t: "place", icons: placed });
    return json({ items, gone });
  }

  settingsChanged(settings) {
    this.send({ t: "settings", settings });
    return json({ settings });
  }
}
