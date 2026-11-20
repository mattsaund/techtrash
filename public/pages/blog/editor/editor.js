// The admin's editor for posts and the site's own words (own-words.js). Three modes:
// WYSIWYG rich text on execCommand, live Markdown (live-markdown.js) and raw HTML.
// Switching converts the post, and what Markdown can't express (hues, a picture's
// place or width) stays inline HTML.

import {
  clean, embedPlayers, fromMarkdown, htmlToMarkdown, loadMarkdown, markdownToHtml, PICTURE_PLACES, playerElement, playerFor,
  playerIn, sizePlayer,
} from "../content.js";
import { api, el, plural, readyPicture, readySound } from "../util.js";
import { createHistory } from "./history.js";
import { beside, isEmptyParagraph, isThing, setUpLines } from "./lines.js";
import { createLiveMarkdown } from "./live-markdown.js";
import { cssVar, dropStyles, escape, HUES, inert, insertHtml, tidy, tidyHtml } from "./marks.js";
import { setUpCorners } from "./resizer.js";

// blocks the Lines buttons can detect the cursor in
const BLOCKS = new Set(["P", "H2", "H3", "H4", "PRE", "BLOCKQUOTE", "LI"]);
const PLAYERS = "YouTube, Vimeo, Dailymotion, Twitch, Streamable, Loom, TikTok, Spotify, SoundCloud, Apple Music, or a link to a video or sound file";
const isMarkdown = (file) => /\.(?:md|markdown|mdown|mkd)$/i.test(file.name) || file.type === "text/markdown";
const isPicture = (file) => file.type.startsWith("image/");
const isSound = (file) => file.type.startsWith("audio/") || /\.(?:mp3|m4a|aac|ogg|oga|wav|flac)$/i.test(file.name);

