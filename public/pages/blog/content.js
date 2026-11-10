// What a post is made of. The body is HTML, from the editor
// (editor/editor.js) or a Markdown file. DOMPurify cleans it down to the
// short list of tags below before it's saved and again every time it's
// shown, so nothing in it can ever run, whatever ends up in the database.
//
// A paragraph that's only a link to a video, a song or an album becomes a
// player (playerFor has the list). Sound files, like one uploaded in the
// editor (a link with its name as the text), get the site's own player,
// sound.js. The post only stores the link and the player is drawn when it's
// shown, so a post never holds anything but words and pictures.
//
// Pictures and players can be given a width by dragging in the editor. A
// picture keeps it as width="" (pixels), a player as data-width="" on its
// link's paragraph. Neither ever gets wider than the column.

import { soundPlayer } from "./sound.js";
import DOMPurify from "./vendor/purify.js";

const purify = DOMPurify(window);

const TAGS = [
  "p", "br", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s", "del", "code", "span", "a",
  "ul", "ol", "li", "blockquote", "pre", "hr", "img", "table", "thead", "tbody", "tr", "th", "td",
];
const ATTRS = ["href", "src", "alt", "title", "class", "start", "width", "data-width"];

// The only classes a post may use, for the six hues, where a picture sits
// and a paragraph's alignment. site.css draws them.
export const PICTURE_PLACES = ["pic--left", "pic--center", "pic--right"];
const CLASSES = new Set([
  "hue-1", "hue-2", "hue-3", "hue-4", "hue-5", "hue-6", ...PICTURE_PLACES, "align-center", "align-right",
  // a line that starts below any floated pictures before it
  "under-pic",
]);

