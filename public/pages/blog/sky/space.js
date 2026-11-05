// techtrash.org : the sky behind the website, drawn with cosmos.js.
//
// Four planets and two asteroids made with cosmos.js (cosmos/planet.js,
// copied unchanged from github.com/mattsaund/cosmos.js), each turning slowly,
// and a scatter of stars in the six hues, twinkling. The sky stays put while
// the page scrolls over it, so every planet is on screen from the start.
//
// Each body gets a cosmos.js of its own. cosmos.js keeps the part of a frame
// that doesn't turn (its view cache) for one body at a time, so six bodies
// taking turns with one would build it again for every one, every frame;
// each run of the script is a cosmos.js of its own, cache and all. Each is
// told the shape of a glyph in the font the planets are actually drawn in
// (setAspect), so a round planet comes out round: measured once the page's
// styles and the font have both arrived, and then checked against the planets
// as they're really drawn (keepRound): right after the first frame, whenever
// a font finishes loading, when the window changes size, and every couple of
// seconds besides. Drawn in any other shape (a phone can run this before its
// styles or its font have reached the page, and the planets come out wide),
// they're built again for the real one.
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
// the same names. Three things come from the site instead of the editor: its
// frame (rows, doubled as above, and wide, the frame's width over its
// height), its color, which is a hue class so it stays one of the six, and
// where it sits, its .planet--N rule in site.css. zoom is the editor's, but
// past 1 here: the ringed one's frame is cut close around its rings as they
// lie, the way it looked before cosmos.js cut every frame for rings at their
// widest.
//
// Someone who's asked their computer for less motion gets the sky standing
// still: no turning, no twinkling.

const PLANETS = [
  { place: "planet--1", hue: "hue-6", rows: 88, wide: 1.847, texture: "gas", zoom: 1.926, brightness: 1.3, rings: true, tilt: 0.42, roll: -0.35, speed: 0.05, seed: 1994 },
  { place: "planet--2", hue: "hue-2", rows: 60, wide: 1, texture: "lava", zoom: 1, brightness: 1.3, tilt: 0.20, roll: 0.30, speed: 0.08, seed: 20260929 },
  { place: "planet--3", hue: "hue-5", rows: 52, wide: 1, texture: "ice", zoom: 1, brightness: 1.3, tilt: 0.50, roll: 0.10, speed: 0.07, direction: -1, seed: 1969 },
  { place: "planet--4", hue: "hue-4", rows: 36, wide: 1, texture: "rock", zoom: 1, brightness: 1.3, craters: 22, lumpiness: 0.25, speed: 0.11, seed: 42 },
  // two asteroids: lumpy, potato-shaped rocks, tumbling quicker than the planets
  // turn. side, across and at say where: which side of the page, how far across
  // that strip of window from its edge (1 is up against the page), and how far
  // down the window.
  { place: "planet--5", hue: "hue-3", side: "right", across: 0.5, at: 0.42, rows: 51, wide: 1, texture: "rock", zoom: 1, brightness: 1.3, craters: 24, lumpiness: 1.5, tilt: 0.70, roll: 0.90, speed: 0.20, seed: 99942 },
  { place: "planet--6", hue: "hue-1", side: "left", across: 0.7, at: 0.12, rows: 51, wide: 1, texture: "rock", zoom: 1, brightness: 1.3, craters: 18, lumpiness: 1.7, tilt: 0.70, roll: 0.90, speed: 0.16, direction: -1, seed: 1221 },
];

const COSMOS = "/pages/blog/sky/cosmos/planet.js";
const STARS = 150;
const STAR_GLYPHS = [".", ".", ".", ".", ".", "+", "*"];
const STAR_SEED = 2026;   // the same sky on every visit
const FRAME_MS = 100;     // the planets turn slowly: ten frames a second is plenty
const TURNS = 16;         // how many angles a planet is looked at, to find all it covers
const CLEAR = 6;          // how far, in pixels, a star stays from a planet
const ROCK_AIR = 12;      // ...and an asteroid from the page's column and the window's edge
const ROCK_LEAST = 40;    // an asteroid smaller than this, in pixels, isn't drawn
const SHAPE_SLACK = 0.02; // how far the glyphs as drawn can be from the shape the planets
                          // were built for (2%) before they're built again
