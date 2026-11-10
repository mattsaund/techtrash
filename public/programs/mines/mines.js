// Mines. Open every tile that doesn't have a mine under it. A number says
// how many of the eight tiles around it do. Right-click (or long press) to
// flag a tile, and click a number whose mines are all flagged to open the
// rest around it. The first tile opened never has a mine.
//
// Game picks Beginner, Intermediate or Expert, and the window resizes to fit
// the field. Best times are kept in this browser.

import { menuBar } from "/js/menu.js";
import { showMessage } from "/js/message.js";

const desktop = window.top === window ? null : window.top.desktop;

const LEVELS = {
  beginner: { title: "Beginner", columns: 9, rows: 9, mines: 10 },
  intermediate: { title: "Intermediate", columns: 16, rows: 16, mines: 40 },
  expert: { title: "Expert", columns: 30, rows: 16, mines: 99 },
};
const KEY = "techtrash:mines";   // in localStorage: { level, best: { beginner: seconds... } }

const board = document.querySelector(".mines__board");
const left = document.querySelector("[data-left]");
const clock = document.querySelector("[data-time]");

let saved = load();
let level = LEVELS[saved.level] ? saved.level : "beginner";
let cells = [];        // { mine, open, flag, n, el }
let started = 0;       // when the first tile was opened, or 0
let timer = null;
let over = false;

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

function store() {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {}
}

// A counter's three digits: "007", or "-05" once more tiles are flagged than
// there are mines.
function three(n) {
  const held = Math.max(-99, Math.min(999, n));
  return held < 0 ? `-${String(-held).padStart(2, "0")}` : String(held).padStart(3, "0");
}
const seconds = () => (started ? Math.min(999, Math.floor((Date.now() - started) / 1000) + 1) : 0);

function neighbors(i) {
  const { columns, rows } = LEVELS[level];
  const x = i % columns;
  const y = Math.floor(i / columns);
  const around = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if ((dx || dy) && nx >= 0 && ny >= 0 && nx < columns && ny < rows) around.push(ny * columns + nx);
    }
  }
  return around;
}

function newGame(next = level) {
  level = next;
  saved.level = level;
  store();
  const { columns, rows } = LEVELS[level];
  clearInterval(timer);
  timer = null;
  started = 0;
  over = false;
  board.style.setProperty("--columns", columns);
  board.replaceChildren();
  cells = Array.from({ length: columns * rows }, (_, i) => {
    const el = document.createElement("button");
    el.className = "tile";
    el.type = "button";
    el.tabIndex = i === 0 ? 0 : -1;
    el.setAttribute("aria-label", `Tile ${(i % columns) + 1}, ${Math.floor(i / columns) + 1}`);
    el.dataset.i = i;
    board.append(el);
    return { mine: false, open: false, flag: false, n: 0, el };
  });
  draw();
  fit();
}

// Sizes the window to the field.
function fit() {
  const game = document.querySelector(".mines__game");
  const bar = document.querySelector(".menu-bar");
  desktop?.fit(window, game.offsetWidth, bar.offsetHeight + game.offsetHeight);
}

// Lays the mines once the first tile's opened, never on it or next to it.
function lay(first) {
  const keep = new Set([first, ...neighbors(first)]);
  const spots = cells.map((_, i) => i).filter((i) => !keep.has(i));
  for (let placed = 0; placed < LEVELS[level].mines; placed++) {
    const pick = placed + Math.floor(Math.random() * (spots.length - placed));
    [spots[placed], spots[pick]] = [spots[pick], spots[placed]];
    cells[spots[placed]].mine = true;
  }
  cells.forEach((cell, i) => {
    cell.n = neighbors(i).filter((j) => cells[j].mine).length;
  });
  started = Date.now();
  timer = setInterval(() => { clock.textContent = three(seconds()); }, 250);
}

function draw() {
  const flags = cells.filter((cell) => cell.flag).length;
  left.textContent = three(LEVELS[level].mines - flags);
  clock.textContent = three(seconds());
}

function paint(cell) {
  const { el } = cell;
  el.classList.toggle("is-open", cell.open);
  el.classList.toggle("is-flag", cell.flag && !cell.open);
  el.textContent = cell.open && !cell.mine && cell.n ? String(cell.n) : "";
  if (cell.open && cell.n) el.dataset.n = cell.n;
  el.setAttribute("aria-label", cell.flag ? "Flagged" : cell.open ? (cell.n ? String(cell.n) : "Empty") : "Hidden");
}

// Opens a tile and spreads out from any empty one. Returns false if it hit
// a mine.
function open(i) {
  const queue = [i];
  while (queue.length) {
    const j = queue.pop();
    const cell = cells[j];
    if (cell.open || cell.flag) continue;
    cell.open = true;
    paint(cell);
    if (cell.mine) return lose(j);
    if (cell.n === 0) queue.push(...neighbors(j));
  }
  return true;
}

