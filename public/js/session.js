// Logging on and off. Visitors start logged on as "techtrash" so nothing blocks
// the blog. The Welcome screen shows only after Log Off or Switch User, and stays
// through a reload. Admin logon is checked by server/admin.js, and its cookie
// lasts until Log Off or Switch User. Only Log Off closes the windows.

const css = getComputedStyle(document.documentElement);
const WAIT = parseInt(css.getPropertyValue("--wait"), 10);
// sessionStorage flag while this tab is logged off. index.html's inline script
// reads it too, to set .is-logged-off before first paint.
const KEY = "techtrash:logged-off";

const PROMPT = "To begin, click your user name";

// onUser(user, { changed }) runs on every logon, and when the server confirms an
// earlier admin session. changed means a new user since load, so windows catch up.
export function setUpSession({ closeAll, onUser }) {
  const root = document.documentElement;
  const logon = document.querySelector(".logon");
  const prompt = logon.querySelector(".logon__prompt");
  const tiles = [...logon.querySelectorAll(".logon__user")];
  const tile = (user) => tiles.find((one) => one.dataset.user === user);
  const form = logon.querySelector(".logon__form");
  const dialog = document.querySelector(".logoff");
  const startHead = document.querySelector(".start-menu__head");
  // Inert while the Welcome screen or the Log Off dialog is up.
  const behind = [".desktop", ".taskbar", "#start-menu"].map((s) => document.querySelector(s));
  let current = "techtrash";

  function remember(loggedOn) {
    try {
      if (loggedOn) sessionStorage.removeItem(KEY);
      else sessionStorage.setItem(KEY, "1");
    } catch {}
  }

  const reach = (el, on) => { el.inert = !on; };
  const status = (user, text) => { tile(user).querySelector(".logon__status").textContent = text; };

  // Start menu header copies the user's Welcome screen picture and name.
  function becomeUser(user, tell = true) {
    const changed = user !== current;
    current = user;
    startHead.querySelector(".start-menu__tile").src = tile(user).querySelector(".logon__picture").src;
    startHead.querySelector("span").textContent = tile(user).querySelector(".logon__name").textContent;
    onUser(user, { changed: changed && tell });
  }

  function showWelcome() {
    root.classList.add("is-logged-off");
    behind.forEach((el) => reach(el, false));
    reach(logon, true);
    closeForm();
    tile("techtrash").focus();
  }

  function showDesktop() {
    root.classList.remove("is-logged-off");
    logon.classList.remove("is-busy", "is-logging-on");
    for (const one of tiles) {
      one.classList.remove("is-picked");
      status(one.dataset.user, "");
    }
    behind.forEach((el) => reach(el, true));
    reach(logon, false);
  }

  // --- logging on ----------------------------------------------------------

  function logOnAs(user) {
    logon.classList.add("is-logging-on");
    tile(user).classList.add("is-picked");
    status(user, "Loading your personal settings...");
    setTimeout(() => {
      remember(true);
      becomeUser(user);
      showDesktop();
    }, WAIT);
  }

  function closeForm() {
    form.hidden = true;
    form.reset();
    tile("admin").setAttribute("aria-expanded", "false");
    status("admin", "");
  }

  tile("techtrash").addEventListener("click", () => {
    if (logon.classList.contains("is-logging-on")) return;
    closeForm();
    logOnAs("techtrash");
  });

  // XP's password box, under the user's name.
  tile("admin").addEventListener("click", () => {
    if (logon.classList.contains("is-logging-on")) return;
    form.hidden = false;
    tile("admin").setAttribute("aria-expanded", "true");
    form.elements.username.focus();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (logon.classList.contains("is-logging-on")) return;
    status("admin", "");
    const { username, password } = form.elements;
    let error = null;
    try {
      const response = await fetch("/api/logon", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: username.value, password: password.value }),
      });
      if (!response.ok) error = (await response.json().catch(() => ({}))).error ?? "That didn't work. Try again.";
    } catch {
      error = "Can't reach techtrash.org right now.";
    }
    if (error) {
      status("admin", error);
      password.value = "";
      password.focus();
      return;
    }
    form.hidden = true;
    form.reset();
    logOnAs("admin");
  });

  // --- logging off ---------------------------------------------------------

  // Ends the admin session on the server too.
  function leave() {
    if (current === "admin") fetch("/api/logoff", { method: "POST" }).catch(() => {});
  }

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
    leave();
    remember(false);
    prompt.textContent = PROMPT;
    showWelcome();
  });

  dialog.querySelector("[data-log-off]").addEventListener("click", () => {
    stopAsking();
    leave();
    remember(false);
    closeAll();
    logon.classList.add("is-busy");
    prompt.textContent = "Saving your settings...";
    showWelcome();
    setTimeout(() => {
      logon.classList.remove("is-busy");
      prompt.textContent = PROMPT;
      tile("techtrash").focus();
    }, WAIT);
  });

  // --- first paint ---------------------------------------------------------

  prompt.textContent = PROMPT;
  if (root.classList.contains("is-logged-off")) showWelcome();
  else reach(logon, false);

  // An earlier admin session (reload, other tab) still counts. Windows ask the
  // server themselves, so they aren't told.
  fetch("/api/me")
    .then((response) => (response.ok ? response.json() : {}))
    .then(({ admin }) => {
      if (admin && !root.classList.contains("is-logged-off")) becomeUser("admin", false);
    })
    .catch(() => {});

  return { askToLogOff: ask };
}
