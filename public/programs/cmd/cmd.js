// The Command Prompt. Its C: drive is the shared disk (js/paths.js), so
// whatever's done here is done for everyone. MD makes a folder anyone can
// see, DEL throws a file in the Recycle Bin, and so on.
//
// HELP lists the commands. As on XP, Up and Down go back through what's been
// typed, Tab finishes a name and Ctrl+C drops the line.

import { programNamed } from "/js/apps.js";
import { LIMITS, isSound, isText } from "/js/items.js";
import { HOME, contents, fileName, folderOf, pathOf, resolve } from "/js/paths.js";

const desktop = window.top === window ? null : window.top.desktop;
const disk = desktop?.disk;

const screen = document.querySelector(".console");
const out = document.querySelector(".console__out");
const promptText = document.querySelector(".console__prompt");
const input = document.querySelector(".console__in");

const KEEP_LINES = 2000;

let cwd = HOME;
const typed = [];      // what's been run, oldest first
let back = 0;          // how far back Up has gone
let busy = false;

// --- the screen ------------------------------------------------------------

function print(text = "") {
  out.textContent += `${text}\n`;
  const lines = out.textContent.split("\n");
  if (lines.length > KEEP_LINES) out.textContent = lines.slice(-KEEP_LINES).join("\n");
}

function showPrompt() {
  promptText.textContent = `${cwd}>`;
  input.value = "";
  screen.scrollTop = screen.scrollHeight;
}

// --- words -----------------------------------------------------------------

