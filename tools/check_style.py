#!/usr/bin/env python3
"""
check_style.py : the style rules, enforced.

public/css/tokens.css is the only file allowed to hold a raw value. This
checks every other stylesheet, every <style> block and every style=""
attribute in public/, and lists everything that breaks a rule:

  - a color that isn't a token (#hex, rgb(), hsl(), a named color)
  - a length that isn't a token (px, em, rem, vh, ...). Zero is fine,
    and so are percentages and fr
  - a font-family, or a font shorthand, that isn't a --font-* token
  - a line-height that isn't a --lh-* token
  - a font-weight other than 400, 500 or 700
  - a z-index that isn't a --z-* token
  - a media query at any width but the breakpoint below, or at any
    resolution but the planets' (--site-art-coarse)
  - a var(--name) that nothing defines, which is almost always a typo
  - a color written into an HTML attribute (fill, stroke, bgcolor...)

Run it before you push. No output and exit 0 means clean.

    python3 tools/check_style.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "public"
TOKENS = SITE / "css" / "tokens.css"
SKIP_DIRS = {"fonts"}

# The one width a media query may name: --breakpoint in tokens.css. A media
# query can't read a custom property, so CSS writes the number out and this
# makes sure it's that number.
BREAKPOINTS = set(re.findall(r"--breakpoint:\s*([\d.]+px)", TOKENS.read_text()))
# ...and the one resolution: the screens the website's planets need a stroke on.
RESOLUTIONS = set(re.findall(r"--site-art-coarse:\s*([\d.]+dppx)", TOKENS.read_text()))
RESOLUTION = re.compile(r"(?<![\w.#-])(?:\d+\.?\d*|\.\d+)(?:dppx|dpi|dpcm|x)\b", re.I)
# XP is 400 and 700 (Tahoma has nothing between); the website is 400 and 500,
# and 700 for bold words in a post.
WEIGHTS = {"400", "500", "700", "inherit"}

HEX = re.compile(r"#[0-9a-f]{3,8}\b", re.I)
COLOR_FN = re.compile(r"\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(", re.I)
LENGTH = re.compile(
    r"(?<![\w.#-])-?(?:\d+\.?\d*|\.\d+)"
    r"(px|rem|em|pt|pc|cm|mm|in|q|ch|ex|vh|vw|vmin|vmax|dvh|dvw|svh|svw|lvh|lvw)\b",
    re.I,
)
VAR_USE = re.compile(r"var\(\s*(--[\w-]+)")
VAR_DEF = re.compile(r"(?<![\w-])(--[\w-]+)\s*:")
COMMENT = re.compile(r"/\*.*?\*/", re.S)
STRINGS = re.compile(r"url\([^)]*\)|\"[^\"]*\"|'[^']*'")
DECL = re.compile(r"([\w-]+)\s*:\s*([^;{}]+)(?=[;}]|$)")
MEDIA = re.compile(r"@media([^{]+)\{")
ATTR_COLOR = re.compile(r"\s(fill|stroke|stop-color|color|bgcolor|text|link|vlink|alink)\s*=\s*\"([^\"]*)\"", re.I)

NAMED = set("""
aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond
blue blueviolet brown burlywood cadetblue chartreuse chocolate coral
cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray
darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid
darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey
darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue
firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod
gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki
lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon
lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue
lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue
mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen
mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin
navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod
palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum
powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon
sandybrown seagreen seashell sienna silver skyblue slateblue slategray
slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet
wheat white whitesmoke yellow yellowgreen
""".split())


def blank_comments(text):
    """Comments out, line breaks kept, so line numbers still match the file."""
    return COMMENT.sub(lambda m: "\n" * m.group().count("\n"), text)


def check_value(prop, value):
    """Every rule broken by one declaration, as short messages."""
    problems = []
    prop = prop.lower()
    bare = STRINGS.sub("", VAR_USE.sub("var(", value)).strip()

    if HEX.search(bare) or COLOR_FN.search(bare):
        problems.append(f"raw color in {prop}: use a color token")
    else:
        named = NAMED.intersection(re.findall(r"[a-z]+", bare.lower()))
        if named:
            problems.append(f"named color '{sorted(named)[0]}' in {prop}: use a color token")
    for m in LENGTH.finditer(bare):
        if float(re.match(r"-?[\d.]+", m.group()).group()) != 0:
            problems.append(f"raw length '{m.group()}' in {prop}: use a --sp-* or size token")
    if prop == "font-family" and not re.fullmatch(r"var\(--font-[\w-]+\)|inherit", value.strip()):
        problems.append("font-family must be a --font-* token")
    if prop == "font" and value.strip() != "inherit" and "var(--font-" not in value:
        problems.append("font shorthand must name a --font-* token")
    if prop == "line-height" and not re.fullmatch(r"var\(--lh-[\w-]+\)|inherit", value.strip()):
        problems.append("line-height must be a --lh-* token")
    if prop == "font-weight" and value.strip().lower() not in WEIGHTS:
        problems.append(f"font-weight '{value.strip()}': only 400, 500 and 700")
    if prop == "z-index" and not re.fullmatch(r"var\(--z-[\w-]+\)|auto|inherit", value.strip()):
        problems.append("z-index must be a --z-* token")
    return problems


def check_css(text, start_line=1):
    """(line, message) for every problem in a stylesheet's text."""
    text = blank_comments(text)
    found = []
    for m in MEDIA.finditer(text):
        line = start_line + text.count("\n", 0, m.start())
        for w in LENGTH.finditer(m.group(1)):
            if w.group().lower() not in BREAKPOINTS:
                found.append((line, f"media query at '{w.group()}': the only breakpoint is {', '.join(sorted(BREAKPOINTS))}"))
        for r in RESOLUTION.finditer(m.group(1)):
            if r.group().lower() not in RESOLUTIONS:
                found.append((line, f"media query at '{r.group()}': the only resolution is {', '.join(sorted(RESOLUTIONS))}"))
    for m in DECL.finditer(text):
        line = start_line + text.count("\n", 0, m.start())
        for problem in check_value(m.group(1), m.group(2)):
            found.append((line, problem))
    return found


