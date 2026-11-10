// Windows Media Player, for the music and sounds on the shared disk. Anyone
// can listen. Only the admin can add music, with File > Add to Library or by
// dropping songs on the player.
//
// The playlist is the folder a song was opened from, or all of My Music.
// The keys are WMP's own, and the Play menu lists them.
//
// The visualization listens through the Web Audio API. A browser only lets
// that start once the page has been pressed, so until then the song plays on
// its own and the screen shows its name.

import { openDialog } from "/js/file-dialog.js";
import { SOUND_NAME, fileUrl, isFolder, isSound, nameParts, sortItems } from "/js/items.js";
import { menuBar, showMenu } from "/js/menu.js";
import { showMessage } from "/js/message.js";
import { deleteItems, saveFromComputer } from "/js/tasks.js";

const desktop = window.top === window ? null : window.top.desktop;
const disk = desktop?.disk;

const KEY = "techtrash:media-player";   // in localStorage: { volume, muted, shuffle, repeat, look }
const LOOKS = { "bars-and-waves": "Bars and Waves", bars: "Bars", scope: "Scope", none: "None" };
const BARS = 40;

const audio = new Audio();
audio.preload = "auto";

const page = document.body;
const screen = document.querySelector(".player__screen");
const title = document.querySelector(".player__title");
const listName = document.querySelector(".player__list-name");
const tracks = document.querySelector(".player__tracks");
const total = document.querySelector(".player__total");
const seek = document.querySelector(".player__seek");
const volumeSlider = document.querySelector(".player__volume");
const status = document.querySelector(".player__status");
const time = document.querySelector(".player__time");

let source = { folder: "music", deep: true };   // where the playlist comes from
let list = [];         // its songs
let now = null;        // the song that's loaded
let picked = null;     // the id of the selected playlist row
let seeking = false;   // is someone dragging the seek bar?
const lengths = new Map();   // each song's length in seconds, once known

// --- settings, kept for next time ------------------------------------------

const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
})();
let volume = Number.isFinite(saved.volume) ? Math.min(1, Math.max(0, saved.volume)) : 0.8;
let muted = saved.muted === true;
let shuffle = saved.shuffle === true;
let repeat = saved.repeat === true;
let look = LOOKS[saved.look] ? saved.look : "bars-and-waves";

function remember() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ volume, muted, shuffle, repeat, look }));
  } catch {}
}

// --- little helpers --------------------------------------------------------

function el(tag, className, parent, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  parent?.append(node);
  return node;
}

const songName = (item) => nameParts(item.name)[0];

// 83 seconds is "01:23", and an hour or more is "1:02:03". Blank if unknown.
function clock(seconds) {
  if (!Number.isFinite(seconds)) return "";
  const s = Math.floor(seconds);
  const two = (n) => String(n).padStart(2, "0");
  return s >= 3600 ? `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${two(Math.floor(s / 60))}:${two(s % 60)}`;
}

function say(text) {
  status.textContent = text;
}

// Fills a slider's groove up to its knob.
function fill(slider) {
  const span = Number(slider.max) - Number(slider.min);
  slider.style.setProperty("--fill", `${span > 0 ? ((Number(slider.value) - Number(slider.min)) / span) * 100 : 0}%`);
}

// --- the playlist ----------------------------------------------------------

// The songs in a folder, in its order, then (if deep) the ones in the
// folders inside it.
function songsIn(folder, deep) {
  const songs = [];
  const folders = [];
  for (const item of sortItems(disk.children(folder))) {
    if (isSound(item)) songs.push(item);
    else if (deep && isFolder(item)) folders.push(item);
  }
  return [...songs, ...folders.flatMap((one) => songsIn(one.id, true))];
}

// Rebuilds the list from the disk after anyone's change. If the loaded song
// is gone, it stops.
function refresh() {
  const folder = disk.item(source.folder);
  list = folder && !disk.inBin(folder.id) ? songsIn(folder.id, source.deep) : [];
  if (now) {
    const fresh = disk.item(now.id);
    if (!fresh || disk.inBin(fresh.id)) unload();
    else now = fresh;
  }
  drawList();
  measure();
}

function drawList() {
  listName.textContent = disk.item(source.folder)?.name ?? "Playlist";
  tracks.replaceChildren();
  if (!list.length) el("li", "player__empty", tracks, disk.admin ? "No music here yet. Add some with File > Add to Library." : "No music here yet.");
  for (const item of list) {
    const row = el("li", "player__track", tracks);
    row.dataset.id = item.id;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(item.id === picked));
    row.classList.toggle("is-now", item.id === now?.id);
    el("span", "player__track-name", row, songName(item));
    el("span", "player__track-time", row, clock(lengths.get(item.id)));
  }
  drawTotal();
  showSong();
}

