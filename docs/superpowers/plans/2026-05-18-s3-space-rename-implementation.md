# S3 Key Space-to-Underscore Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every ASCII space character in S3 keys (and matching local
`public/` paths) with an underscore `_`, update the 12 link occurrences in
`content/pages/*.md` that point at those paths, and relocate the Berkeley
poster from `pdfs/a_recherches/` to `pdfs/ateliers/` so its currently-broken
relative-path link finally resolves.

**Architecture:** Rename in local `public/` (the gitignored mirror of S3),
update markdown link strings, then run `yarn deploy`. The existing two-pass
`scripts/deploy.sh` handles the S3 migration as a side effect: Pass 1
(`aws s3 sync --size-only --delete` on `data/`, `pdfs/`, `img/`) uploads
the new underscored keys and deletes the old space-containing keys; Pass 2
(`aws s3 sync --delete` on the remainder, force-re-upload) ensures the
updated HTML referencing the new paths gets to S3. CloudFront `/*`
invalidation refreshes the CDN.

**Tech Stack:** Astro 5, Yarn, `aws s3 sync` via `scripts/deploy.sh`,
CloudFront. No new dependencies. Verification is `yarn build` plus
`curl -sI` HTTP HEAD checks against the live URLs.

---

## File map

| Action | Path | Responsibility |
| --- | --- | --- |
| Move + rename | `public/pdfs/a_recherches/GDA Poster.pdf` → `public/pdfs/ateliers/GDA_Poster.pdf` | Berkeley poster: relocate into `pdfs/ateliers/` and drop the space. |
| Rename (dir)  | `public/data/Logiciels/SPAD projects/` → `public/data/Logiciels/SPAD_projects/` | SPAD project parent directory referenced by /logiciels. |
| Rename (file) | `public/data/livres/CIGDA/Spad_Projects/The Parkinson Study_2019_03_31.spad` → `…/The_Parkinson_Study_2019_03_31.spad` | CIGDA case study #1. |
| Rename (file) | `public/data/livres/CIGDA/Spad_Projects/Cognitive Study_2019_01_01.spad` → `…/Cognitive_Study_2019_01_01.spad` | CIGDA case study #4. |
| Modify | `content/pages/ateliers/fr.md` | 1 link: relative `ateliers/GDA%20Poster.pdf` → absolute `/pdfs/ateliers/GDA_Poster.pdf`. |
| Modify | `content/pages/ateliers/en.md` | 1 link, same replacement. |
| Modify | `content/pages/livres/cigda/fr.md` | 2 links: `…/The%20Parkinson%20Study_…spad` and `…/Cognitive%20Study_…spad` lose their `%20` markers. |
| Modify | `content/pages/livres/cigda/en.md` | 2 links, same replacements. |
| Modify | `content/pages/logiciels/fr.md` | 3 links: `SPAD%20projects/` → `SPAD_projects/`. |
| Modify | `content/pages/logiciels/en.md` | 3 links, same replacements. |

Source files modified: **6 markdown files**, **12 link occurrences**.
Filesystem operations: **1 mkdir + 4 mv** in `public/`.

## Conventions

- **No commit steps in this plan.** User's global rule: never auto-commit.
  Verification points are placed where it makes sense to commit; the user
  pulls that trigger.
- **`public/` is gitignored.** Local mirror state matters only for the
  build → deploy pipeline. Renames in `public/` don't touch git.
- **Deploy is destructive on S3.** Run `yarn deploy` only once everything
  else is verified locally.

---

## Tasks

### Task 1: Pre-flight — pull from S3 and rename local `public/`

**Files:**
- Modify (rename): four paths in `public/` as listed in the file map.

- [ ] **Step 1: Sync local `public/` from S3**

Run:

```bash
yarn pull
```

Expected: `yarn pull` runs `bash scripts/pull-public.sh`, which uses
`aws s3 sync` to download the current S3 state into `public/`. No output
matters beyond a successful exit.

Why this matters: `aws s3 sync --delete` on the next deploy will remove any
S3 key that's NOT in local `dist/`. If local `public/` is missing files
that exist on S3 (because someone else uploaded them directly), those
would be deleted on deploy. Pulling first eliminates that risk.

