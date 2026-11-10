// Solitaire (Klondike), with cards of its own.
//
// Build the four piles at the top right up by suit, from ace to king. The
// seven columns go down in alternating colors, and only a king can go in an
// empty one. Click the pack to turn over one card or three (Game > Draw One
// or Draw Three), and click it again once it's empty to start it over. Drag
// cards to move them, and click a face-down card at the foot of a column to
// turn it over. Double-click sends a card up to its pile, and right-click
// sends up everything that can go.
//
// Scoring is XP's Standard. Sending a card up scores 10, moving one from the
// turned-over pile to a column scores 5, and turning one face up scores 5.
// Taking one back down costs 15, and starting the pack over costs 100, or 20
// in Draw Three.

import { menuBar } from "/js/menu.js";
import { showMessage } from "/js/message.js";

const desktop = window.top === window ? null : window.top.desktop;

const css = getComputedStyle(document.documentElement);
const num = (name) => parseFloat(css.getPropertyValue(name));
const BASE_W = num("--card-w");
const BASE_H = num("--card-h");
const FAN_UP = num("--card-fan");
const FAN_DOWN = num("--card-fan-down");
const GAP = num("--sp-12");
const DRAG = num("--drag");

const SUITS = { s: "♠", h: "♥", d: "♦", c: "♣" };
const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const NAMES = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" };
const KEY = "techtrash:solitaire";   // in localStorage: { three } (Draw Three)

const table = document.querySelector(".table");
const scoreField = document.querySelector("[data-score]");
const timeField = document.querySelector("[data-time]");

const cards = new Map();   // id ("h7"): { id, suit, rank, up, el }
let piles = null;          // { stock, waste, foundations: [4], tableau: [7] }, each an array of ids
let score = 0;
let started = 0;           // when the first move was made, or 0
let timer = null;
let history = [];          // what Undo goes back to
let three = loadOptions().three ?? false;
let size = { w: BASE_W, h: BASE_H, scale: 1 };
let won = false;

function loadOptions() {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

function storeOptions() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ three }));
  } catch {}
}

const isRed = (card) => card.suit === "h" || card.suit === "d";
const top = (pile) => cards.get(pile.at(-1));

// --- the cards -------------------------------------------------------------

function makeCard(suit, rank) {
  const id = `${suit}${rank}`;
  const el = document.createElement("div");
  el.className = `card${isRed({ suit }) ? " is-red" : ""}${rank > 10 ? " is-face" : ""}`;
  el.dataset.id = id;
  el.setAttribute("role", "img");
  // A corner is the rank over the suit, the same width on every card.
  const corner = () => {
    const box = document.createElement("span");
    box.className = "card__corner";
    const top = document.createElement("span");
    top.className = `card__rank${rank === 10 ? " is-ten" : ""}`;
    top.textContent = RANKS[rank];
    const under = document.createElement("span");
    under.textContent = SUITS[suit];
    box.append(top, under);
    return box;
  };
  const middle = document.createElement("span");
  middle.className = "card__middle";
  middle.textContent = rank > 10 ? RANKS[rank] : SUITS[suit];
  const end = corner();
  end.classList.add("card__corner--end");
  el.append(corner(), middle, end);
  table.append(el);
  cards.set(id, { id, suit, rank, up: false, el });
}

function slot() {
  const el = document.createElement("div");
  el.className = "slot";
  table.append(el);
  return el;
}

const slots = { stock: null, foundations: [], tableau: [] };

function deal() {
  if (!cards.size) {
    for (const suit of Object.keys(SUITS)) for (let rank = 1; rank <= 13; rank++) makeCard(suit, rank);
  }
  const ids = [...cards.keys()];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  piles = { stock: [], waste: [], foundations: [[], [], [], []], tableau: [[], [], [], [], [], [], []] };
  for (let column = 0; column < 7; column++) {
    for (let row = 0; row <= column; row++) {
      const id = ids.pop();
      piles.tableau[column].push(id);
      cards.get(id).up = row === column;
    }
  }
  for (const id of ids) cards.get(id).up = false;
  piles.stock = ids;
  score = 0;
  started = 0;
  won = false;
  clearInterval(timer);
  timer = null;
  history = [];
  for (const card of cards.values()) card.el.getAnimations().forEach((one) => one.cancel());
  layout();
  status();
}

// --- where everything goes -------------------------------------------------

