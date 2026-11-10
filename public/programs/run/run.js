// Run, from the start menu. It takes a program by its XP name (notepad,
// mspaint, calc, cmd, explorer, control...), with a file or folder after it
// if it opens one ("notepad todo.txt"). It also takes a web address, which
// opens in a new tab, or a path on the shared disk (js/paths.js), like
// My Documents or C:\Documents and Settings\techtrash\Desktop\x.txt.
//
// Like XP, it remembers what's been run (in this browser) for the list under
// the box.

import { programNamed } from "/js/apps.js";
import { openDialog } from "/js/file-dialog.js";
import { opener } from "/js/items.js";
import { showMessage } from "/js/message.js";
import { HOME, pathOf, resolve } from "/js/paths.js";

const desktop = window.top === window ? null : window.top.desktop;
const field = document.getElementById("open");
const KEY = "techtrash:run";   // what's been run, newest first (localStorage)


function remembered() {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

function remember(text) {
  try {
    localStorage.setItem(KEY, JSON.stringify([text, ...remembered().filter((one) => one !== text)].slice(0, 26)));
  } catch {}
}

// Opens what's typed. Returns false if there's nothing by that name.
function run(text) {
  if (/^https?:\/\//i.test(text)) {
    window.top.open(text, "_blank", "noopener");
    return true;
  }
  const [first, ...more] = text.match(/"[^"]*"|\S+/g) ?? [];
  const app = first && programNamed(first.replace(/"/g, ""));
  if (app) {
    const arg = more.join(" ");
    const place = arg && resolve(arg, `${HOME}\\Desktop`);
    if (arg && !place?.item) return false;
    if (place?.item && (app === "files" || app === "notepad" || app === "paint")) {
      const { rest } = app === "files" ? opener(place.item) : { rest: `?id=${place.item.id}` };
      desktop.open(app, app === "files" && place.kind !== "folder" ? "" : rest);
    } else {
      desktop.open(app);
    }
    return true;
  }
  const place = resolve(text, `${HOME}\\Desktop`);
  if (!place) return false;
  if (place.item) desktop.openItem(place.item);
  else desktop.open("files", "?folder=desktop");
  return true;
}

async function ok() {
  const text = field.value.trim();
  if (!text) return;
  if (run(text)) {
    remember(text);
    desktop.close(window);
    return;
  }
  await showMessage({ title: text, text: `Windows cannot find '${text}'. Make sure you typed the name correctly, and then try again.` });
  field.select();
}

document.querySelector(".run__open").addEventListener("submit", (e) => {
  e.preventDefault();
  ok();
});
document.querySelector("[data-ok]").addEventListener("click", ok);
document.querySelector("[data-cancel]").addEventListener("click", () => desktop.close(window));
document.querySelector("[data-browse]").addEventListener("click", async () => {
  const item = await openDialog({ kind: "any", folder: "documents" });
  if (item) field.value = `"${pathOf(item.id)}"`;
  field.focus();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !document.querySelector(".layer")) desktop.close(window);
});

if (desktop) {
  const list = document.getElementById("ran");
  for (const text of remembered()) {
    const option = document.createElement("option");
    option.value = text;
    list.append(option);
  }
  field.value = remembered()[0] ?? "";
  field.select();
  field.focus();
}
