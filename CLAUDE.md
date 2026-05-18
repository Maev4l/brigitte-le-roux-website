# brigitte-le-roux.com

Personal academic site for Brigitte Le Roux (mathematician, MAP5 / CEVIPOF–CNRS).
Bilingual (FR default, EN at `/en/...`). Static Astro build deployed to S3 +
CloudFront on `brigitte-le-roux.com`.

## Stack

- Astro 5 (static output), Yarn, strict version pinning, no TypeScript, no workspaces.
- Single Astro project at the repo root. Dev server on port `4321`.
- Theme tokens in `src/styles/theme.css` — Fraunces (display), Bricolage Grotesque (UI),
  vermillion kicker on parchment ground.

## Content model

**Principle: one page = one file (per locale).** All editorial content for
a page — including book and publication listings — lives in that page's
markdown file. No separate `content/books/`, `content/publications/`, or
`content/data/*.json` indirection. Adding or editing an entry means editing
exactly one file in each locale.

- **Pages** — `content/pages/<slug>/{fr,en}.md`. Frontmatter fields,
  validated by Zod schema in `src/content/config.mjs`:
  - Common: `title`, `locale`, `slug`, optional `description`, optional
    `keywords`.
  - Page-layout discriminator (optional): `page_layout: home | books | publications`.
    When set, the catch-all route routes the entry to the matching dedicated layout
    (`HomeLayout`, `BooksLayout`, `PublicationsLayout`). When omitted, the page
    renders via the default `PageLayout`. Listing pages also carry their inline
    `books:` or `publications:` array as before.
  - Home-only structured fields (when `page_layout: home`): `kicker`, `deck_html`,
    `portrait`, `tiles`.
- **i18n** — `content/i18n/{fr,en}.json` for nav labels, footer text and
  common UI strings (key/value translation data — not editorial content,
  hence JSON is appropriate here).

Catch-all routes (`src/pages/[...slug].astro` and `src/pages/en/[...slug].astro`)
read `entry.data.books` / `entry.data.publications` from the page entry,
sort by `year` descending, and render the listing — so the most recent
items always appear first regardless of YAML order.

### Inline listing entries

Each entry is a YAML mapping inside the page's `books:` or `publications:`
array. Schemas in `src/content/config.mjs`. Shapes:

```yaml
# In content/pages/livres/{fr,en}.md — same data in both files since
# book titles are language-identical on this site.
books:
  - slug: cigda
    title: "Combinatorial Inference in Geometric Data Analysis"
    authors: ["Le Roux, B.", "Bienaise, S.", "Durand, J.-L."]
    year: 2019
    publisher: "Chapman & Hall/CRC"
    isbn: "9781498781619"
    page_slug: "livres/cigda"     # optional — detail page under content/pages/
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
        url: "/pdfs/livres/Reviews/Kl_Hjellbrekke.pdf"
```

```yaml
# In content/pages/publications/{fr,en}.md — each locale's page carries its
# own `title` for each entry (titles often genuinely differ FR/EN).
publications:
  - slug: lebaron-le-roux-2013-geometrie-champ
    year: 2013
    title: "Géométrie du champ"          # FR file. EN file has the English title.
    authors: ["Lebaron, F.", "Le Roux, B."]
    venue: "Actes de la recherche en sciences sociales"
    type: "article"                       # article | book | chapter | slides
    pdf: "/pdfs/publications/foo.pdf"     # optional
    external: "https://..."               # optional
```

The books listing page (`content/pages/livres/{fr,en}.md`) also accepts three
optional sub-blocks rendered below the main `books:` list, mirroring the
legacy site's "Livres traduits" / "Translated books", "Chapitres dans des
ouvrages collectifs" / "Book chapters" sections, and the bottom-of-page
"Fichiers de données" / "Data sets" cross-reference. Each block is optional;
each `text_html` is free-prose HTML (because bibliographic citations don't
split cleanly into author/title/venue fields). The route sorts entries by
`year` descending before rendering.

