#!/usr/bin/env python3
"""Composite renders into one contact sheet, optionally with a measuring grid.

    sheet.py <outfile.png> <image...> [--cols N] [--max-px 1400]
    sheet.py <outfile.png> <ortho.png> --grid --step 100

Why a sheet rather than looking at images one at a time: surface defects and
asymmetry are obvious side by side and easy to miss in isolation, and one image
costs one look instead of four.

Why the grid: an orthographic render has a known pixel-to-world mapping (mesh.py
ortho prints it), so a labelled grid turns "the eyes are somewhere around here"
into an exact coordinate. Every hand-estimated position in this pipeline has
been wrong at least once; measured ones have not.

Runs on the host Python, not inside Blender. Needs Pillow.
"""
import argparse
import os
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("needs Pillow: pip install --user Pillow")


def add_grid(im, step, colour=(255, 90, 90)):
    im = im.convert("RGB")
    d = ImageDraw.Draw(im)
    w, h = im.size
    for x in range(0, w, step):
        d.line([(x, 0), (x, h)], fill=colour, width=1)
        d.text((x + 3, 3), str(x), fill=colour)
    for y in range(0, h, step):
        d.line([(0, y), (w, y)], fill=colour, width=1)
        d.text((3, y + 3), str(y), fill=colour)
    return im


def main():
    p = argparse.ArgumentParser()
    p.add_argument("output")
    p.add_argument("images", nargs="+")
    p.add_argument("--cols", type=int, default=2)
    p.add_argument("--max-px", type=int, default=1400,
                   help="longest side of the finished sheet")
    p.add_argument("--grid", action="store_true")
    p.add_argument("--step", type=int, default=100)
    a = p.parse_args()

    ims = []
    for path in a.images:
        if not os.path.exists(path):
            print("missing", path)
            continue
        ims.append(Image.open(path).convert("RGB"))
    if not ims:
        sys.exit("no images found")

    if a.grid:
        # A grid is only meaningful at native resolution, so grid mode never
        # rescales: the pixel numbers must match the mapping mesh.py printed.
        out = add_grid(ims[0], a.step)
        out.save(a.output)
        print(a.output, out.size, f"grid step {a.step} px")
        return

    w, h = ims[0].size
    cols = min(len(ims), a.cols)
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new("RGB", (w * cols, h * rows), (40, 40, 44))
    for i, im in enumerate(ims):
        if im.size != (w, h):
            im = im.resize((w, h), Image.LANCZOS)
        sheet.paste(im, ((i % cols) * w, (i // cols) * h))
    scale = a.max_px / max(sheet.size)
    if scale < 1:
        sheet = sheet.resize((int(sheet.width * scale),
                              int(sheet.height * scale)), Image.LANCZOS)
    sheet.save(a.output)
    print(a.output, sheet.size)


if __name__ == "__main__":
    main()
