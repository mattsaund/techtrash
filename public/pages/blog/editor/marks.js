// Turns the browser's editing marks into a post's. Editing in a browser
// leaves its own markup in the HTML (<font color>, style="...", align="",
// <div>, <b>). A post says each of those its own way (a hue class, an
// alignment class, <p>, <strong>), and DOMPurify throws out anything else
// when the post is cleaned (content.js), so these convert it first. editor.js
// runs them on its box, on a paste and on what it saves.

// The six hues, named as in tokens.css (--site-hue-1 is red).
export const HUES = ["red", "orange", "yellow", "green", "blue", "violet"];

export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Any color as #rrggbb, so colors can be compared.
const paint = document.createElement("canvas").getContext("2d");
function normalColor(color) {
  paint.fillStyle = "#000000";
  paint.fillStyle = color;
  return paint.fillStyle;
}

// Which of the six hues (1 to 6) a color is, if any.
let hueByColor;
export function hueOfColor(color) {
  hueByColor ??= new Map(HUES.map((_, i) => [normalColor(cssVar(`--site-hue-${i + 1}`)), i + 1]));
  return hueByColor.get(normalColor(color));
}

// A separate, unseen document to work on HTML in. In this page's document, a
// pasted <img onerror> would load, and run, before it was ever cleaned.
export const inert = () => document.implementation.createHTMLDocument("");

// Sets a line's alignment class from however the browser wrote it (Chrome
// writes style="text-align: right", Firefox align="right"). Any other
// alignment class goes first, since Enter copies the previous line's class.
export function lineUp(node) {
  const align = (node.style.textAlign || node.getAttribute("align") || "").toLowerCase();
  node.removeAttribute("align");
  if (!align) return;
  node.classList.remove("align-center", "align-right");
  if (align === "center" || align === "right") node.classList.add(`align-${align}`);
}

// Swaps an element for another tag, keeping its class and children.
function rename(node, tag) {
  const renamed = node.ownerDocument.createElement(tag);
  if (node.className) renamed.className = node.className;
  renamed.append(...node.childNodes);
  node.replaceWith(renamed);
}

// Converts every browser mark under root to a post's. Colors become hues,
// alignments become classes, other styles go, a <div> becomes a <p>, <b>
// becomes <strong> and so on, and headings a post doesn't have become the
// nearest one it does. Returns root.
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
  // drop the invisible spaces insertHtml adds
  const text = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node; (node = text.nextNode());) {
    if (node.data.includes("​")) node.data = node.data.replaceAll("​", "");
  }
  return root;
}

// Strips the browser's inline styles from the box as soon as it adds them.
// Joining a paragraph to a heading, say, wraps the paragraph's words in a
// span that keeps their old size and color, so the line looks like a
// paragraph, spaces like a heading and is saved as a heading. Without the
// styles it shows what it really is. Alignments and hues from the buttons
// become their classes, and a player keeps its own width.
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

// tidy() for a string of HTML.
export function tidyHtml(html) {
  const doc = inert();
  doc.body.innerHTML = html;
  return tidy(doc.body).innerHTML;
}

// Inserts HTML at the cursor. Given a lone inline element like <code> with
// nothing after it, Chrome swaps it for a <span> styled to look the same. An
// invisible space after it prevents that, and tidy() takes it out again.
const BLOCK_TAG = /<(?:p|h[1-6]|ul|ol|li|pre|blockquote|table|hr|figure|div)\b/i;
export function insertHtml(html) {
  document.execCommand("insertHTML", false, BLOCK_TAG.test(html) ? html : `${html}​`);
}

// Escapes text for HTML.
export const escape = (text) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
