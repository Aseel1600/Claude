#!/usr/bin/env python3
"""
RAXE NOTHING — animated ad video generator.
Builds a vertical 9:16 (1080x1920) brand ad from the 2 provided images using
Ken Burns (pan/zoom) motion, crossfades, cinematic grade + grain + vignette,
and styled text overlays. Frames are piped to ffmpeg (libx264) for the final MP4.
"""
import math, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# ----------------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------------
W, H = 1080, 1920                    # output canvas (9:16 vertical)
FPS   = 30
CROSS = 0.6                          # crossfade overlap (seconds)
D_A   = 5.0                          # scene A duration (front / RAXE logo)
D_B   = 5.0                          # scene B duration (back / NOTHING graphic)
D_C   = 5.0                          # scene C duration (end card)
TOTAL = D_A + D_B + D_C - 2 * CROSS  # ~13.8 s

BASE = os.path.dirname(os.path.abspath(__file__))
IMG_A = os.path.join(BASE, "_build", "images", "untitled_ChatGPT Images 2.0 Edit_2026-08-28_11-03-27.png")  # crouching back (NOTHING)
IMG_B = os.path.join(BASE, "_build", "images", "untitled_ChatGPT Images 2.0 Edit_2026-08-28_11-03-42.png")  # front (RAXE logo)

FONT_PATH = {
    "ant":  os.path.join(BASE, "_build", "fonts", "Anton-Regular.ttf"),
    "bebas":os.path.join(BASE, "_build", "fonts", "BebasNeue-Regular.ttf"),
    "osw":  os.path.join(BASE, "_build", "fonts", "Oswald.ttf"),
}

FFMPEG = os.path.join(BASE, "_build", "venv", "lib", "python3.11", "site-packages",
                      "imageio_ffmpeg", "binaries", "ffmpeg-linux-x86_64-v7.0.2")

# ----------------------------------------------------------------------------
# Master images (cover-crop source to exactly fill canvas height => room to pan)
# ----------------------------------------------------------------------------
def make_master(path):
    im = Image.open(path).convert("RGB")
    scale = H / im.height                      # cover: scale so height == canvas
    mw = int(round(im.width * scale))
    mh = int(round(im.height * scale))
    im = im.resize((mw, mh), Image.LANCZOS)
    return im

MASTER_A = make_master(IMG_A)   # back view  (~2400x1920)
MASTER_B = make_master(IMG_B)   # front view (~2400x1920)

def ease(t, mode="io"):
    t = max(0.0, min(1.0, t))
    if mode == "linear": return t
    if mode == "out":    return 1 - (1 - t) ** 3
    if mode == "in":     return t ** 3
    return 0.5 - 0.5 * math.cos(math.pi * t)          # smooth ease-in-out

def kb_frame(master, z, px, py):
    """Return np frame (H,W,3) KenBurns crop from the large master image."""
    mw, mh = master.size
    cw = float(W) / z
    ch = float(H) / z
    cw = min(cw, float(mw)); ch = min(ch, float(mh))
    cx = px * (mw - cw)
    cy = py * (mh - ch)
    x0 = int(round(cx)); y0 = int(round(cy))
    x1 = min(mw, x0 + int(round(cw)))
    y1 = min(mh, y0 + int(round(ch)))
    x0 = max(0, x0); y0 = max(0, y0)
    crop = master.crop((x0, y0, x1, y1)).resize((W, H), Image.LANCZOS)
    return np.asarray(crop)

# ----------------------------------------------------------------------------
# Scene text overlays
# ----------------------------------------------------------------------------
def font(name, size):
    return ImageFont.truetype(FONT_PATH[name], size)

def draw_text(ov, xy, txt, f, fill, anchor="mm", alpha=1.0, shadow=3, spread=2):
    """Draw text (with soft shadow) onto RGBA overlay at given alpha (in-place)."""
    if alpha <= 0.01: return
    a = int(max(0, min(255, int(alpha * 255))))
    # shadow
    sh = Image.new("RGBA", ov.size, (0, 0, 0, 0))
    ds = ImageDraw.Draw(sh)
    ds.text((xy[0] + shadow, xy[1] + shadow), txt, font=f, fill=(0, 0, 0, a), anchor=anchor)
    sh = sh.filter(ImageFilter.GaussianBlur(spread))
    ov.alpha_composite(sh)
    # main text
    txt_rgba = Image.new("RGBA", ov.size, (0, 0, 0, 0))
    dt = ImageDraw.Draw(txt_rgba)
    dt.text(xy, txt, font=f, fill=fill + (a,), anchor=anchor)
    ov.alpha_composite(txt_rgba)

