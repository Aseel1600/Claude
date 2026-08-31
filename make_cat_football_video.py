#!/usr/bin/env python3
"""
make_cat_football_video.py — render the "Cat Plays Football" video.

Builds a 1280x720 (16:9), 30 fps, ~8.9 s H.264 MP4 from seven still frames
of a tabby cat in a football jersey (pose -> dribble -> sprint -> wind up ->
strike -> ball toward goal -> celebration). Each frame gets a Ken Burns
pan/zoom motion and consecutive scenes are crossfaded.

Frames are build assets (not committed): by default the script looks for
`frame1.png` ... `frame7.png` in `./frames`, falling back to the current
directory. Pass `--frames DIR` to point elsewhere.

Requirements
------------
- Python 3.8+
- ffmpeg (either on PATH, or installed via `pip install imageio-ffmpeg`,
  which bundles a static binary the script auto-discovers)
- Pillow (`pip install pillow`) — optional, only used to read frame size

Usage
-----
    python make_cat_football_video.py [--frames DIR] [--out cat_playing_football.mp4]

The original frames were generated with the Arena image tool; regenerate them
or supply your own before running.
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from fractions import Fraction

WIDTH, HEIGHT = 1280, 720
FPS = 30
CLIP_SECONDS = 1.7          # time each frame is shown
XFADE_SECONDS = 0.5         # crossfade duration between scenes


def find_ffmpeg() -> str:
    """Return an ffmpeg binary path (system, then imageio-ffmpeg bundled)."""
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg  # type: ignore

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:  # pragma: no cover
        raise SystemExit(
            "ffmpeg not found. Install it on PATH or run: pip install imageio-ffmpeg"
        ) from exc


def resolve_frames(frames_dir: str) -> list[str]:
    """Locate frame1..frame7.png in the given directory."""
    candidates = [frames_dir] if frames_dir else ["./frames", "."]
    for base in candidates:
        paths = [os.path.join(base, f"frame{i}.png") for i in range(1, 8)]
        if all(os.path.isfile(p) for p in paths):
            return paths
    searched = ", ".join(
        os.path.join(b, "frame{1..7}.png") for b in (candidates if frames_dir else candidates)
    )
    raise SystemExit(
        f"Could not find frame1.png..frame7.png. Looked in: {searched}. "
        "Generate the frames or pass --frames DIR."
    )


def build_filter_graph() -> str:
    """Compose the zoompan (Ken Burns) + xfade filter graph."""
    d = int(round(CLIP_SECONDS * FPS))  # zoompan output frames per clip

    # (zoom, x, y) expressions — a mix of zoom-in, zoom-out and pans.
    motions = [
        ("1+0.16*on/%d" % d, "iw/2-(iw/zoom)/2", "ih/2-(ih/zoom)/2"),
        ("1.16-0.16*on/%d" % d, "iw/2-(iw/zoom)/2", "ih/2-(ih/zoom)/2"),
        ("1.08", "(iw-iw/zoom)*on/%d" % d, "ih/2-(ih/zoom)/2"),
        ("1+0.16*on/%d" % d, "iw/2-(iw/zoom)/2", "ih/2-(ih/zoom)/2"),
        ("1.08", "(iw-iw/zoom)*(1-on/%d)" % d, "ih/2-(ih/zoom)/2"),
        ("1+0.16*on/%d" % d, "iw/2-(iw/zoom)/2", "ih/2-(ih/zoom)/2"),
        ("1.20-0.22*on/%d" % d, "iw/2-(iw/zoom)/2", "ih/2-(ih/zoom)/2"),
    ]

    parts: list[str] = []
    for i, (zoom, x, y) in enumerate(motions):
        parts.append(
            f"[{i}:v]scale=1600:900:force_original_aspect_ratio=increase,"
            f"crop=1600:900,"
            f"zoompan=z='{zoom}':x='{x}':y='{y}':d={d}:s={WIDTH}x{HEIGHT}:fps={FPS},"
            f"settb=AVTB,format=yuv420p,setsar=1[v{i}]"
        )

    prev = "v0"
    for i in range(1, len(motions)):
        out = f"x{i}" if i < len(motions) - 1 else "vout"
        offset = round(i * CLIP_SECONDS - i * XFADE_SECONDS, 3)
        parts.append(
            f"[{prev}][v{i}]xfade=transition=fade:duration={XFADE_SECONDS}:offset={offset}[{out}]"
        )
        prev = out

    return ";".join(parts)


def render(ffmpeg: str, frames: list[str], out: str) -> None:
    cmd = [ffmpeg, "-y"]
    for f in frames:
        cmd += ["-i", f]  # single-frame input; zoompan generates the clip frames
    cmd += [
        "-filter_complex", build_filter_graph(),
        "-map", "[vout]",
        "-r", str(FPS),
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        out,
    ]
    print("Rendering", out, "...")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        print("ffmpeg failed:\n", proc.stderr[-3000:], file=sys.stderr)
        raise SystemExit(1)
    print("Done ->", os.path.abspath(out))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frames", help="directory holding frame1..7.png")
    parser.add_argument("--out", default="cat_playing_football.mp4")
    args = parser.parse_args(argv)

    ffmpeg = find_ffmpeg()
    frames = resolve_frames(args.frames)
    render(ffmpeg, frames, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
