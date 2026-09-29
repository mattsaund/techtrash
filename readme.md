# techtrash.org

A Windows XP desktop that everyone shares. Anyone who comes to the site logs on
to the same desktop, and what they move, everyone sees move. Over time people
will save things to it too, so it keeps changing: part art piece, part my blog
and my own place on the internet.

- **The desktop icons are my pages.** For now that's just the blog, which
  covers everything: posts, the journal, pictures, music, projects, tech,
  space, memes.
- **The start menu holds programs:** the File Browser now, and games, Paint
  and whatever else later.
- **The File Browser** is where everything saved on the site ends up, like
  pictures people make in Paint. It's on the desktop too, next to the blog.

Plain HTML, CSS and JS, and a small Cloudflare Worker for the shared parts. No
framework, no build step, no requests to anyone else's servers.

## Structure

Everything in `public/` is the site, and each file's address is its path inside
`public/`. Nothing outside `public/` is ever served.

```
public/index.html            The desktop: Welcome screen, icons, windows, start
                             menu, taskbar, Log Off
public/pages/<id>/           My pages, one folder each: blog
public/programs/<id>/        Programs: files (the File Browser), notepad
public/files/                Text files Notepad opens: credits.txt

public/js/apps.js            Every app in one list: its id, title, icon, and
                             whether it's a page or a program
public/js/desktop.js         The window manager, the start menu, the taskbar
public/js/icons.js           The desktop icons: selecting, dragging, snapping
public/js/grid.js            The grid's rules, used by the page and the server
public/js/shared.js          The line to the server that shares the desktop
public/js/session.js         The Welcome screen, logging on and off
public/js/app.js             Loaded by every app page (see "Windows")

public/css/tokens.css        The rules: every color, font, size, space, radius,
                             layer and wait on the site. The only file with raw
                             values in it.
public/css/xp.css            Base elements and the XP kit: windows, title bars,
                             buttons, fields, menus, the taskbar, desktop icons,
                             and the shell every app page sits in
public/css/desktop.css       The desktop page only: icon layer, window placement,
                             resize grips, start menu, Log Off, Welcome screen

public/fonts/                Tahoma and DejaVu Sans Mono, self-hosted, and their
                             licenses (see public/fonts/LICENSES.md)
public/img/icons/xp/         Windows XP's own icons (see "Icons")
public/styleguide/           /styleguide/: every rule, drawn with the kit itself

worker.js                    The server: the shared desktop (see below)
wrangler.jsonc               The Worker's Cloudflare settings
tools/check_style.py         Enforces the rules. Run it before you push.
tools/make_fonts.py          Rebuilds public/fonts/ from Wine's Tahoma and DejaVu
tools/make_icons.py          Rebuilds public/img/icons/xp/ from XP's own icons
```

## Running it locally

The whole thing, shared desktop included, needs Node:

```sh
npx wrangler dev                                   # http://127.0.0.1:8787
```

For a quick look at the pages without Node, any file server on `public/`
works. Icons still move, just only for you, and the console complains that it
can't reach the server:

```sh
python3 -m http.server 8788 --directory public     # http://127.0.0.1:8788
```

## Deploying

It's a Cloudflare Worker with static assets, the same setup as tcc.place, and
pushing to `main` deploys it. Cloudflare Pages can't run the Durable Object the
shared desktop lives in, so the Pages project gets swapped for a Worker, once:

1. **Workers & Pages → Create → Import a repository**, and pick this repo. The
   name must be `techtrash`, as in `wrangler.jsonc`. Leave the build command
   empty; the deploy command is `npx wrangler deploy`.
2. On the old Pages project, **Custom domains**: remove `techtrash.org`.
3. On the new Worker, **Settings → Domains & Routes → Add → Custom domain**:
   `techtrash.org`.
4. Delete the old Pages project.

Durable Objects run on the free plan.

## The shared desktop

`worker.js` runs one Durable Object, `Desktop`, and every open tab connects to it
over a WebSocket at `/api/desktop` (`public/js/shared.js`).

