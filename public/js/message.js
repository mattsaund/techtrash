// XP's message box, for when something went wrong ("Error Deleting File or
// Folder") or to ask first ("Confirm File Delete", Yes and No). Until it's
// answered, the rest of its page is out of reach. On the desktop that's the
// whole desktop, and in a program's window just that program, like XP. Its
// look is .message in css/xp.css.
//
// showMessage({ title, text, icon, buttons, doc }) gives back a promise of
// the button that answered it ("Yes"), or null if it was closed (its close
// button, or Esc).
//   icon     one of ICONS, "error" if not given
//   buttons  their labels, ["OK"] if not given. The first is the default,
//            the one Enter presses. A button's first letter presses it too,
//            like XP's (Y, N).
//   doc      the page to put it on, if not this one. Paint puts its own on
//            the desktop's, since its look would clash with XP's.

const XP = "/img/icons/xp";
const ICONS = {
  error: `${XP}/error.png`,
  warning: `${XP}/alert.png`,
  question: `${XP}/question.png`,
  information: `${XP}/information.png`,
  delete: `${XP}/delete-file.png`,
};

let count = 0;

export function showMessage({ title, text, icon = "error", buttons = ["OK"], doc = document }) {
  const id = `message-${++count}`;
  const layer = doc.createElement("div");
  layer.className = "layer";
  layer.innerHTML = `
    <section class="window message" role="alertdialog" aria-modal="true" aria-labelledby="${id}-title" aria-describedby="${id}-text">
      <header class="title-bar">
        <h2 class="title-bar__text" id="${id}-title"></h2>
        <div class="title-bar__controls">
          <button class="caption caption--close" type="button" aria-label="Close"></button>
        </div>
      </header>
      <div class="message__body">
        <img class="message__icon" alt="">
        <p class="message__text" id="${id}-text"></p>
      </div>
      <div class="message__foot"></div>
    </section>`;
  layer.querySelector(".title-bar__text").textContent = title;
  layer.querySelector(".message__text").textContent = text;
  layer.querySelector(".message__icon").src = ICONS[icon] ?? ICONS.error;
  const foot = layer.querySelector(".message__foot");
  const pressed = buttons.map((label, i) => {
    const button = doc.createElement("button");
    button.className = `button${i === 0 ? " button--default" : ""}`;
    button.type = "button";
    button.textContent = label;
    foot.append(button);
    return button;
  });

  // Everything else on the page goes inert while it's up, then back to how it was.
  const behind = [...doc.body.children];
  const wasInert = behind.map((el) => el.inert);
  const hadFocus = doc.activeElement;
  behind.forEach((el) => { el.inert = true; });
  doc.body.append(layer);
  pressed[0].focus();

  return new Promise((resolve) => {
    const answer = (value) => {
      layer.remove();
      behind.forEach((el, i) => { el.inert = wasInert[i]; });
      if (hadFocus?.isConnected) hadFocus.focus?.();
      resolve(value);
    };
    pressed.forEach((button) => button.addEventListener("click", () => answer(button.textContent)));
    layer.querySelector(".caption--close").addEventListener("click", () => answer(null));
    layer.addEventListener("keydown", (e) => {
      const at = pressed.indexOf(doc.activeElement);
      if (e.key === "Escape") {
        answer(null);
      } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && at !== -1) {
        pressed[(at + (e.key === "ArrowRight" ? 1 : -1) + pressed.length) % pressed.length].focus();
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const button = pressed.find((one) => one.textContent[0].toLowerCase() === e.key.toLowerCase());
        if (!button) return;
        button.click();
      } else {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    });
  });
}
