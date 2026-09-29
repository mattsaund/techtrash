// techtrash.org : the icons on the desktop.
//
// Anyone can move them, and everyone sees it happen (js/shared.js). They sit
// on a grid, like XP's desktop with Align to Grid on: an icon follows the
// pointer while it's dragged, and when it's let go it snaps to the nearest
// cell, or the nearest free one if another icon is already there.
//
// Cells are counted from the top left (js/grid.js), so the desktop reads the
// same on every screen. A screen too small to have an icon's cell shows it in
// the nearest free cell it does have, without moving it for anyone else.
//
// XP's ways, all of them: a click selects, Ctrl+click adds or takes away, a
// drag across the bare desktop draws a selection rectangle, dragging any
// selected icon moves every selected one, and a double-click opens. A tap
// opens straight away, and so does Enter.

import { ON_DESKTOP } from "./apps.js";
import { share } from "./shared.js";
import { cellKey, nearestFree, startingCells } from "./grid.js";

const css = getComputedStyle(document.documentElement);
const num = (name) => parseInt(css.getPropertyValue(name), 10);
const CELL = num("--icon-cell");   // a grid cell, both ways
const EDGE = num("--sp-8");        // from the desktop's edge to the first cell
const DRAG = num("--drag");        // how far a press moves before it's a drag

const clamp = (n, low, high) => Math.min(high, Math.max(low, n));

export function setUpIcons({ layer, open, onBareDesktop }) {
  const start = startingCells(ON_DESKTOP.map((app) => app.id), new Map());
  const icons = [];
  const byId = new Map();
  const selected = new Set();
  let moving = null;   // the icons being dragged here right now

  for (const app of ON_DESKTOP) {
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

    // home: the cell it's saved in. cell: the cell it's shown in, which is
    // home unless this screen is too small for it. float: where it is while
    // someone else drags it, in cells but not whole ones.
    const icon = { app, el, img, label, home: start.get(app.id), cell: null, float: null };
    icons.push(icon);
    byId.set(app.id, icon);
    wire(icon);
  }

  // --- the grid ------------------------------------------------------------

  function size() {
    return {
      columns: Math.max(1, Math.floor((layer.clientWidth - 2 * EDGE) / CELL)),
      rows: Math.max(1, Math.floor((layer.clientHeight - 2 * EDGE) / CELL)),
    };
  }

  function put(icon, x, y) {
    icon.el.style.left = `${Math.round(clamp(x, 0, layer.clientWidth - icon.el.offsetWidth))}px`;
    icon.el.style.top = `${Math.round(clamp(y, 0, layer.clientHeight - icon.el.offsetHeight))}px`;
  }

  const toPixels = ([column, row]) => [EDGE + column * CELL, EDGE + row * CELL];
  const toCells = (x, y) => [Math.round(((x - EDGE) / CELL) * 100) / 100, Math.round(((y - EDGE) / CELL) * 100) / 100];

  // Every icon into its cell. Icons whose cell this screen has go first, so
  // an icon squeezed in from off the edge never takes one of theirs. Icons
  // being dragged, here or anywhere, hold no cell until they're dropped.
  function arrange() {
    const { columns, rows } = size();
    const fits = (icon) => icon.home[0] < columns && icon.home[1] < rows;
    const taken = new Set();
    for (const icon of [...icons].sort((a, b) => fits(b) - fits(a))) {
      if (moving?.has(icon)) continue;
      if (icon.float) {
        put(icon, ...toPixels(icon.float));
        continue;
      }
      let cell = [Math.min(icon.home[0], columns - 1), Math.min(icon.home[1], rows - 1)];
      if (taken.has(cellKey(cell))) cell = nearestFree(cell, taken, columns, rows) ?? cell;
      taken.add(cellKey(cell));
      icon.cell = cell;
      put(icon, ...toPixels(cell));
    }
  }

  arrange();
  addEventListener("resize", arrange);
  document.fonts?.ready.then(arrange);

  // --- the shared desktop -------------------------------------------------

  // Icons being dragged here ignore what the server says until they're let
  // go: the drop settles it.
  function update(state, how) {
    for (const [id, at] of Object.entries(state)) {
      const icon = byId.get(id);
      if (!icon || moving?.has(icon)) continue;
      if (how === "float") {
        icon.float = at;
      } else {
        icon.home = at;
        icon.float = null;
      }
    }
    arrange();
  }

  const line = share({
    onDesktop: (state) => update(state, "home"),
    onMove: (state) => update(state, "float"),
    onPlace: (state) => update(state, "home"),
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

  // --- one icon: select, drag, drop, open ------------------------------------

  // Snaps what was dragged to the grid: the icon under the pointer first,
  // then the rest, each to its nearest cell or the nearest free one. The
  // cells they left count as free.
  function drop(grabbed) {
    const { columns, rows } = size();
    const staying = icons.filter((icon) => !moving.has(icon) && !icon.float && icon.cell);
    const taken = new Set(staying.map((icon) => cellKey(icon.cell)));
    const placed = {};
    for (const icon of [grabbed, ...[...moving].filter((one) => one !== grabbed)]) {
      const [x, y] = [icon.el.offsetLeft, icon.el.offsetTop];
      let cell = [
        clamp(Math.round((x - EDGE) / CELL), 0, columns - 1),
        clamp(Math.round((y - EDGE) / CELL), 0, rows - 1),
      ];
      if (taken.has(cellKey(cell))) cell = nearestFree(cell, taken, columns, rows) ?? cell;
      taken.add(cellKey(cell));
      icon.home = cell;
      placed[icon.app.id] = cell;
    }
    moving = null;
    line.drop(placed);
    arrange();
  }

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
          group = [...selected].map((one) => ({ one, x: one.el.offsetLeft, y: one.el.offsetTop }));
          moving = new Set(group.map(({ one }) => one));
        }
        const where = {};
        for (const { one, x, y } of group) {
          put(one, x + dx, y + dy);
          where[one.app.id] = toCells(one.el.offsetLeft, one.el.offsetTop);
        }
        line.move(where);
      }, () => {
        if (!group) return;
        dragged = true;
        drop(icon);
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
