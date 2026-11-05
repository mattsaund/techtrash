// techtrash.org : the editor's lines.
//
// The rich text box (editor.js) is a column of lines: every child of the box
// is one, and every one is a block (a paragraph, a heading, a list...). The
// browsers don't keep it that way on their own, and each gets some keys wrong
// in its own way, so this keeps the box in shape after every change:
//
//   - Every line a block, the same in every browser: Firefox makes a <div>
//     where Chrome makes a <p> (Enter after a heading), and can leave words in
//     no line at all. A <div> becomes a <p>, loose words go into one, and the
//     cursor stays where it was.
//   - An empty line is the space of a line, put in on purpose: Enter on an
//     empty line makes one, and it stays. Backspace or Delete beside one takes
//     only it out, so the line beside it stays what it is (a heading stays a
//     heading). A heading left empty is an empty line too. The empty line a
//     paragraph dragged elsewhere leaves behind goes.
//   - A divider, a player, or a picture on a line of its own is a thing the
//     cursor can't be in. Backspace at the start of the line after one (or
//     Delete at the end of the line before one) takes a divider out, and picks
//     a picture or a player (Firefox would throw away the line's words, or its
//     heading); pressed again, it goes. And the box always ends on a line to
//     type on, so what's typed under the last thing goes under it.
//   - A picture on the left or the right has the lines after it beside it, as
//     far down as it goes. Enter on an empty line beside it puts that line
//     under it (the class "under-pic", which the post keeps: site.css clears
//     it of pictures), so Enter, Enter gets out from beside it.
//   - A picture with words beside it is kept the first thing in its
//     paragraph: words typed in front of it would push it down under them.
//
// setUpLines(area, { select, pick, picked, changed }), where select(range)
// puts the cursor somewhere in the box, pick(item) picks a picture, a player
// or a divider (or nothing, given null), picked() is what's picked, and
// changed() is the editor's "something changed". Gives back the functions
// below that editor.js uses.

import { blankLine } from "../content.js";
import { el } from "../util.js";

// a line that starts under the pictures beside the lines before it
const UNDER = "under-pic";
// what a line of the box can be; anything else straight in it is loose words
const LINES = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "PRE", "BLOCKQUOTE", "HR", "FIGURE", "TABLE", "DIV"]);

// A picture that floats, with words beside it.
export const beside = (node) => node?.nodeName === "IMG" && (node.classList.contains("pic--left") || node.classList.contains("pic--right"));
// No words in it (the editor's invisible spaces aren't words).
export const wordless = (node) => !node.textContent.replace(/​/g, "").trim();
// A paragraph with nothing in it: where a divider or a player can go instead.
export const isEmptyParagraph = (node) => node?.matches?.("p") && !node.textContent.trim() && !node.querySelector("img");
// A thing the cursor can't be in, only beside: a divider, a player, or a
// picture (or two) on a line of its own.
export const isThing = (node) => Boolean(node?.matches?.("hr, figure.embed")
  || (node?.matches?.("p") && node.querySelector("img") && wordless(node)));
// An empty line: a line with nothing in it, the space of a line (a heading
// with nothing in it, the cursor on it, is one too).
const emptyLine = (node) => Boolean(node) && blankLine(node);
// A line the cursor can go on: any but a thing.
const holdsCursor = (node) => Boolean(node) && !isThing(node);
// the picture of a picture's line that's nearest the cursor
const partOf = (thing, back) => (thing.matches("p") ? [...thing.querySelectorAll("img")].at(back ? -1 : 0) : thing);

