// Keeps the rich text box (editor.js) a column of lines, where every child of
// the box is a block (a paragraph, a heading, a list...). Browsers don't keep
// it that way on their own, and each gets some keys wrong in its own way, so
// after every change this:
//
//   - turns Firefox's <div>s and loose words into paragraphs
//   - keeps the empty lines the writer put in, and only those
//   - treats dividers, players and pictures alone on a line as things the
//     cursor can't be in, and fixes Backspace and Delete next to them
//   - keeps a line to type on at the end of the box
//   - lets Enter, Enter get out from beside a floated picture
//   - keeps a floated picture first in its paragraph
//
// setUpLines(area, { select, pick, picked, changed }) returns the functions
// editor.js uses. select(range) puts the cursor in the box, pick(item) picks
// a picture, a player or a divider (or nothing, given null), picked() is
// what's picked and changed() is the editor's "something changed".

import { blankLine } from "../content.js";
import { el } from "../util.js";

// A line that starts below the floated pictures before it. The post keeps
// the class, and site.css gives it clear: both.
const UNDER = "under-pic";
// The blocks a line can be. Anything else straight in the box is loose words.
const LINES = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "PRE", "BLOCKQUOTE", "HR", "FIGURE", "TABLE", "DIV"]);

// A floated picture, with words beside it.
export const beside = (node) => node?.nodeName === "IMG" && (node.classList.contains("pic--left") || node.classList.contains("pic--right"));
// No words in it (the editor's invisible spaces aren't words).
export const wordless = (node) => !node.textContent.replace(/​/g, "").trim();
// An empty paragraph, which a divider or a player can take the place of.
export const isEmptyParagraph = (node) => node?.matches?.("p") && !node.textContent.trim() && !node.querySelector("img");
// A divider, a player, or a picture (or two) alone on its line. The cursor
// can only be beside one of these "things", never in it.
export const isThing = (node) => Boolean(node?.matches?.("hr, figure.embed")
  || (node?.matches?.("p") && node.querySelector("img") && wordless(node)));
// A line with nothing in it. An empty heading counts too (it only lasts
// while the cursor's on it).
const emptyLine = (node) => Boolean(node) && blankLine(node);
// Any line but a thing, so the cursor can go on it.
const holdsCursor = (node) => Boolean(node) && !isThing(node);
// the picture on a thing's line nearest the cursor, or the thing itself
const partOf = (thing, back) => (thing.matches("p") ? [...thing.querySelectorAll("img")].at(back ? -1 : 0) : thing);

