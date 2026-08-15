#!/usr/bin/env python3
"""
Gate^Flame - Android launcher icon + splash generator.

WHY THIS EXISTS

All 26 PNGs under android/app/src/main/res/ have been corrupt since the first
public commit (67fefd8): the PNG signature byte 0x89 was replaced with U+FFFD
by a text-mode transfer, leaving `ef bf bd 50 4e 47`.

Note what this does NOT do: it does not break the build. aapt2 passes these
files through unchanged rather than rejecting them - verified by opening
GateFlame-Mobile-1.0.1-debug.apk and finding all 26 still corrupt INSIDE the
shipped APK. The real consequence is that the app installs with a broken
launcher icon and a broken splash screen.

Regenerating from vector geometry means no binary is ever copied through a text
path again - which is the mechanism that destroyed these, the gradle wrapper jar
and the release tarball.

BRAND

Colours sampled directly from Ionity_Global_Pty_LTD_Transparrent.png in the
ionity-assets repo:
    blue   #006FD3
    orange #FF8700
The mark is a gate (shield) in Ionity blue containing a flame in Ionity orange -
literally "Gate" + "Flame".

STATUS: build-correct, not design-reviewed. Replace with final artwork before
Play Store submission. The geometry lives here, so restyling or regenerating at
any size is one command.

Usage:  python scripts/generate_android_icons.py android/app/src/main/res
"""

import os
import sys

from PIL import Image, ImageDraw

BLUE = (0, 111, 211, 255)        # #006FD3
BLUE_DARK = (0, 78, 150, 255)
BLUE_MID = (0, 92, 176, 255)
ORANGE = (255, 135, 0, 255)      # #FF8700
ORANGE_LIGHT = (255, 183, 77, 255)

SS = 4  # supersample factor, downsampled with LANCZOS


def shield_path(w, h, inset):
    """Gate/shield outline as a polygon, normalised to the canvas."""
    l, r = inset, w - inset
    t, b = inset, h - inset
    shoulder = t + (b - t) * 0.62
    return [(l, t), (r, t), (r, shoulder), (w / 2, b), (l, shoulder)]


def flame_path(cx, cy, size):
    """
    An upward flame with an asymmetric, leaning tip and a bulbous base.

    A symmetric teardrop reads as a water droplet - wrong signal entirely for a
    security product. Real flame silhouettes lean, pinch at the waist and flare
    at the base, so the outline is built from two different curves.
    """
    s = size
    right = [
        (0.00, -1.00),   # tip
        (0.20, -0.72),
        (0.30, -0.34),
        (0.26, -0.02),
        (0.44, 0.34),
        (0.46, 0.62),
        (0.30, 0.84),
        (0.00, 0.92),
    ]
    left = [
        (-0.30, 0.84),
        (-0.46, 0.62),
        (-0.42, 0.30),
        (-0.22, -0.06),
        (-0.24, -0.40),
        (-0.14, -0.74),
    ]
    return [(cx + x * s, cy + y * s) for x, y in right + left]


def inner_flame_path(cx, cy, size):
    """The hot core - smaller, rounder, offset toward the base."""
    s = size
    pts = [
        (0.00, -1.00),
        (0.26, -0.44),
        (0.34, 0.14),
        (0.22, 0.56),
        (0.00, 0.70),
        (-0.22, 0.56),
        (-0.34, 0.14),
        (-0.26, -0.44),
    ]
    return [(cx + x * s, cy + y * s) for x, y in pts]


def draw_mark(size, *, bg=True, safe_zone=1.0):
    """
    Render the Gate^Flame mark at `size` px.

    safe_zone < 1.0 shrinks the artwork, for adaptive-icon foregrounds where
    only the centre 66/108 of the canvas is guaranteed visible.
    """
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if bg:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=BLUE_DARK)

    art = S * safe_zone
    off = (S - art) / 2

    d.polygon([(x + off, y + off) for x, y in shield_path(art, art, art * 0.14)], fill=BLUE)
    d.polygon([(x + off, y + off) for x, y in shield_path(art, art, art * 0.21)], fill=BLUE_MID)

    cx = off + art / 2
    cy = off + art * 0.50
    d.polygon(flame_path(cx, cy, art * 0.255), fill=ORANGE)
    d.polygon(inner_flame_path(cx, cy + art * 0.055, art * 0.145), fill=ORANGE_LIGHT)

    return img.resize((size, size), Image.LANCZOS)


def draw_round(size):
    S = size * SS
    base = draw_mark(size, bg=False).resize((S, S), Image.LANCZOS)
    circle = Image.new("L", (S, S), 0)
    ImageDraw.Draw(circle).ellipse([0, 0, S - 1, S - 1], fill=255)

    disc = Image.new("RGBA", (S, S), BLUE_DARK)
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(disc, (0, 0), circle)
    out.paste(base, (0, 0), base)

    final = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    final.paste(out, (0, 0), circle)
    return final.resize((size, size), Image.LANCZOS)


def draw_splash(w, h):
    img = Image.new("RGBA", (w, h), (11, 18, 32, 255))  # near-black navy
    mark = draw_mark(int(min(w, h) * 0.55), bg=False)
    img.paste(mark, ((w - mark.width) // 2, (h - mark.height) // 2), mark)
    return img


LAUNCHER = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
FOREGROUND = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
SPLASH = {
    "mdpi": (320, 480),
    "hdpi": (480, 800),
    "xhdpi": (720, 1280),
    "xxhdpi": (960, 1600),
    "xxxhdpi": (1280, 1920),
}


def save(img, path):
    """Write, then assert the bytes on disk are a real PNG.

    The assertion is the point: this file class has been silently destroyed
    three times in this repo. A generator that cannot detect its own corruption
    would just be a faster way to produce the same problem.
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "PNG", optimize=True)
    with open(path, "rb") as f:
        b = f.read()
    assert b[:8] == b"\x89PNG\r\n\x1a\n", f"BAD SIGNATURE written to {path}"
    assert b.count(b"\xef\xbf\xbd") == 0, f"U+FFFD present in {path}"
    return len(b)


def main(res):
    total = written = 0

    for dens, px in LAUNCHER.items():
        total += save(draw_mark(px), f"{res}/mipmap-{dens}/ic_launcher.png"); written += 1
        total += save(draw_round(px), f"{res}/mipmap-{dens}/ic_launcher_round.png"); written += 1

    for dens, px in FOREGROUND.items():
        # 66/108 safe zone - artwork outside it is masked off by some launchers
        total += save(
            draw_mark(px, bg=False, safe_zone=66 / 108),
            f"{res}/mipmap-{dens}/ic_launcher_foreground.png",
        ); written += 1

    for dens, (w, h) in SPLASH.items():
        total += save(draw_splash(w, h), f"{res}/drawable-port-{dens}/splash.png"); written += 1
        total += save(draw_splash(h, w), f"{res}/drawable-land-{dens}/splash.png"); written += 1

    w, h = SPLASH["mdpi"]
    total += save(draw_splash(w, h), f"{res}/drawable/splash.png"); written += 1

    print(f"wrote {written} PNGs, {total:,} bytes")
    print("all verified: valid PNG signature, zero U+FFFD")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "android/app/src/main/res")