function drawTotal() {
  if (!list.length) {
    total.textContent = "";
    return;
  }
  const known = list.map((item) => lengths.get(item.id));
  const items = `${list.length} item${list.length === 1 ? "" : "s"}`;
  total.textContent = known.every(Number.isFinite) ? `${items}, Total Time: ${clock(known.reduce((sum, n) => sum + n, 0))}` : items;
}

function pick(id) {
  picked = id;
  for (const row of tracks.querySelectorAll(".player__track")) row.setAttribute("aria-selected", String(row.dataset.id === id));
  tracks.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
}

// How long each song is, found one at a time by loading just enough of it.
let measuring = false;
async function measure() {
  if (measuring) return;
  measuring = true;
  for (let item; (item = list.find((one) => !lengths.has(one.id))); ) {
    lengths.set(item.id, await lengthOf(item));
    const cell = tracks.querySelector(`[data-id="${CSS.escape(item.id)}"] .player__track-time`);
    if (cell) cell.textContent = clock(lengths.get(item.id));
    drawTotal();
  }
  measuring = false;
}

function lengthOf(item) {
  return new Promise((resolve) => {
    const probe = new Audio();
    probe.preload = "metadata";
    const done = (seconds) => {
      probe.removeAttribute("src");
      probe.load();
      resolve(seconds);
    };
    probe.addEventListener("loadedmetadata", () => done(probe.duration), { once: true });
    probe.addEventListener("error", () => done(NaN), { once: true });
    setTimeout(() => done(NaN), 15000);
    probe.src = fileUrl(item);
  });
}

// --- playing ---------------------------------------------------------------

async function play(item) {
  if (!item) return;
  wire();
  if (now?.id !== item.id) {
    now = item;
    audio.src = fileUrl(item);
    seek.value = 0;
    const search = `?id=${encodeURIComponent(item.id)}`;
    if (location.search !== search) {
      history.replaceState(null, "", location.pathname + search);
      dispatchEvent(new Event("addresschange"));
    }
  }
  picked = item.id;
  drawList();
  try {
    await audio.play();
  } catch (error) {
    // The browser wants a press on the page first, so it waits for Play.
    if (error.name === "NotAllowedError") say("Ready");
  }
}

