#!/usr/bin/env python3
"""Generate Unblock extension icons at every size required by the manifest.

Run:  python tools/generate-icons.py

Renders the brand mark (red shield + "U", matching docs/index.html) at
16/32/48/128/512 in two variants:
  iconNNN.png        -> enabled  (brand red shield + white u)
  iconNNN-gray.png   -> disabled (neutral gray shield + white u)

The outer/inner shield outlines are sampled from the SVG paths used on the
landing page. Every size is rendered from a 8x supersampled master and
downscaled with LANCZOS, so edges stay crisp and each file is exactly
NN x NN pixels.
"""

import os
from PIL import Image, ImageDraw, ImageFont

# Pillow renamed the resampling constants in 9.1 (module -> Image.Resampling).
# getattr keeps this readable without tripping type checkers on old versions.
_RESAMPLING = getattr(Image, "Resampling", None)
RESAMPLE = getattr(_RESAMPLING, "LANCZOS", None) or getattr(Image, "LANCZOS", None) or 1

SIZES = (16, 32, 48, 128, 512)
SS = 8  # supersample factor

BRAND = (229, 51, 51, 255)       # #E53333  outer shield (docs logo fill)
BRAND_DARK = (103, 21, 21, 255)  # #671515  inner shield
MUTED = (158, 158, 158, 255)     # #9E9E9E
MUTED_DARK = (117, 117, 117, 255)  # #757575
WHITE = (255, 255, 255, 255)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")

# Bold system fonts, tried in order (Windows / Linux / macOS). A real "U"
# glyph matches the landing-page logo letter instead of a hand-drawn shape.
_FONT_CANDIDATES = (
    ("C:/Windows/Fonts/arialbd.ttf", 700),
    ("C:/Windows/Fonts/segoeuib.ttf", 700),
    ("C:/Windows/Fonts/verdanab.ttf", 700),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 700),
    ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 700),
)
_NON_BOLD = ("regular", "book", "roman", "light", "medium", "thin", "italic")


def _find_bold_font(target):
    """Return a bold-true-type font sized to `target`, or None."""
    for path, size in _FONT_CANDIDATES:
        if not os.path.exists(path):
            continue
        try:
            ft = ImageFont.truetype(path, size)
        except OSError:
            continue
        style = " ".join(filter(None, ft.getname())).lower()
        if not any(tok in style for tok in _NON_BOLD):
            return ft
    return None


def bezier(p0, p1, p2, p3, steps=14):
    """Sample a cubic Bezier into a list of points."""
    pts = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        x = u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0]
        y = u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1]
        pts.append((x, y))
    return pts


def shield_polys(box):
    """Outer/inner shield polygons from the landing-page SVG path data."""
    s = box / 76.0
    outer = [(38, 4), (68, 14), (68, 37)]
    outer += bezier((68, 37), (68, 54), (56, 66), (38, 72))
    outer += bezier((38, 72), (20, 66), (8, 54), (8, 37))
    outer += [(8, 14), (38, 4)]
    inner = [(38, 9), (63, 17.5), (63, 37)]
    inner += bezier((63, 37), (63, 51), (53.5, 61), (38, 66.5))
    inner += bezier((38, 66.5), (22.5, 61), (13, 51), (13, 37))
    inner += [(13, 17.5), (38, 9)]
    return [[(px * s, py * s) for px, py in p] for p in (outer, inner)]


def _glyph_layer(size, color, ft):
    """Render a bold "U" glyph from a font, centered in the canvas."""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    bb = d.textbbox((0, 0), "u", font=ft)
    gw, gh = bb[2] - bb[0], bb[3] - bb[1]
    target_h = size * 0.36
    scale = target_h / gh if gh else 1.0
    ft = ft.font_variant(size=max(1, int(ft.size * scale)))
    bb = d.textbbox((0, 0), "u", font=ft)
    gw, gh = bb[2] - bb[0], bb[3] - bb[1]
    x = (size - gw) / 2 - bb[0]
    y = (size - gh) / 2 - bb[1]
    d.text((x, y), "u", font=ft, fill=color)
    return layer


def _solid_u(size, color):
    """Fallback letter U: two rounded legs joined by a solid bottom bowl."""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx = size / 2.0
    leg_w = size * 0.13
    radius = size * 0.14
    cy = size * 0.62
    y_top = cy - size * 0.22
    r = leg_w / 2.0
    d.rounded_rectangle([cx - radius, y_top, cx - radius + leg_w, cy], radius=r, fill=color)
    d.rounded_rectangle([cx + radius - leg_w, y_top, cx + radius, cy], radius=r, fill=color)
    d.pieslice([cx - radius, cy - radius, cx + radius, cy + radius], 0, 180, fill=color)
    return layer


def draw_u(size, color):
    """Solid "U" glyph (preferred: rendered from a bold font)."""
    ft = _find_bold_font(max(16, size // 5))
    if ft is not None:
        return _glyph_layer(size, color, ft)
    return _solid_u(size, color)


def render(size, outer_c, inner_c, glyph_c):
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    outer, inner = shield_polys(big)
    d.polygon(outer, fill=outer_c)
    d.polygon(inner, fill=inner_c)
    img.alpha_composite(draw_u(big, glyph_c))
    return img.resize((size, size), RESAMPLE)


def main():
    os.makedirs(OUT, exist_ok=True)
    for s in SIZES:
        on = render(s, BRAND, BRAND_DARK, WHITE)
        on.save(os.path.join(OUT, f"icon{s}.png"), optimize=True)

        off = render(s, MUTED, MUTED_DARK, WHITE)
        off.save(os.path.join(OUT, f"icon{s}-gray.png"), optimize=True)

        print(f"icon{s}.png / icon{s}-gray.png  {s}x{s}")


if __name__ == "__main__":
    main()