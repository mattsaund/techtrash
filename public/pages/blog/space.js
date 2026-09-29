// techtrash.org : the sky behind the website, drawn with cosmos.js.
//
// A scatter of stars in the six hues, and four planets made with cosmos.js
// (cosmos/planet.js, copied unchanged from github.com/mattsaund/cosmos.js),
// each turning slowly.
//
// To change a planet, tune it in the cosmos.js editor (msaunders.dev/cosmos)
// and copy its settings into PLANETS: they're the editor's own settings, by
// the same names. Two things come from the site instead of the editor: its
// color is a hue class, so it stays one of the six, and where it sits is its
// .planet--N rule in site.css.
//
// Someone who's asked their computer for less motion gets the sky standing
// still.

const PLANETS = [
  { place: "planet--1", hue: "hue-6", texture: "gas",  rows: 44, rings: true, tilt: 0.42, roll: -0.35, speed: 0.05, seed: 1994 },
  { place: "planet--2", hue: "hue-2", texture: "lava", rows: 30, tilt: 0.20, roll: 0.30, speed: 0.08, seed: 20260929 },
  { place: "planet--3", hue: "hue-5", texture: "ice",  rows: 26, tilt: 0.50, roll: 0.10, speed: 0.07, direction: -1, seed: 1969 },
  { place: "planet--4", hue: "hue-4", texture: "rock", rows: 18, craters: 22, lumpiness: 0.25, speed: 0.11, seed: 42 },
];

const STARS = 140;
const STAR_GLYPHS = [".", ".", ".", "·", "·", "+", "*"];
const STAR_SEED = 2026;   // the same sky on every visit
const FRAME_MS = 100;     // the planets turn slowly: ten frames a second is plenty

const sky = document.querySelector(".sky");
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

// A small seeded random number generator (mulberry32), so the stars land in
// the same places every time.
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- stars ---------------------------------------------------------------------

const random = seeded(STAR_SEED);
for (let i = 0; i < STARS; i++) {
  const star = document.createElement("span");
  star.className = `star hue-${1 + Math.floor(random() * 6)}`;
  star.textContent = STAR_GLYPHS[Math.floor(random() * STAR_GLYPHS.length)];
  star.style.left = `${(random() * 100).toFixed(2)}%`;
  star.style.top = `${(random() * 100).toFixed(2)}%`;
  sky.append(star);
}

// --- planets -------------------------------------------------------------------

const planets = PLANETS.map(({ place, hue, ...settings }) => {
  const pre = document.createElement("pre");
  pre.className = `planet ${place} ${hue}`;
  sky.append(pre);
  const cfg = Object.assign(window.Cosmos.defaults(), settings);
  return { pre, body: window.Cosmos.build(cfg), turn: cfg.speed * cfg.direction };
});

function draw(seconds) {
  for (const planet of planets) planet.pre.textContent = window.Cosmos.render(planet.body, seconds * planet.turn);
}

draw(0);
if (!still) {
  let last = 0;
  const tick = (now) => {
    if (now - last >= FRAME_MS) {
      last = now;
      draw(now / 1000);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
