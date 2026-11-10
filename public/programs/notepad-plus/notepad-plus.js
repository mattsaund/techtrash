// Notepad++, an easter egg. It opens the code this site is made of, every
// page, script and stylesheet the browser gets. The list comes from following
// what each page loads, so it's always what's live.
//
// Anything can be changed but nothing saves, since these are the site's own
// files. Closing a file (or Notepad++) puts it back as it was. JS Paint and
// the blog's borrowed libraries are left out because they're other people's
// code (files/credits.txt).

import { APPS } from "/js/apps.js";
import { menuBar } from "/js/menu.js";
import { showMessage } from "/js/message.js";

const desktop = window.top === window ? null : window.top.desktop;

const XP = "/img/icons/xp";
const LEFT_OUT = ["/programs/paint/jspaint/", "/pages/blog/vendor/", "/pages/blog/sky/cosmos/"];
const MOST = 250;   // the most files it'll load

const tree = document.querySelector(".npp__tree");
const list = document.querySelector(".npp__files");
const tabs = document.querySelector(".npp__tabs");
const text = document.querySelector(".npp__text");
const shown = document.querySelector(".npp__shown code");
const margin = document.querySelector(".npp__margin > div");
const current = document.querySelector(".npp__current");
const finder = document.querySelector(".npp__find");
const LINE = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--lh-mono"));
const PAD = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sp-2"));

const files = new Map();   // "js/desktop.js" -> { path, url, words, original, open, at }
let front = null;          // the file in the editor

// --- finding the site's files ----------------------------------------------

const kindOf = (path) => (path.endsWith(".css") ? "css" : path.endsWith(".html") ? "html" : "js");
const KINDS = {
  js: { name: "JavaScript file", icon: `${XP}/javascript.png` },
  css: { name: "Cascade Style Sheets File", icon: `${XP}/css.png` },
  html: { name: "Hyper Text Markup Language file", icon: `${XP}/html.png` },
};

