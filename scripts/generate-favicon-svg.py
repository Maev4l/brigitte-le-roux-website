#!/usr/bin/env python3
"""
One-shot author tool — regenerates public/favicon.svg from Fraunces-Italic.

Invoke from the repo root with:

    python3 -m venv /tmp/favicon-venv
    /tmp/favicon-venv/bin/pip install fonttools
    /tmp/favicon-venv/bin/python3 scripts/generate-favicon-svg.py

(Task 11 of the favicon plan removes /tmp/favicon-venv afterward.)
"""
import io
import sys
import urllib.request
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib.mutator import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen

# Fraunces-Italic variable font, hosted in the upstream Google Fonts repo.
# If this URL 404s, browse https://github.com/googlefonts/fraunces/tree/main/fonts
# and update to the current Italic VF filename.
# (The VFs moved from fonts/variable/ → fonts/ in the upstream repo.)
FONT_URL = (
    "https://raw.githubusercontent.com/googlefonts/fraunces/master/"
    "fonts/Fraunces-Italic%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf"
)

# Axis location mirroring the home page H1's italic "Le Roux" rendering.
AXES = {"opsz": 144, "wght": 700, "SOFT": 0, "WONK": 0}

# Theme tokens — kept literal so the SVG renders identically without theme.css.
ACCENT = "#b22222"   # vermillion (var(--accent))
BG = "#f3ede1"       # parchment (var(--bg))

# Semantic 24-unit viewBox, 10% padding so the glyph doesn't kiss the edges.
VIEWBOX = 24
PADDING = 2.4
TARGET = VIEWBOX - 2 * PADDING  # 19.2

OUT_PATH = Path(__file__).resolve().parent.parent / "public" / "favicon.svg"


def main() -> None:
    print(f"Fetching Fraunces-Italic from {FONT_URL}", file=sys.stderr)
    raw = urllib.request.urlopen(FONT_URL).read()
    font = TTFont(io.BytesIO(raw))

    print(f"Instantiating at {AXES}", file=sys.stderr)
    instance = instantiateVariableFont(font, AXES)

    cmap = instance.getBestCmap()
    glyph_name = cmap[ord("B")]
    glyph_set = instance.getGlyphSet()

    pen = SVGPathPen(glyph_set)
    glyph_set[glyph_name].draw(pen)
    path_d = pen.getCommands()

    glyph = instance["glyf"][glyph_name]
    width = glyph.xMax - glyph.xMin
    height = glyph.yMax - glyph.yMin
    scale = TARGET / max(width, height)

    scaled_w = width * scale
    scaled_h = height * scale
    tx = PADDING + (TARGET - scaled_w) / 2 - glyph.xMin * scale
    # +yMax * scale because the <g> flips Y (font is Y-up, SVG is Y-down).
    ty = PADDING + (TARGET - scaled_h) / 2 + glyph.yMax * scale

    svg = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {VIEWBOX} {VIEWBOX}">\n'
        f'  <rect width="{VIEWBOX}" height="{VIEWBOX}" fill="{BG}"/>\n'
        f'  <g transform="translate({tx:.4f} {ty:.4f}) scale({scale:.6f} {-scale:.6f})" fill="{ACCENT}">\n'
        f'    <path d="{path_d}"/>\n'
        '  </g>\n'
        '</svg>\n'
    )

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(svg)
    print(f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size} bytes)", file=sys.stderr)


if __name__ == "__main__":
    main()
