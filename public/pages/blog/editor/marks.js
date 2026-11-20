// Converts contenteditable markup (<font color>, style="", align="", <div>, <b>) to a
// post's (hue and align classes, <p>, <strong>). Must run before clean() in content.js,
// whose DOMPurify config strips the browser's version.

// Same order as --site-hue-1 to --site-hue-6 in tokens.css.
export const HUES = ["red", "orange", "yellow", "green", "blue", "violet"];

export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Canvas normalizes any CSS color to #rrggbb, so colors can be compared.
const paint = document.createElement("canvas").getContext("2d");
function normalColor(color) {
  paint.fillStyle = "#000000";
  paint.fillStyle = color;
  return paint.fillStyle;
}

// Hue number (1 to 6) for a color, or undefined.
let hueByColor;
export function hueOfColor(color) {
  hueByColor ??= new Map(HUES.map((_, i) => [normalColor(cssVar(`--site-hue-${i + 1}`)), i + 1]));
  return hueByColor.get(normalColor(color));
}

// Detached document for untrusted HTML. In the live one, <img onerror> fires before cleaning.
export const inert = () => document.implementation.createHTMLDocument("");

// Chrome writes style="text-align", Firefox align="". Both become an align-* class.
// Old align-* classes are cleared first since Enter copies the previous line's class.
export function lineUp(node) {
  const align = (node.style.textAlign || node.getAttribute("align") || "").toLowerCase();
  node.removeAttribute("align");
  if (!align) return;
  node.classList.remove("align-center", "align-right");
  if (align === "center" || align === "right") node.classList.add(`align-${align}`);
}

// Swap the tag, keeping class and children.
function rename(node, tag) {
  const renamed = node.ownerDocument.createElement(tag);
  if (node.className) renamed.className = node.className;
  renamed.append(...node.childNodes);
  node.replaceWith(renamed);
}

// Converts in place and returns root. Off-palette colors are dropped.
// h1, h5 and h6 become the nearest heading a post has (h2 to h4).
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
  // strip the zero-width spaces insertHtml() adds
  const text = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node; (node = text.nextNode());) {
    if (node.data.includes("​")) node.data = node.data.replaceAll("​", "");
  }
  return root;
}

// Strips inline styles as soon as the browser adds them, so the box shows what gets saved.
// Joining a paragraph to a heading wraps its text in a span that keeps the old size and color.
// Alignments and hues become classes. Players keep their inline width.
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

// Chrome turns a lone inline element like <code> into a look-alike styled <span>.
// A trailing zero-width space prevents that. tidy() removes it.
const BLOCK_TAG = /<(?:p|h[1-6]|ul|ol|li|pre|blockquote|table|hr|figure|div)\b/i;
export function insertHtml(html) {
  document.execCommand("insertHTML", false, BLOCK_TAG.test(html) ? html : `${html}​`);
}

export const escape = (text) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
