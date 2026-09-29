// techtrash.org : the admin's forms for topics and flags.
//
// Only ever drawn for the admin, and only a convenience: the server checks
// it's the admin again for everything they send.

import { api, el, hueOf, pictureUrl, readyPicture, status, twoClick } from "./util.js";

// Checkboxes for the flags a topic wears, and a field to make a new one,
// which it then wears. .chosen() says which, as ids.
function flagPicker(flags, wearing = []) {
  const chips = el("div", { class: "chips" });
  const addChip = (flag, checked) => chips.append(el("label", { class: `chip ${hueOf(flag.id)}` },
    el("input", { type: "checkbox", value: flag.id, checked }), flag.name));
  for (const flag of flags) addChip(flag, wearing.includes(flag.id));

  const name = el("input", { maxlength: "40", placeholder: "Music, Space, Trips...", "aria-label": "A new flag" });
  const make = el("button", { class: "button", type: "button", textContent: "Make flag" });
  const said = el("span", { class: "meta", role: "status" });
  const go = async () => {
    said.textContent = "";
    try {
      addChip(await api("/api/blog/flags", { method: "POST", json: { name: name.value } }), true);
      name.value = "";
    } catch (error) {
      said.textContent = error.message;
    }
  };
  make.addEventListener("click", go);
  name.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();   // not the whole form
    go();
  });

  const box = el("fieldset", { class: "picker" },
    el("legend", { textContent: "Flags" }),
    flags.length ? null : el("p", { class: "meta", textContent: "No flags yet. Make one:" }),
    chips,
    el("div", { class: "inline" }, name, make),
    said);
  box.chosen = () => [...chips.querySelectorAll("input:checked")].map((input) => input.value);
  return box;
}

// A new topic (no topic), or a change to one. done(topic) when it's saved;
// cancel(), if there is one, puts back what was there.
export function topicForm({ topic = null, flags, done, cancel }) {
  const title = el("input", { name: "title", maxlength: "120", required: true, value: topic?.title ?? "" });
  const description = el("textarea", { name: "description", rows: "3", maxlength: "1000", value: topic?.description ?? "" });
  const picture = el("input", { type: "file", name: "picture", accept: "image/*" });
  const removePicture = topic?.picture && el("input", { type: "checkbox", name: "removePicture" });
  const picker = flagPicker(flags, topic?.flags.map((flag) => flag.id));
  const message = status();
  const save = el("button", { class: "button hue-4", textContent: topic ? "Save topic" : "Post topic" });
  const back = cancel && el("button", { class: "button hue-1", type: "button", textContent: "Cancel" });
  back?.addEventListener("click", cancel);

  const form = el("form", { class: "form" }, el("fieldset", {},
    el("legend", { textContent: topic ? "Edit topic" : "New topic" }),
    el("label", {}, "Title", title),
    el("label", {}, "Description (if you like)", description),
    topic?.picture ? el("img", { class: "form__picture", src: pictureUrl(topic.picture), alt: "The topic's picture now" }) : null,
    el("label", {}, topic?.picture ? "A new picture" : "Picture (if you like)", picture),
    removePicture ? el("label", { class: "check" }, removePicture, "Take the picture off") : null,
    picker,
    el("div", { class: "button-row" }, save, back),
    message));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    save.disabled = true;
    const data = new FormData();
    data.append("title", title.value);
    data.append("description", description.value);
    data.append("flags", picker.chosen().join(","));
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

// Every flag: rename one, delete one (it comes off its topics), make one.
// done() after each change.
export function flagManager(flags, done) {
  const rows = flags.map((flag) => {
    const name = el("input", { value: flag.name, maxlength: "40", "aria-label": `Rename ${flag.name}` });
    const rename = el("button", { class: "button", type: "button", textContent: "Rename", disabled: true });
    const said = el("span", { class: "meta", role: "status" });
    name.addEventListener("input", () => { rename.disabled = !name.value.trim() || name.value.trim() === flag.name; });
    rename.addEventListener("click", async () => {
      try {
        await api(`/api/blog/flag?id=${flag.id}`, { method: "PUT", json: { name: name.value } });
        done();
      } catch (error) {
        said.textContent = error.message;
      }
    });
    const remove = twoClick("Delete", flag.topic_count ? `Click again: it comes off ${flag.topic_count === 1 ? "1 topic" : `${flag.topic_count} topics`}` : "Click again to delete", async () => {
      await api(`/api/blog/flag?id=${flag.id}`, { method: "DELETE" });
      done();
    });
    return el("div", { class: `inline ${hueOf(flag.id)}` }, name, rename, remove, said);
  });

  const name = el("input", { maxlength: "40", placeholder: "A new flag", "aria-label": "A new flag" });
  const make = el("button", { class: "button", textContent: "Make flag" });
  const said = status();
  const form = el("form", { class: "form" }, el("fieldset", {},
    el("legend", { textContent: "Flags" }),
    rows.length ? rows : el("p", { class: "meta", textContent: "No flags yet." }),
    el("div", { class: "inline" }, name, make),
    said));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/blog/flags", { method: "POST", json: { name: name.value } });
      done();
    } catch (error) {
      said.textContent = error.message;
    }
  });
  return form;
}
