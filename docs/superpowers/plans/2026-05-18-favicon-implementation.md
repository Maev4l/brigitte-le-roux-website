# Favicon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a vermillion-italic-Fraunces-"B" favicon on `brigitte-le-roux.com` (favicon.svg master + favicon.ico legacy + apple-touch-icon.png iOS fallback), wire it into `BaseLayout.astro`, and whitelist the three files in `.gitignore` so they're tracked in git despite the surrounding `public/*` ignore rule.

**Architecture:** Author the SVG master programmatically with `fontTools` (extract the "B" glyph contour from Fraunces-Italic VF at `opsz=144, wght=700`, wrap in a 24-unit `viewBox` with a parchment background rect + vermillion path). Rasterise it to PNG with the already-installed `rsvg-convert`, and bundle the three PNGs into a multi-resolution ICO with a tiny inline Python script (avoids an ImageMagick install). Add three `<link>` tags to the shared `<head>`. Ship via the existing two-pass `yarn deploy` — no infrastructure change.

**Tech Stack:** Astro 5, Python 3 + `fontTools` (one-time author tool, transient install — uninstalled in Task 11), `rsvg-convert` (already present on the dev machine via librsvg), Yarn, AWS S3 + CloudFront.

---

## File map

| Path | Action | Responsibility |
| --- | --- | --- |
| `scripts/generate-favicon-svg.py` | Create | One-shot Python author tool — fetches Fraunces-Italic VF, extracts "B" glyph at `opsz=144, wght=700`, emits `public/favicon.svg`. Re-runnable. Not invoked by build. |
| `public/favicon.svg` | Create | SVG master. Vermillion italic "B" `<path>` on parchment `<rect>` in a `0 0 24 24` viewBox. Glyph is a `<path>` (not `<text>`) so it renders without the Fraunces font loaded. |
| `public/favicon.ico` | Create | Multi-resolution ICO (16×16, 32×32, 48×48). Legacy / Windows / pinned-tab fallback. Rasterised from `favicon.svg`. |
| `public/apple-touch-icon.png` | Create | 180 × 180 PNG. iOS home screen / Safari pinned-tab. Rasterised from `favicon.svg`. |
| `.gitignore` | Modify | Add a `# Favicon — whitelisted from the public/* rule above` block with three `!public/favicon.*` lines plus `!public/apple-touch-icon.png`. |
| `src/layouts/BaseLayout.astro` | Modify | Insert three `<link>` tags into `<head>` immediately after the existing `<link rel="canonical" …>` line. |

---

## Operational guardrails

- **No auto-commit.** Steps that run `git commit` MUST be confirmed by the human partner before execution. The plan includes them for completeness; the executor should pause and ask.
- **No auto-deploy.** Task 9 runs `yarn deploy` against the production S3 bucket and invalidates CloudFront — destructive but explicitly intended. Pause for explicit human go-ahead before dispatching Task 9.
- **AWS credentials** are assumed to be set up in the shell environment (verified earlier this session as `developer-role`).
- **CWD** for every step is the repo root `/Users/jrsue/dev/repos/brigitte-leroux-website` unless explicitly stated otherwise.

---

### Task 1: Author `scripts/generate-favicon-svg.py`

**Files:**
- Create: `scripts/generate-favicon-svg.py`
- Create (transient): `/tmp/favicon-venv/` (isolated Python env; removed in Task 11)

The script is a one-shot author tool. It downloads the Fraunces-Italic variable font from the upstream Google Fonts repo, instantiates it at the chosen axis location (`opsz=144, wght=700, SOFT=0, WONK=0`), extracts the "B" glyph contour as an SVG `<path d="…">`, and writes `public/favicon.svg`. The script is checked into `scripts/` so the SVG is re-generatable.

To avoid polluting the user's site-packages (Python 3.14 enforces PEP 668), the script runs inside a transient venv at `/tmp/favicon-venv/`. The venv is removed by Task 11.

