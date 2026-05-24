# brigitte-le-roux.com

Personal academic site for Brigitte Le Roux (mathematician, MAP5 / CEVIPOF–CNRS).
Bilingual (FR default, EN at `/en/...`). Static Astro build deployed to S3 +
CloudFront on `brigitte-le-roux.com`.

## Stack

- Astro 5 (static output), Yarn, strict version pinning, no TypeScript.
- Monorepo layout: `packages/website/` (Astro site), `packages/infrastructure/`
  (Terraform). Yarn workspaces are NOT used — the root `package.json` only
  carries namespaced convenience scripts (`frontend:*`, `infra:*`) that
  delegate via `yarn --cwd` and `terraform -chdir`. Each package has its own
  `package.json` with its own strict-pinned deps. Dev server on port `4321`.
- Theme tokens in `packages/website/src/styles/theme.css` — Fraunces (display),
  Bricolage Grotesque (UI), vermillion kicker on parchment ground.

## Content model

**Principle: one page = one file (per locale).** All editorial content for
a page — including book and publication listings — lives in that page's
markdown file. No separate `packages/website/content/books/`, `packages/website/content/publications/`, or
`packages/website/content/data/*.json` indirection. Adding or editing an entry means editing
exactly one file in each locale.

### Flat file layout

Per-locale filenames are flat — `<slug>.<locale>.md` rather than
`<slug>/<locale>.md`. This restores direct URL ↔ file-path symmetry:

- Top-level pages: `packages/website/content/pages/<slug>.<locale>.md`
  - `pages/cv.fr.md` ↔ `/cv/` (and `pages/cv.en.md` ↔ `/en/cv/`)
  - `pages/home.{fr,en}.md` ↔ `/` and `/en/`
  - `pages/livres.{fr,en}.md` ↔ `/livres/` (and EN equivalent)
- Detail pages (one extra path segment):
  `packages/website/content/pages/<parent>/<slug>.<locale>.md`
  - `pages/livres/cigda.fr.md` ↔ `/livres/cigda/`

### Frontmatter fields

Validated by the Zod schema in `packages/website/src/content/config.mjs`:

- Common: `title`, `locale`, `slug`, optional `description`, optional
  `keywords`.
- **`category: narrative`** (optional) — marker on narrative pages
  (`cv`, `recherches`, `ateliers`, `these`, `logiciels`, `bureau`).
  Used by Sveltia's Folder collection `filter` to surface just these
  pages in the CMS "Pages" collection. The home/livres/publications
  listing pages deliberately OMIT this field — they live in their own
  dedicated Sveltia File collections.
- **`page_layout: home | books | publications`** (optional) —
  catch-all route discriminator. When set, the entry renders via the
  matching dedicated layout (`HomeLayout`, `BooksLayout`,
  `PublicationsLayout`); when omitted, the default `PageLayout`. The
  listing pages carry their inline `books:` or `publications:` array.
- Home-only structured fields (when `page_layout: home`): `kicker`,
  `deck_html`, `portrait`, `tiles`.

**i18n strings** — `packages/website/content/i18n/{fr,en}.json` for nav
labels, footer text and common UI strings (key/value translation data —
not editorial content, hence JSON is appropriate here).

Catch-all routes (`packages/website/src/pages/[...slug].astro` and
`packages/website/src/pages/en/[...slug].astro`) derive the URL slug
directly from the entry's path, read `entry.data.books` /
`entry.data.publications` from the page entry, sort by `year`
descending, and render the listing — so the most recent items always
appear first regardless of YAML order.

### Inline listing entries

Each entry is a YAML mapping inside the page's `books:` or `publications:`
array. Schemas in `packages/website/src/content/config.mjs`. Shapes:

```yaml
# In packages/website/content/pages/livres.{fr,en}.md — same data in both files since
# book titles are language-identical on this site.
books:
  - slug: cigda
    title: "Combinatorial Inference in Geometric Data Analysis"
    authors: ["Le Roux, B.", "Bienaise, S.", "Durand, J.-L."]
    year: 2019
    publisher: "Chapman & Hall/CRC"
    isbn: "9781498781619"
    page_slug: "livres/cigda"     # optional — detail page under packages/website/content/pages/
    external: "https://..."        # optional — publisher / external link
    # Two review shapes are supported, mirroring the legacy site:
    book_review_url: "https://..." # optional — ONE external review URL,
                                   #   rendered as " · recension" / "book review"
                                   #   inline after `external`. Used by CIGDA.
    reviews:                       # optional — LIST of locally-archived reviews,
                                   #   rendered as a nested <ul> under the entry
                                   #   with a "Revues critiques" / "Book reviews"
                                   #   label. Used by GDA.
      - reviewer: "J. Hjellbrekke"
        venue: "European Sociological Review"
        year: 2005
        url: "/data/Kl_Hjellbrekke.pdf"
```

