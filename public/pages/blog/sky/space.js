// The sky behind the website. Four planets and two asteroids made with
// cosmos.js (cosmos/planet.js, copied unchanged from
// github.com/mattsaund/cosmos.js), each turning slowly, and a scatter of
// twinkling stars in the six hues. The sky stays put while the page scrolls,
// so every planet is on screen from the start.
//
// Each body runs its own copy of the cosmos.js script, cache and all.
// cosmos.js caches the part of a frame that doesn't turn (its view cache) for
// one body at a time, so six bodies sharing one would rebuild it for every
// body on every frame.
//
// cosmos.js needs the shape of a glyph in the planets' real font (setAspect)
// to draw a round planet round. It's measured once the page's styles and the
// font have both arrived, then checked against the planets as actually drawn
// (keepRound) after the first frame, when a font loads, on resize, and every
// couple of seconds. If it's off (a phone can run this before its styles or
// font arrive, and the planets come out wide), they're rebuilt for the real
// one.
//
// Planets are drawn at twice the rows the editor would use, in glyphs half
// the size (site.css scales them by --site-art-scale). Same size on screen,
// twice the detail.
//
// The asteroids keep to the empty strips beside the page's column, as big as
// fits there, up to the planets' size. If a strip is too thin (a phone), the
// asteroid isn't drawn at all rather than covering the words.
//
// No star lands on a planet. Each planet is first turned a full circle to
// find every spot it ever covers (rings and lumps included), and stars stay
// off those. They're placed again on resize, since the planets move with the
// window.
//
// To change a planet, tune it in the cosmos.js editor (msaunders.dev/cosmos)
// and copy its settings into PLANETS under the same names. Three things come
// from the site instead: the frame (rows, doubled as above, and wide, its
// width over its height), the color (a hue class, so it stays one of the six)
// and the position (its .planet--N rule in site.css). zoom is the editor's
// setting too, but goes past 1 here. The ringed one's frame is cut close
// around its rings as they lie, the way it looked before cosmos.js started
// cutting every frame for rings at their widest.
//
// With reduced motion on, the sky stands still (no turning, no twinkling).

const PLANETS = [
  { place: "planet--1", hue: "hue-6", rows: 88, wide: 1.847, texture: "gas", zoom: 1.926, brightness: 1.3, rings: true, tilt: 0.42, roll: -0.35, speed: 0.05, seed: 1994 },
  { place: "planet--2", hue: "hue-2", rows: 60, wide: 1, texture: "lava", zoom: 1, brightness: 1.3, tilt: 0.20, roll: 0.30, speed: 0.08, seed: 20260929 },
  { place: "planet--3", hue: "hue-5", rows: 52, wide: 1, texture: "ice", zoom: 1, brightness: 1.3, tilt: 0.50, roll: 0.10, speed: 0.07, direction: -1, seed: 1969 },
  { place: "planet--4", hue: "hue-4", rows: 36, wide: 1, texture: "rock", zoom: 1, brightness: 1.3, craters: 22, lumpiness: 0.25, speed: 0.11, seed: 42 },
  // Two asteroids, lumpy potato-shaped rocks that tumble faster than the
  // planets turn. side is which side of the page, across is how far across
  // that strip from the window's edge (1 is up against the page), and at is
  // how far down the window.
  { place: "planet--5", hue: "hue-3", side: "right", across: 0.5, at: 0.42, rows: 51, wide: 1, texture: "rock", zoom: 1, brightness: 1.3, craters: 24, lumpiness: 1.5, tilt: 0.70, roll: 0.90, speed: 0.20, seed: 99942 },
  { place: "planet--6", hue: "hue-1", side: "left", across: 0.7, at: 0.12, rows: 51, wide: 1, texture: "rock", zoom: 1, brightness: 1.3, craters: 18, lumpiness: 1.7, tilt: 0.70, roll: 0.90, speed: 0.16, direction: -1, seed: 1221 },
];

