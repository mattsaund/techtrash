// techtrash.org : the sky behind the website, drawn with cosmos.js.
//
// Four planets and two asteroids made with cosmos.js (cosmos/planet.js,
// copied unchanged from github.com/mattsaund/cosmos.js), each turning slowly,
// and a scatter of stars in the six hues, twinkling. The sky stays put while
// the page scrolls over it, so every planet is on screen from the start.
//
// The planets are drawn at twice the rows the editor would use, in glyphs
// half the size (site.css scales them by --site-art-scale): the same size on
// screen, with twice the detail.
//
// The asteroids keep to the sides: each sits in the empty strip of window
// beside the page's column (left or right), as big as it can be there, up to
// the planets' size. Where the strip is too thin for even a small one (a
// phone), it isn't drawn at all, rather than over the words.
//
// No star lands on a planet: before the stars go out, each planet is turned a
// full circle to find every place it ever covers (rings, and the bumps of a
// lumpy one, included), and a star that would fall there goes somewhere else.
// They're placed again when the window changes size, since the planets move
// with it.
//
// To change a planet, tune it in the cosmos.js editor (msaunders.dev/cosmos)
// and copy its settings into PLANETS: they're the editor's own settings, by
// the same names (with rows doubled, as above). Two things come from the site
// instead of the editor: its color is a hue class, so it stays one of the
// six, and where it sits is its .planet--N rule in site.css.
//
// Someone who's asked their computer for less motion gets the sky standing
// still: no turning, no twinkling.

const PLANETS = [
  { place: "planet--1", hue: "hue-6", texture: "gas",  rows: 88, brightness: 1.3, rings: true, tilt: 0.42, roll: -0.35, speed: 0.05, seed: 1994 },
  { place: "planet--2", hue: "hue-2", texture: "lava", rows: 60, brightness: 1.3, tilt: 0.20, roll: 0.30, speed: 0.08, seed: 20260929 },
  { place: "planet--3", hue: "hue-5", texture: "ice",  rows: 52, brightness: 1.3, tilt: 0.50, roll: 0.10, speed: 0.07, direction: -1, seed: 1969 },
  { place: "planet--4", hue: "hue-4", texture: "rock", rows: 36, brightness: 1.3, craters: 22, lumpiness: 0.25, speed: 0.11, seed: 42 },
  // two asteroids: lumpy, potato-shaped rocks, tumbling quicker than the planets
  // turn. side, across and at say where: which side of the page, how far across
  // that strip of window from its edge (1 is up against the page), and how far
  // down the window.
  { place: "planet--5", hue: "hue-3", side: "right", across: 0.5, at: 0.42, texture: "rock", rows: 51, brightness: 1.3, craters: 24, lumpiness: 1.5, tilt: 0.70, roll: 0.90, speed: 0.20, seed: 99942 },
  { place: "planet--6", hue: "hue-1", side: "left", across: 0.7, at: 0.12, texture: "rock", rows: 51, brightness: 1.3, craters: 18, lumpiness: 1.7, tilt: 0.70, roll: 0.90, speed: 0.16, direction: -1, seed: 1221 },
];

const STARS = 150;
const STAR_GLYPHS = [".", ".", ".", "·", "·", "+", "*"];
const STAR_SEED = 2026;   // the same sky on every visit
const FRAME_MS = 100;     // the planets turn slowly: ten frames a second is plenty
const TURNS = 16;         // how many angles a planet is looked at, to find all it covers
const CLEAR = 6;          // how far, in pixels, a star stays from a planet
const ROCK_AIR = 12;      // ...and an asteroid from the page's column and the window's edge
const ROCK_LEAST = 40;    // an asteroid smaller than this, in pixels, isn't drawn

const sky = document.querySelector(".sky");
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

// A small seeded random number generator (mulberry32), so the sky is the
// same every time.
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- planets -------------------------------------------------------------------

const planets = PLANETS.map(({ place, hue, side, across, at, ...settings }) => {
  const pre = document.createElement("pre");
  pre.className = `planet ${place} ${hue}`;
  sky.append(pre);
  const cfg = Object.assign(window.Cosmos.defaults(), settings);
  const body = window.Cosmos.build(cfg);
  // every glyph the planet covers at any angle
  const covers = new Uint8Array(body.rows * body.cols);
  for (let i = 0; i < TURNS; i++) {
    window.Cosmos.render(body, (i / TURNS) * 2 * Math.PI).split("\n").forEach((line, row) => {
      for (let col = 0; col < line.length; col++) if (line[col] !== " ") covers[row * body.cols + col] = 1;
    });
  }
  // the part of the frame it actually covers, in glyphs
  const box = { top: body.rows, bottom: 0, left: body.cols, right: 0 };
  covers.forEach((covered, i) => {
    if (!covered) return;
    const row = Math.floor(i / body.cols);
    const col = i % body.cols;
    box.top = Math.min(box.top, row);
    box.bottom = Math.max(box.bottom, row + 1);
    box.left = Math.min(box.left, col);
    box.right = Math.max(box.right, col + 1);
  });
  return { pre, body, covers, box, side, across, at, turn: cfg.speed * cfg.direction };
});

