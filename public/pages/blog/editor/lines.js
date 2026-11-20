// Normalizes the rich text box after each change: every child a block, only the writer's
// empty lines, a line to type on at the end, floated pictures first in their paragraph.
// Also overrides Enter, Backspace and Delete where browsers get them wrong.

import { blankLine } from "../content.js";
import { el } from "../util.js";

// Line pushed below earlier floats. Saved with the post, clear: both in site.css.
const UNDER = "under-pic";
// Valid top-level blocks. Any other child of the box is loose words.
const LINES = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "PRE", "BLOCKQUOTE", "HR", "FIGURE", "TABLE", "DIV"]);

// A floated picture, with words beside it.
export const beside = (node) => node?.nodeName === "IMG" && (node.classList.contains("pic--left") || node.classList.contains("pic--right"));
// No text, ignoring the editor's zero-width spaces.
export const wordless = (node) => !node.textContent.replace(/​/g, "").trim();
// Empty <p>, which an inserted divider or player replaces.
export const isEmptyParagraph = (node) => node?.matches?.("p") && !node.textContent.trim() && !node.querySelector("img");
// A "thing": a divider, a player, or a line of only pictures.
// The cursor can sit beside one, never inside.
export const isThing = (node) => Boolean(node?.matches?.("hr, figure.embed")
  || (node?.matches?.("p") && node.querySelector("img") && wordless(node)));
// Includes empty headings, which only last while the cursor is on them.
const emptyLine = (node) => Boolean(node) && blankLine(node);
const holdsCursor = (node) => Boolean(node) && !isThing(node);
// the picture on a thing's line nearest the cursor, or the thing itself
const partOf = (thing, back) => (thing.matches("p") ? [...thing.querySelectorAll("img")].at(back ? -1 : 0) : thing);