function measure() {
  const across = (table.clientWidth - 2 * GAP - 6 * GAP) / 7;
  const w = Math.max(40, Math.min(BASE_W, across));
  const scale = w / BASE_W;
  size = { w, h: BASE_H * scale, scale };
  table.style.setProperty("--card-scale", scale);
}

const columnX = (column) => GAP + column * (size.w + GAP);

// Puts every card in place. The pack and its turned-over pile go at the top
// left, the four piles at the top right, and the columns below.
function layout() {
  measure();
  const { w, h } = size;
  const place = (el, x, y, z) => {
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
    el.style.width = `${Math.round(w)}px`;
    el.style.height = `${Math.round(h)}px`;
    el.style.zIndex = z;
  };
  const show = (card) => {
    card.el.classList.toggle("is-down", !card.up);
    card.el.setAttribute("aria-label", card.up ? `${RANKS[card.rank]} of ${NAMES[card.suit]}` : "A card, face down");
  };

  slots.stock ??= slot();
  place(slots.stock, columnX(0), GAP, 0);
  piles.stock.forEach((id, i) => {
    const card = cards.get(id);
    show(card);
    place(card.el, columnX(0), GAP, 1 + i);
  });

  // Draw Three fans out the last three turned over.
  const fanned = three ? 3 : 1;
  piles.waste.forEach((id, i) => {
    const card = cards.get(id);
    show(card);
    const fromEnd = piles.waste.length - 1 - i;
    const shown = Math.min(fanned, piles.waste.length);
    const shift = fromEnd < shown ? shown - 1 - fromEnd : 0;
    place(card.el, columnX(1) + shift * w * 0.22, GAP, 1 + i);
  });

  piles.foundations.forEach((pile, f) => {
    slots.foundations[f] ??= slot();
    place(slots.foundations[f], columnX(3 + f), GAP, 0);
    pile.forEach((id, i) => {
      const card = cards.get(id);
      show(card);
      place(card.el, columnX(3 + f), GAP, 1 + i);
    });
  });

  const tableauY = GAP * 2 + h;
  const room = table.clientHeight - tableauY - GAP;
  piles.tableau.forEach((pile, column) => {
    slots.tableau[column] ??= slot();
    place(slots.tableau[column], columnX(column), tableauY, 0);
    // A long column squeezes its cards closer together to fit.
    const steps = pile.slice(0, -1).map((id) => (cards.get(id).up ? FAN_UP : FAN_DOWN) * size.scale);
    const want = steps.reduce((a, b) => a + b, 0);
    const squeeze = want + h > room && want > 0 ? Math.max(0.2, (room - h) / want) : 1;
    let y = tableauY;
    pile.forEach((id, i) => {
      const card = cards.get(id);
      show(card);
      place(card.el, columnX(column), y, 1 + i);
      y += (steps[i] ?? 0) * squeeze;
    });
  });
}

addEventListener("resize", () => piles && layout());

// --- the rules -------------------------------------------------------------

function canStack(card, pile) {
  const under = top(pile);
  if (!under) return card.rank === 13;
  return under.up && isRed(under) !== isRed(card) && under.rank === card.rank + 1;
}

function canFound(card, pile) {
  const under = top(pile);
  return under ? under.suit === card.suit && under.rank === card.rank - 1 : card.rank === 1;
}

// Which pile a card's in, as [kind, index or null, pile].
function whereIs(id) {
  if (piles.stock.includes(id)) return ["stock", null, piles.stock];
  if (piles.waste.includes(id)) return ["waste", null, piles.waste];
  for (const [f, pile] of piles.foundations.entries()) if (pile.includes(id)) return ["foundation", f, pile];
  for (const [t, pile] of piles.tableau.entries()) if (pile.includes(id)) return ["tableau", t, pile];
  return [null, null, null];
}

// --- moving ----------------------------------------------------------------

function remember() {
  history.push(JSON.stringify({ piles, up: [...cards.values()].filter((card) => card.up).map((card) => card.id), score }));
  if (history.length > 200) history.shift();
}

function undo() {
  const last = history.pop();
  if (!last || won) return;
  const saved = JSON.parse(last);
  piles = saved.piles;
  const up = new Set(saved.up);
  for (const card of cards.values()) card.up = up.has(card.id);
  score = saved.score;
  layout();
  status();
}

