// techtrash.org : logging on and off.
//
// A new tab starts at the Welcome screen, as XP did. A reload doesn't: the tab
// stays logged on until it logs off. The little script at the top of
// index.html decides which before anything paints, by putting .is-logged-off
// on <html>; this does everything after.
//
// Log Off in the start menu asks first, with the desktop gone gray behind the
// question, as XP's did:
//   Switch User  back to the Welcome screen, windows left open
//   Log Off      every window closed, "Saving your settings...", and back to
//                the Welcome screen
//
// Opening a window from the address (/#blog) still works while logged off:
// it's there when you log on.

const css = getComputedStyle(document.documentElement);
const WAIT = parseInt(css.getPropertyValue("--wait"), 10);
const KEY = "techtrash:logged-on";   // in sessionStorage: this tab has logged on

const PROMPT = "To begin, click your user name";

export function setUpSession({ closeAll }) {
  const root = document.documentElement;
  const logon = document.querySelector(".logon");
  const prompt = logon.querySelector(".logon__prompt");
  const user = logon.querySelector(".logon__user");
  const status = logon.querySelector(".logon__status");
  const dialog = document.querySelector(".logoff");
  // Everything behind the Welcome screen or the dialog: out of reach of the
  // keyboard and the pointer while either is up.
  const behind = [".desktop", ".taskbar", "#start-menu"].map((s) => document.querySelector(s));

  function remember(loggedOn) {
    try {
      if (loggedOn) sessionStorage.setItem(KEY, "1");
      else sessionStorage.removeItem(KEY);
    } catch {}
  }

  function reach(el, on) {
    el.inert = !on;
  }

  function showWelcome() {
    root.classList.add("is-logged-off");
    behind.forEach((el) => reach(el, false));
    reach(logon, true);
    user.focus();
  }

  function showDesktop() {
    root.classList.remove("is-logged-off");
    logon.classList.remove("is-busy", "is-logging-on");
    status.textContent = "";
    behind.forEach((el) => reach(el, true));
    reach(logon, false);
  }

  // --- logging on ------------------------------------------------------------

  user.addEventListener("click", () => {
    if (logon.classList.contains("is-logging-on")) return;
    logon.classList.add("is-logging-on");
    status.textContent = "Loading your personal settings...";
    setTimeout(() => {
      remember(true);
      showDesktop();
    }, WAIT);
  });

  // --- logging off -----------------------------------------------------------

  function ask() {
    root.classList.add("is-asking");
    behind.forEach((el) => reach(el, false));
    dialog.hidden = false;
    dialog.querySelector("[data-log-off]").focus();
  }

  function stopAsking() {
    root.classList.remove("is-asking");
    dialog.hidden = true;
  }

  dialog.querySelector("[data-cancel]").addEventListener("click", () => {
    stopAsking();
    behind.forEach((el) => reach(el, true));
  });

  dialog.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    stopAsking();
    behind.forEach((el) => reach(el, true));
  });

  dialog.querySelector("[data-switch-user]").addEventListener("click", () => {
    stopAsking();
    remember(false);
    prompt.textContent = PROMPT;
    showWelcome();
  });

  dialog.querySelector("[data-log-off]").addEventListener("click", () => {
    stopAsking();
    remember(false);
    closeAll();
    logon.classList.add("is-busy");
    prompt.textContent = "Saving your settings...";
    showWelcome();
    setTimeout(() => {
      logon.classList.remove("is-busy");
      prompt.textContent = PROMPT;
      user.focus();
    }, WAIT);
  });

  // --- the first paint ---------------------------------------------------------

  prompt.textContent = PROMPT;
  if (root.classList.contains("is-logged-off")) showWelcome();
  else reach(logon, false);

  return { askToLogOff: ask };
}