- [ ] **Step 2: Verify the four paths exist locally**

Run:

```bash
test -f "public/pdfs/a_recherches/GDA Poster.pdf" && echo "OK: poster"
test -d "public/data/Logiciels/SPAD projects" && echo "OK: SPAD projects dir"
test -f "public/data/livres/CIGDA/Spad_Projects/The Parkinson Study_2019_03_31.spad" && echo "OK: parkinson"
test -f "public/data/livres/CIGDA/Spad_Projects/Cognitive Study_2019_01_01.spad" && echo "OK: cognitive"
```

Expected: four `OK:` lines. If any fail, STOP — the rename target doesn't
exist; investigate before proceeding.

- [ ] **Step 3: Create the new ateliers directory and move the poster**

Run:

```bash
mkdir -p public/pdfs/ateliers
mv "public/pdfs/a_recherches/GDA Poster.pdf" "public/pdfs/ateliers/GDA_Poster.pdf"
```

- [ ] **Step 4: Rename the SPAD projects directory**

Run:

```bash
mv "public/data/Logiciels/SPAD projects" "public/data/Logiciels/SPAD_projects"
```

- [ ] **Step 5: Rename the two CIGDA `.spad` files**

Run:

```bash
mv "public/data/livres/CIGDA/Spad_Projects/The Parkinson Study_2019_03_31.spad" \
   "public/data/livres/CIGDA/Spad_Projects/The_Parkinson_Study_2019_03_31.spad"
mv "public/data/livres/CIGDA/Spad_Projects/Cognitive Study_2019_01_01.spad" \
   "public/data/livres/CIGDA/Spad_Projects/Cognitive_Study_2019_01_01.spad"
```

- [ ] **Step 6: Verify local `public/` is now space-free**

Run:

```bash
find public -name "* *" 2>&1
```

Expected: empty output. If anything is listed, a rename target was missed.

- [ ] **Step 7: Verify the new paths exist**

Run:

```bash
test -f "public/pdfs/ateliers/GDA_Poster.pdf" && echo "OK: poster"
test -d "public/data/Logiciels/SPAD_projects" && echo "OK: SPAD_projects dir"
test -f "public/data/livres/CIGDA/Spad_Projects/The_Parkinson_Study_2019_03_31.spad" && echo "OK: parkinson"
test -f "public/data/livres/CIGDA/Spad_Projects/Cognitive_Study_2019_01_01.spad" && echo "OK: cognitive"
ls "public/data/Logiciels/SPAD_projects" | head -5
```

Expected: four `OK:` lines plus a listing of files inside `SPAD_projects/`
(should contain `Culture_2004.spad`, `FrenchWorkers_2019.spad`,
`TasteExample.spad`, and possibly other files).

---

### Task 2: Update markdown links (12 occurrences across 6 files)

**Files:**
- Modify: `content/pages/ateliers/fr.md`
- Modify: `content/pages/ateliers/en.md`
- Modify: `content/pages/livres/cigda/fr.md`
- Modify: `content/pages/livres/cigda/en.md`
- Modify: `content/pages/logiciels/fr.md`
- Modify: `content/pages/logiciels/en.md`

Each edit below uses literal old-string and new-string. The strings are
unique within their files so each edit is unambiguous.

- [ ] **Step 1: Update `content/pages/ateliers/fr.md`**

Find:

```markdown
| 2012 | [Berkeley](ateliers/GDA%20Poster.pdf) | Californie, USA |
```

Replace with:

```markdown
| 2012 | [Berkeley](/pdfs/ateliers/GDA_Poster.pdf) | Californie, USA |
```

- [ ] **Step 2: Update `content/pages/ateliers/en.md`**

Find:

```markdown
| 2012 | [Berkeley](ateliers/GDA%20Poster.pdf) | California, USA |
```

Replace with:

```markdown
| 2012 | [Berkeley](/pdfs/ateliers/GDA_Poster.pdf) | California, USA |
```

- [ ] **Step 3: Update `content/pages/livres/cigda/fr.md` — Parkinson link**

Find:

```
/data/livres/CIGDA/Spad_Projects/The%20Parkinson%20Study_2019_03_31.spad
```

Replace with:

```
/data/livres/CIGDA/Spad_Projects/The_Parkinson_Study_2019_03_31.spad
```

