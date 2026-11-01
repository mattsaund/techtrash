# fonts

The Tahoma and DejaVu files are built by `tools/make_fonts.py`. Don't edit them
by hand.

## paper-mono.woff2

Paper Mono, the website's face, copied unchanged from cosmos.js
(`web/fonts/paper-mono.woff2`): one variable file for every weight, 100 to
800. Copyright 2025 The Paper-Mono.Git Project Authors. SIL Open Font License
1.1: see `PaperMono-OFL.txt`. https://github.com/paper-design/paper-mono

## tahoma-latin.woff2, tahoma-bold-latin.woff2

Wine's Tahoma, from Wine 9.0 (Debian/Ubuntu package `fonts-wine`).
Copyright (c) 2004 Larry Snyder, based on Bitstream Vera Sans, copyright (c)
2003 Bitstream, Inc. Licensed under the GNU Lesser General Public License,
version 2.1 or later: see `LGPL-2.1.txt`. The source is `fonts/tahoma.sfd` and
`fonts/tahomabd.sfd` in Wine's repository, https://gitlab.winehq.org/wine/wine.

Both files are modified from the originals. Both are subset to Latin, and their
embedded bitmaps are removed. The bold file's outlines are also thickened: each
glyph is merged with a copy of itself shifted 180 units to the right. Modified
2026-09-28 by `tools/make_fonts.py`, which is the complete description of the
changes and rebuilds both files from Wine's.

## dejavu-sans-mono-latin.woff2

DejaVu Sans Mono 2.37 (package `fonts-dejavu-core`). Bitstream Vera license,
with DejaVu's changes in the public domain: see `DejaVu-LICENSE.txt`. Subset to
Latin, otherwise unmodified.
