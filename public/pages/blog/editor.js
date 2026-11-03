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
//   - Undo and Redo are its own (createHistory): the browser's only know the
//     changes the browser made, and this editor makes some of its own.
//   - The browser's own looks go as soon as it leaves them (joining a paragraph
//     to a heading keeps the paragraph's size in a span, so the line looks like
//     a paragraph and spaces like a heading): what's shown is what's saved.
//   - The space between paragraphs is always the same: an empty line (cutting
//     a whole paragraph leaves one, two Enters make one) goes as soon as the
//     cursor's off it and something changes, and none is ever saved.
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
// createEditor(html, { onChange, onTitle, short }) gives back
//   { element, html(), empty(), focus() }
// where html() is what's written, as it'll be saved, onTitle(title) is told a
// Markdown file's title, and short makes the box short, for a line or two.

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
const PLAYERS = "YouTube, Vimeo, Dailymotion, Twitch, Streamable, Loom, TikTok, Spotify, SoundCloud, Apple Music, or a link to a video or sound file";
const LEAST_PICTURE = 32;   // how small a picture can be dragged, in pixels
const LEAST_PLAYER = 240;   // ...and a player, which is no use any smaller

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

function tidy(root) {
  const doc = root.ownerDocument;
  for (const node of root.querySelectorAll("[style], font")) {
    const align = node.style.textAlign;
    if (align === "center" || align === "right") node.classList.add(`align-${align}`);
    else if (align) node.classList.remove("align-center", "align-right");
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

export function createEditor(start, { onChange = () => {}, onTitle = () => {}, short = false } = {}) {
  document.execCommand("defaultParagraphSeparator", false, "p");
  document.execCommand("styleWithCSS", false, false);

  const area = el("div", {
    class: `editor__area prose${short ? " editor__area--short" : ""}`,
    contenteditable: "true",
    role: "textbox",
    "aria-multiline": "true",
    "aria-label": "The post",
    "data-placeholder": "Write something...",
    spellcheck: true,
  });
  const modes = el("div", { class: "editor__modes", role: "group", "aria-label": "Write in" });
  const tools = el("div", { class: "editor__tools", role: "toolbar", "aria-label": "Formatting" });
  const sourceTools = el("div", { class: "editor__tools", role: "toolbar", "aria-label": "Put in", hidden: true });
  // Markdown or HTML, as text
  const source = el("textarea", {
    class: `editor__source${short ? " editor__area--short" : ""}`, hidden: true, spellcheck: true, "aria-label": "The post, as text",
  });
  const ask = el("div", { class: "editor__row", hidden: true });
  const pictureRow = el("div", { class: "editor__row", hidden: true });
  const note = el("span", { class: "editor__note", role: "status" });
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
    el("div", { class: "editor__foot meta" }, note, count),
    picturePicker, markdownPicker);

  const tell = (text) => { note.textContent = text; };
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

  function changed() {
    area.classList.toggle("is-empty", empty());
    if (mode === "rich") history.soon();
    onChange();
  }

  // Undo and Redo, of the box: what's in it (players as their links, so they
  // come back working) and where the cursor was.
  const history = createHistory(
    () => ({ content: snapshot(), caret: caretIn(area) }),
    (state) => {
      area.innerHTML = state.content;
      embedPlayers(area, playerBlock);
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

  // Words, a moment after the typing stops.
  let counting;
  area.addEventListener("input", () => {
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
      if (!text) return tell("Select some words first.");
      insertHtml(`<code>${escape(text)}</code>`);
    }
    changed();
  }

  // Puts a block (a player, a divider) on its own line after the cursor's,
  // or in place of the cursor's line if it's empty, with a line after it to
  // carry on typing on.
  function insertBlock(node, at = saved) {
    const line = lineOf(at?.startContainer);
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
      tell(`Uploading ${file.name || "the picture"}...`);
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
        return tell(error.message);
      }
    }
    tell(mode === "rich" ? "Click a picture to say what's in it or where it sits, and drag its corners to size it." : "");
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
  area.addEventListener("click", (e) => pick(e.target.closest("img, .embed")));
  area.addEventListener("keydown", () => pick(null));
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
    if (alone && next?.matches("p") && !wordless(next) && (carry || !cursorThere)) {
      next.prepend(...line.querySelectorAll("img"));
      line.remove();
    }
  }

  area.addEventListener("input", () => {
    dropStyles();
    for (const img of area.querySelectorAll("img.pic--left, img.pic--right")) keepBeside(img);
    dropBlankLines();
  });

  // The browser's own looks, as soon as it leaves them. Joining a paragraph to
  // a heading, say, wraps the paragraph's words in a span that keeps their
  // size and color: the line looks like a paragraph and spaces like a heading,
  // and is saved as a heading. Gone, it's shown as what it is. (An alignment
  // the buttons made becomes its class; a hue, its class.) A player's own
  // width stays.
  function dropStyles() {
    for (const node of area.querySelectorAll("[style]")) {
      if (node.closest(".embed")) continue;
      const align = node.style.textAlign;
      if (align === "center" || align === "right") node.classList.add(`align-${align}`);
      else if (align) node.classList.remove("align-center", "align-right");
      const hue = node.matches("span") && node.style.color && hueOfColor(node.style.color);
      if (hue) node.classList.add(`hue-${hue}`);
      node.removeAttribute("style");
    }
  }

  // An empty line goes, unless the cursor's on it (to type on), so the space
  // between paragraphs is always the same here, as it is on the page. (Cutting
  // a whole paragraph leaves one behind; two Enters make one; clean() drops any
  // left when it's saved.)
  function dropBlankLines() {
    const cursor = getSelection().anchorNode;
    for (const line of [...area.children]) {
      if (area.children.length > 1 && blankLine(line) && !line.contains(cursor)) line.remove();
    }
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
    if (!picked?.isConnected || mode === "html") {
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
    tell(`Reading ${file.name}...`);
    let md;
    try {
      md = await fromMarkdown(await file.text());
    } catch {
      return tell(`${file.name} couldn't be read.`);
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
    tell(`${file.name} is in.` + (md.missing
      ? ` ${plural(md.missing, "picture")} in it ${md.missing === 1 ? "was a file" : "were files"} on your computer: put ${md.missing === 1 ? "it" : "them"} in with the picture button.`
      : ""));
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
    if (next === "markdown" || mode === "markdown") {
      tell("Getting Markdown ready...");
      await loadMarkdown();
      tell("");
    }
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