Use `replace_all: false` — the URL appears once in the file.

- [ ] **Step 4: Update `content/pages/livres/cigda/fr.md` — Cognitive link**

Find:

```
/data/livres/CIGDA/Spad_Projects/Cognitive%20Study_2019_01_01.spad
```

Replace with:

```
/data/livres/CIGDA/Spad_Projects/Cognitive_Study_2019_01_01.spad
```

- [ ] **Step 5: Update `content/pages/livres/cigda/en.md` — Parkinson link**

Same find/replace as Step 3, in the EN file.

Find:

```
/data/livres/CIGDA/Spad_Projects/The%20Parkinson%20Study_2019_03_31.spad
```

Replace with:

```
/data/livres/CIGDA/Spad_Projects/The_Parkinson_Study_2019_03_31.spad
```

- [ ] **Step 6: Update `content/pages/livres/cigda/en.md` — Cognitive link**

Same find/replace as Step 4, in the EN file.

Find:

```
/data/livres/CIGDA/Spad_Projects/Cognitive%20Study_2019_01_01.spad
```

Replace with:

```
/data/livres/CIGDA/Spad_Projects/Cognitive_Study_2019_01_01.spad
```

- [ ] **Step 7: Update `content/pages/logiciels/fr.md` — three SPAD links**

The three occurrences all share the prefix `/data/Logiciels/SPAD%20projects/`.
Use `replace_all: true` for this file with:

Find:

```
/data/Logiciels/SPAD%20projects/
```

Replace with:

```
/data/Logiciels/SPAD_projects/
```

This catches all three Culture / FrenchWorkers / TasteExample links in
one pass.

- [ ] **Step 8: Update `content/pages/logiciels/en.md` — three SPAD links**

Same find/replace as Step 7, in the EN file. `replace_all: true`.

Find:

```
/data/Logiciels/SPAD%20projects/
```

Replace with:

```
/data/Logiciels/SPAD_projects/
```

- [ ] **Step 9: Grep-verify all 12 occurrences are gone from markdown**

Run:

```bash
rtk proxy grep -rn "%20" content/pages/ 2>&1 || echo "(no matches — clean)"
```

Expected: `(no matches — clean)`. If any `%20` remains in any markdown
file, return to the relevant step above.

- [ ] **Step 10: Grep-verify the broken relative path is gone**

Run:

```bash
rtk proxy grep -rnE 'ateliers/GDA' content/pages/ 2>&1 | head -5
```

Expected: only matches showing the new absolute path
`/pdfs/ateliers/GDA_Poster.pdf` — no remaining `ateliers/GDA%20Poster.pdf`
relative form anywhere.

---

### Task 3: Local build + link verification

**Files:** none (verification only).

- [ ] **Step 1: Build clean**

Run:

```bash
yarn build
```

Expected: build succeeds, 23 pages built, no warnings.

- [ ] **Step 2: Verify no `%20` in built HTML**

Run:

```bash
rtk proxy grep -rn "%20" dist/ 2>&1 | rtk proxy grep -v "_astro/" | rtk proxy grep -v "robots.txt" | rtk proxy grep -v "fonts.googleapis" | head -10
```

Expected: nothing matches (or only Google Fonts URLs, which we don't
control). If any project link still contains `%20`, return to Task 2.

- [ ] **Step 3: Verify the seven new asset paths are present in `dist/`**

Run:

```bash
test -f "dist/pdfs/ateliers/GDA_Poster.pdf" && echo "OK: dist poster"
test -f "dist/data/Logiciels/SPAD_projects/Culture_2004.spad" && echo "OK: dist Culture"
test -f "dist/data/Logiciels/SPAD_projects/FrenchWorkers_2019.spad" && echo "OK: dist FrenchWorkers"
test -f "dist/data/Logiciels/SPAD_projects/TasteExample.spad" && echo "OK: dist TasteExample"
test -f "dist/data/livres/CIGDA/Spad_Projects/The_Parkinson_Study_2019_03_31.spad" && echo "OK: dist Parkinson"
test -f "dist/data/livres/CIGDA/Spad_Projects/Cognitive_Study_2019_01_01.spad" && echo "OK: dist Cognitive"
```

