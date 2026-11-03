// techtrash.org : the admin's post editor.
//
// What you see is what the post looks like: the box is drawn the way a post
// is. The buttons over it are the browser's own editing (execCommand), so
// Ctrl+Z and Ctrl+Y know about what they do. On top of that:
//
//   - A picture goes in where the cursor is, from the picture button, a paste
//     or a drop, and is uploaded as it goes. Click one to say what's in it
//     and where it sits: across the column, or small on the left, middle or
//     right with the words around it.
//   - A video's or a song's link on a line of its own becomes its player
//     (content.js says whose): the video button, or paste the link on an
//     empty line.
//   - A Markdown file comes in where the cursor is: the .md button, or drop
//     it on the box.
//   - Anything pasted from another page keeps its bold, lists, links and so
//     on, but not its looks: it's cleaned the way a post is.
//   - A picture or a player moves up or down a line with its Up and Down
//     buttons (click a picture for them; a player has them under it).
//   - A picture on the left or the right has the words beside it: it's kept
//     the first thing in the paragraph whose words go beside it (words typed
//     in front of it would put it below them), and choosing Left or Right puts
//     the cursor right after it, to type beside it.
//   - The lines after a picture on the left or the right go beside it, as far
//     down as it goes. Enter on an empty line beside it puts that line under
//     it (a class the post keeps), so Enter, Enter gets out from beside it.
//   - Undo and Redo are its own (createHistory): the browser's only know the
//     changes the browser made, and this editor makes some of its own.
//   - The browser's own looks go as soon as it leaves them (joining a paragraph
//     to a heading keeps the paragraph's size in a span, so the line looks like
//     a paragraph and spaces like a heading): what's shown is what's saved.
//     An alignment, however the browser writes it (Chrome a style, Firefox an
//     align=""), becomes its class, and only the one.
//   - The space between paragraphs is always the same: an empty line (cutting
//     a whole paragraph leaves one, two Enters make one) goes as soon as the
//     cursor's off it and something changes, and none is ever saved.
//   - Every line is a block of its own, the same in every browser: Firefox
//     makes a <div> where Chrome makes a <p> (Enter after a heading), and can
//     leave words in no line at all. A <div> becomes a <p>, loose words go
//     into one, and the cursor stays where it was.
//   - A divider, a player, or a picture on a line of its own is a thing the
//     cursor can't be in. Backspace at the start of the line after one (or
//     Delete at the end of the line before one) takes a divider out, and picks
//     a picture or a player (Firefox would throw away the line's words, or its
//     heading); pressed again, it goes. A click picks one too. And the box
//     always ends on a line to type on, so what's typed under the last thing
//     goes under it, not above it.
//   - A picture or a player gets bigger or smaller by its corners: click it
//     (a player by its bar, under it) and drag one. It keeps its shape (a
//     song's player only gets wider), and never gets wider than the column.
//     Reset size puts it back to its own size (a player: the column's).
//   - Markdown is written live (live-markdown.js), the way Obsidian shows it:
//     the line the cursor's on is its Markdown, every other line is drawn the
//     way it'll look, pictures and players too, and they're picked and sized
//     the same way as here.
//   - It writes three ways: Rich text (all of the above), Markdown, or HTML,
//     switched at the top. What's written carries over from one to the next:
//     whatever Markdown can't say (a hue, where a picture sits, how wide it
//     is) stays as HTML in it. Pictures and players go in from any of the three.
//
// createEditor(html, { onChange, onTitle, onProblem, short }) gives back
//   { element, html(), empty(), focus() }
// where html() is what's written, as it'll be saved, onTitle(title) is told a
// Markdown file's title, onProblem(text) what went wrong (a picture that
// wouldn't upload: the box's own foot is only its word count), and short
// makes the box short, for a line or two.

import {
  blankLine, clean, embedPlayers, fromMarkdown, htmlToMarkdown, loadMarkdown, markdownToHtml, PICTURE_PLACES, playerElement, playerFor,
  playerIn, sizePlayer,
} from "./content.js";
import { createHistory } from "./history.js";
import { createLiveMarkdown } from "./live-markdown.js";
import { api, el, plural, readyPicture } from "./util.js";

// The six hues, by the names tokens.css gives them.
const HUES = ["red", "orange", "yellow", "green", "blue", "violet"];
const BLOCKS = new Set(["P", "H2", "H3", "H4", "PRE", "BLOCKQUOTE", "LI"]);
// what a line of the box can be; anything else straight in it is loose words
const LINES = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "PRE", "BLOCKQUOTE", "HR", "FIGURE", "TABLE", "DIV"]);
const PLAYERS = "YouTube, Vimeo, Dailymotion, Twitch, Streamable, Loom, TikTok, Spotify, SoundCloud, Apple Music, or a link to a video or sound file";
const LEAST_PICTURE = 32;   // how small a picture can be dragged, in pixels
const LEAST_PLAYER = 240;   // ...and a player, which is no use any smaller
const UNDER = "under-pic";  // a line that starts under the pictures beside the lines before it

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const BLOCK_TAG = /<(?:p|h[1-6]|ul|ol|li|pre|blockquote|table|hr|figure|div)\b/i;

// Puts HTML in where the cursor is. Given a lone <code> (or the like) and
// nothing after it, Chrome swaps it for a <span> that only looks like one;
// an invisible space after it stops that, and html() takes it out again.
function insertHtml(html) {
  document.execCommand("insertHTML", false, BLOCK_TAG.test(html) ? html : `${html}\u200B`);
}
const escape = (text) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const isMarkdown = (file) => /\.(?:md|markdown|mdown|mkd)$/i.test(file.name) || file.type === "text/markdown";

// --- the browser's marks, made a post's ----------------------------------------------

// A color as #rrggbb, however it's written, to match colors up.
const paint = document.createElement("canvas").getContext("2d");
function normalColor(color) {
  paint.fillStyle = "#000000";
  paint.fillStyle = color;
  return paint.fillStyle;
}
let hueByColor;
const hueOfColor = (color) => {
  hueByColor ??= new Map(HUES.map((_, i) => [normalColor(cssVar(`--site-hue-${i + 1}`)), i + 1]));
  return hueByColor.get(normalColor(color));
};

// Editing leaves the browser's own marks: <font color>, style="...", <div>,
// <b>. This turns them into what a post uses (a hue's class, an alignment's
// class, <p>, <strong>) before it's cleaned, which throws out anything else.
//
// It works on a copy in a document of its own that isn't shown (inert()): in
// this page's document, a pasted <img onerror> would load, and run, before
// it was ever cleaned.
const inert = () => document.implementation.createHTMLDocument("");