```yaml
# In packages/website/content/pages/publications.{fr,en}.md — each locale's page carries
# its own `title` for each entry (titles often genuinely differ FR/EN).
publications:
  - slug: lebaron-le-roux-2013-geometrie-champ
    year: 2013
    title: "Géométrie du champ"          # FR file. EN file has the English title.
    authors: ["Lebaron, F.", "Le Roux, B."]
    venue: "Actes de la recherche en sciences sociales"
    type: "article"                       # article | book | chapter | slides
    pdf: "/data/foo.pdf"                  # optional
    external: "https://..."               # optional
```

The books listing page (`packages/website/content/pages/livres.{fr,en}.md`) also accepts three
optional sub-blocks rendered below the main `books:` list, mirroring the
legacy site's "Livres traduits" / "Translated books", "Chapitres dans des
ouvrages collectifs" / "Book chapters" sections, and the bottom-of-page
"Fichiers de données" / "Data sets" cross-reference. Each block is optional;
each `text_html` is free-prose HTML (because bibliographic citations don't
split cleanly into author/title/venue fields). The route sorts entries by
`year` descending before rendering.

```yaml
# In packages/website/content/pages/livres.{fr,en}.md, after the books: array.
translated_books_title: "Livres traduits"          # locale-specific section header
translated_books:
  - year: 1996
    text_html: "<em>Title</em>. Publisher, Place."

book_chapters_title: "Chapitres dans des ouvrages collectifs"
book_chapters:
  - slug: "<kebab-case-id>"
    year: 2018
    text_html: "Authors (year). Chapter title, chapter N of <em>Book</em>, …"

data_sets_link_html: "Fichiers de données : <a href=\"/logiciels/\">cliquer ici</a>"
```

Adding a new narrative page:

1. Create the markdown pair `packages/website/content/pages/<new-slug>.fr.md`
   and `<new-slug>.en.md`. Set `category: narrative` in the frontmatter
   of each.
2. Add the slug + label to `packages/website/content/i18n/{fr,en}.json`.
3. Add the route to the `items` array in `packages/website/src/components/Header.astro`.

Sveltia's Folder collection auto-discovers the new files via its
`filter: { field: category, value: narrative }` rule — no Sveltia
config change required.

Adding a new book / publication:

1. Open `packages/website/content/pages/livres.{fr,en}.md` (or
   `publications.{fr,en}.md`).
2. Append a new entry to the `books:` (or `publications:`) array per the
   schema above. Both locale files need the entry — for books the YAML is
   identical in both; for publications the `title` field carries the
   locale-specific title.
3. Save. The listing reflects the change immediately on next build, sorted
   by `year` descending.

## Static assets

`packages/website/public/data/` is a single **flat** prefix holding every
binary served verbatim at URL root — PDFs, data files, images, archives —
all addressed as `/data/<basename>`:

- `packages/website/public/data/photoweb.jpg`        → `/data/photoweb.jpg`
- `packages/website/public/data/Kl_Hjellbrekke.pdf`  → `/data/Kl_Hjellbrekke.pdf`
- `packages/website/public/data/CognitiveTests.xls`  → `/data/CognitiveTests.xls`

Why flat? Sveltia's S3 media library shows one consolidated picker per
configured `prefix` — a single bucket of media. Subdirectories complicate
that UX with no editorial benefit. Filenames must therefore be unique;
when ambiguity is possible, prefer descriptive basenames
(`Reviews_Hjellbrekke_2005.pdf`, not `review.pdf`).

**`packages/website/public/` is gitignored.** The canonical store is the production S3 bucket. One file
in `packages/website/public/data/` exceeds GitHub's 100 MB per-file cap, so tracking it in git is not
viable; rather than splitting strategy with Git LFS, the project treats S3 as the
source of truth — which is consistent with how `yarn frontend:deploy` already works (build →
sync `dist/` to S3).