const COSMOS = "/pages/blog/sky/cosmos/planet.js";
const STARS = 150;
const STAR_GLYPHS = [".", ".", ".", ".", ".", "+", "*"];
const STAR_SEED = 2026;   // the same sky on every visit
const FRAME_MS = 100;     // the planets turn slowly, so ten frames a second is plenty
const TURNS = 16;         // angles a planet is sampled at, to find all it covers
const CLEAR = 6;          // pixels a star keeps from a planet
const ROCK_AIR = 12;      // ...and an asteroid from the page's column and the window's edge
const ROCK_LEAST = 40;    // an asteroid smaller than this, in pixels, isn't drawn
const SHAPE_SLACK = 0.02; // how far (2%) the drawn glyph shape can drift from the one
                          // the planets were built for before they're rebuilt
const RECHECK_MS = 2000;  // ...and how often that's checked, whatever else happens

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

// A fresh cosmos.js, by running the script again. One at a time, so each
// window.Cosmos it leaves is caught before the next run replaces it.
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
// anything (the window's width, a line of the browser's own 13px text).
const styled = (pre) => getComputedStyle(pre).position === "absolute";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The shape of the planets' glyph as cosmos.js wants it, width over height.
// Measured in the real font once the page's styles and the font have both
// arrived (without either it would measure a stand-in). Waits up to 5 seconds
// for the styles.
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

// Builds a planet for glyphs of this shape and finds every glyph it covers at
// any angle. (cosmos.js ignores a shape no font has and keeps its old one.)
function build(planet, shape) {
  const { renderer } = planet;
  renderer.setAspect(shape);
  const body = renderer.build(planet.cfg, planet.grid);
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

// Puts each asteroid in its strip beside the page (where across and at say),
// as big as fits (up to the planets' size), or hides it if there's no room.
function placeAsteroids() {
  const page = document.querySelector(".page");
  const pad = parseFloat(getComputedStyle(page).paddingLeft);
  const column = page.getBoundingClientRect();
  const window_ = sky.getBoundingClientRect();
  const most = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--site-art-scale"));
  for (const rock of planets.filter((planet) => planet.side)) {
    const { pre, body, box } = rock;
    // its size before scaling, the frame's and the rock's in it (shown first,
    // since one hidden last time measures nothing)
    pre.hidden = false;
    const glyphWide = pre.offsetWidth / body.cols;
    const glyphTall = pre.offsetHeight / body.rows;
    const wide = (box.right - box.left) * glyphWide;
    const tall = (box.bottom - box.top) * glyphTall;
    const strip = rock.side === "left" ? column.left + pad : window_.width - (column.right - pad);
    const scale = Math.min(most, (strip - 2 * ROCK_AIR) / wide, (window_.height / 2 - ROCK_AIR) / tall);
    pre.hidden = !(scale * Math.max(wide, tall) >= ROCK_LEAST);
    if (pre.hidden) continue;
    // the rock's middle goes where it says in the strip, with all of it kept
    // inside the strip and the window
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

// Draws every planet showing (or all of them), turned to where it is at seconds.
let drawnAt = 0;
function draw(seconds, all = false) {
  drawnAt = seconds;
  for (const planet of planets) {
    if (all || !planet.pre.hidden) planet.pre.textContent = planet.renderer.render(planet.body, seconds * planet.turn);
  }
}

// Reads the real glyph shape off the biggest planet showing. If it isn't the
// shape the planets were built for, rebuilds them for it, redraws, places the
// asteroids and stars again, and returns true.
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

// Each star's look is fixed. Where it goes depends on where the planets are.
const looks = seeded(STAR_SEED);
const stars = Array.from({ length: STARS }, () => {
  const star = document.createElement("span");
  star.className = `star hue-${1 + Math.floor(looks() * 6)}`;
  star.textContent = STAR_GLYPHS[Math.floor(looks() * STAR_GLYPHS.length)];
  // its own twinkle speed and starting point
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

// Places everything again whenever the window's size changes. A scroll bar
// coming or going moves the page's column too.
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
