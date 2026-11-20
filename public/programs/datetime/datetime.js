// Date and Time Properties, opened from the taskbar clock. Shows the visitor's
// own clock and zone. A page can't set the system time, so Apply always gets
// XP's refusal. Update Now really compares against the server clock.

import { showMessage } from "/js/message.js";

const desktop = window.top === window ? null : window.top.desktop;

const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleString("en-US", { month: "long" }));
const DAYS = ["S", "M", "T", "W", "T", "F", "S"];

const monthBox = document.querySelector("[data-month]");
const yearBox = document.querySelector("[data-year]");
const days = document.querySelector("[data-days]");
const timeBox = document.querySelector("[data-time]");
const apply = document.querySelector("[data-apply]");

let picked = new Date();   // selected day
let setTime = null;        // edited time, which stops the clock (null when live)
let part = 0;              // spin target, 0 to 3 for hours, minutes, seconds, AM/PM

// --- tabs ------------------------------------------------------------------

for (const tab of document.querySelectorAll("[data-tab]")) {
  tab.addEventListener("click", () => {
    for (const one of document.querySelectorAll("[data-tab]")) one.setAttribute("aria-selected", String(one === tab));
    for (const panel of document.querySelectorAll("[data-panel]")) panel.hidden = panel.dataset.panel !== tab.dataset.tab;
  });
}

// --- the date --------------------------------------------------------------

function changed() {
  apply.disabled = false;
}

function drawMonth() {
  monthBox.value = String(picked.getMonth());
  yearBox.value = String(picked.getFullYear());
  days.replaceChildren();
  for (const day of DAYS) {
    const head = document.createElement("span");
    head.className = "calendar__head";
    head.textContent = day;
    days.append(head);
  }
  const first = new Date(picked.getFullYear(), picked.getMonth(), 1).getDay();
  const count = new Date(picked.getFullYear(), picked.getMonth() + 1, 0).getDate();
  for (let i = 0; i < first; i++) days.append(document.createElement("span"));
  for (let day = 1; day <= count; day++) {
    const button = document.createElement("button");
    button.className = "calendar__day";
    button.type = "button";
    button.tabIndex = -1;
    button.textContent = String(day);
    button.setAttribute("aria-selected", String(day === picked.getDate()));
    button.addEventListener("click", () => {
      picked.setDate(day);
      changed();
      drawMonth();
    });
    days.append(button);
  }
}

// Keeps the day of the month, clamped to the new month's length.
function moveTo(year, month) {
  const last = new Date(year, month + 1, 0).getDate();
  picked = new Date(year, month, Math.min(picked.getDate(), last));
  changed();
  drawMonth();
}

MONTHS.forEach((name, i) => {
  const option = document.createElement("option");
  option.value = String(i);
  option.textContent = name;
  monthBox.append(option);
});
monthBox.addEventListener("change", () => moveTo(picked.getFullYear(), Number(monthBox.value)));
yearBox.addEventListener("change", () => {
  const year = Math.min(2099, Math.max(1980, Math.round(Number(yearBox.value)) || picked.getFullYear()));
  moveTo(year, picked.getMonth());
});

// Arrow keys move the selected day, as in XP's calendar.
days.addEventListener("keydown", (e) => {
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
  if (!step) return;
  e.preventDefault();
  picked = new Date(picked.getFullYear(), picked.getMonth(), picked.getDate() + step);
  changed();
  drawMonth();
});

// --- the time --------------------------------------------------------------

const now = () => setTime ?? new Date();
const timeText = (time) => time.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });

function drawClock() {
  const time = now();
  const seconds = time.getSeconds();
  const minutes = time.getMinutes() + seconds / 60;
  const hours = (time.getHours() % 12) + minutes / 60;
  const turn = (hand, degrees) => document.querySelector(`[data-hand=${hand}]`).setAttribute("transform", `rotate(${degrees})`);
  turn("hour", hours * 30);
  turn("minute", minutes * 6);
  turn("second", seconds * 6);
  if (document.activeElement !== timeBox) timeBox.value = timeText(time);
}

// 60 tick marks, bigger on the hours.
const marks = document.querySelector("[data-marks]");
for (let i = 0; i < 60; i++) {
  const hour = i % 5 === 0;
  const mark = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  mark.setAttribute("class", hour ? "clock__hour-mark" : "clock__minute-mark");
  mark.setAttribute("x", hour ? "-2" : "-1");
  mark.setAttribute("y", hour ? "-53" : "-52");
  mark.setAttribute("width", hour ? "4" : "2");
  mark.setAttribute("height", hour ? "7" : "2");
  mark.setAttribute("transform", `rotate(${i * 6})`);
  marks.append(mark);
}