function press(i) {
  if (over) return;
  const cell = cells[i];
  if (cell.flag) return;
  if (!started) lay(i);
  if (cell.open) {
    // A number whose mines are all flagged opens the rest around it.
    const around = neighbors(i);
    if (cell.n && around.filter((j) => cells[j].flag).length === cell.n) {
      for (const j of around) if (!open(j)) return;
    }
  } else if (!open(i)) {
    return;
  }
  draw();
  if (cells.every((one) => one.mine || one.open)) win();
}

function flag(i) {
  if (over) return;
  const cell = cells[i];
  if (cell.open) return;
  cell.flag = !cell.flag;
  paint(cell);
  draw();
}

function stop() {
  over = true;
  clearInterval(timer);
  timer = null;
}

function lose(i) {
  stop();
  cells.forEach((cell, j) => {
    if (cell.mine && !cell.flag) cell.el.classList.add(j === i ? "is-boom" : "is-mine");
    if (!cell.mine && cell.flag) cell.el.classList.add("is-wrong");
  });
  return false;
}

async function win() {
  stop();
  cells.forEach((cell) => {
    if (cell.mine && !cell.flag) {
      cell.flag = true;
      paint(cell);
    }
  });
  const time = seconds();
  draw();
  saved.best ??= {};
  const best = saved.best[level];
  const record = !best || time < best;
  if (record) {
    saved.best[level] = time;
    store();
  }
  const where = LEVELS[level].title;
  await showMessage({
    title: "Mines",
    text: record ? `You cleared the ${where} field in ${time} seconds: the best time on this computer.` : `You cleared the ${where} field in ${time} seconds. The best here is ${best}.`,
    icon: "information",
  });
}

function bestTimes() {
  const best = saved.best ?? {};
  const lines = Object.entries(LEVELS).map(([id, one]) => `${one.title}: ${best[id] ? `${best[id]} seconds` : "not yet"}`);
  return showMessage({ title: "Best Times", text: `The best times on this computer:\n\n${lines.join("\n")}`, icon: "information" });
}

// --- the pointer and the keys ----------------------------------------------

const indexOf = (e) => (e.target.closest(".tile") ? Number(e.target.closest(".tile").dataset.i) : -1);

// A long press flags a tile on a phone. Android turns one into a right-click
// on its own, but an iPhone doesn't, so it's timed here too. Whatever click
// or right-click follows the press is ignored, so it doesn't count twice.
const LONG_PRESS_MS = 500;
let held = null;   // { timer, x, y, at } while a finger's down, at once it flagged
board.addEventListener("pointerdown", (e) => {
  const i = indexOf(e);
  if (e.pointerType !== "touch" || i === -1) return;
  clearTimeout(held?.timer);
  held = { x: e.clientX, y: e.clientY, at: 0 };
  held.timer = setTimeout(() => {
    held.at = performance.now();
    flag(i);
  }, LONG_PRESS_MS);
});
board.addEventListener("pointermove", (e) => {
  if (held && Math.hypot(e.clientX - held.x, e.clientY - held.y) > 10) clearTimeout(held.timer);
});
for (const type of ["pointerup", "pointercancel"]) board.addEventListener(type, () => clearTimeout(held?.timer));
const justHeld = () => held?.at && performance.now() - held.at < 1500;

board.addEventListener("click", (e) => {
  const i = indexOf(e);
  if (i !== -1 && !justHeld()) press(i);
});
board.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const i = indexOf(e);
  if (i !== -1 && !justHeld()) flag(i);
});

// Arrows move between tiles, Space or Enter opens one, and F flags it.
board.addEventListener("keydown", (e) => {
  const i = indexOf(e);
  if (i === -1) return;
  const { columns } = LEVELS[level];
  const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[e.key];
  if (move !== undefined) {
    const next = cells[i + move];
    if (!next) return;
    e.preventDefault();
    cells[i].el.tabIndex = -1;
    next.el.tabIndex = 0;
    next.el.focus();
  } else if (e.key.toLowerCase() === "f") {
    e.preventDefault();
    flag(i);
  }
});

document.querySelector("[data-new]").addEventListener("click", () => newGame());
document.addEventListener("keydown", (e) => {
  if (e.key !== "F2" || document.querySelector(".layer")) return;
  e.preventDefault();
  newGame();
});

menuBar(document.querySelector(".menu-bar"), [
  { label: "Game", items: () => [
    { label: "New", keys: "F2", action: () => newGame() },
    "-",
    ...Object.entries(LEVELS).map(([id, one]) => ({ label: one.title, radio: id === level, action: () => newGame(id) })),
    "-",
    { label: "Best Times...", action: bestTimes },
    "-",
    { label: "Exit", action: () => desktop.close(window) },
  ] },
  { label: "Help", items: () => [
    { label: "How to Play", action: () => showMessage({
      title: "Mines",
      text: "Open every tile that hasn't a mine under it.\n\nA number says how many of the eight tiles around it have a mine. Right-click (or press and hold) to flag a tile you're sure of. Click a number when its mines are flagged to open the rest around it.\n\nThe first tile you open never has a mine.",
      icon: "information",
    }) },
  ] },
]);

if (desktop) newGame();