// The paths a file loads from this site. Scripts and stylesheets for a page,
// imports for a script, @imports for a stylesheet.
function loads(url, words) {
  const found = [];
  const add = (ref) => {
    try {
      const next = new URL(ref, url);
      if (next.origin === location.origin) found.push(next.pathname);
    } catch {}
  };
  const kind = kindOf(new URL(url).pathname.replace(/\/$/, "/index.html"));
  if (kind === "html") {
    for (const m of words.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/g)) add(m[1]);
    for (const m of words.matchAll(/<link[^>]*\shref=["']([^"']+\.css)["']/g)) add(m[1]);
  } else if (kind === "js") {
    for (const m of words.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+\.js)["']/g)) add(m[1]);
  } else {
    for (const m of words.matchAll(/@import\s+(?:url\()?["']?([^"')\s]+\.css)/g)) add(m[1]);
  }
  return found;
}

// "/programs/files/" becomes "programs/files/index.html", and "/" becomes
// "index.html".
const named = (pathname) => pathname.replace(/^\//, "").replace(/(^|\/)$/, "$1index.html");

async function discover() {
  const queue = ["/", ...APPS.map((app) => app.url)];
  const seen = new Set();
  while (queue.length && files.size < MOST) {
    const batch = queue.splice(0, 6).filter((one) => !seen.has(one) && !LEFT_OUT.some((out) => one.startsWith(out)) && /(\/|\.js|\.css|\.html)$/.test(one));
    batch.forEach((one) => seen.add(one));
    await Promise.all(batch.map(async (pathname) => {
      try {
        const response = await fetch(pathname);
        if (!response.ok || !/text|javascript|css/.test(response.headers.get("content-type") ?? "")) return;
        const words = await response.text();
        const path = named(pathname);
        files.set(path, { path, url: pathname, words, original: words, open: false, at: [0, 0, 0, 0] });
        queue.push(...loads(location.origin + pathname, words));
      } catch {}
    }));
  }
}

// --- Folder as Workspace ---------------------------------------------------

function drawTree() {
  list.replaceChildren();
  // the paths as a tree of folders
  const top = { folders: new Map(), paths: [] };
  for (const path of [...files.keys()].sort()) {
    let node = top;
    for (const part of path.split("/").slice(0, -1)) {
      if (!node.folders.has(part)) node.folders.set(part, { folders: new Map(), paths: [] });
      node = node.folders.get(part);
    }
    node.paths.push(path);
  }
  const row = (label, icon, depth, path) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.className = "npp__entry";
    button.type = "button";
    button.style.setProperty("--depth", depth);
    const img = document.createElement("img");
    img.src = icon;
    img.alt = "";
    const span = document.createElement("span");
    span.textContent = label;
    button.append(img, span);
    if (path) {
      button.dataset.path = path;
      button.setAttribute("aria-current", String(path === front?.path));
      button.addEventListener("click", () => openFile(path));
    }
    li.append(button);
    list.append(li);
  };
  // folders first, then files, as Notepad++ lists them
  const walk = (node, depth) => {
    for (const [name, inside] of [...node.folders].sort(([a], [b]) => a.localeCompare(b))) {
      row(`${name}/`, `${XP}/folder.png`, depth, null);
      walk(inside, depth + 1);
    }
    for (const path of node.paths) row(path.split("/").pop(), KINDS[kindOf(path)].icon, depth, path);
  };
  row("techtrash.org", `${XP}/folder.png`, 0);
  walk(top, 1);
}

// --- colors ----------------------------------------------------------------

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const span = (kind, s) => `<span class="t-${kind}">${escape(s)}</span>`;

const KEYWORDS = new Set(("break case catch class const continue debugger default delete do else export extends finally for function " +
  "if import in instanceof let new return super switch this throw try typeof var void while with yield async await of true false " +
  "null undefined static get set from as").split(" "));

// Each language is a list of [kind, pattern] pairs, tried in order at the
// current spot (they're sticky). Anything none of them match stays plain.
const RULES = {
  js: [
    ["comment", /\/\/[^\n]*|\/\*[\s\S]*?\*\//y],
    ["string", /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\[\s\S]|[^`\\])*`/y],
    ["number", /\b(?:0x[\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/iy],
    ["word", /[A-Za-z_$][\w$]*/y],
    ["operator", /[{}()[\];,.<>=!+\-*/%&|^~?:]+/y],
  ],
  css: [
    ["comment", /\/\*[\s\S]*?\*\//y],
    ["string", /"[^"\n]*"|'[^'\n]*'/y],
    ["attr", /@[\w-]+/y],
    ["value", /(?<=:\s*)[^;{}\n]+/y],
    ["tag", /[\w-]+(?=\s*:)/y],
    ["operator", /[{}();:,>]+/y],
  ],
  html: [
    ["comment", /<!--[\s\S]*?-->/y],
    ["tag", /<\/?[\w-]+|\/?>/y],
    ["attr", /(?<=<[^>]*)\s[\w:-]+(?==)/y],
    ["value", /(?<=<[^>]*=)"[^"]*"|(?<=<[^>]*=)'[^']*'/y],
  ],
};

function color(words, kind) {
  if (kind === "html") return colorPage(words);
  const rules = RULES[kind];
  let out = "";
  let plain = "";
  for (let i = 0; i < words.length;) {
    let hit = null;
    for (const [name, rule] of rules) {
      rule.lastIndex = i;
      const m = rule.exec(words);
      if (m && m[0]) {
        hit = [name === "word" ? (KEYWORDS.has(m[0]) ? "keyword" : null) : name, m[0]];
        break;
      }
    }
    if (!hit) {
      plain += words[i++];
      continue;
    }
    out += escape(plain);
    plain = "";
    out += hit[0] ? span(hit[0], hit[1]) : escape(hit[1]);
    i += hit[1].length;
  }
  return out + escape(plain);
}

// A page is markup, but what's inside its <script> and <style> tags gets JS
// and CSS colors.
function colorPage(words) {
  let out = "";
  let at = 0;
  for (const m of words.matchAll(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)|(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi)) {
    out += color(words.slice(at, m.index), "markup");
    const [open, inside, close] = m[1] ? [m[1], m[2], m[3]] : [m[4], m[5], m[6]];
    out += color(open, "markup") + color(inside, m[1] ? "js" : "css") + color(close, "markup");
    at = m.index + m[0].length;
  }
  return out + color(words.slice(at), "markup");
}
RULES.markup = RULES.html;

// --- the editor ------------------------------------------------------------

let pending = 0;
function redraw() {
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(() => {
    if (!front) return;
    shown.innerHTML = `${color(text.value, kindOf(front.path))}\n`;
    const lines = text.value.split("\n").length;
    margin.textContent = Array.from({ length: lines }, (_, i) => i + 1).join("\n");
    follow();
    status();
  });
}

// Keeps the colored copy, the line numbers and the current-line bar lined up
// with the textarea's scroll.
function follow() {
  shown.style.transform = `translate(${-text.scrollLeft}px, ${-text.scrollTop}px)`;
  margin.style.transform = `translateY(${-text.scrollTop}px)`;
  const line = text.value.slice(0, text.selectionStart).split("\n").length - 1;
  current.style.top = `${PAD + line * LINE - text.scrollTop}px`;
}

function status() {
  if (!front) return;
  const before = text.value.slice(0, text.selectionStart);
  const ln = before.split("\n").length;
  const col = before.length - before.lastIndexOf("\n");
  const picked = text.selectionEnd - text.selectionStart;
  const pickedLines = picked ? text.value.slice(text.selectionStart, text.selectionEnd).split("\n").length : 0;
  document.querySelector("[data-kind]").textContent = KINDS[kindOf(front.path)].name;
  document.querySelector("[data-length]").textContent = `length : ${text.value.length.toLocaleString("en-US")}    lines : ${text.value.split("\n").length.toLocaleString("en-US")}`;
  document.querySelector("[data-where]").textContent = `Ln : ${ln}    Col : ${col}    Sel : ${picked} | ${pickedLines}`;
  front.words = text.value;
  front.el?.classList.toggle("is-changed", front.words !== front.original);
}

text.addEventListener("input", redraw);
text.addEventListener("scroll", follow);
for (const type of ["keyup", "pointerup", "select"]) text.addEventListener(type, () => { follow(); status(); });
// Tab types a tab, like in Notepad++, instead of moving the focus.
text.addEventListener("keydown", (e) => {
  if (e.key !== "Tab" || e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  document.execCommand("insertText", false, "\t");
});

// --- files and tabs --------------------------------------------------------

const titleOf = (file) => `C:\\techtrash.org\\${file.path.replace(/\//g, "\\")} - Notepad++`;

function openFile(path) {
  const file = files.get(path);
  if (!file) return;
  if (front) front.at = [text.selectionStart, text.selectionEnd, text.scrollTop, text.scrollLeft];
  if (!file.open) {
    file.open = true;
    const tab = document.createElement("div");
    tab.className = "npp__tab";
    tab.setAttribute("role", "tab");
    const img = document.createElement("img");
    img.src = `${XP}/save.png`;
    img.alt = "";
    const label = document.createElement("span");
    label.textContent = path.split("/").pop();
    label.title = path;
    const close = document.createElement("button");
    close.className = "npp__close";
    close.type = "button";
    close.textContent = "x";
    close.setAttribute("aria-label", `Close ${label.textContent}`);
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      closeFile(path);
    });
    tab.append(img, label, close);
    tab.addEventListener("click", () => openFile(path));
    tabs.append(tab);
    file.el = tab;
  }
  front = file;
  for (const one of files.values()) one.el?.setAttribute("aria-selected", String(one === file));
  for (const entry of list.querySelectorAll("[data-path]")) entry.setAttribute("aria-current", String(entry.dataset.path === path));
  document.title = titleOf(file);
  text.value = file.words;
  text.setSelectionRange(file.at[0], file.at[1]);
  text.scrollTop = file.at[2];
  text.scrollLeft = file.at[3];
  redraw();
  text.focus({ preventScroll: true });
}

function closeFile(path) {
  const file = files.get(path);
  if (!file?.open) return;
  file.open = false;
  file.el.remove();
  file.el = null;
  file.words = file.original;   // nothing saves, so closing drops the changes
  file.at = [0, 0, 0, 0];
  if (front === file) {
    front = null;
    const next = [...files.values()].find((one) => one.open);
    if (next) openFile(next.path);
    else {
      text.value = "";
      shown.textContent = "";
      margin.textContent = "";
      document.title = "Notepad++";
    }
  }
}

async function refuse() {
  if (!front) return;
  await showMessage({
    title: "Save",
    text: `Cannot save ${titleOf(front).replace(" - Notepad++", "")}.\n\nThese are the files techtrash.org is made of, and they're read-only here. Your changes stay until you close Notepad++.`,
    icon: "warning",
  });
  text.focus();
}

// --- Find ------------------------------------------------------------------

function showFind() {
  finder.hidden = false;
  const field = document.getElementById("find");
  const picked = text.value.slice(text.selectionStart, text.selectionEnd);
  if (picked && !picked.includes("\n")) field.value = picked;
  field.select();
  field.focus();
}

finder.addEventListener("submit", (e) => {
  e.preventDefault();
  const want = document.getElementById("find").value;
  const said = document.querySelector("[data-found]");
  if (!want) return;
  const from = text.selectionEnd;
  let at = text.value.toLowerCase().indexOf(want.toLowerCase(), from);
  if (at === -1) at = text.value.toLowerCase().indexOf(want.toLowerCase());
  said.textContent = at === -1 ? `Can't find the text "${want}"` : "";
  if (at === -1) return;
  text.focus();
  text.setSelectionRange(at, at + want.length);
  const line = text.value.slice(0, at).split("\n").length - 1;
  text.scrollTop = Math.max(0, line * LINE - text.clientHeight / 2);
  follow();
  status();
});

// --- menus, the toolbar and the keys ---------------------------------------

const edit = (name) => () => {
  text.focus();
  document.execCommand(name);
  redraw();
};

async function paste() {
  try {
    text.focus();
    document.execCommand("insertText", false, await navigator.clipboard.readText());
    redraw();
  } catch {
    await showMessage({ title: "Notepad++", text: "This browser won't let Notepad++ read the clipboard. Use Ctrl+V instead.", icon: "information" });
  }
}

const ACTIONS = {
  tree: () => { tree.hidden = !tree.hidden; },
  save: refuse,
  cut: edit("cut"),
  copy: edit("copy"),
  paste,
  undo: edit("undo"),
  redo: edit("redo"),
  find: showFind,
  unfind: () => { finder.hidden = true; text.focus(); },
};
for (const button of document.querySelectorAll("[data-act]")) button.addEventListener("click", ACTIONS[button.dataset.act]);

document.addEventListener("keydown", (e) => {
  if (document.querySelector(".layer, .menu--pop")) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (ctrl && key === "s") refuse();
  else if (ctrl && key === "f") showFind();
  else if (ctrl && key === "w") front && closeFile(front.path);
  else if (e.key === "Escape" && !finder.hidden) ACTIONS.unfind();
  else if (e.key === "F3") finder.requestSubmit();
  else return;
  e.preventDefault();
});

function about() {
  return showMessage({
    title: "About Notepad++",
    text: "Notepad++, techtrash.org's\n\nThe code this site is made of, as your browser has it: change anything you like. None of it can be saved, so it's all back as it was when Notepad++ opens again.\n\nThe server's code, and the rest, is at github.com/mattsaund/techtrash.",
    icon: "information",
  });
}

menuBar(document.querySelector(".menu-bar"), [
  { label: "File", items: () => [
    { label: "Save", keys: "Ctrl+S", disabled: !front, action: refuse },
    { label: "Save As...", disabled: !front, action: refuse },
    "-",
    { label: "Close", keys: "Ctrl+W", disabled: !front, action: () => closeFile(front.path) },
    { label: "Close All", disabled: !front, action: () => [...files.values()].filter((one) => one.open).forEach((one) => closeFile(one.path)) },
    "-",
    { label: "Exit", action: () => desktop.close(window) },
  ] },
  { label: "Edit", items: () => [
    { label: "Undo", keys: "Ctrl+Z", action: edit("undo") },
    { label: "Redo", keys: "Ctrl+Y", action: edit("redo") },
    "-",
    { label: "Cut", keys: "Ctrl+X", action: edit("cut") },
    { label: "Copy", keys: "Ctrl+C", action: edit("copy") },
    { label: "Paste", keys: "Ctrl+V", action: paste },
    { label: "Delete", keys: "Del", action: edit("delete") },
    "-",
    { label: "Select All", keys: "Ctrl+A", action: () => { text.focus(); text.select(); status(); } },
  ] },
  { label: "Search", items: () => [
    { label: "Find...", keys: "Ctrl+F", action: showFind },
    { label: "Find Next", keys: "F3", action: () => finder.requestSubmit() },
  ] },
  { label: "View", items: () => [
    { label: "Folder as Workspace", checked: !tree.hidden, action: ACTIONS.tree },
  ] },
  { label: "Language", items: () => Object.entries(KINDS).map(([kind, one]) => ({
    label: one.name.replace(/ file$/i, ""), radio: front ? kindOf(front.path) === kind : false, disabled: true,
  })) },
  { label: "?", items: () => [{ label: "About Notepad++", action: about }] },
]);

async function start() {
  document.querySelector("[data-kind]").textContent = "Finding the site's files...";
  await discover();
  drawTree();
  for (const path of ["index.html", "js/desktop.js"]) if (files.has(path)) openFile(path);
}

if (desktop) start();
