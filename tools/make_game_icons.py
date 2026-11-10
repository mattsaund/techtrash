#!/usr/bin/env python3
"""
Draws the icons for Solitaire and Mines into public/img/icons/games/.

The games are the site's own, not Microsoft's, so their icons are too. They're
drawn in XP's style, lit from the top left with a dark edge and a soft shadow,
at four times the size and then scaled down so the edges come out smooth.
They're MIT, like the rest of my code.

Needs pillow. In a throwaway virtualenv:

    python3 -m venv /tmp/iconenv
    /tmp/iconenv/bin/pip install pillow
    /tmp/iconenv/bin/python tools/make_game_icons.py
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "img" / "icons" / "games"
SIZE = 96          # the same as XP's icons on the site (tools/make_icons.py)
BIG = SIZE * 4     # drawn at this size first


def gradient(size, top, bottom, angle=90):
    """A box of color fading from top to bottom (or along another angle)."""
    w, h = size
    out = Image.new("RGBA", size)
    pixels = out.load()
    rad = math.radians(angle)
    dx, dy = math.cos(rad), math.sin(rad)
    span = abs(w * dx) + abs(h * dy) or 1
    for y in range(h):
        for x in range(w):
            t = min(1, max(0, ((x - (w if dx < 0 else 0)) * dx + (y - (h if dy < 0 else 0)) * dy) / span))
            pixels[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(top, bottom))
    return out


def rounded(size, radius):
    """A rounded box's mask."""
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius, fill=255)
    return mask


def shadow(layer, offset, blur, strength):
    """A soft shadow of whatever's on the layer, put under it."""
    alpha = layer.getchannel("A").point(lambda a: round(a * strength))
    ghost = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    ghost.putalpha(alpha)
    ghost = ghost.filter(ImageFilter.GaussianBlur(blur))
    moved = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    moved.alpha_composite(ghost, offset)
    moved.alpha_composite(layer)
    return moved


def heart(cx, cy, r):
    """A heart's outline, centered, r across from the middle to a side."""
    points = []
    for i in range(120):
        t = 2 * math.pi * i / 120
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        points.append((cx + x * r / 16, cy - y * r / 16))
    return points


def spade(draw, cx, cy, r, fill):
    """An upside-down heart with a stem."""
    draw.polygon([(x, 2 * cy - y) for x, y in heart(cx, cy, r)], fill=fill)
    draw.polygon([(cx, cy + r * 0.2), (cx - r * 0.45, cy + r * 1.25), (cx + r * 0.45, cy + r * 1.25)], fill=fill)


def letter_a(draw, x, y, h, width, fill):
    """An A from three strokes, its top at (x, y)."""
    w = h * 0.8
    draw.line([(x - w / 2, y + h), (x, y), (x + w / 2, y + h)], fill=fill, width=width, joint="curve")
    draw.line([(x - w * 0.27, y + h * 0.62), (x + w * 0.27, y + h * 0.62)], fill=fill, width=width)


# --- Solitaire, three cards fanned out ----------------------------------------

CARD = (156, 216)
EDGE = (84, 98, 128, 255)
RED = (214, 32, 43, 255)
BLACK = (27, 27, 27, 255)


def card(kind):
    """One card, standing up. kind is "back", "spade" or "heart"."""
    w, h = CARD
    face = gradient(CARD, (255, 255, 255, 255), (226, 233, 245, 255), angle=60)
    if kind == "back":
        # the game's own back, Luna blue and striped, in a white frame
        inner = gradient((w - 28, h - 28), (64, 130, 230, 255), (26, 74, 166, 255))
        stripes = ImageDraw.Draw(inner)
        for s in range(-h, w + h, 18):
            stripes.line([(s, 0), (s + h, h)], fill=(255, 255, 255, 46), width=6)
        face.paste(inner, (14, 14), rounded(inner.size, 8))
    else:
        ink = RED if kind == "heart" else BLACK
        draw = ImageDraw.Draw(face)
        letter_a(draw, 30, 18, 34, 9, ink)
        if kind == "heart":
            draw.polygon(heart(30, 74, 13), fill=ink)
            draw.polygon(heart(w / 2, h / 2 + 10, 50), fill=ink)
            shine = Image.new("RGBA", CARD, (0, 0, 0, 0))
            ImageDraw.Draw(shine).ellipse((w / 2 - 34, h / 2 - 24, w / 2 - 6, h / 2 - 6), fill=(255, 255, 255, 90))
            face.alpha_composite(shine.filter(ImageFilter.GaussianBlur(5)))
        else:
            spade(draw, 30, 72, 12, ink)
    out = Image.new("RGBA", CARD, (0, 0, 0, 0))
    out.paste(face, (0, 0), rounded(CARD, 18))
    ImageDraw.Draw(out).rounded_rectangle((0, 0, w - 1, h - 1), 18, outline=EDGE, width=5)
    return out


