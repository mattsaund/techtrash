# techtrash.org

**See it here: https://techtrash.org**

My personal site. Hosts my blog, pictures, and anything else that I want.
It also emulates a Windows XP desktop that is shared with all visitors of the site.
If someone moves or saves something it's there for everyone.

## Files

```
public/                        the site, each file at its own path

public/index.html              the desktop (icons, windows, start menu, taskbar,
                               Welcome screen)
public/js/desktop.js           windows, the start menu, the address bar, the
                               wallpaper
public/js/icons.js             the desktop's icons
public/js/disk.js              the shared disk, as the page holds it
public/js/apps.js              every app, in one list
public/js/                     and the rest (the line to the server, menus,
                               XP's message box and dialogs, the C: drive,
                               logging on, the grid)
public/css/tokens.css          every color, size and font on the site, and the
                               only file allowed raw values
public/css/                    the XP kit, the desktop, Explorer, the blue
                               screen, the feed

public/pages/blog/             the website, inside Internet Explorer
public/pages/blog/blog.js      start here (which page the address asks for)
public/pages/blog/front.js     Home, Blog, Pictures, About me, and the Drafts
public/pages/blog/post.js      a blog, with comments.js under it
public/pages/blog/write.js     the admin's page for writing one
public/pages/blog/editor/      the editor (rich text, live Markdown, undo)
public/pages/blog/content.js   what a blog is made of (cleaning, players, Markdown)
public/pages/blog/viewer.js    the picture viewer
public/pages/blog/sound.js     the sound player
public/pages/blog/sky/         the planets and stars, drawn with cosmos.js

public/programs/               the File Browser (and the Recycle Bin), Notepad,
                               Paint, the Calculator, the Command Prompt, the
                               picture viewer, Windows Media Player, Mines,
                               Solitaire, Notepad++, Run, Display Properties,
                               Date and Time, the Control Panel, the Admin
                               Dashboard
public/img/icons/xp/           Windows XP's own icons
public/img/icons/games/        the two games' own icons
public/img/wallpapers/         Windows XP's own wallpapers
public/fonts/                  Tahoma, DejaVu Sans Mono, Paper Mono
public/files/                  credits.txt, and the Minecraft server's modpack
public/_headers                security headers, for every file
public/styleguide/             the XP kit, drawn (at /styleguide/)

worker.js                      the server (which address goes where)
server/desktop.js              the shared desktop
server/disk.js                 its disk, with everything anyone saves on it
server/admin.js                the admin's log on
server/blog.js                 blogs, drafts, flags, comments, pictures, sounds
server/feed.js                 /rss.xml
server/media.js                what kind of file something is, and sending part
                               of one, for both the blog and the disk
wrangler.jsonc                 the Worker's Cloudflare settings

tools/check_style.py           every value a token (run it before you push)
tools/make_icons.py            builds public/img/icons/xp/
tools/make_game_icons.py       builds public/img/icons/games/
tools/make_wallpapers.py       builds public/img/wallpapers/
tools/make_paint.py            builds public/programs/paint/jspaint/
tools/make_fonts.py            builds public/fonts/
tools/make_modpack.py          builds public/files/create-mod-all.mrpack
```

## Running it locally

```sh
npx wrangler dev                                # http://127.0.0.1:8787
```

To log on as the admin there, put a user name and a password in `.dev.vars`
(it's gitignored):

```
ADMIN_USERNAME=something
ADMIN_PASSWORD=something-long
```

## Deploying

It's a Cloudflare Worker, on the free plan, and pushing to `main` deploys it.
The first deploy makes its database (D1), its store for pictures and sounds
(KV) and the shared desktop (a Durable Object). The admin's log on is two
secrets, never in the repo, and the password is all that stands between the
internet and the blog, so make it long and random:

```sh
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD
```

## Licenses

My own code is MIT ([LICENSE](LICENSE)). What I did not write carries its own
terms, beside it:

```
public/img/icons/xp/           Windows XP's icons, Microsoft's, not covered by
                               the MIT License
public/img/wallpapers/         Windows XP's wallpapers, Microsoft's, not covered
                               by the MIT License
public/programs/paint/jspaint/ JS Paint (MIT) and the libraries it uses, each
                               under its own license
public/fonts/                  Tahoma (Wine's, LGPL 2.1), DejaVu Sans Mono
                               (Bitstream Vera), Paper Mono (SIL Open Font
                               License 1.1), see public/fonts/LICENSES.md
public/pages/blog/vendor/      marked and turndown (MIT), DOMPurify (Apache 2.0
                               or MPL 2.0)
public/pages/blog/sky/cosmos/  cosmos.js (MIT, same author)
```

Everyone's credited in public/files/credits.txt.
