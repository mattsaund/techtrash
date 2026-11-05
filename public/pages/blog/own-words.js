// techtrash.org : the site's own words: the tagline, Home's words, the
// bulletin, and About me.
//
// Each is shown where it goes, and the admin writes it there, in place: the
// editor blogs are written in (editor/editor.js) takes the words' spot, with
// Save and Cancel under it. Saving draws the page again. The server keeps
// them as "pages" (server/blog.js).

import { renderBody } from "./content.js";
import { admin, again } from "./site.js";
import { api, el, status } from "./util.js";

// Shows the admin's form in a spot, in place of what was there. Gives back
// the way to put what was there back.
export function swap(spot, form) {
  const was = [...spot.childNodes];
  spot.replaceChildren(form);
  return () => spot.replaceChildren(...was);
}

// The tagline, Home's words or About me: its words, or `fallback` until it's
// written, and for the admin a button (`edit` says what it says) that opens
// them in the editor, with any `more` buttons beside it. short: a line or two.
export function ownWords(text, { fallback = null, short = false, look = "", edit, more = [] }) {
  const spot = el("div", { class: `page-text ${look}` });
  const written = Boolean(text.body.trim());
  spot.append(...[written ? el("div", { class: "prose" }, renderBody(text.body)) : fallback].filter(Boolean));
  if (admin) {
    const button = el("button", { class: "button", type: "button", textContent: edit });
    button.addEventListener("click", async () => {
      const back = swap(spot, await writingForm({
        body: text.body,
        short,
        saveText: "Save",
        cancel: () => back(),
        save: async (data) => {
          await api(`/api/blog/page?name=${text.name}`, { method: "PUT", json: data });
          await again();
        },
      }));
    });
    spot.append(el("div", { class: "button-row" }, button, more));
  }
  return spot;
}

// The editor blogs are written in, with Save and Cancel, for one of the site's
// own words. save({ body }) sends it and goes on; cancel() puts back what was
// there. short: the box is short, for a line or two (the tagline).
export async function writingForm({ body = "", short = false, saveText, save, cancel }) {
  const { createEditor } = await import("./editor/editor.js");
  // (what goes wrong in it, a picture that won't upload, is said under Save)
  const editor = createEditor(body, { short, onProblem: (text) => { message.textContent = text; } });
  const message = status();
  const saveButton = el("button", { class: "button hue-4", type: "button", textContent: saveText });
  const back = el("button", { class: "button hue-1", type: "button", textContent: "Cancel" });
  back.addEventListener("click", cancel);
  saveButton.addEventListener("click", async () => {
    if (editor.empty()) {
      message.textContent = "Write something first.";
      return editor.focus();
    }
    saveButton.disabled = true;
    message.textContent = "Saving...";
    try {
      await save({ body: editor.html() });
    } catch (error) {
      message.textContent = error.message;
      saveButton.disabled = false;
    }
  });
  return el("div", { class: "writing-form" },
    editor.element,
    el("div", { class: "button-row" }, saveButton, back),
    message);
}
