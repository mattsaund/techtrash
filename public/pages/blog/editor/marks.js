// techtrash.org : the browser's own marks, made a post's.
//
// Editing in a browser leaves marks of its own in the HTML: <font color>,
// style="...", align="", <div>, <b>. A post has its own way of saying each
// (a hue's class, an alignment's class, <p>, <strong>), and DOMPurify throws
// out anything else when the post is cleaned (content.js), so these turn the
// one into the other first. The editor (editor.js) uses them on what's in its
// box, on a paste, and on what it saves.

// The six hues, by the names tokens.css gives them (--site-hue-1 is red).
export const HUES = ["red", "orange", "yellow", "green", "blue", "violet"];

export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// A color as #rrggbb, however it's written, to match colors up.
const paint = document.createElement("canvas").getContext("2d");
function normalColor(color) {
  paint.fillStyle = "#000000";
  paint.fillStyle = color;
  return paint.fillStyle;
}

// Which of the six hues (1 to 6) a color is, if it's one of them.
let hueByColor;
export function hueOfColor(color) {
  hueByColor ??= new Map(HUES.map((_, i) => [normalColor(cssVar(`--site-hue-${i + 1}`)), i + 1]));
  return hueByColor.get(normalColor(color));
}

// A document of its own that isn't shown, to work on HTML in: in this page's
// document, a pasted <img onerror> would load, and run, before it was ever
// cleaned.
export const inert = () => document.implementation.createHTMLDocument("");

// A line's alignment, however the browser wrote it (Chrome: style="text-align:
// right"; Firefox: align="right"), as the class a post uses, and only that
// one: the line it was carried on from (Enter carries it) may have another.
export function lineUp(node) {
  const align = (node.style.textAlign || node.getAttribute("align") || "").toLowerCase();
  node.removeAttribute("align");
  if (!align) return;
  node.classList.remove("align-center", "align-right");
  if (align === "center" || align === "right") node.classList.add(`align-${align}`);
}

// An element as another tag, keeping its class and what's in it.
function rename(node, tag) {
  const renamed = node.ownerDocument.createElement(tag);
  if (node.className) renamed.className = node.className;
  renamed.append(...node.childNodes);
  node.replaceWith(renamed);
}

// Every mark under root made a post's: colors as hues, alignments as
// classes, any other style gone, a <div> a <p>, <b> <strong> and the rest
// (and the headings a post doesn't have, the nearest it does). Gives back root.
export function tidy(root) {
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
    if (node.data.includes("​")) node.data = node.data.replaceAll("​", "");
  }
  return root;
}

// The browser's own looks in the box, as soon as it leaves them. Joining a
// paragraph to a heading, say, wraps the paragraph's words in a span that
// keeps their size and color: the line looks like a paragraph and spaces like
// a heading, and is saved as a heading. Gone, it's shown as what it is. (An
// alignment the buttons made becomes its class; a hue, its class.) A player's
// own width stays.
export function dropStyles(root) {
  for (const node of root.querySelectorAll("[style], [align]")) {
    if (node.closest(".embed")) continue;
    lineUp(node);
    const hue = node.matches("span") && node.style.color && hueOfColor(node.style.color);
    if (hue) node.classList.add(`hue-${hue}`);
    node.removeAttribute("style");
    if (!node.className) node.removeAttribute("class");
  }
}

// HTML, tidied, as HTML.
export function tidyHtml(html) {
  const doc = inert();
  doc.body.innerHTML = html;
  return tidy(doc.body).innerHTML;
}

// Puts HTML in where the cursor is. Given a lone <code> (or the like) and
// nothing after it, Chrome swaps it for a <span> that only looks like one;
// an invisible space after it stops that, and tidy() takes it out again.
const BLOCK_TAG = /<(?:p|h[1-6]|ul|ol|li|pre|blockquote|table|hr|figure|div)\b/i;
export function insertHtml(html) {
  document.execCommand("insertHTML", false, BLOCK_TAG.test(html) ? html : `${html}​`);
}

// Text, safe to put in HTML.
export const escape = (text) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