Expected: six `OK:` lines.

- [ ] **Step 4: Spot-check the rendered ateliers / cigda / logiciels HTML**

Run:

```bash
python3 -c "
import re
for url in ['ateliers/', 'en/ateliers/', 'livres/cigda/', 'en/livres/cigda/', 'logiciels/', 'en/logiciels/']:
    with open(f'dist/{url}index.html') as f:
        h = f.read()
    bad = re.findall(r'%20', h)
    paths = re.findall(r'href=\"(/[^\"]*(?:SPAD_projects|Spad_Projects|GDA_Poster)[^\"]*)\"', h)
    print(f'/{url}  %20 count = {len(bad)}, expected = 0')
    for p in paths[:5]:
        print(f'    {p}')
"
```

Expected: `%20 count = 0` for every URL listed. The paths shown should all
use underscores (`GDA_Poster.pdf`, `SPAD_projects/`, `Spad_Projects/`).

---

### Task 4: Deploy to S3

**Files:** none (production deploy).

- [ ] **Step 1: Run the deploy**

Run:

```bash
yarn deploy
```

Expected behaviour (this is the recently-updated two-pass deploy script):
- `yarn build` runs and produces `dist/`.
- **Pass 1** — `aws s3 sync dist/data/`, `dist/pdfs/`, `dist/img/` with
  `--size-only --delete`. Should show:
  - `upload: dist/pdfs/ateliers/GDA_Poster.pdf to s3://…`
  - `upload: dist/data/Logiciels/SPAD_projects/Culture_2004.spad to s3://…`
    (and the other 2 logiciels files)
  - `upload: dist/data/livres/CIGDA/Spad_Projects/The_Parkinson_Study_2019_03_31.spad to s3://…`
  - `upload: dist/data/livres/CIGDA/Spad_Projects/Cognitive_Study_2019_01_01.spad to s3://…`
  - `delete: s3://…/pdfs/a_recherches/GDA Poster.pdf`
  - `delete: s3://…/data/Logiciels/SPAD projects/Culture_2004.spad` (and friends)
  - `delete: s3://…/data/livres/CIGDA/Spad_Projects/The Parkinson Study_…spad`
  - `delete: s3://…/data/livres/CIGDA/Spad_Projects/Cognitive Study_…spad`
- **Pass 2** — `aws s3 sync dist/ s3://…` (HTML + bundles, force re-upload).
  Should show ~27 HTML index files re-uploaded (already does this every
  deploy per the recent two-pass fix).
- **CloudFront invalidation** — `aws cloudfront create-invalidation --paths "/*"`.

If any upload or delete fails, STOP and investigate.

- [ ] **Step 2: Spot-check the deploy output for the expected moves**

After the deploy completes, manually scan the output for:
- `upload:` lines with the new underscored paths (poster, 3 logiciels
  SPAD files, 2 cigda SPAD files).
- `delete:` lines with the corresponding old space-containing paths.

If you see uploads without matching deletes (or vice versa), something is
inconsistent — investigate before claiming success.

---

### Task 5: Production verification

**Files:** none (HTTP checks against the live site).

- [ ] **Step 1: Verify new URLs return HTTP 200**

Run:

```bash
for url in \
  "https://brigitte-le-roux.com/pdfs/ateliers/GDA_Poster.pdf" \
  "https://brigitte-le-roux.com/data/livres/CIGDA/Spad_Projects/The_Parkinson_Study_2019_03_31.spad" \
  "https://brigitte-le-roux.com/data/livres/CIGDA/Spad_Projects/Cognitive_Study_2019_01_01.spad" \
  "https://brigitte-le-roux.com/data/Logiciels/SPAD_projects/Culture_2004.spad" \
  "https://brigitte-le-roux.com/data/Logiciels/SPAD_projects/FrenchWorkers_2019.spad" \
  "https://brigitte-le-roux.com/data/Logiciels/SPAD_projects/TasteExample.spad"
do
    code=$(curl -sI -o /dev/null -w '%{http_code}' "$url")
    echo "  $code  $url"
done
```

Expected: every line shows `200`. If any shows `403` or `404`, the deploy
didn't upload that file — return to Task 4 Step 2 to investigate.

