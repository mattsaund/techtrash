// techtrash.org : the icons on the desktop.
//
// Anyone can move them, and everyone sees it happen (js/shared.js). Where an
// icon sits is kept as a fraction of the room it has to move in, so the
// arrangement holds on any screen, and turned into whole pixels here. An icon
// nobody has moved yet sits in XP's column down the left.
//
// XP's ways, all of them: a click selects, Ctrl+click adds or takes away, a
// drag across the bare desktop draws a selection rectangle, dragging any
// selected icon moves every selected one, and a double-click opens. A tap
// opens straight away, and so does Enter.

import { APPS } from "./apps.js";
import { share } from "./shared.js";

const css = getComputedStyle(document.documentElement);
const num = (name) => parseInt(css.getPropertyValue(name), 10);
const CELL = num("--icon-cell");   // an icon's width, and the step down XP's column
const EDGE = num("--sp-8");        // how close an icon comes to the desktop's edge
const DRAG = num("--drag");        // how far a press moves before it's a drag

const clamp = (n, low, high) => Math.min(high, Math.max(low, n));

export function setUpIcons({ layer, open, onBareDesktop }) {
  const icons = [];
  const byId = new Map();
  const selected = new Set();
  let moving = null;   // the icons being dragged here right now, which the server mustn't move

  APPS.filter((app) => app.kind === "page").forEach((app, slot) => {
    const el = document.createElement("a");
    el.className = "icon";
    el.href = `#${app.id}`;
    el.draggable = false;
    const img = document.createElement("img");
    img.className = "icon__img";
    img.src = app.icon;
    img.alt = "";
    img.draggable = false;
    const label = document.createElement("span");
    label.className = "icon__label";
    label.textContent = app.title;
    el.append(img, label);
    layer.append(el);

    const icon = { app, el, img, label, slot, at: null };
    icons.push(icon);
    byId.set(app.id, icon);
    wire(icon);
    place(icon);
  });

  // --- where things are ----------------------------------------------------

  function room(icon) {
    return {
      w: Math.max(0, layer.clientWidth - 2 * EDGE - icon.el.offsetWidth),
      h: Math.max(0, layer.clientHeight - 2 * EDGE - icon.el.offsetHeight),
    };
  }

  function pixels(icon) {
    if (!icon.at) {
      const rows = Math.max(1, Math.floor((layer.clientHeight - 2 * EDGE) / CELL));
      return { x: EDGE + Math.floor(icon.slot / rows) * CELL, y: EDGE + (icon.slot % rows) * CELL };
    }
    const { w, h } = room(icon);
    return { x: EDGE + Math.round(icon.at[0] * w), y: EDGE + Math.round(icon.at[1] * h) };
  }

  function place(icon) {
    const { x, y } = pixels(icon);
    icon.el.style.left = `${x}px`;
    icon.el.style.top = `${y}px`;
  }

  function moveTo(icon, x, y) {
    const { w, h } = room(icon);
    const fraction = (n, of) => (of > 0 ? Math.round(clamp((n - EDGE) / of, 0, 1) * 10000) / 10000 : 0);
    icon.at = [fraction(x, w), fraction(y, h)];
    place(icon);
  }

  const positions = (list) => Object.fromEntries(list.map((icon) => [icon.app.id, icon.at]));

  addEventListener("resize", () => icons.forEach(place));
  document.fonts?.ready.then(() => icons.forEach(place));

  // --- the shared desktop -------------------------------------------------

  const line = share({
    onDesktop(state) {
      for (const icon of icons) {
        if (moving?.has(icon)) continue;
        icon.at = state[icon.app.id] ?? null;
        place(icon);
      }
    },
    onMove(state) {
      for (const [id, at] of Object.entries(state)) {
        const icon = byId.get(id);
        if (!icon || moving?.has(icon)) continue;
        icon.at = at;
        place(icon);
      }
    },
  });

  // --- selecting -----------------------------------------------------------

  function paint() {
    for (const icon of icons) icon.el.classList.toggle("is-selected", selected.has(icon));
  }

  function selectOnly(icon) {
    selected.clear();
    if (icon) selected.add(icon);
    paint();
  }

  // The rectangle takes whatever it touches, picture or label. With Ctrl
  // held it flips those instead, keeping everything else as it was.
  layer.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target !== layer) return;
    onBareDesktop();
    const flipping = e.ctrlKey || e.metaKey;
    const before = flipping ? new Set(selected) : new Set();
    if (!flipping) selectOnly(null);
    const box = layer.getBoundingClientRect();
    const from = { x: e.clientX - box.left, y: e.clientY - box.top };
    let marquee = null;

    track(layer, e, (move) => {
      const x = clamp(move.clientX - box.left, 0, box.width);
      const y = clamp(move.clientY - box.top, 0, box.height);
      if (!marquee) {
        if (Math.hypot(x - from.x, y - from.y) < DRAG) return;
        marquee = document.createElement("div");
        marquee.className = "marquee";
        layer.append(marquee);
      }
      const r = {
        left: Math.round(Math.min(x, from.x)),
        top: Math.round(Math.min(y, from.y)),
        right: Math.round(Math.max(x, from.x)),
        bottom: Math.round(Math.max(y, from.y)),
      };
      Object.assign(marquee.style, {
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.right - r.left}px`,
        height: `${r.bottom - r.top}px`,
      });
      selected.clear();
      for (const icon of icons) {
        const hit = [icon.img, icon.label].some((part) => {
          const left = icon.el.offsetLeft + part.offsetLeft;
          const top = icon.el.offsetTop + part.offsetTop;
          return left < r.right && left + part.offsetWidth > r.left && top < r.bottom && top + part.offsetHeight > r.top;
        });
        if (before.has(icon) !== hit) selected.add(icon);
      }
      paint();
    }, () => marquee?.remove());
  });

  // --- one icon: select, drag, open ----------------------------------------

  function wire(icon) {
    const { el } = icon;
    let pointer = "mouse";
    let dragged = false;

    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      pointer = e.pointerType;
      dragged = false;
      if (!e.ctrlKey && !e.metaKey && !selected.has(icon)) selectOnly(icon);
      let group = null;

      track(el, e, (move) => {
        const dx = Math.round(move.clientX - e.clientX);
        const dy = Math.round(move.clientY - e.clientY);
        if (!group) {
          if (Math.hypot(dx, dy) < DRAG) return;
          selected.add(icon);
          paint();
          group = [...selected].map((one) => ({ one, from: pixels(one) }));
          moving = new Set(group.map(({ one }) => one));
        }
        for (const { one, from } of group) moveTo(one, from.x + dx, from.y + dy);
        line.move(positions([...moving]));
      }, () => {
        if (!group) return;
        dragged = true;
        line.drop(positions([...moving]));
        moving = null;
      });
    });

    el.addEventListener("click", (e) => {
      e.preventDefault();
      if (dragged) {
        dragged = false;
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        if (selected.has(icon)) selected.delete(icon);
        else selected.add(icon);
        paint();
        return;
      }
      selectOnly(icon);
      if (e.detail !== 1 || pointer !== "mouse") open(icon.app.id);
    });
  }
}

// Follow one press from pointerdown to pointerup on the element that got it.
function track(el, down, onMove, onEnd) {
  el.setPointerCapture(down.pointerId);
  const end = () => {
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", end);
    el.removeEventListener("pointercancel", end);
    onEnd();
  };
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}
