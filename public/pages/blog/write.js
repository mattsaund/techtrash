// techtrash.org : the admin's page for writing a blog (?write, ?edit/<blog>).
//
// A title, the editor (editor/editor.js), the blog's flags, whether its
// comments are on, and the buttons to save it. A new blog, or a draft, saves
// as a draft (Save draft, or Ctrl+S) to finish another time, and the page
// stays open to go on with; Publish puts it up. A blog that's up saves its
// changes (Ctrl+S saves and stays open).
//
// What's being written is kept in this browser as it's typed (localStorage,
// under "techtrash:draft:new" or "techtrash:draft:post-<id>"), until it's
// saved or thrown away: closing the window loses nothing. Those names have to
// stay as they are, or what's kept under the old ones would be lost.

import { framed } from "./frame.js";
import { moveTo, theBlog, titled, to } from "./site.js";
import { api, backTo, el, hueOf, remembered, status, twoClick } from "./util.js";

// The flags a blog has, in the editor: each one a button that takes it off,
// then a box to name another (Enter or a comma puts it on; Backspace in the
// empty box takes the last one off), and under them the flags other blogs
// have, a click each. { element, value(), take() }: value() is the flags'
// names, and take() puts on the one still being typed, if there is one.
function flagPicker(start, known, onChange) {
  const MAX = 20;
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  let names = [];
  const on = el("span", { class: "flag-picker__on" });
  const field = el("input", { class: "flag-picker__field", maxlength: "40", placeholder: "Add a flag", "aria-label": "Add a flag" });
  const others = el("p", { class: "flag-picker__others" });

  // the way it's spelled already, if a blog has it
  const put = (typed) => {
    const name = typed.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!name || names.some((n) => same(n, name)) || names.length >= MAX) return false;
    names.push(known.find((flag) => same(flag.name, name))?.name ?? name);
    return true;
  };
  function draw() {
    on.replaceChildren(...names.map((name) => {
      const flag = known.find((f) => same(f.name, name));
      const chip = el("button", { class: `button button--small flag ${flag ? hueOf(flag.id) : ""}`, type: "button", title: "Take it off", "aria-label": `Take ${name} off` },
        name, el("span", { class: "flag-picker__x", "aria-hidden": "true", textContent: "×" }));
      chip.addEventListener("click", () => {
        names = names.filter((n) => n !== name);
        changed();
        field.focus();
      });
      return chip;
    }));
    const rest = known.filter((flag) => !names.some((n) => same(n, flag.name)));
    others.replaceChildren(...(rest.length ? [el("span", { class: "meta", textContent: "Used before:" }), ...rest.map((flag) => {
      const add = el("button", { class: `link-button tag ${hueOf(flag.id)}`, type: "button", textContent: flag.name });
      add.addEventListener("click", () => {
        if (put(flag.name)) changed();
      });
      return add;
    })] : []));
  }
  const changed = () => {
    draw();
    onChange();
  };
  const take = () => {
    const typed = field.value;
    field.value = "";
    if (put(typed)) changed();
  };
  field.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      take();
    } else if (e.key === "Backspace" && !field.value && names.length) {
      names.pop();
      changed();
    }
  });
  field.addEventListener("blur", take);
  for (const name of start) put(name);
  draw();
  return {
    element: el("div", { class: "flag-picker" }, el("div", { class: "flag-picker__row" }, on, field), others),
    value: () => [...names],
    take,
  };
}

