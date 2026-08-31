#!/usr/bin/env python3
"""
generate_vibesai_cat_football.py — generate the "cat playing football" video
via the unofficial VibesAI-api client (https://github.com/mir-ashiq/VibesAI-api).

This is the *original* API-driven approach. It uses vibes.ai (Meta's AI video
studio) to generate a text-to-video clip end-to-end and download the MP4.

Requirements
------------
    pip install VibesAI-api

Authentication (REQUIRED — no public/anonymous path exists)
-----------------------------------------------------------
vibes.ai authenticates with a `meta_session` cookie from a logged-in
Meta/Facebook account:

    1. Log in at https://vibes.ai in your browser.
    2. DevTools (F12) -> Application -> Cookies -> https://vibes.ai.
    3. Copy the value of `meta_session` (a UUID-like string).
    4. export VIBES_META_SESSION="<value>"

Usage
-----
    export VIBES_META_SESSION="<your cookie>"
    python generate_vibesai_cat_football.py

Optional env overrides
----------------------
    VIBES_PROMPT      prompt text (default: cat playing football)
    VIBES_ASPECT      1:1 | 9:16 | 16:9   (default 16:9)
    VIBES_RESOLUTION  480p | 720p         (default 720p)
    VIBES_VARIATIONS  1..4                (default 4)
    VIBES_OUT         output directory    (default ./out)

NOTE: this script targets vibes.ai directly and must run on a machine that
can reach https://vibes.ai (some datacenter/CI egress IPs are blocked at the
TLS layer). The committed `make_cat_football_video.py` + MP4 are the
self-contained fallback that does not require vibes.ai.
"""
from __future__ import annotations

import os
import sys

from vibes_api import AspectRatio, Resolution, VibesAPIError, VibesClient

PROMPT = os.environ.get(
    "VIBES_PROMPT",
    "An adorable fluffy orange tabby cat wearing a tiny football jersey, "
    "dribbling a soccer ball across a lush green football pitch, "
    "cinematic action shot, the cat kicks the ball toward the goal, "
    "dynamic motion, shallow depth of field, golden hour lighting, "
    "stadium blurred in the background, high detail, playful and fun",
)

ASPECT_MAP = {
    "1:1": AspectRatio.SQUARE,
    "9:16": AspectRatio.PORTRAIT,
    "16:9": AspectRatio.LANDSCAPE,
}
RES_MAP = {
    "480p": Resolution.P480,
    "720p": Resolution.P720,
}


def main() -> int:
    cookie = os.environ.get("VIBES_META_SESSION")
    if not cookie or cookie in {"your-cookie-here", ""} or cookie.startswith("PASTE"):
        print(
            "ERROR: VIBES_META_SESSION is not set. See the module docstring for "
            "how to obtain your vibes.ai meta_session cookie.",
            file=sys.stderr,
        )
        return 2

    aspect = ASPECT_MAP.get(os.environ.get("VIBES_ASPECT", "16:9"), AspectRatio.LANDSCAPE)
    resolution = RES_MAP.get(os.environ.get("VIBES_RESOLUTION", "720p"), Resolution.P720)
    variations = int(os.environ.get("VIBES_VARIATIONS", "4"))
    out_dir = os.environ.get("VIBES_OUT", "./out")
    os.makedirs(out_dir, exist_ok=True)

    client = VibesClient(meta_session=cookie)

    try:
        me = client.get_me()
    except VibesAPIError as exc:
        print(f"ERROR: auth failed ({exc}). Is the cookie valid/expired?", file=sys.stderr)
        return 3
    print(f"Logged in as: {me.get('username')} (id={me.get('id')})")

    project = client.create_project(name="Cat plays football")
    print(f"Created project: {project['id']}")

    print(
        f"Generating {variations} variation(s) | "
        f"{os.environ.get('VIBES_ASPECT','16:9')} @ {os.environ.get('VIBES_RESOLUTION','720p')}"
    )
    print(f"Prompt: {PROMPT}")
    batch = client.generate_video(
        project_id=project["id"],
        prompt=PROMPT,
        aspect_ratio=aspect,
        resolution=resolution,
        variations=variations,
    )
    print(f"Batch complete: {batch['id']}")

    saved = []
    for i, item in enumerate(batch.get("content") or []):
        print(f"  [{i}] id={item.get('id')} videoUrl={'yes' if item.get('videoUrl') else 'no'}")
        if item.get("videoUrl"):
            out_path = os.path.join(out_dir, f"cat_football_{i + 1}.mp4")
            try:
                client.download_video(item["id"], out_path)
                print(f"       saved -> {out_path}")
                saved.append(out_path)
            except VibesAPIError as exc:
                print(f"       download failed: {exc}")

    if saved:
        print("\nDONE. Files:")
        for p in saved:
            print(f"  {os.path.abspath(p)}")
        return 0
    print("\nNo videos were downloaded (still processing, or quota/error).", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
