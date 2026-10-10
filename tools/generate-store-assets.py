#!/usr/bin/env python3
"""Generate Chrome Web Store assets for Unblock.

Run:  python tools/generate-store-assets.py

Outputs (into store/):
  icon-128.png        128x128   required store icon
  icon-512.png        512x512   store / social preview
  screenshot-1.png    1280x800  popup
  screenshot-2.png    1280x800  options page
  screenshot-3.png    1280x800  element picker
  small-tile.png      440x280   small promo tile
  marquee.png         920x280   promo marquee

Screenshots 1 and 2 are real captures (see tools/shot-ui.js); pass
--promo-only to regenerate only the icons and promo tiles without
overwriting those captures.
"""

import os
import sys
import time
from PIL import Image, ImageDraw, ImageFont

try:
    RESAMPLE = Image.Resampling.LANCZOS
except AttributeError:
    RESAMPLE = Image.LANCZOS

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
ICONS = os.path.join(ROOT, "icons")
OUT = os.path.join(ROOT, "store")

BG = (15, 20, 25, 255)
CARD = (22, 27, 34, 255)
CARD2 = (26, 32, 40, 255)
BORDER = (42, 58, 74, 255)
FG = (230, 237, 243, 255)
MUTED = (159, 179, 200, 255)
BRAND = (229, 57, 53, 255)

SS = 2  # supersample for screenshots


def font(size, bold=False):
    names = [
        "seguisb.ttf" if bold else "segoeui.ttf",
        "arialbd.ttf" if bold else "arial.ttf",
        "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf",
    ]
    for n in names:
        for base in (r"C:\Windows\Fonts", "/usr/share/fonts/truetype/dejavu", "/System/Library/Fonts"):
            p = os.path.join(base, n)
            if os.path.exists(p):
                try:
                    return ImageFont.truetype(p, size)
                except Exception:
                    pass
    return ImageFont.load_default()


def rr(d, box, r, fill=None, outline=None, width=1):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)


def text(d, xy, s, f, fill=FG, anchor=None):
    d.text(xy, s, font=f, fill=fill, anchor=anchor)


def save_promo(img, name):
    # Windows anti-virus / thumbnail services briefly lock freshly written
    # files; retry a few times before surfacing the error.
    path = os.path.join(OUT, name)
    for attempt in range(6):
        try:
            img.convert("RGB").save(path, optimize=True)
            print(name)
            return
        except OSError:
            if attempt == 5:
                raise
            time.sleep(0.25)


def build(w, h, painter):
    img = Image.new("RGBA", (w * SS, h * SS), BG)
    painter(ImageDraw.Draw(img), w * SS, h * SS)
    return img.resize((w, h), RESAMPLE)