- **The grid.** Icons sit on a grid, like XP's desktop with Align to Grid on.
  A cell is `--icon-cell` (76px) square, and cells are counted from the top
  left: `[column, row]`. An icon nobody has moved sits in XP's column down the
  left. `public/js/grid.js` holds the grid's rules, and both the page and the
  server use it, so they always agree on which cells are free.
- **What it holds:** which cell each desktop icon is in. It sends that to a
  tab as it connects, passes a drag on to everyone else while it's happening
  (so they see the icon glide), and when the icon is let go it snaps it to a
  cell, saves it, and tells everyone where it landed.
- **Snapping.** A dropped icon goes to the nearest cell, or the nearest free
  one if another icon is there. A group snaps icon by icon, the one under the
  pointer first, and the cells the group is leaving count as free. If two
  people drop on the same cell at once, the server gives the second the
  nearest free one. If a tab goes away halfway through a drag, everyone else
  gets that icon back in its cell.
- **Screen sizes.** Counting from the top left means the desktop reads the
  same on every screen, as it did in Windows. A screen too small to have an
  icon's cell shows it in the nearest free cell it does have, without moving
  it for anyone else.
- **What it takes:** only icons it knows (`ON_DESKTOP` in `public/js/apps.js`),
  at two numbers each, held to the grid. Anything else is ignored, as is
  anything past 60 messages a second from one tab. The messages are listed at
  the top of `worker.js`.
- **Windows aren't shared.** Each visitor opens, moves and closes their own.

## The desktop

- **Icons:** a click selects, Ctrl+click adds or takes away, dragging across
  the bare desktop draws a selection rectangle, and dragging any selected icon
  moves all of them, snapping to the grid when they're let go. A selected
  icon's picture takes the selection blue, as XP's did. A label stops at two
  lines and shows in full while it's selected. A double-click opens; a tap
  opens straight away, and so does Enter.
- **credits.txt** in the start menu opens in Notepad (`public/programs/notepad/`),
  titled `credits.txt - Notepad` as XP's would be. It credits everything on
  the site someone else made. Notepad opens any `.txt` in `public/files/`:
  `/#notepad/?file=credits.txt`. Start menu entries like it are `SHORTCUTS`
  in `public/js/apps.js`.
- **Logging on:** a new tab starts at the Welcome screen, user `techtrash`.
  Clicking it shows "Loading your personal settings..." for a moment, then the
  desktop. A reload stays logged on (`sessionStorage`). A link to a window
  (`/#blog`) opens it behind the Welcome screen, ready when you log on.
- **Logging off:** Start → Log Off asks first, with the screen gone gray behind
  the question, as XP's did. **Switch User** goes back to the Welcome screen
  with the windows left open. **Log Off** closes every window, shows "Saving
  your settings...", then the Welcome screen.
- **Without JavaScript** there's no Welcome screen and no desktop, just a list
  of the pages, which all work on their own.

## Windows

Every app is a plain HTML page of its own (`public/pages/blog/index.html`), and
a window shows it in an iframe. That keeps apps apart: Paint or a game can have
all the code it wants without touching the desktop or anything else, and each
one can be written and tested by opening its page.

- **Addresses.** The address bar follows the window in front:
  `techtrash.org/#blog`, and as an app moves around inside itself,
  `#blog/some/page/?x=1`. Anything in front can be copied and shared, and
  opening that address opens that window. An app page opened on its own (a
  search result, an old link) sends the visitor to the desktop with itself
  open, at the same place. That's `public/js/app.js`.
- **Links inside an app.** A link to another app opens that app's window. A
  link to anywhere else on the site replaces the desktop, and a link off the
  site opens a new tab. Also `public/js/app.js`, so apps just write normal links.
- **Opening another app from code:** `window.top.desktop.open("blog")`, or
  `open("blog", "some/page/?x=1")`. It's how the File Browser will open what's
  saved in it.
- **Windows** open at 640 x 480, each one title bar down and across from the
  last. They move by the title bar, resize from any edge or corner, and
  minimize, maximize (or double-click the title bar) and close like XP's. The
  one in front has the bright title bar and the pressed taskbar button. One
  window per app: opening an app that's already open brings it forward.
