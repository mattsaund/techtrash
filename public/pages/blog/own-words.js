// Editable site text (tagline, Home, bulletin, About me, footer). Stored as
// "pages" by server/blog.js. The admin edits in place with editor/editor.js.

import { renderBody } from "./content.js";
import { admin, again } from "./site.js";
import { api, el, status } from "./util.js";

// Swaps form into spot. Returns a function that restores the old contents.
export function swap(spot, form) {
  const was = [...spot.childNodes];
  spot.replaceChildren(form);
  return () => spot.replaceChildren(...was);
}

// Renders a page's text, or fallback when empty. The admin gets an `edit`
// button plus `more`. short is a line or two, canEmpty allows saving nothing.
export function ownWords(text, { fallback = null, short = false, look = "", edit, more = [], canEmpty = false }) {
  const spot = el("div", { class: `page-text ${look}` });
  const written = Boolean(text.body.trim());
  spot.append(...[written ? el("div", { class: "prose" }, renderBody(text.body)) : fallback].filter(Boolean));
  if (admin) {
    const button = el("button", { class: "button", type: "button", textContent: edit });
    button.addEventListener("click", async () => {
      const back = swap(spot, await writingForm({
        body: text.body,
        short,
        canEmpty,
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

// Editor with Save and Cancel. save({ body }) throws to show an error.
// short and canEmpty as in ownWords.
export async function writingForm({ body = "", short = false, canEmpty = false, saveText, save, cancel }) {
  const { createEditor } = await import("./editor/editor.js");
  // editor errors (like a failed upload) show under Save
  const editor = createEditor(body, { short, onProblem: (text) => { message.textContent = text; } });
  const message = status();
  const saveButton = el("button", { class: "button hue-4", type: "button", textContent: saveText });
  const back = el("button", { class: "button hue-1", type: "button", textContent: "Cancel" });
  back.addEventListener("click", cancel);
  saveButton.addEventListener("click", async () => {
    if (editor.empty() && !canEmpty) {
      message.textContent = "Write something first.";
      return editor.focus();
    }
    saveButton.disabled = true;
    message.textContent = "Saving...";
    try {
      await save({ body: editor.empty() ? "" : editor.html() });
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
