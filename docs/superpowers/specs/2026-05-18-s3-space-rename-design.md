# S3 key space-to-underscore rename — design

**Date:** 2026-05-18

**Scope:** Rename every S3 key (and matching local `public/` path) that
contains an ASCII space character, replacing each space with an underscore
`_`. Update the 12 link occurrences in `content/pages/*.md` that reference
those paths (via `%20` URL-encoding). Also relocate the Berkeley poster
(`GDA Poster.pdf`) from `pdfs/a_recherches/` into `pdfs/ateliers/` so the
existing `ateliers/`-relative link in the ateliers page resolves correctly.

## Goals

1. **Stop relying on `%20` URL-encoding** for asset links. Underscored paths
   are unambiguous, copy-pasteable, and don't trigger encoding surprises in
   email / chat / referrers.
2. **Bring local `public/` and S3 in sync** with the new names in one
   atomic deploy.
3. **Fix the broken Berkeley-poster link** in the ateliers itinerary as a
   bundled cleanup (it currently points at `ateliers/GDA%20Poster.pdf` —
   relative to `/ateliers/` it resolves to `/ateliers/ateliers/GDA%20Poster.pdf`,
   which 404s. The actual file lives at `pdfs/a_recherches/GDA Poster.pdf`).

## Non-goals

- Renaming paths that DO NOT contain spaces (e.g. `Spad_Projects/` parent
  directory already uses an underscore — keep it).
- Introducing redirect rules in CloudFront for the old `%20` URLs.
  Inbound links from third parties that hard-code `%20` paths will break;
  the site has low enough inbound-link volume that this is acceptable.
- Renaming any other "noisy" filename pattern (capitalization, accents,
  spaces inside titles within YAML strings that are NOT paths).
- Restructuring the `public/` directory layout beyond moving the single
  Berkeley poster.

## Constraints

- `public/` is gitignored. The canonical store is S3. Local mirror must be
  pulled fresh before any rename to avoid losing S3-only files in the
  deploy's `--delete` sync.
- `yarn deploy` runs `aws s3 sync dist/ s3://… --delete --size-only` plus a
  CloudFront `/*` invalidation. The `--delete` flag is the migration
  mechanism — uploading the new path and removing the old path in one pass.
- No new dependencies. No new scripts (the existing `scripts/deploy.sh`
  does the work).
- All paths use absolute `/data/…` or `/pdfs/…` form in the new links
  (the current broken `ateliers/GDA%20Poster.pdf` relative form gets
  replaced with the explicit `/pdfs/ateliers/GDA_Poster.pdf`).

## Inventory — paths affected

### Local `public/` (and corresponding S3 keys)

| Type | Old | New |
| --- | --- | --- |
| File | `public/pdfs/a_recherches/GDA Poster.pdf` | `public/pdfs/ateliers/GDA_Poster.pdf` (renamed AND relocated) |
| Dir  | `public/data/Logiciels/SPAD projects/` (contains 3 referenced `.spad` files) | `public/data/Logiciels/SPAD_projects/` |
| File | `public/data/livres/CIGDA/Spad_Projects/The Parkinson Study_2019_03_31.spad` | `public/data/livres/CIGDA/Spad_Projects/The_Parkinson_Study_2019_03_31.spad` |
| File | `public/data/livres/CIGDA/Spad_Projects/Cognitive Study_2019_01_01.spad` | `public/data/livres/CIGDA/Spad_Projects/Cognitive_Study_2019_01_01.spad` |

The S3 keys mirror these local paths exactly (S3 prefix
`s3://brigitte-le-roux-website/`).

### Markdown link updates — 12 occurrences in 6 files

| File pair | Old href | New href |
| --- | --- | --- |
| `content/pages/ateliers/{fr,en}.md` | `ateliers/GDA%20Poster.pdf` (relative, broken) | `/pdfs/ateliers/GDA_Poster.pdf` (absolute, working) |
| `content/pages/livres/cigda/{fr,en}.md` | `/data/livres/CIGDA/Spad_Projects/The%20Parkinson%20Study_2019_03_31.spad` | `/data/livres/CIGDA/Spad_Projects/The_Parkinson_Study_2019_03_31.spad` |
| `content/pages/livres/cigda/{fr,en}.md` | `/data/livres/CIGDA/Spad_Projects/Cognitive%20Study_2019_01_01.spad` | `/data/livres/CIGDA/Spad_Projects/Cognitive_Study_2019_01_01.spad` |
| `content/pages/logiciels/{fr,en}.md` | `/data/Logiciels/SPAD%20projects/Culture_2004.spad` | `/data/Logiciels/SPAD_projects/Culture_2004.spad` |
| `content/pages/logiciels/{fr,en}.md` | `/data/Logiciels/SPAD%20projects/FrenchWorkers_2019.spad` | `/data/Logiciels/SPAD_projects/FrenchWorkers_2019.spad` |
| `content/pages/logiciels/{fr,en}.md` | `/data/Logiciels/SPAD%20projects/TasteExample.spad` | `/data/Logiciels/SPAD_projects/TasteExample.spad` |

