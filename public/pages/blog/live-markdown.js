// techtrash.org : the editor's Markdown, written live.
//
// Markdown the way Obsidian shows it: the line the cursor's on is the
// Markdown itself, every character of it, and every other line is drawn the
// way it'll look (a heading big, bold words bold, a link as a link, a picture
// as the picture, a video's link as its player), with the marks that make it
// so out of sight. Move off a line and it's drawn; move onto one and it's
// Markdown again.
//
// The box holds the Markdown's own characters, all of them, a line to a div,
// and only styles them: a mark is a span site.css hides on a line the cursor
// isn't on, and a picture or a player is drawn beside its source, as a part
// that isn't text. So the cursor, a selection and the browser's own typing
// all work on the Markdown itself, and moving the cursor changes nothing but
// which lines show their marks. After each change, the lines that changed are
// drawn again.
//
// A picture's picked with a click (editor.js's picture row and its corners
// work on it, then pictureChanged() writes it back into its line: as Markdown,
// or as an <img> when it has a size or a place of its own), and so is a
// player, by its bar. Enter carries a list or a quote on, and Enter on an empty
// item ends it. Ctrl+B and Ctrl+I make words bold or italic. Undo and Redo are
// its own (history.js). A paste is its words, as they are; from another page,
// made Markdown.
//
// createLiveMarkdown({ onChange, onFiles, toMarkdown, short }) gives back
//   { element, text(), setText(text), insert(text), focus(), owns(node),
//     column(), pictureChanged(img), playerChanged(box), moveLine(node, up),
//     removeSource(node), undo(), redo() }
// where onFiles(files) is told of files pasted or dropped in (the cursor's
// where they were dropped), and toMarkdown(html) makes a paste from another
// page Markdown.

import { PICTURE_PLACES, playerElement, playerFor, sizePlayer, widthOf } from "./content.js";
import { createHistory } from "./history.js";
import { el } from "./util.js";

