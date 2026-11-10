// The resize corners for a picture or a player in the editor. Click a picture
// (or a player's bar) and four corners show over it. Drag one to resize it.
// It keeps its shape (a song's player only gets wider) and never gets wider
// than the column. A picture's width goes in its width="", a player's in its
// data-width (sizePlayer in content.js), and the post keeps either. The
// corners follow it while it's picked, however the words around it move it.
//
// setUpCorners(element, { picked, column, hidden, resized }) returns
// { follow }. element is the editor (the corners go inside it), picked() is
// what's picked, column() is the widest it can be, hidden() says when to hide
// the corners (the HTML view) and resized(item) is called when a drag ends.
// Call follow() after something new is picked.

import { sizePlayer } from "../content.js";
import { el } from "../util.js";

const LEAST_PICTURE = 32;   // smallest a picture can be dragged, in pixels
const LEAST_PLAYER = 240;   // a player is no use any smaller

export function setUpCorners(element, { picked, column, hidden, resized }) {
  const corners = ["nw", "ne", "sw", "se"].map((corner) => el("span", { class: `resizer__handle resizer__handle--${corner}`, "data-corner": corner }));
  const resizer = el("div", { class: "resizer", hidden: true, "aria-hidden": "true" }, corners);
  element.append(resizer);

  let following = 0;
  function follow() {
    cancelAnimationFrame(following);
    const item = picked();
    if (!item?.isConnected || hidden() || item.matches("hr")) {
      resizer.hidden = true;
      return;
    }
    const box = element.getBoundingClientRect();
    const at = item.getBoundingClientRect();
    resizer.hidden = false;
    resizer.style.left = `${at.left - box.left - element.clientLeft}px`;
    resizer.style.top = `${at.top - box.top - element.clientTop}px`;
    resizer.style.width = `${at.width}px`;
    resizer.style.height = `${at.height}px`;
    following = requestAnimationFrame(follow);
  }

  // Dragging a corner away from the middle makes it bigger. Moving across
  // sets the size, and so does moving up or down for something that keeps its
  // shape (a picture, a video), whichever goes further. The pointer is
  // captured, so the drag keeps working even over a player's video.
  resizer.addEventListener("pointerdown", (e) => {
    const corner = e.target.dataset?.corner;
    const item = picked();
    if (!corner || !item) return;
    e.preventDefault();
    const handle = e.target;
    handle.setPointerCapture(e.pointerId);
    const start = item.getBoundingClientRect();
    const isPicture = item.matches("img");
    const keepsShape = isPicture || item.matches(".embed--video, .embed--tall, .embed--file");
    const most = column();
    const least = Math.min(isPicture ? LEAST_PICTURE : LEAST_PLAYER, most);
    const outX = corner.endsWith("e") ? 1 : -1;
    const outY = corner.startsWith("s") ? 1 : -1;
    const moved = (move) => {
      const across = outX * (move.clientX - e.clientX);
      const down = keepsShape ? outY * (move.clientY - e.clientY) * (start.width / start.height) : 0;
      const width = Math.round(Math.min(most, Math.max(least, start.width + (Math.abs(across) >= Math.abs(down) ? across : down))));
      if (isPicture) item.setAttribute("width", width);
      else sizePlayer(item, width);
    };
    const done = () => {
      handle.removeEventListener("pointermove", moved);
      handle.removeEventListener("pointerup", done);
      handle.removeEventListener("pointercancel", done);
      resized(item);
    };
    handle.addEventListener("pointermove", moved);
    handle.addEventListener("pointerup", done);
    handle.addEventListener("pointercancel", done);
  });

  return { follow };
}