- [ ] **Step 1: Create the script**

```python
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
# If this URL 404s, browse https://github.com/googlefonts/fraunces/tree/main/fonts/variable
# and update to the current Italic VF filename.
FONT_URL = (
    "https://raw.githubusercontent.com/googlefonts/fraunces/main/"
    "fonts/variable/Fraunces-Italic%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf"
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
```

- [ ] **Step 2: Bootstrap the transient venv and install fontTools into it**

Run:
```bash
python3 -m venv /tmp/favicon-venv
/tmp/favicon-venv/bin/pip install --quiet fonttools
/tmp/favicon-venv/bin/python3 -c "import fontTools; print('fontTools', fontTools.__version__)"
```

Expected: `fontTools 4.X.Y` (any 4.x version works). The venv lives in `/tmp/` so it gets cleaned up either by Task 11 explicitly or by the OS on next reboot. The user's site-packages are untouched.

- [ ] **Step 3: Make the script executable and run it inside the venv**

Run: `chmod +x scripts/generate-favicon-svg.py && /tmp/favicon-venv/bin/python3 scripts/generate-favicon-svg.py`

Expected stderr:
```
Fetching Fraunces-Italic from https://raw.githubusercontent.com/googlefonts/fraunces/main/fonts/variable/Fraunces-Italic%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf
Instantiating at {'opsz': 144, 'wght': 700, 'SOFT': 0, 'WONK': 0}
Wrote /Users/jrsue/dev/repos/brigitte-leroux-website/public/favicon.svg (<some bytes> bytes)
```

If the FONT_URL 404s (upstream repo restructured), browse `https://github.com/googlefonts/fraunces/tree/main/fonts/variable` in a browser and update the URL constant to the current Italic VF filename.

- [ ] **Step 4: Verify the generated SVG is well-formed**

Run: `head -c 300 public/favicon.svg && echo`

Expected: starts with `<?xml version="1.0" encoding="UTF-8"?>` followed by `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">`, contains `<rect width="24" height="24" fill="#f3ede1"/>`, and includes a `<path d="…"/>` element with non-trivial path data.

Run: `python3 -c "import xml.etree.ElementTree as ET; ET.parse('public/favicon.svg'); print('SVG parses OK')"`

Expected: `SVG parses OK`

---

### Task 2: Generate `public/favicon.ico`

**Files:**
- Create: `public/favicon.ico`

Rasterise the SVG to three PNG sizes (16/32/48) with `rsvg-convert` (already installed), then bundle them into a multi-resolution PNG-ICO with an inline Python script (modern .ico format embeds the PNGs verbatim — no ImageMagick needed). Clean up the intermediate PNGs after.

- [ ] **Step 1: Verify rsvg-convert is on PATH**

Run: `rsvg-convert --version | head -1`

Expected: a line like `rsvg-convert version 2.X.Y`. The pre-flight check confirmed it's present on this machine via the existing `librsvg` install. If it ever disappears, restore with `brew install librsvg`.

- [ ] **Step 2: Rasterise the SVG at 16, 32, and 48 px**

Run:
```bash
rsvg-convert -w 16 -h 16 -b '#f3ede1' -o /tmp/favicon-16.png public/favicon.svg
rsvg-convert -w 32 -h 32 -b '#f3ede1' -o /tmp/favicon-32.png public/favicon.svg
rsvg-convert -w 48 -h 48 -b '#f3ede1' -o /tmp/favicon-48.png public/favicon.svg
```

`-b '#f3ede1'` (background) is belt-and-braces — the SVG already paints a parchment `<rect>`, but explicit is safer than relying on the rasterizer's transparent-pixel handling.

Expected: three PNG files in `/tmp/`. Verify with:
```bash
ls -l /tmp/favicon-{16,32,48}.png
file /tmp/favicon-16.png
```
Each file should exist with non-zero size; `file` should report `PNG image data, 16 x 16, …` for the 16 px file.

