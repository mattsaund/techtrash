# techtrash.org

## The idea

> Techtrash opens up to the XP emulated website of techtrash.org in Internet
> Explorer, fullscreened. The user can minimize or close the window and use
> the XP emulated website like a big easter egg. The art is, the XP OS is
> shared amongst all visitors: if you create a file everyone can see it, if
> you draw a picture everyone can see it, if you change the theme everyone can
> see it. The blog documents my path and journey to becoming a contributor to
> human spaceflight and sciences for humanity. I also use it to talk about my
> interests in space, coding, science, music, traveling, the outdoors, etc.,
> with funny, lighthearted jokes and stuff.

So there are two sites here, one inside the other:

- **The website**, techtrash.org itself: my blog, in an Internet Explorer
  window, maximized, on every visit. Its own look (see "The website").
- **The desktop** behind it, a Windows XP that everyone shares, for whoever
  closes the window.

On the desktop:

- **The desktop icons are my pages.** For now that's just the
  **Techtrash.org blog**, a shortcut to the website, which covers everything.
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
public/pages/<id>/           My pages, one folder each: blog, the website (see
                             "The website" and "The blog")
public/pages/blog/site.css   The website's look
public/pages/blog/blog.js    Its pages: the front page (Home, the Blog,
                             Pictures, About me), a blog, and the admin's
                             editor page
public/pages/blog/editor.js  The admin's editor
public/pages/blog/live-markdown.js  Its Markdown, written live (as Obsidian does)
public/pages/blog/history.js  Its own Undo and Redo
public/pages/blog/content.js What a blog is made of: cleaning it, its players,
                             Markdown
public/pages/blog/comments.js  A blog's comments and their threads
public/pages/blog/util.js    Small things the rest share
public/pages/blog/vendor/    marked, DOMPurify and turndown, copied unchanged
public/pages/blog/space.js   Its sky: stars, and planets drawn with cosmos.js
public/pages/blog/cosmos/    cosmos.js's planet renderer, copied unchanged
public/programs/<id>/        Programs: files (the File Browser), notepad
public/files/                Text files Notepad opens: credits.txt. And
                             create-mod-all.mrpack, the server's modpack
                             (see "The modpack")
public/404.html              XP's blue screen, for any address that isn't here
public/under-construction/   The same screen, for anything not built yet: point
                             an unfinished link at /under-construction/
public/css/bsod.css          ...both screens' look, and public/js/bsod.js their
                             "Press any key", which really works

public/js/apps.js            Every app in one list: its id, title, icon, and
                             whether it's a page or a program
public/js/desktop.js         The window manager, the start menu, the taskbar
public/js/icons.js           The desktop icons: selecting, dragging, snapping
public/js/grid.js            The grid's rules, used by the page and the server
public/js/shared.js          The line to the server that shares the desktop
public/js/session.js         The Welcome screen, logging on and off, who's on
public/js/app.js             Loaded by every app page (see "Windows")
public/js/shrink-image.js    Shrinks a picture before it's posted (from tcc.place)

public/css/tokens.css        The rules: every color, font, size, space, radius,
                             layer and wait on the site. The only file with raw
                             values in it.
public/css/xp.css            Base elements and the XP kit: windows, title bars,
                             buttons, fields, menus, the taskbar, desktop icons,
                             and the shell every app page sits in
public/css/desktop.css       The desktop page only: icon layer, window placement,
                             resize grips, start menu, Log Off, Welcome screen

public/fonts/                Tahoma, DejaVu Sans Mono and Paper Mono,
                             self-hosted, and their licenses (see
                             public/fonts/LICENSES.md)
public/img/icons/xp/         Windows XP's own icons (see "Icons")
public/styleguide/           /styleguide/: every rule, drawn with the kit itself