// Splits a line into words, keeping "quoted words" together.
const words = (text) => (text.match(/"[^"]*"|\S+/g) ?? []).map((word) => word.replace(/^"(.*)"$/, "$1"));
const pad = (text, width) => String(text).padStart(width);
const number = (n) => n.toLocaleString("en-US");
const NOT_FOUND = "The system cannot find the path specified.";
const NO_FILE = "The system cannot find the file specified.";
const DENIED = "Access is denied.";

// DIR's date format, "11/09/2026  11:30 PM".
function stamp(ms) {
  if (!ms) return "                    ";
  const d = new Date(ms);
  const two = (n) => String(n).padStart(2, "0");
  const hours = d.getHours() % 12 || 12;
  return `${two(d.getMonth() + 1)}/${two(d.getDate())}/${d.getFullYear()}  ${two(hours)}:${two(d.getMinutes())} ${d.getHours() < 12 ? "AM" : "PM"}`;
}

// Turns a name with * and ? wildcards into a regex.
function pattern(text) {
  const source = text.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${source}$`, "i");
}

// The items a name matches (wildcards and all), and the folder they're in.
function matching(text) {
  const parts = text.split("\\");
  const name = parts.pop();
  const folder = resolve(parts.join("\\") || ".", cwd);
  if (!folder || (folder.kind !== "folder" && folder.kind !== "virtual" && folder.kind !== "drive")) return { folder: null, found: [] };
  const test = pattern(name);
  return { folder, found: contents(folder).filter((entry) => entry.item && (test.test(entry.name) || test.test(entry.item.name))).map((entry) => entry.item) };
}

// Free space on the whole disk, music's share included.
const bytesFree = () => LIMITS.bytes + LIMITS.music - disk.all().reduce((sum, item) => sum + (item.kind === "file" ? item.size : 0), 0);

// --- the commands ----------------------------------------------------------

const HELP = [
  ["CD", "Displays the name of or changes the current directory."],
  ["CLS", "Clears the screen."],
  ["COLOR", "Sets the default console foreground and background colors."],
  ["COPY", "Copies one or more files to another location."],
  ["DATE", "Displays the date."],
  ["DEL", "Deletes one or more files (into the Recycle Bin)."],
  ["DIR", "Displays a list of files and subdirectories in a directory."],
  ["ECHO", "Displays messages."],
  ["EXIT", "Quits the CMD.EXE program (command interpreter)."],
  ["HELP", "Provides Help information for Windows commands."],
  ["MD", "Creates a directory."],
  ["MOVE", "Moves one or more files from one directory to another directory."],
  ["PING", "Checks how long techtrash.org takes to answer."],
  ["RD", "Removes a directory (into the Recycle Bin)."],
  ["REN", "Renames a file or files."],
  ["START", "Starts a program, or opens a file or a folder."],
  ["TIME", "Displays the system time."],
  ["TITLE", "Sets the window title for a CMD.EXE session."],
  ["TREE", "Graphically displays the directory structure of a drive or path."],
  ["TYPE", "Displays the contents of a text file."],
  ["VER", "Displays the Windows version."],
];

const COMMANDS = {
  help() {
    print("For more information on a specific command, type HELP command-name");
    for (const [name, words] of HELP) print(`${name.padEnd(9)}${words}`);
  },
  cls() {
    out.textContent = "";
  },
  ver() {
    print();
    print("Microsoft Windows XP [Version 5.1.2600]");
  },
  echo(rest) {
    print(rest.trim() ? rest.replace(/^\s/, "") : "ECHO is on.");
  },
  title(rest) {
    document.title = rest.trim() || "Command Prompt";
  },
  color(rest) {
    const code = rest.trim().toLowerCase();
    if (!code) {
      screen.style.removeProperty("--console-paper");
      screen.style.removeProperty("--console-ink");
      return;
    }
    if (!/^[0-9a-f]{1,2}$/.test(code)) {
      print("Sets the default console foreground and background colors.");
      print();
      print("COLOR [attr]");
      print();
      return print("  attr        Two hex digits, the first the background and the second the text: COLOR 0A is green on black.");
    }
    const [paper, ink] = code.length === 2 ? code : ["0", code];
    if (paper === ink) return;
    screen.style.setProperty("--console-paper", `var(--console-${paper})`);
    screen.style.setProperty("--console-ink", `var(--console-${ink})`);
  },
  date(rest) {
    const d = new Date();
    print(`${/\/t/i.test(rest) ? "" : "The current date is: "}${d.toLocaleDateString("en-US", { weekday: "short" })} ${d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })}`);
    if (!/\/t/i.test(rest)) print("A required privilege is not held by the client.");
  },
  time(rest) {
    const d = new Date();
    const text = d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    print(/\/t/i.test(rest) ? text.slice(0, 5) : `The current time is: ${text}.${String(Math.floor(d.getMilliseconds() / 10)).padStart(2, "0")}`);
    if (!/\/t/i.test(rest)) print("A required privilege is not held by the client.");
  },
  cd(rest) {
    const path = rest.trim().replace(/^\/d\s+/i, "").replace(/^"(.*)"$/, "$1");
    if (!path) return print(cwd);
    if (/^[a-z]:$/i.test(path)) return path.toLowerCase() === "c:" ? print(cwd) : print("The system cannot find the drive specified.");
    const place = resolve(path, cwd);
    if (!place || place.kind === "file" || place.kind === "app") return print(place ? "The directory name is invalid." : NOT_FOUND);
    cwd = place.path.replace(/\\$/, "") || "C:";
    if (cwd === "C:") cwd = "C:\\";
  },
  dir(rest) {
    const path = words(rest).filter((word) => !word.startsWith("/")).join(" ");
    const place = resolve(path, cwd);
    if (!place) return print("File Not Found");
    if (place.kind === "file" || place.kind === "app") {
      print(" Volume in drive C has no label.");
      print(" Volume Serial Number is 1337-C0DE");
      print();
      print(` Directory of ${pathOf(place.item.parent)}`);
      print();
      const size = place.kind === "app" ? 1024 : place.item.size;
      print(`${stamp(place.item.modified)}    ${pad(number(size), 14)} ${fileName(place.item)}`);
      print(`               1 File(s) ${pad(number(size), 14)} bytes`);
      return print(`               0 Dir(s) ${pad(number(bytesFree()), 14)} bytes free`);
    }
    const entries = contents(place);
    const here = place.kind === "folder" ? place.item.modified : 0;
    print(" Volume in drive C has no label.");
    print(" Volume Serial Number is 1337-C0DE");
    print();
    print(` Directory of ${place.path}`);
    print();
    const lines = place.path === "C:\\" ? [] : [[here, true, "."], [here, true, ".."]];
    for (const entry of entries) lines.push([entry.modified, entry.folder, entry.name, entry.size]);
    let files = 0;
    let bytes = 0;
    for (const [when, folder, name, size = 0] of lines) {
      if (folder) print(`${stamp(when)}    <DIR>          ${name}`);
      else {
        files++;
        bytes += size;
        print(`${stamp(when)}    ${pad(number(size), 14)} ${name}`);
      }
    }
    print(`${pad(files, 16)} File(s) ${pad(number(bytes), 14)} bytes`);
    print(`${pad(lines.length - files, 16)} Dir(s) ${pad(number(bytesFree()), 14)} bytes free`);
  },
  async type(rest) {
    const path = words(rest)[0];
    if (!path) return print("The syntax of the command is incorrect.");
    const place = resolve(path, cwd);
    if (!place || !place.item || place.kind === "folder") return print(place ? DENIED : NO_FILE);
    if (!isText(place.item)) return print(`${fileName(place.item)} isn't text: START it to see it.`);
    const text = await disk.text(place.item);
    print(text.replace(/\r?\n$/, ""));
  },
  async md(rest) {
    const name = words(rest).join(" ");
    if (!name) return print("The syntax of the command is incorrect.");
    const parts = name.split("\\");
    const leaf = parts.pop();
    const parent = resolve(parts.join("\\") || ".", cwd);
    if (!folderOf(parent)) return print(parent ? DENIED : NOT_FOUND);
    if (contents(parent).some((entry) => entry.name.toLowerCase() === leaf.toLowerCase())) return print(`A subdirectory or file ${name} already exists.`);
    await disk.makeFolder(folderOf(parent), leaf);
  },
  async rd(rest) {
    const list = words(rest);
    const all = list.some((word) => /^\/s$/i.test(word));
    const name = list.filter((word) => !word.startsWith("/")).join(" ");
    const place = resolve(name, cwd);
    if (!place) return print(NO_FILE);
    if (place.kind !== "folder") return print(place.kind === "file" || place.kind === "app" ? "The directory name is invalid." : DENIED);
    if (!all && disk.children(place.item.id).length) return print("The directory is not empty.");
    if (`${cwd}\\`.toLowerCase().startsWith(`${place.path}\\`.toLowerCase())) return print("The process cannot access the file because it is being used by another process.");
    await disk.remove(place.item.id);
  },
  async del(rest) {
    const name = words(rest).filter((word) => !word.startsWith("/")).join(" ");
    if (!name) return print("The syntax of the command is incorrect.");
    const { folder, found } = matching(name);
    if (!folder) return print(NOT_FOUND);
    const files = found.filter((item) => item.kind !== "folder");
    if (!files.length) return print(`Could Not Find ${folder.path}\\${name.split("\\").pop()}`);
    for (const item of files) await disk.remove(item.id);
  },
  async ren(rest) {
    const [from, to] = words(rest);
    if (!from || !to) return print("The syntax of the command is incorrect.");
    const place = resolve(from, cwd);
    if (!place?.item) return print(NO_FILE);
    await disk.rename(place.item.id, to);
  },
  async move(rest) {
    const list = words(rest).filter((word) => !word.startsWith("/"));
    if (list.length < 2) return print("The syntax of the command is incorrect.");
    const to = resolve(list.pop(), cwd);
    if (!folderOf(to)) return print(to ? DENIED : NOT_FOUND);
    const { found } = matching(list.join(" "));
    if (!found.length) return print(NO_FILE);
    for (const item of found) await disk.move(item.id, folderOf(to));
    print(`        ${found.length} file(s) moved.`);
  },
  async copy(rest) {
    const list = words(rest).filter((word) => !word.startsWith("/"));
    if (list.length < 2) return print("The syntax of the command is incorrect.");
    const target = list.pop();
    const { found } = matching(list.join(" "));
    const files = found.filter((item) => item.kind === "file");
    if (!files.length) return print(NO_FILE);
    const to = resolve(target, cwd);
    // into a folder under the same names, or one file to a new name
    const intoFolder = folderOf(to);
    const parts = target.split("\\");
    const newName = intoFolder ? null : parts.pop();
    const folder = intoFolder ?? folderOf(resolve(parts.join("\\") || ".", cwd));
    if (!folder || (!intoFolder && files.length > 1)) return print(NOT_FOUND);
    for (const item of files) {
      const kind = isText(item) ? "text" : isSound(item) ? "sound" : "picture";
      const data = kind === "text" ? await disk.text(item) : await disk.blob(item);
      await disk.makeFile(folder, newName ?? item.name, data, kind);
    }
    print(`        ${files.length} file(s) copied.`);
  },
  tree(rest) {
    const place = resolve(words(rest).filter((word) => !word.startsWith("/")).join(" "), cwd);
    if (!place || place.kind === "file" || place.kind === "app") return print("Invalid path - " + rest.trim());
    print("Folder PATH listing");
    print("Volume serial number is 1337-C0DE");
    print(place.path.toUpperCase());
    const walk = (entries, lead) => {
      const folders = entries.filter((entry) => entry.folder);
      folders.forEach((entry, i) => {
        const lastOne = i === folders.length - 1;
        print(`${lead}${lastOne ? "\u2514\u2500\u2500\u2500" : "\u251c\u2500\u2500\u2500"}${entry.name}`);
        const inside = entry.item ? contents({ kind: "folder", item: entry.item }) : contents(resolve(entry.name, place.path) ?? { kind: "virtual", path: "" });
        walk(inside, `${lead}${lastOne ? "    " : "\u2502   "}`);
      });
    };
    const top = contents(place);
    if (!top.some((entry) => entry.folder)) print("No subfolders exist");
    walk(top, "");
  },
  start(rest) {
    const list = words(rest);
    if (!list.length) return desktop.open("cmd");
    const app = programNamed(list[0]);
    if (app) return COMMANDS.run(app, list.slice(1).join(" "));
    const place = resolve(list.join(" "), cwd);
    if (!place) return print(`The system cannot find the file ${list.join(" ")}.`);
    if (place.item) desktop.openItem(place.item);
    else desktop.open("files", "?folder=desktop");
  },
  // a program, maybe on a file, as in "notepad todo.txt"
  run(app, arg) {
    const place = arg && resolve(arg, cwd);
    if (arg && !place?.item) return print(NO_FILE);
    if (place?.item && (app === "notepad" || app === "paint")) desktop.open(app, `?id=${place.item.id}`);
    else if (place?.item && app === "files") desktop.openItem(place.item);
    else desktop.open(app);
  },
  hostname() {
    print("techtrash");
  },
  async ping(rest) {
    const host = words(rest).find((word) => !word.startsWith("-") && !word.startsWith("/")) ?? "";
    if (!/^(techtrash\.org|localhost|127\.0\.0\.1)$/i.test(host)) {
      return print(host ? `Ping request could not find host ${host}. Please check the name and try again.` : "Usage: ping techtrash.org");
    }
    print();
    print(`Pinging ${host} with 32 bytes of data:`);
    print();
    const times = [];
    for (let i = 0; i < 4; i++) {
      const sent = performance.now();
      try {
        await fetch("/api/time", { cache: "no-store" });
        const ms = Math.round(performance.now() - sent);
        times.push(ms);
        print(`Reply from ${host}: bytes=32 time${ms < 1 ? "<1" : "="}${Math.max(ms, 1)}ms TTL=128`);
      } catch {
        print("Request timed out.");
      }
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    print();
    print(`Ping statistics for ${host}:`);
    print(`    Packets: Sent = 4, Received = ${times.length}, Lost = ${4 - times.length} (${(4 - times.length) * 25}% loss),`);
    if (times.length) {
      print("Approximate round trip times in milli-seconds:");
      print(`    Minimum = ${Math.min(...times)}ms, Maximum = ${Math.max(...times)}ms, Average = ${Math.round(times.reduce((a, b) => a + b, 0) / times.length)}ms`);
    }
  },
  shutdown() {
    print("techtrash.org can't be shut down: it's everyone's.");
  },
  exit() {
    desktop.close(window);
  },
};
// XP's other names for the same commands
Object.assign(COMMANDS, { chdir: COMMANDS.cd, mkdir: COMMANDS.md, rmdir: COMMANDS.rd, erase: COMMANDS.del, rename: COMMANDS.ren });