def uses(text, start_line=1):
    """(name, line) for every var() a stylesheet's text reads."""
    text = blank_comments(text)
    return {(m.group(1), start_line + text.count("\n", 0, m.start())) for m in VAR_USE.finditer(text)}


def main():
    files = [p for p in sorted(SITE.rglob("*"))
             if p.suffix in {".css", ".html"} and p.is_file()
             and not SKIP_DIRS.intersection(p.relative_to(SITE).parts)]
    defined = set(VAR_DEF.findall(blank_comments(TOKENS.read_text())))
    problems = []
    used = []

    for path in files:
        rel = path.relative_to(ROOT)
        text = path.read_text()
        if path.suffix == ".css":
            defined |= set(VAR_DEF.findall(blank_comments(text)))
            used += [(rel, line, name) for name, line in uses(text)]
            if path != TOKENS:
                problems += [(rel, line, msg) for line, msg in check_css(text)]
            continue

        # HTML: <style> blocks, style="" attributes, color attributes.
        for m in re.finditer(r"<style[^>]*>(.*?)</style>", text, re.S | re.I):
            line = text.count("\n", 0, m.start(1)) + 1
            defined |= set(VAR_DEF.findall(blank_comments(m.group(1))))
            problems += [(rel, ln, msg) for ln, msg in check_css(m.group(1), line)]
            used += [(rel, ln, name) for name, ln in uses(m.group(1), line)]
        for m in re.finditer(r"\sstyle\s*=\s*\"([^\"]*)\"", text, re.I):
            line = text.count("\n", 0, m.start()) + 1
            problems += [(rel, line, msg) for _, msg in check_css(m.group(1), line)]
            used += [(rel, line, name) for name, _ in uses(m.group(1))]
        for m in ATTR_COLOR.finditer(text):
            value = m.group(2).strip().lower()
            if value not in {"none", "currentcolor", "inherit"} and not value.startswith("url("):
                line = text.count("\n", 0, m.start()) + 1
                problems.append((rel, line, f"color in the {m.group(1)} attribute: style it with a token instead"))

    for rel, line, name in used:
        if name not in defined:
            problems.append((rel, line, f"var({name}) isn't defined anywhere"))

    for rel, line, msg in sorted(set(problems), key=lambda p: (str(p[0]), p[1], p[2])):
        print(f"{rel}:{line}: {msg}")
    if problems:
        print(f"\n{len(set(problems))} problem(s). Every raw value belongs in public/css/tokens.css.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