def add_topbot_gradient(frame, top=0.55, bottom=0.35, strength=150):
    """Darken top/bottom for text legibility. frame: HxWx3 uint8 array."""
    h, w = frame.shape[:2]
    grad = np.zeros((h, w, 3), dtype=np.float32)
    top_n = int(h * top)
    bot_n = int(h * bottom)
    for i in range(top_n):
        t = 1.0 - (i / top_n) if top_n else 0
        grad[i, :, :] = (1.0 - t) * 0
    for i in range(bot_n):
        t = i / bot_n if bot_n else 0
        grad[h - bot_n + i, :, :] = (1.0 - t) * 0
    fr = frame.astype(np.float32)
    fr = fr * (1.0 - grad / 255.0 * (strength / 255.0))
    return fr.astype(np.uint8)

# ----------------------------------------------------------------------------
# Post process: vignette + grain + contrast
# ----------------------------------------------------------------------------
def build_vignette():
    yy, xx = np.mgrid[0:H, 0:W]
    cx, cy = W / 2, H / 2
    r = np.sqrt(((xx - cx) / (W / 2)) ** 2 + ((yy - cy) / (H / 2)) ** 2)
    v = 1.0 - 0.42 * np.clip(r ** 2.0, 0, 1.2)
    return v[..., None].astype(np.float32)

VIGNETTE = build_vignette()
_rng = np.random.default_rng(7)

def grade(frame, warm=False, contrast=1.06, grain=5.0):
    fr = frame.astype(np.float32)
    fr = fr * VIGNETTE
    if warm:
        fr[..., 0] *= 1.05; fr[..., 2] *= 0.97
    fr = (fr - 128.0) * contrast + 128.0
    if grain > 0:
        fr += _rng.normal(0, grain, fr.shape)
    return np.clip(fr, 0, 255).astype(np.uint8)

# ----------------------------------------------------------------------------
# Scene renderers  (local time 0..duration, returns HxWx3 np frame)
# ----------------------------------------------------------------------------
def scene_A(t):
    """Front portrait — slow push-in, 'RAXE' headline in lower band."""
    dur = D_A
    p = t / dur
    z   = 1.05 + 0.16 * ease(p, "io")          # 1.05 -> 1.21 push in
    px  = 0.5                                  # centered horizontally
    py  = 0.5 - 0.05 * ease(p, "io")           # drift up toward the face
    fr = kb_frame(MASTER_B, z, px, py)
    fr = add_topbot_gradient(fr, top=0.30, bottom=0.34, strength=150)
    fr = grade(fr, warm=True)
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ha = ease((p - 0.10) / 0.45, "out")
    draw_text(ov, (W / 2, 1420), "R A X E", font("ant", 200),
                   (248, 248, 248), anchor="mm", alpha=ha, shadow=5, spread=4)
    la = ease((p - 0.05) / 0.5, "out")
    dw = int(560 * la)
    if dw > 1:
        ic = (W - dw) // 2
        ImageDraw.Draw(ov).rectangle([ic, 1318, ic + dw, 1325], fill=(238, 90, 60, int(230 * la)))
    draw_text(ov, (W / 2, 1560), "PREMIUM  STREETWEAR", font("bebas", 58),
                   (238, 90, 60), anchor="mm", alpha=0.9 * ease((p - 0.20) / 0.4, "out"))
    fr = np.asarray(Image.alpha_composite(Image.fromarray(fr).convert("RGBA"), ov).convert("RGB"))
    return fr

def scene_B(t):
    """Back crouching pose — slow pan + reveal of the 'NOTHING' graphic."""
    dur = D_B
    p = t / dur
    z   = 1.16 - 0.13 * ease(p, "io")          # 1.16 -> 1.03 gentle zoom out
    px  = 0.42 + 0.16 * ease(p, "io")          # pan left -> right
    py  = 0.46 - 0.04 * ease(p, "io")
    fr = kb_frame(MASTER_A, z, px, py)
    fr = add_topbot_gradient(fr, top=0.30, bottom=0.22, strength=110)
    fr = grade(fr, warm=False, contrast=1.08)
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw_text(ov, (W / 2, 150), "R A X E", font("ant", 64),
                   (220, 220, 220), anchor="mm", alpha=0.55 * ease(p, "out"))
    ha = ease((p - 0.06) / 0.5, "out")
    draw_text(ov, (W / 2, H - 470), "N O T H I N G", font("ant", 150),
                   (242, 242, 242), anchor="mm", alpha=ha, shadow=5, spread=4)
    draw_text(ov, (W / 2, H - 300), "OWN  THE  DARK", font("bebas", 62),
                   (210, 210, 210), anchor="mm", alpha=0.9 * ease((p - 0.20) / 0.4, "out"))
    fr = np.asarray(Image.alpha_composite(Image.fromarray(fr).convert("RGBA"), ov).convert("RGB"))
    return fr

