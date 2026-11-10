// The icons on the desktop, which are what's in the shared disk's Desktop
// folder (js/disk.js). Anyone can move them, and everyone sees it happen
// (js/shared.js). Like XP's desktop with Align to Grid on, a dragged icon
// follows the pointer, then snaps to the nearest free cell when it's let go.
//
// Cells count from the top left (js/grid.js), so the desktop looks the same
// on every screen. A screen too small for an icon's cell shows it in the
// nearest free cell it does have, without moving it for anyone else.
//
// It all works like XP. A click selects, Ctrl+click adds or takes away, a
// drag across the bare desktop draws a selection rectangle, dragging a
// selected icon moves every selected one, and a double-click opens. A tap or
// Enter opens straight away. Delete asks, then throws away (Shift+Delete
// deletes for good, for the admin). F2 renames in place. Right-click brings
// up an icon's menu (Open, Cut, Delete, Rename) or the desktop's (Arrange
// Icons By, Paste, New, Properties).
//
// Icons dropped on the Recycle Bin are thrown away, and icons dropped on a
// folder go into it. Either one lights up while they're over it, like XP.
// What can't go (the blog, for anyone but the admin) gets XP's error and goes
// back where it was, for everyone.

import { FIRST_SHORTCUTS, findApp, firstShortcutsFirst } from "./apps.js";
import { disk } from "./disk.js";
import { cellKey, nearestFree, nextFreeCell } from "./grid.js";
import { DRAGGED, editor, iconOf, isFolder, isPicture, isShortcut, nameParts, opener, renamable } from "./items.js";
import { showMenu } from "./menu.js";
import { line } from "./shared.js";
import { clipboard, deleteItems, emptyBin, makeNew, movable, moveItems, renameItem, saveFromComputer, setAsWallpaper, throwAway } from "./tasks.js";

const css = getComputedStyle(document.documentElement);
const num = (name) => parseInt(css.getPropertyValue(name), 10);
const CELL = num("--icon-cell");   // a grid cell, both ways
const EDGE = num("--sp-8");        // from the desktop's edge to the first cell
const DRAG = num("--drag");        // how far a press moves before it's a drag

const clamp = (n, low, high) => Math.min(high, Math.max(low, n));

// The shortcuts the desktop starts with. They're all there is until the disk
// arrives (or for good, offline).
const STARTING = FIRST_SHORTCUTS.map((id) => ({ id, parent: "desktop", name: findApp(id).title, kind: "app", type: id, created: 0, modified: 0 }));

const isBin = (item) => isShortcut(item) && Boolean(findApp(item.type)?.bin);

