# Favicon — design

**Date:** 2026-05-18

**Scope:** Add a favicon to `brigitte-le-roux.com`. The site currently
ships no favicon — browser tabs show the default broken-page icon. The
new favicon is a single italic Fraunces "B" glyph, vermillion `#b22222`
on a parchment `#f3ede1` background, served as a `favicon.svg` master
with `favicon.ico` and `apple-touch-icon.png` fallbacks.

## Goals

1. **Eliminate the missing-favicon failure mode** on every route. Browsers
   stop requesting `/favicon.ico` and 404ing; tabs and bookmarks render
   the site's mark.
2. **Reuse the site's existing visual vocabulary.** No new typeface, no
   new colour. The italic "B" is the same Fraunces cut used by the home
   page H1's "Le Roux" word; vermillion-on-parchment is the same colour
   pair used by the home page drop-cap and the section dividers.
3. **Survive 16 × 16 px.** Browser tab is the smallest rendering surface;
   anything more elaborate than a single letter loses fidelity there.

## Non-goals

- **Multi-letter monogram** ("BLR", "BL") — illegible at tab size.
- **Photographic favicon** (a tiny portrait) — illegible at tab size.
- **Dark-mode variant** with a `media="(prefers-color-scheme: dark)"`
  link. Parchment background is light-toned but vermillion provides
  enough contrast on both light and dark browser chrome.
- **Animated SVG favicon.** Out of place editorially.
- **PWA manifest / web app icons.** The site is a static brochure;
  install-as-app isn't a goal.

## Constraints

- No new dependencies in `package.json`.
- No new theme tokens; reuse `#b22222` and `#f3ede1`.
- The favicon files live in `public/`, which the site treats as the S3
  mirror (gitignored by default). The three favicon files must be
  whitelisted in `.gitignore` so they're tracked in git despite the
  surrounding ignore rule — they're tiny identity files, not site
  binary assets.
- Existing two-pass `scripts/deploy.sh` ships them as-is (Pass 2
  uploads bucket-root files force-on-every-deploy).

## Design

### Visual

| Property | Value |
| --- | --- |
| Glyph | "B" (uppercase) |
| Style | Italic |
| Font | Fraunces (already loaded by the site from Google Fonts) |
| Optical size axis | `opsz: 144` (display cut — same as page H1) |
| Weight | `700` |
| Fill colour | `#b22222` (vermillion, `--accent`) |
| Background | `#f3ede1` (parchment, `--bg`) |
| Padding | ~10 % of viewBox edge so the glyph doesn't kiss the borders |
| SVG viewBox | `0 0 24 24` (semantic 24-unit grid; renders crisply at 16/24/32/48 px) |

The italic glyph is the design choice: it mirrors how the home page
sets "Le Roux" — recognisable to returning visitors, and the angled
italic stroke is more legible at 16 × 16 than an upright B because the
asymmetry catches the eye.

### Files delivered

| Path | Format | Purpose |
| --- | --- | --- |
| `public/favicon.svg` | SVG with the "B" glyph as a `<path>` element (NOT `<text>` — favicons render outside the document's font context) | Modern browser primary |
| `public/favicon.ico` | Multi-resolution ICO containing 16×16, 32×32, 48×48 raster frames | Legacy / Windows / pinned tab fallback |
| `public/apple-touch-icon.png` | 180 × 180 PNG | iOS home screen / Safari pinned tab |

The SVG is the master. The ICO and PNG are rasterised from it as a
one-time author step. Tooling is at the implementer's discretion:
ImageMagick (`magick convert favicon.svg -resize 180x180 apple-touch-icon.png`),
`rsvg-convert`, Node `sharp`, or Inkscape CLI — all work; pick whichever
is already installed.

### Glyph extraction

The "B" inside the SVG must be a `<path>` element (so it renders without
needing the Fraunces font loaded). Two viable extraction paths, both
acceptable:

- **Programmatic** — install `fonttools` (`pip install fonttools`), read
  `Fraunces-Italic[opsz,wght].ttf` (downloadable from Google Fonts),
  extract the "B" glyph contour with `opsz=144, wght=700` axis values,
  emit as SVG `<path d="…" />`.
- **Manual** — render the glyph once in a vector editor (Figma,
  Inkscape, Illustrator, Affinity Designer) using the actual Fraunces
  font installed locally, export as SVG, copy the path data.

The implementation plan picks one approach and documents the steps.

### Gitignore whitelist

Add to `.gitignore`:

```gitignore
# Existing rule that ignores public/* (see CLAUDE.md § Static assets):
public/*

# Whitelist the favicon set — small, identity files; track them in git
# so fresh clones get them without needing to run `yarn pull` first.
!public/favicon.svg
!public/favicon.ico
!public/apple-touch-icon.png
```

### HTML wiring

Three `<link>` tags added inside `<head>` in `src/layouts/BaseLayout.astro`,
near the existing `<link>` declarations:

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="icon" type="image/x-icon" href="/favicon.ico" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
```

Order matters: modern browsers walk the list and pick the first format
they support. SVG first, ICO fallback second, apple-touch as a separate
relation that iOS picks up unconditionally.

### Build & deploy

- `yarn build` copies `public/*` into `dist/*` as-is. The three favicon
  files end up at `dist/favicon.svg`, `dist/favicon.ico`,
  `dist/apple-touch-icon.png`.
- `yarn deploy` (two-pass) Pass 2 (`aws s3 sync` without `--size-only`)
  uploads them to the bucket root. CloudFront `/*` invalidation refreshes
  the CDN. On the next request, browsers fetch the new icons.
- No infrastructure change. Same bucket, same distribution.

## Acceptance criteria

- [ ] `public/favicon.svg`, `public/favicon.ico`, `public/apple-touch-icon.png`
      exist and are tracked in git.
- [ ] `.gitignore` whitelists the three filenames.
- [ ] `src/layouts/BaseLayout.astro` `<head>` emits three `<link>` tags
      (`icon` SVG, `icon` ICO, `apple-touch-icon`).
- [ ] `yarn build` succeeds; 23 pages built; no warnings.
- [ ] After build, `dist/favicon.svg`, `dist/favicon.ico`,
      `dist/apple-touch-icon.png` exist with non-zero size.
- [ ] Rendered HTML in `dist/index.html` (and at least one other route)
      contains all three `<link>` tags.
- [ ] The SVG renders correctly when opened directly in a browser
      (vermillion italic "B" centered on parchment background).
- [ ] After `yarn deploy`: visiting `https://brigitte-le-roux.com/` in a
      fresh browser shows the favicon in the tab; the corresponding
      `/favicon.svg`, `/favicon.ico`, `/apple-touch-icon.png` URLs all
      return HTTP 200 with the correct Content-Type.

## Out of scope

- Web app manifest (`manifest.webmanifest`) and PWA install icons.
- Animated or dark-mode favicon variants.
- Multi-platform extensions (Microsoft Tile XML, Safari mask icon).
- Changes to the visual identity beyond the favicon itself.

## Open questions

_None._ All design choices resolved during brainstorming.

## Reference

- `CLAUDE.md` § "Static assets" — `public/` is the S3 mirror; this spec
  carves out a narrow whitelist for the favicon files specifically.
- `src/styles/theme.css` `:root` — the `--accent` (`#b22222`) and `--bg`
  (`#f3ede1`) tokens consumed by the SVG.
- `src/layouts/BaseLayout.astro` — the `<head>` insertion point for the
  three `<link>` tags.