```yaml
# In content/pages/livres/{fr,en}.md, after the books: array.
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

Adding a new route:

1. Create the markdown pair in `content/pages/<new-slug>/`.
2. Add the slug + label to `content/i18n/{fr,en}.json`.
3. Add the route to the `items` array in `src/components/Header.astro`.

Adding a new book / publication:

1. Open `content/pages/livres/{fr,en}.md` (or `publications/{fr,en}.md`).
2. Append a new entry to the `books:` (or `publications:`) array per the
   schema above. Both locale files need the entry — for books the YAML is
   identical in both; for publications the `title` field carries the
   locale-specific title.
3. Save. The listing reflects the change immediately on next build, sorted
   by `year` descending.

## Static assets

`public/` contains binaries served verbatim at URL root:

- `public/pdfs/` → `/pdfs/foo.pdf`
- `public/data/` → `/data/bar.xls`
- `public/img/`  → `/img/photoweb.jpg`

**`public/` is gitignored.** The canonical store is the production S3 bucket. One file
in `public/data/` exceeds GitHub's 100 MB per-file cap, so tracking it in git is not
viable; rather than splitting strategy with Git LFS, the project treats S3 as the
source of truth — which is consistent with how `yarn deploy` already works (build →
sync `dist/` to S3).

Reference these assets from markdown/JSON as plain absolute paths (e.g.
`[PDF](/pdfs/foo.pdf)`).

**Pulling `public/` from S3** — fresh clone, new machine, or any time you want to
sync down updates that another contributor pushed:

```bash
yarn pull                       # pull all three subtrees
yarn pull --dry-run             # preview without writing
yarn pull --delete              # also delete local files no longer in S3
yarn pull pdfs                  # restrict to one subtree (pdfs|data|img)
```

(Excludes built HTML pages — those are regenerated by `yarn build`.)

## Multi-writer workflow

`public/` is the source of truth for site binaries and lives canonically in S3.
When several contributors edit content from different machines:

1. `yarn pull` — sync any changes others have pushed since your last sync.
2. Edit `public/` locally (add/replace PDFs, data files, photos).
3. `yarn deploy` — build, push `public/` to S3, invalidate CloudFront.

Always pull before editing. `yarn pull` uses `aws s3 sync`'s default mtime
comparison, so it correctly downloads anything newer on S3 without overwriting
unchanged local files.

**Conflict semantics**: last-writer-wins on S3. **Object versioning is intentionally
not enabled** — see the spec's "Deployment infrastructure" note. Enable
`aws_s3_bucket_versioning` in `infrastructure/s3.tf` if accidental overwrites or
multi-writer concurrency become a real problem; it gives free rollback at the
cost of storing every superseded version.

## SEO

Every page renders a full meta-tag stack from `src/layouts/BaseLayout.astro`:
description, keywords, author, canonical URL, `hreflang` alternates (FR↔EN
where both versions exist), Open Graph tags, and Twitter card tags. A
generated `robots.txt` (from `src/pages/robots.txt.js`) and a sitemap
(`sitemap-index.xml` + chunks, via `@astrojs/sitemap`) are emitted at build
time and uploaded to S3 by `yarn deploy`.

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
`content/i18n/{fr,en}.json` (`site.description`, `site.keywords`) are used.
Override only when a page benefits from a narrower / more specific snippet —
most pages can rely on the defaults.

`hreflang` alternates are auto-suppressed for pages without a translation
(e.g. `/bureau/` is FR-only and emits only `hreflang="fr"` plus `x-default`).

## Build & deploy

```bash
yarn install
yarn dev                # http://localhost:4321
yarn build              # → dist/
yarn deploy             # build + S3 sync + CloudFront invalidation
yarn infra:plan         # terraform plan
yarn infra:apply        # terraform apply
```

Infra is Terraform under `infrastructure/`. Remote state lives at
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
