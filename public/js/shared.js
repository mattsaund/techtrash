// techtrash.org : the line to the shared desktop.
//
// Everyone on the site sees one desktop. Where the icons sit lives on the
// server (the Desktop object in worker.js): it comes down a WebSocket when the
// page opens, and every move made here goes up it and out to everyone else as
// it happens. Without the server (a plain file server for a quick look, or
// offline) the desktop still works here, it just isn't shared.
//
// Positions travel as fractions of the room an icon has to move in (see
// js/icons.js): { blog: [0.25, 0.1] }.

const SEND_EVERY_MS = 50;   // while dragging, the newest position goes up at most this often

export function share({ onDesktop, onMove }) {
  let socket = null;
  let retryDelay = 1000;
  let pending = null;       // the newest move that hasn't gone up yet
  let timer = null;

  function connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${location.host}/api/desktop`);
    socket.addEventListener("open", () => {
      retryDelay = 1000;
    });
    socket.addEventListener("message", (event) => {
      if (event.data === "pong") return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.t === "desktop") onDesktop(message.icons);
      else if (message.t === "move") onMove(message.icons);
    });
    socket.addEventListener("close", () => {
      socket = null;
      setTimeout(connect, retryDelay);
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

  // keeps the connection from being closed for sitting idle
  setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) socket.send("ping");
  }, 30000);

  if (location.host) connect();

  return {
    // During a drag. Goes up at most every SEND_EVERY_MS, and always ends on
    // the newest position.
    move(icons) {
      pending = icons;
      if (!timer) flush();
    },
    // The end of a drag: goes up now, and the server saves it.
    drop(icons) {
      clearTimeout(timer);
      timer = null;
      pending = null;
      send("drop", icons);
    },
  };
}
