// Admin emails. One per visitor comment (server/blog.js), and a digest of what visitors save
// on the desktop (server/desktop.js). Sent through Email Routing (the EMAIL binding) from
// techtrash@<domain> to the NOTIFY_TO secret, so the address is never in the repo.
// Does nothing until both are set. A failed send is logged and never blocks the comment or save.

import { EmailMessage } from "cloudflare:email";

export const notifying = (env) => Boolean(env.EMAIL && env.NOTIFY_TO);

export async function notify(env, host, subject, text) {
  if (!notifying(env)) return;
  const from = `techtrash@${host.replace(/^www\./, "")}`;
  const to = env.NOTIFY_TO.trim();
  try {
    await env.EMAIL.send(new EmailMessage(from, to, message(from, to, subject, text)));
  } catch (error) {
    console.error("couldn't email the admin:", error);
  }
}

const encoder = new TextEncoder();

function base64(text) {
  const bytes = encoder.encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// RFC 2047 encoded words, so a title can't break out of its header line.
// 45 bytes per word keeps each under the 75-char limit.
function encoded(text) {
  const pieces = [""];
  for (const letter of text) {
    if (encoder.encode(pieces.at(-1) + letter).length > 45) pieces.push("");
    pieces[pieces.length - 1] += letter;
  }
  return pieces.map((piece) => `=?UTF-8?B?${base64(piece)}?=`).join("\r\n ");
}

// EmailMessage takes the raw MIME text.
function message(from, to, subject, text) {
  return [
    `From: Techtrash <${from}>`,
    `To: ${to.replace(/[\r\n]/g, "")}`,
    `Subject: ${encoded(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${from.split("@")[1]}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64(text.replace(/\r?\n/g, "\r\n")).replace(/.{1,76}/g, "$&\r\n"),
  ].join("\r\n");
}

// Quoted title, cut to 80 chars.
export const quoted = (title) => `"${title.length > 80 ? `${title.slice(0, 79)}...` : title}"`;
