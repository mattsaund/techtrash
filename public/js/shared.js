// The line to the one desktop everyone on the site shares, with its icons,
// disk and wallpaper (server/desktop.js). It's a WebSocket. The whole
// desktop comes down it on connect, then every change anyone makes, and
// icons dragged here go up it to everyone else. js/desktop.js only wakes it
// once someone uses the desktop, so a visitor who only reads the blog never
// connects. Without the server (a plain file server, or offline) the desktop
// still works, it just isn't shared.
//
// Positions travel as grid cells, [column, row] from the top left
// (js/grid.js), like { blog: [3, 1] }. Mid-drag they're wherever the icon is
// right now, so not whole cells, like { blog: [3.42, 1.1] }. The messages are
// listed at the top of server/desktop.js.
//
// line.on(t, fn) hears every message of type t. line.wake() connects, and
// line.again() reconnects when the user changes, so the server knows.

const SEND_EVERY_MS = 50;   // mid-drag, the newest position goes up at most this often

const listeners = new Map();
let socket = null;
let awake = false;
let retryDelay = 1000;
let retrying = null;        // the reconnect that's waiting to happen
let pending = null;         // the newest move that hasn't gone up yet
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
  // Only reconnect if this is still the live socket. again() replaces it on purpose.
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

// Let go of the connection as soon as the page goes away (closed, or
// navigated off), so if it was mid-drag the server can put those icons back
// for everyone. A page kept in the back/forward cache wouldn't close it
// otherwise. If the page comes back, the retry reconnects.
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
  again() {
    if (!awake) return;
    const old = socket;
    socket = null;
    old?.close();
    connect();
  },
  // Mid-drag. Goes up at most every SEND_EVERY_MS, and always ends on the
  // newest position.
  move(icons) {
    pending = icons;
    if (!timer) flush();
  },
  // The end of a drag, in whole cells. Goes up now, and the server snaps it
  // to a free cell, saves it and tells everyone (this tab too) where it went.
  drop(icons) {
    clearTimeout(timer);
    timer = null;
    pending = null;
    send("drop", icons);
  },
};