// A line's alignment, however the browser wrote it (Chrome: style="text-align:
// right"; Firefox: align="right"), as the class a post uses, and only that
// one: the line it was carried on from (Enter carries it) may have another.
function lineUp(node) {
  const align = (node.style.textAlign || node.getAttribute("align") || "").toLowerCase();
  node.removeAttribute("align");
  if (!align) return;
  node.classList.remove("align-center", "align-right");
  if (align === "center" || align === "right") node.classList.add(`align-${align}`);
}

function tidy(root) {
  const doc = root.ownerDocument;
  for (const node of root.querySelectorAll("[style], [align], font")) {
    lineUp(node);
    const color = node.getAttribute("color") || node.style.color;
    node.removeAttribute("style");
    const hue = color && hueOfColor(color);
    if (hue) {
      const span = doc.createElement("span");
      span.className = `hue-${hue}`;
      span.append(...node.childNodes);
      if (node.matches("font, span")) node.replaceWith(span);
      else node.append(span);
    } else if (node.matches("font")) node.replaceWith(...node.childNodes);
  }
  for (const node of root.querySelectorAll("div")) {
    if (node.querySelector("p, div, h2, h3, h4, ul, ol, blockquote, pre, table, hr")) node.replaceWith(...node.childNodes);
    else rename(node, "p");
  }
  for (const [from, to] of [["b", "strong"], ["i", "em"], ["strike", "s"], ["h1", "h2"], ["h5", "h4"], ["h6", "h4"]]) {
    for (const node of root.querySelectorAll(from)) rename(node, to);
  }
  // insertHtml's invisible spaces
  const text = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node; (node = text.nextNode());) {
    if (node.data.includes("\u200B")) node.data = node.data.replaceAll("\u200B", "");
  }
  return root;
}

function rename(node, tag) {
  const renamed = node.ownerDocument.createElement(tag);
  if (node.className) renamed.className = node.className;
  renamed.append(...node.childNodes);
  node.replaceWith(renamed);
}