function begin() {
  if (started) return;
  started = Date.now();
  timer = setInterval(status, 1000);
}

function addScore(points) {
  score = Math.max(0, score + points);
}

// Moves card `id` and everything on it to a foundation or a column.
// Returns whether the move was allowed.
function move(id, toKind, toIndex) {
  const [fromKind, , from] = whereIs(id);
  const card = cards.get(id);
  const run = from.slice(from.indexOf(id));
  const to = toKind === "foundation" ? piles.foundations[toIndex] : piles.tableau[toIndex];
  if (to === from) return false;
  if (toKind === "foundation" ? run.length !== 1 || !canFound(card, to) : !canStack(card, to)) return false;
  remember();
  begin();
  from.splice(from.length - run.length);
  to.push(...run);
  if (toKind === "foundation" && (fromKind === "waste" || fromKind === "tableau")) addScore(10);
  if (toKind === "tableau" && fromKind === "waste") addScore(5);
  if (toKind === "tableau" && fromKind === "foundation") addScore(-15);
  layout();
  status();
  if (piles.foundations.every((pile) => pile.length === 13)) celebrate();
  return true;
}

// Sends a card up to its pile, if it can go.
function sendUp(id) {
  const [kind, , pile] = whereIs(id);
  if ((kind !== "waste" && kind !== "tableau") || pile.at(-1) !== id || !cards.get(id).up) return false;
  const f = piles.foundations.findIndex((one) => canFound(cards.get(id), one));
  return f !== -1 && move(id, "foundation", f);
}

// Sends up everything that can go, like XP's right-click.
function sendAllUp() {
  let moved = true;
  while (moved && !won) {
    moved = [piles.waste.at(-1), ...piles.tableau.map((pile) => pile.at(-1))].some((id) => id && sendUp(id));
  }
}

// Turns over one or three cards from the pack, or turns them all back once
// it's empty.
function turnOver() {
  if (won || (!piles.stock.length && !piles.waste.length)) return;
  remember();
  begin();
  if (!piles.stock.length) {
    piles.stock = piles.waste.reverse();
    piles.waste = [];
    for (const id of piles.stock) cards.get(id).up = false;
    addScore(three ? -20 : -100);
  } else {
    for (let i = 0; i < (three ? 3 : 1) && piles.stock.length; i++) {
      const id = piles.stock.pop();
      cards.get(id).up = true;
      piles.waste.push(id);
    }
  }
  layout();
  status();
}

function flip(id) {
  const [kind, , pile] = whereIs(id);
  const card = cards.get(id);
  if (kind !== "tableau" || card.up || pile.at(-1) !== id) return;
  remember();
  begin();
  card.up = true;
  addScore(5);
  layout();
  status();
}

function status() {
  scoreField.textContent = `Score: ${score}`;
  timeField.textContent = `Time: ${started && !won ? Math.floor((Date.now() - started) / 1000) : timeField.dataset.final ?? 0}`;
}

// --- winning ---------------------------------------------------------------

// Every card flies off across the table, then it asks about dealing again.
async function celebrate() {
  won = true;
  clearInterval(timer);
  timeField.dataset.final = String(Math.floor((Date.now() - started) / 1000));
  status();
  const box = table.getBoundingClientRect();
  [...cards.values()].forEach((card, i) => {
    const angle = Math.random() * Math.PI * 2;
    const far = Math.max(box.width, box.height);
    card.el.animate([
      { transform: "translate(0, 0) rotate(0deg)", opacity: 1 },
      { transform: `translate(${Math.cos(angle) * far}px, ${Math.sin(angle) * far}px) rotate(${(Math.random() - 0.5) * 720}deg)`, opacity: 0 },
    ], { duration: 1400, delay: i * 35, easing: "ease-in", fill: "forwards" });
  });
  await new Promise((resolve) => setTimeout(resolve, 52 * 35 + 1400));
  const answer = await showMessage({ title: "Solitaire", text: `You won, with a score of ${score}!\n\nDeal again?`, icon: "question", buttons: ["Yes", "No"] });
  delete timeField.dataset.final;
  if (answer === "Yes") deal();
}

// --- the pointer -----------------------------------------------------------

let press = null;   // { id, run, x, y, starts, dragging }