// a copy from this box, pasted back in: its own words, as they are
const OWN = "application/x-techtrash-markdown";
// pictures come from the web or this site, as content.js has it
const SAFE_ADDRESS = /^(?:https?:|\/(?!\/)|#|\?)/i;
const parser = new DOMParser();   // its documents aren't shown, and load nothing

// --- drawing a line --------------------------------------------------------------

const text = (value) => document.createTextNode(value);
const span = (look, ...content) => el("span", { class: look }, content.flat().map((part) => (typeof part === "string" ? text(part) : part)));
const mark = (value) => span("md-mark", value);

// A part that isn't text: a picture, a player, a divider, drawn for the
// characters [start, end) of its line. It isn't part of the Markdown.
function widget(node, start, end, inline = true) {
  const part = inline ? el("span", {}, node) : node;
  part.classList.add("md-widget");
  part.setAttribute("contenteditable", "false");
  part.dataset.start = start;
  part.dataset.end = end;
  return part;
}

// Words, and what's inside them: code, pictures, links, bold, italic,
// strikethrough, a hue, underline, any other HTML, and bare addresses.
// The earliest match wins, in this order where two start together.
const INLINE = [
  ["code", /`([^`]+)`/y],
  ["image", /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/y],
  ["link", /\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/y],
  ["img", /<img\b[^>]*>/iy],
  ["hue", /<span class="(hue-[1-6])">(.+?)<\/span>/y],
  ["underline", /<u>(.+?)<\/u>/y],
  ["strong", /(\*\*|__)(?=\S)(.+?)(?<=\S)\1/y],
  ["strike", /~~(?=\S)(.+?)(?<=\S)~~/y],
  ["em", /(\*|_)(?=\S)(.+?)(?<=\S)\1/y],
  ["tag", /<\/?[a-z][^>]*>/iy],
  ["address", /https?:\/\/[^\s<>]*[^\s<>.,;:!?)\]'"]/y],
];

// Words, drawn into out; base is where they start in their line.
function inline(words, base, out) {
  let plain = "";
  const flush = () => {
    if (plain) out.push(text(plain));
    plain = "";
  };
  for (let i = 0; i < words.length;) {
    let found = null;
    for (const [kind, pattern] of INLINE) {
      pattern.lastIndex = i;
      const m = pattern.exec(words);
      // (an underscore inside a word, snake_case, isn't emphasis)
      if (!m || (["em", "strong"].includes(kind) && m[1][0] === "_" && /\w/.test(words[i - 1] ?? ""))) continue;
      found = [kind, m];
      break;
    }
    if (!found) {
      plain += words[i];
      i += 1;
      continue;
    }
    flush();
    const [kind, m] = found;
    const at = base + i;
    const inner = (part, offset) => inline(part, at + offset, []);
    if (kind === "code") out.push(mark("`"), span("md-code", m[1]), mark("`"));
    else if (kind === "image") out.push(...picture(m[0], at, { src: m[2], alt: m[1] }));
    else if (kind === "img") out.push(...picture(m[0], at, attributesOf(m[0])));
    else if (kind === "link") {
      out.push(mark("["), span("md-link", inner(m[1], 1)), mark("]("), span("md-url", m[0].slice(m[1].length + 3, -1)), mark(")"));
    } else if (kind === "hue") {
      const open = m[0].slice(0, m[0].indexOf(">") + 1);
      out.push(mark(open), span(`md-hue ${m[1]}`, inner(m[2], open.length)), mark("</span>"));
    } else if (kind === "underline") out.push(mark("<u>"), span("md-u", inner(m[1], 3)), mark("</u>"));
    else if (kind === "strong") out.push(mark(m[1]), span("md-strong", inner(m[2], m[1].length)), mark(m[1]));
    else if (kind === "strike") out.push(mark("~~"), span("md-strike", inner(m[1], 2)), mark("~~"));
    else if (kind === "em") out.push(mark(m[1]), span("md-em", inner(m[2], m[1].length)), mark(m[1]));
    else if (kind === "tag") out.push(span("md-tag", m[0]));
    else out.push(span("md-link", m[0]));
    i += m[0].length;
  }
  flush();
  return out;
}

// An <img>'s attributes, read without it loading.
function attributesOf(tag) {
  const img = parser.parseFromString(tag, "text/html").querySelector("img");
  return img ? { src: img.getAttribute("src"), alt: img.getAttribute("alt"), width: img.getAttribute("width"), place: img.getAttribute("class") } : {};
}

// A picture's source (out of sight on a line the cursor isn't on), and the
// picture, at its own width and in its place.
function picture(source, at, { src, alt, width, place }) {
  const out = [span("md-source", source)];
  if (src && SAFE_ADDRESS.test(src.trim())) {
    const img = el("img", { src: src.trim(), alt: alt ?? "", loading: "lazy" });
    const size = widthOf(width);
    if (size) img.setAttribute("width", size);
    const where = (place ?? "").split(/\s+/).find((name) => PICTURE_PLACES.includes(name));
    if (where) img.classList.add(where);
    out.push(widget(img, at, at + source.length));
  }
  return out;
}

// A line that's a player: a video's or a song's link on its own, or that link
// at a width of its own, the way a post keeps it (<p data-width>).
function playerLine(line) {
  let address = line.match(/^\s*(https?:\/\/\S+)\s*$/)?.[1];
  let width = null;
  if (!address && /^\s*<p data-width="\d{1,4}">\s*<a href="[^"]+">[^<]*<\/a>\s*<\/p>\s*$/.test(line)) {
    const p = parser.parseFromString(line, "text/html").querySelector("p");
    address = p?.querySelector("a")?.getAttribute("href");
    width = widthOf(p?.getAttribute("data-width"));
  }
  const player = address && playerFor(address);
  return player ? { player, address, width } : null;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

// One line drawn, given the code fence it's in (if it's in one). Gives back
// the line, and the fence the next one's in.
function drawLine(line, fence, tools) {
  const node = el("div", { class: "md-line" });
  const out = [];
  let kind = "paragraph";
  let after = fence;
  let m;
  if (fence) {
    const closes = /^\s{0,3}[`~]+\s*$/.test(line) && line.trim()[0] === fence[0] && line.trim().length >= fence.length;
    kind = closes ? "fence" : "codeline";
    if (closes) after = null;
    out.push(line);
  } else if ((m = line.match(FENCE))) {
    kind = "fence";
    after = m[1];
    out.push(line);
  } else if (!line.trim()) {
    kind = "blank";
    out.push(line);
  } else if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
    kind = "rule";
    out.push(span("md-source", line), widget(el("span", { class: "md-rule" }), 0, line.length));
  } else if ((m = line.match(/^(#{1,6})(\s+)(.*)$/))) {
    // "#" is a post's top heading (h2: its title is the h1), "####" and down its smallest
    kind = `h${Math.min(4, Math.max(2, m[1].length))}`;
    out.push(mark(m[1] + m[2]));
    inline(m[3], m[1].length + m[2].length, out);
  } else if ((m = line.match(/^(\s{0,3}>\s?)(.*)$/))) {
    kind = "quote";
    out.push(mark(m[1]));
    inline(m[2], m[1].length, out);
  } else if ((m = line.match(/^(\s*)([-*+]|\d{1,9}[.)])(\s+)(.*)$/))) {
    kind = "item";
    out.push(m[1], span("md-bullet", m[2]), m[3]);
    inline(m[4], m[1].length + m[2].length + m[3].length, out);
  } else if ((m = playerLine(line))) {
    kind = "player";
    out.push(span("md-source", line), widget(tools.player(m), 0, line.length, false));
  } else {
    if (/^\s*\|/.test(line)) kind = "table";
    inline(line, 0, out);
  }
  node.classList.add(`md-${kind}`);
  node.append(...out.filter((part) => part !== "").map((part) => (typeof part === "string" ? text(part) : part)));
  if (!line) node.append(el("br"));   // an empty line, held open
  node.dataset.before = fence ?? "";
  node.dataset.after = after ?? "";
  return { node, after };
}

// --- the box ---------------------------------------------------------------------

export function createLiveMarkdown({ onChange = () => {}, onFiles = () => {}, toMarkdown = null, short = false } = {}) {
  const box = el("div", {
    class: `md-live${short ? " editor__area--short" : ""}`,
    contenteditable: "true",
    role: "textbox",
    "aria-multiline": "true",
    "aria-label": "The post, in Markdown",
    "data-placeholder": "Write in Markdown...",
    spellcheck: true,
  });
  let lines = [""];
  let composing = false;
  let dragging = null;
  const whole = () => lines.join("\n");
  const ordered = ([a, b]) => (a <= b ? [a, b] : [b, a]);

  // what a player's drawn as here: the player, and a bar to pick it by
  const tools = {
    player({ player, address, width }) {
      const frame = sizePlayer(playerElement(player), width);
      frame.dataset.address = address;
      const reset = el("button", { class: "tool", type: "button", textContent: "Reset size", title: "As wide as the column" });
      const remove = el("button", { class: "tool", type: "button", textContent: "Remove" });
      reset.addEventListener("click", () => playerChanged(sizePlayer(frame, null)));
      remove.addEventListener("click", () => removeSource(frame));
      frame.append(el("figcaption", { class: "embed__bar", title: "Click to pick it, then drag a corner to size it" },
        el("span", { class: "embed__address", textContent: address }), reset, remove));
      return frame;
    },
  };

  // --- the lines, drawn ------------------------------------------------------------

  function drawAll() {
    const nodes = [];
    let fence = null;
    for (const line of lines) {
      const drawn = drawLine(line, fence, tools);
      nodes.push(drawn.node);
      fence = drawn.after;
    }
    box.replaceChildren(...nodes);
  }

  // The box's nodes [from, upTo) out, and lines [from, from + count) drawn in
  // their place; then any after them that a code fence opening or closing has
  // moved in or out of code.
  function redraw(from, upTo, count) {
    let fence = (from > 0 && box.childNodes[from - 1]?.dataset?.after) || null;
    const fresh = [];
    for (let i = from; i < from + count; i++) {
      const drawn = drawLine(lines[i], fence, tools);
      fresh.push(drawn.node);
      fence = drawn.after;
    }
    const nodes = [...box.childNodes];
    const next = nodes[upTo] ?? null;
    for (const node of nodes.slice(from, upTo)) node.remove();
    if (next) next.before(...fresh);
    else box.append(...fresh);
    for (let i = from + count; i < lines.length; i++) {
      const node = box.children[i];
      if (!node || (node.dataset.before || null) === fence) break;
      const drawn = drawLine(lines[i], fence, tools);
      node.replaceWith(drawn.node);
      fence = drawn.after;
    }
  }

  // The lines a node of the box holds, as text (a browser's change can leave
  // anything): its words, not a picture's or a player's; a line break where a
  // <br> or a block inside it breaks it (not a <br> that only holds an empty
  // line open, last in its line).
  function linesOf(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.data.replace(/ /g, " ").split("\n");
    const out = [""];
    const walk = (parent) => {
      for (const child of parent.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) out[out.length - 1] += child.data.replace(/ /g, " ");
        else if (child.nodeType !== Node.ELEMENT_NODE || child.classList.contains("md-widget")) continue;
        else if (child.nodeName === "BR") {
          if (child.nextSibling && !(child.nextSibling.nodeType === Node.TEXT_NODE && !child.nextSibling.data && !child.nextSibling.nextSibling)) out.push("");
        } else if (/^(?:DIV|P|LI|H[1-6]|BLOCKQUOTE|PRE)$/.test(child.nodeName)) {
          if (out[out.length - 1] || out.length > 1) out.push("");
          walk(child);
        } else walk(child);
      }
    };
    walk(node);
    return out;
  }

  // Where a point in the box is, as how far into the Markdown.
  function offsetOf(node, offset) {
    const range = document.createRange();
    range.setStart(box, 0);
    range.setEnd(node, offset);
    const parts = [...range.cloneContents().childNodes].filter((part) => part.nodeType !== Node.TEXT_NODE || part.data);
    return parts.map((part) => linesOf(part).join("\n")).join("\n").length;
  }
  function selection() {
    const s = getSelection();
    if (!s.rangeCount || !box.contains(s.anchorNode) || !box.contains(s.focusNode)) return null;
    return [offsetOf(s.anchorNode, s.anchorOffset), offsetOf(s.focusNode, s.focusOffset)];
  }
  // ...and back: the line, and the place in its words
  function point(offset) {
    let left = Math.max(0, Math.min(offset, whole().length));
    let i = 0;
    while (i < lines.length - 1 && left > lines[i].length) {
      left -= lines[i].length + 1;
      i += 1;
    }
    const line = box.children[i];
    if (!line) return [box, 0];
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (node.parentElement.closest(".md-widget") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let last = null;
    for (let node; (node = walker.nextNode());) {
      if (left <= node.data.length) return [node, left];
      left -= node.data.length;
      last = node;
    }
    return last ? [last, last.data.length] : [line, 0];
  }
  function select(at) {
    if (!at) return;
    const [anchor, focus] = [point(at[0]), point(at[1])];
    getSelection().setBaseAndExtent(anchor[0], anchor[1], focus[0], focus[1]);
  }

  // The lines the cursor (or a selection) is on show their Markdown.
  const lineIndex = (node) => {
    while (node && node.parentNode !== box) node = node.parentNode;
    return node ? Array.prototype.indexOf.call(box.children, node) : -1;
  };
  // (only while the box has the cursor: Firefox leaves its selection in the
  // box when a field, like the title, is clicked)
  function markActive() {
    const s = getSelection();
    let [from, to] = [-1, -1];
    if (box.contains(document.activeElement) && s.rangeCount && box.contains(s.anchorNode) && box.contains(s.focusNode)) {
      [from, to] = ordered([lineIndex(s.anchorNode), lineIndex(s.focusNode)]);
    }
    for (let i = 0; i < box.children.length; i++) box.children[i].classList.toggle("is-active", from >= 0 && i >= from && i <= to);
  }
  document.addEventListener("selectionchange", markActive);
  box.addEventListener("focus", markActive);
  box.addEventListener("blur", markActive);

  // --- changes -----------------------------------------------------------------------

  function changed() {
    box.classList.toggle("is-empty", !whole().trim());
    history.soon();
    onChange();
  }

  // New lines in place of the old, drawing only those that changed, and the
  // cursor (or a selection) where it's said to go.
  function commit(next, at) {
    if (!next.length) next = [""];
    let a = 0;
    while (a < lines.length && a < next.length && lines[a] === next[a]) a += 1;
    let b = lines.length;
    let nb = next.length;
    while (b > a && nb > a && lines[b - 1] === next[nb - 1]) {
      b -= 1;
      nb -= 1;
    }
    lines = next;
    redraw(a, b, nb - a);
    select(at);
    markActive();
    changed();
  }
  // The Markdown from start to end replaced, the cursor after what went in.
  function replace(start, end, words, caret = start + words.length) {
    const all = whole();
    commit((all.slice(0, start) + words + all.slice(end)).split("\n"), [caret, caret]);
  }

  // After the browser's own change (typing, deleting): the lines it touched,
  // read back as Markdown and drawn again, the cursor where it was.
  function update() {
    for (const node of [...box.childNodes]) if (node.nodeType === Node.TEXT_NODE && !node.data) node.remove();
    const at = selection();
    const nodes = [...box.childNodes];
    const read = nodes.map(linesOf);
    const clean = (i) => nodes[i].nodeType === Node.ELEMENT_NODE && nodes[i].classList.contains("md-line") && read[i].length === 1;
    let a = 0;
    while (a < nodes.length && a < lines.length && clean(a) && read[a][0] === lines[a]) a += 1;
    let b = nodes.length;
    let lb = lines.length;
    while (b > a && lb > a && clean(b - 1) && read[b - 1][0] === lines[lb - 1]) {
      b -= 1;
      lb -= 1;
    }
    const middle = read.slice(a, b).flat();
    lines = [...lines.slice(0, a), ...middle, ...lines.slice(lb)];
    if (!lines.length) {
      lines = [""];
      drawAll();
    } else redraw(a, b, middle.length);
    select(at);
    markActive();
    changed();
  }

  box.addEventListener("input", () => {
    if (!composing) update();
  });
  box.addEventListener("compositionstart", () => { composing = true; });
  box.addEventListener("compositionend", () => {
    composing = false;
    update();
  });

  // Enter: a new line, carrying a list or a quote on. An empty item ends it,
  // with an empty line after it, so what's written next is a paragraph of its
  // own (straight under an item, it'd be more of that item).
  function enter() {
    const at = selection();
    if (!at) return;
    const [start, end] = ordered(at);
    const all = whole();
    const lineStart = all.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = all.indexOf("\n", start) === -1 ? all.length : all.indexOf("\n", start);
    const line = all.slice(lineStart, lineEnd);
    let carry = "";
    if (start === end && start === lineEnd) {
      const item = line.match(/^(\s*)(?:([-*+])|(\d{1,9})([.)]))(\s+)(.*)$/);
      const quote = line.match(/^(\s{0,3}>\s?)(.*)$/);
      if ((item && !item[6].trim()) || (quote && !item && !quote[2].trim())) return replace(lineStart, lineEnd, "\n");
      if (item) carry = item[1] + (item[2] ?? `${Number(item[3]) + 1}${item[4]}`) + " ";
      else if (quote) carry = quote[1];
    }
    replace(start, end, `\n${carry}`);
  }

  // Words made bold, italic or underlined (or the marks, with the cursor between them).
  function wrap(open, close = open) {
    const at = selection();
    if (!at) return;
    const [start, end] = ordered(at);
    const words = whole().slice(start, end);
    replace(start, end, open + words + close, start === end ? start + open.length : end + open.length + close.length);
  }

  // Tab on a list's item: a step in (Shift+Tab: a step out).
  function indent(out) {
    const at = selection();
    if (!at) return false;
    const all = whole();
    const lineStart = all.lastIndexOf("\n", ordered(at)[0] - 1) + 1;
    const line = all.slice(lineStart, all.indexOf("\n", lineStart) === -1 ? all.length : all.indexOf("\n", lineStart));
    const item = line.match(/^(\s*)([-*+]|\d{1,9}[.)])\s/);
    if (!item) return false;
    const step = /\d/.test(item[2]) ? "   " : "  ";
    if (out) {
      const take = Math.min(step.length, item[1].length);
      if (!take) return true;
      commit((all.slice(0, lineStart) + all.slice(lineStart + take)).split("\n"), at.map((x) => Math.max(lineStart, x - take)));
    } else commit((all.slice(0, lineStart) + step + all.slice(lineStart)).split("\n"), at.map((x) => x + step.length));
    return true;
  }

  // Backspace at a line's start (or Delete at its end) takes out the line
  // break, and only it: the browsers' own would take a drawn picture or player
  // with it (Firefox, the line's words too).
  function joinLines(back) {
    const at = selection();
    if (!at || at[0] !== at[1]) return false;
    const all = whole();
    const spot = at[0];
    if (back ? spot === 0 || all[spot - 1] !== "\n" : all[spot] !== "\n") return false;
    replace(back ? spot - 1 : spot, back ? spot : spot + 1, "");
    return true;
  }

  box.addEventListener("beforeinput", (e) => {
    // (a phone's keyboard: no keydown first)
    if ((e.inputType === "deleteContentBackward" || e.inputType === "deleteContentForward") && !composing) {
      if (joinLines(e.inputType === "deleteContentBackward")) e.preventDefault();
      return;
    }
    const handle = {
      insertParagraph: enter,
      insertLineBreak: enter,
      historyUndo: () => history.undo(),
      historyRedo: () => history.redo(),
      formatBold: () => wrap("**"),
      formatItalic: () => wrap("*"),
      formatUnderline: () => wrap("<u>", "</u>"),
    }[e.inputType];
    if (!handle) return;
    e.preventDefault();
    handle();
  });
  box.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === "z" && !e.shiftKey) {
      e.preventDefault();
      history.undo();
    } else if (mod && (key === "y" || (key === "z" && e.shiftKey))) {
      e.preventDefault();
      history.redo();
    } else if (mod && key === "b") {
      e.preventDefault();
      wrap("**");
    } else if (mod && key === "i") {
      e.preventDefault();
      wrap("*");
    } else if (e.key === "Tab" && !composing && indent(e.shiftKey)) e.preventDefault();
    else if ((e.key === "Backspace" || e.key === "Delete") && !composing && !e.altKey && joinLines(e.key === "Backspace")) e.preventDefault();
  });

  // A click on a picture or a player picks it (editor.js): the cursor stays put.
  // A divider has nothing to pick: a click on it puts the cursor at the end of
  // its line, to show its --- (and take it out).
  box.addEventListener("mousedown", (e) => {
    const part = e.target.closest(".md-widget");
    if (!part || e.target.closest("button")) return;
    e.preventDefault();
    if (!part.querySelector(".md-rule")) return;
    const i = lineIndex(part);
    const end = lines.slice(0, i + 1).reduce((n, line) => n + line.length + 1, 0) - 1;
    box.focus({ preventScroll: true });
    select([end, end]);
    markActive();
  });

  // --- copy, cut, paste, drag and drop: the Markdown's own words ----------------------

  function copy(e, cut) {
    const at = selection();
    if (!at) return;
    const [start, end] = ordered(at);
    if (start === end) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", whole().slice(start, end));
    e.clipboardData.setData(OWN, "1");
    if (cut) replace(start, end, "");
  }
  box.addEventListener("copy", (e) => copy(e, false));
  box.addEventListener("cut", (e) => copy(e, true));
  box.addEventListener("paste", (e) => {
    e.preventDefault();
    const data = e.clipboardData;
    const files = [...data.files];
    if (files.length) return onFiles(files);
    let words = data.getData("text/plain");
    const html = data.getData("text/html");
    if (html && !data.types.includes(OWN) && toMarkdown) {
      try {
        words = toMarkdown(html) || words;
      } catch {}
    }
    const at = selection();
    if (words && at) replace(...ordered(at), words.replace(/\r\n?/g, "\n"));
  });

  function offsetAt(x, y) {
    let node;
    let offset;
    const position = document.caretPositionFromPoint?.(x, y);
    if (position) [node, offset] = [position.offsetNode, position.offset];
    else {
      const range = document.caretRangeFromPoint?.(x, y);
      if (!range) return null;
      [node, offset] = [range.startContainer, range.startOffset];
    }
    return box.contains(node) ? offsetOf(node, offset) : null;
  }
  box.addEventListener("dragstart", (e) => {
    if (e.target.closest?.(".md-widget")) return e.preventDefault();   // a picture isn't dragged about: Up and Down move it
    const at = selection();
    if (!at) return;
    dragging = ordered(at);
    e.dataTransfer.setData("text/plain", whole().slice(...dragging));
    e.dataTransfer.setData(OWN, "1");
  });
  box.addEventListener("dragend", () => { dragging = null; });
  box.addEventListener("dragover", (e) => e.preventDefault());
  box.addEventListener("drop", (e) => {
    e.preventDefault();
    const at = offsetAt(e.clientX, e.clientY);
    const files = [...e.dataTransfer.files];
    if (files.length) {
      if (at != null) select([at, at]);
      return onFiles(files);
    }
    const words = e.dataTransfer.getData("text/plain");
    if (!words || at == null) return;
    if (dragging && e.dataTransfer.types.includes(OWN)) {
      // words moved: out of where they were, in where they're dropped
      const [start, end] = dragging;
      dragging = null;
      if (at >= start && at <= end) return;
      const all = whole();
      const without = all.slice(0, start) + all.slice(end);
      const where = at > end ? at - (end - start) : at;
      commit((without.slice(0, where) + words + without.slice(where)).split("\n"), [where, where + words.length]);
    } else replace(at, at, words);
  });

  // --- pictures and players, picked in editor.js -------------------------------------

  // the line a picture or a player is drawn on, and where its source is in it
  function sourceOf(node) {
    const part = node.closest(".md-widget");
    const line = part?.closest(".md-line");
    if (!line || line.parentNode !== box) return null;
    return { index: lineIndex(line), start: Number(part.dataset.start), end: Number(part.dataset.end) };
  }
  // the same one, drawn again
  const again = (index, start) => {
    const part = [...(box.children[index]?.querySelectorAll(".md-widget") ?? [])].find((p) => Number(p.dataset.start) === start);
    return part?.matches(".embed") ? part : part?.querySelector("img") ?? null;
  };
  const quote = (value) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

  function rewrite(node, source) {
    const at = sourceOf(node);
    if (!at) return null;
    const next = [...lines];
    next[at.index] = next[at.index].slice(0, at.start) + source + next[at.index].slice(at.end);
    commit(next, selection());
    return again(at.index, at.start);
  }
  // A picture's source, from what's been made of it: Markdown, or an <img>
  // once it has a width or a place of its own. Gives back the picture drawn again.
  function pictureChanged(img) {
    const src = img.getAttribute("src");
    const alt = img.getAttribute("alt") ?? "";
    const width = widthOf(img.getAttribute("width"));
    const place = [...img.classList].find((name) => PICTURE_PLACES.includes(name));
    return rewrite(img, width || place
      ? `<img src="${quote(src)}" alt="${quote(alt)}"${width ? ` width="${width}"` : ""}${place ? ` class="${place}"` : ""}>`
      : `![${alt.replace(/[[\]]/g, "")}](${src})`);
  }
  // A player's line, from its width: its link alone, or at its width.
  function playerChanged(frame) {
    const address = frame.dataset.address;
    const width = widthOf(frame.dataset.width);
    return rewrite(frame, width ? `<p data-width="${width}"><a href="${quote(address)}">${quote(address)}</a></p>` : address);
  }
  // Its line, up or down one.
  function moveLine(node, up) {
    const at = sourceOf(node);
    if (!at) return node;
    const to = at.index + (up ? -1 : 1);
    if (to < 0 || to >= lines.length) return node;
    const next = [...lines];
    [next[at.index], next[to]] = [next[to], next[at.index]];
    commit(next, null);
    return again(to, at.start);
  }
  // Its source out (and its line, if that leaves nothing on it).
  function removeSource(node) {
    const at = sourceOf(node);
    if (!at) return;
    const next = [...lines];
    const rest = next[at.index].slice(0, at.start) + next[at.index].slice(at.end);
    if (rest.trim()) next[at.index] = rest;
    else next.splice(at.index, 1);
    commit(next, null);
  }

  // --- Undo and Redo ---------------------------------------------------------------

  const history = createHistory(
    () => ({ content: whole(), caret: selection()?.[1] ?? null }),
    (state) => {
      lines = state.content.split("\n");
      drawAll();
      box.focus({ preventScroll: true });
      if (state.caret != null) select([state.caret, state.caret]);
      markActive();
      box.classList.toggle("is-empty", !whole().trim());
      onChange();
    });

  return {
    element: box,
    text: whole,
    setText(value) {
      lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
      drawAll();
      markActive();
      box.classList.toggle("is-empty", !whole().trim());
      history.reset();
    },
    insert(words) {
      const at = selection() ?? [whole().length, whole().length];
      box.focus({ preventScroll: true });
      replace(...ordered(at), words);
    },
    focus() {
      box.focus({ preventScroll: true });
      if (!selection()) select([whole().length, whole().length]);
    },
    owns: (node) => box.contains(node),
    column() {
      const look = getComputedStyle(box);
      return box.clientWidth - parseFloat(look.paddingLeft) - parseFloat(look.paddingRight);
    },
    pictureChanged,
    playerChanged,
    moveLine,
    removeSource,
    undo: () => history.undo(),
    redo: () => history.redo(),
  };
}