- **On a phone** (640px and under) every window fills the screen and stays put.

### Adding a page or a program

1. Add a line to `public/js/apps.js`. `kind: "page"` puts it on the desktop
   (and the server starts sharing its icon), `kind: "program"` in the start
   menu, and a program with `desktop: true` on the desktop as well.
2. Make its folder: `public/pages/<id>/index.html` or
   `public/programs/<id>/index.html`, copied from another app. The folder's
   name has to be the id.
3. Add it to the `<noscript>` list in `public/index.html`, which is what
   someone without JavaScript (and a search engine) sees.
4. Give it XP's own icon for the job (see "Icons").

An app page loads `js/app.js` first, then `tokens.css` and `xp.css`, and its
`<body class="app">` is the window's body. Its `<title>` is the window's title.

## Icons

Every icon is Windows XP's own, and nothing else: no icon is drawn for the
site, and none comes from another set. They're Microsoft's, used knowing
they're not licensed for reuse, and credited in `public/files/credits.txt`.

`tools/make_icons.py` builds `public/img/icons/xp/` from two collections on
GitHub:

- **softwarehistorysociety/XPIcons**, XP's icons at 1024px, scaled down to
  96px: twice the biggest the site shows, so they're sharp on a high density
  screen, and about 10KB each.
- **ShizukuIchi/winXP**, for the two that aren't icons: the chess user
  picture, and the flag on the start button (cut to the flag itself).

To add one, find it in XPIcons, add a line to `ICONS` in the script, and run
it. The script's header has the one-time setup (it needs Pillow).

## The rules

`public/css/tokens.css` is law. It's the only file that may contain a color, a
length, a font name or a z-index. Everything else (every other stylesheet,
every `<style>` block, every `style=""`) says `var(--something)` and nothing
else. If a value you need isn't there, add it to `tokens.css` first, with a
comment saying what it's for. If it can't earn that comment, use one that's
already there.

```sh
python3 tools/check_style.py
```

That checks the whole site and lists every break: raw colors, raw lengths,
fonts, line heights and weights that aren't tokens, stray z-indexes, media
queries at the wrong width, and `var()`s that point at nothing. No output
means clean.

The look is Luna blue at XP's own pixel sizes. Wherever XP had a number, the
site uses it; the few places it's been rounded say so in `tokens.css`, and why.

### Color

Luna blue, taken from XP itself. Gradients, frame edges and glows are whole
tokens (`--title-active`, `--taskbar`, `--button-glow-hover`), so a component
never mixes its own.

| token | | for |
|---|---|---|
| `--desktop` | `#004e98` | the desktop, under any wallpaper |
| `--face` | `#ece9d8` | window bodies, dialogs, menu bars, status bars |
| `--paper` | `#ffffff` | anything read or typed into: documents, fields, menus |
| `--ink` | `#000000` | all text on face and paper |
| `--ink-muted` | `#5c5a51` | dates, captions, secondary lines |
| `--ink-disabled` | `#aca899` | disabled only, never for reading |
| `--link` | `#215dc6` | links |
| `--select` | `#316ac5` | selected items, menu hover, selected text |
| `--logon` | `#5a7edc` | the Welcome screen and the Log Off dialog |

The full set, with every chrome color, is in `tokens.css` and drawn on
`/styleguide/`.

### Type

Three faces, four sizes and one for the Welcome screen, two weights, and
nothing else.

- **Faces:** `--font-ui` (Tahoma) for everything, `--font-title` for window
  titles (also Tahoma, in bold), `--font-mono` (DejaVu Sans Mono) for Notepad,
  the command prompt and code.
- **Sizes**, each with one line height that always goes with it:

  | | size | line | for |
  |---|---|---|---|
  | `ui` | 11 | 13 | chrome only: menus, buttons, fields, labels, taskbar, icon labels |
  | `body` | 13 | 20 | anything read: posts, the journal, captions; window titles in bold |
  | `head` | 16 | 22 | a heading inside a document |
  | `big` | 20 | 26 | a document's one headline, the start button, a user's name on the Welcome screen |
  | `display` | 36 | 44 | the site's name on the Welcome screen, and nowhere else |