worker.js                    The server: which address goes where
server/desktop.js            The shared desktop (see "The shared desktop")
server/admin.js              The admin account (see "The admin")
server/blog.js               The blog: blogs, flags, drafts, comments, the site's own pages, pictures
server/http.js               Small helpers the rest share
wrangler.jsonc               The Worker's Cloudflare settings
tools/check_style.py         Enforces the rules. Run it before you push.
tools/make_fonts.py          Rebuilds public/fonts/ from Wine's Tahoma and DejaVu
tools/make_icons.py          Rebuilds public/img/icons/xp/ from XP's own icons
tools/make_modpack.py        Rebuilds public/files/create-mod-all.mrpack from
                             the Prism instance the server's mods are played in
```

## Running it locally

The whole thing, shared desktop included, needs Node:

```sh
npx wrangler dev                                   # http://127.0.0.1:8787
```

To log on as admin locally, put a user name and password in a `.dev.vars`
file next to `wrangler.jsonc` (it's gitignored, so it never leaves your
machine):

```
ADMIN_USERNAME=something
ADMIN_PASSWORD=something-long
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
5. On the Worker, **Settings → Variables and Secrets → Add**, type **Secret**:
   `ADMIN_USERNAME` and `ADMIN_PASSWORD`, the admin's log on (see "The
   admin"). Until both are there, nobody can log on as admin.

The first deploy creates the blog's database (D1) and picture store (KV) by
itself, as tcc.place's did. Durable Objects, D1 and KV all run on the free plan.

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
- **credits.txt** in the start menu (and **credits** at the foot of the
  website) opens in Notepad (`public/programs/notepad/`), titled
  `credits.txt - Notepad` as XP's would be. It credits everything on the site
  someone else made, and its addresses are links: the web's open in a new
  tab, and so do the site's own files (`/fonts/LGPL-2.1.txt`). Notepad opens any `.txt` in `public/files/`:
  `/#notepad/?file=credits.txt`. Start menu entries like it are `SHORTCUTS`
  in `public/js/apps.js`.
- **Arriving:** straight into the blog, maximized, every time. No Welcome
  screen: nothing stands between a visitor and the blog. A link into the
  site (`/#blog/liftoff`) opens it there; a link to another app (`/#files`) opens
  that too, in front of the blog.
- **Logging on:** the Welcome screen is only for after Log Off or Switch User.
  It has two users. **techtrash** is everyone: one click. **admin** is me: it
  opens a user name and password box under the name, as XP's password box
  did, with XP's green arrow to log on (see "The admin"). Either one shows
  "Loading your personal settings..." for a moment, then the desktop, and the
  start menu shows who's on. A tab that's logged off stays logged off through
  a reload (`sessionStorage`).
- **Logging off:** Start → Log Off asks first, with the screen gone gray behind
  the question, as XP's did. **Switch User** goes back to the Welcome screen
  with the windows left open. **Log Off** closes every window, shows "Saving
  your settings...", then the Welcome screen.
- **Without JavaScript** there's no Welcome screen and no desktop, just a list
  of the pages.

## The admin

Only I can post. Everyone else is the `techtrash` user and can read
everything. The admin logs on from the Welcome screen (Start → Log Off →
Switch User → admin) with a user name and password that live in the Worker's
secrets, `ADMIN_USERNAME` and `ADMIN_PASSWORD`, never in this repo. Set them
in the dashboard (step 5 of "Deploying") or with:

```sh
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD
```

`server/admin.js` does the rest:

- **Logging on** gets a cookie that says "admin" for 30 days, so a reload or a
  new tab is still the admin. It's signed with a key made from the user name
  and password, so changing either one logs every admin session out. Scripts
  on the page can't read it, and it's only sent with requests from this site.
- **Log Off or Switch User** as the admin ends the session.
- **Guessing:** 5 tries a minute per person (`LOGON_LIMITER`), and the
  comparison takes the same time however close a guess is.
- **Every post, change and delete** is checked on the server, whatever the
  page shows. The blog's forms and editor only appear for the admin as a
  convenience. And anything that changes something has to come from the site's
  own pages.

## The website

