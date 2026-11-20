// The shared desktop. One Durable Object holds the icon cells, the disk (server/disk.js) and
// every tab's WebSocket (/api/desktop). Disk changes come in as /api/disk/... requests (see
// answer()) and go out to every tab. worker.js sets x-techtrash-admin ("1") and
// x-techtrash-visitor (a visitor tag) after dropping any the client sent.
//
// WebSocket messages are JSON. Cells are [column, row] from the top left (public/js/grid.js).
//   to a tab    { t: "desktop", icons }       every icon's cell, on connect
//               { t: "disk", items, all }     every disk item, on connect
//               { t: "disk", items, gone }    changed items (as they are now) and removed ids
//               { t: "settings", settings }   wallpaper and lock
//               { t: "move", icons }          someone's live drag, in fractional cells
//               { t: "place", icons }         icons landed in these cells
//   from a tab  { t: "move", icons }          dragging, relayed but not saved
//               { t: "drop", icons }          let go, snapped to a free cell, saved and
//                                             sent to everyone as "place"

import { DurableObject } from "cloudflare:workers";
import { FIRST_SHORTCUTS, findApp, firstShortcutsFirst } from "../public/js/apps.js";
import { LAST_CELL, cellKey, nearestFree, nextFreeCell, startingCells } from "../public/js/grid.js";
import { LIMITS } from "../public/js/items.js";
import { wallpaperUrl } from "../public/js/wallpapers.js";
import { Disk, DiskError, TEXT } from "./disk.js";
import { sendPart } from "./media.js";
import { notify, notifying, quoted } from "./notify.js";

const MAX_MESSAGE_BYTES = 4096;
const MAX_MESSAGES_PER_SECOND = 60;   // a tab sends at most 20 while dragging
const MAX_JSON_BYTES = 16 * 1024;

// Reads at most `most` bytes. worker.js checks Content-Length, but a chunked body has none.
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

// Visitor actions for the admin's digest email, sent 10 minutes after the first one.
const SAVES = new Set(["POST folder", "POST shortcut", "POST file", "PUT file"]);
const EMAIL_AFTER_MS = 10 * 60 * 1000;
const MOST_IN_AN_EMAIL = 50;

const json = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });

export class Desktop extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const { sql } = ctx.storage;
    sql.exec("CREATE TABLE IF NOT EXISTS cells (id TEXT PRIMARY KEY, col INTEGER NOT NULL, row INTEGER NOT NULL)");
    this.disk = new Disk(sql, (work) => ctx.storage.transactionSync(work));
    // When email is first set up, start the digest from now, not from all past activity.
    if (notifying(env) && this.disk.setting("emailed") === null) this.disk.setSetting("emailed", this.disk.lastActivity());
    // keepalive pings are answered without waking the object
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    // Icons are the desktop folder's items, first shortcuts first, then by creation.
    // Each takes its saved cell, or the next free one down XP's columns.
    const onDesktop = this.disk.list().filter((item) => item.parent === "desktop")
      .sort((a, b) => firstShortcutsFirst(a, b) || a.created - b.created);
    const saved = new Map(sql.exec("SELECT id, col, row FROM cells").toArray().map(({ id, col, row }) => [id, [col, row]]));
    this.icons = startingCells(onDesktop.map((item) => item.id), saved);
    for (const [id, cell] of this.icons) if (!saved.has(id)) this.store(id, cell);
    // First shortcuts are pinned to the top of column 0. Whatever holds their cell swaps with them.
    FIRST_SHORTCUTS.forEach((id, row) => {
      const at = this.icons.get(id);
      if (!at || (at[0] === 0 && at[1] === row)) return;
      for (const [other, cell] of this.icons) {
        if (other !== id && cell[0] === 0 && cell[1] === row) this.store(other, at);
      }
      this.store(id, [0, row]);
    });
  }

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
      const response = await this.answer(request, url, who);
      if (response.ok && who !== "admin" && SAVES.has(`${request.method} ${url.pathname.slice("/api/disk/".length)}`)) await this.emailSoon(url.hostname);
      return response;
    } catch (error) {
      if (error instanceof DiskError) return json({ error: error.message }, error.status);
      throw error;
    }
  }

  // --- WebSocket ----------------------------------------------------------------

  // Sends the full state. Changes follow through send().
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
    // If locked or blocked, nothing moves and a drop snaps back.
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
      // so webSocketClose can put them back if the tab leaves mid-drag
      tab.moving = [...new Set([...(tab.moving ?? []), ...Object.keys(icons)])];
      this.send({ t: "move", icons }, ws);
    } else if (mayMove && message.t === "drop") {
      tab.moving = [];
      this.send({ t: "place", icons: this.drop(icons) });
    }
    ws.serializeAttachment(tab);
  }

  // Keeps known icons at numeric [col, row], clamped to the grid. Rounded to whole cells
  // for a drop, or 2 decimals (well under a pixel) for a move.
  cleanIcons(value, whole) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const icons = {};
    for (const [id, at] of Object.entries(value)) {
      // first shortcuts never move
      if (!this.icons.has(id) || FIRST_SHORTCUTS.includes(id) || !Array.isArray(at) || at.length !== 2) continue;
      const cell = at.map(Number);
      if (!cell.every(Number.isFinite)) continue;
      icons[id] = cell.map((n) => {
        const held = Math.min(LAST_CELL, Math.max(0, n));
        return whole ? Math.round(held) : Math.round(held * 100) / 100;
      });
    }
    return Object.keys(icons).length > 0 ? icons : null;
  }

  // Saves each icon at its cell, or the nearest free one if taken.
  // Cells the dropped icons are leaving count as free.
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

  // Per-tab rate limit. Extra messages are ignored.
  allow(tab) {
    const second = Math.floor(Date.now() / 1000);
    if (tab.second !== second) Object.assign(tab, { second, count: 0 });
    tab.count++;
    return tab.count <= MAX_MESSAGES_PER_SECOND;
  }

  // Broadcast, optionally skipping one socket.
  send(message, except = null) {
    const text = JSON.stringify(message);
    for (const other of this.ctx.getWebSockets()) {
      if (other === except) continue;
      try {
        other.send(text);
      } catch {}
    }
  }

  // A tab that leaves mid-drag never drops, so put its icons back for everyone else.
  webSocketClose(ws, code) {
    const moving = (ws.deserializeAttachment()?.moving ?? []).filter((id) => this.icons.has(id));
    if (moving.length > 0) {
      this.send({ t: "place", icons: Object.fromEntries(moving.map((id) => [id, this.icons.get(id)])) }, ws);
    }
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code);
    } catch {}
  }

  // --- save digest email --------------------------------------------------------

  // Sets the digest alarm 10 minutes out, unless one is already pending.
  async emailSoon(host) {
    if (!notifying(this.env)) return;
    if (this.disk.setting("site") !== host) this.disk.setSetting("site", host);
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + EMAIL_AFTER_MS);
  }

  async alarm() {
    const saved = this.disk.savedSince(this.disk.setting("emailed", 0));
    this.disk.setSetting("emailed", this.disk.lastActivity());
    if (!saved.length) return;
    const site = this.disk.setting("site", "techtrash.org");
    const lines = saved.slice(0, MOST_IN_AN_EMAIL).map((row) => (row.what === "made"
      ? `Visitor ${row.who} made ${quoted(row.name)} in ${row.detail || "the C: drive"}`
      : `Visitor ${row.who} saved over ${quoted(row.name)}`));
    if (saved.length > MOST_IN_AN_EMAIL) lines.push(`...and ${saved.length - MOST_IN_AN_EMAIL} more.`);
    const count = saved.length === 1 ? "1 thing" : `${saved.length} things`;
    await notify(this.env, site, `${count} saved on the XP desktop`,
      `${lines.join("\n")}\n\nSee it all in the Admin Dashboard: https://${site}/#admin\n`);
  }

  // --- disk API -----------------------------------------------------------------

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
      // For pages not connected yet (peek in public/js/disk.js). url is the wallpaper image.
      case "GET settings": {
        const settings = this.disk.settings();
        const image = settings.wallpaper?.image ?? "";
        return json({ settings, url: wallpaperUrl(image, image.startsWith("file:") ? this.disk.item(image.slice(5)) : null) });
      }
      case "POST folder": return this.changed(this.disk.create(who, { ...(await body()), kind: "folder" }));
      // Start menu's Send To > Desktop. Shortcuts to admin-only programs are admin-only.
      case "POST shortcut": {
        const { parent, type } = await body();
        const app = findApp(String(type ?? ""));
        if (app?.admin && who !== "admin") throw new DiskError(403, "Only the admin can make a shortcut to that.");
        return this.changed(this.disk.create(who, { parent, name: app?.title ?? "Shortcut", kind: "app", type: app?.id ?? "" }));
      }
      // type is "text", "picture" or "sound"
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
      // Admin Dashboard
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

  // Each version has its own URL (?v=), so it can be cached. The CSP sandbox and nosniff
  // mean uploaded content is only ever displayed, never run.
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

  // Broadcasts a disk change and keeps icons in step with the desktop folder.
  // New items get the next free cell. Items that left give theirs up.
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
