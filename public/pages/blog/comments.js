// A post's comments. Anyone can comment or reply, so comments form threads.
// Replies nest MAX_DEPTH deep. Past that they line up under the last one,
// each saying who it answers.
//
// Switching comments off keeps what's there and stops new ones. The admin
// can delete any comment. Its words go, but the replies under it stay put.
//
// A comment is plain text and is drawn as text (links made clickable), never
// as HTML.

import { api, date, el, label, remembered, status, textWithLinks, twoClick } from "./util.js";

const MAX_DEPTH = 4;
const NAME = "techtrash:name";

// The comments as threads, the top-level ones each with its replies.
function threads(comments) {
  const byId = new Map(comments.map((comment) => [comment.id, { ...comment, replies: [] }]));
  const top = [];
  for (const comment of byId.values()) (byId.get(comment.parent_id)?.replies ?? top).push(comment);
  return top;
}

// A deleted comment only shows (as a gap) if a reply under it still has words.
const shows = (comment) => !comment.deleted || comment.replies.some(shows);

// The comments panel for a post ({ id, comments, comments_open }).
export function commentsPanel(post, { admin, hue }) {
  const panel = el("section", { class: `panel ${hue}`, id: "comments" });
  const live = post.comments.filter((comment) => !comment.deleted).length;
  const open = Boolean(post.comments_open);
  let replying = null;   // the open reply form, if any

  // Redraws the panel from the server after a change.
  async function redraw(showId) {
    const fresh = await api(`/api/blog/post?id=${post.id}`);
    const next = commentsPanel(fresh, { admin, hue });
    panel.replaceWith(next);
    const shown = showId && document.getElementById(`comment-${showId}`);
    if (shown) {
      shown.classList.add("is-new");
      shown.scrollIntoView({ block: "center" });
    }
  }

  function form(parent) {
    const name = el("input", { name: "name", maxlength: "40", required: true, autocomplete: "nickname", value: remembered.get(NAME) ?? "" });
    const body = el("textarea", { name: "body", rows: "4", maxlength: "2000", required: true });
    // A field people never see. Only a bot fills it in, and the server turns it away.
    const trap = el("input", { name: "website", tabindex: "-1", autocomplete: "off" });
    const message = status();
    const send = el("button", { class: "button", textContent: parent ? "Reply" : "Post comment" });
    const cancel = parent && el("button", { class: "button hue-1", type: "button", textContent: "Cancel" });
    const box = el("form", { class: "form comment-form" }, el("fieldset", {},
      el("legend", { textContent: parent ? `Reply to ${parent.name}` : "Say something" }),
      el("label", {}, "Name", name),
      el("label", {}, parent ? "Reply" : "Comment", body),
      el("label", { class: "trap", "aria-hidden": "true" }, "Leave this empty", trap),
      el("div", { class: "button-row" }, send, cancel),
      message));
    cancel?.addEventListener("click", () => {
      box.remove();
      replying = null;
    });
    box.addEventListener("submit", async (e) => {
      e.preventDefault();
      send.disabled = true;
      message.textContent = "Posting...";
      try {
        const comment = await api("/api/blog/comments", {
          method: "POST",
          json: { post: post.id, parent: parent?.id ?? null, name: name.value, body: body.value, website: trap.value },
        });
        remembered.set(NAME, name.value.trim());
        await redraw(comment.id);
      } catch (error) {
        message.textContent = error.message;
        send.disabled = false;
      }
    });
    return box;
  }

  function item(comment, answering) {
    const li = el("li", { class: "comment", id: `comment-${comment.id}` });
    if (comment.deleted) {
      li.append(el("p", { class: "meta", textContent: "This comment was deleted." }));
      return li;
    }
    const actions = el("div", { class: "comment__actions" });
    if (open) {
      const reply = el("button", { class: "link-button", type: "button", textContent: "Reply" });
      reply.addEventListener("click", () => {
        const already = replying?.isConnected && replying.parentNode === li;
        replying?.remove();
        replying = null;
        if (already) return;
        replying = form(comment);
        actions.after(replying);
        replying.elements.body.focus();
      });
      actions.append(reply);
    }
    if (admin) {
      actions.append(twoClick("Delete", "Click again to delete", async () => {
        await api(`/api/blog/comment?id=${comment.id}`, { method: "DELETE" });
        await redraw();
      }, "link-button hue-1"));
    }
    li.append(
      el("p", { class: "comment__head" },
        el("span", { class: "comment__name", textContent: comment.name }),
        comment.is_admin ? el("span", { class: "comment__badge", textContent: "author" }) : null,
        answering ? el("span", { class: "meta", textContent: `to ${answering.deleted ? "a deleted comment" : answering.name}` }) : null,
        el("a", { class: "comment__date", href: `#comment-${comment.id}`, textContent: date(comment.created) })),
      el("p", { class: "comment__body" }, textWithLinks(comment.body)),
      actions.childElementCount ? actions : null,
    );
    return li;
  }

  // One level of a thread. At MAX_DEPTH the replies line up under the last
  // one instead of nesting deeper.
  function thread(comments, depth) {
    const list = el("ul", { class: "thread" });
    const add = (comment, answering) => {
      if (!shows(comment)) return;
      const li = item(comment, answering);
      list.append(li);
      if (depth < MAX_DEPTH) {
        if (comment.replies.some(shows)) li.append(thread(comment.replies, depth + 1));
      } else {
        for (const reply of comment.replies) add(reply, comment);
      }
    };
    for (const comment of comments) add(comment, null);
    return list;
  }

  panel.append(label("Comments"));
  const top = threads(post.comments).filter(shows);
  if (top.length) panel.append(thread(top, 1));
  if (open) {
    if (live === 0) panel.append(el("p", { class: "meta", textContent: "No comments yet." }));
    panel.append(form(null));
  } else {
    panel.append(el("p", { class: "meta", textContent: live ? "Comments are closed." : "Comments are off for this blog." }));
  }
  return panel;
}