// Cursor to a character offset in the box's text and back, for undo snapshots.
// skip(node) excludes text that isn't the writer's.
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
  // Firefox ignores these until the box is focused (else Enter after a heading makes a <div>).
  area.addEventListener("focus", useParagraphs);
  const modes = el("div", { class: "editor__modes", role: "group", "aria-label": "Write in" });
  const tools = el("div", { class: "editor__tools", role: "toolbar", "aria-label": "Formatting" });
  const sourceTools = el("div", { class: "editor__tools", role: "toolbar", "aria-label": "Put in", hidden: true });
  // HTML mode
  const source = el("textarea", {
    class: `editor__source${short ? " editor__area--short" : ""}`, hidden: true, spellcheck: true, "aria-label": "The post, as text",
  });
  const ask = el("div", { class: "editor__row", hidden: true });
  const pictureRow = el("div", { class: "editor__row", hidden: true });
  const soundRow = el("div", { class: "editor__row", hidden: true });
  const count = el("span", { class: "editor__count" });
  const picturePicker = el("input", { type: "file", accept: "image/*", multiple: true, hidden: true });
  const markdownPicker = el("input", { type: "file", accept: ".md,.markdown,.mdown,.mkd,text/markdown", hidden: true });
  const soundPicker = el("input", { type: "file", accept: "audio/*,.mp3,.m4a,.aac,.ogg,.oga,.wav,.flac", multiple: true, hidden: true });
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
      else addFiles(files);
    },
    toMarkdown: (html) => htmlToMarkdown(clean(tidyHtml(html))),
  });
  markdown.element.hidden = true;
  const element = el("div", { class: "editor" },
    el("div", { class: "editor__head" }, modes, tools, sourceTools, ask, pictureRow, soundRow),
    area,
    markdown.element,
    source,
    el("div", { class: "editor__foot meta" }, count),
    picturePicker, markdownPicker, soundPicker);

  let mode = "rich";   // or "markdown" or "html", see setMode()

  // --- where the cursor is -------------------------------------------------------

  // Last selection in the box. Buttons and fields restore it before acting.
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

  const lines = setUpLines(area, { select, pick: (item) => pick(item), picked: () => picked, changed: () => changed() });
  const { lineOf } = lines;

  // closest ancestor of the saved cursor matching tag
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

  function changed() {
    if (mode === "rich") {
      lines.settle();
      history.soon();
    }
    area.classList.toggle("is-empty", empty());
    onChange();
  }

  // Snapshots store players as links, so a restore rebuilds working players.
  const history = createHistory(
    () => ({ content: snapshot(), caret: caretIn(area) }),
    (state) => {
      area.innerHTML = state.content;
      embedPlayers(area, playerBlock);
      lines.endLine();
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
  // players back to <p><a> links, as a post stores them
  function playersAsLinks(copy) {
    for (const box of copy.querySelectorAll("[data-address]")) {
      box.replaceWith(el("p", { "data-width": box.dataset.width }, el("a", { href: box.dataset.address, textContent: box.dataset.title || box.dataset.address })));
    }
  }

  // Normalize markup after every native edit. The word count is debounced.
  let counting;
  area.addEventListener("input", () => {
    lines.settleLines();
    dropStyles(area);
    for (const img of area.querySelectorAll("img.pic--left, img.pic--right")) lines.keepBeside(img);
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
    // minus player UI text (link, sound title and time)
    const players = [...area.querySelectorAll(".embed")].reduce((n, box) => n + words(box.innerText), 0);
    count.textContent = plural(words(area.innerText) - players, "word");
  };

  const run = (command, value = null) => {
    restore();
    document.execCommand(command, false, value);
    changed();
  };

  // Toggles the cursor's line between <p> and tag.
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
      if (!text) return;   // needs a selection
      insertHtml(`<code>${escape(text)}</code>`);
    }
    changed();
  }

  // Inserts a block after the cursor's line, or in place of it if empty, plus a line to type on.
  function insertBlock(node, at = saved) {
    // a cursor in the box itself (between lines) means the line before
    const line = at?.startContainer === area ? area.childNodes[Math.max(0, at.startOffset - 1)] ?? null : lineOf(at?.startContainer);
    if (isEmptyParagraph(line)) line.replaceWith(node);
    else if (line) line.after(node);
    else area.append(node);
    if (!node.nextElementSibling || !node.nextElementSibling.matches("p")) node.after(lines.helperLine());
    const next = document.createRange();
    next.setStart(node.nextElementSibling, 0);
    select(next);
    changed();
  }

  // --- players -------------------------------------------------------------------

  // A live player with an edit bar. The post keeps only the link, plus data-width if sized
  // and a sound's title as the link text (playersAsLinks).
  function playerBlock(player, address, width = null, title = null) {
    const box = sizePlayer(playerElement(player, title), width);
    box.contentEditable = "false";
    box.dataset.address = address;
    if (title) box.dataset.title = title;
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
    // a link alone on a line becomes the player
    if (mode === "markdown") typeIn(`\n\n${address}\n\n`);
    else if (mode === "html") typeIn(`\n<p>${escape(address)}</p>\n`);
    else insertBlock(playerBlock(player, address));
    return null;
  }

  // A media link typed alone on a line becomes a player on Enter.
  area.addEventListener("keyup", (e) => {
    if (e.key !== "Enter") return;
    const before = lineOf(here()?.startContainer)?.previousElementSibling;
    const found = before?.matches("p") && playerIn(before);
    if (found) {
      before.replaceWith(playerBlock(found.player, found.address, found.width, found.title));
      changed();
    }
  });

  // Up or down a line. A picture sharing its line with text gets its own line first.
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

  // --- pictures ------------------------------------------------------------------

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

  // --- sounds --------------------------------------------------------------------

  // Each sound uploads, then goes in as its own player line, titled after its file name.
  async function addSounds(files, at) {
    for (const file of files) {
      try {
        const name = file.name || "sound";
        const { url } = await api(`/api/blog/sounds?name=${encodeURIComponent(name)}`, { method: "POST", body: readySound(file) });
        const title = name.replace(/\.[^.]*$/, "");
        if (mode === "markdown") typeIn(`\n\n[${title.replace(/[[\]]/g, "")}](${url})\n\n`);
        else if (mode === "html") typeIn(`\n<p><a href="${url}">${escape(title)}</a></p>\n`);
        else {
          insertBlock(playerBlock(playerFor(url), url, null, title), at);
          at = here();   // the next one goes after this one
        }
      } catch (error) {
        return onProblem(`${file.name || "The sound"} didn't go in: ${error.message}`);
      }
    }
  }

  soundPicker.addEventListener("change", () => {
    addSounds([...soundPicker.files], saved);
    soundPicker.value = "";
  });

  // Pasted or dropped files. Pictures go in before sounds.
  async function addFiles(files, at) {
    const pictures = files.filter(isPicture);
    const sounds = files.filter(isSound);
    if (pictures.length) await addPictures(pictures, at);
    if (sounds.length) await addSounds(sounds, pictures.length ? here() : at);
  }

  // Rename field for a picked sound.
  const soundName = el("input", { class: "editor__field", placeholder: "What's it called?", "aria-label": "What the sound is called" });
  soundName.addEventListener("input", () => {
    if (!picked?.matches(".embed--sound")) return;
    picked.dataset.title = soundName.value;
    picked.querySelector(".sound__title").textContent = soundName.value;
    if (markdown.owns(picked)) pick(markdown.playerChanged(picked));
    changed();
  });
  soundName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") e.preventDefault();
  });
  soundRow.append(el("span", { class: "editor__label", textContent: "Sound" }), soundName);

  // Picking a picture shows its alt, place and size controls. Players are picked by their bar.
  let picked = null;
  const alt = el("input", { class: "editor__field", placeholder: "What's in it? (read out to people who can't see it)", "aria-label": "What's in the picture" });
  alt.addEventListener("input", () => {
    if (!picked?.matches("img")) return;
    picked.alt = alt.value;
    if (markdown.owns(picked)) pick(markdown.pictureChanged(picked));
    // not changed(), which would settle the lines while focus is in this field
    if (mode === "rich") history.soon();
    onChange();
  });
  // Enter must not submit the surrounding form
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
        lines.keepBeside(img, true);
        // cursor right after it, ready to type beside it
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
  // in Markdown the whole line moves
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
    const sound = picked?.matches(".embed--sound") ? picked : null;
    pictureRow.hidden = !picture;
    soundRow.hidden = !sound;
    if (sound && soundName.value !== (sound.dataset.title ?? "")) soundName.value = sound.dataset.title ?? "";
    corners.follow();
    if (!picked) return;
    picked.classList.add("is-picked");
    if (!picture) return;
    if (alt.value !== picture.alt) alt.value = picture.alt;
    for (const [button, place] of places) {
      button.setAttribute("aria-pressed", String(place ? picture.classList.contains(place) : !PICTURE_PLACES.some((p) => picture.classList.contains(p))));
    }
  }
  // Keep the cursor beside a clicked item. Firefox selects a clicked picture (typing would
  // replace it) and leaves the cursor outside any line after a click on an hr.
  area.addEventListener("click", (e) => {
    const item = e.target.closest("img, .embed, hr");
    pick(item);
    if (item?.matches("hr")) {
      const line = [item.nextElementSibling, item.previousElementSibling].find((node) => node && !isThing(node));
      if (line) lines.cursorTo(line, line === item.previousElementSibling);
    } else if (item?.matches("img") && !getSelection().isCollapsed) {
      const after = document.createRange();
      after.setStartAfter(item);
      after.collapse(true);
      select(after);
    }
  });
  markdown.element.addEventListener("click", (e) => pick(e.target.closest(".md-widget img, .md-widget.embed")));
  markdown.element.addEventListener("keydown", () => pick(null));

  // --- sizes ---------------------------------------------------------------------

  // In Markdown the new size is written into the source line when the drag ends.
  const corners = setUpCorners(element, {
    picked: () => picked,
    hidden: () => mode === "html",
    // content width, the max size
    column: () => {
      if (markdown.owns(picked)) return markdown.column();
      const look = getComputedStyle(area);
      return area.clientWidth - parseFloat(look.paddingLeft) - parseFloat(look.paddingRight);
    },
    resized: (item) => {
      if (markdown.owns(item)) pick(item.matches("img") ? markdown.pictureChanged(item) : markdown.playerChanged(item));
      changed();
    },
  });

  // --- Markdown files ------------------------------------------------------------

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

  // --- URL prompt row ------------------------------------------------------------

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

  // --- toolbar and shortcuts -----------------------------------------------------

  const states = [];
  function tool(label, title, action, { css = "", state } = {}) {
    const button = el("button", { class: `tool ${css}`, type: "button", title, "aria-label": title, textContent: label });
    // keep focus and the selection in the box
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
      tool("sound", "Sound file: a song, or anything that plays (or drop one)", () => soundPicker.click()),
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

  // undo and redo from the browser's menu or a phone's shake
  area.addEventListener("beforeinput", (e) => {
    if (e.inputType !== "historyUndo" && e.inputType !== "historyRedo") return;
    e.preventDefault();
    if (e.inputType === "historyUndo") history.undo();
    else history.redo();
  });

  // --- paste and drop ------------------------------------------------------------

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
    if (player && isEmptyParagraph(lineOf(here()?.startContainer))) {
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
    if (files.length === 0) return;   // text drags stay native
    e.preventDefault();
    const at = rangeAt(e.clientX, e.clientY) ?? saved;
    const file = files.find(isMarkdown);
    if (file) addMarkdown(file, at);
    else addFiles(files, at);
  });

  // A file dropped outside the box would navigate to it and lose the post.
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

  // --- load and save -------------------------------------------------------------

  function setHtml(value) {
    area.innerHTML = clean(value) || "<p><br></p>";
    embedPlayers(area, playerBlock);
    lines.settleLines();
    lines.endLine();
    history.reset();
  }

  function empty() {
    if (mode === "markdown") return !markdown.text().trim();
    if (mode === "html") return !source.value.trim();
    return !area.textContent.trim() && !area.querySelector("img, hr, .embed");
  }

  // The post as saved: cleaned HTML from whichever mode is active.
  function html() {
    if (mode === "markdown") return clean(tidyHtml(markdownToHtml(markdown.text())));
    if (mode === "html") return clean(tidyHtml(source.value));
    const copy = inert().importNode(area, true);
    playersAsLinks(copy);
    for (const node of copy.querySelectorAll(".is-picked")) node.classList.remove("is-picked");
    return clean(tidy(copy).innerHTML);
  }

  // --- modes ---------------------------------------------------------------------

  // Inserts text at the cursor in Markdown or HTML mode.
  function typeIn(text) {
    if (mode === "markdown") return markdown.insert(text);
    source.focus();
    source.setRangeText(text, source.selectionStart, source.selectionEnd, "end");
    source.dispatchEvent(new Event("input"));
  }

  // newline after each block, for editing by hand
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
    tool("video", "Video or song", () => askFor("Video or song link", "", addPlayer)),
    tool("sound", "Sound file: a song, or anything that plays (or drop one)", () => soundPicker.click())));

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
  // pictures and sounds only. Markdown files go in from the other modes.
  source.addEventListener("drop", (e) => {
    const files = [...e.dataTransfer.files];
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files);
  });

  setHtml(start);
  area.classList.toggle("is-empty", empty());
  countWords();
  return { element, html, empty, focus: () => (mode === "rich" ? select(null) : mode === "markdown" ? markdown.focus() : source.focus()) };
}