def scene_C(t):
    """End card — tight push on the logo, brand lockup + CTA."""
    dur = D_C
    p = t / dur
    z   = 1.22 + 0.12 * ease(p, "io")          # 1.22 -> 1.34
    px  = 0.5
    py  = 0.5 - 0.06 * ease(p, "io")
    fr = kb_frame(MASTER_B, z, px, py)
    fr = add_topbot_gradient(fr, top=0.30, bottom=0.34, strength=160)
    fr = grade(fr, warm=True, contrast=1.09, grain=4.0)
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    la = ease(p / 0.45, "out")
    draw_text(ov, (W / 2, H * 0.60), "RAXE", font("ant", 230),
                   (250, 250, 250), anchor="mm", alpha=la, shadow=6, spread=5)
    draw_text(ov, (W / 2, H * 0.60 + 188), "N O T H I N G", font("bebas", 76),
                   (238, 90, 60), anchor="mm", alpha=0.95 * ease((p - 0.15) / 0.4, "out"))
    ca = ease((p - 0.20) / 0.35, "out")
    if ca > 0:
        dw = int(360 * ca)
        ic = (W - dw) // 2
        ImageDraw.Draw(ov).rectangle([ic, int(H * 0.76), ic + dw, int(H * 0.76) + 3],
                                     fill=(255, 255, 255, int(200 * ca)))
    draw_text(ov, (W / 2, H * 0.81), "PREMIUM  STREETWEAR", font("bebas", 54),
                   (230, 230, 230), anchor="mm", alpha=ca)
    ca2 = ease((p - 0.32) / 0.35, "out")
    if ca2 > 0.05:
        box_w, box_h = 460, 116
        bx0 = W // 2 - box_w // 2; by0 = int(H * 0.87)
        bx1 = bx0 + box_w; by1 = by0 + box_h
        d = ImageDraw.Draw(ov)
        d.rounded_rectangle([bx0 - 4, by0 - 4, bx1 + 4, by1 + 4], radius=58,
                            outline=(0, 0, 0, int(180 * ca2)), width=12)
        d.rounded_rectangle([bx0, by0, bx1, by1], radius=58,
                            fill=(238, 90, 60, int(230 * ca2)))
        draw_text(ov, (W / 2, (by0 + by1) // 2), "SHOP NOW", font("ant", 66),
                       (10, 10, 10), anchor="mm", alpha=ca2)
    draw_text(ov, (W / 2, H * 0.955), "@RAXE.NOTHING", font("osw", 38),
                   (185, 185, 185), anchor="mm", alpha=0.8 * ease((p - 0.40) / 0.35, "out"))
    fr = np.asarray(Image.alpha_composite(Image.fromarray(fr).convert("RGBA"), ov).convert("RGB"))
    return fr

# ----------------------------------------------------------------------------
# Timeline + crossfade
# ----------------------------------------------------------------------------
def blend(a, b, w):
    return (a.astype(np.float32) * (1 - w) + b.astype(np.float32) * w).astype(np.uint8)

B_START = D_A - CROSS                # 4.4
C_START = (D_A + D_B) - 2 * CROSS    # 8.8

def render_frame(T):
    a = scene_A(min(T, D_A)) if T < D_A else None
    b = scene_B(max(0.0, T - B_START)) if T >= B_START else None
    c = scene_C(max(0.0, T - C_START)) if T >= C_START else None

    if a is not None and b is not None and T < B_START + CROSS:
        w = (T - B_START) / CROSS
        fr = blend(a, b, w)
    elif b is not None and c is not None and T < C_START + CROSS:
        w = (T - C_START) / CROSS
        fr = blend(b, c, w)
    elif c is not None:
        fr = c
    elif b is not None:
        fr = b
    else:
        fr = a
    return fr

# ----------------------------------------------------------------------------
# Full render -> ffmpeg
# ----------------------------------------------------------------------------
def render_video(out_path):
    nframes = int(round(TOTAL * FPS))
    cmd = [FFMPEG, "-y",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
           "-i", "-",
           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium",
           "-crf", "18", "-profile:v", "high", "-movflags", "+faststart",
           "-an", out_path]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL)
    for i in range(nframes):
        T = i / FPS
        fr = render_frame(T)
        proc.stdin.write(fr.tobytes())
        if i % 60 == 0:
            print(f"  frame {i}/{nframes}", flush=True)
    proc.stdin.close()
    proc.wait()
    print("done:", out_path, proc.returncode)

if __name__ == "__main__":
    render_video(os.path.join(BASE, "RAXE_NOTHING_Ad.mp4"))