- **Weights:** 400 and 700.

11px is XP's own 8pt Tahoma. It's for chrome only, never for anything that's
read. Reading text stops at `--measure` (480px, about 75 characters) however
wide its window is.

The line heights aren't free. Each one centers its line on a whole pixel in
the fixed heights: 13 leaves 5 and 5 in a 23px button and 3 and 3 in a 21px
field, and 20 leaves 5 and 5 in the 30px title bar. Change one and check the
controls it sits in.

Tahoma is Wine's, self-hosted, and drawn to Tahoma's exact widths, so anyone
with the real Tahoma (every Windows and Mac) uses theirs and everyone else gets
a copy that wraps in the same places. Wine's bold is really its regular
outlines plus bitmaps a browser never draws, so `tools/make_fonts.py` thickens
it the way XP's fake bold did. Luna drew window titles in Trebuchet MS, which
can't be self-hosted; point `--font-title` at it to trade sameness for that.

### Spacing

Every margin, padding, gap and offset is one of eight:

`--sp-2` `--sp-4` `--sp-8` `--sp-12` `--sp-16` `--sp-24` `--sp-32` `--sp-48`

A 4px grid, with 2px as the half step for tight spots inside chrome. 12 is the
dialog margin (XP's was 11).

### Sizes

XP's control sizes, off the spacing grid on purpose: a 23px button is a
Windows button and a 24px one isn't. Space between things comes from the
spacing scale; the size of a thing comes from here.

| | px | |
|---|---|---|
| `--title-h` | 30 | title bar |
| `--caption` | 22 | minimize / maximize / close (XP's 21, rounded to center) |
| `--button-h` / `--button-w` | 23 / 75 | push button, and its minimum width |
| `--field-h` | 21 | text field, select |
| `--check` | 13 | checkbox, radio |
| `--taskbar-h` | 30 | taskbar |
| `--icon-s` / `-m` / `-l` | 16 / 32 / 48 | the only icon sizes |
| `--start-flag` | 20 | the flag on the start button, XP's own height |
| `--icon-cell` | 76 | a desktop icon with its label, and the desktop grid's cell, both ways (XP's 75, rounded to center) |
| `--window-w` / `--window-h` | 640 / 480 | a window when it opens |
| `--window-min-w` / `-min-h` | 320 / 160 | the smallest a window resizes to |
| `--grip` | 4 | how far in from a window's edge a drag resizes it |
| `--drag` | 4 | how far a press moves before it's a drag, not a click (XP's) |
| `--start-menu-w` | 380 | the start menu |
| `--logoff-w` | 312 | the Log Off dialog |
| `--logon-band-h` | 80 | the Welcome screen's top and bottom bands |
| `--hairline` | 1 | every border; anything thicker is a shadow |
| `--frame` | 3 | a window's blue frame |

Radii: 3px for controls, 8px for a window's top corners (never the bottom),
12px for the start button's end. Everything else is square.

### Layers

`--z-desktop` 0, `--z-icon` 1, `--z-window` 10 and up, `--z-taskbar` 1000,
`--z-menu` 1100, `--z-tip` 1200, `--z-dialog` 1500, `--z-logon` 2000. Nothing
else sets a z-index. Windows count up from `--z-window` as they're raised and
never reach the taskbar.

### Behavior

- **Scripts set geometry only:** where a window or an icon is, how big a
  window is, and what's in front. How anything looks is a class in `css/`, and
  every length or wait a script needs it reads from `tokens.css`.
- **No animation.** Hover and press states change instantly, as XP's did. The
  one pause is `--wait` (800ms), the moment XP spent loading or saving your
  settings.
- **The hand cursor is for links.** Buttons, menus, icons and title bars keep
  the arrow.
- **One drop shadow**, `--shadow-pop`, on menus, tooltips and the Log Off
  dialog. XP's windows cast none.
- **One breakpoint**, `--breakpoint` (640px). At and under it the screen is a
  phone and every window fills it. A media query can't read a token, so CSS
  writes the number out, and `tools/check_style.py` rejects any other.
