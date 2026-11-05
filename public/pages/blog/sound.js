// techtrash.org : the sound player.
//
// A sound file in a post (a song uploaded in the editor, or a link to a sound
// file on a line of its own) plays in this: Play, its name and how far in it
// is, a bar to drag along it, and Mute and how loud. Play is Pause while it
// plays, and Mute is Unmute while it's muted: plain gray icons, drawn by
// site.css (their shapes are tokens), which these only say which of. Only one
// plays at a time, and how loud is kept for the next one (and the next visit).
//
// soundPlayer(src, title) gives back the player, for content.js to put in a
// post's player box.

import { el, remembered } from "./util.js";

const LOUDNESS = "techtrash:volume";   // how loud, kept in this browser

// An icon's button says what it does: to a screen reader, and as its tooltip.
function says(button, words) {
  button.setAttribute("aria-label", words);
  button.title = words;
  return button;
}
const iconButton = (look, words) => says(el("button", { class: `sound__button ${look}`, type: "button" }), words);

// 83 seconds as "1:23", an hour and more as "1:02:03".
function clock(seconds) {
  const s = Number.isFinite(seconds) ? Math.floor(seconds) : 0;
  const parts = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60];
  return parts[0] ? `${parts[0]}:${String(parts[1]).padStart(2, "0")}:${String(parts[2]).padStart(2, "0")}` : `${parts[1]}:${String(parts[2]).padStart(2, "0")}`;
}

export function soundPlayer(src, title) {
  const audio = el("audio", { src, preload: "metadata", hidden: true });
  const play = iconButton("sound__play", "Play");
  const name = el("span", { class: "sound__title", textContent: title });
  const time = el("span", { class: "sound__time meta", textContent: "0:00" });
  const seek = el("input", { class: "sound__seek", type: "range", min: "0", max: "0", step: "any", value: "0", "aria-label": `Where ${title} is at` });
  const mute = iconButton("sound__mute", "Mute");
  const loudness = el("input", { class: "sound__volume", type: "range", min: "0", max: "1", step: "0.05", "aria-label": "How loud" });

  const kept = remembered.get(LOUDNESS);
  audio.volume = typeof kept === "number" && kept >= 0 && kept <= 1 ? kept : 1;
  loudness.value = String(audio.volume);
  const showTime = () => {
    time.textContent = audio.duration ? `${clock(audio.currentTime)} / ${clock(audio.duration)}` : clock(audio.currentTime);
  };

  play.addEventListener("click", () => {
    if (!audio.paused) return audio.pause();
    for (const other of document.querySelectorAll(".sound audio")) if (other !== audio) other.pause();
    audio.play().catch(() => {});
  });
  audio.addEventListener("play", () => says(play, "Pause").classList.add("is-playing"));
  audio.addEventListener("pause", () => says(play, "Play").classList.remove("is-playing"));
  audio.addEventListener("durationchange", () => {
    seek.max = Number.isFinite(audio.duration) ? String(audio.duration) : "0";
    showTime();
  });
  audio.addEventListener("timeupdate", () => {
    seek.value = String(audio.currentTime);
    showTime();
  });
  // dragged along: there, as it's dragged
  seek.addEventListener("input", () => {
    audio.currentTime = Number(seek.value);
    showTime();
  });
  loudness.addEventListener("input", () => {
    audio.volume = Number(loudness.value);
    audio.muted = false;
    remembered.set(LOUDNESS, audio.volume);
  });
  mute.addEventListener("click", () => { audio.muted = !audio.muted; });
  audio.addEventListener("volumechange", () => {
    says(mute, audio.muted ? "Unmute" : "Mute").classList.toggle("is-muted", audio.muted);
    loudness.value = String(audio.muted ? 0 : audio.volume);
  });

  return el("div", { class: "sound" },
    audio, play, name, time, seek,
    el("span", { class: "sound__loud" }, mute, loudness));
}
