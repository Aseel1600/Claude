#!/usr/bin/env python3
"""
Premium fashion ad generator.
Renders a cinematic camera pull-back reveal over two static T-shirt images
(front + back). The T-shirt never moves; only the camera (zoom) moves.
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = "ad_frames"
os.makedirs(OUT, exist_ok=True)

W, H = 1920, 1080
FPS = 30

# ---- timeline (seconds) -----------------------------------------------------
SEG1_START, SEG1_END = 0.0, 4.5      # front pull-back
XF_START,  XF_END   = 4.5, 5.5      # crossfade front -> back
SEG2_START, SEG2_END = 5.5, 10.0    # back pull-back (hero)
TXT_START,  TXT_END  = 10.0, 12.5   # hold full back + brand text
DUR = 12.5

ZOOM1_S, ZOOM1_E = 1.55, 1.0        # front
ZOOM2_S, ZOOM2_E = 1.55, 1.0        # back

# ---- prepare 16:9 canvases (black bg, t-shirt centered) ---------------------
def to_canvas(path):
    im = Image.open(path).convert("RGB")
    im.thumbnail((W, H), Image.LANCZOS)
    canvas = Image.new("RGB", (W, H), (8, 8, 10))
    x = (W - im.width) // 2
    y = (H - im.height) // 2
    canvas.paste(im, (x, y))
    return canvas

FRONT = to_canvas("tshirt_img1.png")
BACK  = to_canvas("tshirt_img2.png")

# ---- fonts ------------------------------------------------------------------
def load_font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()

FONT_BIG = load_font("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf", 120)
FONT_SM  = load_font("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf", 54)
FONT_TNY = load_font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 40)

# ---- helpers ----------------------------------------------------------------
def crop_zoom(canvas, z):
    """Return 1920x1080 crop of canvas at zoom factor z (>=1), centered."""
    cw = int(W / z)
    ch = int(H / z)
    x0 = (W - cw) // 2
    y0 = (H - ch) // 2
    box = canvas.crop((x0, y0, x0 + cw, y0 + ch))
    return box.resize((W, H), Image.LANCZOS)

def vignette(img, strength=0.55):
    a = np.asarray(img).astype(np.float32)
    yy, xx = np.mgrid[0:H, 0:W]
    cx, cy = W / 2, H / 2
    d = np.sqrt(((xx - cx) / (W / 2)) ** 2 + ((yy - cy) / (H / 2)) ** 2)
    mask = np.clip((d - 0.45) / (1.0 - 0.45), 0, 1)
    mask = 1.0 - strength * mask
    a *= mask[..., None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))

def add_text(img, show, brand="PREMIUM", tag="ATELIER EDITION"):
    """show: 0..1 fade-in of the brand text block near the bottom."""
    if show <= 0:
        return img
    img = img.copy()
    draw = ImageDraw.Draw(img, "RGBA")
    alpha = int(255 * min(1.0, show))
    yb = int(H * 0.78)
    # thin rule
    rule_w = 260
    rx = (W - rule_w) // 2
    draw.line([(rx, yb - 40), (rx + rule_w, yb - 40)],
              fill=(255, 255, 255, alpha // 2), width=2)
    tw = draw.textlength(brand, font=FONT_BIG)
    draw.text(((W - tw) / 2, yb - 20), brand, font=FONT_BIG,
              fill=(255, 255, 255, alpha))
    sw = draw.textlength(tag, font=FONT_SM)
    draw.text(((W - sw) / 2, yb + 120), tag, font=FONT_SM,
              fill=(200, 200, 205, int(alpha * 0.85)))
    return img

def lerp(a, b, t):
    return a + (b - a) * t

def ease(t):
    # smoothstep
    return t * t * (3 - 2 * t)

# ---- render -----------------------------------------------------------------
n = int(round(DUR * FPS))
total_sec = DUR

for i in range(n):
    t = i / FPS
    # determine source frame (blend front/back where needed)
    if t <= XF_START:
        src = FRONT
        mix = 0.0
    elif t >= XF_END:
        src = BACK
        mix = 1.0
    else:
        mix = ease((t - XF_START) / (XF_END - XF_START))
        src = None  # blend below

    # zoom factor
    if t < SEG1_END:
        zt = (t - SEG1_START) / (SEG1_END - SEG1_START)
        z = lerp(ZOOM1_S, ZOOM1_E, ease(max(0.0, min(1.0, zt))))
    elif t >= SEG2_START:
        zt = (t - SEG2_START) / (SEG2_END - SEG2_START)
        z = lerp(ZOOM2_S, ZOOM2_E, ease(max(0.0, min(1.0, zt))))
    else:  # during crossfade, ease zoom across as well
        zt = (t - XF_START) / (XF_END - XF_START)
        z = lerp(1.0, 1.55, zt)

    if src is not None:
        frame = crop_zoom(src, z)
    else:
        f = crop_zoom(FRONT, z)
        b = crop_zoom(BACK, z)
        frame = Image.blend(f, b, mix)

    frame = vignette(frame)

    # brand text fade in during final hold
    if t >= TXT_START:
        show = (t - TXT_START) / (TXT_END - TXT_START)
        frame = add_text(frame, show=show)

    p = os.path.join(OUT, f"f{i:05d}.png")
    if os.path.exists(p):
        continue
    frame.save(p)

print("rendered", n, "frames")
