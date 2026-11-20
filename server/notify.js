// Emails the admin. Once for each comment a visitor leaves on a blog
// (server/blog.js), and at most every few minutes about what visitors have
// saved on the XP desktop (server/desktop.js), all in one email.
//
// It goes out through Cloudflare's Email Routing (the EMAIL binding in
// wrangler.jsonc), from techtrash@<the site's domain>, to the address in the
// NOTIFY_TO secret, so the address is never in this repo. Until both are
// there it does nothing, and if sending fails the comment or the save still
// goes through. The reason ends up in the Worker's logs.

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

// A header's text in UTF-8 (RFC 2047), so a blog's title can hold anything
// and still never break out of its line. Each piece fits a header line.
function encoded(text) {
  const pieces = [""];
  for (const letter of text) {
    if (encoder.encode(pieces.at(-1) + letter).length > 45) pieces.push("");
    pieces[pieces.length - 1] += letter;
  }
  return pieces.map((piece) => `=?UTF-8?B?${base64(piece)}?=`).join("\r\n ");
}

// The whole email, as plain text.
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

// "Liftoff", cut short if it's long.
export const quoted = (title) => `"${title.length > 80 ? `${title.slice(0, 79)}...` : title}"`;