function playPause() {
  if (!now) return play(list.find((item) => item.id === picked) ?? list[0]);
  wire();
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

function stop() {
  audio.pause();
  try {
    audio.currentTime = 0;
  } catch {}
  if (now) say("Stopped");
  showTime();
}

// Unloads the song, as when the one playing gets deleted.
function unload() {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  now = null;
  page.classList.remove("is-playing");
  say("Ready");
  showTime();
  showSong();
}

// The next song (by 1) or the one before (by -1). Shuffle picks any other.
// At the end of the list it stops, unless Repeat is on or someone pressed Next.
function step(by, { auto = false } = {}) {
  if (!list.length) return;
  const at = list.findIndex((item) => item.id === now?.id);
  if (by < 0 && audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  let next = at === -1 ? (by > 0 ? 0 : list.length - 1) : at + by;
  if (shuffle && list.length > 1) {
    do next = Math.floor(Math.random() * list.length); while (next === at);
  } else if (next < 0 || next >= list.length) {
    if (auto && !repeat) {
      stop();
      return say("Ready");
    }
    next = (next + list.length) % list.length;
  }
  play(list[next]);
}

function setVolume(level) {
  volume = Math.min(1, Math.max(0, level));
  muted = false;
  volumeSlider.value = Math.round(volume * 100);
  loudness();
  remember();
}

function toggleMute() {
  muted = !muted;
  loudness();
  remember();
}

// The volume goes through the Web Audio graph once it's running, so the
// visualization doesn't shrink as the music gets quieter.
function loudness() {
  page.classList.toggle("is-muted", muted);
  fill(volumeSlider);
  if (graph) {
    graph.gain.gain.value = muted ? 0 : volume;
  } else {
    audio.volume = volume;
    audio.muted = muted;
  }
}

function showSong() {
  title.textContent = now ? songName(now) : "Windows Media Player";
  for (const row of tracks.querySelectorAll(".player__track")) row.classList.toggle("is-now", row.dataset.id === now?.id);
  draw();
}

function showTime() {
  const length = audio.duration;
  const at = seeking ? Number(seek.value) : audio.currentTime;
  time.textContent = now ? `${clock(at) || "00:00"}${Number.isFinite(length) ? ` / ${clock(length)}` : ""}` : "00:00";
  seek.disabled = !now || !Number.isFinite(length);
  if (!seeking) {
    seek.max = Number.isFinite(length) ? length : 0;
    seek.value = at || 0;
  }
  fill(seek);
}

audio.addEventListener("playing", () => {
  page.classList.add("is-playing");
  say("Playing");
  animate();
});
audio.addEventListener("pause", () => {
  page.classList.remove("is-playing");
  if (!audio.ended && audio.currentTime > 0) say("Paused");
});
audio.addEventListener("waiting", () => say("Buffering..."));
audio.addEventListener("timeupdate", showTime);
audio.addEventListener("durationchange", () => {
  if (now && Number.isFinite(audio.duration)) {
    lengths.set(now.id, audio.duration);
    const cell = tracks.querySelector(`[data-id="${CSS.escape(now.id)}"] .player__track-time`);
    if (cell) cell.textContent = clock(audio.duration);
    drawTotal();
  }
  showTime();
});
audio.addEventListener("ended", () => step(1, { auto: true }));
audio.addEventListener("error", () => {
  if (!now) return;
  page.classList.remove("is-playing");
  say(`Can't play ${songName(now)}.`);
});

seek.addEventListener("input", () => {
  seeking = true;
  showTime();
});
seek.addEventListener("change", () => {
  seeking = false;
  if (Number.isFinite(audio.duration)) audio.currentTime = Number(seek.value);
  showTime();
});
volumeSlider.addEventListener("input", () => setVolume(Number(volumeSlider.value) / 100));

// --- the visualization -----------------------------------------------------

let context = null;   // the Web Audio context, once made
let graph = null;     // { analyser, gain, freq, wave, peaks } once it's running

// Starts the Web Audio graph if the browser will let it. Called on every
// press, since the first one is what lets it start.
function wire() {
  if (graph || !window.AudioContext) return;
  context ??= new AudioContext();
  context.resume().then(() => {
    if (graph || context.state !== "running") return;
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.75;
    const gain = context.createGain();
    context.createMediaElementSource(audio).connect(analyser);
    analyser.connect(gain).connect(context.destination);
    graph = { analyser, gain, freq: new Uint8Array(analyser.frequencyBinCount), wave: new Uint8Array(analyser.fftSize), peaks: new Array(BARS).fill(0) };
    audio.volume = 1;
    audio.muted = false;
    loudness();
    animate();
  }, () => {});
}

const paint = screen.getContext("2d");
let colors = null;
let ramp = null;      // the bars' gradient, for the screen's height
let running = false;
let quietSince = 0;

function size() {
  const scale = devicePixelRatio || 1;
  screen.width = Math.max(1, Math.round(screen.clientWidth * scale));
  screen.height = Math.max(1, Math.round(screen.clientHeight * scale));
  const css = getComputedStyle(document.documentElement);
  const token = (name) => css.getPropertyValue(name).trim();
  colors = { screen: token("--player-screen"), low: token("--player-low"), high: token("--player-high"), wave: token("--player-wave"), ink: token("--player-ink-dim"), font: token("--font-ui") };
  ramp = paint.createLinearGradient(0, screen.height, 0, 0);
  ramp.addColorStop(0, colors.low);
  ramp.addColorStop(1, colors.high);
  draw();
}
new ResizeObserver(size).observe(screen);

// Draws frames while something's playing, and for a second after so the
// bars can fall.
function animate() {
  if (running) return;
  running = true;
  const frame = () => {
    draw();
    if (!audio.paused) quietSince = performance.now();
    if (graph && performance.now() - quietSince < 1000) requestAnimationFrame(frame);
    else running = false;
  };
  requestAnimationFrame(frame);
}

function draw() {
  if (!colors) return;
  const { width, height } = screen;
  paint.fillStyle = colors.screen;
  paint.fillRect(0, 0, width, height);
  if (graph && look !== "none" && now) {
    if (look !== "scope") drawBars(width, height);
    if (look !== "bars") drawWave(width, height, look === "scope" ? 0.9 : 0.35);
    return;
  }
  // Nothing to show, so the song's name, as WMP did with no visualization.
  if (!now) return;
  paint.fillStyle = colors.ink;
  paint.font = `${Math.round(14 * (devicePixelRatio || 1))}px ${colors.font}`;
  paint.textAlign = "center";
  paint.textBaseline = "middle";
  paint.fillText(songName(now), width / 2, height / 2, width * 0.9);
}

// The spectrum in BARS bars, low notes on the left. Each band is wider than
// the last, the way ears hear, and each bar's peak cap falls slowly.
function drawBars(width, height) {
  const { analyser, freq, peaks } = graph;
  analyser.getByteFrequencyData(freq);
  const top = freq.length * 0.7;
  const gap = Math.max(1, Math.round(width / BARS / 5));
  const bar = (width - gap * (BARS + 1)) / BARS;
  const cap = Math.max(2, Math.round(height / 100));
  paint.fillStyle = ramp;
  for (let i = 0; i < BARS; i++) {
    const from = Math.floor(top ** (i / BARS));
    const to = Math.max(from + 1, Math.floor(top ** ((i + 1) / BARS)));
    let level = 0;
    for (let bin = from; bin < to; bin++) level = Math.max(level, freq[bin]);
    const tall = (level / 255) * height * 0.92;
    peaks[i] = Math.max(tall, peaks[i] - height / 160);
    const x = gap + i * (bar + gap);
    paint.fillRect(x, height - tall, bar, tall);
    paint.fillRect(x, height - peaks[i] - cap * 2, bar, cap);
  }
}

// The sound's wave across the middle.
function drawWave(width, height, reach) {
  const { analyser, wave } = graph;
  analyser.getByteTimeDomainData(wave);
  paint.strokeStyle = colors.wave;
  paint.lineWidth = Math.max(1, Math.round(width / 400));
  paint.beginPath();
  for (let i = 0; i < wave.length; i++) {
    const x = (i / (wave.length - 1)) * width;
    const y = height / 2 + ((wave[i] - 128) / 128) * (height / 2) * reach;
    if (i) paint.lineTo(x, y);
    else paint.moveTo(x, y);
  }
  paint.stroke();
}

// --- adding music (admin only) and opening a song --------------------------

// New music goes in the playlist's folder, or My Music.
const addingTo = () => (disk.item(source.folder) && !disk.inBin(source.folder) ? source.folder : "music");

const chooser = el("input", "", page);
chooser.hidden = true;
chooser.type = "file";
chooser.multiple = true;
chooser.accept = "audio/*,.mp3,.wav,.ogg,.oga,.flac,.m4a,.aac";
chooser.addEventListener("change", () => add([...chooser.files]));

async function add(files) {
  if (!files.length) return;
  say("Adding to Library...");
  await saveFromComputer(files, addingTo());
  chooser.value = "";
  say(audio.paused ? "Ready" : "Playing");
}

async function openOne() {
  const item = await openDialog({ kind: "sound", folder: now?.parent ?? addingTo() });
  if (!item) return;
  if (!isSound(item)) {
    await showMessage({ title: "Windows Media Player", text: `Windows Media Player cannot play ${item.name}. It isn't a sound.` });
    return;
  }
  source = { folder: item.parent, deep: false };
  refresh();
  play(item);
}

// Songs dropped on the player from your computer get added. js/tasks.js
// refuses them for anyone but the admin.
page.addEventListener("dragover", (e) => {
  if (!e.dataTransfer.types.includes("Files")) return;
  e.preventDefault();
  page.classList.add("is-dropping");
});
page.addEventListener("dragleave", (e) => {
  if (!e.relatedTarget || !page.contains(e.relatedTarget)) page.classList.remove("is-dropping");
});
page.addEventListener("drop", (e) => {
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  page.classList.remove("is-dropping");
  add([...e.dataTransfer.files].filter((file) => file.type.startsWith("audio/") || SOUND_NAME.test(file.name)));
});

// --- controls, playlist, menus and keys ------------------------------------

const ACTIONS = {
  play: playPause,
  stop,
  previous: () => step(-1),
  next: () => step(1),
  mute: toggleMute,
};
for (const button of document.querySelectorAll("[data-act]")) {
  button.addEventListener("click", () => ACTIONS[button.dataset.act]());
}

// Any press lets the visualization start.
addEventListener("pointerdown", wire, true);

const rowOf = (target) => target.closest(".player__track");
const itemOf = (row) => list.find((item) => item.id === row?.dataset.id);

tracks.addEventListener("click", (e) => {
  const row = rowOf(e.target);
  if (row) pick(row.dataset.id);
});
tracks.addEventListener("dblclick", (e) => play(itemOf(rowOf(e.target))));
tracks.addEventListener("contextmenu", (e) => {
  const item = itemOf(rowOf(e.target));
  if (!item) return;
  e.preventDefault();
  pick(item.id);
  const entries = [
    { label: "Play", bold: true, action: () => play(item) },
    "-",
    { label: "Open File Location", action: () => desktop.open("files", `?folder=${item.parent}`) },
  ];
  if (disk.admin) entries.push("-", { label: "Delete from Library", action: () => deleteItems([item]) });
  showMenu(entries, { x: e.clientX, y: e.clientY });
});
tracks.addEventListener("keydown", (e) => {
  const at = list.findIndex((item) => item.id === picked);
  const moves = { ArrowUp: -1, ArrowDown: 1, Home: -Infinity, End: Infinity };
  if (e.key in moves && list.length) {
    const to = Math.min(list.length - 1, Math.max(0, (at === -1 ? 0 : at) + moves[e.key]));
    pick(list[to].id);
  } else if (e.key === "Enter") {
    play(list[at]);
  } else {
    return;
  }
  e.preventDefault();
});

menuBar(document.querySelector(".menu-bar"), [
  { label: "File", items: () => [
    { label: "Open...", keys: "Ctrl+O", action: openOne },
    ...(disk.admin ? [{ label: "Add to Library...", action: () => chooser.click() }] : []),
    "-",
    { label: "Exit", action: () => desktop.close(window) },
  ] },
  { label: "View", items: () => [
    { label: "Visualizations", submenu: Object.entries(LOOKS).map(([id, label]) => ({
      label, radio: look === id, action: () => { look = id; remember(); draw(); },
    })) },
  ] },
  { label: "Play", items: () => [
    { label: audio.paused ? "Play" : "Pause", keys: "Ctrl+P", disabled: !list.length, action: playPause },
    { label: "Stop", keys: "Ctrl+S", disabled: !now, action: stop },
    "-",
    { label: "Previous", keys: "Ctrl+B", disabled: !list.length, action: () => step(-1) },
    { label: "Next", keys: "Ctrl+F", disabled: !list.length, action: () => step(1) },
    "-",
    { label: "Shuffle", keys: "Ctrl+H", checked: shuffle, action: () => { shuffle = !shuffle; remember(); } },
    { label: "Repeat", checked: repeat, action: () => { repeat = !repeat; remember(); } },
    "-",
    { label: "Volume", submenu: [
      { label: "Up", keys: "F10", action: () => setVolume(volume + 0.1) },
      { label: "Down", keys: "F9", action: () => setVolume(volume - 0.1) },
      { label: "Mute", keys: "F8", checked: muted, action: toggleMute },
    ] },
  ] },
  { label: "Help", items: () => [
    { label: "About Windows Media Player", action: () => showMessage({
      title: "About Windows Media Player",
      text: "Windows Media Player\n\nPlays the music and sounds on techtrash.org's shared disk. Anyone can listen, and only the admin can add music.",
      icon: "information",
    }) },
  ] },
]);

document.addEventListener("keydown", (e) => {
  if (document.querySelector(".layer")) return;
  wire();
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (ctrl && key === "p") playPause();
  else if (ctrl && key === "s") stop();
  else if (ctrl && key === "b") step(-1);
  else if (ctrl && key === "f") step(1);
  else if (ctrl && key === "h") { shuffle = !shuffle; remember(); }
  else if (ctrl && key === "o") openOne();
  else if (e.key === "F8") toggleMute();
  else if (e.key === "F9") setVolume(volume - 0.1);
  else if (e.key === "F10") setVolume(volume + 0.1);
  else if (e.key === " " && !e.target.closest("button, input")) playPause();
  else return;
  e.preventDefault();
});

// --- starting up -----------------------------------------------------------

function start() {
  volumeSlider.value = Math.round(volume * 100);
  loudness();
  showTime();
  addEventListener("diskchange", (e) => {
    if (!e.detail.settings) refresh();
  });
  disk.ready.then(() => {
    const asked = new URLSearchParams(location.search);
    const song = disk.item(asked.get("id"));
    const folder = disk.item(asked.get("folder"));
    if (isSound(song)) {
      source = { folder: song.parent, deep: false };
      refresh();
      play(song);
    } else if (isFolder(folder)) {
      source = { folder: folder.id, deep: true };
      refresh();
      play(list[0]);
    } else {
      refresh();
    }
    tracks.focus();
  });
}

if (desktop) start();