export function setUpLines(area, { select, pick, picked, changed }) {
  // the line (a child of the box) a node is in
  const lineOf = (node) => {
    while (node && node.parentNode !== area) node = node.parentNode;
    return node;
  };

  // --- every line a block --------------------------------------------------------

  // Firefox makes a <div> where Chrome makes a <p> (Enter after a heading),
  // and can leave loose words straight in the box (after Select All and
  // Delete, say). A <div> becomes a <p> and loose words go into one. Moving
  // the words the cursor is in would lose it, so it's put back afterward.
  // Skipped while a word is being composed (a phone keyboard, an IME), since
  // moving things then would break it.
  let composing = false;
  area.addEventListener("compositionstart", () => { composing = true; });
  area.addEventListener("compositionend", () => { composing = false; });
  function settleLines() {
    if (composing) return;
    const selection = getSelection();
    const ours = selection.rangeCount && area.contains(selection.anchorNode) && area.contains(selection.focusNode);
    // a point in the box itself is kept as the line after it (null at the end)
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
      // (whitespace between lines isn't loose words)
      const loose = node.nodeType === Node.ELEMENT_NODE || (node.nodeType === Node.TEXT_NODE && (into || node.data.trim()));
      if (!loose) continue;
      if (!into) {
        into = document.createElement("p");
        node.before(into);
      }
      into.append(node);
      moved = true;
    }
    // emptied completely, so put back one line with the cursor on it
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

  // An empty line is spacing the writer put in on purpose. Enter on an empty
  // line makes one, and it stays and is saved a line high (clean() keeps it,
  // except at the start or end of a post). An empty heading, quote or code
  // block becomes an empty paragraph once the cursor leaves it, so it's a
  // line high rather than a heading-sized gap. (Enter at the start of a
  // heading makes an empty heading above it, which ends up an empty line.)
  function emptyBlocksToLines() {
    const cursor = getSelection().anchorNode;
    for (const line of [...area.children]) {
      if (line.matches("p") || !blankLine(line) || line.contains(cursor)) continue;
      const empty = el("p", {}, el("br"));
      if (line.className) empty.className = line.className;
      line.replaceWith(empty);
    }
  }

  // Dragging a paragraph elsewhere leaves an empty line behind that nobody
  // put there, so it goes. Empty lines that were there before the drag stay.
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

  // The box always ends on a line to type on. Otherwise there'd be nowhere
  // for the cursor after a last thing, and a click below it would put the
  // cursor (and whatever's typed) above it.
  function endLine() {
    if (!area.lastElementChild || isThing(area.lastElementChild)) area.append(helperLine());
  }

  // Lines the editor adds for the cursor (after an inserted divider or
  // player, and after the box's last thing) aren't the writer's. One that's
  // still empty once the cursor moves away goes again, unless it's the only
  // place to type below the last thing. Enter on one makes it the writer's,
  // like any empty line Enter makes.
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

  // The empty line the cursor's on, if it's beside a floated picture (Enter
  // there moves it below the picture).
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

  // Only the first line below the pictures keeps the class. Enter copies it
  // onto the line it makes, and the lines after are below them anyway.
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

  // A floated picture sits beside the words after it, from its own line down.
  // So it's kept first in its paragraph, since words typed in front of it (a
  // click beside it puts the cursor there) would push it down as they grew.
  // A floated picture alone on its line moves to the start of the next
  // paragraph and its own line goes, once the cursor is off that line. carry
  // means Left or Right was just chosen, which moves it right away.
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
    // With Left or Right just chosen, skip the empty lines below it. They were
    // the spacing under a full-width picture, and they go.
    let next = line.nextElementSibling;
    const spaces = [];
    while (carry && emptyLine(next) && !next.classList.contains(UNDER)) {
      spaces.push(next);
      next = next.nextElementSibling;
    }
    // (not into an under-pic line, which was put below it on purpose)
    if (alone && next?.matches("p") && !next.classList.contains(UNDER) && !wordless(next) && (carry || !cursorThere)) {
      for (const space of spaces) space.remove();
      next.prepend(...line.querySelectorAll("img"));
      line.remove();
    }
  }

  // --- Backspace and Delete, beside things ---------------------------------------

  // The cursor's line, if the cursor is right at its start (back) or its end.
  // A line's last <br> doesn't count, since browsers add it to give the line
  // height.
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

  // Our own Backspace (back) or Delete, as a function to run, where browsers
  // get it wrong (or null to leave it to the browser). Browsers make a
  // heading a paragraph when it's joined to an empty line above it, Chrome
  // takes a picture or a player along with an empty line beside it, and
  // Firefox throws away words, or a heading, next to a picture or a divider.
  // So instead:
  //   - the picked thing goes, and so does a divider the cursor is on (in
  //     Firefox, clicking one puts it there)
  //   - an empty line next to the cursor's line goes, and only that, so a
  //     heading stays a heading
  //   - the cursor's own line goes if it's empty, and the cursor moves to the
  //     line in its place (Delete, or Backspace after a thing)
  //   - a divider next to the line goes, and a picture or a player gets
  //     picked, to go on a second press
  // In a list, Backspace at the start is left to the browser, which takes
  // the list off.
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

  // Removes an empty line. If the cursor was on it, then() moves it somewhere.
  // An under-pic line hands its class to the line after it.
  function dropLine(line, then) {
    if (line.classList.contains(UNDER)) line.nextElementSibling?.classList.add(UNDER);
    line.remove();
    then?.();
    changed();
  }

  // Puts the cursor at the start of a line, or at its end.
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

  // Removes a thing, or a picked picture and its line if that's left empty.
  // If the cursor was on what went, it moves to the line after (or before).
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
    // (Enter on a line the editor added makes it the writer's)
    if (e.key === "Enter") helpers.delete(lineOf(getSelection().anchorNode));
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      // beside a floated picture, the empty line moves below it
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

  // Runs after every change. Every line becomes a block, empty headings
  // become empty lines (except the cursor's), the editor's own empty lines
  // go, the box ends on a line to type on, and only the first line below a
  // picture keeps under-pic.
  function settle() {
    settleLines();
    emptyBlocksToLines();
    dropHelpers();
    endLine();
    settleUnder();
  }

  return { lineOf, settle, settleLines, endLine, helperLine, keepBeside, cursorTo };
}
