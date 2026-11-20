// Calculator, XP's Standard view. Evaluates left to right like XP (2 + 3 * 4 = 20).
// Repeated = repeats the last operation, % means percent of the first operand,
// and whole numbers show a trailing point ("5."). Key bindings match XP's.

import { menuBar } from "/js/menu.js";
import { showMessage } from "/js/message.js";

const desktop = window.top === window ? null : window.top.desktop;
const display = document.querySelector("[data-display]");
const memoryMark = document.querySelector("[data-memory]");

let entry = "0";        // display text, as typed
let total = null;       // left operand of the pending operation
let waiting = null;     // pending operation, + - * /
let fresh = true;       // next digit starts a new number
let last = null;        // [operation, operand] for repeated =
let memory = 0;
let grouping = false;   // View > Digit grouping
let broken = false;     // error showing, next key clears it

const value = () => Number(entry);

// XP's display format. At most 15 significant digits, always a decimal point.
function shown(number) {
  if (!Number.isFinite(number)) return "0.";
  let text = Math.abs(number) >= 1e16 || (number !== 0 && Math.abs(number) < 1e-15)
    ? number.toExponential(14).replace(/\.?0+e/, ".e")
    : String(Number(number.toPrecision(15)));
  if (!text.includes(".") && !text.includes("e")) text += ".";
  return text;
}

function draw() {
  let text = broken ? entry : entry.includes(".") || entry.includes("e") ? entry : `${entry}.`;
  if (grouping && !broken) {
    const [whole, part] = text.split(".");
    text = `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${part ?? ""}`;
  }
  display.textContent = text;
  memoryMark.textContent = memory !== 0 ? "M" : "";
}

function fail(words) {
  entry = words;
  broken = true;
  total = null;
  waiting = null;
  fresh = true;
}

// a op b, or null on divide by zero (fail() shows XP's error)
function work(a, op, b) {
  if (op === "/" && b === 0) {
    fail("Cannot divide by zero.");
    return null;
  }
  return { "+": a + b, "-": a - b, "*": a * b, "/": a / b }[op];
}

function setNumber(number) {
  entry = shown(number).replace(/\.$/, "");
  fresh = true;
}

function press(key) {
  if (broken) {
    broken = false;
    entry = "0";
    if (!/^[\d.]$/.test(key)) return draw();
  }
  if (/^\d$/.test(key)) {
    if (fresh || entry === "0") entry = key;
    else if (entry.replace(/[-.]/g, "").length < 32) entry += key;
    fresh = false;
  } else if (key === ".") {
    if (fresh) entry = "0.";
    else if (!entry.includes(".")) entry += ".";
    fresh = false;
  } else if ("+-*/".includes(key) && key.length === 1) {
    if (waiting && !fresh) {
      const result = work(total, waiting, value());
      if (result === null) return draw();
      setNumber(result);
    }
    total = value();
    waiting = key;
    fresh = true;
  } else if (key === "=") {
    if (waiting) {
      last = [waiting, value()];
      const result = work(total, waiting, value());
      waiting = null;
      if (result === null) return draw();
      setNumber(result);
    } else if (last) {
      const result = work(value(), last[0], last[1]);
      if (result === null) return draw();
      setNumber(result);
    }
    total = null;
  } else if (key === "sqrt") {
    if (value() < 0) fail("Invalid input for function.");
    else setNumber(Math.sqrt(value()));
  } else if (key === "%") {
    setNumber(waiting ? (total * value()) / 100 : 0);
  } else if (key === "1/x") {
    if (value() === 0) fail("Cannot divide by zero.");
    else setNumber(1 / value());
  } else if (key === "+/-") {
    if (value() !== 0) entry = entry.startsWith("-") ? entry.slice(1) : `-${entry}`;
  } else if (key === "Backspace") {
    if (!fresh) entry = entry.slice(0, -1).replace(/^-?$/, "0");
  } else if (key === "CE") {
    entry = "0";
    fresh = true;
  } else if (key === "C") {
    entry = "0";
    total = null;
    waiting = null;
    last = null;
    fresh = true;
  } else if (key === "MC") {
    memory = 0;
  } else if (key === "MR") {
    setNumber(memory);
  } else if (key === "MS") {
    memory = value();
    fresh = true;
  } else if (key === "M+") {
    memory += value();
    fresh = true;
  }
  draw();
}

for (const button of document.querySelectorAll("[data-key]")) {
  button.addEventListener("click", () => press(button.dataset.key));
}

const KEYS = { Enter: "=", "=": "=", Escape: "C", Delete: "CE", Backspace: "Backspace", "@": "sqrt", "%": "%", r: "1/x", R: "1/x", F9: "+/-", ",": "." };
const CTRL = { l: "MC", r: "MR", m: "MS", p: "M+" };
document.addEventListener("keydown", (e) => {
  if (document.querySelector(".layer, .menu--pop")) return;
  const ctrl = e.ctrlKey || e.metaKey;
  let key = null;
  if (ctrl && CTRL[e.key.toLowerCase()]) key = CTRL[e.key.toLowerCase()];
  else if (ctrl && e.key.toLowerCase() === "c") copy();
  else if (ctrl && e.key.toLowerCase() === "v") paste();
  else if (!ctrl && (/^[\d.+\-*/]$/.test(e.key) || KEYS[e.key])) key = KEYS[e.key] ?? e.key;
  else return;
  e.preventDefault();
  if (key) {
    press(key);
    document.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  }
});

async function copy() {
  try {
    await navigator.clipboard.writeText(display.textContent.replace(/,/g, "").replace(/\.$/, ""));
  } catch {}
}

// Pastes by pressing each character as a key, like XP.
async function paste() {
  try {
    const text = await navigator.clipboard.readText();
    for (const ch of text) {
      if (/[\d.+\-*/=%]/.test(ch)) press(ch);
    }
  } catch {
    await showMessage({ title: "Calculator", text: "This browser won't let the Calculator read the clipboard.", icon: "information" });
  }
}

menuBar(document.querySelector(".menu-bar"), [
  { label: "Edit", items: () => [
    { label: "Copy", keys: "Ctrl+C", action: copy },
    { label: "Paste", keys: "Ctrl+V", action: paste },
  ] },
  { label: "View", items: () => [
    { label: "Standard", radio: true },
    "-",
    { label: "Digit grouping", checked: grouping, action: () => { grouping = !grouping; draw(); } },
  ] },
  { label: "Help", items: () => [
    { label: "About Calculator", action: () => showMessage({ title: "About Calculator", text: "Calculator\n\nIts sums go left to right, one at a time, as XP's did: 2 + 3 * 4 is 20.", icon: "information" }) },
  ] },
]);

if (desktop) draw();