- [ ] **Step 3: Bundle the three PNGs into a multi-resolution PNG-ICO**

Run:
```bash
python3 - <<'PY'
import struct, pathlib

sizes_and_paths = [
    (16, pathlib.Path("/tmp/favicon-16.png")),
    (32, pathlib.Path("/tmp/favicon-32.png")),
    (48, pathlib.Path("/tmp/favicon-48.png")),
]
images = [(sz, p.read_bytes()) for sz, p in sizes_and_paths]

# ICONDIR (6 bytes): reserved=0, type=1 (ICO), count=N
header = struct.pack("<HHH", 0, 1, len(images))

# Each ICONDIRENTRY is 16 bytes; first image data starts after directory.
entry_size = 16
data_offset = len(header) + entry_size * len(images)

entries = b""
blobs = b""
for sz, data in images:
    # width/height: 0 means 256 in ICO; for 16/32/48 we encode the value directly.
    w = h = sz if sz < 256 else 0
    # 1 plane, 32 bit, byteCount = len(data), offset
    entries += struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(data), data_offset)
    data_offset += len(data)
    blobs += data

out = pathlib.Path("public/favicon.ico")
out.write_bytes(header + entries + blobs)
print(f"Wrote {out} ({out.stat().st_size} bytes), {len(images)} entries")
PY
```

Expected stdout:
```
Wrote public/favicon.ico (<some bytes> bytes), 3 entries
```

Verify the file is a recognised ICO:
```bash
file public/favicon.ico
```

