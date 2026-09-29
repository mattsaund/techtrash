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
//
// createEditor(html, { onChange, onTitle }) gives back
//   { element, html(), empty(), focus() }
// where html() is the post as it'll be saved, and onTitle(title) is told a
// Markdown file's title.

import { clean, embedPlayers, fromMarkdown, PICTURE_PLACES, playerElement, playerFor, playerIn } from "./content.js";
import { api, el, plural, readyPicture } from "./util.js";

// The six hues, by the names tokens.css gives them.
const HUES = ["red", "orange", "yellow", "green", "blue", "violet"];
const BLOCKS = new Set(["P", "H2", "H3", "H4", "PRE", "BLOCKQUOTE", "LI"]);
const PLAYERS = "YouTube, Vimeo, Dailymotion, Twitch, Streamable, Loom, TikTok, Spotify, SoundCloud, Apple Music, or a link to a video or sound file";

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

const tidyHtml = (html) => {
  const doc = inert();
  doc.body.innerHTML = html;
  return tidy(doc.body).innerHTML;
};

// --- the editor ------------------------------------------------------------------

export function createEditor(start, { onChange = () => {}, onTitle = () => {} } = {}) {
  document.execCommand("defaultParagraphSeparator", false, "p");
  document.execCommand("styleWithCSS", false, false);

  const area = el("div", {
    class: "editor__area prose",
    contenteditable: "true",
    role: "textbox",
    "aria-multiline": "true",
    "aria-label": "The post",
    "data-placeholder": "Write something...",
    spellcheck: true,
  });
  const tools = el("div", { class: "editor__tools", role: "toolbar", "aria-label": "Formatting" });
  const ask = el("div", { class: "editor__row", hidden: true });
  const pictureRow = el("div", { class: "editor__row", hidden: true });
  const note = el("span", { class: "editor__note", role: "status" });
  const count = el("span", { class: "editor__count" });
  const picturePicker = el("input", { type: "file", accept: "image/*", multiple: true, hidden: true });
  const markdownPicker = el("input", { type: "file", accept: ".md,.markdown,.mdown,.mkd,text/markdown", hidden: true });
  const element = el("div", { class: "editor" },
    el("div", { class: "editor__head" }, tools, ask, pictureRow),
    area,
    el("div", { class: "editor__foot meta" }, note, count),
    picturePicker, markdownPicker);

  const tell = (text) => { note.textContent = text; };

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
    onChange();
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
  // link it came from and a button to take it out. The post keeps the link.
  function playerBlock(player, address) {
    const box = playerElement(player);
    box.contentEditable = "false";
    box.dataset.address = address;
    const remove = el("button", { class: "tool", type: "button", textContent: "Remove" });
    remove.addEventListener("click", () => {
      box.remove();
      changed();
    });
    box.append(el("figcaption", { class: "embed__bar" }, el("span", { class: "embed__address", textContent: address }), remove));
    return box;
  }

  function addPlayer(address) {
    const player = playerFor(address);
    if (!player) return `That isn't a link I can play. Try ${PLAYERS}.`;
    insertBlock(playerBlock(player, address));
    return null;
  }

  // A player's link, typed on a line of its own: it turns into the player on Enter.
  area.addEventListener("keyup", (e) => {
    if (e.key !== "Enter") return;
    const before = lineOf(here()?.startContainer)?.previousElementSibling;
    const found = before?.matches("p") && playerIn(before);
    if (found) {
      before.replaceWith(playerBlock(found.player, found.address));
      changed();
    }
  });

  // --- pictures -------------------------------------------------------------------

  async function addPictures(files, at) {
    for (const file of files.filter((f) => f.type.startsWith("image/"))) {
      tell(`Uploading ${file.name || "the picture"}...`);
      try {
        const form = new FormData();
        form.append("picture", await readyPicture(file), file.name || "picture");
        const { url } = await api("/api/blog/pictures", { method: "POST", form });
        select(at);
        document.execCommand("insertImage", false, url);
        for (const img of area.querySelectorAll(`img[src="${CSS.escape(url)}"]:not([alt])`)) img.alt = "";
        at = here();   // the next one goes after this one
        changed();
      } catch (error) {
        return tell(error.message);
      }
    }
    tell("Click a picture to say what's in it, or where it sits.");
  }

  picturePicker.addEventListener("change", () => {
    addPictures([...picturePicker.files], saved);
    picturePicker.value = "";
  });

  // Click a picture: say what's in it (for people who can't see it), and where it sits.
  let picked = null;
  const alt = el("input", { class: "editor__field", placeholder: "What's in it? (read out to people who can't see it)", "aria-label": "What's in the picture" });
  alt.addEventListener("input", () => {
    if (picked) picked.alt = alt.value;
    onChange();
  });
  const places = [["Across", ""], ["Left", "pic--left"], ["Middle", "pic--center"], ["Right", "pic--right"]].map(([name, place]) => {
    const button = el("button", { class: "tool", type: "button", textContent: name, title: place ? `Small, ${name.toLowerCase()}, with the words around it` : "Across the column" });
    button.addEventListener("click", () => {
      picked.classList.remove(...PICTURE_PLACES);
      if (place) picked.classList.add(place);
      pick(picked);
      onChange();
    });
    return [button, place];
  });
  const removePicture = el("button", { class: "tool", type: "button", textContent: "Remove" });
  removePicture.addEventListener("click", () => {
    picked.remove();
    pick(null);
    changed();
  });
  pictureRow.append(el("span", { class: "editor__label", textContent: "Picture" }), alt, el("div", { class: "tools__group" }, places.map(([button]) => button)), removePicture);

  function pick(img) {
    picked?.classList.remove("is-picked");
    picked = img && area.contains(img) ? img : null;
    pictureRow.hidden = !picked;
    if (!picked) return;
    picked.classList.add("is-picked");
    alt.value = picked.alt;
    for (const [button, place] of places) {
      button.setAttribute("aria-pressed", String(place ? picked.classList.contains(place) : !PICTURE_PLACES.some((p) => picked.classList.contains(p))));
    }
  }
  area.addEventListener("click", (e) => pick(e.target.closest("img")));
  area.addEventListener("keydown", () => pick(null));

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
      restore();
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
      tool("undo", "Undo (Ctrl+Z)", () => run("undo")),
      tool("redo", "Redo (Ctrl+Y)", () => run("redo"))),
  );

  area.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      askLink();
    } else if (e.key === "Tab" && inside("li")) {
      e.preventDefault();
      run(e.shiftKey ? "outdent" : "indent");
    }
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
  }

  function empty() {
    return !area.textContent.trim() && !area.querySelector("img, hr, .embed");
  }

  // The post as it'll be saved: players back to their links, the browser's
  // marks made a post's, and cleaned.
  function html() {
    const copy = inert().importNode(area, true);
    for (const box of copy.querySelectorAll("[data-address]")) {
      box.replaceWith(el("p", {}, el("a", { href: box.dataset.address, textContent: box.dataset.address })));
    }
    for (const img of copy.querySelectorAll(".is-picked")) img.classList.remove("is-picked");
    return clean(tidy(copy).innerHTML);
  }

  // The toolbar sits under the site's top bar as the page scrolls, however tall that is.
  const bar = document.querySelector(".bar");
  if (bar) {
    new ResizeObserver(() => document.documentElement.style.setProperty("--site-bar-h", `${bar.offsetHeight}px`)).observe(bar);
  }

  setHtml(start);
  area.classList.toggle("is-empty", empty());
  countWords();
  return { element, html, empty, focus: () => select(null) };
}