Total markdown occurrences: 1 (ateliers fr) + 1 (ateliers en) + 2 (cigda fr) +
2 (cigda en) + 3 (logiciels fr) + 3 (logiciels en) = **12**, across **6 files**.

## Architecture — S3 migration via `yarn deploy`

The existing deploy script handles the S3 migration as a side effect of its
normal sync. After we rename `public/` locally and run `yarn deploy`:

```
yarn build  →  copies the new (underscored) public/ paths into dist/
aws s3 sync dist/ s3://brigitte-le-roux-website/ --delete --size-only
            ↑ uploads new underscored keys
            ↑ deletes old space-containing keys (since they're no longer in dist/)
aws cloudfront create-invalidation --paths "/*"
            ↑ refreshes the CDN; visitors stop hitting cached old URLs
```

Single command does the whole migration. **No separate `aws s3 mv` script**
is needed.

## Order of operations

1. **Pre-flight: pull current S3 contents to local `public/`.**

   ```bash
   yarn pull
   ```

   Ensures local `public/` matches what's on S3 before any rename. Critical:
   `aws s3 sync --delete` will remove any S3 key that's NOT in `dist/` after
   the build. If local `public/` is missing files that exist on S3, those
   files would be deleted on deploy. Pulling first eliminates that risk.

2. **Rename in local `public/`.** Four operations:
   - `mv "public/pdfs/a_recherches/GDA Poster.pdf" public/pdfs/ateliers/GDA_Poster.pdf`
     (create `public/pdfs/ateliers/` first if it doesn't exist)
   - `mv "public/data/Logiciels/SPAD projects" public/data/Logiciels/SPAD_projects`
   - `mv "public/data/livres/CIGDA/Spad_Projects/The Parkinson Study_2019_03_31.spad" \
         "public/data/livres/CIGDA/Spad_Projects/The_Parkinson_Study_2019_03_31.spad"`
   - `mv "public/data/livres/CIGDA/Spad_Projects/Cognitive Study_2019_01_01.spad" \
         "public/data/livres/CIGDA/Spad_Projects/Cognitive_Study_2019_01_01.spad"`

3. **Update markdown links.** 12 replacements across the 6 files listed in
   the Inventory table. Mechanical — every old href has exactly one new
   href, and the patterns are unambiguous.

4. **Local verify.**
   - `yarn build` succeeds.
   - Optional: `yarn dev` and click each updated link in the browser
     (ateliers FR + EN, cigda FR + EN, logiciels FR + EN) to confirm the
     files resolve from local `public/`.

5. **Deploy.** `yarn deploy` syncs S3 and invalidates CloudFront.

6. **Production verify.** Hit each updated URL on the live site:
   - `https://brigitte-le-roux.com/pdfs/ateliers/GDA_Poster.pdf`
   - `https://brigitte-le-roux.com/data/livres/CIGDA/Spad_Projects/The_Parkinson_Study_2019_03_31.spad`
   - `https://brigitte-le-roux.com/data/livres/CIGDA/Spad_Projects/Cognitive_Study_2019_01_01.spad`
   - `https://brigitte-le-roux.com/data/Logiciels/SPAD_projects/Culture_2004.spad`
   - `https://brigitte-le-roux.com/data/Logiciels/SPAD_projects/FrenchWorkers_2019.spad`
   - `https://brigitte-le-roux.com/data/Logiciels/SPAD_projects/TasteExample.spad`

   All six should return 200 with the expected file. Old `%20` URLs return
   404 (expected — the old keys are gone from S3).

## Acceptance criteria

- [ ] `rtk proxy grep -rn "%20" content/` returns no results in
      `content/pages/`.
- [ ] All 12 link occurrences in the six listed markdown files have been
      updated to underscored paths per the Inventory table.
- [ ] `find public -name "* *"` returns no results — local mirror is
      space-free.
- [ ] `yarn build` succeeds; 23 pages built.
- [ ] After `yarn deploy`: all 6 underscored URLs above return HTTP 200
      with the correct file content. Old space/%20 URLs return 404.
- [ ] CloudFront cache invalidated (`/*`); fresh requests bypass any
      cached `%20` responses.
- [ ] No regression on any other page — the rename is scoped to four
      asset paths and twelve link strings.

## Out of scope

- CloudFront redirect rules for old `%20` URLs (no SLA on external
  inbound links).
- Renaming the `Spad_Projects/` directory itself (already uses underscore).
- Capitalization or accent normalization in other asset filenames.
- Restructuring `public/` further (e.g. moving other `a_recherches/`
  files into more appropriate directories).
- Generating a separate `aws s3 mv`-based migration script — redundant
  with `yarn deploy --delete`.

## Open questions

_None._ All design choices resolved during brainstorming.

## Reference

- `scripts/deploy.sh` — the `aws s3 sync dist/ … --delete --size-only` call
  that drives the migration.
- `scripts/pull-public.sh` (invoked by `yarn pull`) — sync down S3 to
  local before rename.
- `CLAUDE.md` § "Static assets" — describes the S3-is-source-of-truth
  convention this design relies on.