// Which part of "11:42:05 PM" the caret's in.
function partAt(position) {
  const text = timeBox.value;
  const colons = [text.indexOf(":"), text.lastIndexOf(":")];
  if (position <= colons[0]) return 0;
  if (position <= colons[1]) return 1;
  if (position <= text.indexOf(" ")) return 2;
  return 3;
}

function step(by) {
  const time = new Date(now());
  if (part === 0) time.setHours(time.getHours() + by);
  else if (part === 1) time.setMinutes(time.getMinutes() + by);
  else if (part === 2) time.setSeconds(time.getSeconds() + by);
  else time.setHours(time.getHours() + 12 * by);
  setTime = time;
  changed();
  timeBox.value = timeText(time);
  drawClock();
}

timeBox.addEventListener("click", () => { part = partAt(timeBox.selectionStart); });
timeBox.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
  e.preventDefault();
  part = partAt(timeBox.selectionStart);
  step(e.key === "ArrowUp" ? 1 : -1);
});
// Takes a typed time if it parses, else restores the shown one.
timeBox.addEventListener("change", () => {
  const m = timeBox.value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])\.?m?\.?$/i);
  if (!m) {
    timeBox.value = timeText(now());
    return;
  }
  const time = new Date(now());
  time.setHours((Number(m[1]) % 12) + (m[4].toLowerCase() === "p" ? 12 : 0), Number(m[2]), Number(m[3] ?? 0));
  setTime = time;
  changed();
  drawClock();
});
for (const button of document.querySelectorAll("[data-step]")) {
  button.addEventListener("click", () => step(Number(button.dataset.step)));
}

// An edited time stays frozen until Apply, as on XP.
setInterval(drawClock, 1000);

// --- the time zone ---------------------------------------------------------

// XP's zone label, "(GMT-08:00) Pacific Standard Time".
function zoneName() {
  const date = new Date();
  const long = new Intl.DateTimeFormat("en-US", { timeZoneName: "long" }).formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? "";
  const minutes = -date.getTimezoneOffset();
  const sign = minutes < 0 ? "-" : "+";
  const hh = String(Math.floor(Math.abs(minutes) / 60)).padStart(2, "0");
  const mm = String(Math.abs(minutes) % 60).padStart(2, "0");
  return { long, label: `(GMT${sign}${hh}:${mm}) ${long}` };
}

const zone = zoneName();
document.querySelector("[data-zone-name]").textContent = `Current time zone: ${zone.long}`;
const zoneOption = document.createElement("option");
zoneOption.textContent = zone.label;
document.querySelector("[data-zone]").append(zoneOption);

// --- Internet Time ---------------------------------------------------------

// Compares with the server clock (/api/time in worker.js), assuming it
// answered halfway through the round trip. Wording follows XP's.
document.querySelector("[data-sync]").addEventListener("click", async () => {
  const note = document.querySelector("[data-synced]");
  note.textContent = "Please wait while Windows synchronizes with techtrash.org...";
  try {
    const sent = Date.now();
    const response = await fetch("/api/time", { cache: "no-store" });
    const theirs = (await response.json()).now;
    if (!Number.isFinite(theirs)) throw new Error();
    const mine = (sent + Date.now()) / 2;
    const off = Math.round((mine - theirs) / 1000);
    const when = new Date().toLocaleString("en-US", { month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).replace(", ", " at ");
    const by = Math.abs(off) <= 1 ? "Your clock is right." : `Your clock is ${Math.abs(off)} seconds ${off > 0 ? "fast" : "slow"}.`;
    note.textContent = `The time has been successfully checked against techtrash.org on ${when}. ${by}`;
  } catch {
    note.textContent = "An error occurred while Windows was synchronizing with techtrash.org.";
  }
});

// --- OK, Cancel, Apply -----------------------------------------------------

// Any change gets XP's refusal, word for word.
async function save() {
  if (apply.disabled) return true;
  await showMessage({ title: "Date and Time", text: "You do not have the proper privilege level to change the System Time." });
  setTime = null;
  picked = new Date();
  apply.disabled = true;
  drawMonth();
  drawClock();
  return false;
}

apply.addEventListener("click", save);
document.querySelector("[data-ok]").addEventListener("click", async () => {
  if (await save()) desktop.close(window);
});
document.querySelector("[data-cancel]").addEventListener("click", () => desktop.close(window));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !document.querySelector(".layer")) desktop.close(window);
});

if (desktop) {
  drawMonth();
  drawClock();
}
