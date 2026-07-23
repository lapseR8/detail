#!/usr/bin/env python3
"""
Generates the master 1024x1024 app icon PNG for Detail (Campaigner Studios).
Matches the in-app brand mark: near-black rounded square, orange border,
bold serif "D".

Usage:
    python3 build/generate-icon-source.py
    build/make-icon.sh          # then bake it into build/icon.icns

Re-run this any time the brand mark's colors/font change — it's the one
place to edit, rather than hand-editing icon.icns or the PNG directly.
Requires Pillow (pip install pillow / already present via `pip3 show pillow`).
"""
from PIL import Image, ImageDraw, ImageFont
import os

SIZE = 1024
BG = (255, 255, 255, 255)      # white fill, matches in-app brand-mark
ACCENT = (255, 94, 26, 255)    # --accent (neon orange, updated) — border only
LETTER = (13, 19, 37, 255)     # --brand-black (desaturated navy) — the "D" itself

# macOS (Big Sur+) auto-masks every app icon into its own rounded-square
# template with a drop shadow, based on the icon's own silhouette — art that
# fills the full 1024 canvas edge-to-edge gets its corners/border clipped by
# that mask. Standard fix: inset the actual glyph to ~80% of the canvas,
# centered, so nothing sits at the true edge.
MARGIN = 100
CONTENT = SIZE - 2*MARGIN
BORDER_W = round(26 * CONTENT/1024)
CORNER_R = round(160 * CONTENT/824)
OUT_PATH = os.path.join(os.path.dirname(__file__), "icon-source.png")

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

box = [(MARGIN, MARGIN), (SIZE - 1 - MARGIN, SIZE - 1 - MARGIN)]
draw.rounded_rectangle(box, radius=CORNER_R, fill=BG)
inset = BORDER_W // 2
border_box = [(MARGIN + inset, MARGIN + inset), (SIZE - 1 - MARGIN - inset, SIZE - 1 - MARGIN - inset)]
draw.rounded_rectangle(border_box, radius=CORNER_R - inset, outline=ACCENT, width=BORDER_W)

font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Georgia Bold.ttf", round(620 * CONTENT/1024))
text = "D"
bbox = draw.textbbox((0, 0), text, font=font)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
pos = ((SIZE - tw) / 2 - bbox[0], (SIZE - th) / 2 - bbox[1])
draw.text(pos, text, font=font, fill=LETTER)

img.save(OUT_PATH)
print("wrote", OUT_PATH)