async function run(line) {
  print(`${cwd}>${line}`);
  const text = line.trim();
  if (!text) return;
  if (/^[a-z]:$/i.test(text)) return text.toLowerCase() === "c:" ? undefined : print("The system cannot find the drive specified.");
  const match = text.match(/^([^\s\\/."]+(?:\.exe)?|cd\.\.|cd\\)(.*)$/i);
  let name = (match?.[1] ?? text).toLowerCase().replace(/\.exe$/, "");
  let rest = match?.[2] ?? "";
  if (name === "cd.." || name === "cd\\") {
    rest = name.slice(2);
    name = "cd";
  }
  const command = Object.hasOwn(COMMANDS, name) && name !== "run" ? COMMANDS[name] : null;
  try {
    if (command) await command(rest);
    else if (programNamed(name)) COMMANDS.run(programNamed(name), rest.trim());
    else {
      print(`'${text.split(/\s/)[0]}' is not recognized as an internal or external command,`);
      print("operable program or batch file.");
    }
  } catch (error) {
    // the disk's refusals, printed in its own words
    print(error.message ?? String(error));
  }
  print();
}

// --- the keyboard ----------------------------------------------------------

// Tab finishes the last word with the first name here that starts with it.
function finish() {
  const value = input.value;
  const at = value.lastIndexOf(" ") + 1;
  const start = value.slice(at).replace(/^"/, "");
  const parts = start.split("\\");
  const begun = parts.pop().toLowerCase();
  const folder = resolve(parts.join("\\") || ".", cwd);
  if (!folder) return;
  const names = contents(folder).map((entry) => entry.name).filter((name) => name.toLowerCase().startsWith(begun));
  if (!names.length) return;
  const name = [...parts, names[0]].join("\\");
  input.value = value.slice(0, at) + (name.includes(" ") ? `"${name}"` : name);
}

input.addEventListener("keydown", async (e) => {
  if (busy) return e.preventDefault();
  if (e.key === "Enter") {
    e.preventDefault();
    const line = input.value;
    if (line.trim()) typed.push(line);
    back = 0;
    input.value = "";
    busy = true;
    promptText.textContent = "";
    await run(line);
    busy = false;
    showPrompt();
  } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    back = Math.max(0, Math.min(typed.length, back + (e.key === "ArrowUp" ? 1 : -1)));
    input.value = back ? typed[typed.length - back] : "";
  } else if (e.key === "Tab") {
    e.preventDefault();
    finish();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && !getSelection().toString()) {
    e.preventDefault();
    print(`${cwd}>${input.value}^C`);
    showPrompt();
  } else if (e.key === "Escape") {
    input.value = "";
  }
});

// A click anywhere focuses the prompt, unless it was to select text.
screen.addEventListener("click", () => {
  if (!getSelection().toString()) input.focus({ preventScroll: true });
});

if (desktop) {
  print("Microsoft Windows XP [Version 5.1.2600]");
  print("(C) Copyright 1985-2001 Microsoft Corp.");
  print();
  showPrompt();
  input.focus();
}
