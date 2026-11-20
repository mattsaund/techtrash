// WebSocket to the shared desktop. Messages are listed in server/desktop.js.
// js/desktop.js wakes it on first use, so blog-only visitors never connect.
// Without a server the desktop still works, unshared. Positions are grid cells
// (js/grid.js), like { blog: [3, 1] }, fractional mid-drag.

const SEND_EVERY_MS = 50;   // mid-drag send throttle

const listeners = new Map();
let socket = null;
let awake = false;
let retryDelay = 1000;
let retrying = null;        // pending reconnect timer
let pending = null;         // newest unsent move
let timer = null;

function connect() {
  clearTimeout(retrying);
  retrying = null;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const mine = new WebSocket(`${protocol}//${location.host}/api/desktop`);
  socket = mine;
  mine.addEventListener("open", () => {
    retryDelay = 1000;
  });
  mine.addEventListener("message", (event) => {
    if (socket !== mine || event.data === "pong") return;
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    for (const listener of listeners.get(message.t) ?? []) listener(message);
  });
  // Reconnect only if this is still the live socket. again() replaces it on purpose.
  mine.addEventListener("close", () => {
    if (socket !== mine) return;
    socket = null;
    retrying = setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30000);
  });
}

function send(t, icons) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t, icons }));
}

function flush() {
  timer = null;
  if (!pending) return;
  send("move", pending);
  pending = null;
  timer = setTimeout(flush, SEND_EVERY_MS);
}

// Close on pagehide so the server can put back icons left mid-drag. The
// back/forward cache would keep it open otherwise. The retry reconnects on return.
addEventListener("pagehide", () => socket?.close());

// keeps an idle connection from being closed (the server answers "pong")
setInterval(() => {
  if (socket?.readyState === WebSocket.OPEN) socket.send("ping");
}, 30000);

export const line = {
  on(t, listener) {
    if (!listeners.has(t)) listeners.set(t, new Set());
    listeners.get(t).add(listener);
  },
  wake() {
    if (awake || !location.host) return;
    awake = true;
    connect();
  },
  // After a user change, so the server sees the new user.
  again() {
    if (!awake) return;
    const old = socket;
    socket = null;
    old?.close();
    connect();
  },
  // Mid-drag. Throttled to SEND_EVERY_MS, always ending on the newest position.
  move(icons) {
    pending = icons;
    if (!timer) flush();
  },
  // End of a drag, in whole cells. The server snaps to a free cell, saves, and
  // sends "place" to everyone (this tab too).
  drop(icons) {
    clearTimeout(timer);
    timer = null;
    pending = null;
    send("drop", icons);
  },
};
