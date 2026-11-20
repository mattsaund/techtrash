// Background sky. cosmos.js planets and asteroids plus seeded, twinkling stars.
// cosmos/planet.js is copied unchanged from github.com/mattsaund/cosmos.js.
// Planets use 2x rows at half glyph size (--site-art-scale) for finer detail.
// Reduced motion stops the turning and twinkling.

// Settings from the cosmos.js editor (msaunders.dev/cosmos), same names. The
// site sets rows (2x the editor's), wide (width/height), hue and place (site.css).
// zoom can go past 1 here, unlike in the editor. planet--1's frame is cropped
// tight to its tilted rings, not to their widest like newer cosmos.js.
const PLANETS = [
  { place: "planet--1", hue: "hue-6", rows: 88, wide: 1.847, texture: "gas", zoom: 1.926, brightness: 1.3, rings: true, tilt: 0.42, roll: -0.35, speed: 0.05, seed: 1994 },
  { place: "planet--2", hue: "hue-2", rows: 60, wide: 1, texture: "lava", zoom: 1, brightness: 1.3, tilt: 0.20, roll: 0.30, speed: 0.08, seed: 20260929 },
  { place: "planet--3", hue: "hue-5", rows: 52, wide: 1, texture: "ice", zoom: 1, brightness: 1.3, tilt: 0.50, roll: 0.10, speed: 0.07, direction: -1, seed: 1969 },
  { place: "planet--4", hue: "hue-4", rows: 36, wide: 1, texture: "rock", zoom: 1, brightness: 1.3, craters: 22, lumpiness: 0.25, speed: 0.11, seed: 42 },
  // Asteroids. side is the strip beside the page. across runs from 0 (window
  // edge) to 1 (page edge), and at is the fraction down the window.
  { place: "planet--5", hue: "hue-3", side: "right", across: 0.5, at: 0.42, rows: 51, wide: 1, texture: "rock", zoom: 1, brightness: 1.3, craters: 24, lumpiness: 1.5, tilt: 0.70, roll: 0.90, speed: 0.20, seed: 99942 },
  { place: "planet--6", hue: "hue-1", side: "left", across: 0.7, at: 0.12, rows: 51, wide: 1, texture: "rock", zoom: 1, brightness: 1.3, craters: 18, lumpiness: 1.7, tilt: 0.70, roll: 0.90, speed: 0.16, direction: -1, seed: 1221 },
];

const COSMOS = "/pages/blog/sky/cosmos/planet.js";
const STARS = 150;
const STAR_GLYPHS = [".", ".", ".", ".", ".", "+", "*"];
const STAR_SEED = 2026;   // same sky every visit
const FRAME_MS = 100;     // 10 fps is plenty for slow turning
const TURNS = 16;         // angles sampled to find every cell a planet covers
const CLEAR = 6;          // px between a star and a planet
const ROCK_AIR = 12;      // px between an asteroid and the column or window edge
const ROCK_LEAST = 40;    // px, smaller asteroids are hidden
const SHAPE_SLACK = 0.02; // glyph aspect drift (2%) that triggers a rebuild
const RECHECK_MS = 2000;  // how often keepRound runs regardless

const sky = document.querySelector(".sky");
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

// mulberry32, seeded so the sky is the same every visit.
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- planets -------------------------------------------------------------------

// A fresh cosmos.js per body, since its view cache holds one body and sharing
// would rebuild it every frame. Sequential, so each window.Cosmos is caught
// before the next run replaces it.
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

// True once site.css applies. Until then the <pre> measures as unstyled text.
const styled = (pre) => getComputedStyle(pre).position === "absolute";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Glyph aspect (width over height) for setAspect, measured in the real font.
// Waits up to 5 s for site.css, then for the font.
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

// Builds for this glyph aspect and marks every cell covered at any angle, for
// star placement. cosmos.js ignores an impossible aspect and keeps the old one.
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
  // bounding box of the covered cells, in glyphs
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
// Planets are expensive. Wait for the page to draw (or 3 s), then build one per idle callback.
const drawn = new Promise((resolve) => {
  if (window.pageDrawn) resolve();
  addEventListener("pagedrawn", resolve, { once: true });
  setTimeout(resolve, 3000);
});
const idle = () => new Promise((resolve) => (window.requestIdleCallback ? requestIdleCallback(() => resolve(), { timeout: 3000 }) : setTimeout(resolve, 200)));
let built = await glyphShape();   // aspect the planets were built for
await drawn;
for (const planet of planets) {
  await idle();
  build(planet, built);
}
built = planets[0].renderer.aspect();

// Fits each asteroid in its strip, up to planet size. Hidden when the strip is
// too thin (phones) rather than covering text.
function placeAsteroids() {
  const page = document.querySelector(".page");
  const pad = parseFloat(getComputedStyle(page).paddingLeft);
  const column = page.getBoundingClientRect();
  const window_ = sky.getBoundingClientRect();
  const most = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--site-art-scale"));
  for (const rock of planets.filter((planet) => planet.side)) {
    const { pre, body, box } = rock;
    // unscaled frame and rock size (unhide first, a hidden one measures 0)
    pre.hidden = false;
    const glyphWide = pre.offsetWidth / body.cols;
    const glyphTall = pre.offsetHeight / body.rows;
    const wide = (box.right - box.left) * glyphWide;
    const tall = (box.bottom - box.top) * glyphTall;
    const strip = rock.side === "left" ? column.left + pad : window_.width - (column.right - pad);
    const scale = Math.min(most, (strip - 2 * ROCK_AIR) / wide, (window_.height / 2 - ROCK_AIR) / tall);
    pre.hidden = !(scale * Math.max(wide, tall) >= ROCK_LEAST);
    if (pre.hidden) continue;
    // center at across and at, clamped inside the strip and the window
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

// Renders visible planets (or all) at `seconds`.
let drawnAt = 0;
function draw(seconds, all = false) {
  drawnAt = seconds;
  for (const planet of planets) {
    if (all || !planet.pre.hidden) planet.pre.textContent = planet.renderer.render(planet.body, seconds * planet.turn);
  }
}

// Measures the glyph aspect on the largest visible planet. If it drifted from
// `built` (late CSS or font, seen on phones), rebuilds and re-places everything
// and returns true.
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

// Is (x, y) within CLEAR px of a covered cell?
function onPlanet(x, y, shapes) {
  for (const { rect, body, covers } of shapes) {
    if (x < rect.left - CLEAR || x > rect.right + CLEAR || y < rect.top - CLEAR || y > rect.bottom + CLEAR) continue;
    const across = rect.width / body.cols;   // glyph width on screen
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

// Star looks are fixed by the seed. Positions are redone when planets move.
const looks = seeded(STAR_SEED);
const stars = Array.from({ length: STARS }, () => {
  const star = document.createElement("span");
  star.className = `star hue-${1 + Math.floor(looks() * 6)}`;
  star.textContent = STAR_GLYPHS[Math.floor(looks() * STAR_GLYPHS.length)];
  // twinkle pace and phase (.star in site.css)
  star.style.setProperty("--pace", (0.6 + looks() * 0.9).toFixed(2));
  star.style.setProperty("--start", looks().toFixed(2));
  sky.append(star);
  return star;
});

function placeStars() {
  const { width, height } = sky.getBoundingClientRect();
  const shapes = planets.filter((planet) => !planet.pre.hidden).map((planet) => ({ ...planet, rect: planet.pre.getBoundingClientRect() }));
  // test the glyph's center, not its corner
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

// Re-place on resize, including a scrollbar appearing (it shifts the column).
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