# --------------------------------------------------------------- screenshot 1
def shot_popup(d, W, H):
    for i in range(H):
        t = i / H
        d.line([(0, i), (W, i)], fill=(int(15 + 6 * t), int(20 + 8 * t), int(25 + 10 * t), 255))

    s = 3
    pw, ph = 360 * s, 520 * s
    px, py = (W - pw) // 2, (H - ph) // 2
    rr(d, [px - 8, py - 8, px + pw + 8, py + ph + 8], 20 * s, fill=(0, 0, 0, 140))
    rr(d, [px, py, px + pw, py + ph], 16 * s, fill=CARD, outline=BORDER, width=2 * s)

    # header
    hd = 62 * s
    rr(d, [px, py, px + pw, py + hd], 16 * s, fill=CARD2)
    d.rectangle([px, py + hd - 20 * s, px + pw, py + hd], fill=CARD2)
    d.line([(px, py + hd), (px + pw, py + hd)], fill=BORDER, width=s)
    logo = Image.open(os.path.join(ICONS, "icon128.png")).convert("RGBA").resize((34 * s, 34 * s), RESAMPLE)
    d._image.alpha_composite(logo, (int(px + 16 * s), int(py + 14 * s)))
    text(d, (px + 60 * s, py + hd / 2), "Unblock", font(20 * s, True), FG, anchor="lm")
    rr(d, [px + pw - 118 * s, py + 17 * s, px + pw - 16 * s, py + 45 * s], 14 * s,
       fill=(229, 57, 53, 48), outline=(229, 57, 53, 120), width=s)
    text(d, (px + pw - 67 * s, py + 31 * s), "Blocking ON", font(13 * s, True), (255, 138, 133, 255), anchor="mm")

    y = py + hd + 22 * s
    # master switch row
    text(d, (px + 22 * s, y + 13 * s), "Enable blocking", font(15 * s, True), FG, anchor="lm")
    swx = px + pw - 76 * s
    rr(d, [swx, y, swx + 54 * s, y + 28 * s], 14 * s, fill=BRAND)
    d.ellipse([swx + 30 * s, y + 3 * s, swx + 51 * s, y + 24 * s], fill=(255, 255, 255, 255))
    y += 48 * s

    # button grid
    gap = 10 * s
    bw = (pw - 44 * s - gap) // 2
    bh = 38 * s
    labels = ["Whitelist site", "Pick element", "Reload tab", "Options"]
    for i, lb in enumerate(labels):
        bx = px + 22 * s + (i % 2) * (bw + gap)
        by = y + (i // 2) * (bh + gap)
        if i == 1:
            rr(d, [bx, by, bx + bw, by + bh], 9 * s, fill=BRAND)
            col = (255, 255, 255, 255)
        else:
            rr(d, [bx, by, bx + bw, by + bh], 9 * s, fill=CARD2, outline=BORDER, width=s)
            col = FG
        text(d, (bx + bw / 2, by + bh / 2), lb, font(14 * s, False), col, anchor="mm")
    y += bh * 2 + gap + 16 * s

    # toggles card
    th = 108 * s
    rr(d, [px + 22 * s, y, px + pw - 22 * s, y + th], 10 * s, fill=CARD2, outline=BORDER, width=s)
    for i, lb in enumerate(["Advanced defenses", "Heuristics", "Disable scriptlets for this site"]):
        ty = y + 24 * s + i * 30 * s
        rr(d, [px + 36 * s, ty - 9 * s, px + 50 * s, ty + 5 * s], 4 * s, fill=BRAND)
        text(d, (px + 36 * s, ty - 2 * s), "\u2713", font(11 * s, True), (255, 255, 255, 255), anchor="mm")
        text(d, (px + 60 * s, ty - 2 * s), lb, font(13 * s, False), MUTED, anchor="lm")
    y += th + 16 * s

    # whitelist card
    wh = 84 * s
    rr(d, [px + 22 * s, y, px + pw - 22 * s, y + wh], 10 * s, fill=CARD2, outline=BORDER, width=s)
    d.rectangle([px + 23 * s, y + 1 * s, px + pw - 23 * s, y + 28 * s], fill=(30, 37, 45, 255))
    text(d, (px + 36 * s, y + 15 * s), "WHITELISTED", font(11 * s, True), MUTED, anchor="lm")
    for i, dom in enumerate(["news-site.example", "video-site.example"]):
        ry = y + 48 * s + i * 26 * s
        text(d, (px + 36 * s, ry), dom, font(13 * s, False), FG, anchor="lm")
        rr(d, [px + pw - 96 * s, ry - 11 * s, px + pw - 36 * s, ry + 11 * s], 7 * s,
           outline=(229, 57, 53, 140), width=s)
        text(d, (px + pw - 66 * s, ry), "Remove", font(11 * s, True), (255, 138, 133, 255), anchor="mm")


def wrap(text_layer, xy, s, f, fill, maxw):
    x, y = xy
    for word in s.split(" "):
        w = text_layer.textlength(word + " ", font=f)
        if x + w > maxw:
            x, y = xy[0], y + f.size * 1.5
            w = text_layer.textlength(word + " ", font=f)
        text_layer.text((x, y), word, font=f, fill=fill)
        x += w
    return y + f.size * 1.9


# --------------------------------------------------------------- screenshot 2
def shot_options(d, W, H):
    for i in range(H):
        t = i / H
        d.line([(0, i), (W, i)], fill=(int(15 + 6 * t), int(20 + 8 * t), int(25 + 10 * t), 255))

    m = 60 * SS
    logo = Image.open(os.path.join(ICONS, "icon128.png")).convert("RGBA").resize((52 * SS, 52 * SS), RESAMPLE)
    d._image.alpha_composite(logo, (m, m))
    text(d, (m + 68 * SS, m + 14 * SS), "Unblock \u2013 Options", font(26 * SS, True), FG)
    text(d, (m + 68 * SS, m + 44 * SS), "Custom rules, whitelist, import & export", font(14 * SS, False), MUTED)

    bw, bh = 96 * SS, 36 * SS
    for i, lb in enumerate(["Save", "Export", "Import"]):
        bx = W - m - (3 - i) * (bw + 10 * SS)
        rr(d, [bx, m, bx + bw, m + bh], 9 * SS, fill=CARD2, outline=BORDER, width=SS)
        text(d, (bx + bw / 2, m + bh / 2), lb, font(14 * SS, True), FG, anchor="mm")

    y = m + 100 * SS
    gap = 16 * SS
    cw = (W - m * 2 - gap) // 2

    def card(x, y, w, h, title, lines, code=False):
        rr(d, [x, y, x + w, y + h], 12 * SS, fill=CARD, outline=BORDER, width=SS)
        text(d, (x + 20 * SS, y + 20 * SS), title, font(17 * SS, True), FG)
        ty = y + 54 * SS
        for ln in lines:
            d.rounded_rectangle(
                [x + 20 * SS, ty - 2 * SS, x + w - 20 * SS, ty + 24 * SS],
                radius=7 * SS, fill=(14, 18, 22, 255), outline=(50, 66, 82, 255), width=SS)
            text(d, (x + 32 * SS, ty + 4 * SS), ln, font(14 * SS, False), (180, 200, 220, 255))
            ty += 34 * SS

    card(m, y, cw, 300 * SS, "Custom Rules",
         ["##.sponsored", "###ad-banner", "||ads.example.com", "/banner/ads.js", "", "# comments allowed"])
    card(m + cw + gap, y, cw, 300 * SS, "Whitelisted Domains",
         ["example.com", "sub.example.com", "", "", ""])

    y2 = y + 300 * SS + gap
    card(m, y2, cw, 240 * SS, "Advanced Features",
         ["Scriptlets engine", "Element Picker", "Procedural cosmetic", "Extended DNR rulesets"])
    card(m + cw + gap, y2, cw, 240 * SS, "Import / Export",
         ["JSON settings export", "Raw rule text import", "No data leaves device", "MIT/GPLv3 licensed"])


# --------------------------------------------------------------- screenshot 3
def shot_picker(d, W, H):
    for i in range(H):
        t = i / H
        d.line([(0, i), (W, i)], fill=(int(18 + 8 * t), int(22 + 8 * t), int(28 + 10 * t), 255))

    # fake page content
    d.rectangle([0, 0, W, 54 * SS], fill=(30, 36, 44, 255))
    text(d, (36 * SS, 27 * SS), "example-news-site", font(18 * SS, True), MUTED, anchor="lm")
    for i, (h, col) in enumerate([(120 * SS, CARD), (200 * SS, CARD2), (90 * SS, CARD)]):
        y = 54 * SS + 26 * SS + i * 26 * SS + h
    y = 90 * SS
    rr(d, [40 * SS, y, 420 * SS, y + 260 * SS], 10 * SS, fill=CARD, outline=BORDER, width=SS)
    text(d, (60 * SS, y + 24 * SS), "Headline article goes here", font(20 * SS, True), FG)
    yy = y + 66 * SS
    for _ in range(6):
        d.rounded_rectangle([60 * SS, yy, 400 * SS, yy + 12 * SS], radius=6 * SS,
                            fill=(48, 62, 76, 255))
        yy += 26 * SS

    # ad slot being hovered (highlighted)
    ax, ay, aw, ah = 460 * SS, 90 * SS, 400 * SS, 250 * SS
    rr(d, [ax, ay, ax + aw, ay + ah], 8 * SS, fill=(229, 57, 53, 60), outline=(229, 57, 53, 255), width=3 * SS)
    text(d, (ax + aw / 2, ay + ah / 2 - 12 * SS), "Sponsored", font(17 * SS, True), (255, 170, 166, 255), anchor="mm")
    text(d, (ax + aw / 2, ay + ah / 2 + 16 * SS), "div#ad-slot", font(14 * SS, False), (255, 200, 198, 255), anchor="mm")
    text(d, (ax + aw / 2, ay - 22 * SS), "294 \u00d7 250", font(13 * SS, False), (255, 150, 146, 255), anchor="mm")

    # more page filler
    y2 = 380 * SS
    for i in range(3):
        rr(d, [40 * SS, y2 + i * 70 * SS, 40 * SS + 820 * SS, y2 + 40 * SS + i * 70 * SS],
           8 * SS, fill=CARD, outline=BORDER, width=SS)

    # toolbar
    tw, th = 620 * SS, 62 * SS
    tx, ty = (W - tw) // 2, H - th - 44 * SS
    rr(d, [tx - 4, ty - 4, tx + tw + 4, ty + th + 4], 14 * SS, fill=(0, 0, 0, 150))
    rr(d, [tx, ty, tx + tw, ty + th], 11 * SS, fill=(31, 31, 31, 255), outline=(68, 68, 68, 255), width=SS)

    bx = tx + 14 * SS
    for lb, danger in [("Block element", False), ("Block parent", False), ("Undo", False)]:
        w = (len(lb) * 8 + 26) * SS
        rr(d, [bx, ty + 14 * SS, bx + w, ty + 48 * SS], 7 * SS, fill=(43, 43, 43, 255),
           outline=(68, 68, 68, 255), width=SS)
        text(d, (bx + w / 2, ty + 31 * SS), lb, font(13 * SS, False), FG, anchor="mm")
        bx += w + 8 * SS

    bx += 10 * SS
    for lb in ["Cancel", "Exit"]:
        w = (len(lb) * 8 + 26) * SS
        rr(d, [bx, ty + 14 * SS, bx + w, ty + 48 * SS], 7 * SS,
           fill=(187, 51, 51, 255) if lb == "Exit" else (43, 43, 43, 255),
           outline=(187, 51, 51, 255) if lb == "Exit" else (68, 68, 68, 255), width=SS)
        text(d, (bx + w / 2, ty + 31 * SS), lb, font(13 * SS, False), FG, anchor="mm")
        bx += w + 8 * SS

    text(d, (tx + tw - 16 * SS, ty + 31 * SS), "div#ad-slot", font(13 * SS, True), (159, 179, 200, 255), anchor="rm")


# ------------------------------------------------------------------ promo art
def promo(w, h, kicker, title, sub):
    img = Image.new("RGBA", (w * SS, h * SS), BG)
    d = ImageDraw.Draw(img)
    for i in range(h * SS):
        t = i / (h * SS)
        d.line([(0, i), (w * SS, i)], fill=(int(12 + 10 * t), int(17 + 10 * t), int(22 + 12 * t), 255))

    logo = Image.open(os.path.join(ICONS, "icon512.png")).convert("RGBA")
    ls = int(min(w, h) * SS * 0.34)
    img.alpha_composite(logo.resize((ls, ls), RESAMPLE), (int(40 * SS), int((h * SS - ls) / 2)))

    # Text block starts after the logo and must stay inside the right margin.
    x0 = 40 * SS + ls + 34 * SS
    xmax = w * SS - 40 * SS
    cy = h * SS / 2

    def fitted(s, size, bold):
        # Shrink a font until the string fits the block width; never clip.
        f = font(size, bold)
        while x0 + d.textlength(s, font=f) + size > xmax and size > 10 * SS:
            size -= 2 * SS
            f = font(size, bold)
        return f, size

    # Badge pill: auto-sized to the text, text centered both ways.
    kf, _ = fitted(kicker, 13 * SS, True)
    kb = d.textbbox((0, 0), kicker, font=kf)
    kw = d.textlength(kicker, font=kf)
    kh = kb[3] - kb[1]
    padx, pady = 14 * SS, 6 * SS
    bcx = cy - 47 * SS
    box_h = kh + pady * 2
    bx = (x0, bcx - box_h / 2, x0 + kw + padx * 2, bcx + box_h / 2)
    rr(d, bx, int(min(box_h / 2, 15 * SS)), fill=(229, 57, 53, 46), outline=(229, 57, 53, 120), width=SS)
    d.text((bx[0] + padx + kw / 2, bcx), kicker, font=kf, fill=(255, 138, 133, 255), anchor="mm")

    # Title, then the description directly below it. Both auto-fit.
    tf, tsize = fitted(title, int(h * SS * 0.17), True)
    d.text((x0, cy - 6 * SS), title, font=tf, fill=FG, anchor="lm")
    sf, _ = fitted(sub, int(h * SS * 0.085), False)
    d.text((x0, cy + tsize * 0.90), sub, font=sf, fill=MUTED, anchor="lm")

    return img.resize((w, h), RESAMPLE)


def main():
    os.makedirs(OUT, exist_ok=True)

    for size, name in ((128, "icon-128.png"), (512, "icon-512.png")):
        Image.open(os.path.join(ICONS, f"icon{size}.png")).convert("RGBA").save(
            os.path.join(OUT, name), optimize=True)
        print(name)

    for i, (fn, painter) in enumerate(
        [("screenshot-1.png", shot_popup), ("screenshot-2.png", shot_options), ("screenshot-3.png", shot_picker)],
        1,
    ):
        build(1280, 800, painter).convert("RGB").save(os.path.join(OUT, fn), optimize=True)
        print(fn)

    save_promo(promo(440, 280, "MV3", "Unblock", "Lightweight content blocker"), "small-tile.png")
    save_promo(promo(920, 280, "MV3 CONTENT BLOCKER", "Unblock \u2014 ads, trackers, popups", "Blocks ads, popups and backdrop tabs before they open"), "marquee.png")


if __name__ == "__main__":
    if "--promo-only" in sys.argv:
        Image.open(os.path.join(ICONS, "icon128.png")).convert("RGBA").save(
            os.path.join(OUT, "icon-128.png"), optimize=True)
        print("icon-128.png")
        Image.open(os.path.join(ICONS, "icon512.png")).convert("RGBA").save(
            os.path.join(OUT, "icon-512.png"), optimize=True)
        print("icon-512.png")
        save_promo(promo(440, 280, "MV3", "Unblock", "Lightweight content blocker"), "small-tile.png")
        save_promo(promo(920, 280, "MV3 CONTENT BLOCKER", "Unblock \u2014 ads, trackers, popups", "Blocks ads, popups and backdrop tabs before they open"), "marquee.png")
        sys.exit(0)
    main()