**Carve-out: `packages/website/public/cms/**` IS git-tracked.** The
Sveltia loader, editorial config (`config.yml`), and OAuth shim that
live there are CODE — they integrate with the github-gateway Lambda and
CloudFront functions and belong in version control next to those, not
in S3-as-canonical. A negation rule in `.gitignore` (`!public/cms/`,
`!public/cms/**`) keeps the carve-out scoped while leaving
`public/data/` ignored as before.

Reference these assets from markdown/JSON as plain absolute paths (e.g.
`[PDF](/data/foo.pdf)`).

**Pulling `packages/website/public/` from S3** — fresh clone, new machine, or any time you want to
sync down updates that another contributor pushed:

```bash
yarn frontend:pull                       # pull public/data/ from S3
yarn frontend:pull --dry-run             # preview without writing
yarn frontend:pull --delete              # also delete local files no longer in S3
```

(Excludes built HTML pages — those are regenerated by `yarn frontend:build`.)

## Multi-writer workflow

`packages/website/public/` is the source of truth for site binaries and lives canonically in S3.
When several contributors edit content from different machines:

1. `yarn frontend:pull` — sync any changes others have pushed since your last sync.
2. Edit `packages/website/public/` locally (add/replace PDFs, data files, photos).
3. `yarn frontend:deploy` — build, push `packages/website/public/` to S3, invalidate CloudFront.

Always pull before editing. `yarn frontend:pull` uses `aws s3 sync`'s default mtime
comparison, so it correctly downloads anything newer on S3 without overwriting
unchanged local files.

**Conflict semantics**: last-writer-wins on S3. **Object versioning is intentionally
not enabled** — see the spec's "Deployment infrastructure" note. Enable
`aws_s3_bucket_versioning` in `packages/infrastructure/s3.tf` if accidental overwrites or
multi-writer concurrency become a real problem; it gives free rollback at the
cost of storing every superseded version.

## SEO

Every page renders a full meta-tag stack from `packages/website/src/layouts/BaseLayout.astro`:
description, keywords, author, canonical URL, `hreflang` alternates (FR↔EN
where both versions exist), Open Graph tags, and Twitter card tags. A
generated `robots.txt` (from `packages/website/src/pages/robots.txt.js`) and a sitemap
(`sitemap-index.xml` + chunks, via `@astrojs/sitemap`) are emitted at build
time and uploaded to S3 by `yarn frontend:deploy`.

**Page-level overrides (optional, in markdown frontmatter):**

```yaml
---
title: "Page title"
locale: fr
slug: ...
description: "Specific meta description for this page."
keywords: "narrow, page-specific, keyword, list"
---
```

If `description` or `keywords` is omitted, the locale-wide defaults from
`packages/website/content/i18n/{fr,en}.json` (`site.description`, `site.keywords`) are used.
Override only when a page benefits from a narrower / more specific snippet —
most pages can rely on the defaults.

`hreflang` alternates are auto-suppressed for pages without a translation
(e.g. `/bureau/` is FR-only and emits only `hreflang="fr"` plus `x-default`).

## Build & deploy

```bash
yarn --cwd packages/website install
yarn frontend:dev       # http://localhost:4321
yarn frontend:build     # → packages/website/dist/
yarn frontend:pull      # sync packages/website/public/ from S3
yarn frontend:deploy    # build + S3 sync + CloudFront invalidation
yarn infra:plan         # terraform plan
yarn infra:apply        # terraform apply
```

Infra is Terraform under `packages/infrastructure/`. Remote state lives at
`s3://global-tf-states/brigitte-le-roux-website/terraform.tfstate` (region `eu-central-1`,
S3-native locking via `use_lockfile = true`). Route 53 hosted zone
`Z10238282ED2UHGM8STZA` and the ACM cert for `brigitte-le-roux.com` (in `us-east-1`) are
pre-existing and looked up via data sources — Terraform does not manage them.

## Deferred / out of scope

- Real publications search / filter (current listing is static).
- Light/dark theme toggle, PWA, analytics, forms.

## Open follow-ups

- `bureau` page is FR-only on the legacy source; currently omitted from EN nav.
- Publications schema may evolve once the listing UX is finalized.
- Translated FR/EN slug pairs to be verified against the legacy site nav.

## Reference

- Design spec: `docs/superpowers/specs/2026-05-16-brigitte-leroux-website-design.md`.
