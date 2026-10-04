// techtrash.org : what a post is made of.
//
// A post's body is HTML, from the editor (editor.js) or a Markdown file. It's
// cleaned (DOMPurify, down to the short list of tags below) before it's saved,
// and again every time it's shown, so nothing in it can ever run, whatever
// ends up in the database.
//
// A paragraph that's nothing but a link to a video becomes the video's own
// player, and a link to a song or an album becomes a music player: see
// playerFor for who. The post stores the link; the player is drawn as it's
// shown, so a post never holds anything but its words and pictures.

import DOMPurify from "./vendor/purify.js";

const purify = DOMPurify(window);

const TAGS = [
  "p", "br", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s", "del", "code", "span", "a",
  "ul", "ol", "li", "blockquote", "pre", "hr", "img", "table", "thead", "tbody", "tr", "th", "td",
];
const ATTRS = ["href", "src", "alt", "title", "class", "start"];

// The only classes a post may use: words in one of the six hues, where a
// picture sits, and a paragraph's alignment. site.css draws them.
export const PICTURE_PLACES = ["pic--left", "pic--center", "pic--right"];
const CLASSES = new Set([
  "hue-1", "hue-2", "hue-3", "hue-4", "hue-5", "hue-6", ...PICTURE_PLACES, "align-center", "align-right",
]);

// Links go to the web, an email address, or somewhere on this site. Pictures
// come from the web or this site: not from inside the page (data:).
const SAFE_ADDRESS = /^(?:https?:|mailto:|\/(?!\/)|#|\?)/i;

purify.addHook("uponSanitizeAttribute", (node, data) => {
  if (data.attrName === "class") {
    data.attrValue = data.attrValue.split(/\s+/).filter((name) => CLASSES.has(name)).join(" ");
    if (!data.attrValue) data.keepAttr = false;
  }
  if (data.attrName === "src" && !SAFE_ADDRESS.test(data.attrValue.trim())) data.keepAttr = false;
});

// (DOMPurify holds every attribute but a few to the addresses rule: a list's start isn't one.)
const CONFIG = { ALLOWED_TAGS: TAGS, ALLOWED_ATTR: ATTRS, ALLOWED_URI_REGEXP: SAFE_ADDRESS, ADD_URI_SAFE_ATTR: ["start"] };

// Cleaned, as a fragment of this page.
function cleanFragment(html) {
  const body = purify.sanitize(html, { ...CONFIG, RETURN_DOM_FRAGMENT: true });
  for (const img of body.querySelectorAll("img:not([src])")) img.remove();
  // a span that doesn't color anything is only in the way
  for (const span of body.querySelectorAll("span:not([class])")) span.replaceWith(...span.childNodes);
  return body;
}

// Cleaned, as HTML to save.
export function clean(html) {
  const box = document.createElement("div");
  box.append(cleanFragment(html));
  // empty lines at the very start and end of a post
  const empty = (node) => node?.nodeType === Node.ELEMENT_NODE && node.matches("p") && !node.textContent.trim() && !node.querySelector("img");
  while (empty(box.firstElementChild) && box.firstElementChild === box.firstChild) box.firstChild.remove();
  while (empty(box.lastElementChild) && box.lastElementChild === box.lastChild) box.lastChild.remove();
  return box.innerHTML.trim();
}

// A post's body, ready to go on the page: cleaned, with its players.
export function renderBody(html) {
  const body = cleanFragment(html);
  embedPlayers(body, (player) => playerElement(player));
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

// { player, address } if a paragraph is nothing but a link something plays:
// a bare address, linked or not.
export function playerIn(p) {
  const text = p.textContent.trim();
  if (!/^https?:\/\/\S+$/.test(text)) return null;
  if ([...p.children].some((child) => !child.matches("a, br"))) return null;
  const link = p.querySelector("a");
  if (link && link.textContent.trim() !== text) return null;
  const address = link?.getAttribute("href") ?? text;
  const player = playerFor(address);
  return player && { player, address };
}

// Swaps each paragraph that's a player's link for make(player, address).
export function embedPlayers(root, make) {
  for (const p of root.querySelectorAll("p")) {
    const found = playerIn(p);
    if (found) p.replaceWith(make(found.player, found.address));
  }
}

// "1h2m3s", "90s" or "90" as seconds
function seconds(value) {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const m = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  return m ? (Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0) : 0;
}

// What plays a link, or null:
//   { name, kind, src }   kind is video (16:9), tall (9:16), song, list (an
//                         album or a playlist), file (a video file) or sound
//                         (a sound file)
// Videos: YouTube, Vimeo, Dailymotion, Twitch, Streamable, Loom, TikTok, and
// any .mp4, .webm, .ogv, .mov or .m4v. Music: Spotify, SoundCloud, Apple
// Music, and any .mp3, .m4a, .ogg, .oga, .wav or .flac.
export function playerFor(address) {
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

// The player itself.
export function playerElement(player) {
  const box = document.createElement("figure");
  box.className = `embed embed--${player.kind}`;
  if (player.kind === "file" || player.kind === "sound") {
    const media = document.createElement(player.kind === "file" ? "video" : "audio");
    Object.assign(media, { src: player.src, controls: true, preload: "metadata" });
    box.append(media);
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
// editor's Markdown view. They're only loaded when they're needed:
// loadMarkdown() first.
let marked;
let turndown;
export async function loadMarkdown() {
  if (turndown) return;
  const [markedModule, { default: TurndownService }, { gfm }] = await Promise.all([
    import("./vendor/marked.js"), import("./vendor/turndown.js"), import("./vendor/turndown-plugin-gfm.js"),
  ]);
  marked = markedModule.marked;
  turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*", hr: "---" });
  turndown.use(gfm);
  // What Markdown has no way to say (a hue, where a picture sits, a line's
  // alignment, underline) stays the HTML it is, which Markdown allows.
  turndown.addRule("classes", {
    filter: (node) => ["SPAN", "IMG", "P", "H2", "H3", "H4"].includes(node.nodeName) && Boolean(node.getAttribute("class")),
    replacement: (content, node) => (["SPAN", "IMG"].includes(node.nodeName) ? node.outerHTML : `\n\n${node.outerHTML}\n\n`),
  });
  turndown.addRule("underline", { filter: ["u"], replacement: (content) => `<u>${content}</u>` });
  // "- one", not turndown's "-   one": how people write lists by hand
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

export const htmlToMarkdown = (html) => turndown.turndown(html);

// The post's title is its only top heading, so a Markdown "#" heading goes down one.
export const markdownToHtml = (text) => marked.parse(text, { gfm: true, async: false })
  .replace(/<(\/?)h1\b/g, "<$1h2")
  .replace(/<(\/?)h[56]\b/g, "<$1h4");

// A Markdown file, as { title, html, missing }: its title, if it starts with
// one ("# A title", or title: in front matter), its body as clean HTML, and
// how many of its pictures were files on the computer it was written on,
// which can't come along.
export async function fromMarkdown(text) {
  await loadMarkdown();
  let title = "";
  text = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
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