// Links go to the web, an email address or somewhere on this site. Pictures
// come from the web or this site, never from inside the page (data:).
const SAFE_ADDRESS = /^(?:https?:|mailto:|\/(?!\/)|#|\?)/i;

purify.addHook("uponSanitizeAttribute", (node, data) => {
  if (data.attrName === "class") {
    data.attrValue = data.attrValue.split(/\s+/).filter((name) => CLASSES.has(name)).join(" ");
    if (!data.attrValue) data.keepAttr = false;
  }
  if (data.attrName === "src" && !SAFE_ADDRESS.test(data.attrValue.trim())) data.keepAttr = false;
  // a width is whole pixels, and only on a picture or a player's paragraph
  if (data.attrName === "width" && (node.nodeName !== "IMG" || !widthOf(data.attrValue))) data.keepAttr = false;
  if (data.attrName === "data-width" && (node.nodeName !== "P" || !widthOf(data.attrValue))) data.keepAttr = false;
});

// DOMPurify checks most attribute values against SAFE_ADDRESS. A list's start
// and a width aren't addresses, so they're exempt. data-width is the only
// data- attribute allowed.
const CONFIG = {
  ALLOWED_TAGS: TAGS,
  ALLOWED_ATTR: ATTRS,
  ALLOWED_URI_REGEXP: SAFE_ADDRESS,
  ADD_URI_SAFE_ATTR: ["start", "width", "data-width"],
  ALLOW_DATA_ATTR: false,
};

// A width as a post keeps it, in whole pixels, or null.
export function widthOf(value) {
  const width = /^\s*\d{1,4}\s*$/.test(value ?? "") ? Number(value) : 0;
  return width > 0 ? width : null;
}

// A line with no words and no picture. Spaces, no-break spaces and the
// editor's zero-width ones don't count as words. An empty paragraph is a
// blank line put in on purpose. An empty heading, quote or code block is
// just a gap.
const LINE_KINDS = "p, h1, h2, h3, h4, h5, h6, blockquote, pre";
export const blankLine = (node) => node?.nodeType === Node.ELEMENT_NODE && node.matches(LINE_KINDS)
  && !node.textContent.replace(/[\s\u00a0\u200b]/g, "") && !node.querySelector("img");

// The cleaned HTML, as a fragment of this page.
function cleanFragment(html) {
  const body = purify.sanitize(html, { ...CONFIG, RETURN_DOM_FRAGMENT: true });
  for (const img of body.querySelectorAll("img:not([src])")) img.remove();
  // a span that doesn't color anything is only in the way
  for (const span of body.querySelectorAll("span:not([class])")) span.replaceWith(...span.childNodes);
  // A blank line between a post's lines is there on purpose, so it stays as
  // a <p> with a <br> in it. That makes it one line high however it came (an
  // empty <p></p> has no height, an empty heading only a heading's gap).
  // Blank lines inside a quote or a list go, and so do any at the start or
  // end of the post.
  for (const line of body.querySelectorAll(LINE_KINDS)) {
    if (!blankLine(line)) continue;
    if (line.parentNode !== body) {
      line.remove();
      continue;
    }
    const empty = document.createElement("p");
    if (line.getAttribute("class")) empty.setAttribute("class", line.getAttribute("class"));
    empty.append(document.createElement("br"));
    line.replaceWith(empty);
  }
  const edge = (node) => node && ((node.nodeType === Node.TEXT_NODE && !node.data.trim()) || blankLine(node));
  while (edge(body.firstChild)) body.firstChild.remove();
  while (edge(body.lastChild)) body.lastChild.remove();
  return body;
}

// The cleaned HTML, as a string to save.
export function clean(html) {
  const box = document.createElement("div");
  box.append(cleanFragment(html));
  return box.innerHTML.trim();
}

// A post's body ready for the page, cleaned and with its players.
export function renderBody(html) {
  const body = cleanFragment(html);
  embedPlayers(body, (player, address, width, title) => sizePlayer(playerElement(player, title), width));
  for (const img of body.querySelectorAll("img")) img.loading = "lazy";
  // a wide table scrolls on its own, rather than the page
  for (const table of body.querySelectorAll("table")) {
    const scroll = document.createElement("div");
    scroll.className = "table-scroll";
    table.replaceWith(scroll);
    scroll.append(table);
  }
  return body;
}

// --- players ---------------------------------------------------------------------

// A sound uploaded in the editor lives at /blog/sound/<name>.
export const SOUND_FILE = /^\/blog\/sound\/[\w-]+\.(?:mp3|m4a|aac|ogg|wav|flac)$/;

// { player, address, width, title } if a paragraph is nothing but a playable
// link. That's a bare address (linked or not) or an uploaded sound linked by
// its name. width is the player's own or null, and title is a sound's name.
export function playerIn(p) {
  if ([...p.children].some((child) => !child.matches("a, br"))) return null;
  const text = p.textContent.trim();
  const links = p.querySelectorAll("a");
  const width = widthOf(p.getAttribute("data-width"));
  const sound = links.length === 1 && links[0].getAttribute("href");
  if (sound && SOUND_FILE.test(sound) && links[0].textContent.trim() === text) {
    return { player: playerFor(sound), address: sound, width, title: text && text !== sound ? text : soundTitle(sound) };
  }
  if (!/^https?:\/\/\S+$/.test(text)) return null;
  const link = links[0];
  if (link && link.textContent.trim() !== text) return null;
  const address = link?.getAttribute("href") ?? text;
  const player = playerFor(address);
  return player && { player, address, width, title: player.kind === "sound" ? soundTitle(address) : null };
}

// A sound file's name from its address, so .../One%20More%20Time.mp3 is
// "One More Time". An uploaded one also loses its random -3f9a1c.
function soundTitle(address) {
  let name = address.split(/[?#]/)[0].split("/").pop() ?? "";
  try {
    name = decodeURIComponent(name);
  } catch {}
  name = name.replace(/\.[^.]*$/, "");
  return (SOUND_FILE.test(address) ? name.replace(/-[\da-f]{6}$/, "") : name).replace(/[-_]+/g, " ").trim() || "Sound";
}

// Swaps each paragraph that's a player's link for make(player, address, width, title).
export function embedPlayers(root, make) {
  for (const p of root.querySelectorAll("p")) {
    const found = playerIn(p);
    if (found) p.replaceWith(make(found.player, found.address, found.width, found.title));
  }
}

// "1h2m3s", "90s" or "90" as seconds
function seconds(value) {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const m = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  return m ? (Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0) : 0;
}

// The player for a link as { name, kind, src }, or null. kind is video
// (16:9), tall (9:16), song, list (an album or playlist), file (a video file)
// or sound (a sound file, in the site's own player).
//
// Videos are YouTube, Vimeo, Dailymotion, Twitch, Streamable, Loom, TikTok and
// any .mp4, .webm, .ogv, .mov or .m4v. Music is Spotify, SoundCloud, Apple
// Music, any .mp3, .m4a, .ogg, .oga, .wav or .flac, and uploaded sounds.
export function playerFor(address) {
  if (SOUND_FILE.test(address)) return { name: "Sound", kind: "sound", src: address };
  let url;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.toLowerCase().replace(/^(?:www|m)\./, "");
  const path = url.pathname.split("/").filter(Boolean);
  const q = url.searchParams;
  const id = (value, pattern = /^[\w-]+$/) => (pattern.test(value ?? "") ? value : null);

  if (["youtube.com", "music.youtube.com", "youtube-nocookie.com", "youtu.be"].includes(host)) {
    const start = seconds(q.get("t") ?? q.get("start"));
    const from = start ? `?start=${start}` : "";
    if (path[0] === "playlist" && id(q.get("list"))) {
      return { name: "YouTube", kind: "video", src: `https://www.youtube-nocookie.com/embed/videoseries?list=${q.get("list")}` };
    }
    const video = host === "youtu.be" ? path[0]
      : path[0] === "watch" ? q.get("v")
      : ["shorts", "embed", "live", "v"].includes(path[0]) ? path[1] : null;
    if (!id(video, /^[\w-]{11}$/)) return null;
    return { name: "YouTube", kind: path[0] === "shorts" ? "tall" : "video", src: `https://www.youtube-nocookie.com/embed/${video}${from}` };
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const at = path.findIndex((part) => /^\d+$/.test(part));
    if (at < 0) return null;
    const hash = id(path[at + 1], /^[\da-f]+$/) ?? id(q.get("h"), /^[\da-f]+$/);
    return { name: "Vimeo", kind: "video", src: `https://player.vimeo.com/video/${path[at]}${hash ? `?h=${hash}` : ""}` };
  }
  if (host === "dailymotion.com" || host === "dai.ly") {
    const video = id(host === "dai.ly" ? path[0] : path[0] === "video" ? path[1]?.split("_")[0] : null, /^[a-z\d]+$/i);
    return video && { name: "Dailymotion", kind: "video", src: `https://www.dailymotion.com/embed/video/${video}` };
  }
  if (host === "twitch.tv" || host === "clips.twitch.tv") {
    const parent = `parent=${location.hostname}`;
    const clip = host === "clips.twitch.tv" ? path[0] : path[1] === "clip" ? path[2] : null;
    if (id(clip)) return { name: "Twitch", kind: "video", src: `https://clips.twitch.tv/embed?clip=${clip}&${parent}` };
    if (path[0] === "videos" && id(path[1], /^\d+$/)) return { name: "Twitch", kind: "video", src: `https://player.twitch.tv/?video=${path[1]}&${parent}` };
    if (path.length === 1 && id(path[0], /^\w{3,25}$/)) return { name: "Twitch", kind: "video", src: `https://player.twitch.tv/?channel=${path[0]}&${parent}` };
    return null;
  }
  if (host === "streamable.com") {
    const video = id(path[0] === "e" ? path[1] : path[0], /^[a-z\d]+$/i);
    return video && { name: "Streamable", kind: "video", src: `https://streamable.com/e/${video}` };
  }
  if (host === "loom.com") {
    const video = id(["share", "embed"].includes(path[0]) ? path[1] : null, /^[\da-f]+$/i);
    return video && { name: "Loom", kind: "video", src: `https://www.loom.com/embed/${video}` };
  }
  if (host === "tiktok.com") {
    const video = id(path[1] === "video" ? path[2] : null, /^\d+$/);
    return video && { name: "TikTok", kind: "tall", src: `https://www.tiktok.com/player/v1/${video}` };
  }
  if (host === "open.spotify.com") {
    const at = path[0]?.startsWith("intl-") ? 1 : 0;
    const [type, item] = path.slice(at);
    if (!["track", "album", "playlist", "episode", "show", "artist"].includes(type) || !id(item, /^[a-z\d]+$/i)) return null;
    return { name: "Spotify", kind: ["track", "episode"].includes(type) ? "song" : "list", src: `https://open.spotify.com/embed/${type}/${item}` };
  }
  if (host === "soundcloud.com" && path.length >= 2 && !["discover", "search", "you"].includes(path[0])) {
    const page = `https://soundcloud.com/${path.map(encodeURIComponent).join("/")}`;
    return { name: "SoundCloud", kind: path[1] === "sets" ? "list" : "song", src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(page)}` };
  }
  if (host === "music.apple.com" && ["album", "playlist", "song"].includes(path[1])) {
    const song = path[1] === "song" || q.has("i");
    return { name: "Apple Music", kind: song ? "song" : "list", src: `https://embed.music.apple.com${url.pathname}${url.search}` };
  }
  if (/\.(?:mp4|webm|ogv|mov|m4v)$/i.test(url.pathname)) return { name: "Video", kind: "file", src: url.href };
  if (/\.(?:mp3|m4a|ogg|oga|wav|flac)$/i.test(url.pathname)) return { name: "Sound", kind: "sound", src: url.href };
  return null;
}

// Sets a player's own width (null for the column's) and keeps it as
// data-width, like its paragraph does. site.css caps it at the column.
export function sizePlayer(box, width) {
  if (width) {
    box.style.width = `${width}px`;
    box.dataset.width = width;
  } else {
    box.style.removeProperty("width");
    delete box.dataset.width;
  }
  return box;
}

// The player itself. title is a sound's name.
export function playerElement(player, title = null) {
  const box = document.createElement("figure");
  box.className = `embed embed--${player.kind}`;
  if (player.kind === "sound") {
    box.append(soundPlayer(player.src, title || soundTitle(player.src)));
    return box;
  }
  if (player.kind === "file") {
    const video = document.createElement("video");
    Object.assign(video, { src: player.src, controls: true, preload: "metadata" });
    box.append(video);
    return box;
  }
  const frame = document.createElement("iframe");
  Object.assign(frame, {
    src: player.src,
    title: `${player.name} player`,
    loading: "lazy",
    allowFullscreen: true,
    referrerPolicy: "strict-origin-when-cross-origin",
  });
  frame.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";
  box.append(frame);
  return box;
}

// --- Markdown --------------------------------------------------------------------

// Markdown to HTML (marked) and back (turndown), for Markdown files and the
// editor's Markdown view. Both load on demand, so call loadMarkdown() first.
let marked;
let turndown;
export async function loadMarkdown() {
  if (turndown) return;
  const [markedModule, { default: TurndownService }, { gfm }] = await Promise.all([
    import("./vendor/marked.js"), import("./vendor/turndown.js"), import("./vendor/turndown-plugin-gfm.js"),
  ]);
  marked = markedModule.marked;
  // (a <br> is just a newline, since newlines are line breaks here, see markdownToHtml)
  turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*", hr: "---", br: "" });
  turndown.use(gfm);
  // What Markdown can't say (a hue, where a picture sits, a picture's or a
  // player's width, alignment, underline) stays as HTML, which Markdown allows.
  turndown.addRule("classes", {
    filter: (node) => ["SPAN", "IMG", "P", "H2", "H3", "H4"].includes(node.nodeName)
      && (Boolean(node.getAttribute("class")) || node.hasAttribute("width") || node.hasAttribute("data-width")),
    replacement: (content, node) => (["SPAN", "IMG"].includes(node.nodeName) ? node.outerHTML : `\n\n${node.outerHTML}\n\n`),
  });
  turndown.addRule("underline", { filter: ["u"], replacement: (content) => `<u>${content}</u>` });
  // (an empty line with a class, like one under a picture, stays as HTML)
  turndown.addRule("emptyLine", {
    filter: (node) => node.nodeName === "P" && !node.getAttribute("class") && blankLine(node),
    replacement: () => `\n\n${EMPTY}\n\n`,
  });
  // "- one" the way people type lists, not turndown's "-   one"
  turndown.addRule("listItem", {
    filter: "li",
    replacement: (content, node, options) => {
      const list = node.parentNode;
      let prefix = `${options.bulletListMarker} `;
      if (list.nodeName === "OL") prefix = `${Number(list.getAttribute("start") ?? 1) + [...list.children].indexOf(node)}. `;
      const inner = content.replace(/^\n+/, "").replace(/\n+$/, "\n").replace(/\n/gm, `\n${" ".repeat(prefix.length)}`);
      return prefix + inner + (node.nextSibling && !/\n$/.test(inner) ? "\n" : "");
    },
  });
}

// Markdown code fences. A line of ``` or ~~~ opens one (fenceOpens returns the
// marks), and a line of at least as many of the same mark closes it. Nothing
// inside is Markdown.
export const fenceOpens = (line) => line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1] ?? null;
export const fenceCloses = (line, fence) => /^\s{0,3}[`~]+\s*$/.test(line) && line.trim()[0] === fence[0] && line.trim().length >= fence.length;

// Each blank line in a post is one more blank line in its Markdown. One blank
// line is just the break between paragraphs, as in any Markdown, and each
// extra one is a line of space (see emptyLinesStay). Turndown can't write a
// run of them, so each is a placeholder mark until it's done.
const EMPTY = "\uE000";
export const htmlToMarkdown = (html) => turndown.turndown(html)
  .replace(new RegExp(`${EMPTY}\n\n`, "g"), "\n")
  .replace(new RegExp(`\n*${EMPTY}\n*`, "g"), "");

// ...and back. Each blank line past the first becomes a blank line in the
// post (plain Markdown squashes any number of them into one paragraph break).
// Not inside code.
function emptyLinesStay(text) {
  const out = [];
  let fence = null;
  let empties = 0;
  for (const line of text.split("\n")) {
    if (!fence && !line.trim()) {
      empties += 1;
      continue;
    }
    if (empties && out.length) {
      out.push("");
      for (let i = 1; i < empties; i++) out.push("&nbsp;", "");
    }
    empties = 0;
    if (fence) {
      if (fenceCloses(line, fence)) fence = null;
    } else fence = fenceOpens(line);
    out.push(line);
  }
  return out.join("\n");
}

// A line of dashes (or =) right under some words is Markdown's other way to
// write a heading. The editor draws a line of dashes as a divider, which is
// what it usually means, so a blank line goes in above it to keep it one (and
// above a line of =, which then shows as words). Not inside code.
function dividersStayDividers(text) {
  let fence = null;
  const out = [];
  for (const line of text.split("\n")) {
    if (fence) {
      if (fenceCloses(line, fence)) fence = null;
    } else if (fenceOpens(line)) fence = fenceOpens(line);
    else if (/^ {0,3}(?:=+|-{3,})[ \t]*$/.test(line) && out.length && out[out.length - 1].trim()) out.push("");
    out.push(line);
  }
  return out.join("\n");
}

// The post's title is its only top heading, so a Markdown "#" heading moves
// down a level. A newline is a line break, as in Obsidian, since the editor
// writes Markdown a line to a row and a row should stay a row.
export const markdownToHtml = (text) => marked.parse(dividersStayDividers(emptyLinesStay(text)), { gfm: true, breaks: true, async: false })
  .replace(/<(\/?)h1\b/g, "<$1h2")
  .replace(/<(\/?)h[56]\b/g, "<$1h4");

// A Markdown file as { title, html, missing }. title comes from a leading
// "# A title" or the front matter's title, html is the clean body, and
// missing counts the pictures that were files on the writer's computer,
// which can't come along.
export async function fromMarkdown(text) {
  await loadMarkdown();
  let title = "";
  text = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const front = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (front) {
    title = front[1].match(/^title:\s*["']?(.*?)["']?\s*$/m)?.[1] ?? "";
    text = text.slice(front[0].length);
  }
  const heading = text.match(/^\s*#\s+(.+?)\s*#*\s*(?:\n|$)/);
  if (heading && !title) {
    title = heading[1];
    text = text.slice(heading[0].length);
  }
  const html = markdownToHtml(text);
  const box = document.createElement("template");
  box.innerHTML = html;
  const missing = [...box.content.querySelectorAll("img")].filter((img) => !SAFE_ADDRESS.test(img.getAttribute("src") ?? "")).length;
  return { title, html: clean(html), missing };
}