const RECHECK_MS = 2000;  // ...and how often that's looked at, whatever else happens

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

// A cosmos.js of its own: the script, run again. (One at a time, so each
// Cosmos it leaves behind is caught before the next one's run.)
const cosmos = () => new Promise((resolve, reject) => {
  const script = document.createElement("script");
  script.src = COSMOS;
  script.onload = () => {
    script.remove();
    resolve(window.Cosmos);
  };
  script.onerror = () => reject(new Error(`${COSMOS} didn't load`));
  document.head.append(script);
});

// Has the page's styling reached this <pre>? Until it has, it measures as
// anything: the window's width, a line of the browser's own 13px text.
const styled = (pre) => getComputedStyle(pre).position === "absolute";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The shape of a glyph the planets are drawn in, as cosmos.js wants it: its
// width over its height. Measured in the font itself, once the page's styles
// and the font have both arrived (either one missing would measure whatever
// stands in for it), for up to 5 seconds of waiting for the styles.
async function glyphShape() {
  const probe = document.createElement("pre");
  probe.className = "planet";
  probe.style.visibility = "hidden";
  probe.textContent = `${"M".repeat(100)}\n`.repeat(10).trimEnd();
  sky.append(probe);
  for (let i = 0; i < 100 && !styled(probe); i++) await pause(50);
  const look = getComputedStyle(probe);
  await document.fonts.load(`${look.fontWeight} ${look.fontSize} ${look.fontFamily}`).catch(() => {});
  const { width, height } = probe.getBoundingClientRect();
  probe.remove();
  return width / 100 / (height / 10);
}

// A planet built for glyphs of this shape, and every glyph it covers at any
// angle. (cosmos.js turns away a shape no font has, and keeps the one it had.)
function build(planet, shape) {
  const { renderer } = planet;
  renderer.setAspect(shape);
  const body = renderer.build(planet.cfg, planet.grid);
  // every glyph the planet covers at any angle
  const covers = new Uint8Array(body.rows * body.cols);
  for (let i = 0; i < TURNS; i++) {
    renderer.render(body, (i / TURNS) * 2 * Math.PI).split("\n").forEach((line, row) => {
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
  Object.assign(planet, { body, covers, box });
}

const planets = [];
for (const { place, hue, side, across, at, rows, wide, ...settings } of PLANETS) {
  const pre = document.createElement("pre");
  pre.className = `planet ${place} ${hue}`;
  sky.append(pre);
  const renderer = await cosmos();
  const cfg = Object.assign(renderer.defaults(), settings);
  planets.push({ pre, renderer, cfg, grid: { rows, wide }, side, across, at, turn: cfg.speed * cfg.direction });
}
let built = await glyphShape();   // the shape the planets are built for
for (const planet of planets) build(planet, built);
built = planets[0].renderer.aspect();

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

// Every planet showing (or every one at all), turned to where it is at seconds.
let drawnAt = 0;
function draw(seconds, all = false) {
  drawnAt = seconds;
  for (const planet of planets) {
    if (all || !planet.pre.hidden) planet.pre.textContent = planet.renderer.render(planet.body, seconds * planet.turn);
  }
}

// The glyphs as they're really drawn, read off the biggest planet showing. If
// that isn't the shape the planets were built for, they're built again for
// the real one (and drawn, and the asteroids and stars placed again around
// them), and it says so.
function keepRound() {
  const planet = planets.filter((p) => !p.pre.hidden && styled(p.pre)).sort((a, b) => b.body.cols - a.body.cols)[0];
  if (!planet) return false;
  const { width, height } = planet.pre.getBoundingClientRect();
  const drawn = width / planet.body.cols / (height / planet.body.rows);
  if (!(drawn > 0.2 && drawn < 1.2) || Math.abs(drawn / built - 1) < SHAPE_SLACK) return false;
  for (const p of planets) build(p, drawn);
  built = planets[0].renderer.aspect();
  draw(drawnAt, true);
  placeAsteroids();
  placeStars();
  return true;
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
    if (keepRound()) return;
    placeAsteroids();
    placeStars();
  }, 150);
}).observe(sky);
draw(0);
placeAsteroids();
placeStars();
keepRound();   // before the first frame is on screen
document.fonts.addEventListener("loadingdone", keepRound);
setInterval(keepRound, RECHECK_MS);

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