export function setUpLines(area, { select, pick, picked, changed }) {
  // the line a node is in, as a child of the box
  const lineOf = (node) => {
    while (node && node.parentNode !== area) node = node.parentNode;
    return node;
  };

  // --- every line a block ------------------------------------------------------------

  // A <div> (Firefox's) becomes a <p>, and loose words straight in the box
  // (Firefox leaves them after a Select All and Delete, say) go into one. The
  // cursor stays where it was: moving the words it's in would lose it, so it's
  // put back in them. Not while a word is being composed (a phone's keyboard,
  // an IME), which moving it would break.
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

  // --- empty lines ---------------------------------------------------------------------

  // An empty line is the space of a line, put in on purpose: Enter on an
  // empty line makes one, and it stays, and is saved, a line high (clean()
  // keeps it, but not at the start or the end of a post). A heading (or a
  // quote, or a code block) left empty is an empty line too, once the
  // cursor's off it: a paragraph, a line high, not a gap a heading high.
  // (Enter at a heading's start makes an empty heading over it, to push it
  // down: an empty line over it, then.)
  function emptyBlocksToLines() {
    const cursor = getSelection().anchorNode;
    for (const line of [...area.children]) {
      if (line.matches("p") || !blankLine(line) || line.contains(cursor)) continue;
      const empty = el("p", {}, el("br"));
      if (line.className) empty.className = line.className;
      line.replaceWith(empty);
    }
  }

  // A paragraph dragged somewhere else leaves its line behind, empty, which
  // nobody put there: it goes (an empty line that was there before stays).
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

  // --- a line to type on ---------------------------------------------------------------

  // The box ends on a line to type on. After a thing there's nowhere else to
  // put the cursor: a click under it puts the cursor above it, and the words
  // typed with it.
  function endLine() {
    if (!area.lastElementChild || isThing(area.lastElementChild)) area.append(helperLine());
  }

  // The lines the editor puts in for the cursor to go on (after a divider or
  // a player that goes in, and after the box's last thing) aren't the
  // writer's: one that's still empty once the cursor's elsewhere goes again
  // (unless it's still the only place to type under the last thing). Enter on
  // one makes it the writer's, to stay, as any empty line Enter makes.
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

  // --- under a picture -----------------------------------------------------------------

  // The empty line the cursor's on, if it's beside a picture on the left or
  // the right (Enter there puts it under the picture).
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

  // --- words beside a picture ----------------------------------------------------------

  // A picture on the left or the right floats beside the words that come after
  // it, from the line it's on. So it's kept the first thing in its paragraph:
  // words typed in front of it (a click beside it puts the cursor there) would
  // sit above it, and push it down the page as they grew. And a picture on a
  // line of its own takes the next paragraph's words beside it, from their
  // first line: carried into the start of that paragraph (with the line it was
  // on gone, if nothing else was on it and the cursor isn't there). carry:
  // Left or Right was just chosen.
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
    // (Left or Right just chosen: past any empty lines under it, which were
    // the space under a picture across the column, and go)
    let next = line.nextElementSibling;
    const spaces = [];
    while (carry && emptyLine(next) && !next.classList.contains(UNDER)) {
      spaces.push(next);
      next = next.nextElementSibling;
    }
    // (not into a line that's under it: that's where it was asked to be)
    if (alone && next?.matches("p") && !next.classList.contains(UNDER) && !wordless(next) && (carry || !cursorThere)) {
      for (const space of spaces) space.remove();
      next.prepend(...line.querySelectorAll("img"));
      line.remove();
    }
  }

  // --- Backspace and Delete, beside things ---------------------------------------------

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

  // What Backspace (back) or Delete does, where the browsers get it wrong
  // (joining a heading to an empty line above it makes it a paragraph;
  // Chrome takes a picture or a player with an empty line beside it; Firefox
  // throws away words, or a heading, beside a picture or a divider), if
  // anything:
  //   - the thing picked goes, and so does the divider the cursor's on (in
  //     Firefox, a click on one puts it there);
  //   - an empty line beside the line the cursor's at the edge of goes, and
  //     only it: that line stays what it is (a heading stays a heading);
  //   - the cursor's own line, if it's empty, goes, the cursor on the line in
  //     its place (Delete; Backspace too, with a thing before it);
  //   - a divider beside the line goes; a picture or a player is picked, to
  //     go if it's pressed again.
  // (In a list, Backspace at its start takes the list off: the browser's own.)
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

  // An empty line out (the cursor, if it was on it, where then() puts it).
  // One that was under a picture leaves the line after it under it too.
  function dropLine(line, then) {
    if (line.classList.contains(UNDER)) line.nextElementSibling?.classList.add(UNDER);
    line.remove();
    then?.();
    changed();
  }

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

  // --- the keys ------------------------------------------------------------------------

  area.addEventListener("keydown", (e) => {
    if (e.isComposing || composing) return;
    // (Enter on an empty line the editor put in: an empty line the writer wants)
    if (e.key === "Enter") helpers.delete(lineOf(getSelection().anchorNode));
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      // beside a picture: the empty line goes under it
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

  // After any change: every line a block, a heading left empty an empty
  // line (but the cursor's), the editor's own empty lines gone, a line at
  // the end to type on, and only the first line under a picture marked so.
  function settle() {
    settleLines();
    emptyBlocksToLines();
    dropHelpers();
    endLine();
    settleUnder();
  }

  return { lineOf, settle, settleLines, endLine, helperLine, keepBeside, cursorTo };
}