export function setUpLines(area, { select, pick, picked, changed }) {
  // the box's child that contains node
  const lineOf = (node) => {
    while (node && node.parentNode !== area) node = node.parentNode;
    return node;
  };

  // --- every line a block --------------------------------------------------------

  // Firefox makes a <div> on Enter after a heading, and can leave bare text in the box
  // (Select All, Delete). Both become a <p>. Moving nodes loses the selection, so it's restored.
  // Skipped during IME or phone keyboard composition, which DOM moves would break.
  let composing = false;
  area.addEventListener("compositionstart", () => { composing = true; });
  area.addEventListener("compositionend", () => { composing = false; });
  function settleLines() {
    if (composing) return;
    const selection = getSelection();
    const ours = selection.rangeCount && area.contains(selection.anchorNode) && area.contains(selection.focusNode);
    // a point in the box itself is pinned to the next child (null at the end)
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
      // whitespace between blocks doesn't count
      const loose = node.nodeType === Node.ELEMENT_NODE || (node.nodeType === Node.TEXT_NODE && (into || node.data.trim()));
      if (!loose) continue;
      if (!into) {
        into = document.createElement("p");
        node.before(into);
      }
      into.append(node);
      moved = true;
    }
    // box emptied, so put back one line with the cursor in it
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

  // --- empty lines ---------------------------------------------------------------

  // Empty lines are deliberate spacing (clean() keeps them, except at the post's edges).
  // Other empty blocks, like the heading Enter leaves above a heading, become an empty <p>
  // once the cursor leaves, so they're one line high instead of a heading-sized gap.
  function emptyBlocksToLines() {
    const cursor = getSelection().anchorNode;
    for (const line of [...area.children]) {
      if (line.matches("p") || !blankLine(line) || line.contains(cursor)) continue;
      const empty = el("p", {}, el("br"));
      if (line.className) empty.className = line.className;
      line.replaceWith(empty);
    }
  }

  // Dragging a paragraph away leaves an empty line behind. Drop only the new ones.
  let emptyBefore = null;
  area.addEventListener("dragstart", () => {
    emptyBefore = new Set([...area.children].filter(emptyLine));
  });
  area.addEventListener("dragend", () => {
    if (!emptyBefore) return;
    const cursor = getSelection().anchorNode;
    for (const line of [...area.children]) {
      if (area.children.length > 1 && emptyLine(line) && !emptyBefore.has(line) && !line.contains(cursor)) line.remove();
    }
    emptyBefore = null;
    changed();
  });

  // --- a line to type on ---------------------------------------------------------

  // Without a typeable last line, a click below a final thing puts the cursor above it.
  function endLine() {
    if (!area.lastElementChild || isThing(area.lastElementChild)) area.append(helperLine());
  }

  // Lines the editor adds for the cursor (after an inserted divider or player, or a final thing).
  // Removed once empty and the cursor leaves, unless it's the line after the last thing.
  // Enter on one makes it the writer's.
  const helpers = new WeakSet();
  function helperLine() {
    const line = el("p", {}, el("br"));
    helpers.add(line);
    return line;
  }
  function dropHelpers() {
    const cursor = getSelection().anchorNode;
    for (const line of [...area.children]) {
      if (!helpers.has(line) || !emptyLine(line) || line.contains(cursor)) continue;
      if (line === area.lastElementChild && isThing(line.previousElementSibling)) continue;
      line.remove();
    }
  }

  // --- under a picture -----------------------------------------------------------

  // The cursor's empty line, if a floated picture is beside it.
  function emptyLineBy() {
    const selection = getSelection();
    if (!selection.rangeCount || !selection.isCollapsed || !area.contains(selection.anchorNode)) return null;
    const node = selection.anchorNode === area ? area.childNodes[selection.anchorOffset] : selection.anchorNode;
    const line = lineOf(node);
    if (!emptyLine(line) || line.classList.contains(UNDER)) return null;
    const top = line.getBoundingClientRect().top;
    for (const img of area.querySelectorAll("img.pic--left, img.pic--right")) {
      if (!(img.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING) || getComputedStyle(img).float === "none") continue;
      if (top < img.getBoundingClientRect().bottom - 1) return line;
    }
    return null;
  }

  // Only the first line below the floats keeps UNDER. Enter copies classes onto new lines.
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

  // --- words beside a picture ----------------------------------------------------

  // A float must stay first in its paragraph. A click beside it puts the cursor in front,
  // and text typed there would push it down. A float alone on its line joins the next
  // paragraph once the cursor leaves. carry (Left or Right just chosen) moves it right away.
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
    const alone = line.matches("p") && wordless(line) && [...line.querySelectorAll("img")].every(beside);
    const cursorThere = line.contains(getSelection().anchorNode);
    // on carry, empty lines below were spacing for the full-width picture. They go.
    let next = line.nextElementSibling;
    const spaces = [];
    while (carry && emptyLine(next) && !next.classList.contains(UNDER)) {
      spaces.push(next);
      next = next.nextElementSibling;
    }
    // not into an under-pic line, which is below it on purpose
    if (alone && next?.matches("p") && !next.classList.contains(UNDER) && !wordless(next) && (carry || !cursorThere)) {
      for (const space of spaces) space.remove();
      next.prepend(...line.querySelectorAll("img"));
      line.remove();
    }
  }

  // --- Backspace and Delete ------------------------------------------------------

  // The cursor's line, if the cursor is at its start (back) or end.
  // A trailing <br> is the browser's height filler, so it doesn't count.
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

  // Custom Backspace (back) or Delete, or null for native. Native bugs: a heading joined to
  // an empty line above becomes a <p>. Chrome deletes a picture or player with an adjacent
  // empty line. Firefox deletes text or a heading next to a picture or hr. Instead, remove the
  // picked thing, an hr at the cursor (Firefox puts it there on click) or next to it, or an
  // empty line (the neighbor first, so a heading stays a heading). An adjacent picture or
  // player gets picked, so a second press removes it. Backspace at a list's start stays native.
  function edgeEdit(back) {
    const item = picked();
    if (item && area.contains(item)) return () => takeOut(item);
    const selection = getSelection();
    if (!selection.rangeCount || !selection.isCollapsed || !area.contains(selection.anchorNode)) return null;
    const { anchorNode: node, anchorOffset: offset } = selection;
    if (node.nodeName === "HR") return () => takeOut(node);
    if (node === area) {
      const near = area.childNodes[back ? offset - 1 : offset];
      if (near?.nodeName === "HR") return () => takeOut(near);
      return isThing(near) ? () => pick(partOf(near, back)) : null;
    }
    const line = atEdge(back);
    if (!line) return null;
    const near = back ? line.previousElementSibling : line.nextElementSibling;
    if (emptyLine(near)) return () => dropLine(near);
    if (emptyLine(line)) {
      const after = line.nextElementSibling;
      const before = line.previousElementSibling;
      if (!back && holdsCursor(after)) return () => dropLine(line, () => cursorTo(after));
      if (!back && holdsCursor(before)) return () => dropLine(line, () => cursorTo(before, true));
      if (back && isThing(before) && holdsCursor(after)) return () => dropLine(line, () => cursorTo(after));
    }
    if (back && line.matches("ul, ol")) return null;
    if (near?.nodeName === "HR") return () => takeOut(near);
    if (isThing(near)) return () => pick(partOf(near, back));
    return null;
  }

  // then() re-places the cursor if it was on the line. UNDER passes to the next line.
  function dropLine(line, then) {
    if (line.classList.contains(UNDER)) line.nextElementSibling?.classList.add(UNDER);
    line.remove();
    then?.();
    changed();
  }

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

  // Removes a thing, or a picture plus its line if that leaves it empty.
  // A cursor that was in it moves to the next line, else the previous.
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

  // --- the keys ------------------------------------------------------------------

  area.addEventListener("keydown", (e) => {
    if (e.isComposing || composing) return;
    // Enter makes a helper line the writer's
    if (e.key === "Enter") helpers.delete(lineOf(getSelection().anchorNode));
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      // beside a float, Enter moves the empty line below it instead
      const line = emptyLineBy();
      if (line) {
        e.preventDefault();
        line.classList.add(UNDER);
        line.scrollIntoView({ block: "nearest" });
        changed();
        return;
      }
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      const edit = edgeEdit(e.key === "Backspace");
      if (edit) {
        e.preventDefault();
        edit();
        return;
      }
    }
    if (!["Shift", "Control", "Alt", "Meta"].includes(e.key)) pick(null);
  });

  // Runs after every change.
  function settle() {
    settleLines();
    emptyBlocksToLines();
    dropHelpers();
    endLine();
    settleUnder();
  }

  return { lineOf, settle, settleLines, endLine, helperLine, keepBeside, cursorTo };
}