// Where a cursor is in a box, as how many characters into its text, and back.
function caretIn(box) {
  const selection = getSelection();
  if (!selection.rangeCount || !box.contains(selection.focusNode)) return null;
  const range = document.createRange();
  range.setStart(box, 0);
  range.setEnd(selection.focusNode, selection.focusOffset);
  return range.toString().length;
}
function putCaret(box, offset, skip = () => false) {
  if (offset == null) return;
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  let left = offset;
  let last = null;
  for (let node; (node = walker.nextNode());) {
    if (left <= node.data.length && !skip(node)) {
      const range = document.createRange();
      range.setStart(node, left);
      range.collapse(true);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    left -= node.data.length;
    if (!skip(node)) last = node;
  }
  if (last) putCaret(box, offset - left, skip);
}

const tidyHtml = (html) => {
  const doc = inert();
  doc.body.innerHTML = html;
  return tidy(doc.body).innerHTML;
};

// --- the editor ------------------------------------------------------------------

export function createEditor(start, { onChange = () => {}, onTitle = () => {}, onProblem = () => {}, short = false } = {}) {
  const useParagraphs = () => {
    document.execCommand("defaultParagraphSeparator", false, "p");
    document.execCommand("styleWithCSS", false, false);
  };
  useParagraphs();

  const area = el("div", {
    class: `editor__area prose${short ? " editor__area--short" : ""}`,
    contenteditable: "true",
    role: "textbox",
    "aria-multiline": "true",
    "aria-label": "The post",
    "data-placeholder": "Write something...",
    spellcheck: true,
  });
  // (Firefox only takes them once the box has the cursor: before, Enter after
  // a heading makes a <div>)
  area.addEventListener("focus", useParagraphs);
  const modes = el("div", { class: "editor__modes", role: "group", "aria-label": "Write in" });
  const tools = el("div", { class: "editor__tools", role: "toolbar", "aria-label": "Formatting" });
  const sourceTools = el("div", { class: "editor__tools", role: "toolbar", "aria-label": "Put in", hidden: true });
  // Markdown or HTML, as text
  const source = el("textarea", {
    class: `editor__source${short ? " editor__area--short" : ""}`, hidden: true, spellcheck: true, "aria-label": "The post, as text",
  });
  const ask = el("div", { class: "editor__row", hidden: true });
  const pictureRow = el("div", { class: "editor__row", hidden: true });
  const count = el("span", { class: "editor__count" });
  const picturePicker = el("input", { type: "file", accept: "image/*", multiple: true, hidden: true });
  const markdownPicker = el("input", { type: "file", accept: ".md,.markdown,.mdown,.mkd,text/markdown", hidden: true });
  // Markdown, written live, in place of a box of text
  const markdown = createLiveMarkdown({
    short,
    onChange: () => {
      onChange();
      clearTimeout(counting);
      counting = setTimeout(countWords, 300);
    },
    onFiles: (files) => {
      const file = files.find(isMarkdown);
      if (file) file.text().then((words) => markdown.insert(words));
      else addPictures(files);
    },
    toMarkdown: (html) => htmlToMarkdown(clean(tidyHtml(html))),
  });
  markdown.element.hidden = true;
  const element = el("div", { class: "editor" },
    el("div", { class: "editor__head" }, modes, tools, sourceTools, ask, pictureRow),
    area,
    markdown.element,
    source,
    el("div", { class: "editor__foot meta" }, count),
    picturePicker, markdownPicker);

  let mode = "rich";   // or "markdown", or "html": see setMode

  // --- where the cursor is --------------------------------------------------------

  // Where the cursor last was in the box, so a button (or a field above it)
  // can put it back before doing its thing.
  let saved = null;
  document.addEventListener("selectionchange", () => {
    const selection = getSelection();
    if (!selection.rangeCount || !area.contains(selection.anchorNode)) return;
    saved = selection.getRangeAt(0).cloneRange();
    showState();
  });

  function select(range) {
    area.focus({ preventScroll: true });
    if (!range || !area.contains(range.startContainer)) {
      range = document.createRange();
      range.selectNodeContents(area);
      range.collapse(false);
    }
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
  const restore = () => select(saved);
  const here = () => (getSelection().rangeCount ? getSelection().getRangeAt(0).cloneRange() : saved);

  // the element of `tag` the cursor is in, if it is
  function inside(tag) {
    let node = saved?.startContainer;
    while (node && node !== area) {
      if (node.nodeType === Node.ELEMENT_NODE && node.matches(tag)) return node;
      node = node.parentNode;
    }
    return null;
  }
  const currentBlock = () => {
    for (let node = saved?.startContainer; node && node !== area; node = node.parentNode) {
      if (BLOCKS.has(node.nodeName)) return node;
    }
    return null;
  };
  // the line the cursor's on, as a child of the box
  const lineOf = (node) => {
    while (node && node.parentNode !== area) node = node.parentNode;
    return node;
  };
  const isEmptyLine = (node) => node?.matches?.("p") && !node.textContent.trim() && !node.querySelector("img");

  // After any change to the box: every line a block, no empty line but the
  // cursor's, and a line at the end to type on.
  function changed() {
    if (mode === "rich") {
      settleLines();
      dropBlankLines();
      endLine();
      settleUnder();
      history.soon();
    }
    area.classList.toggle("is-empty", empty());
    onChange();
  }

  // Undo and Redo, of the box: what's in it (players as their links, so they
  // come back working) and where the cursor was.
  const history = createHistory(
    () => ({ content: snapshot(), caret: caretIn(area) }),
    (state) => {
      area.innerHTML = state.content;
      embedPlayers(area, playerBlock);
      endLine();
      pick(null);
      area.focus({ preventScroll: true });
      putCaret(area, state.caret, (node) => Boolean(node.parentElement.closest(".embed")));
      area.classList.toggle("is-empty", empty());
      countWords();
      onChange();
    });
  function snapshot() {
    const copy = inert().importNode(area, true);
    playersAsLinks(copy);
    for (const node of copy.querySelectorAll(".is-picked")) node.classList.remove("is-picked");
    return copy.innerHTML;
  }
  // a player in the box, as the line its link is on in a post
  function playersAsLinks(copy) {
    for (const box of copy.querySelectorAll("[data-address]")) {
      box.replaceWith(el("p", { "data-width": box.dataset.width }, el("a", { href: box.dataset.address, textContent: box.dataset.address })));
    }
  }

  // What the browser did, made the box's own; and the words counted, a
  // moment after the typing stops.
  let counting;
  area.addEventListener("input", () => {
    settleLines();
    dropStyles();
    for (const img of area.querySelectorAll("img.pic--left, img.pic--right")) keepBeside(img);
    changed();
    clearTimeout(counting);
    counting = setTimeout(countWords, 300);
  });
  const words = (text) => text.split(/\s+/).filter(Boolean).length;
  const countWords = () => {
    if (mode !== "rich") {
      count.textContent = plural(words((mode === "markdown" ? markdown.text() : source.value).replace(/<[^>]*>|[#*_`>|-]/g, " ")), "word");
      return;
    }
    const players = [...area.querySelectorAll(".embed__bar")].reduce((n, bar) => n + words(bar.innerText), 0);
    count.textContent = plural(words(area.innerText) - players, "word");
  };

  const run = (command, value = null) => {
    restore();
    document.execCommand(command, false, value);
    changed();
  };

  // A block (a heading, a quote...) on the cursor's line, or back to a paragraph if it already is one.
  const block = (tag) => {
    const now = tag === "blockquote" ? inside("blockquote") : currentBlock();
    run("formatBlock", now?.nodeName === tag.toUpperCase() ? "p" : tag);
  };

  function inlineCode() {
    restore();
    const code = inside("code");
    if (code && !code.closest("pre")) {
      const range = document.createRange();
      range.selectNode(code);
      select(range);
      document.execCommand("insertText", false, code.textContent);
    } else {
      const text = getSelection().toString();
      if (!text) return;   // (it's for words picked out)
      insertHtml(`<code>${escape(text)}</code>`);
    }
    changed();
  }

  // Puts a block (a player, a divider) on its own line after the cursor's,
  // or in place of the cursor's line if it's empty, with a line after it to
  // carry on typing on.
  function insertBlock(node, at = saved) {
    // (a cursor in the box itself, between two lines: the line before it)
    const line = at?.startContainer === area ? area.childNodes[Math.max(0, at.startOffset - 1)] ?? null : lineOf(at?.startContainer);
    if (isEmptyLine(line)) line.replaceWith(node);
    else if (line) line.after(node);
    else area.append(node);
    if (!node.nextElementSibling || !node.nextElementSibling.matches("p")) node.after(el("p", {}, el("br")));
    const next = document.createRange();
    next.setStart(node.nextElementSibling, 0);
    select(next);
    changed();
  }

  // --- players --------------------------------------------------------------------

  // A player in the box: the real one, to see it's the right video, with the
  // link it came from and a button to take it out. The post keeps the link
  // (and the player's width, if it has one of its own). Clicking its bar
  // picks it, to drag it bigger or smaller by its corners.
  function playerBlock(player, address, width = null) {
    const box = sizePlayer(playerElement(player), width);
    box.contentEditable = "false";
    box.dataset.address = address;
    const reset = el("button", { class: "tool", type: "button", textContent: "Reset size", title: "As wide as the column" });
    reset.addEventListener("click", () => {
      sizePlayer(box, null);
      changed();
    });
    const remove = el("button", { class: "tool", type: "button", textContent: "Remove" });
    remove.addEventListener("click", () => {
      box.remove();
      changed();
    });
    const up = el("button", { class: "tool", type: "button", textContent: "Up", title: "Up a line" });
    const down = el("button", { class: "tool", type: "button", textContent: "Down", title: "Down a line" });
    up.addEventListener("click", () => move(box, true));
    down.addEventListener("click", () => move(box, false));
    box.append(el("figcaption", { class: "embed__bar", title: "Click to pick it, then drag a corner to size it" },
      el("span", { class: "embed__address", textContent: address }), up, down, reset, remove));
    return box;
  }

  function addPlayer(address) {
    const player = playerFor(address);
    if (!player) return `That isn't a link I can play. Try ${PLAYERS}.`;
    // on a line of its own, it plays
    if (mode === "markdown") typeIn(`\n\n${address}\n\n`);
    else if (mode === "html") typeIn(`\n<p>${escape(address)}</p>\n`);
    else insertBlock(playerBlock(player, address));
    return null;
  }

  // A player's link, typed on a line of its own: it turns into the player on Enter.
  area.addEventListener("keyup", (e) => {
    if (e.key !== "Enter") return;
    const before = lineOf(here()?.startContainer)?.previousElementSibling;
    const found = before?.matches("p") && playerIn(before);
    if (found) {
      before.replaceWith(playerBlock(found.player, found.address, found.width));
      changed();
    }
  });

  // Moves a picture or a player up or down a line. A picture with words beside
  // it first gets a line of its own.
  function move(item, up) {
    const line = lineOf(item);
    const alone = line === item || (line.matches("p") && !line.textContent.trim() && line.querySelectorAll("img").length === 1);
    if (!alone) {
      const own = el("p");
      own.append(item);
      if (up) line.before(own);
      else line.after(own);
    } else {
      const next = up ? line.previousElementSibling : line.nextElementSibling;
      if (!next) return;
      if (up) next.before(line);
      else next.after(line);
    }
    item.scrollIntoView({ block: "nearest" });
    changed();
  }

  // --- pictures -------------------------------------------------------------------

  async function addPictures(files, at) {
    for (const file of files.filter((f) => f.type.startsWith("image/"))) {
      try {
        const form = new FormData();
        form.append("picture", await readyPicture(file), file.name || "picture");
        const { url } = await api("/api/blog/pictures", { method: "POST", form });
        if (mode !== "rich") {
          typeIn(mode === "markdown" ? `\n\n![](${url})\n\n` : `\n<p><img src="${url}" alt=""></p>\n`);
          continue;
        }
        select(at);
        document.execCommand("insertImage", false, url);
        for (const img of area.querySelectorAll(`img[src="${CSS.escape(url)}"]:not([alt])`)) img.alt = "";
        at = here();   // the next one goes after this one
        changed();
      } catch (error) {
        return onProblem(`${file.name || "The picture"} didn't go in: ${error.message}`);
      }
    }
  }

  picturePicker.addEventListener("change", () => {
    addPictures([...picturePicker.files], saved);
    picturePicker.value = "";
  });

  // Click a picture: say what's in it (for people who can't see it), where it
  // sits, and how big it is. A player's picked too (by its bar), for its size.
  let picked = null;
  const alt = el("input", { class: "editor__field", placeholder: "What's in it? (read out to people who can't see it)", "aria-label": "What's in the picture" });
  alt.addEventListener("input", () => {
    if (!picked?.matches("img")) return;
    picked.alt = alt.value;
    if (markdown.owns(picked)) pick(markdown.pictureChanged(picked));
    onChange();
  });
  // (inside a form, like a topic's, Enter here would send the whole form)
  alt.addEventListener("keydown", (e) => {
    if (e.key === "Enter") e.preventDefault();
  });
  const places = [["Across", ""], ["Left", "pic--left"], ["Middle", "pic--center"], ["Right", "pic--right"]].map(([name, place]) => {
    const button = el("button", { class: "tool", type: "button", textContent: name, title: place ? `Small, ${name.toLowerCase()}, with the words around it` : "Across the column" });
    button.addEventListener("click", () => {
      let img = picked;
      img.classList.remove(...PICTURE_PLACES);
      if (place) img.classList.add(place);
      if (markdown.owns(img)) img = markdown.pictureChanged(img);
      else if (beside(img)) {
        keepBeside(img, true);
        // straight to typing beside it
        const after = document.createRange();
        after.setStartAfter(img);
        after.collapse(true);
        select(after);
      }
      pick(img);
      changed();
    });
    return [button, place];
  });
  const resetPicture = el("button", { class: "tool", type: "button", textContent: "Reset size", title: "Its own size (no wider than the column)" });
  resetPicture.addEventListener("click", () => {
    picked.removeAttribute("width");
    picked.removeAttribute("height");
    if (markdown.owns(picked)) pick(markdown.pictureChanged(picked));
    changed();
  });
  const removePicture = el("button", { class: "tool", type: "button", textContent: "Remove" });
  removePicture.addEventListener("click", () => {
    if (markdown.owns(picked)) markdown.removeSource(picked);
    else picked.remove();
    pick(null);
    changed();
  });
  const pictureUp = el("button", { class: "tool", type: "button", textContent: "Up", title: "Up a line" });
  const pictureDown = el("button", { class: "tool", type: "button", textContent: "Down", title: "Down a line" });
  // (in Markdown, its whole line moves)
  pictureUp.addEventListener("click", () => (markdown.owns(picked) ? pick(markdown.moveLine(picked, true)) : move(picked, true)));
  pictureDown.addEventListener("click", () => (markdown.owns(picked) ? pick(markdown.moveLine(picked, false)) : move(picked, false)));
  pictureRow.append(
    el("span", { class: "editor__label", textContent: "Picture" }), alt,
    el("div", { class: "tools__group" }, places.map(([button]) => button)),
    resetPicture,
    el("div", { class: "tools__group" }, pictureUp, pictureDown),
    removePicture);

  function pick(item) {
    picked?.classList.remove("is-picked");
    picked = item && (area.contains(item) || markdown.owns(item)) ? item : null;
    const picture = picked?.matches("img") ? picked : null;
    pictureRow.hidden = !picture;
    follow();
    if (!picked) return;
    picked.classList.add("is-picked");
    if (!picture) return;
    if (alt.value !== picture.alt) alt.value = picture.alt;
    for (const [button, place] of places) {
      button.setAttribute("aria-pressed", String(place ? picture.classList.contains(place) : !PICTURE_PLACES.some((p) => picture.classList.contains(p))));
    }
  }
  // (the cursor beside what's clicked, not on it: in Firefox, a picture
  // clicked is selected, and typing would replace it, and a divider clicked
  // has the cursor in no line at all)
  area.addEventListener("click", (e) => {
    const item = e.target.closest("img, .embed, hr");
    pick(item);
    if (item?.matches("hr")) {
      const line = [item.nextElementSibling, item.previousElementSibling].find((node) => node && !isThing(node));
      if (line) cursorTo(line, line === item.previousElementSibling);
    } else if (item?.matches("img") && !getSelection().isCollapsed) {
      const after = document.createRange();
      after.setStartAfter(item);
      after.collapse(true);
      select(after);
    }
  });
  markdown.element.addEventListener("click", (e) => pick(e.target.closest(".md-widget img, .md-widget.embed")));
  markdown.element.addEventListener("keydown", () => pick(null));

  // --- words beside a picture ---------------------------------------------------------

  // A picture on the left or the right floats beside the words that come after
  // it, from the line it's on. So it's kept the first thing in its paragraph:
  // words typed in front of it (a click beside it puts the cursor there) would
  // sit above it, and push it down the page as they grew. And a picture on a
  // line of its own takes the next paragraph's words beside it, from their
  // first line: carried into the start of that paragraph (with the line it was
  // on gone, if nothing else was on it and the cursor isn't there).
  const beside = (node) => node?.nodeName === "IMG" && (node.classList.contains("pic--left") || node.classList.contains("pic--right"));
  const wordless = (node) => !node.textContent.replace(/\u200B/g, "").trim();

  function keepBeside(img, carry = false) {
    const line = img.parentElement?.closest("p, li, blockquote, h2, h3, h4");
    if (!line || !area.contains(line)) return;
    const ahead = document.createRange();
    ahead.setStart(line, 0);
    ahead.setEndBefore(img);
    const before = ahead.cloneContents();
    if (!wordless(before) || [...before.querySelectorAll("img")].some((other) => !beside(other))) {
      line.prepend(img);
      return;
    }
    const next = line.nextElementSibling;
    const alone = line.matches("p") && wordless(line) && [...line.querySelectorAll("img")].every(beside);
    const cursorThere = line.contains(getSelection().anchorNode);
    // (not into a line that's under it: that's where it was asked to be)
    if (alone && next?.matches("p") && !next.classList.contains(UNDER) && !wordless(next) && (carry || !cursorThere)) {
      next.prepend(...line.querySelectorAll("img"));
      line.remove();
    }
  }

  // The browser's own looks, as soon as it leaves them. Joining a paragraph to
  // a heading, say, wraps the paragraph's words in a span that keeps their
  // size and color: the line looks like a paragraph and spaces like a heading,
  // and is saved as a heading. Gone, it's shown as what it is. (An alignment
  // the buttons made becomes its class; a hue, its class.) A player's own
  // width stays.
  function dropStyles() {
    for (const node of area.querySelectorAll("[style], [align]")) {
      if (node.closest(".embed")) continue;
      lineUp(node);
      const hue = node.matches("span") && node.style.color && hueOfColor(node.style.color);
      if (hue) node.classList.add(`hue-${hue}`);
      node.removeAttribute("style");
      if (!node.className) node.removeAttribute("class");
    }
  }

  // An empty line goes, unless the cursor's on it (to type on), so the space
  // between paragraphs is always the same here, as it is on the page. (Cutting
  // a whole paragraph leaves one behind; two Enters make one; a heading picked
  // for a line, then left empty, is one; clean() drops any left when it's
  // saved.) The last line stays if it's after a thing: it's the only place to
  // type under it.
  function dropBlankLines() {
    const cursor = getSelection().anchorNode;
    for (const line of [...area.children]) {
      if (line === area.lastElementChild && isThing(line.previousElementSibling)) continue;
      if (area.children.length > 1 && blankLine(line) && !line.contains(cursor)) line.remove();
    }
  }

  // Every line in the box a block: a <div> (Firefox's) becomes a <p>, and
  // loose words straight in the box (Firefox leaves them after a Select All
  // and Delete, say) go into one. The cursor stays where it was: moving the
  // words it's in would lose it, so it's put back in them.
  let composing = false;
  area.addEventListener("compositionstart", () => { composing = true; });
  area.addEventListener("compositionend", () => { composing = false; });
  function settleLines() {
    if (composing) return;
    const selection = getSelection();
    const ours = selection.rangeCount && area.contains(selection.anchorNode) && area.contains(selection.focusNode);
    // a point in the box itself, as the line it's before (null: the end)
    const pin = (node, offset) => (node === area ? { before: area.childNodes[offset] ?? null } : { node, offset });
    const points = ours ? [pin(selection.anchorNode, selection.anchorOffset), pin(selection.focusNode, selection.focusOffset)] : [];
    const renamed = new Map();
    let moved = false;
    let into = null;
    for (const node of [...area.childNodes]) {
      if (node.nodeType === Node.ELEMENT_NODE && LINES.has(node.nodeName)) {
        into = null;
        if (node.nodeName === "DIV" && !node.querySelector("p, div, h1, h2, h3, h4, h5, h6, ul, ol, pre, blockquote, hr, figure, table")) {
          const p = document.createElement("p");
          if (node.className) p.className = node.className;
          p.append(...node.childNodes);
          node.replaceWith(p);
          renamed.set(node, p);
          moved = true;
        }
        continue;
      }
      // (the spaces between lines are no words)
      const loose = node.nodeType === Node.ELEMENT_NODE || (node.nodeType === Node.TEXT_NODE && (into || node.data.trim()));
      if (!loose) continue;
      if (!into) {
        into = document.createElement("p");
        node.before(into);
      }
      into.append(node);
      moved = true;
    }
    // (emptied altogether: a line, the cursor on it)
    if (!area.firstElementChild && !area.textContent.trim()) {
      const line = el("p", {}, el("br"));
      area.replaceChildren(line);
      if (ours) selection.setBaseAndExtent(line, 0, line, 0);
      return;
    }
    if (!moved || points.length === 0) return;
    const place = ({ node, offset, before }) => {
      if (node) return [renamed.get(node) ?? node, offset];
      if (!before) return [area, area.childNodes.length];
      const now = renamed.get(before) ?? before;
      return [now.parentNode, [...now.parentNode.childNodes].indexOf(now)];
    };
    const [[anchor, anchorAt], [focus, focusAt]] = points.map(place);
    selection.setBaseAndExtent(anchor, anchorAt, focus, focusAt);
  }

  // The box ends on a line to type on. After a thing there's nowhere else to
  // put the cursor: a click under it puts the cursor above it, and the words
  // typed with it.
  function endLine() {
    if (!area.lastElementChild || isThing(area.lastElementChild)) area.append(el("p", {}, el("br")));
  }

  // --- under a picture ------------------------------------------------------------------

  // A picture on the left or the right has the lines after it beside it, as
  // far down as it goes. Enter on an empty line beside one puts that line
  // under it (UNDER, which the post keeps: site.css clears it of pictures),
  // so pressing Enter till the cursor's under the picture works as it always
  // has, though empty lines don't stay. This is the empty line the cursor's
  // on, if it's beside a picture or already put under one.
  function emptyLineBy() {
    const selection = getSelection();
    if (!selection.rangeCount || !selection.isCollapsed || !area.contains(selection.anchorNode)) return null;
    const node = selection.anchorNode === area ? area.childNodes[selection.anchorOffset] : selection.anchorNode;
    const line = lineOf(node);
    if (!line?.matches?.("p") || !blankLine(line)) return null;
    if (line.classList.contains(UNDER)) return line;
    const top = line.getBoundingClientRect().top;
    for (const img of area.querySelectorAll("img.pic--left, img.pic--right")) {
      if (!(img.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING) || getComputedStyle(img).float === "none") continue;
      if (top < img.getBoundingClientRect().bottom - 1) return line;
    }
    return null;
  }

  // Only the first line under the pictures needs it (Enter copies it onto
  // the line it makes, and the lines after are under them anyway).
  function settleUnder() {
    let floating = false;
    for (const line of area.children) {
      if (line.classList.contains(UNDER)) {
        if (floating) floating = false;
        else {
          line.classList.remove(UNDER);
          if (!line.className) line.removeAttribute("class");
        }
      }
      if (line.querySelector("img.pic--left, img.pic--right")) floating = true;
    }
  }

  // --- things: dividers, players, pictures on lines of their own ------------------------

  // A thing the cursor can't be in, only beside: a divider, a player, or a
  // picture (or two) on a line of its own.
  const isThing = (node) => Boolean(node?.matches?.("hr, figure.embed")
    || (node?.matches?.("p") && node.querySelector("img") && wordless(node)));

  // The line the cursor's on, if it's right at the start of it (back) or at
  // its end (a line's last <br>, a browser's to give it height, isn't in it).
  function atEdge(back) {
    const selection = getSelection();
    if (!selection.rangeCount || !selection.isCollapsed) return null;
    const { anchorNode: node, anchorOffset: offset } = selection;
    if (node === area || !area.contains(node)) return null;
    const line = lineOf(node);
    if (!line || line.matches("hr, figure")) return null;
    const part = document.createRange();
    part.selectNodeContents(line);
    if (back) part.setEnd(node, offset);
    else part.setStart(node, offset);
    const bit = part.cloneContents();
    if (bit.textContent.replace(/​/g, "") || bit.querySelector("img, hr, figure")) return null;
    const breaks = bit.querySelectorAll("br").length;
    if (back ? breaks > 0 : breaks > 1 || (breaks === 1 && line.lastChild?.nodeName !== "BR")) return null;
    return line;
  }

  // What Backspace (back) or Delete takes that isn't words, and whether it
  // goes (or is only picked): the thing picked; the divider the cursor's on
  // (in Firefox, a click on one puts it there); or the thing beside the line
  // the cursor's at the edge of. (In a list, Backspace at its start takes the
  // list off: the browser's own.)
  function thingBy(back) {
    if (picked && area.contains(picked)) return { thing: picked, goes: true };
    const selection = getSelection();
    if (selection.rangeCount && selection.isCollapsed && area.contains(selection.anchorNode)) {
      const { anchorNode: node, anchorOffset: offset } = selection;
      if (node.nodeName === "HR") return { thing: node, goes: true };
      if (node === area) {
        const near = area.childNodes[back ? offset - 1 : offset];
        if (isThing(near)) return { thing: near, goes: near.nodeName === "HR" };
      }
    }
    const line = atEdge(back);
    if (!line || (back && line.matches("ul, ol"))) return null;
    const near = back ? line.previousElementSibling : line.nextElementSibling;
    return isThing(near) ? { thing: near, goes: near.nodeName === "HR" } : null;
  }

  area.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !composing) {
      const line = emptyLineBy();
      if (line) {
        // beside a picture: the line goes under it; already under it: an
        // empty line more would only go again
        e.preventDefault();
        if (!line.classList.contains(UNDER)) {
          line.classList.add(UNDER);
          line.scrollIntoView({ block: "nearest" });
          changed();
        }
        return;
      }
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      const back = e.key === "Backspace";
      const found = thingBy(back);
      if (found) {
        e.preventDefault();
        if (found.goes) takeOut(found.thing);
        else pick(found.thing.matches("p") ? [...found.thing.querySelectorAll("img")].at(back ? -1 : 0) : found.thing);
        return;
      }
    }
    if (!["Shift", "Control", "Alt", "Meta"].includes(e.key)) pick(null);
  });

  // The cursor at the start of a line, or at its end.
  function cursorTo(line, end = false) {
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let text = null;
    for (let node; (node = walker.nextNode());) {
      text = node;
      if (!end) break;
    }
    const range = document.createRange();
    if (text) range.setStart(text, end ? text.data.length : 0);
    else range.setStart(line, 0);
    range.collapse(true);
    select(range);
  }

  // Takes a thing out (or a picked picture, and its line if it's left
  // empty). The cursor stays on its line, or, if it was on what went, goes
  // to the line after it (or before it).
  function takeOut(thing) {
    pick(null);
    let gone = thing;
    if (thing.matches("img")) {
      const line = lineOf(thing);
      thing.remove();
      gone = line?.matches("p") && wordless(line) && !line.querySelector("img") ? line : null;
    }
    if (gone) {
      const cursor = getSelection().anchorNode;
      const lost = !cursor || cursor === area || gone.contains(cursor) || !area.contains(cursor);
      const after = gone.nextElementSibling;
      const before = gone.previousElementSibling;
      gone.remove();
      if (lost) {
        if (after && !isThing(after)) cursorTo(after);
        else if (before && !isThing(before)) cursorTo(before, true);
      }
    }
    changed();
  }

  // --- sizes ----------------------------------------------------------------------

  // The picked picture's or player's corners, over the box: drag one to make
  // it bigger or smaller. A picture's width goes in its width="", a player's
  // in its data-width (sizePlayer), and the post keeps either.
  const corners = ["nw", "ne", "sw", "se"].map((corner) => el("span", { class: `resizer__handle resizer__handle--${corner}`, "data-corner": corner }));
  const resizer = el("div", { class: "resizer", hidden: true, "aria-hidden": "true" }, corners);
  element.append(resizer);

  // They follow it while it's picked, wherever the words around it move it.
  let following = 0;
  function follow() {
    cancelAnimationFrame(following);
    if (!picked?.isConnected || mode === "html" || picked.matches("hr")) {
      resizer.hidden = true;
      return;
    }
    const box = element.getBoundingClientRect();
    const at = picked.getBoundingClientRect();
    resizer.hidden = false;
    resizer.style.left = `${at.left - box.left - element.clientLeft}px`;
    resizer.style.top = `${at.top - box.top - element.clientTop}px`;
    resizer.style.width = `${at.width}px`;
    resizer.style.height = `${at.height}px`;
    following = requestAnimationFrame(follow);
  }

  // How wide the column is: the most anything in it can be.
  const column = () => {
    if (markdown.owns(picked)) return markdown.column();
    const look = getComputedStyle(area);
    return area.clientWidth - parseFloat(look.paddingLeft) - parseFloat(look.paddingRight);
  };

  // A corner, dragged: away from the middle is bigger. Across sets the size;
  // up or down does too, for something that keeps its shape (a picture, a
  // video), whichever goes further. The pointer stays with the corner, over
  // a player's video too.
  resizer.addEventListener("pointerdown", (e) => {
    const corner = e.target.dataset?.corner;
    if (!corner || !picked) return;
    e.preventDefault();
    const item = picked;
    const handle = e.target;
    handle.setPointerCapture(e.pointerId);
    const start = item.getBoundingClientRect();
    const isPicture = item.matches("img");
    const keepsShape = isPicture || item.matches(".embed--video, .embed--tall, .embed--file");
    const most = column();
    const least = Math.min(isPicture ? LEAST_PICTURE : LEAST_PLAYER, most);
    const outX = corner.endsWith("e") ? 1 : -1;
    const outY = corner.startsWith("s") ? 1 : -1;
    const moved = (move) => {
      const across = outX * (move.clientX - e.clientX);
      const down = keepsShape ? outY * (move.clientY - e.clientY) * (start.width / start.height) : 0;
      const width = Math.round(Math.min(most, Math.max(least, start.width + (Math.abs(across) >= Math.abs(down) ? across : down))));
      if (isPicture) item.setAttribute("width", width);
      else sizePlayer(item, width);
    };
    const done = () => {
      handle.removeEventListener("pointermove", moved);
      handle.removeEventListener("pointerup", done);
      handle.removeEventListener("pointercancel", done);
      // in Markdown, the size goes into its line
      if (markdown.owns(item)) pick(isPicture ? markdown.pictureChanged(item) : markdown.playerChanged(item));
      changed();
    };
    handle.addEventListener("pointermove", moved);
    handle.addEventListener("pointerup", done);
    handle.addEventListener("pointercancel", done);
  });

  // --- Markdown -------------------------------------------------------------------

  async function addMarkdown(file, at) {
    let md;
    try {
      md = await fromMarkdown(await file.text());
    } catch {
      return onProblem(`${file.name} couldn't be read.`);
    }
    if (empty()) setHtml(md.html);
    else {
      select(at);
      insertHtml(md.html);
      embedPlayers(area, playerBlock);
    }
    if (md.title) onTitle(md.title);
    changed();
    countWords();
    if (md.missing) {
      onProblem(`${plural(md.missing, "picture")} in ${file.name} ${md.missing === 1 ? "was a file" : "were files"} on your computer: put ${md.missing === 1 ? "it" : "them"} in with the picture button.`);
    }
  }

  markdownPicker.addEventListener("change", () => {
    if (markdownPicker.files[0]) addMarkdown(markdownPicker.files[0], saved);
    markdownPicker.value = "";
  });

  // --- the ask row: a link, or a player's link ---------------------------------------

  function askFor(what, start, done) {
    const field = el("input", { class: "editor__field", type: "url", value: start, placeholder: "https://", "aria-label": what });
    const said = el("span", { class: "editor__note" });
    const add = el("button", { class: "tool", type: "button", textContent: start ? "Change" : "Add" });
    const cancel = el("button", { class: "tool", type: "button", textContent: "Cancel" });
    const close = () => {
      ask.hidden = true;
      ask.replaceChildren();
      if (mode === "rich") restore();
      else if (mode === "markdown") markdown.focus();
      else source.focus();
    };
    const go = () => {
      const problem = done(field.value.trim());
      if (problem) said.textContent = problem;
      else ask.hidden = true;
    };
    add.addEventListener("click", go);
    cancel.addEventListener("click", close);
    field.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        go();
      }
      if (e.key === "Escape") close();
    });
    ask.replaceChildren(el("span", { class: "editor__label", textContent: what }), field, add, cancel, said);
    ask.hidden = false;
    field.focus();
  }

  function askLink() {
    const link = inside("a");
    askFor("Link to", link?.getAttribute("href") ?? "", (address) => {
      if (!address) return "Type or paste where it goes.";
      if (!/^(?:https?:|mailto:|\/|#|\?)/i.test(address)) address = (/^[^/]+@[^/]+$/.test(address) ? "mailto:" : "https://") + address;
      restore();
      if (link) {
        const range = document.createRange();
        range.selectNodeContents(link);
        select(range);
      }
      if (getSelection().isCollapsed) insertHtml(`<a href="${escape(address)}">${escape(address)}</a>`);
      else document.execCommand("createLink", false, address);
      changed();
      return null;
    });
  }

  // --- the buttons -----------------------------------------------------------------

  const states = [];
  function tool(label, title, action, { css = "", state } = {}) {
    const button = el("button", { class: `tool ${css}`, type: "button", title, "aria-label": title, textContent: label });
    // so the cursor stays where it is in the box
    button.addEventListener("mousedown", (e) => e.preventDefault());
    button.addEventListener("click", action);
    if (state) states.push([button, state]);
    return button;
  }
  const group = (name, ...buttons) => el("div", { class: "tools__group", role: "group", "aria-label": name }, buttons);
  const on = (command) => () => document.queryCommandState(command);
  const blockIs = (tag) => () => currentBlock()?.nodeName === tag;

  function showState() {
    for (const [button, state] of states) button.setAttribute("aria-pressed", String(Boolean(state())));
  }

  tools.append(
    group("Words",
      tool("B", "Bold (Ctrl+B)", () => run("bold"), { css: "tool--bold", state: on("bold") }),
      tool("I", "Italic (Ctrl+I)", () => run("italic"), { css: "tool--italic", state: on("italic") }),
      tool("U", "Underline (Ctrl+U)", () => run("underline"), { css: "tool--underline", state: on("underline") }),
      tool("S", "Strikethrough", () => run("strikeThrough"), { css: "tool--strike", state: on("strikeThrough") }),
      tool("`c`", "Code", inlineCode, { state: () => inside("code") && !inside("pre") })),
    group("Lines",
      tool("¶", "Paragraph", () => run("formatBlock", "p"), { state: blockIs("P") }),
      tool("H2", "Heading", () => block("h2"), { state: blockIs("H2") }),
      tool("H3", "Smaller heading", () => block("h3"), { state: blockIs("H3") }),
      tool("“”", "Quote", () => block("blockquote"), { state: () => inside("blockquote") }),
      tool("{}", "Code block", () => block("pre"), { state: () => inside("pre") })),
    group("Lists",
      tool("•", "Bulleted list", () => run("insertUnorderedList"), { state: on("insertUnorderedList") }),
      tool("1.", "Numbered list", () => run("insertOrderedList"), { state: on("insertOrderedList") })),
    group("Alignment",
      tool("left", "Line up on the left", () => run("justifyLeft")),
      tool("mid", "Center", () => run("justifyCenter"), { state: on("justifyCenter") }),
      tool("right", "Line up on the right", () => run("justifyRight"), { state: on("justifyRight") })),
    group("Color", HUES.map((name, i) => tool("", `${name[0].toUpperCase()}${name.slice(1)} words`,
      () => run("foreColor", cssVar(`--site-hue-${i + 1}`)), { css: `tool--hue hue-${i + 1}` }))),
    group("Put in",
      tool("link", "Link (Ctrl+K)", askLink, { state: () => inside("a") }),
      tool("unlink", "Take the link off", () => run("unlink")),
      tool("picture", "Picture (or paste or drop one)", () => picturePicker.click()),
      tool("video", "Video or song", () => askFor("Video or song link", "", addPlayer)),
      tool("---", "Divider", () => insertBlock(el("hr"))),
      tool(".md", "Markdown file (or drop one)", () => markdownPicker.click())),
    group("Undo",
      tool("clear", "Clear the formatting", () => run("removeFormat")),
      tool("undo", "Undo (Ctrl+Z)", () => history.undo()),
      tool("redo", "Redo (Ctrl+Y)", () => history.redo())),
  );

  area.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === "z" && !e.shiftKey) {
      e.preventDefault();
      history.undo();
    } else if (mod && (key === "y" || (key === "z" && e.shiftKey))) {
      e.preventDefault();
      history.redo();
    } else if (mod && key === "k") {
      e.preventDefault();
      askLink();
    } else if (e.key === "Tab" && inside("li")) {
      e.preventDefault();
      run(e.shiftKey ? "outdent" : "indent");
    }
  });

  // (Undo and Redo from anywhere else: the browser's menu, a phone's shake)
  area.addEventListener("beforeinput", (e) => {
    if (e.inputType !== "historyUndo" && e.inputType !== "historyRedo") return;
    e.preventDefault();
    if (e.inputType === "historyUndo") history.undo();
    else history.redo();
  });

  // --- paste and drop --------------------------------------------------------------

  area.addEventListener("paste", (e) => {
    const data = e.clipboardData;
    const pictures = [...data.files].filter((file) => file.type.startsWith("image/"));
    if (pictures.length) {
      e.preventDefault();
      addPictures(pictures, here());
      return;
    }
    const text = data.getData("text/plain").trim();
    const player = /^https?:\/\/\S+$/.test(text) && playerFor(text);
    if (player && isEmptyLine(lineOf(here()?.startContainer))) {
      e.preventDefault();
      insertBlock(playerBlock(player, text), here());
      return;
    }
    const html = data.getData("text/html");
    if (html) {
      e.preventDefault();
      insertHtml(clean(tidyHtml(html)));
    }
  });

  area.addEventListener("dragover", (e) => {
    if (e.dataTransfer.types.includes("Files")) e.preventDefault();
  });
  area.addEventListener("drop", (e) => {
    const files = [...e.dataTransfer.files];
    if (files.length === 0) return;   // words dragged about: the browser moves them
    e.preventDefault();
    const at = rangeAt(e.clientX, e.clientY) ?? saved;
    const markdown = files.find(isMarkdown);
    if (markdown) addMarkdown(markdown, at);
    else addPictures(files, at);
  });

  // A file dropped beside the box would open in the page's place, and take the post with it.
  for (const type of ["dragover", "drop"]) {
    document.addEventListener(type, (e) => {
      if (e.dataTransfer?.types.includes("Files") && !area.contains(e.target)) e.preventDefault();
    });
  }

  function rangeAt(x, y) {
    let range = null;
    const position = document.caretPositionFromPoint?.(x, y);
    if (position) {
      range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
    } else range = document.caretRangeFromPoint?.(x, y) ?? null;
    return range && area.contains(range.startContainer) ? range : null;
  }

  // --- in and out --------------------------------------------------------------------

  function setHtml(value) {
    area.innerHTML = clean(value) || "<p><br></p>";
    embedPlayers(area, playerBlock);
    settleLines();
    endLine();
    history.reset();
  }

  function empty() {
    if (mode === "markdown") return !markdown.text().trim();
    if (mode === "html") return !source.value.trim();
    return !area.textContent.trim() && !area.querySelector("img, hr, .embed");
  }

  // What's written, as it'll be saved: from Markdown or HTML, made HTML; from
  // the box, players back to their links and the browser's marks made a
  // post's. Cleaned, either way.
  function html() {
    if (mode === "markdown") return clean(tidyHtml(markdownToHtml(markdown.text())));
    if (mode === "html") return clean(tidyHtml(source.value));
    const copy = inert().importNode(area, true);
    playersAsLinks(copy);
    for (const node of copy.querySelectorAll(".is-picked")) node.classList.remove("is-picked");
    return clean(tidy(copy).innerHTML);
  }


  // --- Rich text, Markdown, HTML ----------------------------------------------------

  // Puts text in the Markdown or HTML box where its cursor is.
  function typeIn(text) {
    if (mode === "markdown") return markdown.insert(text);
    source.focus();
    source.setRangeText(text, source.selectionStart, source.selectionEnd, "end");
    source.dispatchEvent(new Event("input"));
  }

  // HTML with a line for each block, to read and write by hand.
  const readable = (value) => value.replace(/(<\/(?:p|h[2-4]|ul|ol|li|blockquote|pre|table|thead|tbody|tr)>|<hr>)(?!\n)/g, "$1\n");

  async function setMode(next) {
    if (next === mode) return;
    if (next === "markdown" || mode === "markdown") await loadMarkdown();
    const written = html();
    mode = next;
    if (mode === "rich") setHtml(written);
    else if (mode === "markdown") markdown.setText(htmlToMarkdown(written));
    else source.value = readable(written);
    area.hidden = mode !== "rich";
    markdown.element.hidden = mode !== "markdown";
    tools.hidden = mode !== "rich";
    source.hidden = mode !== "html";
    sourceTools.hidden = mode === "rich";
    ask.hidden = true;
    pick(null);
    for (const button of modes.querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
    area.classList.toggle("is-empty", empty());
    countWords();
  }

  modes.append(el("span", { class: "editor__label", textContent: "Write in" }), ...[["rich", "Rich text"], ["markdown", "Markdown"], ["html", "HTML"]].map(([name, label]) => {
    const button = el("button", { class: "tool", type: "button", textContent: label, "data-mode": name, "aria-pressed": String(name === "rich") });
    button.addEventListener("click", () => setMode(name));
    return button;
  }));
  sourceTools.append(group("Put in",
    tool("picture", "Picture (or paste or drop one)", () => picturePicker.click()),
    tool("video", "Video or song", () => askFor("Video or song link", "", addPlayer))));

  source.addEventListener("input", () => {
    onChange();
    clearTimeout(counting);
    counting = setTimeout(countWords, 300);
  });
  source.addEventListener("paste", (e) => {
    const pictures = [...e.clipboardData.files].filter((file) => file.type.startsWith("image/"));
    if (!pictures.length) return;
    e.preventDefault();
    addPictures(pictures);
  });
  source.addEventListener("dragover", (e) => {
    if (e.dataTransfer.types.includes("Files")) e.preventDefault();
  });
  source.addEventListener("drop", (e) => {
    const files = [...e.dataTransfer.files];
    if (files.length === 0) return;
    e.preventDefault();
    const markdown = files.find(isMarkdown);
    if (markdown && mode === "markdown") markdown.text().then((text) => typeIn(text));
    else addPictures(files);
  });

  setHtml(start);
  area.classList.toggle("is-empty", empty());
  countWords();
  return { element, html, empty, focus: () => (mode === "rich" ? select(null) : mode === "markdown" ? markdown.focus() : source.focus()) };
}