export function setUpIcons({ layer, openItem, openApp, onBareDesktop }) {
  const icons = new Map();      // by item id
  const cells = new Map();      // the cell the server has for each, by id
  const selected = new Set();
  let moving = null;            // the icons this tab is dragging right now
  let renaming = null;          // { icon, cancel } while one is being renamed
  let arrived = false;          // has the whole disk come?

  layer.tabIndex = -1;

  // --- what's on the desktop -----------------------------------------------

  const order = (items) => [...items].sort((a, b) => firstShortcutsFirst(a, b) || a.created - b.created);

  function make(item) {
    const el = document.createElement("a");
    el.className = "icon";
    el.draggable = false;
    const img = document.createElement("img");
    img.className = "icon__img";
    img.alt = "";
    img.draggable = false;
    const label = document.createElement("span");
    label.className = "icon__label";
    el.append(img, label);
    layer.append(el);
    //   home   the cell it's saved in
    //   cell   the cell it's shown in, which is home unless this screen is
    //          too small for it
    //   float  where it is while someone else drags it, in cells but not
    //          whole ones
    const icon = { item, el, img, label, home: null, cell: null, float: null };
    wire(icon);
    return icon;
  }

  // Catches the icons up with the disk. New ones go in the cell the server
  // gave them. Until it says, that's the next free one down XP's columns,
  // which is what it'll give anyway. Gone ones are taken away, and every
  // name, picture and link is brought up to date.
  function sync() {
    const items = arrived ? disk.children("desktop") : STARTING;
    const here = new Set(items.map((item) => item.id));
    for (const [id, icon] of icons) {
      if (here.has(id)) continue;
      if (renaming?.icon === icon) renaming.cancel();
      icon.el.remove();
      icons.delete(id);
      cells.delete(id);
      selected.delete(icon);
      moving?.delete(icon);
    }
    const taken = new Set([...icons.values()].map((icon) => cellKey(icon.home)));
    const binFull = disk.binFull();
    const cut = new Set(clipboard.ids());
    for (const item of order(items)) {
      let icon = icons.get(item.id);
      if (!icon) {
        icon = make(item);
        icons.set(item.id, icon);
        icon.home = cells.get(item.id) ?? nextFreeCell(taken);
        taken.add(cellKey(icon.home));
      }
      icon.item = item;
      const { app, rest } = opener(item);
      const src = iconOf(item, binFull);
      const href = `#${app}${rest ? `/${rest}` : ""}`;
      // only what changed, so nothing reloads or redraws for nothing
      if (icon.label.textContent !== item.name) icon.label.textContent = item.name;
      if (icon.img.getAttribute("src") !== src) icon.img.src = src;
      if (icon.el.getAttribute("href") !== href) icon.el.href = href;
      icon.el.classList.toggle("is-cut", cut.has(item.id));
    }
    paint();
    arrange();
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

  // Puts every icon in its cell. Icons whose cell fits on this screen go
  // first, so one squeezed in from off the edge never takes their place.
  // Icons being dragged, here or anywhere, hold no cell until they're dropped.
  function arrange() {
    const { columns, rows } = size();
    const fits = (icon) => icon.home[0] < columns && icon.home[1] < rows;
    const taken = new Set();
    for (const icon of [...icons.values()].sort((a, b) => fits(b) - fits(a))) {
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

  addEventListener("resize", arrange);
  document.fonts?.ready.then(arrange);

  // --- the shared desktop's cells ------------------------------------------

  // Icons this tab is dragging ignore what the server says until they're let
  // go. The drop settles it.
  function update(state, how) {
    for (const [id, at] of Object.entries(state)) {
      if (how !== "float") cells.set(id, at);
      const icon = icons.get(id);
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

  line.on("desktop", (message) => {
    cells.clear();
    update(message.icons, "home");
  });
  line.on("place", (message) => update(message.icons, "home"));
  line.on("move", (message) => update(message.icons, "float"));

  // --- selecting -----------------------------------------------------------

  function paint() {
    for (const icon of icons.values()) icon.el.classList.toggle("is-selected", selected.has(icon));
  }

  function selectOnly(icon) {
    selected.clear();
    if (icon) selected.add(icon);
    paint();
  }

  const chosen = () => [...selected].map((icon) => icon.item);

  // The selection rectangle takes any icon whose picture or label it touches.
  // With Ctrl held it flips those instead and leaves the rest as they were.
  layer.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target !== layer) return;
    onBareDesktop();
    layer.focus({ preventScroll: true });
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
      for (const icon of icons.values()) {
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

  // --- dragging and dropping -----------------------------------------------

  // Snaps what was dragged to the grid, the icon under the pointer first,
  // each to its nearest free cell. The cells they left count as free.
  function drop(grabbed) {
    const { columns, rows } = size();
    const staying = [...icons.values()].filter((icon) => !moving.has(icon) && !icon.float && icon.cell);
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
      placed[icon.item.id] = cell;
    }
    moving = null;
    line.drop(placed);
    arrange();
  }

  // The Recycle Bin or folder that would take the icons if they were let go
  // here, never one of the icons being dragged.
  function targetAt(x, y) {
    for (const icon of icons.values()) {
      if (moving?.has(icon) || !(isBin(icon.item) || isFolder(icon.item))) continue;
      const r = icon.el.getBoundingClientRect();
      if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return icon;
    }
    return null;
  }

  // Let go on the bin or a folder. Everything dragged goes back to its cell
  // for now (for everyone else too), then leaves the desktop once the server
  // says so. If it says no, XP's error says why and they stay where they were.
  function dropInto(target) {
    const back = {};
    for (const icon of moving) back[icon.item.id] = icon.home;
    const items = [...moving].map((icon) => icon.item);
    moving = null;
    target.el.classList.remove("is-target");
    line.drop(back);
    arrange();
    if (isBin(target.item)) throwAway(items);
    else moveItems(items, target.item.id);
  }

  function wire(icon) {
    const { el } = icon;
    let pointer = "mouse";
    let dragged = false;

    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || renaming?.icon === icon) return;
      pointer = e.pointerType;
      dragged = false;
      if (!e.ctrlKey && !e.metaKey && !selected.has(icon)) selectOnly(icon);
      let group = null;
      let target = null;

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
          where[one.item.id] = toCells(one.el.offsetLeft, one.el.offsetTop);
        }
        line.move(where);
        const now = targetAt(move.clientX, move.clientY);
        if (now !== target) {
          target?.el.classList.remove("is-target");
          now?.el.classList.add("is-target");
          target = now;
        }
      }, () => {
        if (!group) return;
        dragged = true;
        if (target) dropInto(target);
        else drop(icon);
      });
    });

    el.addEventListener("click", (e) => {
      e.preventDefault();
      if (renaming?.icon === icon) return;
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
      if (e.detail !== 1 || pointer !== "mouse") openItem(icon.item);
    });

    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (renaming) return;
      if (!selected.has(icon)) selectOnly(icon);
      showMenu(iconMenu(icon), { x: e.clientX, y: e.clientY });
    });
  }

  // --- dropped in from elsewhere -------------------------------------------
  //
  // Items from a File Browser go into the desktop's folder, the Recycle Bin
  // or a folder, wherever they're dropped. Files from your own computer are
  // saved there for everyone (js/tasks.js says which kinds).

  const carrying = (e) => e.dataTransfer.types.includes(DRAGGED) || e.dataTransfer.types.includes("Files");
  let lit = null;
  const light = (icon) => {
    if (lit === icon) return;
    lit?.el.classList.remove("is-target");
    icon?.el.classList.add("is-target");
    lit = icon;
  };

  layer.addEventListener("dragover", (e) => {
    if (!carrying(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes("Files") ? "copy" : "move";
    light(targetAt(e.clientX, e.clientY));
  });
  layer.addEventListener("dragleave", (e) => {
    if (!layer.contains(e.relatedTarget)) light(null);
  });
  layer.addEventListener("drop", (e) => {
    if (!carrying(e)) return;
    e.preventDefault();
    const target = targetAt(e.clientX, e.clientY);
    light(null);
    const into = target ? (isBin(target.item) ? "recycle" : target.item.id) : "desktop";
    if (e.dataTransfer.types.includes(DRAGGED)) {
      const items = JSON.parse(e.dataTransfer.getData(DRAGGED) || "[]").map((id) => disk.item(id)).filter(Boolean);
      if (into === "recycle") throwAway(items);
      else moveItems(items, into);
    } else if (into !== "recycle") {
      saveFromComputer([...e.dataTransfer.files], into);
    }
  });

  // --- menus ---------------------------------------------------------------

  const XP = "/img/icons/xp";

  // An icon's menu, for everything selected.
  function iconMenu(icon) {
    const items = chosen();
    const single = items.length === 1 ? items[0] : null;
    const entries = [{ label: "Open", bold: true, action: () => items.forEach(openItem) }];
    if (single && isBin(single)) entries.push({ label: "Empty Recycle Bin", disabled: !disk.binFull(), action: emptyBin });
    const edit = single && editor(single);
    if (edit) entries.push({ label: "Edit", action: () => window.desktop.open(edit.app, edit.rest) });
    if (single && isPicture(single)) entries.push("-", { label: "Set as Desktop Background", action: () => setAsWallpaper(single) });
    entries.push(
      "-",
      { label: "Cut", disabled: !items.some((item) => movable(item) && !isBin(item)), action: () => clipboard.cut(items.filter((item) => !isBin(item))) },
      "-",
      { label: "Delete", disabled: items.every(isBin), action: () => deleteSelected() },
      { label: "Rename", disabled: !renamable(single), action: () => startRename(icon) },
    );
    return entries;
  }

  // The desktop's own menu.
  function desktopMenu() {
    const by = (label, key) => ({ label, action: () => arrangeBy(key) });
    return [
      { label: "Arrange Icons By", submenu: [by("Name", "name"), by("Size", "size"), by("Type", "type"), by("Modified", "modified")] },
      { label: "Refresh", action: sync },
      "-",
      { label: "Paste", disabled: !clipboard.has(), action: () => clipboard.paste("desktop") },
      "-",
      { label: "New", submenu: [
        { label: "Folder", icon: `${XP}/folder.png`, action: () => makeAndRename("folder") },
        "-",
        { label: "Text Document", icon: `${XP}/text-document.png`, action: () => makeAndRename("text") },
      ] },
      "-",
      { label: "Properties", action: () => openApp("display") },
    ];
  }

  layer.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (e.target !== layer || renaming) return;
    onBareDesktop();
    selectOnly(null);
    showMenu(desktopMenu(), { x: e.clientX, y: e.clientY });
  });

  // Lines every icon up down XP's columns again, in this order, for
  // everyone. The desktop's own shortcuts stay first, as XP kept My Computer
  // and the Recycle Bin first.
  function arrangeBy(key) {
    const sorters = {
      name: (a, b) => a.name.localeCompare(b.name, "en-US", { numeric: true, sensitivity: "base" }),
      size: (a, b) => a.size - b.size,
      type: (a, b) => a.kind.localeCompare(b.kind) || a.type.localeCompare(b.type),
      modified: (a, b) => b.modified - a.modified,
    };
    const all = [...icons.values()].sort((a, b) => firstShortcutsFirst(a.item, b.item) || sorters[key](a.item, b.item));
    const taken = new Set();
    const placed = {};
    for (const icon of all) {
      const cell = nextFreeCell(taken);
      taken.add(cellKey(cell));
      icon.home = cell;
      placed[icon.item.id] = cell;
    }
    line.drop(placed);
    arrange();
  }

  async function makeAndRename(kind) {
    const item = await makeNew("desktop", kind);
    const icon = item && icons.get(item.id);
    if (icon) startRename(icon);
  }

  // --- the keyboard and renaming -------------------------------------------

  async function deleteSelected(shift = false) {
    const items = chosen().filter((item) => !isBin(item));
    if (items.length) await deleteItems(items, { forGood: shift && disk.admin });
  }

  layer.addEventListener("keydown", (e) => {
    if (renaming || e.altKey) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const items = chosen();
    if (e.key === "Enter" && items.length) {
      items.forEach(openItem);
    } else if (e.key === "Delete" && items.length) {
      deleteSelected(e.shiftKey);
    } else if (e.key === "F2" && items.length === 1 && renamable(items[0])) {
      startRename([...selected][0]);
    } else if (ctrl && e.key.toLowerCase() === "a") {
      icons.forEach((icon) => selected.add(icon));
      paint();
    } else if (ctrl && e.key.toLowerCase() === "x" && items.length) {
      clipboard.cut(items.filter((item) => !isBin(item)));
    } else if (ctrl && e.key.toLowerCase() === "v" && clipboard.has()) {
      clipboard.paste("desktop");
    } else {
      return;
    }
    e.preventDefault();
  });

  // XP's rename box, in place of the label, with the name selected but not a
  // file's extension. Enter or clicking away keeps the new name, Esc doesn't.
  function startRename(icon) {
    if (!icon || renaming) return;
    selectOnly(icon);
    const field = document.createElement("textarea");
    field.className = "icon__rename";
    field.value = icon.item.name;
    field.rows = 1;
    field.spellcheck = false;
    field.setAttribute("aria-label", "New name");
    icon.label.hidden = true;
    icon.el.classList.add("is-renaming");
    icon.el.append(field);
    const fit = () => {
      field.style.height = "0";
      field.style.height = `${field.scrollHeight}px`;
    };
    fit();
    field.focus();
    const keepEnd = isFolder(icon.item) || isShortcut(icon.item);
    field.setSelectionRange(0, keepEnd ? field.value.length : nameParts(icon.item.name)[0].length);

    let done = false;
    const end = (keep) => {
      if (done) return;
      done = true;
      const name = field.value;
      field.remove();
      icon.label.hidden = false;
      icon.el.classList.remove("is-renaming");
      renaming = null;
      if (icon.el.isConnected) icon.el.focus({ preventScroll: true });
      if (keep) renameItem(icon.item, name);
    };
    renaming = { icon, cancel: () => end(false) };
    field.addEventListener("input", fit);
    field.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        end(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        end(false);
      }
    });
    field.addEventListener("blur", () => end(true));
    // Presses in it stay in it. No drag, no opening, no following the link.
    for (const type of ["pointerdown", "click", "dblclick", "contextmenu"]) {
      field.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type !== "pointerdown") e.preventDefault();
      });
    }
  }

  disk.watch((change) => {
    if (change.settings) return;
    if (change.all) arrived = true;
    sync();
  });
  sync();

  return { refresh: sync };
}

// Follows one press from pointerdown to pointerup. The element captures the
// pointer, but the listeners are on the window, so a drag still ends if
// someone else deletes the icon mid-drag and it leaves the page.
function track(el, down, onMove, onEnd) {
  el.setPointerCapture(down.pointerId);
  const ours = (e) => e.pointerId === down.pointerId;
  const move = (e) => {
    if (ours(e)) onMove(e);
  };
  const end = (e) => {
    if (!ours(e)) return;
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", end);
    removeEventListener("pointercancel", end);
    onEnd();
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", end);
  addEventListener("pointercancel", end);
}