What every visit opens up to: `public/pages/blog/`, in a window the desktop
titles the way XP's Internet Explorer did (`Techtrash - Microsoft Internet
Explorer`, and `First launch - Techtrash - Microsoft Internet Explorer` on a
post). It isn't XP: it has its own look, after msaunders.dev, but multicolor
where msaunders.dev is all blue.

- **The look.** Black, Paper Mono, and see-through panels with hairline
  edges over a sky of planets and stars, and real buttons: an edge in a hue,
  black inside, and filled with the hue only when selected (the panel you're
  on, the sort that's picked). No top bar: the headline is the top, "Techtrash",
  a letter in each hue, then the tagline
  (the admin writes it on the site; until then it's the one in `index.html`),
  then four buttons, **Home**, **Blog**, **Pictures** and **About me**, that
  pick the panel under it (see "The blog"). The headline stays at the top of
  every page, a blog's and the editor's too (with **Blog** filled in), and
  those start with **Back**, up one: from a blog to the Blog, the way it was
  left (its flags, its sort).
- **The multicolor** is six hues (`--site-hue-1` to `-6`: red, orange,
  yellow, green, blue, violet), and nothing picks a color of its own: an
  element takes one through a `.hue-1` to `.hue-6` class, and everything
  inside it (links, buttons, a section's name, a card's edge) follows. A blog
  gets its hue from its number and keeps it on its card and its page, and so
  does a flag, wherever it shows.
- **The sky** is `space.js`: four planets and two asteroids (lumpy,
  potato-shaped rocks, tumbling) drawn with **cosmos.js**
  (github.com/mattsaund/cosmos.js), its renderer copied unchanged into
  `cosmos/`, and 150 stars in the six hues, the same on every visit. Each
  body gets a cosmos.js of its own (the script is run once for each): the
  renderer keeps the part of a frame that doesn't turn, its view cache, for
  one body at a time, so bodies sharing one would build it again every
  frame. Each is told the shape of a glyph as the browser really draws Paper
  Mono, measured once the page's styles and the font are in, so a round
  planet comes out round. That's checked again against the planets as
  they're drawn (after the first frame, when a font loads, when the window
  changes size, and every two seconds), and if they're drawn in any other
  shape, they're built again for it. A phone can run the script before its
  styles or its font have arrived, and the planets used to come out wide
  until the next page load. It stays
  put while the page scrolls over it, so everything in it is on screen from the
  start: a planet tucked into each corner of the window (its `.planet--N` rule
  in `site.css`). The asteroids keep to the strips of window beside the page,
  never over it: the red one up by the title box, the yellow one halfway down
  on the right (`side`, `across` and `at` in `PLANETS`), each as big as fits
  there, and left out where there's no room (a phone, a narrow window). Each
  planet is the cosmos.js editor's own settings (texture, zoom, tilt, rings,
  speed, seed) in `PLANETS`, with its frame (`rows` and `wide`, its width
  over its height), at twice the editor's rows and drawn at half size
  (`--site-art-scale`): the same planet, twice the detail. The ringed one's
  `zoom` is past 1, to cut its frame close around its rings as they lie.
  Its color is a hue class. The stars twinkle, each at its own pace, and never
  land on a planet: each planet is turned a full circle first to find every
  place it covers, rings and bumps included, and a star that would fall there
  goes somewhere else (again whenever the window changes size). The planets
  turn slowly; for anyone who's asked their computer for less motion, nothing
  moves.
- **The rules** are the same as everywhere: every value is a token, in their
  own section of `tokens.css` ("THE WEBSITE"). One font, Paper Mono (the face
  cosmos.js's editor is set in), for everything: form fields and code
  included, which a browser would otherwise give fonts of their own.
- **Type and spacing are msaunders.dev's**, set up the same way. Paper Mono
  is scaled (`size-adjust`) to an advance of exactly 0.625 em, so at sizes
  that are multiples of 8 every column lands on a whole pixel. Two sizes do
  everything: body 14/23 for all it says, and label 16/23 for anything that
  titles or labels; nothing is smaller. Then the headline, "Techtrash", 48/60
  tracked in 2px (40/48 in 1px on a phone), and a blog's title on its page,
  30/36 (msaunders.dev's smallest headline, a step over a blog's own
  headings). Weights are 400 and 500, and 700 for bold words in a blog and
  a planet's glyphs. What's in a blog is the admin's to size in the editor;
  its headings just start at 20/28 (H2), 16/23 (H3) and 14/23 (H4).
  Spacing is one gap, 16 (12 on a phone): between panels, from the window's
  top to the first, from the window's sides once the column reaches them,
  and under the last panel and the foot. Inside a panel, one inset all round,
  24 (16 on a phone), less 3 at the top and 2 at the bottom, because a line
  box is taller than its letters: that puts the letters as far from a
  panel's top and bottom as from its sides (measured, 24 to 26 everywhere).
  The headline's taller line box is trimmed more, and a panel that ends on a
  box (buttons, cards, pictures, a form) takes the 2 back. Between things in
  a panel, one step, 16; lines that belong together (a card's, a comment's,
  a list's items), 8. Panels are at most 1204 wide, msaunders.dev's, and
  cards sit three across, with msaunders.dev's 24 inset (16 on a phone). On a
  screen with a pixel for every pixel (1dppx) the planets' glyphs are drawn
  unhinted with a hairline of stroke (`--site-art-stroke`): hinting snaps
  Paper Mono's strokes away at that size, and the planets lose more than half
  their ink. (Everywhere finer, it draws them as JetBrains Mono, the font
  before it, did.) Only motion is different: the stars twinkle and the
  planets turn, where XP holds still.
- **The foot** is "🄯 Matthew Saunders" and **credits**. The copyleft sign is
  Paper Mono's own © turned around, since the font has no copyleft;
  **credits** opens the credits in Notepad, on the desktop.

## The blog

**Blogs**, their **flags**, **comments**, and the site's own words (the
tagline, the bulletin, Home's words, About me), all made, changed and deleted
on the site itself, logged on as admin. (Anyone can read, and comment.) A blog
can be about anything, and wears any number of flags saying what ("space",
"computers"), so the blog is the whole site: Home, the Blog and Pictures are
ways of looking at it.

Everything with words in it (blogs, the bulletin, the tagline, Home's words,
About me) is written in the same editor, `editor.js`, described under **A
blog** below. On the site, the admin's buttons for them say what they do:
**New blog**, **Edit blog**, **Edit homepage**, **Add bulletin** / **Edit
bulletin**, **Edit about me**, **Edit tagline**.

- **Home** is what the front page opens to, under the headline: the
  **bulletin** across the top, if there is one (one thing that matters right
  now: news, anything; no date, and only ever one), then **Home's words**,
  and down the right side the eight **newest blogs**: a title, and its flags
  under it, smaller (under Home, on a phone). The admin gets **Edit
  homepage**, and **Add bulletin** beside it while there's none; with one up,
  **Edit bulletin** and **Remove bulletin** (two clicks) under it.
- **The Blog** (`?blog`) is the same panel switched to every blog, the newest
  first, as cards: each with its first picture, the start of its words, the
  day it went up, how many comments, and its flags. **Sort by**, in the other
  corner from the panel's name: **Newest** (what it opens with), **Oldest**
  or **Most comments**. Under that, every flag a blog wears, a small button
  each: pick one and only the blogs with it show; pick more and it's the
  blogs with **any of them**, or, switched, **all of them**. **Clear** shows
  every blog again. The flags picked are in the address (`?flag/space/rockets`),
  so the Blog that way can be shared; the sort lasts as long as the tab. The
  admin also gets **New blog**, and their **drafts** over the rest.
- **Pictures** (`?pictures`) is the same panel switched to every picture
  posted to the site (the ones in blogs, the bulletin and About me), newest
  first, square, in a grid with no borders and no gaps. Each one opens the
  page it's on. Nothing to manage: a picture shows up when it's posted and
  goes when it's taken out. A draft's pictures wait until it's up.
- **About me** (`?about`) is the same panel switched to techtrash.org's own
  About page, separate from msaunders.dev: **Edit about me**. Until it's
  written, it says "Nothing here yet."
- **A blog** is written in the editor (`editor.js`).
  It writes three ways, switched at its top: **Rich text** (what you see is
  what the blog looks like), **Markdown**, or **HTML**, and what's written
  carries over from one to the next (whatever Markdown has no way to say, a
  hue, where a picture sits or how wide it is, stays as HTML in it). In Rich
  text: bold, italic, underline, strikethrough, code, headings, quotes, code blocks,
  lists, alignment, the six hues, links and dividers, with **Undo** and
  **Redo** of the editor's own (`history.js`): a snapshot after each change or
  burst of typing, so they always step back through what was really on
  screen (the browser's own would undo the wrong things, since the editor
  makes changes of its own). Whatever looks the browser leaves when words
  are joined or moved (a paragraph joined to a heading keeps the paragraph's
  size in a hidden span) go straight away, so what's shown is what's saved.
  Every line is a block of its own in every browser: Firefox makes a `<div>`
  after a heading, and can leave words in no line at all, and both become
  paragraphs, the cursor staying where it was. A line's alignment is kept the
  same from each browser too (Chrome writes it as a style, Firefox as an
  `align`; the post keeps it as a class). **Dividers, players and
  pictures on lines of their own** can't hold the cursor, only sit beside it:
  Backspace at the start of the line under one (or Delete at the end of the
  line above it) takes a divider out, and picks a picture or a player, which
  goes if it's pressed again (Firefox's own Backspace would throw away the
  line's words, or its heading). A click picks one too (a divider, on its line
  or just above or below it). The box always ends on a line to type on, so
  what's typed under the last divider or player goes under it.
  **Pictures**
  go anywhere, mid-text, as many as you like (several at once from the
  picture button, a paste or a drop), in any of the three ways, and are
  uploaded as they go in; click one to describe it, sit it small on the left,
  middle or right with the words around it, or move it **Up** or **Down** a
  line. **Words beside a picture:** choose **Left** or **Right** and the cursor
  goes right after it, to type beside it. A picture on a side is kept the
  first thing in its paragraph, so its words run beside it from its top edge
  (words typed in front of it would push it down under them), and one on a
  line of its own takes the next paragraph beside it. On a phone there's no
  room beside a picture, so the words go under it. **A video's or a song's link** on its own line (the **video** button,
  or paste it on an empty line) becomes its player, with its own **Up**,
  **Down**, **Reset size** and **Remove**: YouTube, Vimeo, Dailymotion,
  Twitch, Streamable, Loom, TikTok, Spotify, SoundCloud, Apple Music, or a
  link to a video or sound file. **Sizes:** click a picture (or a player's
  bar, under it) and drag any of its corners to make it bigger or smaller. It
  keeps its shape (a song's player only gets wider) and never gets wider than
  the column, so on a phone it fits; **Reset size** puts it back. The post
  keeps a picture's width as its `width`, and a player's as `data-width` on
  its link's line. **A Markdown file** comes in from the `.md` button or dropped on
  the box, and its `# Title` becomes the blog's title. Anything pasted from
  another page keeps its formatting but not its looks. Ctrl+K makes a link.
  **Markdown is written live** (`live-markdown.js`), the way Obsidian shows
  it: the line the cursor's on is its Markdown, every character of it, and
  every other line is drawn the way it'll look, with its marks out of sight
  (a heading big, bold words bold, a link a link, a picture as the picture, a
  video's link as its player). Pictures and players are picked and sized the
  same way as in Rich text, and their size and place go into their line (a
  sized or placed picture becomes an `<img>` there). Enter carries a list or a
  quote on (Enter on an empty item ends it, with an empty line after it),
  Tab steps an item in, Ctrl+B and Ctrl+I make words bold or italic, and Undo
  and Redo are its own too. A line's end is a line break, as in Obsidian.
  Backspace at a line's start (or Delete at its end) only joins the two
  lines, beside a picture or a player too (the browsers' own would take the
  picture's line with it), and a line of dashes is always a divider (straight
  under a line of words, Markdown on its own would make those words a
  heading).
  **The space between paragraphs** is always the same: an empty line (cutting
  a whole paragraph leaves one behind, two Enters make one, and so does a
  heading picked for a line and left empty) goes as soon as the cursor's off
  it and something changes, none is ever saved, and any a blog already has
  isn't shown. Under the box is only its word count: anything that goes
  wrong (a picture that won't upload) is said under the Save button.
  Under the box, its **flags**: type one and press Enter (or a comma), and the
  ones other blogs wear are a click away under it; click one to take it off.
  And **Comments on**, or off.
- **Publishing and drafts.** **Publish** puts a blog up, dated that day.
  **Save draft** (or Ctrl+S) keeps it as a **draft** instead, to finish
  another time, and the editor stays open to go on with. A draft is the
  admin's alone: listed over the Blog for them, and nowhere else (not in the
  Blog, Home or Pictures, and not at its address for anyone else). It can be
  published from the editor or from its page; **Delete draft** throws it
  away. What's being written is also kept in the browser as it's typed until
  it's saved, so closing the window loses nothing.
- **Changing** a blog that's up is **Edit blog** on its page, any time: the
  editor again with everything in it (title, words, pictures, players, flags,
  the comments setting), then **Save changes** (Ctrl+S saves and stays). Its
  page says when it last changed. **Move to drafts** (two clicks, on its page
  or beside **Save changes** in the editor, where it saves the changes too)
  takes it down without losing anything, its comments included; published
  again, it keeps the day it first went up. **Delete blog** (two clicks) takes it, its comments, and
  any picture nothing else shows. The bulletin, the tagline, Home's words and
  About me are changed in place, the same way.
- **Comments** are anyone's, with a name, on a blog or in reply to another
  comment, so each one can start a thread (replies step in 4 deep, then line
  up). The admin's own are marked "author". **Turn comments off** on a blog's
  page and what's there stays; nobody can add more until they're back on. The
  admin can delete any comment: its words go, and replies under it stay. 5
  comments a minute per person (`COMMENT_LIMITER`), and a field only bots fill
  in turns them away.
- **Safety.** A blog's body is HTML, and it's cleaned by DOMPurify (to the
  short list of tags and classes in `content.js`) before it's saved and again
  every time it's shown, so nothing in it can run, whatever is in the
  database. Players are drawn from the link as the blog is shown; the blog
  only ever stores the link. Comments are plain text, shown as text.
- **The pages** have addresses that read like paths: the front page (Home),
  `?blog`, `?flag/<flag>/...`, `?pictures`, `?about`, a blog `?blog/<blog>`,
  and the admin's `?write` and `?edit/<blog>`, where a blog's and a flag's
  are their **slugs**, their names made fit for an address ("Daft Punk's
  best" is `daft-punks-best`, and a second blog by the same title gets `-2`).
  A blog's slug follows its title when the title changes. The address bar
  shows them as they are: `techtrash.org/#blog/liftoff`, `#flag/space` (see
  "Windows"). Older addresses are looked up and sent on to the new ones:
  `?post=3`, and from when blogs were in topics, `?blog/<topic>/<post>` (the
  blog) and `?blog/<topic>` (the topic's flag).
- **From topics to flags.** The first blogs were kept in topics. The first
  time this server runs on a database from then, it turns each topic into a
  flag its posts wear, and keeps every post (published, dated the day it was
  written), comment and picture, giving each post a slug of its own across
  the whole blog. The old topics table is left as it was, unused.
- **The server** is `server/blog.js`, the same way tcc.place's blog works:
  everything in the D1 database `DB` (the tables are made the first time
  they're needed), and pictures in the KV store `PICTURES`, served at
  `/blog/img/<name>`. A picture is shrunk in the browser before it's sent (at
  most 1920px, which also strips phone metadata like GPS), and the server
  checks it really is a picture from its first bytes.
- **Borrowed:** `vendor/marked.js` (Markdown to HTML, MIT),
  `vendor/turndown.js` and `vendor/turndown-plugin-gfm.js` (HTML to Markdown,
  MIT), and `vendor/purify.js` (DOMPurify, Apache 2.0 or MPL 2.0), copied
  unchanged, licenses beside them.

| | | |
|---|---|---|
| `GET /api/blog/posts[?limit=]` | anyone | every blog that's up, newest first, each with the start of its words, its first picture, its flags and how many comments (`limit`: just the newest few, up to 100) |
| `GET /api/blog/posts?drafts` | admin | every draft, the same way |
| `GET /api/blog/post?slug=` or `?id=` | anyone | a blog, its flags and its comments (a draft: the admin's only) |
| `POST /api/blog/posts` | admin | a new blog: `{ title, body, flags, comments, draft }`; says its slug |
| `PUT /api/blog/post?id=` | admin | any of `{ title, body, flags, comments, draft }` |
| `DELETE /api/blog/post?id=` | admin | a blog, its comments, and its pictures nothing else shows |
| `GET /api/blog/flags` | anyone | every flag a blog that's up wears, and on how many (the admin: drafts' flags too) |
| `GET /api/blog/pictures` | anyone | every picture posted to the site, newest first, each with where it's from |
| `POST /api/blog/pictures` | admin | a picture for a blog: a form with `picture`; says its address |
| `POST /api/blog/comments` | anyone | `{ post, parent, name, body }`, while the blog is up and its comments are on |
| `DELETE /api/blog/comment?id=` | admin | a comment's words (its replies stay) |
| `GET /api/blog/page?name=` | anyone | one of the site's own pages, `home`, `bulletin`, `about` or `tagline` (empty until it's written, or once it's taken down) |
| `PUT /api/blog/page?name=` | admin | `{ body }` (an empty one takes it down) |

## The modpack

`public/files/create-mod-all.mrpack` is the Create server's modpack, linked
from the bulletin: `https://techtrash.org/files/create-mod-all.mrpack`. It's a
Modrinth pack: a list of every mod, with its hashes and the address Modrinth
serves it from, so it's a few KB and hands out nobody's jars. It carries
nothing else (no configs, settings, worlds, resource packs or server list), so
importing it gives a fresh instance with the mods. Prism imports it from the
link (Add Instance, Import, paste it); the Modrinth App opens the file. The
CurseForge app can't read Modrinth packs.

`tools/make_modpack.py` makes it from the Prism instance the mods are played
in (`~/.local/share/PrismLauncher/instances/1.21.1 Create Mod All`). Every mod
has to have come from Modrinth through Prism's mod browser; the tool checks
each jar against Prism's record of it and has Modrinth confirm every file by
its hash before it writes anything. After changing the mods: run
`python3 tools/make_modpack.py`, and push.

## Windows

Every app is a plain HTML page of its own (`public/pages/blog/index.html`), and
a window shows it in an iframe. That keeps apps apart: Paint or a game can have
all the code it wants without touching the desktop or anything else, and each
one can be written and tested by opening its page.

- **Addresses.** The address bar follows the window in front:
  `techtrash.org/#files`, and as an app moves around inside itself,
  `#files/some/page/?x=1`. The site itself is plainer, since it is the site:
  its front page is the plain `techtrash.org`, and its pages' addresses read
  like paths (`?blog/liftoff`), so the address bar shows them as they
  are: `#blog`, `#pictures`, `#blog/liftoff`. The old way,
  `#blog/?post=3`, still works and tidies itself up. Anything in front can be copied and shared, and opening that address
  opens that window. An app page opened on its own (a
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

(The desktop's type. The website has its own: see "The website".)

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
- **No animation** on the desktop. Hover and press states change instantly, as
  XP's did. The one pause is `--wait` (800ms), the moment XP spent loading or
  saving your settings. (The website inside the Internet Explorer window is
  the web, not XP: its stars twinkle and its planets turn.)
- **The hand cursor is for links** on the desktop. Buttons, menus, icons and
  title bars keep the arrow. (The website's buttons get the hand, as buttons
  on the web do.)
- **One drop shadow**, `--shadow-pop`, on menus, tooltips and the Log Off
  dialog. XP's windows cast none.
- **One breakpoint**, `--breakpoint` (640px). At and under it the screen is a
  phone and every window fills it. A media query can't read a token, so CSS
  writes the number out, and `tools/check_style.py` rejects any other.