Expected output begins: `public/favicon.ico: MS Windows icon resource - 3 icons, 16x16, …` (the exact tail varies by `file`'s libmagic version; the "3 icons" and "16x16" tokens are the load-bearing parts).

- [ ] **Step 4: Clean up intermediate PNGs**

Run: `rm /tmp/favicon-16.png /tmp/favicon-32.png /tmp/favicon-48.png`

Expected: no output (clean removal). The intermediate PNGs are not needed anywhere else.

---

### Task 3: Generate `public/apple-touch-icon.png`

**Files:**
- Create: `public/apple-touch-icon.png`

iOS uses a single 180 × 180 PNG. No multi-resolution wrapper.

- [ ] **Step 1: Rasterise the SVG at 180 × 180**

Run:
```bash
rsvg-convert -w 180 -h 180 -b '#f3ede1' -o public/apple-touch-icon.png public/favicon.svg
```

Expected: `public/apple-touch-icon.png` exists.

- [ ] **Step 2: Verify the output**

Run: `file public/apple-touch-icon.png`

Expected output: `public/apple-touch-icon.png: PNG image data, 180 x 180, 8-bit/color RGB(A), non-interlaced` (the RGB vs RGBA variant may differ — the `180 x 180` dimensions are what matter).

---

### Task 4: Whitelist favicon files in `.gitignore`

**Files:**
- Modify: `.gitignore` (line 14 area — the `public/` rule)

The current `.gitignore` line 14 reads `public/`. Git's `!` whitelist syntax does NOT re-include files inside a directory that's itself ignored — we have to change `public/` to `public/*` and then whitelist the three specific files. This widens the ignore pattern from "the directory" to "everything inside the directory", but the net set of ignored paths is unchanged for everything except the three favicon files.

- [ ] **Step 1: Edit `.gitignore`**

Replace lines 10–14 (the existing `# Site binaries` block ending with `public/`) with:

```gitignore
# Site binaries — canonical store is S3 (populated locally by hand, uploaded by `yarn deploy`).
# These files are NOT tracked in git: some exceed GitHub's 100 MB per-file hard limit, and the
# build/deploy pipeline already treats S3 as the source of truth. See CLAUDE.md for the recovery
# procedure if `public/` needs to be repopulated from S3.
public/*

# Favicon set — small identity files; track in git so fresh clones get them
# without needing `yarn pull` first. Whitelisted out of the public/* rule above.
!public/favicon.svg
!public/favicon.ico
!public/apple-touch-icon.png
```

(The only change inside the existing block is the trailing `public/` → `public/*`. The four new lines below are the whitelist.)

- [ ] **Step 2: Verify the whitelist works**

Run: `git check-ignore -v public/favicon.svg public/favicon.ico public/apple-touch-icon.png; echo "exit=$?"`

Expected: no output and `exit=1` for each path (no ignore rule matches — git would track these). If any of the three is reported as ignored, the `.gitignore` edit is wrong; re-check that the whitelist lines start with `!` and come AFTER the `public/*` line.

Run: `git check-ignore -v public/img/photoweb.jpg; echo "exit=$?"`

Expected: a line like `.gitignore:14:public/*	public/img/photoweb.jpg` and `exit=0` — confirms the broader ignore still applies to non-whitelisted files.

- [ ] **Step 3: Stage the three favicon files (dry-run check, do NOT commit yet)**

Run: `git add -n public/favicon.svg public/favicon.ico public/apple-touch-icon.png`

Expected (each path on its own line):
```
add 'public/apple-touch-icon.png'
add 'public/favicon.ico'
add 'public/favicon.svg'
```

If any path is missing, the `.gitignore` whitelist isn't catching it; revisit Step 1.

---

### Task 5: Add `<link>` tags to `src/layouts/BaseLayout.astro`

**Files:**
- Modify: `src/layouts/BaseLayout.astro:51`

Insert three `<link>` tags into `<head>` immediately after the existing `<link rel="canonical" …>` line (line 51). The `<head>` already clusters `<link>` declarations; this keeps them together.

- [ ] **Step 1: Edit the file**

Find this block (lines 50–53 of the current file):

```astro
  <meta name="author" content={strings.site.title} />
  <link rel="canonical" href={canonical} />

  {frExists && <link rel="alternate" hreflang="fr" href={frUrl} />}
```

Replace it with:

```astro
  <meta name="author" content={strings.site.title} />
  <link rel="canonical" href={canonical} />

  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="icon" type="image/x-icon" href="/favicon.ico" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

  {frExists && <link rel="alternate" hreflang="fr" href={frUrl} />}
```

Order matters: modern browsers walk the `<link rel="icon">` list and pick the first format they support. SVG first, ICO fallback second. `apple-touch-icon` is a separate relation that iOS picks up unconditionally.

- [ ] **Step 2: Verify the file still parses**

Run: `yarn astro check 2>&1 | tail -20`

(Astro's built-in check; doesn't require TypeScript. If `astro check` isn't in the project's scripts, fall through to the build verify in Task 6 — it will catch syntax errors there.)

Expected: no errors. If `astro check` is not configured, skip this step and rely on Task 6's `yarn build` to validate.

---

### Task 6: Local build verification

**Files:** (read-only — no edits)
- Inspect: `dist/favicon.svg`, `dist/favicon.ico`, `dist/apple-touch-icon.png`
- Inspect: `dist/index.html`, `dist/en/index.html` (or another route's HTML)

This is the gate before deploy. We need: build succeeds, the three favicon files end up at `dist/` root, and every rendered route's HTML contains the three `<link>` tags.

- [ ] **Step 1: Clean previous build output**

Run: `rm -rf dist`

Expected: no output (directory removed cleanly, or didn't exist).

- [ ] **Step 2: Run the build**

Run: `yarn build`

Expected: Astro builds with no errors and reports `23 page(s) built` (or whatever the current page count is — the build summary line should be present and not flag any warnings about missing favicon assets).

- [ ] **Step 3: Verify the three favicon files are in `dist/`**

Run: `ls -l dist/favicon.svg dist/favicon.ico dist/apple-touch-icon.png`

Expected: three lines, each showing a non-zero file size.

- [ ] **Step 4: Verify the three `<link>` tags rendered in the home HTML**

Run:
```bash
grep -E 'rel="(icon|apple-touch-icon)"' dist/index.html
```

Expected output (order may vary slightly depending on Astro's rendering, but all three present):
```
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
```

- [ ] **Step 5: Verify the same three tags rendered in a second route**

Run:
```bash
grep -E 'rel="(icon|apple-touch-icon)"' dist/en/index.html
```

Expected: the same three lines as Step 4 — confirms `BaseLayout.astro` is the shared `<head>` source and the change applies everywhere, not just the home route.

---

### Task 7: SVG visual sanity check

**Files:** (read-only)
- View: `public/favicon.svg`

The favicon will render in a browser tab at 16 × 16, but it's hard to judge legibility there. Open the master SVG directly to see the glyph at large size.

- [ ] **Step 1: Open the SVG in a browser**

Run: `open public/favicon.svg`

Expected: macOS opens the file in the default browser. The browser displays a parchment square (`#f3ede1`) filling the viewport, with a centred italic "B" in vermillion (`#b22222`). The "B" should be unmistakably italic (angled stroke), filled solid, padded ~10% from the edges, and not clipped.

If the glyph is clipped, off-centre, or the wrong colour, the most likely culprits are the transform math in `scripts/generate-favicon-svg.py` (Task 1) or a stale download. Re-run Task 1 Step 2 and re-inspect.

- [ ] **Step 2: Spot-check at 16 × 16 (optional but valuable)**

Open `dist/index.html` in a browser (`open dist/index.html`) and look at the browser tab. The favicon should display as a small vermillion shape on parchment. The italic asymmetry is the main visual signal at 16 px — an upright B would look symmetric and bland; the italic version has a recognisable lean.

---

### Task 8: Commit the favicon set (USER-APPROVED)

**Files:** (staged for commit)
- `public/favicon.svg`
- `public/favicon.ico`
- `public/apple-touch-icon.png`
- `.gitignore`
- `src/layouts/BaseLayout.astro`
- `scripts/generate-favicon-svg.py`

The user's standing rule is "Never commit or push automatically." Pause here and confirm with the user before running `git commit`.

- [ ] **Step 1: Confirm with the user**

Ask: "Tasks 1–7 are complete and the favicon renders locally. Ready to commit the six file changes (`public/favicon.svg`, `public/favicon.ico`, `public/apple-touch-icon.png`, `.gitignore`, `src/layouts/BaseLayout.astro`, `scripts/generate-favicon-svg.py`)?"

Wait for explicit "yes". Do not proceed without it.

- [ ] **Step 2: Stage the changes**

Run:
```bash
git add public/favicon.svg public/favicon.ico public/apple-touch-icon.png \
        .gitignore \
        src/layouts/BaseLayout.astro \
        scripts/generate-favicon-svg.py
```

Expected: no output.

- [ ] **Step 3: Verify the staged diff**

Run: `git status --short`

Expected: six `A` (added) or `M` (modified) entries — and nothing else. If other files appear, unstage them with `git restore --staged <path>` before continuing.

Run: `git diff --cached --stat`

Expected: a stat summary showing six paths changed, three new binary files (the favicon assets), and small line counts on the three text files.

- [ ] **Step 4: Commit**

Run:
```bash
git commit -m "$(cat <<'EOF'
feat: add italic Fraunces "B" favicon (SVG + ICO + apple-touch)

Generates favicon.svg with scripts/generate-favicon-svg.py (fonttools
extracts the "B" glyph from Fraunces-Italic at opsz=144/wght=700; same
cut the home page H1 uses for "Le Roux"). Vermillion on parchment,
matching the site theme. ICO + 180px PNG rasterised from the SVG via
ImageMagick. BaseLayout emits the three <link> tags on every route.

.gitignore whitelists the three files out of the public/* rule so they
travel with the repo (small, identity-defining, not site binary assets).
EOF
)"
```

Expected: a single commit created, pre-commit hooks (if any) pass.

---

### Task 9: Deploy to production (USER-APPROVED, DESTRUCTIVE)

**Files:** (none — runs scripts)

`yarn deploy` runs `scripts/deploy.sh`, which: builds, two-pass syncs `dist/` to `s3://brigitte-le-roux-website/`, and invalidates CloudFront `/*`. Pass 2 (no `--size-only`) re-uploads bucket-root files unconditionally — so the new `favicon.svg`, `favicon.ico`, and `apple-touch-icon.png` will be pushed.

This is destructive (it mutates production). Pause for explicit human go-ahead before running.

- [ ] **Step 1: Confirm with the user**

Ask: "Ready to deploy to production? This runs `yarn deploy` which builds, syncs `dist/` to S3, and invalidates the CloudFront distribution. Three new files (`/favicon.svg`, `/favicon.ico`, `/apple-touch-icon.png`) will appear at the bucket root; no existing files are renamed or deleted."

Wait for explicit "yes". Do not proceed without it.

- [ ] **Step 2: Run the deploy**

Run: `yarn deploy`

Expected output ends with:
```
==> Invalidating CloudFront /*
==> Done: https://<cloudfront-domain>/
```

The two-pass sync should show Pass 1 ("Syncing static assets (size-only)") complete with no errors, then Pass 2 ("Syncing HTML + bundles (force re-upload, no --size-only)") uploading the favicon trio plus the HTML/CSS bundles. If either pass errors, STOP and diagnose — do not retry blindly.

---

### Task 10: Production verification

**Files:** (none — read-only HTTP probes)

Confirm the three asset URLs return 200 with correct Content-Types, and that a fresh request for the home page contains the three `<link>` tags.

- [ ] **Step 1: Wait briefly for CloudFront invalidation to propagate**

Run: `sleep 30`

CloudFront `/*` invalidations typically complete in 30–60 s. The previous deploys in this session showed propagation within that window.

- [ ] **Step 2: Probe the three asset URLs**

Run:
```bash
for path in /favicon.svg /favicon.ico /apple-touch-icon.png; do
  echo "== https://brigitte-le-roux.com${path} =="
  curl -sI "https://brigitte-le-roux.com${path}" | head -5
  echo
done
```

Expected: each URL returns `HTTP/2 200` with a `content-type` header matching:
- `/favicon.svg` → `image/svg+xml`
- `/favicon.ico` → `image/vnd.microsoft.icon` or `image/x-icon`
- `/apple-touch-icon.png` → `image/png`

If any return `403` or `404`, the deploy didn't ship that file. Re-check `ls -l dist/favicon.*` and re-run Task 9.

- [ ] **Step 3: Verify the home page references the three files**

Run:
```bash
curl -s https://brigitte-le-roux.com/ | grep -E 'rel="(icon|apple-touch-icon)"'
```

Expected: three lines, identical to Task 6 Step 4:
```
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
```

- [ ] **Step 4: Visual confirmation in a fresh browser**

Run: `open "https://brigitte-le-roux.com/"`

Expected: the browser tab shows the vermillion italic "B" on parchment instead of the default broken-page icon. If the tab still shows a cached "no favicon" state, hard-refresh (`Cmd-Shift-R`) or open in a private window.

- [ ] **Step 5: Mark acceptance criteria from the spec**

Walk through the eight acceptance criteria in `docs/superpowers/specs/2026-05-18-favicon-design.md` lines 139–154 and confirm each is met. All should be ticked off by this point. If any is unmet, do not declare the task complete — diagnose and fix.

---

### Task 11: Cleanup — uninstall transient author tools

**Files:** (none in repo)
- Remove: `/tmp/favicon-venv/` (transient Python env, created in Task 1)

Per the human partner's request, uninstall anything we installed for this task so the dev machine ends up exactly as it started. Pre-flight reconnaissance recorded that fontTools was ABSENT, ImageMagick was ABSENT, rsvg-convert was PRESENT, pipx was ABSENT. The only transient install was the `/tmp/favicon-venv/` Python virtualenv containing fontTools. ImageMagick was never installed (we used the pre-existing rsvg-convert instead).

- [ ] **Step 1: Remove the transient venv**

Run: `rm -rf /tmp/favicon-venv`

Expected: no output (clean removal).

- [ ] **Step 2: Confirm fontTools is absent from the user's Python**

Run: `python3 -c "import fontTools" 2>&1 | head -1`

Expected: `ModuleNotFoundError: No module named 'fontTools'` — confirms the venv install never escaped into the user's interpreter.

- [ ] **Step 3: Confirm no leftover author tools**

Run:
```bash
echo "magick on PATH? $(command -v magick || echo NO)"
echo "rsvg-convert on PATH? $(command -v rsvg-convert || echo NO)"
ls -d /tmp/favicon-venv 2>/dev/null && echo "venv STILL PRESENT" || echo "venv removed OK"
```

Expected:
```
magick on PATH? NO
rsvg-convert on PATH? /opt/homebrew/bin/rsvg-convert  (or wherever it was — must still be present; it's pre-existing)
venv removed OK
```

If anything diverges from the pre-flight state recorded before Task 1, investigate and remediate.

---

## Self-review

**Spec coverage:**
- Goal 1 (eliminate missing-favicon) → Tasks 1–3 produce the files, Task 5 wires them in, Task 9 deploys, Task 10 verifies.
- Goal 2 (reuse existing visual vocabulary — italic Fraunces, vermillion on parchment) → Task 1 hard-codes both colours from the theme and pulls the "B" from Fraunces-Italic at the same axis values the home page uses.
- Goal 3 (survive 16 × 16) → Task 2 oversamples via `-density 1024` before downscaling to 16 px; Task 7 Step 2 includes a visual spot-check at tab size.
- Constraint: no new `package.json` deps → fontTools and ImageMagick are author-time tools, never invoked by `yarn build`.
- Constraint: gitignore whitelist → Task 4.
- Constraint: existing two-pass deploy ships them as-is → Task 9 leans on the unchanged `scripts/deploy.sh`.
- Visual table values → all encoded in `scripts/generate-favicon-svg.py` (Task 1).
- Glyph extraction (`<path>` not `<text>`) → Task 1's `SVGPathPen` emits path commands, no `<text>` element appears anywhere.
- File deliverables (SVG / ICO / PNG) → Tasks 1, 2, 3 respectively.
- HTML wiring (three `<link>` tags) → Task 5.
- Build & deploy commentary → Tasks 6 and 9 walk through both.
- Acceptance criteria 1–8 → mapped explicitly in Task 10 Step 5.

**Placeholder scan:** No "TBD", "TODO", or "fill in details" anywhere. Every code block, command, and expected output is concrete. The one conditional ("if `astro check` is not configured") falls through to Task 6's `yarn build`, which catches the same class of error.

**Type / name consistency:** File paths (`public/favicon.svg`, `public/favicon.ico`, `public/apple-touch-icon.png`, `scripts/generate-favicon-svg.py`, `src/layouts/BaseLayout.astro`, `.gitignore`) are spelled identically across every task. Theme tokens (`#b22222`, `#f3ede1`) are spelled identically. `viewBox` is `0 0 24 24` in both the spec and Task 1. `opsz=144, wght=700` matches the spec table.

## Reference

- Spec: `docs/superpowers/specs/2026-05-18-favicon-design.md`
- Theme tokens: `src/styles/theme.css` (the `--accent` and `--bg` variables; the favicon hard-codes their hex values literally so the SVG doesn't need stylesheets at render time).
- Deploy script: `scripts/deploy.sh` (the two-pass sync; Pass 2 re-uploads bucket-root files unconditionally).
- Fraunces upstream: https://github.com/googlefonts/fraunces — only relevant if the `FONT_URL` constant in Task 1 ever 404s.
