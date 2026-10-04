// techtrash.org : the admin's form for a topic.
//
// Only ever drawn for the admin, and only a convenience: the server checks
// it's the admin again for everything they send.

import { api, el, pictureUrl, readyPicture, status } from "./util.js";

// A topic's description from before descriptions were written in the editor:
// plain text, as the HTML that shows it the same.
const textAsHtml = (text) => text.split(/\n{2,}/)
  .map((paragraph) => `<p>${paragraph.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]).replace(/\n/g, "<br>")}</p>`)
  .join("");

// A new topic (no topic), or a change to one. Its description is written in
// the editor posts have. done(topic) when it's saved; cancel(), if there is
// one, puts back what was there.
export async function topicForm({ topic = null, done, cancel }) {
  const { createEditor } = await import("./editor.js");
  const title = el("input", { name: "title", maxlength: "120", required: true, value: topic?.title ?? "" });
  const was = topic?.description ?? "";
  const description = createEditor(/^\s*</.test(was) ? was : textAsHtml(was));
  const picture = el("input", { type: "file", name: "picture", accept: "image/*" });
  const removePicture = topic?.picture && el("input", { type: "checkbox", name: "removePicture" });
  const message = status();
  const save = el("button", { class: "button hue-4", textContent: topic ? "Save topic" : "Post topic" });
  const back = cancel && el("button", { class: "button hue-1", type: "button", textContent: "Cancel" });
  back?.addEventListener("click", cancel);

  const form = el("form", { class: "form" }, el("fieldset", {},
    el("legend", { textContent: topic ? "Edit topic" : "New topic" }),
    el("label", {}, "Title", title),
    // not a <label>: a click in the editor would go to the first field in it
    el("div", { class: "form__field" }, el("span", { textContent: "Description (if you like): words, pictures, videos" }), description.element),
    topic?.picture ? el("img", { class: "form__picture", src: pictureUrl(topic.picture), alt: "The topic's picture now" }) : null,
    el("label", {}, topic?.picture ? "A new picture" : "Picture (if you like)", picture),
    removePicture ? el("label", { class: "check" }, removePicture, "Take the picture off") : null,
    el("div", { class: "button-row" }, save, back),
    message));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    save.disabled = true;
    const data = new FormData();
    data.append("title", title.value);
    data.append("description", description.empty() ? "" : description.html());
    if (removePicture?.checked) data.append("removePicture", "1");
    try {
      const file = picture.files[0];
      if (file) {
        message.textContent = "Getting the picture ready...";
        data.append("picture", await readyPicture(file), file.name);
      }
      message.textContent = "Saving...";
      done(topic
        ? await api(`/api/blog/topic?id=${topic.id}`, { method: "PUT", form: data })
        : await api("/api/blog/topics", { method: "POST", form: data }));
    } catch (error) {
      message.textContent = error.message;
      save.disabled = false;
    }
  });
  return form;
}