// Each asteroid in its strip of window beside the page, where it says
// (across, at), as big as fits (up to the planets' size), or not at all.
function placeAsteroids() {
  const page = document.querySelector(".page");
  const pad = parseFloat(getComputedStyle(page).paddingLeft);
  const column = page.getBoundingClientRect();
  const window_ = sky.getBoundingClientRect();
  const most = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--site-art-scale"));
  for (const rock of planets.filter((planet) => planet.side)) {
    const { pre, body, box } = rock;
    // its own size, before scaling: the frame's, and the rock's in it (measured
    // drawn: one left out last time measures nothing)
    pre.hidden = false;
    const glyphWide = pre.offsetWidth / body.cols;
    const glyphTall = pre.offsetHeight / body.rows;
    const wide = (box.right - box.left) * glyphWide;
    const tall = (box.bottom - box.top) * glyphTall;
    const strip = rock.side === "left" ? column.left + pad : window_.width - (column.right - pad);
    const scale = Math.min(most, (strip - 2 * ROCK_AIR) / wide, (window_.height / 2 - ROCK_AIR) / tall);
    pre.hidden = !(scale * Math.max(wide, tall) >= ROCK_LEAST);
    if (pre.hidden) continue;
    // the rock's middle, in its frame, goes where it says in the strip, all of
    // it inside the strip and the window
    const x = ((box.left + box.right) / 2) * glyphWide;
    const y = ((box.top + box.bottom) / 2) * glyphTall;
    const half = (scale * wide) / 2;
    const into = Math.min(Math.max(strip * rock.across, ROCK_AIR + half), strip - ROCK_AIR - half);
    const middle = rock.side === "left" ? into : window_.width - into;
    const height = Math.min(Math.max(window_.height * rock.at, ROCK_AIR + (scale * tall) / 2), window_.height - ROCK_AIR - (scale * tall) / 2);
    pre.style.transformOrigin = `${x}px ${y}px`;
    pre.style.transform = `scale(${scale})`;
    pre.style.left = `${middle - x}px`;
    pre.style.top = `${height - y}px`;
  }
}

function draw(seconds) {
  for (const planet of planets) {
    if (!planet.pre.hidden) planet.pre.textContent = window.Cosmos.render(planet.body, seconds * planet.turn);
  }
}

// Is this point of the window on a planet, or within CLEAR pixels of one?
function onPlanet(x, y, shapes) {
  for (const { rect, body, covers } of shapes) {
    if (x < rect.left - CLEAR || x > rect.right + CLEAR || y < rect.top - CLEAR || y > rect.bottom + CLEAR) continue;
    const across = rect.width / body.cols;   // one glyph, on screen
    const down = rect.height / body.rows;
    const col = Math.floor((x - rect.left) / across);
    const row = Math.floor((y - rect.top) / down);
    const cols = Math.ceil(CLEAR / across);
    const rows = Math.ceil(CLEAR / down);
    for (let r = Math.max(0, row - rows); r <= Math.min(body.rows - 1, row + rows); r++) {
      for (let c = Math.max(0, col - cols); c <= Math.min(body.cols - 1, col + cols); c++) {
        if (covers[r * body.cols + c]) return true;
      }
    }
  }
  return false;
}

// --- stars ---------------------------------------------------------------------

// What each star is stays the same; where it is depends on where the planets are.
const looks = seeded(STAR_SEED);
const stars = Array.from({ length: STARS }, () => {
  const star = document.createElement("span");
  star.className = `star hue-${1 + Math.floor(looks() * 6)}`;
  star.textContent = STAR_GLYPHS[Math.floor(looks() * STAR_GLYPHS.length)];
  // its own twinkle: how fast, and where in it it starts
  star.style.setProperty("--pace", (0.6 + looks() * 0.9).toFixed(2));
  star.style.setProperty("--start", looks().toFixed(2));
  sky.append(star);
  return star;
});

function placeStars() {
  const { width, height } = sky.getBoundingClientRect();
  const shapes = planets.filter((planet) => !planet.pre.hidden).map((planet) => ({ ...planet, rect: planet.pre.getBoundingClientRect() }));
  // a star is placed by its corner, and seen in its middle
  const glyph = stars[0].getBoundingClientRect();
  const spot = seeded(STAR_SEED + 1);
  for (const star of stars) {
    let x;
    let y;
    let tries = 0;
    do {
      x = spot() * width;
      y = spot() * height;
    } while (onPlanet(x + glyph.width / 2, y + glyph.height / 2, shapes) && ++tries < 50);
    star.style.left = `${((x / width) * 100).toFixed(2)}%`;
    star.style.top = `${((y / height) * 100).toFixed(2)}%`;
  }
}

// Again whenever the window's size changes: a scroll bar coming or going
// moves the page's column too.
let resizing;
new ResizeObserver(() => {
  clearTimeout(resizing);
  resizing = setTimeout(() => {
    placeAsteroids();
    placeStars();
  }, 150);
}).observe(sky);
draw(0);
placeAsteroids();
placeStars();

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
