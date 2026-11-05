// techtrash.org : XP's message box.
//
// A small window over the whole desktop with an icon, a sentence and OK, the
// way XP said something went wrong ("Error Deleting File or Folder"). Until
// it's answered, everything behind it is out of reach. OK, Enter, Space, Esc
// and its close button all answer it. Its look is .message in css/xp.css; its
// markup is the <template id="message-template"> in index.html.
//
// showMessage({ title, text, icon }) puts one up, and gives back a promise
// that settles once it's answered. icon is one of ICONS.

const ICONS = { error: "/img/icons/xp/error.png" };

export function showMessage({ title, text, icon = "error" }) {
  const layer = document.getElementById("message-template").content.firstElementChild.cloneNode(true);
  layer.querySelector(".title-bar__text").textContent = title;
  layer.querySelector(".message__text").textContent = text;
  layer.querySelector(".message__icon").src = ICONS[icon];

  // Everything behind it, out of reach while it's up (as it was, after).
  const behind = [".desktop", ".taskbar", "#start-menu"].map((selector) => document.querySelector(selector));
  const wasInert = behind.map((el) => el.inert);
  const hadFocus = document.activeElement;
  behind.forEach((el) => { el.inert = true; });
  document.body.append(layer);
  const ok = layer.querySelector("[data-ok]");
  ok.focus();

  return new Promise((resolve) => {
    const answer = () => {
      layer.remove();
      behind.forEach((el, i) => { el.inert = wasInert[i]; });
      hadFocus?.focus?.();
      resolve();
    };
    ok.addEventListener("click", answer);
    layer.querySelector(".caption--close").addEventListener("click", answer);
    layer.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      answer();
    });
  });
}