// A new blog (postSlug null), or a change to the one whose slug is postSlug.
export async function showEditor(postSlug = null) {
  const { createEditor } = await import("./editor/editor.js");
  const [{ flags: known }, found] = await Promise.all([
    api("/api/blog/flags"),
    postSlug ? api(`/api/blog/post?slug=${encodeURIComponent(postSlug)}`) : null,
  ]);
  let post = found;   // a new one's null until it's first saved
  const keyOf = () => `techtrash:draft:${post ? `post-${post.id}` : "new"}`;
  let key = keyOf();
  const kept = remembered.get(key);
  const isUp = () => Boolean(post && !post.draft);
  // Back (and Cancel): to a blog that's up, to the drafts for a draft, and
  // to the Blog for one that's never been saved
  const leave = () => (isUp() ? to.post(post.slug) : post ? to.drafts : theBlog());
  titled(post ? `Editing ${post.title} - Techtrash` : "New blog - Techtrash");

  let dirty = Boolean(kept);
  let leaving = false;
  let keeping;
  const keep = () => {
    dirty = true;
    clearTimeout(keeping);
    keeping = setTimeout(() => {
      if (leaving) return;
      remembered.set(key, { title: title.value, body: editor.html(), flags: flags.value(), comments: comments.checked, saved: Date.now() });
    }, 500);
  };

  const title = el("input", { class: "editor__title", maxlength: "120", placeholder: "Title", "aria-label": "Title", value: kept?.title ?? post?.title ?? "" });
  title.addEventListener("input", keep);
  const editor = createEditor(kept?.body ?? post?.body ?? "", {
    onChange: keep,
    onTitle: (name) => {
      if (title.value.trim()) return;
      title.value = name;
      keep();
    },
    onProblem: (text) => say(text),
  });
  const flags = flagPicker(kept?.flags ?? post?.flags.map((flag) => flag.name) ?? [], known, keep);
  const comments = el("input", { type: "checkbox", checked: kept ? kept.comments : post ? Boolean(post.comments_open) : true });
  comments.addEventListener("change", keep);

  const back = backTo(leave());
  const message = status();
  const buttons = el("div", { class: "button-row" });
  let saving = false;
  const say = (text, field) => {
    message.textContent = text;
    field?.focus();
  };

  // draft: true or false to make it one or not, or left out to leave it as
  // it is. stay: stay in the editor, rather than go to the blog's page.
  async function save({ draft, stay }) {
    if (saving) return;
    flags.take();
    if (!title.value.trim()) return say(draft ? "It needs a title, even as a draft." : "It needs a title.", title);
    if (!draft && editor.empty()) return say("Write something first.", editor);
    saving = true;
    for (const button of buttons.querySelectorAll("button")) button.disabled = true;
    say("Saving...");
    const json = { title: title.value, body: editor.html(), flags: flags.value(), comments: comments.checked };
    if (draft !== undefined) json.draft = draft;
    try {
      clearTimeout(keeping);
      const saved = post
        ? await api(`/api/blog/post?id=${post.id}`, { method: "PUT", json })
        : await api("/api/blog/posts", { method: "POST", json });
      remembered.forget(key);
      dirty = false;
      if (!stay) {
        leaving = true;
        return location.assign(to.post(saved.slug));
      }
      post = { ...post, id: saved.id, slug: saved.slug, draft: saved.draft, comments_open: json.comments ? 1 : 0 };
      key = keyOf();
      moveTo(to.edit(saved.slug));
      titled(`Editing ${title.value.trim()} - Techtrash`);
      back.querySelector("a").href = leave();
      keptNote?.remove();
      drawButtons();
      say(`Saved${saved.draft ? " as a draft" : ""}, ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`);
    } catch (error) {
      say(error.message);
    }
    saving = false;
    for (const button of buttons.querySelectorAll("button")) button.disabled = false;
  }

  // Cancel leaves what isn't saved behind: a second click, if there's any.
  const cancel = el("button", { class: "button hue-1", type: "button", textContent: "Cancel" });
  let sure = false;
  cancel.addEventListener("click", () => {
    if (dirty && !sure) {
      sure = true;
      cancel.textContent = "Click again to throw the changes away";
      return;
    }
    leaving = true;
    clearTimeout(keeping);
    remembered.forget(key);
    location.assign(leave());
  });

  const button = (text, look, click) => {
    const made = el("button", { class: `button ${look}`, type: "button", textContent: text });
    made.addEventListener("click", click);
    return made;
  };
  // (a new blog has no Delete draft: nothing, not "null", in its place)
  function drawButtons() {
    buttons.replaceChildren(...(isUp()
      ? [
        button("Save changes", "hue-4", () => save({ stay: false })),
        // back to being a draft, the changes and all, and the editor stays open
        twoClick("Move to drafts", "Click again to take it down", () => save({ draft: true, stay: true }), "button hue-2"),
        cancel,
      ]
      : [
        button("Publish", "hue-4", () => save({ draft: false, stay: false })),
        button("Save draft", "hue-5", () => save({ draft: true, stay: true })),
        cancel,
        post ? twoClick("Delete draft", "Click again to delete it", async () => {
          await api(`/api/blog/post?id=${post.id}`, { method: "DELETE" });
          leaving = true;
          clearTimeout(keeping);
          remembered.forget(key);
          location.assign(to.drafts);
        }) : null,
      ]).filter(Boolean));
  }
  drawButtons();
  addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save(isUp() ? { stay: true } : { draft: true, stay: true });
    }
  });

  let keptNote = null;
  if (kept) {
    const throwAway = el("button", { class: "link-button", type: "button", textContent: "Throw them away" });
    throwAway.addEventListener("click", () => {
      leaving = true;
      remembered.forget(key);
      location.reload();
    });
    keptNote = el("p", { class: "meta" }, `Picked up where you left off: changes from ${new Date(kept.saved).toLocaleString()} that weren't saved. `, throwAway);
  }

  await framed("blog", async () => el("section", { class: `panel ${post ? hueOf(post.id) : "hue-4"}` },
    back,
    keptNote,
    title,
    editor.element,
    el("div", { class: "form settings" },
      el("div", { class: "form__field", role: "group", "aria-label": "Flags" }, el("span", { textContent: "Flags" }), flags.element),
      el("label", { class: "check" }, comments, "Comments on")),
    buttons,
    message));
  if (!post && !kept) title.focus();
}