- [ ] **Step 2: Verify old URLs return 403 or 404**

Run:

```bash
for url in \
  "https://brigitte-le-roux.com/pdfs/a_recherches/GDA%20Poster.pdf" \
  "https://brigitte-le-roux.com/data/Logiciels/SPAD%20projects/Culture_2004.spad" \
  "https://brigitte-le-roux.com/data/livres/CIGDA/Spad_Projects/The%20Parkinson%20Study_2019_03_31.spad"
do
    code=$(curl -sI -o /dev/null -w '%{http_code}' "$url")
    echo "  $code  $url"
done
```

Expected: every line shows `403` (S3's response for missing keys when
public-list is blocked) or `404`. If any shows `200`, the old key wasn't
deleted from S3 — investigate via `aws s3 ls`.

- [ ] **Step 3: Verify the rendered HTML on prod shows the new paths**

Run:

```bash
python3 << 'EOF'
import urllib.request, re
for url in ['ateliers/', 'en/ateliers/', 'livres/cigda/', 'en/livres/cigda/', 'logiciels/', 'en/logiciels/']:
    with open('/dev/null') as _: pass  # dummy
    try:
        with urllib.request.urlopen(f'https://brigitte-le-roux.com/{url}') as resp:
            h = resp.read().decode('utf-8', errors='replace')
        bad = len(re.findall(r'%20', h))
        good = re.findall(r'href="(/[^"]*(?:SPAD_projects|Spad_Projects|GDA_Poster)[^"]*)"', h)
        print(f'/{url}  %20 count = {bad}')
        for g in good[:5]:
            print(f'    {g}')
    except Exception as e:
        print(f'/{url}  ERROR: {e}')
EOF
```

Expected: `%20 count = 0` for every URL, and the asset hrefs show
underscored paths.

---

### Task 6: Final acceptance checklist (from spec)

**Files:** none (verification).

Mark each spec acceptance criterion PASS or FAIL based on the previous
tasks' verification output:

- [ ] `rtk proxy grep -rn "%20" content/` returns no results in
      `content/pages/`. → covered by Task 2 Step 9.
- [ ] All 12 link occurrences in the six listed markdown files have been
      updated to underscored paths per the Inventory table. → covered by
      Task 2 Steps 1-8 + grep in Step 9.
- [ ] `find public -name "* *"` returns no results — local mirror is
      space-free. → covered by Task 1 Step 6.
- [ ] `yarn build` succeeds; 23 pages built. → covered by Task 3 Step 1.
- [ ] After `yarn deploy`: all 6 underscored URLs return HTTP 200 with
      the correct file content. Old space/%20 URLs return 404. → covered
      by Task 5 Steps 1 and 2.
- [ ] CloudFront cache invalidated (`/*`); fresh requests bypass any
      cached `%20` responses. → `yarn deploy` emits the invalidation; the
      Task 5 Step 1 cache-bust curl confirms fresh fetch shows new state.
- [ ] No regression on any other page — the rename is scoped to four
      asset paths and twelve link strings. → confirm `yarn build`
      (Task 3 Step 1) reports 23 pages, no warnings, and other pages
      (cv, recherches, these, etc.) still render the same as before
      this work (spot-check in a browser if desired).

If all checks PASS, the migration is complete. If any FAIL, the failing
criterion identifies which task needs revisiting.

---

## Summary

Net changes:
- **Filesystem in `public/`:** 1 directory rename, 3 file renames + relocation. Local mirror loses all spaces.
- **S3:** ~6 new keys uploaded, ~6 old space-containing keys deleted, ~27 HTML files re-uploaded (Pass 2 always re-uploads HTML — that's the recent deploy fix, unrelated to this work but benefits us here).
- **Markdown:** 12 link replacements across 6 source files. ~12 lines diff in git.
- **Code:** Zero. No schema, route, or layout changes. The existing two-pass `deploy.sh` does the migration without modification.
- **CloudFront:** One `/*` invalidation (deploy script does this on every deploy).

After all 6 tasks complete, the live site has zero `%20` URLs in any
rendered HTML, the Berkeley poster is accessible from a clean
`/pdfs/ateliers/GDA_Poster.pdf` URL, and every `.spad` link uses
underscored filenames.