table.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || won) return;
  const el = e.target.closest(".card");
  if (!el) return;
  const id = el.dataset.id;
  const [kind, , pile] = whereIs(id);
  const card = cards.get(id);
  if (!card.up || kind === "stock") return;
  if ((kind === "waste" || kind === "foundation") && pile.at(-1) !== id) return;
  const run = pile.slice(pile.indexOf(id));
  press = { id, run, x: e.clientX, y: e.clientY, starts: run.map((one) => [cards.get(one).el.offsetLeft, cards.get(one).el.offsetTop]), dragging: false };
});

table.addEventListener("pointermove", (e) => {
  if (!press) return;
  const dx = e.clientX - press.x;
  const dy = e.clientY - press.y;
  if (!press.dragging && Math.hypot(dx, dy) < DRAG) return;
  // Capture the pointer once it's a drag, so it isn't lost off the table's
  // edge. Any sooner and clicks would land on the table, not the card.
  if (!press.dragging) table.setPointerCapture(e.pointerId);
  press.dragging = true;
  press.run.forEach((one, i) => {
    const { el } = cards.get(one);
    el.style.left = `${press.starts[i][0] + dx}px`;
    el.style.top = `${press.starts[i][1] + dy}px`;
    el.style.zIndex = 500 + i;
  });
});

// Where a dropped card lands. Of the piles it's allowed on (other than its
// own), the one it overlaps most.
function landing(id) {
  const card = cards.get(id);
  const [, , from] = whereIs(id);
  const run = from.length - from.indexOf(id);
  const r = card.el.getBoundingClientRect();
  const overlap = (box) => Math.max(0, Math.min(r.right, box.right) - Math.max(r.left, box.left)) * Math.max(0, Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top));
  let best = null;
  let most = 0;
  const consider = (kind, index, pile, el, allowed) => {
    if (pile === from || !allowed) return;
    const box = (pile.length ? cards.get(pile.at(-1)).el : el).getBoundingClientRect();
    const area = overlap(box);
    if (area > most) {
      best = [kind, index];
      most = area;
    }
  };
  piles.foundations.forEach((pile, f) => consider("foundation", f, pile, slots.foundations[f], run === 1 && canFound(card, pile)));
  piles.tableau.forEach((pile, t) => consider("tableau", t, pile, slots.tableau[t], canStack(card, pile)));
  return best;
}

table.addEventListener("pointerup", (e) => {
  const was = press;
  press = null;
  if (!was?.dragging) return;
  const target = landing(was.id);
  if (!target || !move(was.id, ...target)) layout();
});
table.addEventListener("pointercancel", () => {
  press = null;
  layout();
});

// A click on the pack turns cards over, and a click on a face-down card at
// a column's foot flips it.
table.addEventListener("click", (e) => {
  if (won) return;
  const el = e.target.closest(".card, .slot");
  if (!el) return;
  if (el === slots.stock || (el.dataset.id && whereIs(el.dataset.id)[0] === "stock")) return turnOver();
  if (el.dataset.id && !cards.get(el.dataset.id).up) flip(el.dataset.id);
});
table.addEventListener("dblclick", (e) => {
  const el = e.target.closest(".card");
  if (el) sendUp(el.dataset.id);
});
table.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  sendAllUp();
});

document.addEventListener("keydown", (e) => {
  if (document.querySelector(".layer, .menu--pop")) return;
  if (e.key === "F2") deal();
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") undo();
  else return;
  e.preventDefault();
});

menuBar(document.querySelector(".menu-bar"), [
  { label: "Game", items: () => [
    { label: "Deal", keys: "F2", action: deal },
    "-",
    { label: "Undo", keys: "Ctrl+Z", disabled: !history.length || won, action: undo },
    "-",
    { label: "Draw One", radio: !three, action: () => { three = false; storeOptions(); deal(); } },
    { label: "Draw Three", radio: three, action: () => { three = true; storeOptions(); deal(); } },
    "-",
    { label: "Exit", action: () => desktop.close(window) },
  ] },
  { label: "Help", items: () => [
    { label: "How to Play", action: () => showMessage({
      title: "Solitaire",
      text: "Build the four piles at the top right up by suit, from ace to king.\n\nIn the seven columns, cards go down in turn, red on black and black on red. Only a king can go in an empty column. Click the pack to turn cards over; click it again when it's out to start it over.\n\nDrag cards to move them. Double-click a card to send it up to its pile, and right-click the table to send up all that can go.",
      icon: "information",
    }) },
  ] },
]);

if (desktop) deal();
