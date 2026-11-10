// XP's menus, both the right-click kind and the ones that drop down from a
// window's menu bar. The pointer, arrow keys, Enter and Esc all work like
// XP. Pressing anywhere else, or leaving the page, closes them. Their look
// is .menu in css/xp.css.
//
// showMenu(entries, at) puts one up at a point in this page ({ x, y }) or
// under an element ({ below: el }). An entry is "-" for a rule, or an object
// with any of these.
//   label     its text
//   action    runs once the menu is gone
//   disabled  grayed out
//   bold      the default, what a double-click would do
//   checked   XP's tick beside it
//   radio     XP's dot, for one of a set (View's Thumbnails, Icons, Details)
//   keys      its shortcut, written beside it ("Ctrl+S")
//   icon      a picture beside it
//   submenu   more entries, opening to the side (New, Arrange Icons By)
//
// menuBar(bar, menus) makes a window's menu bar from [{ label, items }],
// where items() gives a menu's entries each time it opens. Once one is open,
// pointing at another opens that one instead, and Left and Right move
// between them, like XP.

let current = null;   // the menu that's up, as { close }

export function closeMenu() {
  current?.close();
}

// Options:
//   onClose()          runs when it's gone, however it went
//   onSide(direction)  Left or Right past its own edge (to a menu bar's
//                      neighbors)
//   first              start with the first entry picked, as the keyboard
//                      opens one
//   keep               an element where a press doesn't count as outside
//                      (the menu bar it came from)
export function showMenu(entries, at, { onClose, onSide, first = false, keep = null } = {}) {
  closeMenu();
  const levels = [];   // the menu, then each submenu open from it, in order
  const hadFocus = document.activeElement;

  function build(list, depth) {
    const menu = document.createElement("ul");
    menu.className = "menu menu--pop";
    menu.setAttribute("role", "menu");
    menu.tabIndex = -1;
    const level = { menu, items: [], active: null, depth, sub: null, from: null };
    for (const entry of list) {
      if (entry === "-") {
        const rule = document.createElement("li");
        rule.className = "menu__rule";
        rule.setAttribute("role", "separator");
        menu.append(rule);
      } else {
        menu.append(row(level, entry));
      }
    }
    menu.addEventListener("pointerleave", () => {
      if (!level.sub) pick(level, null);
    });
    menu.addEventListener("keydown", keys);
    menu.addEventListener("contextmenu", (e) => e.preventDefault());
    document.body.append(menu);
    levels.push(level);
    return level;
  }

  function row(level, entry) {
    const li = document.createElement("li");
    li.setAttribute("role", "none");
    const button = document.createElement("button");
    button.className = "menu__item";
    button.type = "button";
    button.tabIndex = -1;
    button.disabled = Boolean(entry.disabled);
    button.classList.toggle("is-default", Boolean(entry.bold));
    const ticked = entry.checked ?? entry.radio;
    button.setAttribute("role", entry.checked !== undefined ? "menuitemcheckbox" : entry.radio !== undefined ? "menuitemradio" : "menuitem");
    if (ticked !== undefined) button.setAttribute("aria-checked", String(Boolean(ticked)));

    const mark = document.createElement("span");
    mark.className = "menu__mark";
    if (entry.icon) {
      const img = document.createElement("img");
      img.src = entry.icon;
      img.alt = "";
      mark.append(img);
    } else if (entry.checked) {
      mark.classList.add("menu__mark--check");
    } else if (entry.radio) {
      mark.classList.add("menu__mark--radio");
    }
    const label = document.createElement("span");
    label.className = "menu__label";
    label.textContent = entry.label;
    button.append(mark, label);
    if (entry.keys) {
      const keys = document.createElement("span");
      keys.className = "menu__keys";
      keys.textContent = entry.keys;
      button.append(keys);
    }
    if (entry.submenu) {
      button.classList.add("menu__item--sub");
      button.setAttribute("aria-haspopup", "menu");
      button.setAttribute("aria-expanded", "false");
    }

    const item = { entry, button };
    level.items.push(item);
    button.addEventListener("pointerenter", () => {
      pick(level, item);
      if (entry.submenu && !button.disabled) openSub(level, item);
      else closeSub(level);
    });
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      if (button.disabled) return;
      if (entry.submenu) openSub(level, item, true);
      else finish(entry.action);
    });
    li.append(button);
    return li;
  }

  function pick(level, item) {
    for (const one of level.items) one.button.classList.toggle("is-active", one === item);
    level.active = item;
  }

  // Picks the next enabled entry, down (1) or up (-1), wrapping around.
  function step(level, direction) {
    const usable = level.items.filter((item) => !item.button.disabled);
    if (!usable.length) return;
    const at = usable.indexOf(level.active);
    pick(level, at === -1 ? (direction > 0 ? usable[0] : usable.at(-1)) : usable[(at + direction + usable.length) % usable.length]);
  }

  function openSub(level, item, startFirst = false) {
    if (level.sub?.from !== item) {
      closeSub(level);
      const sub = build(item.entry.submenu, level.depth + 1);
      sub.from = item;
      level.sub = sub;
      item.button.setAttribute("aria-expanded", "true");
      const row = item.button.getBoundingClientRect();
      const box = level.menu.getBoundingClientRect();
      place(sub.menu, box.right, row.top, box.left);
    }
    if (startFirst) {
      step(level.sub, 1);
      level.sub.menu.focus();
    }
  }

  function closeSub(level) {
    if (!level.sub) return;
    closeSub(level.sub);
    level.sub.from.button.setAttribute("aria-expanded", "false");
    level.sub.menu.remove();
    levels.splice(levels.indexOf(level.sub), 1);
    level.sub = null;
    level.menu.focus();
  }

  // Puts the menu at (x, y). Where it wouldn't fit it goes the other way,
  // left of x (or of flipX, a submenu's parent's left edge) and up.
  function place(menu, x, y, flipX = x) {
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    let left = x + w > innerWidth ? flipX - w : x;
    let top = y + h > innerHeight ? innerHeight - h : y;
    left = Math.max(0, Math.min(left, innerWidth - w));
    top = Math.max(0, top);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }

  function keys(e) {
    const level = levels.at(-1);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      step(level, e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "ArrowRight") {
      if (level.active?.entry.submenu && !level.active.button.disabled) openSub(level, level.active, true);
      else onSide?.(1);
    } else if (e.key === "ArrowLeft") {
      if (level.depth > 0) closeSub(levels.at(-2));
      else onSide?.(-1);
    } else if (e.key === "Enter" || e.key === " ") {
      level.active?.button.click();
    } else if (e.key === "Escape") {
      if (level.depth > 0) closeSub(levels.at(-2));
      else finish();
    } else if (e.key === "Tab") {
      finish();
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  function close() {
    if (current !== handle) return;
    current = null;
    for (const level of levels) level.menu.remove();
    levels.length = 0;
    document.removeEventListener("pointerdown", outside, true);
    removeEventListener("blur", close);
    removeEventListener("resize", close);
    onClose?.();
  }

  // Closes, puts focus back where it was, then runs whatever was picked.
  function finish(action) {
    close();
    if (hadFocus?.isConnected) hadFocus.focus?.();
    action?.();
  }

  function outside(e) {
    if (!levels.some((level) => level.menu.contains(e.target)) && !keep?.contains(e.target)) close();
  }

  const handle = { close };
  current = handle;
  const root = build(entries, 0);
  if (at.below) {
    const r = at.below.getBoundingClientRect();
    place(root.menu, r.left, r.bottom);
  } else {
    place(root.menu, at.x, at.y);
  }
  if (first) step(root, 1);
  root.menu.focus();

  // Wait a tick, so the press that opened it doesn't count as outside.
  setTimeout(() => {
    if (current !== handle) return;
    document.addEventListener("pointerdown", outside, true);
    addEventListener("blur", close);
    addEventListener("resize", close);
  });
  return handle;
}

export function menuBar(bar, menus) {
  let openAt = -1;
  const buttons = menus.map((menu, index) => {
    const button = document.createElement("button");
    button.className = "menu-bar__item";
    button.type = "button";
    button.textContent = menu.label;
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      if (openAt === index) closeMenu();
      else open(index);
    });
    button.addEventListener("pointerenter", () => {
      if (openAt !== -1 && openAt !== index) open(index);
    });
    button.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " " && e.key !== "ArrowDown") return;
      e.preventDefault();
      open(index, true);
    });
    bar.append(button);
    return button;
  });

  function open(index, first = false) {
    openAt = index;
    buttons.forEach((button, i) => button.setAttribute("aria-expanded", String(i === index)));
    showMenu(menus[index].items(), { below: buttons[index] }, {
      first,
      keep: bar,
      onClose: () => {
        if (openAt !== index) return;
        openAt = -1;
        buttons[index].setAttribute("aria-expanded", "false");
      },
      onSide: (direction) => open((index + direction + buttons.length) % buttons.length, true),
    });
  }
}