def solitaire():
    canvas = Image.new("RGBA", (BIG, BIG), (0, 0, 0, 0))
    pivot = (BIG / 2, BIG * 0.86)
    for kind, angle, shift in (("back", 24, -34), ("spade", 6, -6), ("heart", -14, 26)):
        layer = Image.new("RGBA", (BIG, BIG), (0, 0, 0, 0))
        layer.alpha_composite(card(kind), (round(BIG / 2 - CARD[0] / 2 + shift), round(pivot[1] - CARD[1] - 6)))
        layer = layer.rotate(angle, resample=Image.BICUBIC, center=pivot)
        canvas.alpha_composite(shadow(layer, (6, 8), 6, 0.35))
    return shadow(canvas, (10, 12), 12, 0.3)


# --- Mines, a raised tile with a flag on it -----------------------------------

def mines():
    canvas = Image.new("RGBA", (BIG, BIG), (0, 0, 0, 0))
    w, h, depth = 268, 238, 28
    x, y = (BIG - w) // 2, 70
    # the tile's side, then its top, in Luna blues and raised like a key
    side = gradient((w, h), (110, 146, 214, 255), (58, 92, 170, 255))
    canvas.paste(side, (x, y + depth), rounded((w, h), 30))
    top = gradient((w, h), (246, 250, 255, 255), (178, 202, 242, 255), angle=55)
    canvas.paste(top, (x, y), rounded((w, h), 30))
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((x + 8, y + 8, x + w - 9, y + h - 9), 24, outline=(255, 255, 255, 200), width=5)
    draw.rounded_rectangle((x, y, x + w - 1, y + h + depth - 1), 30, outline=(52, 82, 150, 255), width=5)
    draw.line([(x + 18, y + h), (x + w - 18, y + h)], fill=(52, 82, 150, 160), width=4)

    flag = Image.new("RGBA", (BIG, BIG), (0, 0, 0, 0))
    paint = ImageDraw.Draw(flag)
    mid = x + w / 2 - 34
    # the stand and the pole
    paint.rounded_rectangle((mid - 66, y + 180, mid + 66, y + 202), 6, fill=(52, 58, 64, 255))
    paint.rounded_rectangle((mid - 36, y + 162, mid + 36, y + 184), 6, fill=(52, 58, 64, 255))
    paint.rectangle((mid - 8, y + 18, mid + 8, y + 170), fill=(52, 58, 64, 255))
    paint.line([(mid - 3, y + 24), (mid - 3, y + 164)], fill=(140, 150, 160, 255), width=4)
    # the cloth, red, catching the light at its top
    cloth = [(mid + 7, y + 16), (mid + 140, y + 70), (mid + 7, y + 124)]
    left, top_y = mid + 7, y + 16
    red = gradient((134, 110), (255, 98, 98, 255), (176, 16, 26, 255), angle=70)
    mask = Image.new("L", red.size, 0)
    ImageDraw.Draw(mask).polygon([(px - left, py - top_y) for px, py in cloth], fill=255)
    flag.paste(red, (round(left), top_y), mask)
    paint.polygon(cloth, outline=(128, 10, 16, 255), width=4)
    canvas.alpha_composite(shadow(flag, (8, 6), 5, 0.3))

    # a mine by the tile's corner, so it reads as Mines and not just a flag
    bomb = Image.new("RGBA", (BIG, BIG), (0, 0, 0, 0))
    paint = ImageDraw.Draw(bomb)
    cx, cy, r = x + w - 30, y + h - 6, 46
    for i in range(8):
        a = math.pi * i / 4
        paint.line([(cx + math.cos(a) * r * 0.5, cy + math.sin(a) * r * 0.5), (cx + math.cos(a) * r * 1.32, cy + math.sin(a) * r * 1.32)],
                   fill=(30, 33, 38, 255), width=11)
    ball = gradient((2 * r, 2 * r), (98, 104, 114, 255), (16, 18, 22, 255), angle=50)
    bomb.paste(ball, (cx - r, cy - r), rounded((2 * r, 2 * r), r))
    shine = Image.new("RGBA", (BIG, BIG), (0, 0, 0, 0))
    ImageDraw.Draw(shine).ellipse((cx - r * 0.55, cy - r * 0.6, cx - r * 0.1, cy - r * 0.15), fill=(255, 255, 255, 200))
    bomb.alpha_composite(shine.filter(ImageFilter.GaussianBlur(4)))
    canvas.alpha_composite(shadow(bomb, (6, 6), 5, 0.35))
    return shadow(canvas, (10, 12), 12, 0.35)


def shrink(image):
    # with the color premultiplied by its alpha, so the edges don't go dark
    return image.convert("RGBa").resize((SIZE, SIZE), Image.LANCZOS).convert("RGBA")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, draw in (("solitaire.png", solitaire), ("mines.png", mines)):
        shrink(draw()).save(OUT / name, optimize=True)
        print(f"{name}: {(OUT / name).stat().st_size} bytes")
